//! Global media keys (Settings › Desktop › Media Keys).
//!
//! Registered system-wide through tauri-plugin-global-shortcut so play/pause,
//! next and previous work while Prismix is in the background or the tray.
//! Presses become `media://command` events (src/desktop/media.ts), which run
//! through the player store like a click would, so a Listen Together party
//! hears about them. When the window is focused the webview's Media Session
//! may report the same key; mediaGate.ts counts that once.

use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

const KEYS: [(Code, &str); 4] = [
    (Code::MediaPlayPause, "play-pause"),
    (Code::MediaTrackNext, "next"),
    (Code::MediaTrackPrevious, "previous"),
    (Code::MediaStop, "stop"),
];

/// The plugin's handler: every registered shortcut lands here.
pub fn handler(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state() != ShortcutState::Pressed {
        return;
    }
    if let Some((_, command)) = KEYS.iter().find(|(code, _)| shortcut.key == *code && shortcut.mods.is_empty()) {
        let _ = app.emit_to("main", "media://command", *command);
    }
}

/// Registers (or with `on == false`, releases) the media keys. A key another app
/// already holds, or a desktop that doesn't support global keys (Wayland), is logged and skipped.
pub fn apply(app: &AppHandle, on: bool) {
    let shortcuts = app.global_shortcut();
    for (code, name) in KEYS {
        let registered = shortcuts.is_registered(Shortcut::new(None, code));
        if on && !registered {
            if let Err(error) = shortcuts.register(Shortcut::new(None, code)) {
                log::warn!("couldn't register the {name} media key: {error}");
            }
        } else if !on && registered {
            if let Err(error) = shortcuts.unregister(Shortcut::new(None, code)) {
                log::warn!("couldn't release the {name} media key: {error}");
            }
        }
    }
}
