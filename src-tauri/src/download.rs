//! Saves a downloaded song to the user's Downloads folder (src/playback/download.ts).
//!
//! The page sends the finished file as the raw body of the call, with its name
//! in the `x-file-name` header (percent-encoded). WebView2 would save a blob
//! link itself, but WKWebView and WebKitGTK don't, so the save is done here.
//! The file lands in `<Downloads>/Prismix/`, never over an existing file.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

const MAX_BYTES: usize = 512 * 1024 * 1024;

/// Decodes `%XX` escapes (what encodeURIComponent produces); malformed ones are kept as written.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let pair = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(value) = pair {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A bare file name every platform accepts: no folders, no reserved characters.
fn safe_file_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let cleaned: String = last
        .chars()
        .map(|c| if c.is_control() || "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "Prismix track.audio".to_string()
    } else {
        trimmed.chars().take(150).collect()
    }
}

/// `name`, or `name (2)`, `name (3)`… when that file exists already.
fn unused_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let extension = path.extension().and_then(|s| s.to_str());
    for n in 2..1000 {
        let candidate = match extension {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = dir.join(candidate);
        if !candidate.exists() {
            return candidate;
        }
    }
    first
}

#[tauri::command]
pub async fn save_download(app: AppHandle, request: Request<'_>) -> AppResult<String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::invalid("expected the file's bytes"));
    };
    if bytes.is_empty() {
        return Err(AppError::invalid("the file is empty"));
    }
    if bytes.len() > MAX_BYTES {
        return Err(AppError::invalid("the file is too large to save"));
    }
    let header = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::invalid("missing file name"))?;
    let name = safe_file_name(&percent_decode(header));
    let base = app
        .path()
        .download_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|e| AppError::internal(e.to_string()))?;
    let dir = base.join("Prismix");
    fs::create_dir_all(&dir)?;
    let path = unused_path(&dir, &name);
    fs::write(&path, bytes)?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_escapes() {
        assert_eq!(percent_decode("A%20-%20B"), "A - B");
        assert_eq!(percent_decode("%E0%A6%AC"), "ব");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn names_are_safe() {
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name("a:b?c.webm"), "a_b_c.webm");
        assert_eq!(safe_file_name("..."), "Prismix track.audio");
    }
}
