//! The Rust half of the desktop shell.
//!
//! ADR 0001: "No Rust is required for application code — the Rust side is the generated shell
//! plus plugins." This file is meant to stay that size. A game rule, a stat, or anything that
//! knows what a character is belongs in `packages/`, where it is testable in Node and shared
//! with the mobile shell.
//!
//! Three plugins are registered, each for a reason the web platform cannot cover:
//!
//! - `dialog` — "where do you keep your characters?" needs a real folder picker (ADR 0027).
//! - `fs` — and then it needs to read that folder.
//! - `opener` — the About section's links open in the user's browser, not in the window. Its capability names
//!   the exact addresses, so the page can open nothing else.
//!
//! And three commands, each a transport rather than a rule:
//!
//! - `allow_library_folder`, because of how narrow the fs capability is, which is a deliberate
//!   product decision rather than a security tidy-up: see the comment on it and
//!   `capabilities/default.json`.
//! - `fetch_content_text`, because a browser `fetch` for a content index is subject to CORS and not
//!   every content host cooperates. That is the original reason the desktop app is a Tauri shell
//!   rather than a web page. It used to be `tauri-plugin-http`, which builds a new client, and so
//!   opens a new connection, for every request; see the comment on the command and ADR 0050.
//! - `print_to_pdf`, because writing the page as a PDF without the print dialog is a call on the platform's webview,
//!   which no JavaScript API reaches (ADR 0079). Windows only so far; elsewhere it says so.

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

/// The page on screen, printed to PDF bytes with no dialog: "Export sheet as PDF…" (ADR 0079 decision 2).
///
/// A paper size in, the file's bytes out. WebView2's `PrintToPdfStream` with the paper given, margins of zero (the page's
/// own print rules place everything, ADR 0078), backgrounds, and the browser's headers and footers off. It decides nothing
/// about what prints: the page has already put the print options' classes on the Sheet before it asks. The page saves the
/// bytes through its save port, so the user names the file in the system's save dialog.
#[tauri::command]
async fn print_to_pdf(webview: tauri::Webview, width_inches: f64, height_inches: f64) -> Result<tauri::ipc::Response, String> {
    if !(width_inches > 0.0 && height_inches > 0.0 && width_inches < 100.0 && height_inches < 100.0) {
        return Err("Not a paper size".to_owned());
    }
    pdf::print(webview, width_inches, height_inches).await.map(tauri::ipc::Response::new)
}

#[cfg(windows)]
mod pdf {
    use std::sync::mpsc;

    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_16, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use webview2_com::PrintToPdfStreamCompletedHandler;
    use windows::core::Interface;
    use windows::Win32::System::Com::IStream;

    pub async fn print(webview: tauri::Webview, width: f64, height: f64) -> Result<Vec<u8>, String> {
        let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
        let failed = tx.clone();
        // The webview is reached on the window's own thread; WebView2 answers there too, later, through the handler.
        webview
            .with_webview(move |platform| {
                // SAFETY: COM calls on the WebView2 objects Tauri created, on the thread that owns them.
                let started = unsafe { start(&platform, width, height, tx) };
                if let Err(message) = started {
                    let _ = failed.send(Err(message));
                }
            })
            .map_err(|error| format!("The window could not be reached: {error}"))?;
        tauri::async_runtime::spawn_blocking(move || rx.recv())
            .await
            .map_err(|error| error.to_string())?
            .map_err(|_| "The PDF was never written".to_owned())?
    }

    unsafe fn start(
        platform: &tauri::webview::PlatformWebview,
        width: f64,
        height: f64,
        tx: mpsc::Sender<Result<Vec<u8>, String>>,
    ) -> Result<(), String> {
        let core = platform.controller().CoreWebView2().map_err(explain("No webview"))?;
        let core: ICoreWebView2_16 = core.cast().map_err(explain("This WebView2 cannot print to PDF; update the WebView2 Runtime"))?;
        let environment: ICoreWebView2Environment6 =
            platform.environment().cast().map_err(explain("This WebView2 cannot print to PDF; update the WebView2 Runtime"))?;
        let settings = environment.CreatePrintSettings().map_err(explain("No print settings"))?;
        let set = explain("The print settings were refused");
        settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT).map_err(set)?;
        settings.SetPageWidth(width).map_err(set)?;
        settings.SetPageHeight(height).map_err(set)?;
        settings.SetMarginTop(0.0).map_err(set)?;
        settings.SetMarginBottom(0.0).map_err(set)?;
        settings.SetMarginLeft(0.0).map_err(set)?;
        settings.SetMarginRight(0.0).map_err(set)?;
        settings.SetScaleFactor(1.0).map_err(set)?;
        settings.SetShouldPrintBackgrounds(true).map_err(set)?;
        settings.SetShouldPrintHeaderAndFooter(false).map_err(set)?;
        let handler = PrintToPdfStreamCompletedHandler::create(Box::new(move |result, stream| {
            let bytes = result
                .map_err(|error| format!("The PDF could not be written: {error}"))
                .and_then(|()| stream.ok_or_else(|| "The PDF came back empty".to_owned()))
                .and_then(|stream| read_all(&stream));
            let _ = tx.send(bytes);
            Ok(())
        }));
        core.PrintToPdfStream(&settings, &handler).map_err(explain("The PDF could not be started"))
    }

    /// A failed COM call, said in words with what it was doing.
    fn explain(what: &'static str) -> impl Fn(windows::core::Error) -> String + Copy {
        move |error| format!("{what}: {error}")
    }

    fn read_all(stream: &IStream) -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        let mut chunk = vec![0u8; 64 * 1024];
        loop {
            let mut read = 0u32;
            // SAFETY: `chunk` is writable for its length, and `read` receives how much of it was filled.
            let result = unsafe { stream.Read(chunk.as_mut_ptr().cast(), chunk.len() as u32, Some(&mut read)) };
            result.ok().map_err(|error| format!("The PDF could not be read: {error}"))?;
            if read == 0 {
                return Ok(bytes);
            }
            bytes.extend_from_slice(&chunk[..read as usize]);
        }
    }
}

#[cfg(not(windows))]
mod pdf {
    pub async fn print(_webview: tauri::Webview, _width: f64, _height: f64) -> Result<Vec<u8>, String> {
        Err("Writing a PDF without the print dialog is built for Windows only so far.".to_owned())
    }
}

/// The window's right-click menu: none, but for a text field's editing items.
///
/// WebView2's own menu is a browser's (Back, Refresh, Save as, Print, Inspect), none of it the app's, so a right click on
/// the page shows nothing. A text field keeps its menu, less every item that is about the page rather than the text:
/// whatever WebView2 names that is not on `EDITING`, so an item a later runtime adds is left out until it is listed. Done
/// here, not in the page, so that it also holds before the page has loaded, and in every page the window shows.
#[cfg(windows)]
mod context_menu {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2ContextMenuItemCollection, ICoreWebView2ContextMenuRequestedEventArgs, ICoreWebView2_11,
        COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR,
    };
    use webview2_com::{take_pwstr, ContextMenuRequestedEventHandler};
    use windows::core::{Interface, BOOL, PWSTR};

    /// What a text field's menu keeps, by the names WebView2 gives its items: measured in the window (WebView2 Runtime
    /// 154), where a misspelled word's suggestions and "Add to dictionary" are all `spellcheck`, and what goes is
    /// `print`, `moreTools`, `inspectElement` and the "Writing direction" submenu, named `other`.
    const EDITING: &[&str] = &["spellcheck", "emoji", "undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll"];

    pub fn install(window: &tauri::WebviewWindow) {
        let installed = window.with_webview(|platform| {
            // SAFETY: COM calls on the WebView2 objects Tauri created, on the thread that owns them.
            if let Err(error) = unsafe { register(&platform) } {
                eprintln!("The window's right-click menu could not be changed: {error}");
            }
        });
        if let Err(error) = installed {
            eprintln!("The window's right-click menu could not be reached: {error}");
        }
    }

    unsafe fn register(platform: &tauri::webview::PlatformWebview) -> windows::core::Result<()> {
        let core: ICoreWebView2_11 = platform.controller().CoreWebView2()?.cast()?;
        let handler = ContextMenuRequestedEventHandler::create(Box::new(|_, args| {
            if let Some(args) = args {
                // SAFETY: the event's own arguments, during the event.
                unsafe { decide(&args) }?;
            }
            Ok(())
        }));
        let mut token = 0i64;
        core.add_ContextMenuRequested(&handler, &mut token)
    }

    unsafe fn decide(args: &ICoreWebView2ContextMenuRequestedEventArgs) -> windows::core::Result<()> {
        let mut editable = BOOL(0);
        args.ContextMenuTarget()?.IsEditable(&mut editable)?;
        if !editable.as_bool() {
            // Handled with no item chosen: WebView2 shows nothing.
            return args.SetHandled(true);
        }
        keep_editing(&args.MenuItems()?)
    }

    unsafe fn keep_editing(items: &ICoreWebView2ContextMenuItemCollection) -> windows::core::Result<()> {
        let mut count = 0u32;
        items.Count(&mut count)?;
        let mut kept = Vec::with_capacity(count as usize);
        for index in 0..count {
            let item = items.GetValueAtIndex(index)?;
            let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
            item.Kind(&mut kind)?;
            let mut name = PWSTR::null();
            item.Name(&mut name)?;
            kept.push(if kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR {
                Kept::Separator
            } else if EDITING.contains(&take_pwstr(name).as_str()) {
                Kept::Item
            } else {
                Kept::Not
            });
        }
        let keep = separate(&kept);
        for index in (0..count).rev() {
            if !keep[index as usize] {
                items.RemoveValueAtIndex(index)?;
            }
        }
        Ok(())
    }

    #[derive(Clone, Copy, PartialEq)]
    enum Kept {
        Item,
        Not,
        Separator,
    }

    /// Which entries stay: every kept item, and a separator only where it parts two groups that keep something.
    fn separate(kept: &[Kept]) -> Vec<bool> {
        let mut keep = vec![false; kept.len()];
        let mut since_separator = false;
        let mut pending: Option<usize> = None;
        for (index, entry) in kept.iter().enumerate() {
            match entry {
                Kept::Item => {
                    if let Some(separator) = pending.take() {
                        keep[separator] = true;
                    }
                    keep[index] = true;
                    since_separator = true;
                }
                Kept::Separator if since_separator => {
                    pending = Some(index);
                    since_separator = false;
                }
                _ => {}
            }
        }
        keep
    }
}

#[cfg(not(windows))]
mod context_menu {
    /// Only Windows has been run; on macOS and Linux the menu is still WebKit's own.
    pub fn install(_window: &tauri::WebviewWindow) {}
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            for window in app.webview_windows().values() {
                context_menu::install(window);
            }
            Ok(())
        })
        .manage(ContentClient::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![allow_library_folder, fetch_content_text, print_to_pdf])
        .run(tauri::generate_context!())
        .expect("error while running the Incudo desktop shell");
}
