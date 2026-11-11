use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const FORMAT: u32 = 1;
const MANIFEST: &str = "manifest.json";
const STATE: &str = "profiles.json";
const GRANTS: &str = "opensd/grants.json";
const PLUGINS: &str = "opensd/plugins";
const SOUNDS: &str = "sounds";
const MEDIA: &str = "media";

#[derive(Serialize, Deserialize)]
pub struct Media {
    id: String,
    kind: String,
    data: String,
}

#[derive(Serialize, Deserialize)]
struct MediaEntry {
    id: String,
    kind: String,
}

#[derive(Serialize, Deserialize)]
struct Manifest {
    format: u32,
    app: String,
    created: u64,
    media: Vec<MediaEntry>,
    sounds: BTreeMap<String, String>,
}

type Zip<R> = ZipArchive<R>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn sound_files(value: &Value, out: &mut BTreeSet<String>) {
    match value {
        Value::Object(map) => {
            for (key, v) in map {
                match v {
                    Value::String(path) if key == "soundFile" && !path.is_empty() => {
                        out.insert(path.clone());
                    }
                    _ => sound_files(v, out),
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|v| sound_files(v, out)),
        _ => {}
    }
}

fn relink_sounds(value: &mut Value, moved: &HashMap<String, String>) {
    match value {
        Value::Object(map) => {
            for (key, v) in map.iter_mut() {
                match v {
                    Value::String(path) if key == "soundFile" => {
                        if let Some(next) = moved.get(path.as_str()) {
                            *path = next.clone();
                        }
                    }
                    _ => relink_sounds(v, moved),
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(|v| relink_sounds(v, moved)),
        _ => {}
    }
}

fn add_dir<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    dir: &Path,
    prefix: &str,
    opts: SimpleFileOptions,
) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(dir) else { return Ok(()) };
    for entry in entries.flatten() {
        let name = format!("{prefix}/{}", entry.file_name().to_string_lossy());
        let kind = entry.file_type().map_err(err)?;
        if kind.is_dir() {
            add_dir(zip, &entry.path(), &name, opts)?;
        } else if kind.is_file() {
            zip.start_file(name.as_str(), opts).map_err(err)?;
            zip.write_all(&fs::read(entry.path()).map_err(err)?).map_err(err)?;
        }
    }
    Ok(())
}

fn create(app: &AppHandle, path: &Path, state: &str, media: Vec<Media>) -> Result<(), String> {
    let data = app.path().app_data_dir().map_err(err)?;
    let parsed: Value = serde_json::from_str(state).map_err(err)?;
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut zip = ZipWriter::new(fs::File::create(path).map_err(err)?);

    let mut files = BTreeSet::new();
    sound_files(&parsed, &mut files);
    let mut sounds = BTreeMap::new();
    for (i, source) in files.into_iter().enumerate() {
        let Ok(bytes) = fs::read(&source) else { continue };
        let file = Path::new(&source).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let name = format!("{SOUNDS}/{i}-{file}");
        zip.start_file(name.as_str(), opts).map_err(err)?;
        zip.write_all(&bytes).map_err(err)?;
        sounds.insert(name, source);
    }

    zip.start_file(STATE, opts).map_err(err)?;
    zip.write_all(state.as_bytes()).map_err(err)?;
    if let Ok(grants) = fs::read(data.join(GRANTS)) {
        zip.start_file(GRANTS, opts).map_err(err)?;
        zip.write_all(&grants).map_err(err)?;
    }
    add_dir(&mut zip, &data.join(PLUGINS), PLUGINS, opts)?;

    let mut entries = Vec::new();
    for m in media {
        let bytes = STANDARD.decode(&m.data).map_err(err)?;
        zip.start_file(format!("{MEDIA}/{}", m.id), opts).map_err(err)?;
        zip.write_all(&bytes).map_err(err)?;
        entries.push(MediaEntry { id: m.id, kind: m.kind });
    }

    let manifest = Manifest {
        format: FORMAT,
        app: app.package_info().version.to_string(),
        created: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        media: entries,
        sounds,
    };
    zip.start_file(MANIFEST, opts).map_err(err)?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest).map_err(err)?).map_err(err)?;
    zip.finish().map_err(err)?;
    Ok(())
}

fn read<R: Read + Seek>(zip: &mut Zip<R>, name: &str) -> Result<Vec<u8>, String> {
    let mut entry = zip.by_name(name).map_err(err)?;
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).map_err(err)?;
    Ok(bytes)
}

fn unpack_plugins<R: Read + Seek>(zip: &mut Zip<R>, target: &Path) -> Result<(), String> {
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(err)?;
        let name = entry.name().map_err(err)?.to_string();
        let Some(rel) = name.strip_prefix(PLUGINS).and_then(|r| r.strip_prefix('/')) else { continue };
        if rel.is_empty() || entry.is_dir() {
            continue;
        }
        if !opensd_package::safe_path(rel) {
            return Err(tr!(
                "В бэкапе небезопасный путь: {}",
                "Unsafe path in the backup: {}",
                "备份中存在不安全的路径：{}",
                name
            ));
        }
        let path = target.join(rel);
        fs::create_dir_all(path.parent().unwrap_or(target)).map_err(err)?;
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(err)?;
        fs::write(path, bytes).map_err(err)?;
    }
    Ok(())
}

fn replace_dir(staging: &Path, target: &Path) -> Result<(), String> {
    let old = target.with_extension("old");
    let _ = fs::remove_dir_all(&old);
    if target.exists() {
        fs::rename(target, &old).map_err(err)?;
    }
    fs::rename(staging, target).map_err(err)?;
    let _ = fs::remove_dir_all(&old);
    Ok(())
}

fn restore(app: &AppHandle, path: &Path) -> Result<Vec<Media>, String> {
    let data = app.path().app_data_dir().map_err(err)?;
    let mut zip = ZipArchive::new(fs::File::open(path).map_err(err)?)
        .map_err(|_| tr!("Это не файл бэкапа", "This isn't a backup file", "这不是备份文件"))?;
    let manifest: Manifest = read(&mut zip, MANIFEST)
        .and_then(|b| serde_json::from_slice(&b).map_err(err))
        .map_err(|_| tr!("Это не файл бэкапа", "This isn't a backup file", "这不是备份文件"))?;
    if manifest.format > FORMAT {
        return Err(tr!(
            "Бэкап сделан в более новой версии приложения",
            "The backup was made by a newer version of the app",
            "此备份由更新版本的应用创建"
        ));
    }
    let mut state: Value = serde_json::from_slice(&read(&mut zip, STATE)?).map_err(err)?;

    let sounds = data.join(SOUNDS);
    let mut moved = HashMap::new();
    for (name, original) in &manifest.sounds {
        let file = name.rsplit('/').next().unwrap_or(name);
        if !opensd_package::safe_path(file) {
            continue;
        }
        fs::create_dir_all(&sounds).map_err(err)?;
        let target = sounds.join(file);
        fs::write(&target, read(&mut zip, name)?).map_err(err)?;
        moved.insert(original.clone(), target.to_string_lossy().into_owned());
    }
    relink_sounds(&mut state, &moved);

    let plugins = data.join(PLUGINS);
    let staging = plugins.with_extension("restore");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(err)?;
    unpack_plugins(&mut zip, &staging)?;
    replace_dir(&staging, &plugins)?;

    match read(&mut zip, GRANTS) {
        Ok(grants) => fs::write(data.join(GRANTS), grants).map_err(err)?,
        Err(_) => {
            let _ = fs::remove_file(data.join(GRANTS));
        }
    }

    let mut media = Vec::new();
    for m in manifest.media {
        let bytes = read(&mut zip, &format!("{MEDIA}/{}", m.id))?;
        media.push(Media { id: m.id, kind: m.kind, data: STANDARD.encode(bytes) });
    }

    crate::store::write(&data.join(STATE), &serde_json::to_string(&state).map_err(err)?).map_err(err)?;
    Ok(media)
}

#[tauri::command]
pub async fn backup_create(app: AppHandle, path: PathBuf, state: String, media: Vec<Media>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || create(&app, &path, &state, media))
        .await
        .map_err(err)?
        .map_err(|e| tr!("Не удалось создать бэкап: {}", "Couldn't create the backup: {}", "无法创建备份：{}", e))
}

#[tauri::command]
pub async fn backup_restore(app: AppHandle, path: PathBuf) -> Result<Vec<Media>, String> {
    tauri::async_runtime::spawn_blocking(move || restore(&app, &path)).await.map_err(err)?
}

#[tauri::command]
pub fn app_restart(app: AppHandle) {
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_and_relinks_sound_files() {
        let mut state = json!({ "profiles": [{ "pages": [[{ "settings": { "soundFile": "C:\\a.mp3" } }, { "settings": { "soundFile": "" } }]] }] });
        let mut found = BTreeSet::new();
        sound_files(&state, &mut found);
        assert_eq!(found.into_iter().collect::<Vec<_>>(), ["C:\\a.mp3"]);
        relink_sounds(&mut state, &HashMap::from([("C:\\a.mp3".to_string(), "D:\\b.mp3".to_string())]));
        assert_eq!(state["profiles"][0]["pages"][0][0]["settings"]["soundFile"], "D:\\b.mp3");
    }
}
