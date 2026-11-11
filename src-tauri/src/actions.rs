use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::collections::HashMap;
use std::process::Command;
use std::sync::OnceLock;
use std::sync::mpsc::{Sender, channel};

type Fields = HashMap<String, serde_json::Value>;

fn field<'a>(fields: &'a Fields, id: &str) -> &'a str {
    fields.get(id).and_then(|v| v.as_str()).unwrap_or("")
}

fn flag(fields: &Fields, id: &str) -> bool {
    fields.get(id).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn enigo() -> Result<Enigo, String> {
    Enigo::new(&Settings::default()).map_err(|e| e.to_string())
}

fn tap(key: Key) -> Result<(), String> {
    enigo()?.key(key, Direction::Click).map_err(|e| e.to_string())
}

const FUNCTION_KEYS: [Key; 20] = [
    Key::F1,
    Key::F2,
    Key::F3,
    Key::F4,
    Key::F5,
    Key::F6,
    Key::F7,
    Key::F8,
    Key::F9,
    Key::F10,
    Key::F11,
    Key::F12,
    Key::F13,
    Key::F14,
    Key::F15,
    Key::F16,
    Key::F17,
    Key::F18,
    Key::F19,
    Key::F20,
];

fn key_from_token(token: &str) -> Option<Key> {
    let lower = token.to_lowercase();
    if let Some(n) = lower.strip_prefix('f').and_then(|n| n.parse::<usize>().ok()).filter(|n| (1..=20).contains(n)) {
        return Some(FUNCTION_KEYS[n - 1]);
    }
    Some(match lower.as_str() {
        "ctrl" | "control" => Key::Control,
        "shift" => Key::Shift,
        "alt" => Key::Alt,
        "win" | "cmd" | "super" | "meta" => Key::Meta,
        "space" => Key::Space,
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "esc" | "escape" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "↑" | "up" => Key::UpArrow,
        "↓" | "down" => Key::DownArrow,
        "←" | "left" => Key::LeftArrow,
        "→" | "right" => Key::RightArrow,
        t if t.chars().count() == 1 => letter(token.chars().next()?),
        _ => return None,
    })
}

#[cfg(windows)]
fn letter(c: char) -> Key {
    if c.is_ascii_alphanumeric() { Key::Other(c.to_ascii_uppercase() as u32) } else { Key::Unicode(c) }
}

#[cfg(not(windows))]
fn letter(c: char) -> Key {
    Key::Unicode(c.to_ascii_lowercase())
}

pub fn combo(text: &str) -> Result<Vec<Key>, String> {
    let tokens: Vec<&str> = if text.contains(" + ") { text.split(" + ").collect() } else { text.split('+').collect() };
    let keys: Vec<Key> = tokens
        .iter()
        .filter(|t| !t.trim().is_empty())
        .map(|t| {
            key_from_token(t.trim()).ok_or_else(|| tr!("Неизвестная клавиша: {}", "Unknown key: {}", "未知按键：{}", t))
        })
        .collect::<Result<_, _>>()?;
    if keys.is_empty() {
        return Err(tr!("Сочетание не задано", "No key combination set", "未设置组合键"));
    }
    Ok(keys)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Stroke {
    Press,
    Down,
    Up,
}

pub fn strike(keys: &[Key], stroke: Stroke) -> Result<(), String> {
    let mut e = enigo()?;
    let Some((last, modifiers)) = keys.split_last() else { return Ok(()) };
    match stroke {
        Stroke::Down => keys.iter().try_for_each(|k| e.key(*k, Direction::Press)).map_err(|e| e.to_string()),
        Stroke::Up => keys.iter().rev().try_for_each(|k| e.key(*k, Direction::Release)).map_err(|e| e.to_string()),
        Stroke::Press => {
            for k in modifiers {
                e.key(*k, Direction::Press).map_err(|e| e.to_string())?;
            }
            let result = e.key(*last, Direction::Click).map_err(|e| e.to_string());
            for k in modifiers.iter().rev() {
                let _ = e.key(*k, Direction::Release);
            }
            result
        }
    }
}

pub fn type_text(text: &str) -> Result<(), String> {
    enigo()?.text(text).map_err(|e| e.to_string())
}

type Job = Box<dyn FnOnce() + Send>;

pub fn queue(job: impl FnOnce() + Send + 'static) {
    static QUEUE: OnceLock<Sender<Job>> = OnceLock::new();
    let sender = QUEUE.get_or_init(|| {
        let (tx, rx) = channel::<Job>();
        std::thread::spawn(move || rx.into_iter().for_each(|job| job()));
        tx
    });
    let _ = sender.send(Box::new(job));
}

fn hotkey(text: &str) -> Result<(), String> {
    strike(&combo(text)?, Stroke::Press)
}

#[cfg(windows)]
const BROWSERS: [(&str, &str); 3] = [("chrome", "chrome"), ("firefox", "firefox"), ("edge", "msedge")];
#[cfg(target_os = "macos")]
const BROWSERS: [(&str, &str); 3] = [("chrome", "Google Chrome"), ("firefox", "Firefox"), ("edge", "Microsoft Edge")];
#[cfg(all(unix, not(target_os = "macos")))]
const BROWSERS: [(&str, &str); 3] = [("chrome", "google-chrome"), ("firefox", "firefox"), ("edge", "microsoft-edge")];

#[cfg(not(target_os = "linux"))]
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    Command::new(program)
}

#[cfg(target_os = "linux")]
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    let Some(dir) = std::env::var("APPDIR").ok().filter(|dir| !dir.is_empty()) else {
        return command;
    };
    for (key, value) in std::env::vars_os() {
        let value = value.to_string_lossy();
        if !value.contains(&dir) {
            continue;
        }
        let kept: Vec<&str> = value.split(':').filter(|part| !part.contains(&dir)).collect();
        if kept.is_empty() {
            command.env_remove(&key);
        } else {
            command.env(&key, kept.join(":"));
        }
    }
    for key in ["APPIMAGE", "ARGV0", "OWD", "GDK_BACKEND", "GTK_THEME"] {
        command.env_remove(key);
    }
    command
}

#[cfg(target_os = "linux")]
pub fn open_url(url: &str, with: Option<&str>) -> Result<(), String> {
    command(with.unwrap_or("xdg-open")).arg(url).spawn().map(drop).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "linux"))]
pub fn open_url(url: &str, with: Option<&str>) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, with).map_err(|e| e.to_string())
}

fn launch(path: &str, args: &str) -> Result<(), String> {
    let mut command = if cfg!(target_os = "macos") && path.trim_end_matches('/').ends_with(".app") {
        let mut open = Command::new("open");
        open.args(["-a", path, "--args"]);
        open
    } else {
        command(path)
    };
    command.args(args.split_whitespace()).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn focus(path: &str) -> bool {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    struct Search {
        pids: Vec<u32>,
        found: HWND,
    }

    unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> windows_sys::core::BOOL {
        let search = unsafe { &mut *(data as *mut Search) };
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        let main = unsafe {
            IsWindowVisible(hwnd) != 0 && GetWindow(hwnd, GW_OWNER).is_null() && GetWindowTextLengthW(hwnd) > 0
        };
        if main && search.pids.contains(&pid) {
            search.found = hwnd;
            return 0;
        }
        1
    }

    let pids: Vec<u32> = crate::procs::find(std::path::Path::new(path)).into_iter().map(|(pid, _)| pid).collect();
    if pids.is_empty() {
        return false;
    }
    let mut search = Search { pids, found: null_mut() };
    unsafe { EnumWindows(Some(visit), &mut search as *mut Search as LPARAM) };
    let hwnd = search.found;
    if hwnd.is_null() {
        return false;
    }
    unsafe {
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        }
        let current = GetCurrentThreadId();
        let foreground = GetWindowThreadProcessId(GetForegroundWindow(), null_mut());
        let attached = foreground != current && AttachThreadInput(current, foreground, 1) != 0;
        BringWindowToTop(hwnd);
        let ok = SetForegroundWindow(hwnd) != 0;
        if attached {
            AttachThreadInput(current, foreground, 0);
        }
        ok
    }
}

#[cfg(not(windows))]
fn focus(_path: &str) -> bool {
    false
}

#[cfg(any(windows, all(unix, not(target_os = "macos"))))]
fn exec(program: &str, args: &[&str]) -> Result<(), String> {
    match command(program).args(args).status() {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("{program}: {status}")),
        Err(e) => Err(format!("{program}: {e}")),
    }
}

#[cfg(windows)]
fn lock() -> Result<(), String> {
    exec("rundll32.exe", &["user32.dll,LockWorkStation"])
}

#[cfg(target_os = "macos")]
fn lock() -> Result<(), String> {
    hotkey("Ctrl + Cmd + Q")
}

#[cfg(all(unix, not(target_os = "macos")))]
fn lock() -> Result<(), String> {
    exec("loginctl", &["lock-session"]).or_else(|_| exec("xdg-screensaver", &["lock"]))
}

pub fn run(plugin: &str, action: &str, fields: &Fields) -> Result<(), String> {
    match (plugin, action) {
        ("system", "open-url") => {
            let url = field(fields, "url");
            if url.is_empty() {
                return Err(tr!("Адрес не задан", "No URL set", "未设置网址"));
            }
            let browser = field(fields, "browser");
            let with = BROWSERS.iter().find(|(id, _)| *id == browser).map(|(_, app)| *app);
            open_url(url, with)
        }
        ("system", "open-app") => {
            let path = field(fields, "path");
            if path.is_empty() {
                return Err(tr!("Приложение не выбрано", "No application selected", "未选择应用程序"));
            }
            if flag(fields, "focus") && focus(path) {
                return Ok(());
            }
            launch(path, field(fields, "args"))
        }
        ("system", "hotkey") => hotkey(field(fields, "keys")),
        ("system", "text") => {
            let mut e = enigo()?;
            e.text(field(fields, "text")).map_err(|e| e.to_string())?;
            if flag(fields, "enter") {
                e.key(Key::Return, Direction::Click).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        ("system", "lock") => lock(),
        ("media", "play-pause") => crate::media::play_pause().or_else(|_| tap(Key::MediaPlayPause)),
        ("media", "next") => crate::media::skip(true).or_else(|_| tap(Key::MediaNextTrack)),
        ("media", "prev") => crate::media::skip(false).or_else(|_| tap(Key::MediaPrevTrack)),
        ("media", "mute") => crate::media::toggle_mute().or_else(|_| tap(Key::VolumeMute)),
        ("media", "volume-up") | ("media", "volume-down") => {
            let step: u32 = field(fields, "step").parse().unwrap_or(2).min(100);
            let up = action == "volume-up";
            let delta = step as f32 / 100.0;
            if crate::media::volume(if up { delta } else { -delta }).is_ok() {
                return Ok(());
            }
            let key = if up { Key::VolumeUp } else { Key::VolumeDown };
            let mut e = enigo()?;
            for _ in 0..(step / 2).max(1) {
                e.key(key, Direction::Click).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        _ => Err(tr!("Это действие пока не поддерживается", "This action isn't supported yet", "暂不支持此操作")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combos_parse_in_both_spellings() {
        assert_eq!(combo("Ctrl + Shift + M").unwrap(), combo("ctrl+shift+m").unwrap());
        assert_eq!(combo("alt+F13").unwrap(), [Key::Alt, Key::F13]);
        assert_eq!(combo("Ctrl + +").unwrap().len(), 2);
        assert_eq!(combo("Up").unwrap(), [Key::UpArrow]);
        assert!(combo("Ctrl + Hyper").is_err() && combo("").is_err() && combo("F21").is_err());
    }
}
