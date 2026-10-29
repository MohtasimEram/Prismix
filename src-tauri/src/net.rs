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
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{redirect, Client, Method};
use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::{AppHandle, State};
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

async fn perform(app: &AppHandle, net: &Net, vault: &Vault, request: FetchRequest) -> AppResult<Vec<u8>> {
    let url = Url::parse(&request.url).map_err(|_| AppError::invalid("Not a valid URL"))?;
    check_url(&url, false)?;
    let method = Method::from_bytes(request.method.to_ascii_uppercase().as_bytes()).map_err(|_| AppError::invalid("Bad method"))?;
    let method_name = method.to_string();
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
    if youtube_session.is_some() {
        log_youtube_response(&method_name, &url, response.status(), response.headers());
    }
    if let Some(generation) = youtube_session {
        let set_cookies: Vec<String> =
            response.headers().get_all(reqwest::header::SET_COOKIE).iter().filter_map(|v| v.to_str().ok().map(str::to_owned)).collect();
        // Google deleting the login's cookies means it no longer accepts the session: renew it from the
        // sign-in profile (keeper.rs) before the page decides it is signed out.
        if vault.merge_cookies(Service::Youtube, generation, url.host_str().unwrap_or(""), &set_cookies) {
            log::warn!("YouTube ended the saved session (it deleted the login's cookies on {}); renewing it from the sign-in profile", url.host_str().unwrap_or("?"));
            crate::keeper::renew_soon(app);
        }
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

/// Unix seconds of an HTTP `Date` header (`Sun, 06 Nov 1994 08:49:37 GMT`).
fn parse_http_date(value: &str) -> Option<i64> {
    let rest = value.split_once(", ")?.1;
    let mut parts = rest.split(' ');
    let day: i64 = parts.next()?.parse().ok()?;
    let month: i64 = match parts.next()? {
        "Jan" => 1,
        "Feb" => 2,
        "Mar" => 3,
        "Apr" => 4,
        "May" => 5,
        "Jun" => 6,
        "Jul" => 7,
        "Aug" => 8,
        "Sep" => 9,
        "Oct" => 10,
        "Nov" => 11,
        "Dec" => 12,
        _ => return None,
    };
    let year: i64 = parts.next()?.parse().ok()?;
    let mut clock = parts.next()?.split(':');
    let hours: i64 = clock.next()?.parse().ok()?;
    let minutes: i64 = clock.next()?.parse().ok()?;
    let seconds: i64 = clock.next()?.parse().ok()?;
    // Days since 1970-01-01 (the civil-calendar algorithm, March-based years).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let year_of_era = y - era * 400;
    let month_from_march = (month + 9) % 12;
    let day_of_year = (153 * month_from_march + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days = era * 146_097 + day_of_era - 719_468;
    Some(days * 86_400 + hours * 3_600 + minutes * 60 + seconds)
}

/// How many of the odd YouTube answers have been written to the log this run (it stops at a cap so a bad spell can't flood it).
static YOUTUBE_LOGGED: AtomicUsize = AtomicUsize::new(0);
const YOUTUBE_LOG_CAP: usize = 60;

/// The log's account of a signed-in YouTube request: the first one of the run, and any that
/// came back with an error, a redirect (to a sign-in page, usually) or a clock that disagrees
/// with the server's. Paths only, never query strings, headers' values or cookies: when a session
/// stops working, this is what shows whether it was refused, bounced or never reached.
fn log_youtube_response(method: &str, url: &Url, status: reqwest::StatusCode, headers: &HeaderMap) {
    let skew = headers
        .get(reqwest::header::DATE)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_http_date)
        .and_then(|server| SystemTime::now().duration_since(UNIX_EPOCH).ok().map(|now| now.as_secs() as i64 - server));
    let clock_off = skew.is_some_and(|s| s.abs() > 120);
    let bounced_to = headers.get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).and_then(|v| Url::options().base_url(Some(url)).parse(v).ok());
    let notable = !status.is_success() || clock_off;
    if !notable && YOUTUBE_LOGGED.load(Ordering::Relaxed) > 0 {
        return;
    }
    if YOUTUBE_LOGGED.fetch_add(1, Ordering::Relaxed) >= YOUTUBE_LOG_CAP {
        return;
    }
    let target = format!("{}{}", url.host_str().unwrap_or("?"), url.path());
    let mut line = format!("signed YouTube request {method} {target} -> {}", status.as_u16());
    if let Some(to) = bounced_to {
        line.push_str(&format!(", redirected to {}{}", to.host_str().unwrap_or("?"), to.path()));
    }
    if let Some(skew) = skew {
        line.push_str(&format!("; this PC's clock is {skew:+}s from the server's"));
    }
    if clock_off {
        line.push_str(" (too far off: signed requests can be refused for it)");
    }
    if notable {
        log::warn!("{line}");
    } else {
        log::info!("{line}");
    }
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
pub async fn net_fetch(app: AppHandle, net: State<'_, Net>, vault: State<'_, Vault>, request: FetchRequest) -> Result<Response, AppError> {
    let id = request.id;
    let (cancel, cancelled) = oneshot::channel::<()>();
    // A reused id (the page reloaded mid-request) drops the old sender, which cancels the old request.
    net.in_flight.lock().unwrap_or_else(|e| e.into_inner()).insert(id, cancel);
    let result = tokio::select! {
        result = perform(&app, &net, &vault, request) => result,
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

#[cfg(test)]
mod date_tests {
    use super::parse_http_date;

    #[test]
    fn reads_http_dates() {
        assert_eq!(parse_http_date("Sun, 06 Nov 1994 08:49:37 GMT"), Some(784_111_777));
        assert_eq!(parse_http_date("Thu, 01 Jan 1970 00:00:00 GMT"), Some(0));
        assert_eq!(parse_http_date("not a date"), None);
    }
}
