use open_stream_deck_lib::firmware;

fn main() {
    let probe = firmware::probe();
    println!("deck: {} {}", probe.mode, probe.version);
    let Some(path) = std::env::args().nth(1) else { return };
    let result = firmware::flash(&path, &|p| println!("[{:>3}%] {}: {}", p.percent, p.stage, p.message));
    match result {
        Ok(o) => println!("ok: {} {} ({} bytes, CRC {})", o.mode, o.version, o.bytes, o.crc),
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1);
        }
    }
}
