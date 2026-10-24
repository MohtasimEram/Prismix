//! Discord Rich Presence through the Discord desktop app's local RPC socket
//! (src/desktop/discord.ts), as the Compose desktop app does.
//!
//! No account token is involved: the Discord client on this machine shows
//! the activity for whoever is signed in to it. The socket is a named pipe
//! on Windows (`\\.\pipe\discord-ipc-N`) and a Unix socket elsewhere
//! (`$XDG_RUNTIME_DIR/discord-ipc-N`, `$TMPDIR/...`, Flatpak/Snap paths).
//!
//! Frames are `[opcode u32 LE][length u32 LE][JSON]`. One background worker
//! owns the connection: it reconnects while presence is wanted, re-sends the
//! latest activity after a reconnect, and answers Discord's pings.
//!
//! The Discord application id comes from `PRISMIX_DISCORD_CLIENT_ID`
//! (at build time, or overridden at run time); its name and icon are what
//! Discord shows as "Listening to …".

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::async_runtime::JoinHandle;
use tauri::State;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, WriteHalf};
use tokio::sync::{mpsc, watch};

use crate::error::{AppError, AppResult};

/// Build with `PRISMIX_DISCORD_CLIENT_ID=<your application id>` (Discord Developer Portal › Applications).
const BUILT_IN_CLIENT_ID: Option<&str> = option_env!("PRISMIX_DISCORD_CLIENT_ID");

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;
const OP_PING: u32 = 3;
const OP_PONG: u32 = 4;

const MAX_FRAME_BYTES: usize = 64 * 1024;
const MAX_ACTIVITY_BYTES: usize = 16 * 1024;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(6);
const RETRY_EVERY: Duration = Duration::from_secs(15);
const SETTLE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    #[default]
    Off,
    Connecting,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordUser {
    id: String,
    username: String,
    global_name: Option<String>,
    avatar: Option<String>,
}

/// The shape src/desktop/discord.ts reads (`IpcState`).
#[derive(Debug, Clone, Default, Serialize)]
pub struct IpcState {
    status: Status,
    user: Option<DiscordUser>,
    problem: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct Desired {
    run: bool,
    activity: Option<Value>,
}

pub struct Discord {
    state: Arc<Mutex<IpcState>>,
    desired: watch::Sender<Desired>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl Default for Discord {
    fn default() -> Self {
        Self::new()
    }
}

impl Discord {
    pub fn new() -> Self {
        let (desired, _) = watch::channel(Desired::default());
        Self { state: Arc::new(Mutex::new(IpcState::default())), desired, worker: Mutex::new(None) }
    }

    fn snapshot(&self) -> IpcState {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn start(&self) {
        self.desired.send_modify(|d| d.run = true);
        let mut worker = self.worker.lock().unwrap_or_else(|e| e.into_inner());
        if worker.as_ref().is_some_and(|w| !w.inner().is_finished()) {
            return;
        }
        set(&self.state, |s| {
            s.status = Status::Connecting;
            s.problem = None;
        });
        *worker = Some(tauri::async_runtime::spawn(run(self.state.clone(), self.desired.subscribe())));
    }

    /// Waits until the worker has either connected or given a reason it couldn't.
    async fn settled(&self) -> IpcState {
        let deadline = tokio::time::Instant::now() + SETTLE_TIMEOUT;
        loop {
            let state = self.snapshot();
            if state.status != Status::Connecting || tokio::time::Instant::now() >= deadline {
                return state;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

fn set(state: &Mutex<IpcState>, f: impl FnOnce(&mut IpcState)) {
    f(&mut state.lock().unwrap_or_else(|e| e.into_inner()));
}

fn client_id() -> Option<String> {
    std::env::var("PRISMIX_DISCORD_CLIENT_ID")
        .ok()
        .or_else(|| BUILT_IN_CLIENT_ID.map(str::to_owned))
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty() && id.len() <= 32 && id.bytes().all(|b| b.is_ascii_digit()))
}

// ---- Transport ------------------------------------------------------------------

trait Duplex: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Duplex for T {}
type Pipe = Box<dyn Duplex>;

#[cfg(windows)]
async fn open_pipe() -> Option<Pipe> {
    use tokio::net::windows::named_pipe::ClientOptions;
    for i in 0..10 {
        if let Ok(client) = ClientOptions::new().open(format!(r"\\.\pipe\discord-ipc-{i}")) {
            return Some(Box::new(client));
        }
    }
    None
}

#[cfg(unix)]
async fn open_pipe() -> Option<Pipe> {
    use std::path::PathBuf;
    let mut bases: Vec<PathBuf> = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
        .iter()
        .filter_map(|var| std::env::var_os(var))
        .map(PathBuf::from)
        .collect();
    bases.push(PathBuf::from("/tmp"));
    #[cfg(target_os = "linux")]
    {
        // For sessions started without XDG_RUNTIME_DIR in the environment.
        use std::os::unix::fs::MetadataExt;
        if let Ok(meta) = std::fs::metadata("/proc/self") {
            bases.push(PathBuf::from(format!("/run/user/{}", meta.uid())));
        }
    }
    bases.dedup();
    // Plain installs, then Flatpak and Snap sandboxes (stable, Canary, Vesktop).
    let subdirs = ["", "app/com.discordapp.Discord", "app/com.discordapp.DiscordCanary", "app/dev.vencord.Vesktop", ".flatpak/dev.vencord.Vesktop/xdg-run", "snap.discord", "snap.discord-canary"];
    for base in &bases {
        for sub in subdirs {
            for i in 0..10 {
                let path = base.join(sub).join(format!("discord-ipc-{i}"));
                if let Ok(stream) = tokio::net::UnixStream::connect(&path).await {
                    return Some(Box::new(stream));
                }
            }
        }
    }
    None
}

async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, op: u32, payload: &Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(payload).map_err(std::io::Error::other)?;
    let mut frame = Vec::with_capacity(8 + body.len());
    frame.extend_from_slice(&op.to_le_bytes());
    frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
    frame.extend_from_slice(&body);
    writer.write_all(&frame).await?;
    writer.flush().await
}

async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> std::io::Result<(u32, Value)> {
    let mut header = [0u8; 8];
    reader.read_exact(&mut header).await?;
    let op = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let len = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    if len > MAX_FRAME_BYTES {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "Discord sent an oversized frame"));
    }
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).await?;
    let value = if body.is_empty() { Value::Null } else { serde_json::from_slice(&body).unwrap_or(Value::Null) };
    Ok((op, value))
}

fn close_message(payload: &Value) -> String {
    let message = payload.get("message").and_then(Value::as_str).unwrap_or("Discord closed the connection");
    match payload.get("code").and_then(Value::as_u64) {
        Some(4000) => "Discord rejected Prismix's application id".to_owned(),
        Some(code) => format!("{message} ({code})"),
        None => message.to_owned(),
    }
}

fn user_of(payload: &Value) -> Option<DiscordUser> {
    let user = payload.pointer("/data/user")?;
    let text = |key: &str| user.get(key).and_then(Value::as_str).map(str::to_owned);
    Some(DiscordUser {
        id: text("id")?,
        username: text("username").unwrap_or_else(|| "Discord".into()),
        global_name: text("global_name"),
        avatar: text("avatar"),
    })
}

/// Reads until Discord says READY (or refuses).
async fn handshake(pipe: &mut Pipe) -> Result<DiscordUser, String> {
    loop {
        let (op, payload) = read_frame(pipe).await.map_err(|e| format!("Discord didn't answer: {e}"))?;
        let event = payload.get("evt").and_then(Value::as_str);
        match op {
            OP_CLOSE => return Err(close_message(&payload)),
            OP_FRAME if event == Some("READY") => {
                return Ok(user_of(&payload).unwrap_or(DiscordUser { id: "0".into(), username: "Discord".into(), global_name: None, avatar: None }));
            }
            OP_FRAME if event == Some("ERROR") => {
                return Err(payload.pointer("/data/message").and_then(Value::as_str).unwrap_or("Discord refused the connection").to_owned());
            }
            _ => continue,
        }
    }
}

/// Opens the pipe and does the handshake; answers the signed-in Discord user.
async fn connect(client_id: &str) -> Result<(Pipe, DiscordUser), String> {
    let mut pipe = open_pipe().await.ok_or_else(|| "Discord isn't running. Open the Discord desktop app and Prismix will connect.".to_owned())?;
    write_frame(&mut pipe, OP_HANDSHAKE, &json!({ "v": 1, "client_id": client_id }))
        .await
        .map_err(|e| format!("Couldn't talk to Discord: {e}"))?;
    let user = tokio::time::timeout(HANDSHAKE_TIMEOUT, handshake(&mut pipe)).await.map_err(|_| "Discord didn't answer in time".to_owned())??;
    Ok((pipe, user))
}

// ---- Worker ---------------------------------------------------------------------

static NONCE: AtomicU64 = AtomicU64::new(1);

async fn send_activity(writer: &mut WriteHalf<Pipe>, activity: Option<&Value>) -> std::io::Result<()> {
    let nonce = NONCE.fetch_add(1, Ordering::Relaxed).to_string();
    let frame = json!({
        "cmd": "SET_ACTIVITY",
        "args": { "pid": std::process::id(), "activity": activity },
        "nonce": nonce,
    });
    write_frame(writer, OP_FRAME, &frame).await
}

/// Waits until presence is no longer wanted (or the app is shutting down).
async fn stopped(rx: &mut watch::Receiver<Desired>) {
    loop {
        if !rx.borrow_and_update().run {
            return;
        }
        if rx.changed().await.is_err() {
            return;
        }
    }
}

enum Ended {
    /// Presence was turned off: stop the worker.
    Stopped,
    /// The connection dropped: try again later.
    Lost(String),
}

/// One connected session: keeps Discord in step with `desired` until it ends.
async fn session(state: &Mutex<IpcState>, pipe: Pipe, rx: &mut watch::Receiver<Desired>) -> Ended {
    let (mut reader, mut writer) = tokio::io::split(pipe);
    // Reads go through their own task: a half-read frame is never abandoned by `select!`.
    let (frames_tx, mut frames) = mpsc::channel::<(u32, Value)>(16);
    let read_task = tauri::async_runtime::spawn(async move {
        while let Ok(frame) = read_frame(&mut reader).await {
            if frames_tx.send(frame).await.is_err() {
                break;
            }
        }
    });

    let mut sent: Option<Option<Value>> = None;
    let ended = loop {
        let desired = rx.borrow_and_update().clone();
        if !desired.run {
            let _ = send_activity(&mut writer, None).await;
            let _ = write_frame(&mut writer, OP_CLOSE, &json!({})).await;
            break Ended::Stopped;
        }
        if sent.as_ref() != Some(&desired.activity) {
            if let Err(error) = send_activity(&mut writer, desired.activity.as_ref()).await {
                break Ended::Lost(format!("Lost the connection to Discord: {error}"));
            }
            sent = Some(desired.activity);
        }
        tokio::select! {
            changed = rx.changed() => {
                if changed.is_err() {
                    break Ended::Stopped;
                }
            }
            frame = frames.recv() => match frame {
                None => break Ended::Lost("Discord closed the connection".into()),
                Some((OP_PING, payload)) => {
                    if write_frame(&mut writer, OP_PONG, &payload).await.is_err() {
                        break Ended::Lost("Lost the connection to Discord".into());
                    }
                }
                Some((OP_CLOSE, payload)) => break Ended::Lost(close_message(&payload)),
                Some((OP_FRAME, payload)) => {
                    if payload.get("evt").and_then(Value::as_str) == Some("ERROR") {
                        let message = payload.pointer("/data/message").and_then(Value::as_str).unwrap_or("Discord refused the activity").to_owned();
                        log::warn!("discord: {message}");
                        set(state, |s| s.problem = Some(message));
                    } else if payload.get("cmd").and_then(Value::as_str) == Some("SET_ACTIVITY") {
                        set(state, |s| s.problem = None);
                    }
                }
                Some(_) => {}
            }
        }
    };
    read_task.abort();
    let _ = writer.shutdown().await;
    ended
}

async fn run(state: Arc<Mutex<IpcState>>, mut rx: watch::Receiver<Desired>) {
    loop {
        if !rx.borrow().run {
            break;
        }
        let Some(id) = client_id() else {
            set(&state, |s| {
                s.status = Status::Error;
                s.problem = Some("This build of Prismix has no Discord application id (set PRISMIX_DISCORD_CLIENT_ID).".into());
            });
            stopped(&mut rx).await;
            break;
        };
        set(&state, |s| s.status = Status::Connecting);
        let problem = match connect(&id).await {
            Ok((pipe, user)) => {
                set(&state, |s| {
                    s.status = Status::Ready;
                    s.user = Some(user);
                    s.problem = None;
                });
                match session(&state, pipe, &mut rx).await {
                    Ended::Stopped => break,
                    Ended::Lost(problem) => problem,
                }
            }
            Err(problem) => problem,
        };
        set(&state, |s| {
            s.status = Status::Error;
            s.problem = Some(problem);
        });
        tokio::select! {
            _ = tokio::time::sleep(RETRY_EVERY) => {}
            _ = stopped(&mut rx) => {}
        }
    }
    set(&state, |s| *s = IpcState::default());
}

// ---- Commands -------------------------------------------------------------------

#[tauri::command]
pub fn discord_status(discord: State<'_, Discord>) -> IpcState {
    discord.snapshot()
}

#[tauri::command]
pub async fn discord_connect(discord: State<'_, Discord>) -> AppResult<IpcState> {
    discord.start();
    Ok(discord.settled().await)
}

#[tauri::command]
pub async fn discord_disconnect(discord: State<'_, Discord>) -> AppResult<IpcState> {
    discord.desired.send_modify(|d| {
        d.run = false;
        d.activity = None;
    });
    let worker = discord.worker.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(worker) = worker {
        // Give the worker a moment to clear the card and say goodbye; then stop it regardless.
        let abort = worker.inner().abort_handle();
        if tokio::time::timeout(Duration::from_secs(2), worker).await.is_err() {
            abort.abort();
        }
    }
    set(&discord.state, |s| *s = IpcState::default());
    Ok(discord.snapshot())
}

/// Shows (or with `null`, clears) the card. Setting one (re)starts the connection if needed,
/// so presence comes back after an app restart without another Connect.
#[tauri::command]
pub async fn discord_set_activity(discord: State<'_, Discord>, activity: Option<Value>) -> AppResult<IpcState> {
    let activity = activity.filter(|a| !a.is_null());
    if let Some(value) = &activity {
        if !value.is_object() {
            return Err(AppError::invalid("An activity must be an object"));
        }
        if serde_json::to_vec(value).map(|v| v.len()).unwrap_or(usize::MAX) > MAX_ACTIVITY_BYTES {
            return Err(AppError::invalid("The activity is too large"));
        }
    }
    let wanted = activity.is_some();
    discord.desired.send_modify(|d| d.activity = activity);
    if wanted {
        let running = discord.desired.borrow().run;
        discord.start();
        if !running {
            return Ok(discord.settled().await);
        }
    }
    Ok(discord.snapshot())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn frames_round_trip() {
        let (mut a, mut b) = tokio::io::duplex(1024);
        write_frame(&mut a, OP_FRAME, &json!({ "evt": "READY", "data": { "user": { "id": "1", "username": "u" } } })).await.unwrap();
        let (op, payload) = read_frame(&mut b).await.unwrap();
        assert_eq!(op, OP_FRAME);
        let user = user_of(&payload).unwrap();
        assert_eq!(user.id, "1");
        assert_eq!(user.global_name, None);
    }

    #[test]
    fn state_shape() {
        let json = serde_json::to_string(&IpcState::default()).unwrap();
        assert_eq!(json, r#"{"status":"off","user":null,"problem":null}"#);
        let user = DiscordUser { id: "1".into(), username: "u".into(), global_name: Some("U".into()), avatar: None };
        assert!(serde_json::to_string(&user).unwrap().contains(r#""globalName":"U""#));
    }
}
