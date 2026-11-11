use crate::actions::{self, Stroke};
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use opensd_package::{LaunchTarget, Manifest, Permissions};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::mpsc::{Sender, channel};
use tokio_tungstenite::tungstenite::{Message, protocol::WebSocketConfig};

const MAX_SOCKETS: usize = 8;
const MAX_REQUESTS: usize = 16;
const MAX_CLIPBOARD: usize = 64 * 1024;
const MAX_REQUEST_BODY: usize = 1024 * 1024;
const MAX_DATA: usize = 2 * 1024 * 1024 - 16 * 1024;
const MAX_TEXT: usize = 4096;
const MAX_QUEUED: usize = 256;
const MAX_WATCHES: usize = 16;
const MAX_IMAGE: usize = 1024 * 1024;
const WATCH_EVERY: Duration = Duration::from_secs(2);
const IMAGE_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

pub type Reply = Arc<dyn Fn(Value) -> bool + Send + Sync>;

pub struct Session {
    permissions: Permissions,
    granted: bool,
    reply: Reply,
    sockets: Mutex<HashMap<String, (usize, Sender<Message>)>>,
    requests: AtomicUsize,
    serial: AtomicUsize,
    held: Mutex<Vec<enigo::Key>>,
    watches: Mutex<Watches>,
}

#[derive(Default)]
struct Watches {
    list: HashMap<String, (LaunchTarget, Option<bool>)>,
    polling: bool,
}

impl Session {
    pub fn new(manifest: &Manifest, granted: bool, reply: Reply) -> Arc<Self> {
        Arc::new(Self {
            permissions: manifest.permissions.clone(),
            granted,
            reply,
            sockets: Mutex::default(),
            requests: AtomicUsize::new(0),
            serial: AtomicUsize::new(0),
            held: Mutex::default(),
            watches: Mutex::default(),
        })
    }

    pub fn close(&self) {
        self.sockets.lock().unwrap().clear();
        self.watches.lock().unwrap().list.clear();
        let held = std::mem::take(&mut *self.held.lock().unwrap());
        if !held.is_empty() {
            actions::queue(move || drop(actions::strike(&held, Stroke::Up)));
        }
    }
}

struct Answer {
    session: Weak<Session>,
    id: String,
}

impl Answer {
    fn send(&self, kind: &str, mut fields: Map<String, Value>) -> bool {
        let Some(session) = self.session.upgrade() else { return false };
        fields.insert("type".into(), json!(kind));
        fields.insert("id".into(), json!(self.id));
        (session.reply)(Value::Object(fields))
    }

    fn denied(&self, message: impl Into<String>) {
        self.send("denied", object(json!({ "message": message.into() })));
    }

    fn done(&self, result: Result<(), String>) {
        self.send(
            "done",
            object(match result {
                Ok(()) => json!({}),
                Err(error) => json!({ "error": error }),
            }),
        );
    }
}

fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

pub fn handles(kind: &str) -> bool {
    matches!(
        kind,
        "http"
            | "wsOpen"
            | "wsSend"
            | "wsClose"
            | "appStatus"
            | "appWatch"
            | "appUnwatch"
            | "appLaunch"
            | "appQuit"
            | "clipboard"
            | "hotkey"
            | "typeText"
    )
}

pub fn handle(session: &Arc<Session>, command: &Value) {
    let kind = command["type"].as_str().unwrap_or_default();
    let Some(id) = command["id"].as_str().filter(|id| !id.is_empty() && id.len() <= 128) else {
        return;
    };
    let answer = Answer { session: Arc::downgrade(session), id: id.to_string() };
    if !session.granted {
        return answer.denied("The user has not allowed this plugin's permissions");
    }
    let p = &session.permissions;
    let local = is_loopback(command["url"].as_str().unwrap_or_default());
    match kind {
        "http" if !local => remote(session, answer, command),
        "http" | "wsOpen" if local && p.loopback.is_empty() => {
            answer.denied("The plugin declares no loopback permission")
        }
        "appStatus" | "appWatch" | "appLaunch" | "appQuit" if p.launch.is_empty() => {
            answer.denied("The plugin declares no launch permission")
        }
        "clipboard" if !p.clipboard => answer.denied("The plugin declares no clipboard permission"),
        "hotkey" | "typeText" if !p.keyboard => answer.denied("The plugin declares no keyboard permission"),
        "hotkey" => keyboard(session, answer, command),
        "typeText" => {
            let text = command["text"].as_str().unwrap_or_default().to_string();
            if text.chars().count() > MAX_TEXT {
                return answer.denied("The text exceeds 4096 characters");
            }
            actions::queue(move || answer.done(actions::type_text(&text)));
        }
        "appUnwatch" => drop(session.watches.lock().unwrap().list.remove(id)),
        "http" => http(session, answer, command),
        "wsOpen" => ws_open(session, answer, command),
        "wsSend" => {
            let data = command["data"].as_str().unwrap_or_default();
            if data.len() > MAX_DATA {
                return answer.denied("The message exceeds 2 MB");
            }
            let mut sockets = session.sockets.lock().unwrap();
            match sockets.get(id).map(|(_, tx)| tx.try_send(Message::text(data))) {
                Some(Ok(())) => {}
                Some(Err(TrySendError::Full(_))) => drop(sockets.remove(id)),
                _ => {
                    drop(sockets);
                    answer.send("wsClose", object(json!({ "reason": "The socket is not open" })));
                }
            }
        }
        "wsClose" => drop(session.sockets.lock().unwrap().remove(id)),
        "appStatus" | "appWatch" | "appLaunch" | "appQuit" => {
            let Some(target) = command["app"].as_str().and_then(|app| p.target(app)).cloned() else {
                return answer.denied("The application is not declared in [permissions.launch]");
            };
            if kind == "appWatch" {
                return watch(session, answer, target);
            }
            let args: Vec<u64> =
                command["args"].as_array().map(|v| v.iter().filter_map(Value::as_u64).collect()).unwrap_or_default();
            let kind = kind.to_string();
            tauri::async_runtime::spawn_blocking(move || match kind.as_str() {
                "appStatus" => {
                    answer.send("appStatus", object(app_status(&target)));
                }
                "appLaunch" => answer.done(app_launch(&target, &args)),
                _ => answer.done(app_quit(&target)),
            });
        }
        "clipboard" => {
            let text = command["text"].as_str().unwrap_or_default().to_string();
            if text.len() > MAX_CLIPBOARD {
                return answer.denied("Clipboard text exceeds 64 KiB");
            }
            tauri::async_runtime::spawn_blocking(move || answer.done(clipboard::write(&text)));
        }
        _ => {}
    }
}

fn keyboard(session: &Session, answer: Answer, command: &Value) {
    let keys = match actions::combo(command["keys"].as_str().unwrap_or_default()) {
        Ok(keys) => keys,
        Err(error) => return answer.done(Err(error)),
    };
    let stroke = match command["mode"].as_str() {
        Some("down") => Stroke::Down,
        Some("up") => Stroke::Up,
        _ => Stroke::Press,
    };
    {
        let mut held = session.held.lock().unwrap();
        match stroke {
            Stroke::Down => {
                for key in &keys {
                    if !held.contains(key) {
                        held.push(*key);
                    }
                }
            }
            Stroke::Up => held.retain(|k| !keys.contains(k)),
            Stroke::Press => {}
        }
    }
    actions::queue(move || answer.done(actions::strike(&keys, stroke)));
}

fn watch(session: &Arc<Session>, answer: Answer, target: LaunchTarget) {
    let mut watches = session.watches.lock().unwrap();
    if watches.list.len() >= MAX_WATCHES && !watches.list.contains_key(&answer.id) {
        drop(watches);
        return answer.denied("Too many watched applications");
    }
    watches.list.insert(answer.id.clone(), (target, None));
    if std::mem::replace(&mut watches.polling, true) {
        return;
    }
    drop(watches);
    let weak = Arc::downgrade(session);
    std::thread::spawn(move || {
        loop {
            let Some(session) = weak.upgrade() else { return };
            let list: Vec<_> = {
                let mut watches = session.watches.lock().unwrap();
                if watches.list.is_empty() {
                    watches.polling = false;
                    return;
                }
                watches.list.iter().map(|(id, (target, last))| (id.clone(), target.clone(), *last)).collect()
            };
            for (id, target, last) in list {
                let status = app_status(&target);
                let running = status["processes"].as_array().is_some_and(|p| !p.is_empty());
                if last == Some(running) {
                    continue;
                }
                match session.watches.lock().unwrap().list.get_mut(&id) {
                    Some(entry) => entry.1 = Some(running),
                    None => continue,
                }
                Answer { session: weak.clone(), id }.send("appStatus", object(status));
            }
            drop(session);
            std::thread::sleep(WATCH_EVERY);
        }
    });
}

fn loopback(url: &str, schemes: &[&str], permissions: &Permissions) -> Result<(u16, String), String> {
    let (scheme, rest) = url.split_once("://").ok_or("Only loopback URLs go through the broker")?;
    if !schemes.contains(&scheme) {
        return Err(format!("Unsupported scheme {scheme}"));
    }
    let rest = rest
        .strip_prefix("127.0.0.1:")
        .or_else(|| rest.strip_prefix("localhost:"))
        .ok_or("Only 127.0.0.1 and localhost with an explicit port are allowed")?;
    let split = rest.find('/').unwrap_or(rest.len());
    let port: u16 = rest[..split].parse().map_err(|_| "Invalid port")?;
    let path = if split == rest.len() { "/" } else { &rest[split..] };
    if path.bytes().any(|b| b <= b' ' || b == 0x7f) || path.len() > 4096 {
        return Err("Invalid URL path".into());
    }
    if !permissions.allows_port(port) {
        return Err(format!("Port {port} is outside the declared loopback ranges"));
    }
    Ok((port, path.to_string()))
}

fn is_loopback(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|u| matches!(u.host_str(), Some("127.0.0.1" | "localhost")))
}

fn origin_matches(pattern: &str, url: &url::Url) -> bool {
    let Some((scheme, rest)) = pattern.split_once("://") else {
        return false;
    };
    let (host, port) = match rest.rsplit_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (rest, None),
    };
    let Some(actual) = url.host_str() else {
        return false;
    };
    let host_ok =
        host == "*" || host.strip_prefix("*.").map_or(host == actual, |base| actual.ends_with(&format!(".{base}")));
    let port_ok = match port {
        Some("*") => true,
        Some(port) => port.parse().ok() == url.port_or_known_default(),
        None => url.port().is_none(),
    };
    let scheme_ok = scheme == url.scheme()
        || matches!((scheme, url.scheme()), ("http", "https" | "ws" | "wss") | ("https" | "ws", "wss"));
    scheme_ok && host_ok && port_ok
}

type Parts = (String, Vec<(String, String)>, String);

fn request_parts(command: &Value) -> Result<Parts, String> {
    let method = command["method"].as_str().filter(|m| !m.is_empty()).unwrap_or("GET").to_ascii_uppercase();
    if !matches!(method.as_str(), "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD") {
        return Err(format!("Unsupported method {method}"));
    }
    let mut headers = Vec::new();
    for (name, value) in command["headers"].as_object().into_iter().flatten() {
        let value = value.as_str().unwrap_or_default();
        let token =
            !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b));
        let forbidden =
            ["host", "content-length", "connection", "transfer-encoding"].contains(&name.to_ascii_lowercase().as_str());
        if !token || forbidden || value.contains(['\r', '\n']) {
            return Err(format!("Header {name} is not allowed"));
        }
        headers.push((name.clone(), value.to_string()));
    }
    let body = command["body"].as_str().unwrap_or_default().to_string();
    if body.len() > MAX_REQUEST_BODY {
        return Err("The request body exceeds 1 MiB".into());
    }
    Ok((method, headers, body))
}

fn begin(session: &Arc<Session>, answer: &Answer, command: &Value) -> Option<(Parts, Duration)> {
    let parts = match request_parts(command) {
        Ok(parts) => parts,
        Err(error) => {
            answer.send("httpResponse", object(json!({ "error": error })));
            return None;
        }
    };
    if session.requests.fetch_add(1, Ordering::SeqCst) >= MAX_REQUESTS {
        session.requests.fetch_sub(1, Ordering::SeqCst);
        answer.send("httpResponse", object(json!({ "error": "Too many requests in flight" })));
        return None;
    }
    Some((parts, Duration::from_millis(command["timeout"].as_u64().unwrap_or(5000).clamp(100, 30_000))))
}

fn finish(session: &Session, answer: &Answer, result: Result<Response, String>, binary: bool) {
    session.requests.fetch_sub(1, Ordering::SeqCst);
    answer.send(
        "httpResponse",
        object(match result {
            Ok((status, headers, body)) => {
                let body = if binary {
                    base64::engine::general_purpose::STANDARD.encode(&body)
                } else {
                    String::from_utf8_lossy(&body).into_owned()
                };
                json!({ "status": status, "headers": headers, "body": body })
            }
            Err(error) => json!({ "error": error }),
        }),
    );
}

fn declared(url: &str, schemes: &[&str], permissions: &Permissions) -> Result<url::Url, String> {
    let url = match url::Url::parse(url) {
        Ok(url) if schemes.contains(&url.scheme()) && url.username().is_empty() && url.password().is_none() => url,
        _ => return Err(format!("Only {} URLs without credentials are allowed", schemes.join(", "))),
    };
    if !permissions.network.iter().any(|origin| origin_matches(origin, &url)) {
        return Err(format!("{} is not declared in [permissions] network", url.origin().ascii_serialization()));
    }
    Ok(url)
}

fn image_url(url: &str, permissions: &Permissions) -> Result<url::Url, String> {
    if !is_loopback(url) {
        return declared(url, &["http", "https"], permissions);
    }
    let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
    let port = parsed.port().ok_or("Loopback URLs need an explicit port")?;
    if !matches!(parsed.scheme(), "http" | "https") || !permissions.allows_port(port) {
        return Err(format!("Port {port} is outside the declared loopback ranges"));
    }
    Ok(parsed)
}

pub fn image(manifest: &Manifest, url: &str) -> Result<String, String> {
    let url = image_url(url, &manifest.permissions)?;
    let (status, headers, body) = send_remote(url.as_str(), "GET", &[], String::new(), Duration::from_secs(10))?;
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}"));
    }
    let kind =
        headers.get("content-type").and_then(|t| t.split(';').next()).unwrap_or_default().trim().to_ascii_lowercase();
    if !IMAGE_TYPES.contains(&kind.as_str()) {
        return Err(format!("Unsupported image type {kind}"));
    }
    if body.len() > MAX_IMAGE {
        return Err("The image exceeds 1 MiB".into());
    }
    Ok(format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(&body)))
}

fn remote(session: &Arc<Session>, answer: Answer, command: &Value) {
    let url = match declared(command["url"].as_str().unwrap_or_default(), &["http", "https"], &session.permissions) {
        Ok(url) => url,
        Err(message) => return answer.denied(message),
    };
    let Some(((method, headers, body), timeout)) = begin(session, &answer, command) else {
        return;
    };
    let binary = command["binary"].as_bool().unwrap_or(false);
    let session = session.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = send_remote(url.as_str(), &method, &headers, body, timeout);
        finish(&session, &answer, result, binary);
    });
}

fn send_remote(
    url: &str,
    method: &str,
    headers: &[(String, String)],
    body: String,
    timeout: Duration,
) -> Result<Response, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        .max_redirects(0)
        .max_redirects_will_error(false)
        .http_status_as_error(false)
        .build()
        .into();
    let mut request = ureq::http::Request::builder().method(method).uri(url);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    let mut response = if body.is_empty() {
        agent.run(request.body(()).map_err(|e| e.to_string())?)
    } else {
        agent.run(request.body(body.into_bytes()).map_err(|e| e.to_string())?)
    }
    .map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| (name.as_str().to_string(), String::from_utf8_lossy(value.as_bytes()).into_owned()))
        .collect();
    let body = if method == "HEAD" {
        Vec::new()
    } else {
        response.body_mut().with_config().limit(MAX_DATA as u64).read_to_vec().map_err(|e| e.to_string())?
    };
    Ok((status, headers, body))
}

fn http(session: &Arc<Session>, answer: Answer, command: &Value) {
    let (port, path) = match loopback(command["url"].as_str().unwrap_or_default(), &["http"], &session.permissions) {
        Ok(target) => target,
        Err(message) => return answer.denied(message),
    };
    let Some(((method, headers, body), timeout)) = begin(session, &answer, command) else {
        return;
    };
    let binary = command["binary"].as_bool().unwrap_or(false);
    let headers: String = headers.iter().map(|(name, value)| format!("{name}: {value}\r\n")).collect();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: */*\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let session = session.clone();
    tauri::async_runtime::spawn(async move {
        let result = tokio::time::timeout(timeout, fetch(port, request, method == "HEAD"))
            .await
            .unwrap_or_else(|_| Err("Timed out".into()));
        finish(&session, &answer, result, binary);
    });
}

type Response = (u16, BTreeMap<String, String>, Vec<u8>);

async fn fetch(port: u16, request: String, head: bool) -> Result<Response, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.map_err(|e| e.to_string())?;
    stream.write_all(request.as_bytes()).await.map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    loop {
        let read = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
        raw.extend_from_slice(&buf[..read]);
        if raw.len() > MAX_DATA {
            return Err("The response exceeds 2 MiB".into());
        }
        if let Some(response) = parse_response(&raw, read == 0, head)? {
            return Ok(response);
        }
        if read == 0 {
            return Err("The connection closed before the response ended".into());
        }
    }
}

fn parse_response(raw: &[u8], eof: bool, head: bool) -> Result<Option<Response>, String> {
    let Some(split) = raw.windows(4).position(|w| w == b"\r\n\r\n") else {
        return Ok(None);
    };
    let text = String::from_utf8_lossy(&raw[..split]);
    let mut lines = text.lines();
    let status = lines
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse().ok())
        .ok_or("Malformed HTTP status")?;
    let headers: BTreeMap<String, String> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    let data = &raw[split + 4..];
    if head {
        return Ok(Some((status, headers, Vec::new())));
    }
    let body = if headers.get("transfer-encoding").is_some_and(|v| v.contains("chunked")) {
        match dechunk(data) {
            Some(body) => body,
            None if eof => return Err("Malformed chunked body".into()),
            None => return Ok(None),
        }
    } else if let Some(length) = headers.get("content-length") {
        let length: usize = length.parse().map_err(|_| "Malformed Content-Length")?;
        if data.len() < length {
            return Ok(None);
        }
        data[..length].to_vec()
    } else if eof || status == 204 || status == 304 {
        data.to_vec()
    } else {
        return Ok(None);
    };
    Ok(Some((status, headers, body)))
}

fn dechunk(mut data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let line = data.windows(2).position(|w| w == b"\r\n")?;
        let size_text = std::str::from_utf8(&data[..line]).ok()?;
        let size = usize::from_str_radix(size_text.split(';').next()?.trim(), 16).ok()?;
        data = &data[line + 2..];
        if size == 0 {
            return Some(out);
        }
        out.extend_from_slice(data.get(..size)?);
        data = data.get(size + 2..)?;
    }
}

fn ws_open(session: &Arc<Session>, answer: Answer, command: &Value) {
    let url = command["url"].as_str().unwrap_or_default().to_string();
    let checked = if is_loopback(&url) {
        loopback(&url, &["ws"], &session.permissions).map(drop)
    } else {
        declared(&url, &["ws", "wss"], &session.permissions).map(drop)
    };
    if let Err(message) = checked {
        return answer.denied(message);
    }
    let (tx, mut rx) = channel::<Message>(MAX_QUEUED);
    let serial = session.serial.fetch_add(1, Ordering::Relaxed);
    {
        let mut sockets = session.sockets.lock().unwrap();
        if sockets.len() >= MAX_SOCKETS && !sockets.contains_key(&answer.id) {
            drop(sockets);
            answer.send("wsClose", object(json!({ "reason": "Too many open sockets" })));
            return;
        }
        sockets.insert(answer.id.clone(), (serial, tx));
    }
    let weak = Arc::downgrade(session);
    tauri::async_runtime::spawn(async move {
        let config = WebSocketConfig::default().max_message_size(Some(16 << 20)).max_frame_size(Some(16 << 20));
        let connect = tokio_tungstenite::connect_async_with_config(url.as_str(), Some(config), true);
        let reason = match tokio::time::timeout(Duration::from_secs(5), connect).await {
            Ok(Ok((socket, _))) if answer.send("wsOpen", Map::new()) => {
                let (mut sink, mut stream) = socket.split();
                loop {
                    tokio::select! {
                        command = rx.recv() => match command {
                            Some(message) => if let Err(e) = sink.send(message).await { break e.to_string() },
                            None => { let _ = sink.close().await; break "Closed by the plugin".into() }
                        },
                        incoming = stream.next() => match incoming {
                            Some(Ok(Message::Text(text))) => {
                                if text.len() <= MAX_DATA && !answer.send("wsMessage", object(json!({ "data": text.as_str() }))) {
                                    return;
                                }
                            }
                            Some(Ok(Message::Close(_))) | None => break "Closed by the server".into(),
                            Some(Err(e)) => break e.to_string(),
                            _ => {}
                        }
                    }
                }
            }
            Ok(Ok(_)) => return,
            Ok(Err(e)) => e.to_string(),
            Err(_) => "Connection timed out".into(),
        };
        if let Some(session) = weak.upgrade() {
            let mut sockets = session.sockets.lock().unwrap();
            match sockets.get(&answer.id).map(|(current, _)| *current) {
                Some(current) if current != serial => return,
                Some(_) => drop(sockets.remove(&answer.id)),
                None => {}
            }
        }
        answer.send("wsClose", object(json!({ "reason": reason })));
    });
}

fn candidates(target: &LaunchTarget) -> &[String] {
    if cfg!(windows) {
        &target.windows
    } else if cfg!(target_os = "macos") {
        &target.macos
    } else {
        &target.linux
    }
}

fn expand(path: &str) -> Option<PathBuf> {
    let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
    let mut path = path.to_string();
    for name in ["LOCALAPPDATA", "APPDATA", "PROGRAMFILES(X86)", "PROGRAMFILES"] {
        let token = format!("%{name}%");
        if path.to_ascii_uppercase().contains(&token) {
            let value = env(name)?.to_string_lossy().into_owned();
            let at = path.to_ascii_uppercase().find(&token)?;
            path.replace_range(at..at + token.len(), &value);
        }
    }
    if let Some(rest) = path.strip_prefix("~/") {
        path = env(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?.join(rest).to_string_lossy().into_owned();
    }
    let path = PathBuf::from(path);
    (path.is_absolute() && !path.to_string_lossy().contains('%')).then_some(path)
}

fn installed(target: &LaunchTarget) -> Option<PathBuf> {
    candidates(target).iter().filter_map(|p| expand(p)).find(|p| p.exists())
}

fn app_status(target: &LaunchTarget) -> Value {
    let Some(path) = installed(target) else {
        return json!({ "installed": false, "processes": [] });
    };
    let processes: Vec<_> =
        crate::procs::find(&path).into_iter().map(|(pid, args)| json!({ "pid": pid, "args": args })).collect();
    json!({ "installed": true, "processes": processes })
}

#[cfg(windows)]
fn hidden(command: &mut Command, detached: bool) -> &mut Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(if detached { DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP } else { CREATE_NO_WINDOW })
}
#[cfg(not(windows))]
fn hidden(command: &mut Command, _detached: bool) -> &mut Command {
    command
}

fn app_launch(target: &LaunchTarget, values: &[u64]) -> Result<(), String> {
    let path = installed(target).ok_or_else(|| format!("{} is not installed", target.name))?;
    let args = opensd_package::fill_args(&target.args, values).map_err(|e| e.0)?;
    let mut command = if cfg!(target_os = "macos") {
        let mut open = Command::new("open");
        open.arg("-a").arg(&path).arg("--args").args(&args);
        open
    } else {
        let mut direct = actions::command(&path);
        direct.args(&args);
        if let Some(dir) = path.parent() {
            direct.current_dir(dir);
        }
        direct
    };
    let mut child = hidden(&mut command, true)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    std::thread::spawn(move || child.wait());
    crate::procs::forget();
    Ok(())
}

fn app_quit(target: &LaunchTarget) -> Result<(), String> {
    let path = installed(target).ok_or_else(|| format!("{} is not installed", target.name))?;
    for (pid, _) in crate::procs::find(&path) {
        let mut command = if cfg!(windows) {
            let mut kill = Command::new("taskkill");
            kill.args(["/PID", &pid.to_string(), "/T"]);
            kill
        } else if cfg!(target_os = "macos") {
            let name = path.file_stem().unwrap_or_default().to_string_lossy();
            let mut script = Command::new("osascript");
            script.args(["-e", "on run argv", "-e", "tell application (item 1 of argv) to quit", "-e", "end run"]);
            script.arg(&*name);
            script
        } else {
            let mut kill = Command::new("kill");
            kill.args(["-TERM", &pid.to_string()]);
            kill
        };
        hidden(&mut command, false).stdout(Stdio::null()).stderr(Stdio::null()).status().map_err(|e| e.to_string())?;
    }
    crate::procs::forget();
    Ok(())
}

mod clipboard {
    #[cfg(windows)]
    pub fn write(text: &str) -> Result<(), String> {
        use windows_sys::Win32::Foundation::GlobalFree;
        use windows_sys::Win32::System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock},
        };
        const CF_UNICODETEXT: u32 = 13;
        let wide: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
        let opened = (0..10).any(|_| {
            let ok = unsafe { OpenClipboard(std::ptr::null_mut()) } != 0;
            if !ok {
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            ok
        });
        if !opened {
            return Err("Clipboard is busy".into());
        }
        let result = unsafe {
            (|| {
                if EmptyClipboard() == 0 {
                    return Err("Cannot empty the clipboard");
                }
                let memory = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2);
                if memory.is_null() {
                    return Err("Out of memory");
                }
                let target = GlobalLock(memory) as *mut u16;
                if target.is_null() {
                    GlobalFree(memory);
                    return Err("Cannot lock clipboard memory");
                }
                std::ptr::copy_nonoverlapping(wide.as_ptr(), target, wide.len());
                GlobalUnlock(memory);
                if SetClipboardData(CF_UNICODETEXT, memory).is_null() {
                    GlobalFree(memory);
                    return Err("Cannot set clipboard data");
                }
                Ok(())
            })()
        };
        unsafe { CloseClipboard() };
        result.map_err(String::from)
    }

    #[cfg(not(windows))]
    pub fn write(text: &str) -> Result<(), String> {
        use std::io::Write;
        use std::process::Stdio;
        let tools: &[(&str, &[&str])] = if cfg!(target_os = "macos") {
            &[("pbcopy", &[])]
        } else {
            &[("wl-copy", &[]), ("xclip", &["-selection", "clipboard"])]
        };
        for (tool, args) in tools {
            let Ok(mut child) = crate::actions::command(tool).args(*args).stdin(Stdio::piped()).spawn() else {
                continue;
            };
            let written = child.stdin.take().is_some_and(|mut stdin| stdin.write_all(text.as_bytes()).is_ok());
            if child.wait().is_ok_and(|status| status.success()) && written {
                return Ok(());
            }
        }
        Err("No working clipboard tool (pbcopy, wl-copy or xclip)".into())
    }
}

#[derive(Clone, Serialize)]
pub struct Permission {
    pub kind: &'static str,
    pub title: String,
    pub detail: String,
}

pub fn describe(p: &Permissions) -> Vec<Permission> {
    let mut items = Vec::new();
    let mut add = |kind, title, detail| items.push(Permission { kind, title, detail });
    if !p.loopback.is_empty() {
        add(
            "loopback",
            tr!("Программы на этом компьютере", "Programs on this computer", "本机程序"),
            tr!("127.0.0.1, порты {}", "127.0.0.1, ports {}", "127.0.0.1，端口 {}", p.loopback.join(", ")),
        );
    }
    for origin in &p.network {
        add("network", tr!("Доступ в интернет", "Internet access", "网络访问"), origin.clone());
    }
    for target in &p.launch {
        let args = if target.args.is_empty() { String::new() } else { format!(" {}", target.args.join(" ")) };
        add(
            "launch",
            tr!("Запуск и закрытие «{}»", "Start and close “{}”", "启动和关闭“{}”", target.name),
            format!("{}{}", candidates(target).join("; "), args),
        );
    }
    if p.clipboard {
        add(
            "clipboard",
            tr!("Буфер обмена", "Clipboard", "剪贴板"),
            tr!("Запись текста в буфер обмена", "Write text to the clipboard", "向剪贴板写入文本"),
        );
    }
    if p.keyboard {
        add(
            "keyboard",
            tr!("Клавиатура", "Keyboard", "键盘"),
            tr!(
                "Нажатие клавиш и ввод текста в активном окне",
                "Press keys and type text in the active window",
                "在活动窗口中按键和输入文本"
            ),
        );
    }
    if p.navigation {
        add(
            "navigation",
            tr!("Профили и страницы", "Profiles and pages", "配置文件和页面"),
            tr!("Переключение профилей и страниц", "Switch profiles and pages", "切换配置文件和页面"),
        );
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_urls_stay_on_declared_ports() {
        let p = Permissions { loopback: vec!["9222-9223".into()], ..Default::default() };
        assert_eq!(loopback("http://127.0.0.1:9222/json/list", &["http"], &p).unwrap(), (9222, "/json/list".into()));
        assert_eq!(loopback("ws://localhost:9223", &["ws"], &p).unwrap().1, "/");
        for bad in [
            "http://127.0.0.1:9300/",
            "http://example.com:9222/",
            "http://127.0.0.1.evil:9222/",
            "http://user@127.0.0.1:9222/",
            "ws://127.0.0.1:9222/",
            "http://127.0.0.1:9222/a b",
            "http://127.0.0.1/",
        ] {
            assert!(loopback(bad, &["http"], &p).is_err(), "{bad}");
        }
    }

    #[test]
    fn chunked_bodies_decode() {
        assert_eq!(dechunk(b"3\r\nabc\r\n2;x\r\nde\r\n0\r\n\r\n").unwrap(), b"abcde");
        assert!(dechunk(b"5\r\nab").is_none());
    }

    #[test]
    fn responses_end_without_the_connection_closing() {
        let head = b"HTTP/1.1 200 OK\r\nContent-Length:5\r\nX-Test: yes\r\n\r\n";
        assert_eq!(parse_response(&[&head[..], b"ab"].concat(), false, false).unwrap(), None);
        let (status, headers, body) = parse_response(&[&head[..], b"abcde"].concat(), false, false).unwrap().unwrap();
        assert_eq!((status, &body[..], headers["x-test"].as_str()), (200, &b"abcde"[..], "yes"));
        let chunked = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nok\r\n0\r\n\r\n";
        assert_eq!(parse_response(chunked, false, false).unwrap().unwrap().2, b"ok");
        let open = b"HTTP/1.0 200 OK\r\n\r\nrest";
        assert_eq!(parse_response(open, false, false).unwrap(), None);
        assert_eq!(parse_response(open, true, false).unwrap().unwrap().2, b"rest");
        assert_eq!(
            parse_response(b"HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\n", false, true).unwrap().unwrap().0,
            200
        );
    }

    #[test]
    fn network_origins_match_like_csp() {
        let url = |u: &str| url::Url::parse(u).unwrap();
        assert!(origin_matches("https://api.example.com", &url("https://api.example.com/v1")));
        assert!(origin_matches("https://api.example.com", &url("https://api.example.com:443/")));
        assert!(!origin_matches("https://api.example.com", &url("https://api.example.com:8443/")));
        assert!(!origin_matches("https://api.example.com", &url("http://api.example.com/")));
        assert!(origin_matches("https://api.example.com", &url("wss://api.example.com/socket")));
        assert!(!origin_matches("https://api.example.com", &url("ws://api.example.com/socket")));
        assert!(!origin_matches("wss://api.example.com", &url("https://api.example.com/")));
        assert!(origin_matches("https://*.example.com", &url("https://a.b.example.com/")));
        assert!(!origin_matches("https://*.example.com", &url("https://example.com/")));
        assert!(!origin_matches("https://*.example.com", &url("https://evilexample.com/")));
        assert!(origin_matches("http://*:8123", &url("http://192.168.1.5:8123/api")));
        assert!(!origin_matches("http://*:8123", &url("http://192.168.1.5/api")));
        assert!(origin_matches("http://nas.local:*", &url("http://nas.local:5000/")));
        assert!(is_loopback("http://127.0.0.1:9222/") && is_loopback("ws://localhost:1/"));
        assert!(!is_loopback("http://127.0.0.1.evil.com/"));
    }

    #[test]
    fn denied_without_consent() {
        let manifest: Manifest = serde_json::from_value(json!({
            "sdk": 1, "id": "com.example.t", "name": "T", "version": "1.0.0", "author": "A",
            "runtime": { "type": "js", "main": "plugin.js" },
            "permissions": { "clipboard": true },
            "actions": [{ "id": "com.example.t.a", "name": "A" }]
        }))
        .unwrap();
        let replies = Arc::new(Mutex::new(Vec::new()));
        let sink = replies.clone();
        let reply: Reply = Arc::new(move |v| {
            sink.lock().unwrap().push(v);
            true
        });
        let session = Session::new(&manifest, false, reply.clone());
        handle(&session, &json!({ "type": "clipboard", "id": "c", "text": "x" }));
        assert_eq!(replies.lock().unwrap()[0]["type"], "denied");
        let granted = Session::new(&manifest, true, reply);
        handle(&granted, &json!({ "type": "http", "id": "h", "url": "http://127.0.0.1:9222/" }));
        assert_eq!(replies.lock().unwrap()[1]["type"], "denied", "no loopback permission");
        handle(&granted, &json!({ "type": "hotkey", "id": "k", "keys": "Ctrl + C" }));
        handle(&granted, &json!({ "type": "appWatch", "id": "w", "app": "x" }));
        handle(&granted, &json!({ "type": "wsOpen", "id": "s", "url": "wss://example.com/" }));
        let replies = replies.lock().unwrap();
        assert!(replies[2..].iter().all(|r| r["type"] == "denied"), "{replies:?}");
        assert!(replies[4]["message"].as_str().unwrap().contains("network"));
    }

    #[test]
    fn images_come_only_from_declared_places() {
        let p = Permissions {
            loopback: vec!["8000".into()],
            network: vec!["https://*.example.com".into()],
            ..Default::default()
        };
        assert!(image_url("https://cdn.example.com/a.png", &p).is_ok());
        assert!(image_url("http://127.0.0.1:8000/cover", &p).is_ok());
        for bad in [
            "https://evil.com/a.png",
            "http://127.0.0.1:8001/",
            "http://localhost/",
            "file:///c:/a.png",
            "data:image/png;base64,",
        ] {
            assert!(image_url(bad, &p).is_err(), "{bad}");
        }
    }
}

#[cfg(test)]
mod live {
    use super::*;

    fn target() -> LaunchTarget {
        LaunchTarget {
            id: "yandex-music".into(),
            name: "Яндекс Музыка".into(),
            windows: vec!["%LOCALAPPDATA%/Programs/YandexMusic/Яндекс Музыка.exe".into()],
            args: vec!["--remote-debugging-port={0}".into()],
            ..Default::default()
        }
    }

    #[test]
    #[ignore]
    fn finds_the_app_and_its_debug_port() {
        let status = app_status(&target());
        assert_eq!(status["installed"], true, "{status}");
        let args = status["processes"][0]["args"].to_string();
        assert!(args.contains("--remote-debugging-port="), "{status}");
    }

    #[test]
    #[ignore]
    fn http_reaches_devtools() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        runtime.block_on(async {
            let request = "GET /json/list HTTP/1.1\r\nHost: 127.0.0.1:9222\r\nConnection: close\r\n\r\n".to_string();
            let (status, _, body) = fetch(9222, request, false).await.unwrap();
            assert_eq!(status, 200);
            assert!(serde_json::from_slice::<Vec<Value>>(&body).is_ok());
        });
    }
}
