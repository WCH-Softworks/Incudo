//! The Rust half of the desktop shell.
//!
//! ADR 0001: "No Rust is required for application code — the Rust side is the generated shell
//! plus plugins." This file is meant to stay that size. A game rule, a stat, or anything that
//! knows what a character is belongs in `packages/`, where it is testable in Node and shared
//! with the mobile shell.
//!
//! The one plugin registered here is `tauri-plugin-http`, and it is the reason the desktop app
//! is a Tauri shell rather than a web page: a browser `fetch` for a content index is subject to
//! CORS, and not every content host cooperates. See `src/platform.ts`.

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running the Incudo desktop shell");
}
