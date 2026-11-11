#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    velopack::VelopackApp::build().run();
    open_stream_deck_lib::run()
}
