use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Window, WindowEvent};

const QUIT_GRACE: Duration = Duration::from_secs(2);

#[derive(Default)]
pub struct Behavior {
    tray: AtomicBool,
    hidden: AtomicBool,
}

impl Behavior {
    pub fn starts_hidden(&self) -> bool {
        self.hidden.load(Ordering::Relaxed)
    }
}

pub fn show(app: &AppHandle) {
    app.state::<Behavior>().hidden.store(false, Ordering::Relaxed);
    if let Some(main) = app.get_webview_window("main") {
        main.show().ok();
        main.unminimize().ok();
        main.set_focus().ok();
    }
}

pub fn quit(app: &AppHandle) {
    if app.emit_to("main", "app-quit", ()).is_err() {
        app.exit(0);
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(QUIT_GRACE);
        app.exit(0);
    });
}

pub fn setup(app: &AppHandle, hidden: bool) -> tauri::Result<()> {
    app.manage(Behavior { tray: AtomicBool::new(true), hidden: AtomicBool::new(hidden) });
    let open = MenuItem::with_id(app, "open", tr!("Открыть", "Open", "打开"), true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "quit", tr!("Выход", "Quit", "退出"), true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &exit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Open Stream Deck")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if window.label() != "main" {
        return;
    }
    api.prevent_close();
    if window.app_handle().state::<Behavior>().tray.load(Ordering::Relaxed) {
        window.hide().ok();
    } else {
        quit(window.app_handle());
    }
}

#[cfg(target_os = "macos")]
pub fn on_run_event(app: &AppHandle, event: tauri::RunEvent) {
    if let tauri::RunEvent::Reopen { .. } = event {
        show(app);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn on_run_event(_: &AppHandle, _: tauri::RunEvent) {}

#[tauri::command]
pub fn app_behavior(app: AppHandle, tray: bool, autostart: bool) -> Result<(), String> {
    app.state::<Behavior>().tray.store(tray, Ordering::Relaxed);
    if cfg!(debug_assertions) {
        return Ok(());
    }
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    if launcher.is_enabled().unwrap_or(false) == autostart {
        return Ok(());
    }
    if autostart { launcher.enable() } else { launcher.disable() }.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_exit(app: AppHandle) {
    app.exit(0);
}
