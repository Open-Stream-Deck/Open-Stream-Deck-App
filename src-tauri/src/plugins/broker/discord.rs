use super::{Answer, Session, object};
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;

trait Transport: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Transport for T {}
type Connection = Box<dyn Transport>;
static ACTIVE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(super) fn handle(session: &Arc<Session>, answer: Answer, command: &Value) {
    match command["type"].as_str() {
        Some("discordOpen") => {
            let application = command["application"].as_str().unwrap_or_default();
            if !session.permissions.discord.iter().any(|allowed| allowed == application) {
                return answer.denied("The Discord application is not declared in permissions.discord");
            }
            let mut slot = session.discord.lock().unwrap();
            if slot.is_some() {
                drop(slot);
                return answer.denied("Close the existing Discord connection first");
            }
            let (tx, rx) = mpsc::channel(32);
            let owner = tx.downgrade();
            *slot = Some(tx);
            let application = application.to_string();
            tauri::async_runtime::spawn(async move {
                let result = run(&answer, &application, rx).await;
                answer
                    .send("discordClose", object(json!({ "reason": result.err().unwrap_or_else(|| "closed".into()) })));
                if let Some(session) = answer.session.upgrade() {
                    let mut slot = session.discord.lock().unwrap();
                    if owner.upgrade().is_some_and(|tx| slot.as_ref().is_some_and(|active| active.same_channel(&tx))) {
                        slot.take();
                    }
                }
            });
        }
        Some("discordClose") => {
            session.discord.lock().unwrap().take();
            answer.done(Ok(()));
        }
        Some("discordSend") => {
            let payload = &command["payload"];
            if !payload.is_object() || payload.get("args").is_some_and(|args| !args.is_object()) {
                return answer.denied("Discord payload and args must be objects");
            }
            let cmd = payload["cmd"].as_str().unwrap_or_default();
            if !matches!(
                cmd,
                "SET_ACTIVITY"
                    | "SUBSCRIBE"
                    | "UNSUBSCRIBE"
                    | "SEND_ACTIVITY_JOIN_INVITE"
                    | "CLOSE_ACTIVITY_JOIN_REQUEST"
            ) {
                return answer.denied("Unsupported Discord Rich Presence command");
            }
            if payload.to_string().len() > 16 * 1024 {
                return answer.denied("Discord payload exceeds 16 KiB");
            }
            let mut payload = payload.clone();
            payload["nonce"] = json!(answer.id);
            if cmd == "SET_ACTIVITY" {
                payload["args"]["pid"] = json!(std::process::id());
            }
            let sent = session.discord.lock().unwrap().as_ref().is_some_and(|tx| tx.try_send(payload).is_ok());
            if !sent {
                answer.done(Err("Discord is disconnected or its queue is full".into()));
            }
        }
        _ => {}
    }
}

async fn connect() -> Result<Connection, String> {
    for index in 0..10 {
        #[cfg(windows)]
        if let Ok(pipe) =
            tokio::net::windows::named_pipe::ClientOptions::new().open(format!(r"\\.\pipe\discord-ipc-{index}"))
        {
            return Ok(Box::new(pipe));
        }
        #[cfg(unix)]
        {
            let mut roots: Vec<std::path::PathBuf> = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
                .iter()
                .filter_map(std::env::var_os)
                .map(Into::into)
                .collect();
            roots.push("/tmp".into());
            for root in roots {
                for directory in [root.clone(), root.join("app/com.discordapp.Discord"), root.join("snap.discord")] {
                    if let Ok(socket) =
                        tokio::net::UnixStream::connect(directory.join(format!("discord-ipc-{index}"))).await
                    {
                        return Ok(Box::new(socket));
                    }
                }
            }
        }
    }
    Err("Discord is not running or its IPC endpoint is unavailable".into())
}

async fn write(connection: &mut Connection, opcode: u32, body: &[u8]) -> Result<(), String> {
    connection.write_u32_le(opcode).await.map_err(|e| e.to_string())?;
    connection.write_u32_le(body.len() as u32).await.map_err(|e| e.to_string())?;
    connection.write_all(body).await.map_err(|e| e.to_string())
}

async fn read(connection: &mut (impl AsyncRead + Unpin)) -> Result<(u32, Vec<u8>), String> {
    let opcode = connection.read_u32_le().await.map_err(|e| e.to_string())?;
    let size = connection.read_u32_le().await.map_err(|e| e.to_string())?;
    if size > 64 * 1024 {
        return Err("Discord frame exceeds 64 KiB".into());
    }
    let mut body = vec![0; size as usize];
    connection.read_exact(&mut body).await.map_err(|e| e.to_string())?;
    Ok((opcode, body))
}

async fn run(answer: &Answer, application: &str, mut commands: mpsc::Receiver<Value>) -> Result<(), String> {
    let _lease = ACTIVE.try_lock().map_err(|_| "Another plugin is using Discord RPC".to_string())?;
    let mut connection = connect().await?;
    write(&mut connection, 0, json!({ "v": 1, "client_id": application }).to_string().as_bytes()).await?;
    let (opcode, body) = tokio::time::timeout(Duration::from_secs(10), read(&mut connection))
        .await
        .map_err(|_| "Discord handshake timed out".to_string())??;
    let ready: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    if opcode != 1 || ready["evt"] != "READY" {
        return Err(format!("Discord handshake failed: {ready}"));
    }
    if !answer.send("discordOpen", object(json!({}))) {
        return Ok(());
    }
    let (mut reader, mut writer) = tokio::io::split(connection);
    let (frames_tx, mut frames) = mpsc::channel(32);
    let reading = tauri::async_runtime::spawn(async move {
        loop {
            let frame = read(&mut reader).await;
            let failed = frame.is_err();
            if frames_tx.send(frame).await.is_err() || failed {
                break;
            }
        }
    });
    let mut outstanding = std::collections::BTreeSet::new();
    let result = async {
        loop {
            tokio::select! {
                command = commands.recv() => {
                    let Some(command) = command else { return Ok(()) };
                    if let Some(nonce) = command["nonce"].as_str() { outstanding.insert(nonce.to_string()); }
                    let body = command.to_string();
                    writer.write_u32_le(1).await.map_err(|e| e.to_string())?;
                    writer.write_u32_le(body.len() as u32).await.map_err(|e| e.to_string())?;
                    writer.write_all(body.as_bytes()).await.map_err(|e| e.to_string())?;
                }
                frame = frames.recv() => {
                    let (opcode, body) = frame.ok_or("Discord disconnected")??;
                    match opcode {
                        1 => {
                            let payload: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
                            if let Some(nonce) = payload["nonce"].as_str() {
                                outstanding.remove(nonce);
                                let Some(session) = answer.session.upgrade() else { return Ok(()) };
                                let error = (payload["evt"] == "ERROR").then(|| payload["data"]["message"].as_str().unwrap_or("Discord command failed").to_string());
                                (session.reply)(json!({ "type": "discordReply", "id": nonce, "payload": payload, "error": error }));
                            } else if !answer.send("discordEvent", object(json!({ "payload": payload }))) {
                                return Ok(());
                            }
                        }
                        2 => return Err("Discord closed the connection".into()),
                        3 => {
                            writer.write_u32_le(4).await.map_err(|e| e.to_string())?;
                            writer.write_u32_le(body.len() as u32).await.map_err(|e| e.to_string())?;
                            writer.write_all(&body).await.map_err(|e| e.to_string())?;
                        }
                        4 => {}
                        _ => return Err("Unknown Discord opcode".into()),
                    }
                }
            }
        }
    }.await;
    reading.abort();
    while let Ok(command) = commands.try_recv() {
        if let Some(nonce) = command["nonce"].as_str() {
            outstanding.insert(nonce.to_string());
        }
    }
    if let Some(session) = answer.session.upgrade() {
        for nonce in outstanding {
            (session.reply)(json!({ "type": "done", "id": nonce, "error": "Discord disconnected" }));
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reads_fragmented_frames_and_rejects_large_frames() {
        let (mut server, mut client) = tokio::io::duplex(128);
        let sending = tokio::spawn(async move {
            server.write_all(&1u32.to_le_bytes()).await.unwrap();
            server.write_all(&2u32.to_le_bytes()).await.unwrap();
            server.write_all(b"{}").await.unwrap();
            server.write_u32_le(1).await.unwrap();
            server.write_u32_le(65537).await.unwrap();
        });
        assert_eq!(read(&mut client).await.unwrap(), (1, b"{}".to_vec()));
        assert!(read(&mut client).await.unwrap_err().contains("64 KiB"));
        sending.await.unwrap();
    }
}
