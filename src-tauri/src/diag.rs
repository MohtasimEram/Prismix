//! A line from the page into the app's log file. The page knows things Rust can't
//! (YouTube answering 200 but as if signed out); this lets it say so where the
//! rest of the diagnostics are. Text only, capped and stripped of control
//! characters so a line can't forge a second one.

const MAX_LINE: usize = 400;

#[tauri::command]
pub fn diag_log(level: String, message: String) {
    let clean: String = message.chars().filter(|c| !c.is_control()).take(MAX_LINE).collect();
    if level == "warn" {
        log::warn!(target: "prismix::page", "{clean}");
    } else {
        log::info!(target: "prismix::page", "{clean}");
    }
}
