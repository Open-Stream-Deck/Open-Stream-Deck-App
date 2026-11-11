use super::PluginHost;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const LEASE: Duration = Duration::from_secs(15);

pub struct Dev {
    discovery: PathBuf,
    token: Mutex<Option<String>>,
    leases: Mutex<HashMap<String, Instant>>,
}

impl Dev {
    pub fn new(discovery: PathBuf) -> Self {
        let _ = fs::remove_file(&discovery);
        Self { discovery, token: Mutex::new(None), leases: Mutex::default() }
    }

    pub fn enabled(&self) -> bool {
        self.token.lock().unwrap().is_some()
    }
}

impl PluginHost {
    pub fn dev_enable(self: &Arc<Self>, enabled: bool) -> Result<Value, String> {
        if enabled == self.dev.enabled() {
            return Ok(self.dev_status());
        }
        if !enabled {
            *self.dev.token.lock().unwrap() = None;
            let ids: Vec<String> = self.dev.leases.lock().unwrap().drain().map(|(id, _)| id).collect();
            for id in ids {
                self.dev_unlink(&id);
            }
            let _ = fs::remove_file(&self.dev.discovery);
            return Ok(self.dev_status());
        }
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let token = super::token()?;
        let endpoint = json!({ "port": port, "token": token, "pid": std::process::id() });
        fs::write(&self.dev.discovery, endpoint.to_string()).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.dev.discovery, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
        }
        *self.dev.token.lock().unwrap() = Some(token.clone());
        let weak = Arc::downgrade(self);
        std::thread::spawn(move || {
            loop {
                let Some(host) = weak.upgrade() else { break };
                if host.dev.token.lock().unwrap().as_deref() != Some(token.as_str()) {
                    break;
                }
                let expired: Vec<String> = host
                    .dev
                    .leases
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|(_, at)| at.elapsed() > LEASE)
                    .map(|(id, _)| id.clone())
                    .collect();
                for id in expired {
                    host.dev.leases.lock().unwrap().remove(&id);
                    host.dev_unlink(&id);
                }
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let _ = stream.set_nonblocking(false);
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                        let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
                        let result = read_request(&mut stream).and_then(|request| {
                            if request["token"].as_str() != Some(token.as_str()) {
                                return Err("Invalid developer session token".into());
                            }
                            host.dev_command(request["command"].as_str().unwrap_or_default(), &request["payload"])
                        });
                        let body = match result {
                            Ok(value) => json!({ "ok": true, "result": value }),
                            Err(error) => json!({ "ok": false, "error": error }),
                        }
                        .to_string();
                        let _ = write!(
                            stream,
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        );
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(50))
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(self.dev_status())
    }

    fn dev_command(&self, command: &str, payload: &Value) -> Result<Value, String> {
        let id = || payload["id"].as_str().filter(|id| opensd_package::valid_id(id)).ok_or("Missing plugin id");
        match command {
            "status" => Ok(self.dev_status()),
            "link" => {
                let id = id()?;
                let root = payload["root"].as_str().ok_or("Missing staged folder")?;
                let linked = self.dev_link(id, Path::new(root))?;
                self.dev.leases.lock().unwrap().insert(id.to_string(), Instant::now());
                Ok(linked)
            }
            "heartbeat" => {
                let id = id()?;
                match self.dev.leases.lock().unwrap().get_mut(id) {
                    Some(lease) => {
                        *lease = Instant::now();
                        Ok(json!({}))
                    }
                    None => Err("The developer link expired".into()),
                }
            }
            "unlink" => {
                let id = id()?;
                self.dev.leases.lock().unwrap().remove(id);
                self.dev_unlink(id);
                Ok(json!({}))
            }
            _ => Err(format!("Unknown developer command {command}")),
        }
    }
}

fn read_request(stream: &mut TcpStream) -> Result<Value, String> {
    let mut header = Vec::new();
    while !header.ends_with(b"\r\n\r\n") {
        if header.len() >= 8192 {
            return Err("Request header too large".into());
        }
        let mut b = [0];
        stream.read_exact(&mut b).map_err(|e| e.to_string())?;
        header.push(b[0]);
    }
    let header = std::str::from_utf8(&header).map_err(|e| e.to_string())?;
    let mut lines = header.split("\r\n");
    if lines.next() != Some("POST /dev HTTP/1.1") {
        return Err("Expected POST /dev".into());
    }
    let mut size = None;
    for line in lines.filter(|l| !l.is_empty()) {
        let (key, value) = line.split_once(':').ok_or("Invalid header")?;
        if key.eq_ignore_ascii_case("Origin") || key.eq_ignore_ascii_case("Transfer-Encoding") {
            return Err("Browser and chunked requests are not accepted".into());
        }
        if key.eq_ignore_ascii_case("Content-Length") {
            if size.is_some() {
                return Err("Duplicate Content-Length".into());
            }
            size = Some(value.trim().parse::<usize>().map_err(|e| e.to_string())?);
        }
    }
    let size = size.ok_or("Missing Content-Length")?;
    if size > 1024 * 1024 {
        return Err("Request too large".into());
    }
    let mut body = vec![0; size];
    stream.read_exact(&mut body).map_err(|e| e.to_string())?;
    serde_json::from_slice(&body).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(bytes: &[u8]) -> Result<Value, String> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
            read_request(&mut stream)
        });
        let mut client = TcpStream::connect(addr).unwrap();
        client.write_all(bytes).unwrap();
        let _ = client.shutdown(std::net::Shutdown::Write);
        worker.join().unwrap()
    }

    #[test]
    fn rejects_browsers_and_ambiguous_lengths() {
        assert!(request(b"POST /dev HTTP/1.1\r\nOrigin: http://localhost\r\nContent-Length: 2\r\n\r\n{}").is_err());
        assert!(request(b"POST /dev HTTP/1.1\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}").is_err());
        assert!(request(b"POST /dev HTTP/1.1\r\nContent-Length: 1048577\r\n\r\n").is_err());
        assert!(request(b"POST /dev HTTP/1.1\r\nContent-Length: 10\r\n\r\n{}").is_err());
        assert_eq!(request(b"POST /dev HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}").unwrap(), json!({}));
    }
}
