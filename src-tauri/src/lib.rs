#[macro_use]
mod i18n;
mod actions;
mod backup;
pub mod bench;
pub mod deck;
pub mod firmware;
mod gpu;
mod launcher;
mod media;
mod plugins;
mod procs;
mod stats;
mod store;
mod svg;
mod tray;

use deck::{Deck, DeckStatus};
use plugins::{PluginHost, PluginInfo};
use stats::{Collector, Stats};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};

type Host<'a> = State<'a, Arc<PluginHost>>;

#[tauri::command]
fn deck_status(deck: State<'_, Deck>) -> DeckStatus {
    deck.status()
}

fn json_bytes(value: &serde_json::Value) -> Option<Vec<u8>> {
    let byte = |v: &serde_json::Value| v.as_u64().and_then(|n| u8::try_from(n).ok());
    match value {
        serde_json::Value::Array(items) => items.iter().map(byte).collect(),
        serde_json::Value::Object(map) => (0..map.len()).map(|i| map.get(&i.to_string()).and_then(byte)).collect(),
        _ => None,
    }
}

#[tauri::command]
async fn deck_draw(deck: State<'_, Deck>, request: Request<'_>) -> Result<(), String> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(value) => json_bytes(value)
            .ok_or_else(|| tr!("Ожидались двоичные данные", "Expected binary data", "应为二进制数据"))?,
    };
    let deck = deck.inner().clone();
    tauri::async_runtime::spawn_blocking(move || deck.draw(bytes, std::time::Duration::from_secs(5)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn deck_bench(deck: State<'_, Deck>) -> Result<bench::Bench, String> {
    let deck = deck.inner().clone();
    tauri::async_runtime::spawn_blocking(move || bench::run(&deck)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn firmware_flash(app: AppHandle, path: String) -> Result<firmware::Outcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        firmware::flash(&path, &|p| {
            let _ = app.emit("firmware-progress", p);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn system_stats(app: AppHandle) -> Result<Stats, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Collector>().sample()).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn set_language(language: String) {
    i18n::set(&language);
}

#[tauri::command]
fn ui_log(message: String) {
    eprintln!("ui: {message}");
}

#[tauri::command]
async fn run_action(
    plugin: String,
    action: String,
    settings: HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || actions::run(&plugin, &action, &settings))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn media_state() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(
        || serde_json::json!({ "muted": media::muted().unwrap_or(false), "playing": media::playing() }),
    )
    .await
    .map_err(|e| e.to_string())
}

const AUDIO_EXTENSIONS: [&str; 8] = ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "webm"];
const AUDIO_MAX_BYTES: u64 = 64 * 1024 * 1024;

fn read_audio_file(path: PathBuf) -> Result<Vec<u8>, String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !AUDIO_EXTENSIONS.contains(&ext.as_str()) {
        return Err(tr!("Это не аудиофайл", "This isn't an audio file", "这不是音频文件"));
    }
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > AUDIO_MAX_BYTES {
        return Err(tr!("Файл больше 64 МБ", "The file is larger than 64 MB", "文件超过 64 MB"));
    }
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn svg_raster(src: String, size: u32) -> Result<tauri::ipc::Response, String> {
    let bytes =
        tauri::async_runtime::spawn_blocking(move || svg::raster(&src, size)).await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn read_audio(path: PathBuf) -> Result<tauri::ipc::Response, String> {
    let bytes =
        tauri::async_runtime::spawn_blocking(move || read_audio_file(path)).await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn media_seek(seconds: f64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || media::seek(seconds)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn plugins_list(host: Host<'_>) -> Vec<PluginInfo> {
    host.list()
}

#[tauri::command]
fn plugins_folder(host: Host<'_>) -> String {
    host.root().to_string_lossy().into_owned()
}

#[tauri::command]
async fn plugin_install(host: Host<'_>, path: String) -> Result<PluginInfo, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.install(&PathBuf::from(path))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn store_list(host: Host<'_>) -> Result<Vec<plugins::catalog::StorePlugin>, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || plugins::catalog::list(&host)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn store_install(host: Host<'_>, id: String) -> Result<PluginInfo, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || plugins::catalog::install(&host, &id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn plugin_uninstall(host: Host<'_>, id: String) -> Result<(), String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.uninstall(&id)).await.map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum ComponentRequest {
    Overview { id: String },
    Discover { id: String, target: String },
    Plan { id: String, component: String, target: String, root: PathBuf },
    Remove { installation: String },
    Apply { plan: String, replace_conflicts: bool },
    Export { id: String, component: String, output: PathBuf },
    Recover,
}

#[tauri::command]
async fn plugin_components(
    window: tauri::WebviewWindow,
    host: Host<'_>,
    request: ComponentRequest,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("External components are managed by the main application window".into());
    }
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || match request {
        ComponentRequest::Overview { id } => {
            serde_json::to_value(host.component_overview(&id)?).map_err(|e| e.to_string())
        }
        ComponentRequest::Discover { id, target } => {
            serde_json::to_value(host.component_candidates(&id, &target)?).map_err(|e| e.to_string())
        }
        ComponentRequest::Plan { id, component, target, root } => {
            serde_json::to_value(host.component_plan(&id, &component, &target, root)?).map_err(|e| e.to_string())
        }
        ComponentRequest::Remove { installation } => {
            serde_json::to_value(host.component_remove_plan(&installation)?).map_err(|e| e.to_string())
        }
        ComponentRequest::Apply { plan, replace_conflicts } => {
            host.component_apply(&plan, replace_conflicts)?;
            Ok(serde_json::Value::Null)
        }
        ComponentRequest::Export { id, component, output } => {
            host.component_export(&id, &component, &output)?;
            Ok(serde_json::Value::Null)
        }
        ComponentRequest::Recover => {
            host.component_recover()?;
            Ok(serde_json::Value::Null)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn plugin_permissions_review(host: Host<'_>, id: String) -> Result<serde_json::Value, String> {
    host.permissions_review(&id)
}

#[tauri::command]
fn plugin_permissions_approve(host: Host<'_>, id: String, digest: String) -> Result<(), String> {
    host.permissions_approve(&id, &digest)
}

#[tauri::command]
fn plugin_permissions_revoke(host: Host<'_>, id: String) -> Result<(), String> {
    host.permissions_revoke(&id)
}

#[tauri::command]
fn plugin_broker(host: Host<'_>, id: String, session: u64, command: serde_json::Value) -> Result<(), String> {
    host.inner().broker(&id, session, command)
}

#[tauri::command]
async fn plugin_image(host: Host<'_>, id: String, url: String) -> Result<String, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.image(&id, &url)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn plugin_session_end(host: Host<'_>, id: String, session: u64) {
    host.session_end(&id, session);
}

#[tauri::command]
fn plugin_log_start(host: Host<'_>, id: String) {
    host.log_start(&id);
}

#[tauri::command]
fn plugin_log(host: Host<'_>, id: String, level: String, message: String) {
    host.log(&id, &level, &message);
}

#[tauri::command]
fn plugin_log_path(host: Host<'_>, id: String) -> Option<String> {
    host.log_path(&id).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn plugin_open_url(url: String) -> Result<(), String> {
    let valid =
        url.starts_with("https://") && url.len() <= 2048 && !url.chars().any(|c| c.is_whitespace() || c.is_control());
    if !valid {
        return Err("Only https:// links can be opened".into());
    }
    actions::open_url(&url, None)
}

fn settings_label(id: &str) -> String {
    format!("plugin-settings-{}", id.replace('.', "_"))
}

#[tauri::command]
fn plugin_settings_up(
    app: AppHandle,
    window: tauri::WebviewWindow,
    host: Host<'_>,
    mut message: serde_json::Value,
) -> Result<(), String> {
    let id = host
        .list()
        .into_iter()
        .find(|p| p.manifest.ui.settings.is_some() && settings_label(&p.id) == window.label())
        .ok_or("Not a plugin settings window")?
        .id;
    let fields = message.as_object_mut().ok_or("Expected an object")?;
    fields.insert("plugin".into(), id.into());
    fields.insert("label".into(), window.label().into());
    app.emit_to("main", "opensd-settings-up", message).map_err(|e| e.to_string())
}

#[tauri::command]
async fn plugin_settings_window(app: AppHandle, host: Host<'_>, id: String) -> Result<(), String> {
    let plugin = host.find(&id).ok_or("Unknown plugin")?;
    if plugin.manifest.ui.settings.is_none() {
        return Err("The plugin has no settings window".into());
    }
    let label = settings_label(&id);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        return window.set_focus().map_err(|e| e.to_string());
    }
    let url = format!("index.html#plugin-settings={id}");
    let args =
        app.config().app.windows.iter().find(|w| w.label == "main").and_then(|w| w.additional_browser_args.clone());
    let mut builder = tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::App(url.into()));
    if let Some(args) = args {
        builder = builder.additional_browser_args(&args);
    }
    builder
        .title(tr!("{}: настройки", "{}: settings", "{}：设置", plugin.manifest.name))
        .inner_size(1100.0, 760.0)
        .min_inner_size(720.0, 520.0)
        .center()
        .theme(Some(tauri::Theme::Dark))
        .background_color(tauri::window::Color(11, 11, 12, 255))
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn plugin_dev_status(host: Host<'_>) -> serde_json::Value {
    host.dev_status()
}

#[tauri::command]
fn plugin_dev_enable(host: Host<'_>, enabled: bool) -> Result<serde_json::Value, String> {
    host.inner().dev_enable(enabled)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hidden = std::env::args().any(|a| a == "--hidden");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| tray::show(app)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(launcher::Launcher::default())
        .register_uri_scheme_protocol("osd-plugin", |ctx, request| {
            match ctx.app_handle().try_state::<Arc<PluginHost>>() {
                Some(host) => host.serve_file(&request),
                None => {
                    tauri::http::Response::builder().status(503).body(std::borrow::Cow::Borrowed(&b""[..])).unwrap()
                }
            }
        })
        .on_window_event(tray::on_window_event)
        .setup(move |app| {
            tray::setup(app.handle(), hidden)?;
            if !hidden && let Some(splash) = app.get_webview_window("splash") {
                splash.show()?;
            }
            app.manage(Deck::start(app.handle().clone()));
            app.manage(Collector::new());
            app.manage(PluginHost::start(app.handle().clone())?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            deck_status,
            deck_draw,
            deck_bench,
            set_language,
            firmware_flash,
            system_stats,
            run_action,
            ui_log,
            plugins_list,
            plugins_folder,
            plugin_install,
            store_list,
            store_install,
            plugin_uninstall,
            plugin_components,
            plugin_permissions_review,
            plugin_permissions_approve,
            plugin_permissions_revoke,
            plugin_broker,
            plugin_image,
            plugin_session_end,
            plugin_log_start,
            plugin_log,
            plugin_log_path,
            plugin_open_url,
            plugin_settings_window,
            plugin_settings_up,
            plugin_dev_status,
            plugin_dev_enable,
            media_state,
            media_seek,
            read_audio,
            svg_raster,
            backup::backup_create,
            backup::backup_restore,
            backup::app_restart,
            launcher::launcher,
            launcher::update_check,
            launcher::update_install,
            store::state_load,
            store::state_save,
            tray::app_behavior,
            tray::app_exit
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(tray::on_run_event);
}
