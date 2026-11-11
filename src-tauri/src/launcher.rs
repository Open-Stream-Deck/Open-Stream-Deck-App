use std::sync::{Mutex, mpsc};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use velopack::sources::HttpSource;
use velopack::{UpdateCheck, UpdateInfo, UpdateManager};

const FEEDS: [&str; 2] = [
    "https://dl.opensd.dev/v1/app",
    "https://github.com/Open-Stream-Deck/Open-Stream-Deck-App/releases/latest/download",
];

type Update = (UpdateManager, UpdateInfo);

#[derive(Default)]
pub struct Launcher {
    steps: Mutex<Steps>,
    pending: Mutex<Option<Update>>,
}

#[derive(Default)]
struct Steps {
    checked: bool,
    ready: bool,
}

#[tauri::command]
pub fn launcher(app: AppHandle, window: WebviewWindow, message: &str) {
    match message {
        "check" => check(app),
        "skip" => advance(&app, |steps| steps.checked = true),
        "ready" if window.label() == "main" => advance(&app, |steps| steps.ready = true),
        "drag" => {
            window.start_dragging().ok();
        }
        "done" => launch(&app),
        "close" => crate::tray::quit(&app),
        _ => {}
    }
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<String>, String> {
    let update =
        tauri::async_runtime::spawn_blocking(find).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    let version = update.as_ref().map(|(_, info)| info.TargetFullRelease.Version.clone());
    *app.state::<Launcher>().pending.lock().unwrap() = update;
    Ok(version)
}

#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let (manager, info) = app.state::<Launcher>().pending.lock().unwrap().take().ok_or("No update")?;
    tauri::async_runtime::spawn_blocking(move || {
        download(&manager, &info, |percent| {
            app.emit("update://progress", percent).ok();
        })?;
        manager.apply_updates_and_restart(&info)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

fn check(app: AppHandle) {
    thread::spawn(move || {
        #[cfg(target_os = "linux")]
        udev(&app);
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            sender.send(find().ok().flatten()).ok();
        });
        if let Ok(Some((manager, info))) = receiver.recv_timeout(Duration::from_secs(10)) {
            let splash = app.get_webview_window("splash");
            let eval = |script: &str| {
                if let Some(splash) = &splash {
                    splash.eval(script).ok();
                }
            };
            download(&manager, &info, |percent| eval(&format!("progress({})", percent as f64 / 100.0)))
                .and_then(|_| {
                    eval("installing()");
                    manager.apply_updates_and_restart(&info)
                })
                .ok();
        }
        advance(&app, |steps| steps.checked = true);
    });
}

fn find() -> Result<Option<Update>, velopack::Error> {
    let custom = std::env::var("OSD_UPDATE_FEED").ok();
    let feeds = custom.as_deref().map_or(FEEDS.to_vec(), |feed| vec![feed]);
    feeds[1..].iter().fold(find_in(feeds[0]), |found, feed| found.or_else(|_| find_in(feed)))
}

fn find_in(feed: &str) -> Result<Option<Update>, velopack::Error> {
    let manager = UpdateManager::new(HttpSource::new(feed), None, None)?;
    Ok(match manager.check_for_updates()? {
        UpdateCheck::UpdateAvailable(info) => Some((manager, *info)),
        _ => None,
    })
}

fn download(manager: &UpdateManager, info: &UpdateInfo, progress: impl Fn(i16) + Sync) -> Result<(), velopack::Error> {
    let (sender, receiver) = mpsc::channel();
    thread::scope(|scope| {
        let progress = &progress;
        scope.spawn(move || receiver.iter().for_each(progress));
        manager.download_updates(info, Some(sender))
    })
}

#[cfg(target_os = "linux")]
fn udev(app: &AppHandle) {
    const RULES: &str = include_str!("../linux/70-open-stream-deck.rules");
    const PATHS: [&str; 2] =
        ["/etc/udev/rules.d/70-open-stream-deck.rules", "/usr/lib/udev/rules.d/70-open-stream-deck.rules"];
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let asked = dir.join("udev-asked");
    if asked.exists() || PATHS.iter().any(|path| std::path::Path::new(path).exists()) {
        return;
    }
    std::fs::create_dir_all(&dir).ok();
    std::fs::write(&asked, b"").ok();
    let script = format!(
        "printf '%s' \"$0\" > {} && udevadm control --reload-rules && udevadm trigger --subsystem-match=hidraw",
        PATHS[0]
    );
    std::process::Command::new("pkexec").args(["sh", "-c", &script, RULES]).status().ok();
}

fn advance(app: &AppHandle, step: impl FnOnce(&mut Steps)) {
    let launcher = app.state::<Launcher>();
    let mut steps = launcher.steps.lock().unwrap();
    step(&mut steps);
    if !(steps.checked && steps.ready) {
        return;
    }
    match app.get_webview_window("splash") {
        Some(splash) => {
            splash.eval("done()").ok();
        }
        None => launch(app),
    }
}

fn launch(app: &AppHandle) {
    if !app.state::<crate::tray::Behavior>().starts_hidden() {
        crate::tray::show(app);
    }
    if let Some(splash) = app.get_webview_window("splash") {
        splash.close().ok();
    }
}
