//! The Rust half of the desktop shell.
//!
//! ADR 0001: "No Rust is required for application code — the Rust side is the generated shell
//! plus plugins." This file is meant to stay that size. A game rule, a stat, or anything that
//! knows what a character is belongs in `packages/`, where it is testable in Node and shared
//! with the mobile shell.
//!
//! Three plugins are registered, each for a reason the web platform cannot cover:
//!
//! - `http` — a browser `fetch` for a content index is subject to CORS, and not every content
//!   host cooperates. This is the original reason the desktop app is a Tauri shell rather than
//!   a web page. See `src/platform.ts`.
//! - `dialog` — "where do you keep your characters?" needs a real folder picker (ADR 0027).
//! - `fs` — and then it needs to read that folder.
//!
//! The one command below exists because of how narrow the fs capability is, which is a
//! deliberate product decision rather than a security tidy-up: see the comment on it and
//! `capabilities/default.json`.

use tauri_plugin_fs::FsExt;

/// Widen the filesystem scope to exactly the folder the user just picked.
///
/// The alternative was a capability granting `**`, and the difference is the whole point: an
/// app that can read any path on the machine is not the same app as one that can read the
/// folder its user chose in a dialog. The scope starts empty, the dialog is the only thing
/// that can add to it, and what it adds is one directory.
///
/// This is also why the picker cannot be done entirely in TypeScript — nothing in the JS API
/// can widen a scope. It is the single piece of application-shaped Rust in the project, and it
/// holds no knowledge of what a character is.
#[tauri::command]
fn allow_library_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let scope = app.fs_scope();
    scope
        .allow_directory(&path, true)
        .map_err(|error| format!("Could not open \"{path}\": {error}"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![allow_library_folder])
        .run(tauri::generate_context!())
        .expect("error while running the Incudo desktop shell");
}
