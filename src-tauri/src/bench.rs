use serde::Serialize;
use std::time::{Duration, Instant};

const SCRATCH: u32 = 0x60_0000;
const WIDTH: u16 = 480;
const HEIGHT: u16 = 854;
const KEY: u16 = 103;
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bench {
    pub latency_ms: f64,
    pub usb: f64,
    pub screen: f64,
    pub keys: f64,
    pub key_ms: f64,
}

pub trait Link {
    fn draw(&self, bytes: Vec<u8>, timeout: Duration) -> Result<(), String>;
}

pub fn run(link: &impl Link) -> Result<Bench, String> {
    let start = Instant::now();
    for _ in 0..20 {
        link.draw(Vec::new(), TIMEOUT)?;
    }
    let latency_ms = start.elapsed().as_secs_f64() * 1000.0 / 20.0;
    let usb = rate(link, vec![0; 2 << 20])?;
    let screen = rate(link, blits(2, WIDTH, HEIGHT))?;
    let keys = rate(link, blits(60, KEY, KEY))?;
    link.draw(canvas(0), TIMEOUT)?;
    let key_ms = (KEY as f64 * KEY as f64 * 2.0 + 9.0) / keys * 1000.0;
    Ok(Bench { latency_ms, usb, screen, keys, key_ms })
}

fn rate(link: &impl Link, bytes: Vec<u8>) -> Result<f64, String> {
    let size = bytes.len() as f64;
    let start = Instant::now();
    link.draw(bytes, TIMEOUT)?;
    Ok(size / start.elapsed().as_secs_f64())
}

fn canvas(address: u32) -> Vec<u8> {
    let mut bytes = vec![0x01];
    bytes.extend_from_slice(&address.to_le_bytes());
    bytes
}

fn blits(count: usize, w: u16, h: u16) -> Vec<u8> {
    let mut bytes = canvas(SCRATCH);
    for i in 0..count {
        bytes.push(0x02);
        for v in [0, 0, w, h] {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        let color = (i as u16).wrapping_mul(0x1234).to_le_bytes();
        bytes.extend(std::iter::repeat_n(color, w as usize * h as usize).flatten());
    }
    bytes
}
