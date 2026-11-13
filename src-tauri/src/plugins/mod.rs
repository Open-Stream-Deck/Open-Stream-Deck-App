mod broker;
pub mod catalog;
mod component_discovery;
pub mod components;
mod dev;
mod files;
mod grants;
mod logs;

use grants::Grants;
use opensd_package::Manifest;
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone)]
struct Plugin {
    dir: PathBuf,
    manifest: Manifest,
    dev: bool,
}

#[derive(Clone, Serialize)]
pub struct PluginInfo {
    pub id: String,
    pub manifest: Manifest,
    pub dev: bool,
    pub revision: u64,
    pub permissions: Vec<broker::Permission>,
    pub digest: String,
    pub granted: bool,
}

pub struct PluginHost {
    app: AppHandle,
    root: PathBuf,
    grants: Grants,
    plugins: Mutex<BTreeMap<String, Plugin>>,
    revisions: Mutex<HashMap<String, u64>>,
    sessions: Mutex<HashMap<(String, u64), Arc<broker::Session>>>,
    dev: dev::Dev,
    install_lock: Mutex<()>,
    component_plans: Mutex<BTreeMap<String, components::Pending>>,
}

impl PluginHost {
    pub fn start(app: AppHandle) -> Result<Arc<PluginHost>, String> {
        let data = app.path().app_data_dir().map_err(|e| e.to_string())?.join("opensd");
        let root = data.join("plugins");
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let host = Arc::new(PluginHost {
            grants: Grants::new(data.join("grants.json")),
            dev: dev::Dev::new(app.path().app_data_dir().map_err(|e| e.to_string())?.join("opensd-dev.json")),
            app,
            root,
            plugins: Mutex::default(),
            revisions: Mutex::default(),
            sessions: Mutex::default(),
            install_lock: Mutex::new(()),
            component_plans: Mutex::default(),
        });
        host.scan();
        eprintln!("plugins: {}", host.root.display());
        watch_sleep(host.app.clone());
        Ok(host)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn scan(&self) {
        let mut found = BTreeMap::new();
        if let Ok(entries) = fs::read_dir(&self.root) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') || !entry.path().is_dir() {
                    continue;
                }
                match opensd_package::read_dir(&entry.path()) {
                    Ok(manifest) if manifest.id == name => {
                        found.insert(name, Plugin { dir: entry.path(), manifest, dev: false });
                    }
                    Ok(_) => eprintln!("plugins: {name}: the folder name does not match the plugin id"),
                    Err(e) => eprintln!("plugins: {name}: {e}"),
                }
            }
        }
        let mut plugins = self.plugins.lock().unwrap();
        for (id, plugin) in plugins.iter().filter(|(_, p)| p.dev) {
            found.insert(id.clone(), plugin.clone());
        }
        *plugins = found;
    }

    fn info(&self, id: &str, plugin: &Plugin) -> PluginInfo {
        let digest = plugin.manifest.permissions_digest();
        PluginInfo {
            id: id.to_string(),
            permissions: broker::describe(&plugin.manifest.permissions),
            granted: plugin.manifest.permissions.is_empty() || self.grants.approved(id, &digest),
            digest,
            dev: plugin.dev,
            revision: *self.revisions.lock().unwrap().get(id).unwrap_or(&0),
            manifest: plugin.manifest.clone(),
        }
    }

    pub fn list(&self) -> Vec<PluginInfo> {
        let plugins = self.plugins.lock().unwrap().clone();
        plugins.iter().map(|(id, p)| self.info(id, p)).collect()
    }

    pub fn find(&self, id: &str) -> Option<PluginInfo> {
        let plugin = self.plugins.lock().unwrap().get(id).cloned()?;
        Some(self.info(id, &plugin))
    }

    fn changed(&self, id: Option<&str>) {
        if let Some(id) = id {
            *self.revisions.lock().unwrap().entry(id.to_string()).or_default() += 1;
        }
        let _ = self.app.emit("plugins-changed", json!({ "id": id }));
    }

    pub fn install(&self, source: &Path) -> Result<PluginInfo, String> {
        let _guard = self.install_lock.lock().unwrap();
        let package = opensd_package::read(source).map_err(|e| e.to_string())?;
        package.compatible_with(env!("CARGO_PKG_VERSION")).map_err(|e| e.to_string())?;
        let id = package.manifest.id.clone();
        if self.plugins.lock().unwrap().get(&id).is_some_and(|p| p.dev) {
            return Err(tr!(
                "Сначала завершите сеанс opensd dev этого плагина",
                "End the opensd dev session of this plugin first",
                "请先结束此插件的 opensd dev 会话"
            ));
        }
        let work = self.root.join(format!(".install-{}", token()?));
        let staged = work.join(&id);
        package.extract(&staged).map_err(|e| e.to_string())?;
        let target = self.root.join(&id);
        let backup = work.join("previous");
        let result = (|| -> Result<(), String> {
            if target.exists() {
                rename(&target, &backup)?;
            }
            if let Err(e) = rename(&staged, &target) {
                if backup.exists() {
                    let _ = rename(&backup, &target);
                }
                return Err(e);
            }
            Ok(())
        })();
        let _ = fs::remove_dir_all(&work);
        result?;
        self.end_sessions(&id);
        self.scan();
        self.changed(Some(&id));
        self.find(&id).ok_or_else(|| "The plugin is missing after installation".into())
    }

    pub fn uninstall(&self, id: &str) -> Result<(), String> {
        let _guard = self.install_lock.lock().unwrap();
        let plugin = self.plugins.lock().unwrap().get(id).cloned().ok_or_else(not_found)?;
        if plugin.dev {
            return Err(tr!(
                "Сначала завершите сеанс opensd dev этого плагина",
                "End the opensd dev session of this plugin first",
                "请先结束此插件的 opensd dev 会话"
            ));
        }
        self.end_sessions(id);
        remove_dir(&plugin.dir)?;
        self.grants.set(id, None)?;
        self.scan();
        self.changed(Some(id));
        Ok(())
    }

    pub fn permissions_review(&self, id: &str) -> Result<Value, String> {
        let plugin = self.find(id).ok_or_else(not_found)?;
        Ok(json!({ "id": id, "name": plugin.manifest.name, "digest": plugin.digest, "items": plugin.permissions }))
    }

    pub fn permissions_approve(&self, id: &str, digest: &str) -> Result<(), String> {
        let plugin = self.find(id).ok_or_else(not_found)?;
        if plugin.digest != digest {
            return Err(tr!(
                "Плагин запрашивает другие разрешения, проверьте их снова",
                "The plugin asks for different permissions now; review them again",
                "插件请求的权限已变化，请重新检查"
            ));
        }
        self.grants.set(id, Some(digest))?;
        self.end_sessions(id);
        self.changed(Some(id));
        Ok(())
    }

    pub fn permissions_revoke(&self, id: &str) -> Result<(), String> {
        self.grants.set(id, None)?;
        self.end_sessions(id);
        self.changed(Some(id));
        Ok(())
    }

    pub fn broker(self: &Arc<Self>, id: &str, session: u64, command: Value) -> Result<(), String> {
        let kind = command["type"].as_str().unwrap_or_default();
        if !broker::handles(kind) {
            return Err(format!("Unknown broker command {kind}"));
        }
        let key = (id.to_string(), session);
        let existing = self.sessions.lock().unwrap().get(&key).cloned();
        let session_state = match existing {
            Some(s) => s,
            None => {
                let plugin = self.find(id).ok_or_else(not_found)?;
                let app = self.app.clone();
                let (plugin_id, session_id) = (id.to_string(), session);
                let host = Arc::downgrade(self);
                let reply: broker::Reply = Arc::new(move |message| {
                    let alive = host
                        .upgrade()
                        .is_some_and(|h| h.sessions.lock().unwrap().contains_key(&(plugin_id.clone(), session_id)));
                    alive
                        && app
                            .emit_to(
                                "main",
                                "plugin-broker",
                                json!({ "id": plugin_id, "session": session_id, "message": message }),
                            )
                            .is_ok()
                });
                let state = broker::Session::new(&plugin.manifest, plugin.granted, reply);
                self.sessions.lock().unwrap().insert(key, state.clone());
                state
            }
        };
        broker::handle(&session_state, &command);
        Ok(())
    }

    pub fn image(&self, id: &str, url: &str) -> Result<String, String> {
        let plugin = self.find(id).ok_or_else(not_found)?;
        if !plugin.granted {
            return Err("The user has not allowed this plugin's permissions".into());
        }
        broker::image(&plugin.manifest, url)
    }

    pub fn session_end(&self, id: &str, session: u64) {
        if let Some(state) = self.sessions.lock().unwrap().remove(&(id.to_string(), session)) {
            state.close();
        }
    }

    fn end_sessions(&self, id: &str) {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|(plugin, _), state| {
            if plugin == id {
                state.close();
            }
            plugin != id
        });
    }

    pub fn log_start(&self, id: &str) {
        logs::start(&self.app, id);
    }

    pub fn log(&self, id: &str, level: &str, message: &str) {
        let level = match level {
            "debug" | "info" | "warn" | "error" => level,
            _ => "info",
        };
        logs::append(&self.app, id, level, message);
    }

    pub fn log_path(&self, id: &str) -> Option<PathBuf> {
        logs::path(&self.app, id)
    }

    pub fn serve_file(
        &self,
        request: &tauri::http::Request<Vec<u8>>,
    ) -> tauri::http::Response<std::borrow::Cow<'static, [u8]>> {
        if let Some(response) = files::bridge(request.uri().path()) {
            return response;
        }
        let Some((id, rel)) = files::split(request) else { return files::not_found() };
        let Some(dir) = self
            .plugins
            .lock()
            .unwrap()
            .get(&id)
            .filter(|p| !p.manifest.component_sources().any(|source| source == rel))
            .map(|p| p.dir.clone())
        else {
            return files::not_found();
        };
        files::serve(&dir, &rel)
    }

    pub fn dev_status(&self) -> Value {
        let projects: Vec<_> =
            self.plugins.lock().unwrap().iter().filter(|(_, p)| p.dev).map(|(id, _)| id.clone()).collect();
        json!({ "enabled": self.dev.enabled(), "projects": projects })
    }

    fn dev_link(&self, id: &str, root: &Path) -> Result<Value, String> {
        let _guard = self.install_lock.lock().unwrap();
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        let manifest = opensd_package::read_dir(&root).map_err(|e| e.to_string())?;
        if manifest.id != id {
            return Err(format!("The staged plugin is {}, not {id}", manifest.id));
        }
        self.end_sessions(id);
        self.plugins.lock().unwrap().insert(id.to_string(), Plugin { dir: root.clone(), manifest, dev: true });
        logs::start(&self.app, id);
        self.changed(Some(id));
        Ok(json!({ "id": id, "root": root, "log": self.log_path(id) }))
    }

    fn dev_unlink(&self, id: &str) {
        let _guard = self.install_lock.lock().unwrap();
        let removed = {
            let mut plugins = self.plugins.lock().unwrap();
            if plugins.get(id).is_some_and(|p| p.dev) { plugins.remove(id).is_some() } else { false }
        };
        if removed {
            self.end_sessions(id);
            self.scan();
            self.changed(Some(id));
        }
    }
}

fn watch_sleep(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = SystemTime::now();
        loop {
            std::thread::sleep(Duration::from_secs(5));
            let now = SystemTime::now();
            if now.duration_since(last).unwrap_or_default() > Duration::from_secs(30) {
                let _ = app.emit_to("main", "system-wake", ());
            }
            last = now;
        }
    });
}

fn not_found() -> String {
    tr!("Плагин не найден", "Plugin not found", "未找到插件")
}

pub fn token() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn rename(from: &Path, to: &Path) -> Result<(), String> {
    for attempt in 0..10 {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(_) if attempt < 9 => std::thread::sleep(Duration::from_millis(150)),
            Err(e) => return Err(format!("{} → {}: {e}", from.display(), to.display())),
        }
    }
    Ok(())
}

fn remove_dir(path: &Path) -> Result<(), String> {
    for attempt in 0..10 {
        match fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(_) if attempt < 9 => std::thread::sleep(Duration::from_millis(150)),
            Err(e) => {
                return Err(tr!(
                    "Не удалось удалить {}: {}",
                    "Couldn't delete {}: {}",
                    "无法删除 {}：{}",
                    path.display(),
                    e
                ));
            }
        }
    }
    Ok(())
}
