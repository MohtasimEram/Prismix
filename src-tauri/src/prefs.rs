//! Desktop preferences kept by Rust (src/desktop/window.ts): what the window's
//! close button does and whether the global media keys are registered.
//! Stored as plain JSON in `<app config>/prefs.json`; nothing secret lives here.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::shortcuts;

const PREFS_FILE: &str = "prefs.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopPrefs {
    pub close_to_tray: bool,
    pub global_media_keys: bool,
}

impl Default for DesktopPrefs {
    fn default() -> Self {
        Self {
            // Many Linux desktops (stock GNOME) show no tray at all: closing must not make the app vanish there.
            close_to_tray: !cfg!(target_os = "linux"),
            global_media_keys: true,
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefsPatch {
    close_to_tray: Option<bool>,
    global_media_keys: Option<bool>,
}

pub struct Prefs {
    path: PathBuf,
    data: Mutex<DesktopPrefs>,
}

impl Prefs {
    pub fn load(dir: &Path) -> Self {
        let path = dir.join(PREFS_FILE);
        let data = fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
        Self { path, data: Mutex::new(data) }
    }

    pub fn get(&self) -> DesktopPrefs {
        *self.data.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn update(&self, patch: PrefsPatch) -> AppResult<(DesktopPrefs, DesktopPrefs)> {
        let mut guard = self.data.lock().unwrap_or_else(|e| e.into_inner());
        let before = *guard;
        let mut next = before;
        if let Some(value) = patch.close_to_tray {
            next.close_to_tray = value;
        }
        if let Some(value) = patch.global_media_keys {
            next.global_media_keys = value;
        }
        if next != before {
            if let Some(dir) = self.path.parent() {
                fs::create_dir_all(dir)?;
            }
            let bytes = serde_json::to_vec_pretty(&next).map_err(|e| AppError::internal(e.to_string()))?;
            let tmp = self.path.with_extension("tmp");
            fs::write(&tmp, bytes)?;
            fs::rename(&tmp, &self.path)?;
            *guard = next;
        }
        Ok((before, next))
    }
}

#[tauri::command]
pub fn prefs_get(prefs: State<'_, Prefs>) -> DesktopPrefs {
    prefs.get()
}

#[tauri::command]
pub fn prefs_set(app: AppHandle, prefs: State<'_, Prefs>, patch: PrefsPatch) -> AppResult<DesktopPrefs> {
    let (before, next) = prefs.update(patch)?;
    if before.global_media_keys != next.global_media_keys {
        shortcuts::apply(&app, next.global_media_keys);
    }
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_defaults() {
        let dir = std::env::temp_dir().join(format!("prismix-prefs-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let prefs = Prefs::load(&dir);
        assert_eq!(prefs.get(), DesktopPrefs::default());
        prefs.update(PrefsPatch { close_to_tray: Some(false), global_media_keys: None }).unwrap();
        let again = Prefs::load(&dir);
        assert!(!again.get().close_to_tray);
        assert_eq!(again.get().global_media_keys, DesktopPrefs::default().global_media_keys);
        // Unknown or missing fields fall back to defaults.
        fs::write(dir.join(PREFS_FILE), br#"{"somethingElse":1}"#).unwrap();
        assert_eq!(Prefs::load(&dir).get(), DesktopPrefs::default());
        let _ = fs::remove_dir_all(dir);
    }
}
