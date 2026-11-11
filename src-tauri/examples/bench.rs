use hidapi::HidDevice;
use open_stream_deck_lib::bench::{self, Link};
use open_stream_deck_lib::deck;
use std::cell::Cell;
use std::time::{Duration, Instant};

struct Direct {
    reader: HidDevice,
    writer: HidDevice,
    id: Cell<u32>,
}

impl Link for Direct {
    fn draw(&self, mut bytes: Vec<u8>, timeout: Duration) -> Result<(), String> {
        let id = self.id.get().wrapping_add(1);
        self.id.set(id);
        bytes.push(deck::FENCE);
        bytes.extend_from_slice(&id.to_le_bytes());
        deck::write_stream(&self.writer, &bytes, &[0]).map_err(|e| e.to_string())?;
        let deadline = Instant::now() + timeout;
        let mut buf = [0u8; 64];
        while Instant::now() < deadline {
            let n = self.reader.read_timeout(&mut buf, 50).map_err(|e| e.to_string())?;
            if deck::input_fence(&buf[..n]) == Some(id) {
                return Ok(());
            }
        }
        Err("fence timeout".into())
    }
}

fn main() {
    let Some((reader, writer)) = deck::connect() else {
        eprintln!("deck not found");
        std::process::exit(1);
    };
    let link = Direct { reader, writer, id: Cell::new(0x0b00_0000 ^ std::process::id()) };
    let r = bench::run(&link).unwrap();
    let mb = |v: f64| v / 1_000_000.0;
    println!("fence latency   {:.2} ms", r.latency_ms);
    println!("usb (NOP)       {:.2} MB/s", mb(r.usb));
    println!("blit screen     {:.2} MB/s", mb(r.screen));
    println!("blit 103x103    {:.2} MB/s, {:.1} ms per key, {:.0} keys/s", mb(r.keys), r.key_ms, 1000.0 / r.key_ms);
}
