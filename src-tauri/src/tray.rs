//! The system tray: what's playing, transport controls, Show and Quit.
//!
//! Menu presses become `media://command` events (src/desktop/media.ts); the
//! page keeps the tooltip and labels current with `tray_set_now_playing`.

use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::error::AppResult;

pub const TRAY_ID: &str = "prismix";
const NOT_PLAYING: &str = "Not Playing";
const MAX_TITLE_CHARS: usize = 120;

pub struct Tray {
    icon: TrayIcon<Wry>,
    now: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
}

/// Brings the main window back from the tray, minimised or hidden state.
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn icon() -> tauri::Result<Image<'static>> {
    // macOS draws menu-bar icons as templates (black + alpha, recoloured by the system).
    #[cfg(target_os = "macos")]
    let bytes: &[u8] = include_bytes!("../icons/tray-template.png");
    #[cfg(not(target_os = "macos"))]
    let bytes: &[u8] = include_bytes!("../icons/tray.png");
    Image::from_bytes(bytes)
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        id @ ("play-pause" | "next" | "previous") => {
            let _ = app.emit_to("main", "media://command", id);
        }
        "show" => show_main(app),
        "quit" => app.exit(0),
        _ => {}
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let now = MenuItem::with_id(app, "now", NOT_PLAYING, false, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "play-pause", "Play", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
    let previous = MenuItem::with_id(app, "previous", "Previous", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Prismix", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Prismix", true, None::<&str>)?;
    let separator_a = PredefinedMenuItem::separator(app)?;
    let separator_b = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&now, &separator_a, &toggle, &next, &previous, &separator_b, &show, &quit])?;

    let icon = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon()?)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Prismix")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(Tray { icon, now, toggle });
    Ok(())
}

/// Menu text: clipped, and on Windows `&` escaped (it marks a mnemonic there).
fn label(text: &str) -> String {
    let clipped: String = if text.chars().count() > MAX_TITLE_CHARS {
        text.chars().take(MAX_TITLE_CHARS - 1).chain(std::iter::once('…')).collect()
    } else {
        text.to_owned()
    };
    let clean: String = clipped.chars().filter(|c| !c.is_control()).collect();
    if cfg!(target_os = "windows") {
        clean.replace('&', "&&")
    } else {
        clean
    }
}

#[tauri::command]
pub fn tray_set_now_playing(app: AppHandle, title: Option<String>, playing: bool) -> AppResult<()> {
    // No tray on this desktop: nothing to keep in step.
    let Some(tray) = app.try_state::<Tray>() else { return Ok(()) };
    let title = title.map(|t| t.trim().to_owned()).filter(|t| !t.is_empty());
    tray.now.set_text(title.as_deref().map(label).unwrap_or_else(|| NOT_PLAYING.to_owned()))?;
    tray.toggle.set_text(if playing { "Pause" } else { "Play" })?;
    // Windows caps tray tooltips at 127 characters.
    let tooltip = match &title {
        Some(t) => format!("Prismix — {}", t.chars().filter(|c| !c.is_control()).take(110).collect::<String>()),
        None => "Prismix".to_owned(),
    };
    tray.icon.set_tooltip(Some(tooltip))?;
    Ok(())
}
