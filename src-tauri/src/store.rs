use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const FILE: &str = "profiles.json";

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|dir| dir.join(FILE)).map_err(|e| e.to_string())
}

pub fn write(path: &Path, text: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let temp = path.with_extension("json.tmp");
    let mut file = fs::File::create(&temp)?;
    file.write_all(text.as_bytes())?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temp, path)
}

#[tauri::command]
pub fn state_load(app: AppHandle) -> Result<Option<String>, String> {
    match fs::read_to_string(path(&app)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn state_save(app: AppHandle, text: String) -> Result<(), String> {
    let path = path(&app)?;
    tauri::async_runtime::spawn_blocking(move || write(&path, &text))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| tr!("Не удалось сохранить профили: {}", "Couldn't save profiles: {}", "无法保存配置文件：{}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_atomically() {
        let dir = std::env::temp_dir().join(format!("osd-store-{}", std::process::id()));
        let file = dir.join(FILE);
        write(&file, "{\"a\":1}").unwrap();
        write(&file, "{\"a\":2}").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "{\"a\":2}");
        assert!(!file.with_extension("json.tmp").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
