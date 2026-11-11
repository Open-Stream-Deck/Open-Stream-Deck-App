use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::mpsc::{self, Sender};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_BYTES: u64 = 1024 * 1024;

type Job = Box<dyn FnOnce() + Send>;

fn queue(job: impl FnOnce() + Send + 'static) {
    static QUEUE: OnceLock<Sender<Job>> = OnceLock::new();
    let tx = QUEUE.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        thread::spawn(move || rx.into_iter().for_each(|job| job()));
        tx
    });
    let _ = tx.send(Box::new(job));
}

fn dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_log_dir().ok()?.join("plugins");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

pub fn path(app: &AppHandle, id: &str) -> Option<PathBuf> {
    let name: String =
        id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' }).collect();
    Some(dir(app)?.join(format!("{name}.log")))
}

pub fn start(app: &AppHandle, id: &str) {
    let (app, id) = (app.clone(), id.to_string());
    queue(move || {
        let Some(path) = path(&app, &id) else { return };
        if path.exists() {
            let _ = fs::rename(&path, path.with_extension("old.log"));
        }
        let _ = fs::File::create(path);
    });
}

pub fn append(app: &AppHandle, id: &str, level: &str, text: &str) {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let text: String = text.chars().filter(|c| !c.is_control() || *c == '\n' || *c == '\t').take(16_384).collect();
    let line = format!("[{secs}] {level:<5} {text}");
    let (app, id) = (app.clone(), id.to_string());
    queue(move || {
        let Some(path) = path(&app, &id) else { return };
        if fs::metadata(&path).is_ok_and(|m| m.len() >= MAX_BYTES) {
            let _ = fs::rename(&path, path.with_extension("old.log"));
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{line}");
        }
    });
}
