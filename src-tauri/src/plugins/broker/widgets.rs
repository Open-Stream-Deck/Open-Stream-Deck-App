use super::{Answer, Session, object};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::{Message, handshake::derive_accept_key, protocol::Role};

const PORT: u16 = 32420;
const MAX_STATE: usize = 256 * 1024;
struct Widget {
    owner: Weak<Session>,
    id: String,
    root: PathBuf,
    state: watch::Sender<Value>,
    closed: watch::Sender<bool>,
}
static ROUTES: OnceLock<Mutex<HashMap<String, Arc<Widget>>>> = OnceLock::new();
static STARTED: tokio::sync::Mutex<bool> = tokio::sync::Mutex::const_new(false);
fn routes() -> &'static Mutex<HashMap<String, Arc<Widget>>> {
    ROUTES.get_or_init(Mutex::default)
}

pub(super) fn close_session(session: &Session) {
    let owned: Vec<_> = session.widget_routes.lock().unwrap().drain(..).collect();
    let mut routes = routes().lock().unwrap();
    for route in owned {
        if routes.get(&route).is_some_and(|widget| std::ptr::eq(widget.owner.as_ptr(), session))
            && let Some(widget) = routes.remove(&route)
        {
            widget.closed.send_replace(true);
        }
    }
}

fn route(session: &Session, id: &str) -> String {
    format!("{:x}", Sha256::digest(format!("{}:{id}", session.widget_secret)))
}

pub(super) fn handle(session: &Arc<Session>, answer: Answer, command: &Value) {
    if !session.permissions.widgets {
        return answer.denied("The plugin declares no widgets permission");
    }
    let id = command["widget"].as_str().unwrap_or_default();
    if id.is_empty() || id.len() > 64 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
        return answer.denied("Invalid widget instance ID");
    }
    let key = route(session, id);
    match command["type"].as_str() {
        Some("widgetClose") => {
            if let Some(widget) = routes().lock().unwrap().remove(&key) {
                widget.closed.send_replace(true);
            }
            session.widget_routes.lock().unwrap().retain(|route| route != &key);
            answer.done(Ok(()));
        }
        Some("widgetState") => {
            let state = &command["state"];
            if state.to_string().len() > MAX_STATE {
                return answer.denied("Widget state exceeds 256 KiB");
            }
            let widget = routes().lock().unwrap().get(&key).cloned();
            match widget {
                Some(widget) => {
                    widget.state.send_replace(state.clone());
                    answer.done(Ok(()));
                }
                None => answer.done(Err("The widget is not open".into())),
            }
        }
        Some("widgetOpen") => {
            let directory = command["directory"].as_str().unwrap_or_default();
            if !opensd_package::safe_path(directory) {
                return answer.denied("Invalid widget directory");
            }
            let root = session.root.canonicalize().and_then(|base| {
                let path = base.join(directory).canonicalize()?;
                if !path.starts_with(base) || !path.is_dir() || !path.join("index.html").is_file() {
                    return Err(std::io::Error::other(
                        "Widget directory must contain index.html inside the plugin package",
                    ));
                }
                Ok(path)
            });
            let root = match root {
                Ok(root) => root,
                Err(error) => return answer.done(Err(error.to_string())),
            };
            let mut owned = session.widget_routes.lock().unwrap();
            if owned.len() >= 16 && !owned.contains(&key) {
                drop(owned);
                return answer.denied("At most 16 widget instances per plugin");
            }
            if !owned.contains(&key) {
                owned.push(key.clone());
            }
            let (state, _) = watch::channel(Value::Null);
            let (closed, _) = watch::channel(false);
            if let Some(previous) = routes().lock().unwrap().insert(
                key.clone(),
                Arc::new(Widget { owner: Arc::downgrade(session), id: id.into(), root, state, closed }),
            ) {
                previous.closed.send_replace(true);
            }
            tauri::async_runtime::spawn(async move {
                let result = start().await;
                match result {
                    Ok(()) => {
                        answer.send("widgetOpen", object(json!({ "url": format!("http://127.0.0.1:{PORT}/{key}/") })));
                    }
                    Err(error) => {
                        routes().lock().unwrap().remove(&key);
                        if let Some(session) = answer.session.upgrade() {
                            session.widget_routes.lock().unwrap().retain(|route| route != &key);
                        }
                        answer.done(Err(error));
                    }
                }
            });
        }
        _ => {}
    }
}

async fn start() -> Result<(), String> {
    let mut started = STARTED.lock().await;
    if *started {
        return Ok(());
    }
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, PORT)).await.map_err(|e| e.to_string())?;
    *started = true;
    tauri::async_runtime::spawn(async move {
        let permits = Arc::new(tokio::sync::Semaphore::new(64));
        while let Ok((socket, _)) = listener.accept().await {
            let Ok(permit) = permits.clone().try_acquire_owned() else { continue };
            tauri::async_runtime::spawn(async move {
                let _permit = permit;
                let _ = serve(socket).await;
            });
        }
        *STARTED.lock().await = false;
    });
    Ok(())
}

async fn response(socket: &mut TcpStream, status: &str, mime: &str, body: &[u8]) -> Result<(), String> {
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'\r\n\r\n",
        body.len()
    );
    socket.write_all(headers.as_bytes()).await.map_err(|e| e.to_string())?;
    socket.write_all(body).await.map_err(|e| e.to_string())
}

async fn serve(mut socket: TcpStream) -> Result<(), String> {
    let mut bytes = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let byte = socket.read_u8().await?;
            bytes.push(byte);
            if bytes.ends_with(b"\r\n\r\n") {
                break;
            }
            if bytes.len() > 8192 {
                return Err(std::io::Error::other("Headers too large"));
            }
        }
        Ok::<_, std::io::Error>(())
    })
    .await
    .map_err(|_| "Header timeout")?
    .map_err(|e| e.to_string())?;
    let request = std::str::from_utf8(&bytes).map_err(|e| e.to_string())?;
    let mut lines = request.split("\r\n");
    let first: Vec<_> = lines.next().unwrap_or_default().split_whitespace().collect();
    let headers: HashMap<_, _> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(key, value)| (key.to_ascii_lowercase(), value.trim()))
        .collect();
    let host = format!("127.0.0.1:{PORT}");
    if first.len() != 3 || first[0] != "GET" || headers.get("host").copied() != Some(host.as_str()) {
        return response(&mut socket, "400 Bad Request", "text/plain", b"Bad request").await;
    }
    let path = first[1].split('?').next().unwrap_or_default().trim_start_matches('/');
    let Some((key, relative)) = path.split_once('/') else {
        return response(&mut socket, "404 Not Found", "text/plain", b"Not found").await;
    };
    let widget = routes().lock().unwrap().get(key).cloned();
    let Some(widget) = widget.filter(|widget| widget.owner.upgrade().is_some()) else {
        return response(&mut socket, "404 Not Found", "text/plain", b"Not found").await;
    };
    if relative == "_socket" {
        let origin = format!("http://{host}");
        if headers.get("origin").copied() != Some(origin.as_str())
            || headers.get("upgrade").map(|v| v.to_ascii_lowercase()) != Some("websocket".into())
        {
            return response(&mut socket, "403 Forbidden", "text/plain", b"Forbidden").await;
        }
        let Some(key) = headers.get("sec-websocket-key") else { return Err("Missing WebSocket key".into()) };
        let accept = derive_accept_key(key.as_bytes());
        socket.write_all(format!("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n").as_bytes()).await.map_err(|e| e.to_string())?;
        let config =
            tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default().max_message_size(Some(64 * 1024));
        let mut ws = tokio_tungstenite::WebSocketStream::from_raw_socket(socket, Role::Server, Some(config)).await;
        let mut state = widget.state.subscribe();
        let mut closed = widget.closed.subscribe();
        if *closed.borrow() {
            return Ok(());
        }
        let initial = state.borrow_and_update().clone();
        ws.send(Message::text(json!({"type":"state","state":initial}).to_string())).await.map_err(|e| e.to_string())?;
        loop {
            tokio::select! {
                _ = closed.changed() => break,
                changed = state.changed() => {
                    if changed.is_err() || widget.owner.upgrade().is_none() { break; }
                    let value = state.borrow_and_update().clone();
                    ws.send(Message::text(json!({"type":"state","state":value}).to_string())).await.map_err(|e| e.to_string())?;
                }
                incoming = ws.next() => {
                    match incoming {
                        Some(Ok(Message::Text(text))) => {
                            let payload: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                            let Some(session) = widget.owner.upgrade() else { break };
                            if !(session.reply)(json!({"type":"widgetMessage","widget":widget.id,"payload":payload})) { break; }
                        }
                        Some(Ok(Message::Ping(data))) => { ws.send(Message::Pong(data)).await.map_err(|e| e.to_string())?; }
                        Some(Ok(Message::Pong(_))) => {}
                        _ => break,
                    }
                }
            }
        }
        return Ok(());
    }
    if relative == "_opensd.js" {
        return response(&mut socket, "200 OK", "text/javascript", include_bytes!("widget.js")).await;
    }
    let relative = if relative.is_empty() { "index.html" } else { relative };
    if !opensd_package::safe_path(relative) {
        return response(&mut socket, "404 Not Found", "text/plain", b"Not found").await;
    }
    let Ok(path) = widget.root.join(relative).canonicalize() else {
        return response(&mut socket, "404 Not Found", "text/plain", b"Not found").await;
    };
    if !path.starts_with(&widget.root)
        || !path.is_file()
        || path.metadata().map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024
    {
        return response(&mut socket, "404 Not Found", "text/plain", b"Not found").await;
    }
    let body = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    response(&mut socket, "200 OK", crate::plugins::files::mime(&path), &body).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn serves_only_instance_files_and_rejects_foreign_hosts() {
        let root = std::env::temp_dir().join(format!("opensd-widget-test-{}", crate::plugins::token().unwrap()));
        std::fs::create_dir_all(root.join("widget")).unwrap();
        std::fs::write(root.join("widget/index.html"), "widget body").unwrap();
        std::fs::write(root.join("private.txt"), "private").unwrap();
        let manifest: opensd_package::Manifest = serde_json::from_value(json!({
            "sdk":1,"id":"com.example.widget","name":"Widget","version":"1.0.0","author":"Example",
            "runtime":{"type":"js","main":"plugin.js"}, "permissions":{"widgets":true},
            "actions":[{"id":"com.example.widget.a","name":"A"}]
        }))
        .unwrap();
        let (outbound, mut messages) = tokio::sync::mpsc::unbounded_channel();
        let owner = Session::new(
            &manifest,
            true,
            Arc::new(move |value| outbound.send(value).is_ok()),
            root.clone(),
            "secret".into(),
        );
        let key = route(&owner, "test");
        let (state, _) = watch::channel(Value::Null);
        let (closed, _) = watch::channel(false);
        routes().lock().unwrap().insert(
            key.clone(),
            Arc::new(Widget {
                owner: Arc::downgrade(&owner),
                id: "test".into(),
                root: root.join("widget").canonicalize().unwrap(),
                state,
                closed,
            }),
        );
        owner.widget_routes.lock().unwrap().push(key.clone());
        for (path, host, expected) in [
            (format!("/{key}/"), "127.0.0.1:32420", "200 OK"),
            (format!("/{key}/../private.txt"), "127.0.0.1:32420", "404 Not Found"),
            (format!("/{key}/"), "evil.example:32420", "400 Bad Request"),
            ("/unknown/index.html".into(), "127.0.0.1:32420", "404 Not Found"),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let serving = tokio::spawn(async move { serve(listener.accept().await.unwrap().0).await.unwrap() });
            let mut client = TcpStream::connect(address).await.unwrap();
            client.write_all(format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n\r\n").as_bytes()).await.unwrap();
            let mut response = String::new();
            client.read_to_string(&mut response).await.unwrap();
            assert!(response.starts_with(&format!("HTTP/1.1 {expected}")), "{response}");
            assert!(!response.contains("\r\n\r\nprivate"));
            serving.await.unwrap();
        }
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let serving = tokio::spawn(async move { serve(listener.accept().await.unwrap().0).await.unwrap() });
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;
        let mut request = format!("ws://{address}/{key}/_socket").into_client_request().unwrap();
        request.headers_mut().insert("Host", "127.0.0.1:32420".parse().unwrap());
        request.headers_mut().insert("Origin", "http://127.0.0.1:32420".parse().unwrap());
        let (mut client, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        let initial = client.next().await.unwrap().unwrap();
        assert_eq!(serde_json::from_str::<Value>(initial.to_text().unwrap()).unwrap()["state"], Value::Null);
        let state = routes().lock().unwrap().get(&key).unwrap().clone();
        state.state.send_replace(json!({"score":7}));
        let update = client.next().await.unwrap().unwrap();
        assert_eq!(serde_json::from_str::<Value>(update.to_text().unwrap()).unwrap()["state"]["score"], 7);
        client.send(Message::text(json!({"action":"increment"}).to_string())).await.unwrap();
        let received = tokio::time::timeout(Duration::from_secs(1), messages.recv()).await.unwrap().unwrap();
        assert_eq!(received["type"], "widgetMessage");
        assert_eq!(received["widget"], "test");
        assert_eq!(received["payload"]["action"], "increment");
        close_session(&owner);
        tokio::time::timeout(Duration::from_secs(1), serving).await.unwrap().unwrap();
        assert!(!routes().lock().unwrap().contains_key(&key));
        std::fs::remove_dir_all(root).unwrap();
    }
}
