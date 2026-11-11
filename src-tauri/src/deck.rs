use hidapi::{HidApi, HidDevice};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const VID: u16 = 0x1209;
const PID: u16 = 0x0001;
const SERIAL: &str = "OSD153R00001";
const REPORT: usize = 1024;
const PAYLOAD: usize = REPORT - 3;
const SYNC: u16 = 0x8000;
pub const FENCE: u8 = 0x09;

#[derive(Clone, Serialize, Default)]
pub struct DeckStatus {
    pub connected: bool,
    pub firmware: String,
    pub session: u32,
    pub name: String,
    pub serial: String,
    pub mode: String,
    pub caps: u8,
    pub high_speed: bool,
    pub display_ok: bool,
}

#[derive(Clone, Default, PartialEq)]
struct Identity {
    mode: &'static str,
    firmware: String,
    name: String,
    serial: String,
    caps: u8,
    high_speed: bool,
    display_ok: bool,
}

const STOCK: (u16, u16) = (0x0300, 0x1020);
const LOADER: (u16, u16) = (0xeeef, 0x2929);
const MODEL: &str = "AJAZZ AKP153R";

fn detect_other(api: &HidApi) -> Identity {
    let find = |(vid, pid): (u16, u16)| api.device_list().find(|d| d.vendor_id() == vid && d.product_id() == pid);
    let (mode, info) = match (find(STOCK), find(LOADER)) {
        (Some(info), _) => ("stock", Some(info)),
        (None, Some(_)) => ("loader", None),
        (None, None) => return Identity { mode: "none", ..Identity::default() },
    };
    Identity {
        mode,
        firmware: String::new(),
        name: MODEL.into(),
        caps: 0,
        serial: info.and_then(|d| d.serial_number()).unwrap_or_default().to_string(),
        ..Identity::default()
    }
}

fn display_name(product: Option<&str>) -> String {
    let model = product.unwrap_or("").trim().trim_start_matches("OSD").trim();
    if model.is_empty() { MODEL.into() } else { format!("AJAZZ {model}") }
}

#[derive(Clone, Serialize)]
struct KeyEvent {
    index: u8,
    pressed: bool,
}

#[derive(Default)]
struct Fences {
    start: u32,
    issued: u32,
    done: u32,
    failed: u32,
}

#[derive(Default)]
struct Fence {
    ids: Mutex<Fences>,
    signal: Condvar,
}

impl Fence {
    fn reset(&self) {
        let start = getrandom::u32().unwrap_or(0x05ee_d000);
        *self.ids.lock().unwrap() = Fences { start, issued: 0, done: 0, failed: 0 };
        self.signal.notify_all();
    }

    fn issue(&self) -> (u32, u32) {
        let mut ids = self.ids.lock().unwrap();
        ids.issued += 1;
        (ids.start.wrapping_add(ids.issued), ids.issued)
    }

    fn update(&self, id: u32) {
        let mut ids = self.ids.lock().unwrap();
        let offset = id.wrapping_sub(ids.start);
        if offset > ids.done && offset <= ids.issued {
            ids.done = offset;
            self.signal.notify_all();
        }
    }

    fn fail(&self) {
        let mut ids = self.ids.lock().unwrap();
        if ids.done < ids.issued {
            ids.failed = ids.done + 1;
            self.signal.notify_all();
        }
    }

    fn wait(&self, offset: u32, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut ids = self.ids.lock().unwrap();
        while ids.done < offset && ids.issued >= offset && ids.failed != offset {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return false;
            }
            ids = self.signal.wait_timeout(ids, left).unwrap().0;
        }
        ids.done >= offset
    }
}

#[derive(Clone)]
pub struct Deck {
    status: Arc<Mutex<DeckStatus>>,
    writer: Arc<Mutex<Option<Sender<Vec<u8>>>>>,
    fence: Arc<Fence>,
}

impl Deck {
    pub fn start(app: AppHandle) -> Deck {
        let deck = Deck {
            status: Arc::new(Mutex::new(DeckStatus::default())),
            writer: Arc::new(Mutex::new(None)),
            fence: Arc::new(Fence::default()),
        };
        let status = deck.status.clone();
        let writer = deck.writer.clone();
        let fence = deck.fence.clone();
        thread::spawn(move || supervise(app, status, writer, fence));
        deck
    }

    pub fn draw(&self, mut bytes: Vec<u8>, timeout: Duration) -> Result<(), String> {
        let offset = {
            let writer = self.writer.lock().unwrap();
            let tx =
                writer.as_ref().ok_or_else(|| tr!("Дека не подключена", "The deck isn't connected", "设备未连接"))?;
            let (id, offset) = self.fence.issue();
            bytes.push(FENCE);
            bytes.extend_from_slice(&id.to_le_bytes());
            tx.send(bytes).map_err(|_| tr!("Дека отключена", "The deck was disconnected", "设备已断开连接"))?;
            offset
        };
        if self.fence.wait(offset, timeout) {
            Ok(())
        } else {
            Err(tr!("Дека не ответила", "The deck didn't respond", "设备没有响应"))
        }
    }

    pub fn status(&self) -> DeckStatus {
        self.status.lock().unwrap().clone()
    }
}

fn open(api: &HidApi) -> Option<(HidDevice, HidDevice, Identity)> {
    let info = api.device_list().find(|d| {
        d.vendor_id() == VID && d.product_id() == PID && d.serial_number() == Some(SERIAL) && d.usage_page() == 0xff00
    })?;
    let reader = info.open_device(api).map_err(|e| eprintln!("deck: open reader: {e}")).ok()?;
    let writer = info.open_device(api).map_err(|e| eprintln!("deck: open writer: {e}")).ok()?;
    let mut feature = [0u8; 32];
    feature[0] = 3;
    let n = reader.get_feature_report(&mut feature).map_err(|e| eprintln!("deck: feature 3: {e}")).ok()?;
    if n < 9 || &feature[1..5] != b"OSD1" {
        return None;
    }
    let identity = Identity {
        mode: "osd",
        firmware: format!("{}.{}.{}", feature[6], feature[7], feature[8]),
        name: display_name(info.product_string()),
        serial: info.serial_number().unwrap_or_default().to_string(),
        caps: if n > 17 { feature[17] } else { 0 },
        ..diagnostics(&reader)
    };
    Some((reader, writer, identity))
}

fn diagnostics(device: &HidDevice) -> Identity {
    let mut report = [0u8; 32];
    report[0] = 0x7e;
    match device.get_feature_report(&mut report) {
        Ok(n) if n > 7 && &report[1..5] == b"OSDD" => {
            Identity { high_speed: report[7] & 4 != 0, display_ok: report[7] & 2 != 0, ..Identity::default() }
        }
        _ => Identity { high_speed: true, display_ok: true, ..Identity::default() },
    }
}

fn set_status(app: &AppHandle, status: &Arc<Mutex<DeckStatus>>, connected: bool, identity: Identity) {
    eprintln!(
        "deck: connected={connected} mode={} firmware={} name={}",
        identity.mode, identity.firmware, identity.name
    );
    let snapshot = {
        let mut s = status.lock().unwrap();
        s.connected = connected;
        s.firmware = identity.firmware;
        s.name = identity.name;
        s.serial = identity.serial;
        s.mode = identity.mode.into();
        s.caps = identity.caps;
        s.high_speed = identity.high_speed;
        s.display_ok = identity.display_ok;
        if connected {
            s.session += 1;
        }
        s.clone()
    };
    let _ = app.emit("deck-status", snapshot);
}

pub fn connect() -> Option<(HidDevice, HidDevice)> {
    let api = HidApi::new().ok()?;
    open(&api).map(|(reader, writer, _)| (reader, writer))
}

fn supervise(
    app: AppHandle,
    status: Arc<Mutex<DeckStatus>>,
    writer_slot: Arc<Mutex<Option<Sender<Vec<u8>>>>>,
    fence: Arc<Fence>,
) {
    let mut api = match HidApi::new() {
        Ok(api) => api,
        Err(_) => return,
    };
    let mut last = Identity::default();
    loop {
        let _ = api.refresh_devices();
        if let Some((reader, writer, identity)) = open(&api) {
            let (tx, rx) = mpsc::channel::<Vec<u8>>();
            fence.reset();
            *writer_slot.lock().unwrap() = Some(tx);
            let broken = Arc::new(AtomicBool::new(false));
            let write_broken = broken.clone();
            let write_thread = thread::spawn(move || write_loop(writer, rx, &write_broken));
            set_status(&app, &status, true, identity);
            read_loop(&app, reader, &fence, &broken);
            *writer_slot.lock().unwrap() = None;
            fence.reset();
            let _ = write_thread.join();
            set_status(&app, &status, false, Identity { mode: "none", ..Identity::default() });
            last = Identity::default();
        } else {
            let other = detect_other(&api);
            if other != last {
                set_status(&app, &status, false, other.clone());
                last = other;
            }
        }
        thread::sleep(Duration::from_millis(700));
    }
}

pub fn input_fence(report: &[u8]) -> Option<u32> {
    (report.len() >= 8 && report[0] == 1).then(|| u32::from_le_bytes([report[4], report[5], report[6], report[7]]))
}

fn read_loop(app: &AppHandle, device: HidDevice, fence: &Fence, broken: &AtomicBool) {
    let mut buf = [0u8; 64];
    let mut previous: u16 = 0;
    let mut errors = None;
    while !broken.load(Ordering::Relaxed) {
        match device.read_timeout(&mut buf, 250) {
            Ok(0) => continue,
            Ok(n) if n >= 3 && buf[0] == 1 => {
                if let Some(id) = input_fence(&buf[..n]) {
                    fence.update(id);
                }
                if n > 8 {
                    if errors.is_some_and(|e| e != buf[8]) {
                        eprintln!("deck: stream error, counter {}", buf[8]);
                        fence.fail();
                    }
                    errors = Some(buf[8]);
                }
                let keys = u16::from_le_bytes([buf[1], buf[2]]) & 0x7fff;
                let changed = keys ^ previous;
                for index in 0..15u8 {
                    if changed & (1 << index) != 0 {
                        let pressed = keys & (1 << index) != 0;
                        let _ = app.emit("deck-key", KeyEvent { index, pressed });
                    }
                }
                previous = keys;
            }
            Ok(_) => continue,
            Err(e) => {
                eprintln!("deck: read failed: {e}");
                return;
            }
        }
    }
}

fn write_loop(device: HidDevice, rx: Receiver<Vec<u8>>, broken: &AtomicBool) {
    while let Ok(mut stream) = rx.recv() {
        let mut starts = vec![0usize];
        while let Ok(more) = rx.try_recv() {
            starts.push(stream.len());
            stream.extend_from_slice(&more);
            if stream.len() > 256 * 1024 {
                break;
            }
        }
        if let Err(e) = write_stream(&device, &stream, &starts) {
            eprintln!("deck: write failed: {e}");
            broken.store(true, Ordering::Relaxed);
            return;
        }
    }
}

pub fn write_stream(device: &HidDevice, stream: &[u8], starts: &[usize]) -> hidapi::HidResult<()> {
    let mut report = [0u8; REPORT];
    let mut offset = 0;
    while offset < stream.len() {
        let n = PAYLOAD.min(stream.len() - offset);
        let sync = starts.binary_search(&offset).is_ok();
        let len = n as u16 | if sync { SYNC } else { 0 };
        report[0] = 2;
        report[1..3].copy_from_slice(&len.to_le_bytes());
        report[3..3 + n].copy_from_slice(&stream[offset..offset + n]);
        report[3 + n..].fill(0);
        device.write(&report)?;
        offset += n;
    }
    Ok(())
}

impl crate::bench::Link for Deck {
    fn draw(&self, bytes: Vec<u8>, timeout: Duration) -> Result<(), String> {
        Deck::draw(self, bytes, timeout)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_draw_stops_waiting() {
        let fence = Fence::default();
        fence.reset();
        let (first, a) = fence.issue();
        let (_, b) = fence.issue();
        fence.update(first);
        fence.fail();
        let started = Instant::now();
        assert!(fence.wait(a, Duration::from_secs(5)));
        assert!(!fence.wait(b, Duration::from_secs(5)));
        assert!(started.elapsed() < Duration::from_secs(1));
        let (third, c) = fence.issue();
        fence.update(third);
        assert!(fence.wait(c, Duration::from_millis(10)));
    }
}
