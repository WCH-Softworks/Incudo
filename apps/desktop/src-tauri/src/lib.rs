//! The Rust half of the desktop shell.
//!
//! ADR 0001: "No Rust is required for application code — the Rust side is the generated shell
//! plus plugins." This file is meant to stay that size. A game rule, a stat, or anything that
//! knows what a character is belongs in `packages/`, where it is testable in Node and shared
//! with the mobile shell.
//!
//! Two plugins are registered, each for a reason the web platform cannot cover:
//!
//! - `dialog` — "where do you keep your characters?" needs a real folder picker (ADR 0027).
//! - `fs` — and then it needs to read that folder.
//!
//! And two commands, each a transport rather than a rule:
//!
//! - `allow_library_folder`, because of how narrow the fs capability is, which is a deliberate
//!   product decision rather than a security tidy-up: see the comment on it and
//!   `capabilities/default.json`.
//! - `fetch_content_text`, because a browser `fetch` for a content index is subject to CORS and not
//!   every content host cooperates. That is the original reason the desktop app is a Tauri shell
//!   rather than a web page. It used to be `tauri-plugin-http`, which builds a new client, and so
//!   opens a new connection, for every request; see the comment on the command and ADR 0050.

use std::time::Duration;

use tauri_plugin_fs::FsExt;

/// Widen the filesystem scope to exactly the folder the user just picked.
///
/// The alternative was a capability granting `**`, and the difference is the whole point: an
/// app that can read any path on the machine is not the same app as one that can read the
/// folder its user chose in a dialog. The scope starts empty, the dialog is the only thing
/// that can add to it, and what it adds is one directory.
///
/// This is also why the picker cannot be done entirely in TypeScript — nothing in the JS API
/// can widen a scope. It holds no knowledge of what a character is.
#[tauri::command]
fn allow_library_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let scope = app.fs_scope();
    scope
        .allow_directory(&path, true)
        .map_err(|error| format!("Could not open \"{path}\": {error}"))
}

/// The one HTTP client the window's content requests share.
///
/// Shared so that its connections are reused. `tauri-plugin-http` 2.6 built a client per request,
/// so every file of a source opened its own TCP and TLS connection; measured against
/// raw.githubusercontent.com, 800 conditional requests that way stalled for 3, 7 and 15 seconds
/// at a time and some never finished, where 400 over reused connections took 1.3 seconds
/// (ADR 0050). Timeouts so that a stalled request fails and says so rather than holding a load
/// open forever.
struct ContentClient(reqwest::Client);

impl ContentClient {
    fn new() -> Self {
        // Redirects are followed only to https, as the request itself must be: a content host
        // must not be able to send the window to a plain-http or local address.
        let redirects = reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 10 {
                attempt.error("too many redirects")
            } else if attempt.url().scheme() != "https" {
                attempt.error("redirected to a URL that is not https")
            } else {
                attempt.follow()
            }
        });
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120))
            .redirect(redirects)
            .build()
            .expect("the content HTTP client could not be built");
        Self(client)
    }
}

/// What a content fetch answered: the status, the text (empty for a 304) and the ETag, if any.
#[derive(serde::Serialize)]
struct TextReply {
    status: u16,
    text: String,
    etag: Option<String>,
}

/// Fetch one content file as text, over https only, optionally asking only for a copy other than
/// the one `etag` names (ADR 0050).
///
/// It knows nothing about content: a URL in, a status, text and ETag out. Deciding what a status
/// means is `DesktopFetcher`'s job in `src/platform.ts`, beside the browser's.
#[tauri::command]
async fn fetch_content_text(
    client: tauri::State<'_, ContentClient>,
    url: String,
    etag: Option<String>,
) -> Result<TextReply, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| format!("Not a URL: {error}"))?;
    if parsed.scheme() != "https" {
        return Err("Only https content is fetched".to_owned());
    }
    let mut request = client.0.get(parsed);
    if let Some(etag) = etag {
        request = request.header(reqwest::header::IF_NONE_MATCH, etag);
    }
    let response = request.send().await.map_err(describe)?;
    let status = response.status().as_u16();
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let text = if status == 304 {
        String::new()
    } else {
        response.text().await.map_err(describe)?
    };
    Ok(TextReply { status, text, etag })
}

/// What went wrong, without the address: every caller names the URL it asked for, and reqwest's
/// own message would name it a second time ("error sending request for url (…)").
fn describe(error: reqwest::Error) -> String {
    error.without_url().to_string()
}

pub fn run() {
    tauri::Builder::default()
        .manage(ContentClient::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![allow_library_folder, fetch_content_text])
        .run(tauri::generate_context!())
        .expect("error while running the Incudo desktop shell");
}
