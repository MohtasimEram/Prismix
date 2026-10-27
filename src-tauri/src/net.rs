//! The native `fetch` (src/desktop/nativeFetch.ts).
//!
//! A webview page can't reach YouTube, googlevideo or Spotify itself: they
//! refuse its Origin or send no CORS headers. The browser build of Prismix
//! had an extension rewrite headers; here Rust makes the request with the
//! same rules (rules.rs) and hands back the bytes.
//!
//! Guarantees:
//! - https only, public addresses only, redirects re-checked (netguard.rs);
//! - no cookie jar: requests are anonymous unless the page names a signed-in
//!   identity, and then only YouTube's InnerTube / Spotify's token endpoint
//!   get the session from the vault, without following redirects;
//! - `Set-Cookie` never reaches the page (a signed-in YouTube request's go
//!   into the vault, so the session's rotated cookies are kept); responses are
//!   capped in size.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{redirect, Client, Method};
use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::State;
use tokio::sync::oneshot;
use url::Url;

use crate::error::{AppError, AppResult};
use crate::netguard::{check_url, resolver};
use crate::rules;
use crate::vault::{Service, Vault};

const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS: u64 = 60_000;
pub const CHROME_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NativeAuth {
    #[serde(rename_all = "camelCase")]
    Youtube { auth_user: String, page_id: Option<String>, sign_as: Option<String> },
    Spotify,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRequest {
    id: u64,
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
    auth: Option<NativeAuth>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResponseMeta {
    status: u16,
    status_text: String,
    url: String,
    redirected: bool,
    headers: Vec<(String, String)>,
}

pub struct Net {
    /// Anonymous requests; follows up to 10 redirects, each one re-checked.
    open: Client,
    /// Signed-in requests; never follows a redirect, so a session can't be carried off-site.
    signed: Client,
    in_flight: Mutex<HashMap<u64, oneshot::Sender<()>>>,
}

impl Net {
    pub fn new() -> AppResult<Self> {
        let follow = redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 10 {
                attempt.error(AppError::network("Too many redirects"))
            } else if let Err(error) = check_url(attempt.url(), false) {
                attempt.error(error)
            } else {
                attempt.follow()
            }
        });
        let build = |policy: redirect::Policy| {
            Client::builder()
                .dns_resolver(resolver())
                .redirect(policy)
                .user_agent(CHROME_UA)
                .connect_timeout(Duration::from_secs(15))
                .pool_idle_timeout(Duration::from_secs(60))
                .https_only(true)
                .build()
                .map_err(|e| AppError::internal(e.to_string()))
        };
        Ok(Self { open: build(follow)?, signed: build(redirect::Policy::none())?, in_flight: Mutex::new(HashMap::new()) })
    }
}

fn header_map(pairs: &[(String, String)]) -> HeaderMap {
    let mut map = HeaderMap::new();
    for (name, value) in pairs {
        let lower = name.to_ascii_lowercase();
        if rules::FORBIDDEN_REQUEST_HEADERS.contains(&lower.as_str()) || lower.starts_with("sec-") || lower.starts_with("proxy-") {
            continue;
        }
        if let (Ok(name), Ok(value)) = (HeaderName::from_bytes(lower.as_bytes()), HeaderValue::from_str(value)) {
            map.append(name, value);
        }
    }
    map
}

async fn perform(net: &Net, vault: &Vault, request: FetchRequest) -> AppResult<Vec<u8>> {
    let url = Url::parse(&request.url).map_err(|_| AppError::invalid("Not a valid URL"))?;
    check_url(&url, false)?;
    let method = Method::from_bytes(request.method.to_ascii_uppercase().as_bytes()).map_err(|_| AppError::invalid("Bad method"))?;
    if matches!(method.as_str(), "CONNECT" | "TRACE" | "TRACK") {
        return Err(AppError::invalid("Method not allowed"));
    }

    let mut headers = header_map(&request.headers);
    rules::apply_site_headers(&url, &mut headers);

    let signed = match &request.auth {
        None => false,
        Some(NativeAuth::Youtube { auth_user, page_id, sign_as }) => {
            rules::sign_youtube(vault, &url, &method, &mut headers, auth_user, page_id.as_deref(), sign_as.as_deref())?;
            true
        }
        Some(NativeAuth::Spotify) => {
            rules::sign_spotify(vault, &url, &method, &mut headers)?;
            true
        }
    };

    let body = match request.body {
        Some(encoded) if !matches!(method, Method::GET | Method::HEAD) => {
            let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| AppError::invalid("Body is not base64"))?;
            if bytes.len() > MAX_REQUEST_BYTES {
                return Err(AppError::invalid("Request body too large"));
            }
            Some(bytes)
        }
        _ => None,
    };

    // A signed-in YouTube request may come back with refreshed session cookies (kept below).
    let youtube_session = matches!(request.auth, Some(NativeAuth::Youtube { .. })).then(|| vault.generation(Service::Youtube));

    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(1_000, 180_000));
    let client = if signed { &net.signed } else { &net.open };
    let mut builder = client.request(method, url.clone()).headers(headers).timeout(timeout);
    if let Some(bytes) = body {
        builder = builder.body(bytes);
    }

    let mut response = builder.send().await.map_err(describe)?;
    let status = response.status();
    let final_url = response.url().to_string();
    let redirected = response.url() != &url;
    if let Some(generation) = youtube_session {
        let set_cookies: Vec<String> =
            response.headers().get_all(reqwest::header::SET_COOKIE).iter().filter_map(|v| v.to_str().ok().map(str::to_owned)).collect();
        vault.merge_cookies(Service::Youtube, generation, url.host_str().unwrap_or(""), &set_cookies);
    }
    let response_headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .filter(|(name, _)| !rules::HIDDEN_RESPONSE_HEADERS.contains(&name.as_str()))
        .filter_map(|(name, value)| value.to_str().ok().map(|v| (name.as_str().to_owned(), v.to_owned())))
        .collect();

    if let Some(length) = response.content_length() {
        if length as usize > MAX_RESPONSE_BYTES {
            return Err(AppError::network("Response too large"));
        }
    }
    let mut payload = Vec::with_capacity(response.content_length().unwrap_or(0).min(4 * 1024 * 1024) as usize);
    while let Some(chunk) = response.chunk().await.map_err(describe)? {
        if payload.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(AppError::network("Response too large"));
        }
        payload.extend_from_slice(&chunk);
    }

    let meta = serde_json::to_vec(&ResponseMeta {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_owned(),
        url: final_url,
        redirected,
        headers: response_headers,
    })
    .map_err(|e| AppError::internal(e.to_string()))?;

    let mut out = Vec::with_capacity(4 + meta.len() + payload.len());
    out.extend_from_slice(&(meta.len() as u32).to_le_bytes());
    out.extend_from_slice(&meta);
    out.extend_from_slice(&payload);
    Ok(out)
}

fn describe(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        return AppError::new("timeout", "The request timed out");
    }
    // Surface the SSRF guard's own words rather than reqwest's wrapper.
    let mut source: Option<&dyn std::error::Error> = Some(&error);
    while let Some(inner) = source {
        if let Some(app) = inner.downcast_ref::<AppError>() {
            return app.clone();
        }
        source = inner.source();
    }
    AppError::network(error.to_string())
}

#[tauri::command]
pub async fn net_fetch(net: State<'_, Net>, vault: State<'_, Vault>, request: FetchRequest) -> Result<Response, AppError> {
    let id = request.id;
    let (cancel, cancelled) = oneshot::channel::<()>();
    // A reused id (the page reloaded mid-request) drops the old sender, which cancels the old request.
    net.in_flight.lock().unwrap_or_else(|e| e.into_inner()).insert(id, cancel);
    let result = tokio::select! {
        result = perform(&net, &vault, request) => result,
        _ = cancelled => Err(AppError::new("aborted", "The request was aborted")),
    };
    net.in_flight.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
    result.map(Response::new)
}

#[tauri::command]
pub fn net_abort(net: State<'_, Net>, id: u64) {
    if let Some(cancel) = net.in_flight.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
        let _ = cancel.send(());
    }
}
