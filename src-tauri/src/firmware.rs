use hidapi::{HidApi, HidDevice};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

const LOADER: (u16, u16) = (0xeeef, 0x2929);
const OSD: (u16, u16) = (0x1209, 0x0001);
const STOCK: (u16, u16) = (0x0300, 0x1020);
const STOCK_USAGE_PAGE: u16 = 0xffa0;
const OSD_USAGE_PAGE: u16 = 0xff00;
const OSD_REPORT: usize = 1024;
const APP_LIMIT: usize = 96_496;
const APP_BASE: u32 = 0x0800_4000;
const CHUNK: usize = 60;
const ATTEMPTS: usize = 3;
const OSD_BOOT: &[u8; 9] = b"\x0aOSDBOOT!";

static BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
pub struct Progress {
    pub stage: &'static str,
    pub percent: u8,
    pub message: String,
}

#[derive(Clone, Serialize)]
pub struct Probe {
    pub mode: &'static str,
    pub version: String,
}

#[derive(Serialize)]
pub struct Outcome {
    pub mode: &'static str,
    pub version: String,
    pub bytes: usize,
    pub crc: String,
}

struct Image {
    bytes: Vec<u8>,
    crc: u16,
}

pub fn crc16_arc(data: &[u8]) -> u16 {
    let mut crc = 0u16;
    for &byte in data {
        crc ^= byte as u16;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xa001 } else { crc >> 1 };
        }
    }
    crc
}

fn load(path: &str) -> Result<Image, String> {
    let mut bytes = std::fs::read(path)
        .map_err(|e| tr!("Не удалось прочитать файл: {}", "Couldn't read the file: {}", "无法读取文件：{}", e))?;
    if bytes.len() < 8 {
        return Err(tr!(
            "Файл слишком маленький для прошивки",
            "The file is too small to be firmware",
            "文件太小，不是有效的固件"
        ));
    }
    if bytes.len() > APP_LIMIT {
        return Err(tr!(
            "Файл {} байт, а область прошивки вмещает {}",
            "The file is {} bytes, but the firmware area holds {}",
            "文件大小为 {} 字节，而固件区域仅能容纳 {} 字节",
            bytes.len(),
            APP_LIMIT
        ));
    }
    let sp = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
    let reset = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    let end = APP_BASE + bytes.len() as u32;
    if !(0x2000_0000..=0x2010_0000).contains(&sp) || reset & 1 == 0 || !(APP_BASE..end).contains(&(reset & !1)) {
        return Err(tr!(
            "Файл не похож на прошивку AKP153R (неверная таблица векторов)",
            "This doesn't look like AKP153R firmware (invalid vector table)",
            "该文件不像 AKP153R 固件（向量表无效）"
        ));
    }
    while bytes.len() % 4 != 0 {
        bytes.push(0xff);
    }
    let crc = crc16_arc(&bytes);
    Ok(Image { bytes, crc })
}

fn find(api: &HidApi, (vid, pid): (u16, u16), usage_page: Option<u16>) -> Option<HidDevice> {
    api.device_list()
        .find(|d| d.vendor_id() == vid && d.product_id() == pid && usage_page.is_none_or(|u| d.usage_page() == u))
        .and_then(|d| d.open_device(api).ok())
}

fn present(api: &HidApi, (vid, pid): (u16, u16)) -> bool {
    api.device_list().any(|d| d.vendor_id() == vid && d.product_id() == pid)
}

fn mode(api: &HidApi) -> &'static str {
    if present(api, LOADER) {
        "loader"
    } else if present(api, OSD) {
        "osd"
    } else if present(api, STOCK) {
        "stock"
    } else {
        "none"
    }
}

struct OsdInfo {
    version: String,
    boot: bool,
}

fn osd_info(api: &HidApi) -> Option<OsdInfo> {
    let device = find(api, OSD, Some(OSD_USAGE_PAGE))?;
    let mut feature = [0u8; 32];
    feature[0] = 3;
    let n = device.get_feature_report(&mut feature).ok()?;
    (n >= 18 && &feature[1..5] == b"OSD1").then(|| OsdInfo {
        version: format!("{}.{}.{}", feature[6], feature[7], feature[8]),
        boot: feature[17] & 1 != 0,
    })
}

pub fn probe() -> Probe {
    let Ok(api) = HidApi::new() else {
        return Probe { mode: "none", version: String::new() };
    };
    let mode = mode(&api);
    let version = if mode == "osd" { osd_info(&api).map(|i| i.version).unwrap_or_default() } else { String::new() };
    Probe { mode, version }
}

fn enter_loader(api: &HidApi) -> Result<(), String> {
    match mode(api) {
        "loader" => Ok(()),
        "osd" => {
            let info = osd_info(api).ok_or_else(|| {
                tr!(
                    "Не удалось прочитать версию прошивки Open Stream Deck",
                    "Couldn't read the Open Stream Deck firmware version",
                    "无法读取 Open Stream Deck 固件版本"
                )
            })?;
            if !info.boot {
                return Err(tr!(
                    "Прошивка {} не умеет переходить в режим прошивки. Один раз переведите деку вручную (замкните контакты при подключении) и нажмите «Установить» снова",
                    "Firmware {} can't switch to update mode by itself. Put the deck into update mode manually once (short the contacts while plugging it in) and click Install again",
                    "固件 {} 无法自动进入更新模式。请手动让设备进入更新模式一次（插入 USB 时短接触点），然后再次点击“安装”",
                    info.version
                ));
            }
            let device = find(api, OSD, Some(OSD_USAGE_PAGE)).ok_or_else(|| {
                tr!(
                    "Не удалось открыть деку Open Stream Deck",
                    "Couldn't open the Open Stream Deck device",
                    "无法打开 Open Stream Deck 设备"
                )
            })?;
            let mut report = [0u8; OSD_REPORT];
            report[0] = 2;
            report[1..3].copy_from_slice(&(OSD_BOOT.len() as u16 | 0x8000).to_le_bytes());
            report[3..3 + OSD_BOOT.len()].copy_from_slice(OSD_BOOT);
            device.write(&report).map_err(|e| {
                tr!(
                    "Дека не приняла команду перехода: {}",
                    "The deck rejected the switch command: {}",
                    "设备未接受切换命令：{}",
                    e
                )
            })?;
            Ok(())
        }
        "stock" => {
            let device = find(api, STOCK, Some(STOCK_USAGE_PAGE)).ok_or_else(|| {
                tr!(
                    "Не удалось открыть деку со стоковой прошивкой",
                    "Couldn't open the deck with stock firmware",
                    "无法打开运行原厂固件的设备"
                )
            })?;
            let mut report = [0u8; 513];
            report[1..4].copy_from_slice(b"CRT");
            report[6..12].copy_from_slice(b"APPNEW");
            device.write(&report).map_err(|e| {
                tr!(
                    "Стоковая прошивка не приняла команду: {}",
                    "The stock firmware rejected the command: {}",
                    "原厂固件未接受命令：{}",
                    e
                )
            })?;
            Ok(())
        }
        _ => Err(tr!(
            "Дека не найдена. Подключите её по USB",
            "Deck not found. Connect it via USB",
            "未找到设备，请通过 USB 连接"
        )),
    }
}

fn wait_for<F: Fn(&HidApi) -> bool>(api: &mut HidApi, timeout: Duration, ready: F) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        let _ = api.refresh_devices();
        if ready(api) {
            return true;
        }
        thread::sleep(Duration::from_millis(200));
    }
    false
}

fn transact(device: &HidDevice, packet: &[u8; 64], timeout: Duration) -> Result<[u8; 64], String> {
    let op = packet[3];
    let mut report = [0u8; 65];
    report[1..].copy_from_slice(packet);
    device
        .write(&report)
        .map_err(|e| tr!("запись команды {:02X}: {}", "sending command {:02X}: {}", "发送命令 {:02X}：{}", op, e))?;
    let start = Instant::now();
    let mut answer = [0u8; 64];
    while start.elapsed() < timeout {
        let left = timeout.saturating_sub(start.elapsed()).as_millis().max(1) as i32;
        let n = device
            .read_timeout(&mut answer, left)
            .map_err(|e| tr!("ответ на {:02X}: {}", "reply to {:02X}: {}", "命令 {:02X} 的响应：{}", op, e))?;
        if n >= 4 && answer[3] == op {
            return Ok(answer);
        }
    }
    Err(tr!(
        "загрузчик не ответил на команду {:02X}",
        "the loader didn't answer command {:02X}",
        "引导程序未响应命令 {:02X}",
        op
    ))
}

fn transfer(device: &HidDevice, image: &Image, report: &dyn Fn(&'static str, u8, String)) -> Result<(), String> {
    let mut drain = [0u8; 64];
    while matches!(device.read_timeout(&mut drain, 0), Ok(n) if n > 0) {}

    report("erase", 0, tr!("Подготовка памяти", "Preparing memory", "正在准备存储区"));
    let mut start = [0u8; 64];
    start[3] = 0xd2;
    start[8..12].copy_from_slice(&(image.bytes.len() as u32).to_le_bytes());
    transact(device, &start, Duration::from_secs(10))?;

    let chunks = image.bytes.len().div_ceil(CHUNK);
    let mut last = u8::MAX;
    for (i, chunk) in image.bytes.chunks(CHUNK).enumerate() {
        let offset = (i * CHUNK) as u32;
        let mut packet = [0xffu8; 64];
        packet[0..3].copy_from_slice(&offset.to_le_bytes()[0..3]);
        packet[3] = 0xd1;
        packet[4..4 + chunk.len()].copy_from_slice(chunk);
        transact(device, &packet, Duration::from_secs(2))?;
        let percent = ((i + 1) * 100 / chunks) as u8;
        if percent != last {
            last = percent;
            report(
                "write",
                percent,
                tr!(
                    "Запись {} из {} КБ",
                    "Writing {} of {} KB",
                    "正在写入 {} / {} KB",
                    (offset as usize + chunk.len()) / 1024,
                    image.bytes.len() / 1024
                ),
            );
        }
    }

    report("verify", 100, tr!("Проверка контрольной суммы", "Verifying the checksum", "正在校验"));
    let mut check = [0u8; 64];
    check[3] = 0xd3;
    check[4..8].copy_from_slice(&((image.bytes.len() / 4) as u32).to_le_bytes());
    check[8..12].copy_from_slice(&(image.crc as u32).to_le_bytes());
    let answer = transact(device, &check, Duration::from_secs(5))?;
    let crc = u32::from_le_bytes(answer[4..8].try_into().unwrap());
    if crc != image.crc as u32 {
        return Err(tr!(
            "контрольная сумма не совпала: дека {:04X}, файл {:04X}",
            "checksum mismatch: deck {:04X}, file {:04X}",
            "校验和不匹配：设备 {:04X}，文件 {:04X}",
            crc,
            image.crc
        ));
    }
    Ok(())
}

fn restart(device: &HidDevice) {
    let mut report = [0u8; 65];
    report[4] = 0xaa;
    report[5] = 0x02;
    let _ = device.write(&report);
}

fn run(path: &str, progress: &dyn Fn(Progress)) -> Result<Outcome, String> {
    let report = |stage: &'static str, percent: u8, message: String| progress(Progress { stage, percent, message });
    let image = load(path)?;
    let mut api = HidApi::new().map_err(|e| e.to_string())?;

    report(
        "switch",
        0,
        tr!("Перевод деки в режим прошивки", "Switching the deck to update mode", "正在将设备切换到更新模式"),
    );
    enter_loader(&api)?;
    if !wait_for(&mut api, Duration::from_secs(15), |api| present(api, LOADER)) {
        return Err(tr!(
            "Дека не перешла в режим прошивки. Переведите её вручную (замкните контакты при подключении) и повторите",
            "The deck didn't switch to update mode. Put it into update mode manually (short the contacts while plugging it in) and try again",
            "设备未进入更新模式。请手动让设备进入更新模式（插入 USB 时短接触点）后重试"
        ));
    }
    thread::sleep(Duration::from_millis(500));
    let _ = api.refresh_devices();

    let mut failure = String::new();
    for attempt in 1..=ATTEMPTS {
        let device = find(&api, LOADER, None)
            .ok_or_else(|| tr!("Не удалось открыть загрузчик", "Couldn't open the loader", "无法打开引导程序"))?;
        match transfer(&device, &image, &report) {
            Ok(()) => {
                restart(&device);
                drop(device);
                failure.clear();
                break;
            }
            Err(e) => {
                failure = e;
                report(
                    "retry",
                    0,
                    tr!("Попытка {} не удалась: {}", "Attempt {} failed: {}", "第 {} 次尝试失败：{}", attempt, failure),
                );
                thread::sleep(Duration::from_millis(500));
                let _ = api.refresh_devices();
            }
        }
    }
    if !failure.is_empty() {
        return Err(tr!(
            "Прошивка не записана: {}. Дека осталась в режиме прошивки, можно повторить",
            "The firmware wasn't written: {}. The deck is still in update mode, so you can try again",
            "固件未写入：{}。设备仍处于更新模式，可以重试",
            failure
        ));
    }

    report(
        "replug",
        100,
        tr!(
            "Прошивка записана. Переподключите деку",
            "Firmware written. Reconnect the deck",
            "固件已写入，请重新连接设备"
        ),
    );
    let running = |api: &HidApi| !present(api, LOADER) && (present(api, OSD) || present(api, STOCK));
    if !wait_for(&mut api, Duration::from_secs(180), running) {
        return Err(tr!(
            "Прошивка записана, но дека не подключилась за 3 минуты. Переподключите USB-кабель деки",
            "The firmware was written, but the deck didn't reconnect within 3 minutes. Replug the deck's USB cable",
            "固件已写入，但设备在 3 分钟内未重新连接。请重新插拔设备的 USB 线"
        ));
    }
    let mode = mode(&api);
    let mut version = String::new();
    if mode == "osd" {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(5) {
            if let Some(info) = osd_info(&api) {
                version = info.version;
                break;
            }
            thread::sleep(Duration::from_millis(300));
            let _ = api.refresh_devices();
        }
    }
    report("done", 100, tr!("Готово", "Done", "完成"));
    Ok(Outcome { mode, version, bytes: image.bytes.len(), crc: format!("{:04X}", image.crc) })
}

pub fn flash(path: &str, progress: &dyn Fn(Progress)) -> Result<Outcome, String> {
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err(tr!("Прошивка уже выполняется", "A firmware update is already in progress", "固件更新正在进行中"));
    }
    let result = run(path, progress);
    BUSY.store(false, Ordering::SeqCst);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc16_arc_check_value() {
        assert_eq!(crc16_arc(b"123456789"), 0xbb3d);
    }
}
