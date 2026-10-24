//! WebSockets whose connection lives in Rust (src/desktop/nativeSocket.ts), for Listen Together.
//!
//! The party server only accepts browser Origins it knows, and the webview's
//! origin (tauri://localhost, http://tauri.localhost) isn't one. Rust dials as
//! a native client with no Origin header, which the server allows.
//!
//! Same guarantees as the native fetch: `wss://` only, public addresses only
//! (the TCP connection goes to an address the guard checked, so DNS can't be
//! rebound to the LAN between the check and the dial), text frames only, and a
//! cap on sizes and on how many sockets a page may hold open.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::netguard::{check_url, resolve_public};

const MAX_SOCKETS: usize = 8;
const MAX_PROTOCOLS: usize = 8;
const MAX_PROTOCOL_LEN: usize = 512;
const MAX_TEXT_BYTES: usize = 1024 * 1024;
const MAX_REASON_BYTES: usize = 123;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
const USER_AGENT: &str = concat!("Prismix-Desktop/", env!("CARGO_PKG_VERSION"));

/// What the page hears, in the shape nativeSocket.ts expects.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SocketEvent {
    Open { protocol: Option<String> },
    Message { data: String },
    #[serde(rename_all = "camelCase")]
    Close { code: u16, reason: String, was_clean: bool },
    Error { message: String },
}

enum Outgoing {
    Text(String),
    Close(u16, String),
}

#[derive(Default)]
pub struct Sockets {
    next: AtomicU32,
    open: Mutex<HashMap<u32, mpsc::UnboundedSender<Outgoing>>>,
}

impl Sockets {
    fn sender(&self, id: u32) -> Option<mpsc::UnboundedSender<Outgoing>> {
        self.open.lock().unwrap_or_else(|e| e.into_inner()).get(&id).cloned()
    }
    fn remove(&self, id: u32) {
        self.open.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    }
}

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// RFC 7230 `token`: what a Sec-WebSocket-Protocol entry may be made of.
fn valid_protocol(p: &str) -> bool {
    !p.is_empty() && p.len() <= MAX_PROTOCOL_LEN && p.bytes().all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

/// A close code the page may send (as the browser allows): 1000 or 3000–4999.
fn sendable_code(code: u16) -> u16 {
    if code == 1000 || (3000..=4999).contains(&code) {
        code
    } else {
        1000
    }
}

fn clip_reason(reason: &str) -> String {
    let mut end = reason.len().min(MAX_REASON_BYTES);
    while !reason.is_char_boundary(end) {
        end -= 1;
    }
    reason[..end].chars().filter(|c| !c.is_control()).collect()
}

async fn dial(url: &Url, protocols: &[String]) -> AppResult<(Socket, Option<String>)> {
    let host = url.host_str().ok_or_else(|| AppError::invalid("The URL has no host"))?;
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs = resolve_public(host, port).await?;
    let mut tcp = None;
    let mut last_error = None;
    for addr in addrs {
        match TcpStream::connect(addr).await {
            Ok(stream) => {
                tcp = Some(stream);
                break;
            }
            Err(error) => last_error = Some(error),
        }
    }
    let tcp = tcp.ok_or_else(|| AppError::network(last_error.map(|e| e.to_string()).unwrap_or_else(|| "Couldn't connect".into())))?;
    let _ = tcp.set_nodelay(true);

    let mut request = url.as_str().into_client_request().map_err(|e| AppError::invalid(e.to_string()))?;
    let headers = request.headers_mut();
    headers.insert("User-Agent", HeaderValue::from_static(USER_AGENT));
    if !protocols.is_empty() {
        let value = HeaderValue::from_str(&protocols.join(", ")).map_err(|_| AppError::invalid("Bad subprotocol"))?;
        headers.insert("Sec-WebSocket-Protocol", value);
    }
    // TLS (rustls, webpki roots) is layered over the already-checked TCP connection.
    let (socket, response) = tokio_tungstenite::client_async_tls_with_config(request, tcp, None, None)
        .await
        .map_err(|e| AppError::network(e.to_string()))?;
    let protocol = response.headers().get("sec-websocket-protocol").and_then(|v| v.to_str().ok()).map(str::to_owned);
    Ok((socket, protocol))
}

/// Waits for the page to close the socket (or go away) while it's still connecting.
async fn closed_while_connecting(rx: &mut mpsc::UnboundedReceiver<Outgoing>) {
    loop {
        match rx.recv().await {
            Some(Outgoing::Close(..)) | None => return,
            // Nothing can be sent before `open`; nativeSocket.ts never tries.
            Some(Outgoing::Text(_)) => continue,
        }
    }
}

async fn run(app: AppHandle, id: u32, url: Url, protocols: Vec<String>, events: Channel<SocketEvent>, mut rx: mpsc::UnboundedReceiver<Outgoing>) {
    let finish = |code: u16, reason: String, was_clean: bool| {
        app.state::<Sockets>().remove(id);
        let _ = events.send(SocketEvent::Close { code, reason, was_clean });
    };

    let dialled = tokio::select! {
        result = tokio::time::timeout(CONNECT_TIMEOUT, dial(&url, &protocols)) => {
            result.unwrap_or_else(|_| Err(AppError::new("timeout", "The connection timed out")))
        }
        _ = closed_while_connecting(&mut rx) => {
            finish(1006, String::new(), false);
            return;
        }
    };
    let (socket, protocol) = match dialled {
        Ok(ok) => ok,
        Err(error) => {
            let _ = events.send(SocketEvent::Error { message: error.message });
            finish(1006, String::new(), false);
            return;
        }
    };
    if events.send(SocketEvent::Open { protocol }).is_err() {
        // The page that asked is gone (reloaded); don't keep a connection nobody hears.
        app.state::<Sockets>().remove(id);
        return;
    }

    let (mut sink, mut source) = socket.split();
    let mut received_close: Option<(u16, String)> = None;
    let mut closing_deadline: Option<Instant> = None;

    let (code, reason, clean) = loop {
        tokio::select! {
            incoming = source.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    if text.len() > MAX_TEXT_BYTES {
                        let _ = sink.send(Message::Close(Some(CloseFrame { code: CloseCode::Size, reason: "".into() }))).await;
                        break (1009, String::from("Message too big"), false);
                    }
                    if events.send(SocketEvent::Message { data: text.as_str().to_owned() }).is_err() {
                        let _ = sink.send(Message::Close(Some(CloseFrame { code: CloseCode::Away, reason: "".into() }))).await;
                        app.state::<Sockets>().remove(id);
                        return;
                    }
                }
                // The party protocol is JSON text; binary frames are ignored, pings are answered by tungstenite.
                Some(Ok(Message::Binary(_) | Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => {}
                Some(Ok(Message::Close(frame))) => {
                    received_close = Some(frame.map(|f| (u16::from(f.code), f.reason.as_str().to_owned())).unwrap_or((1005, String::new())));
                    // tungstenite replies to the close; keep polling until the stream ends.
                }
                Some(Err(error)) => {
                    if let Some((code, reason)) = received_close.take() {
                        break (code, reason, true);
                    }
                    let _ = events.send(SocketEvent::Error { message: error.to_string() });
                    break (1006, String::new(), false);
                }
                None => {
                    break match received_close.take() {
                        Some((code, reason)) => (code, reason, true),
                        None => (1006, String::new(), false),
                    };
                }
            },
            outgoing = rx.recv(), if closing_deadline.is_none() => match outgoing {
                Some(Outgoing::Text(text)) => {
                    if let Err(error) = sink.send(Message::text(text)).await {
                        let _ = events.send(SocketEvent::Error { message: error.to_string() });
                        break (1006, String::new(), false);
                    }
                }
                Some(Outgoing::Close(code, reason)) => {
                    let frame = CloseFrame { code: CloseCode::from(code), reason: reason.into() };
                    let _ = sink.send(Message::Close(Some(frame))).await;
                    closing_deadline = Some(Instant::now() + CLOSE_TIMEOUT);
                }
                None => {
                    let _ = sink.send(Message::Close(Some(CloseFrame { code: CloseCode::Away, reason: "".into() }))).await;
                    closing_deadline = Some(Instant::now() + CLOSE_TIMEOUT);
                }
            },
            _ = tokio::time::sleep_until(closing_deadline.unwrap_or_else(Instant::now)), if closing_deadline.is_some() => {
                // The server never answered our close.
                break (1006, String::new(), false);
            }
        }
    };
    let _ = sink.close().await;
    finish(code, reason, clean);
}

#[tauri::command]
pub fn ws_open(app: AppHandle, sockets: State<'_, Sockets>, url: String, protocols: Vec<String>, on_event: Channel<SocketEvent>) -> AppResult<u32> {
    let url = Url::parse(&url).map_err(|_| AppError::invalid("Not a valid URL"))?;
    if url.scheme() != "wss" {
        return Err(AppError::blocked("Only secure (wss) WebSockets are allowed"));
    }
    check_url(&url, true)?;
    if protocols.len() > MAX_PROTOCOLS || !protocols.iter().all(|p| valid_protocol(p)) {
        return Err(AppError::invalid("Bad subprotocol"));
    }
    let mut unique: Vec<String> = Vec::with_capacity(protocols.len());
    for p in protocols {
        if unique.contains(&p) {
            return Err(AppError::invalid("Duplicate subprotocol"));
        }
        unique.push(p);
    }

    let (tx, rx) = mpsc::unbounded_channel();
    let id = {
        let mut open = sockets.open.lock().unwrap_or_else(|e| e.into_inner());
        // Drop entries whose task has ended without cleaning up (shouldn't happen, but never leak the cap).
        open.retain(|_, sender| !sender.is_closed());
        if open.len() >= MAX_SOCKETS {
            return Err(AppError::new("limit", "Too many open connections"));
        }
        let id = sockets.next.fetch_add(1, Ordering::Relaxed).wrapping_add(1);
        open.insert(id, tx);
        id
    };
    tauri::async_runtime::spawn(run(app, id, url, unique, on_event, rx));
    Ok(id)
}

#[tauri::command]
pub fn ws_send(sockets: State<'_, Sockets>, id: u32, text: String) -> AppResult<()> {
    if text.len() > MAX_TEXT_BYTES {
        return Err(AppError::invalid("Message too large"));
    }
    let sender = sockets.sender(id).ok_or_else(|| AppError::invalid("That socket isn't open"))?;
    sender.send(Outgoing::Text(text)).map_err(|_| AppError::invalid("That socket isn't open"))
}

#[tauri::command]
pub fn ws_close(sockets: State<'_, Sockets>, id: u32, code: Option<u16>, reason: Option<String>) -> AppResult<()> {
    if let Some(sender) = sockets.sender(id) {
        let _ = sender.send(Outgoing::Close(sendable_code(code.unwrap_or(1000)), clip_reason(reason.as_deref().unwrap_or(""))));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocols_and_codes() {
        assert!(valid_protocol("bitchord.v1"));
        assert!(valid_protocol("bitchord.token.abc-DEF_123"));
        assert!(!valid_protocol("bad protocol"));
        assert!(!valid_protocol("a,b"));
        assert!(!valid_protocol(""));
        assert_eq!(sendable_code(1000), 1000);
        assert_eq!(sendable_code(4001), 4001);
        assert_eq!(sendable_code(1006), 1000);
        assert_eq!(clip_reason(&"é".repeat(100)).len(), 122);
    }

    #[test]
    fn event_shape() {
        let json = serde_json::to_string(&SocketEvent::Close { code: 1000, reason: "bye".into(), was_clean: true }).unwrap();
        assert_eq!(json, r#"{"kind":"close","code":1000,"reason":"bye","wasClean":true}"#);
        let json = serde_json::to_string(&SocketEvent::Open { protocol: None }).unwrap();
        assert_eq!(json, r#"{"kind":"open","protocol":null}"#);
    }
}
