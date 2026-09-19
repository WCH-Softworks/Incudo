# Incudo desktop

Tauri 2 + React + Vite ([ADR 0001](../../docs/adr/0001-tech-stack.md)).

`src/platform.ts` is the contract with the shared packages: it is the only file in this app
allowed to know it is running in Tauri.

## Running it

```bash
npm run desktop          # Vite dev server at http://localhost:5173 — no Rust, no icon needed
npm run desktop:app      # the real Tauri window (see "Icons" below)
npm run desktop:build    # production web bundle into apps/desktop/dist
```

**Start with `npm run desktop`.** It is the whole application in a browser: it opens on the
character library, reads and writes real `.incu` files in a folder you pick, imports Aurora
`.dnd5e` saves into it, manages content sources, and builds a character. Every piece of UI
work can happen there.

Choosing the library folder is a **setup question asked once**: the first run puts it in front
of you as a dismissible dialog, and after that it is a row in **Settings** rather than a button
beside "New character". Declining is a real answer — sources and the builder work without a
library, and only *saving* needs somewhere to save to.

The library in that build is the **File System Access API** — a real directory handle with real
bytes, not a localStorage pretence (ADR 0027). One honest difference from the Tauri window: a
browser grants a directory per session unless you have said "allow on every visit", so a reload
may need one click on **Choose folder** to reconnect. Firefox and Safari have no such API at
all, and there the app says so and offers nothing rather than faking a library.

If the port is busy, `npm run desktop` names the process holding it and prints the command to
kill it. The port is fixed rather than auto-selected because Tauri points its window at
`http://localhost:5173` exactly; a server that quietly moved to 5174 would leave that window
blank. A leftover *detached* dev server has no console, so it appears under Task Manager’s
Background processes rather than under Apps — which is why it can look like there is nothing to
kill.

`npm run desktop:app` additionally needs a Rust toolchain (`rustup`) and the platform
prerequisites at https://v2.tauri.app/start/prerequisites/. No Rust is needed for application
code.

## Icons

`src-tauri/icons/` is generated from the maintainer's logo; `src-tauri/icons/README.md` says how
and what is still a design decision. Incudo never ships generated artwork. `npm run desktop` does
not need any of it.

## Why Tauri rather than a web page

A browser `fetch` for a content index is subject to CORS, and
`raw.githubusercontent.com` happens to cooperate while plenty of hosts do not. The Tauri build
registers `tauri-plugin-http`, which is not.

Its capability allows `https://**` and denies `http://**`. That is wide, and it is wide on
purpose: the product is "point it at any content index you like", so an allowlist of hosts would
be a list of which third-party content packs are permitted to exist. Narrowing it to a few hosts
would be a product decision, not a security tidy-up.

## Importing an Aurora save needs no new Rust, and that was worth checking

**Import from Aurora…** on the library screen reads one or more `.dnd5e` files from anywhere
on disk. That is a path outside the library folder, and the fs scope below starts empty — so
the obvious assumption is that it needs a second `#[tauri::command]` beside
`allow_library_folder`. It does not: `tauri-plugin-dialog`'s own `open` command calls
`allow_file` on the fs scope for every path it returns, so a file picked now and read now is
already in scope. (`allow_library_folder` still earns its place, for two reasons the file
case does not have: the dialog grants a picked *directory* non-recursively while an unpacked
container has an `assets/` subfolder, and the scope is not persisted, so a remembered folder
must be re-granted at launch.)

Everything between the picker and the library folder is `importAuroraSaveIntoLibrary` in
`packages/ui`, not here. This app supplies the `FilePicker` port and renders the report.

## Menus and keyboard shortcuts

What the app can be told to do is a list in `packages/ui/src/commands.ts` (ADR 0037): an id, a
label, a shortcut, and a rule for when it is available. This app renders it and computes nothing.
Twelve commands: go to each of the five panes (Ctrl+1 to 4, Ctrl+,), New character (Ctrl+N), Save
to library (Ctrl+S), Refresh library (Ctrl+Shift+L), Import from Aurora, Choose library folder,
Reload content sources, Change system. On macOS the same shortcuts read Cmd.

- **The Tauri window has a native menu**, built in `platform.ts` from `menuModel()`. **The browser
  build has no menu**, only the shortcuts; the nav and Save buttons show theirs as tooltips.
- **The page owns the keyboard in both builds, and the menu is for the mouse.** `use-commands.ts`
  is the one `keydown` listener. The native menu registers **no accelerator**: it prints each
  shortcut as text after a tab and runs a command when clicked. This was first built the other way
  round (menu accelerators own the keys) and pressing the keys in the Windows window showed it
  does nothing: WebView2 gives the page the key and the host's accelerator table never runs the
  item. Do not register accelerators without pressing the keys in the window afterwards.
- **A command is enabled where its outcome can be seen**: New character and Import on the
  characters screen, Save on Build. Everything is off on the launcher and behind a dialog. A
  disabled command still *claims* its key, so Ctrl+S on the Sheet pane does not become "save this
  page" in a browser.
- Adding a command is one entry in `COMMANDS`, one in `MENUS`, one availability rule and one
  handler in `App.tsx`; a test fails if any of the first three is missing.
- What is **not** here on purpose: an explicit export ("Save a copy…"), which needs a write
  counterpart to `FilePicker` and is its own roadmap item. There is no stub for it in the menu.

### What was and was not checked (2026-09-19)

**By pressing real keys, in the Tauri window on Windows** (`npm run desktop:app`, reached through
WebView2's debug port and the Win32 menu API, keystrokes sent as real input to the focused
window): Ctrl+2, 3, 4, `,` and 1 each moved the page; Ctrl+Shift+L was claimed and rescanned;
Ctrl+S on the characters screen, where it is off, was claimed and did nothing. In the Build
screen's search box — real key events this time — typing `n s l , 1 2 3 4` came through intact,
Ctrl+A selected all eight characters, Ctrl+X emptied the field, Ctrl+V restored it and Ctrl+Z
undid the paste, with **none of those keys claimed**. The native menu has both submenus and every
label, separator, order and shortcut text matches `menuModel()`; its enabled flags follow app
state live (Build enables Save and disables New and Import; Sheet disables Save; the launcher
disables all twelve; choosing the system restores them); all five View items and Change system,
sent as the message Windows delivers for a click, did what they name.

**By pressing keys, in the browser build** (`npm run desktop`, injected key events): the same
navigation chords; Ctrl+N from the characters screen and its refusal on Build; Ctrl+S from inside
the name field, writing a real file through a directory handle; its refusal on Sheet; Ctrl+Shift+L
picking up a file added behind the app's back (1 → 2); every chord refused, and none acting,
while the rename dialog was open and working again once it closed; no chord acting on the
launcher. The console was clean. Injected key events cannot perform editing chords there (with
the app's handler blocked, Ctrl+A selected nothing), which is why that check was done in the
window instead.

**Not verified:** the macOS application and Edit menus (written, never run), and how a macOS or
Linux menu renders the shortcut text; a chord in a real browser tab, which injected events never
pass through (Chromium reserves Ctrl+N, so New character's shortcut is a window-only shortcut);
the file-dialog items (Import, Choose folder); and New character and Save in the Tauri window,
which would have written to the developer's own library. Also not tried: a menu item clicked with
a real mouse (a click was sent as its Windows message instead).

**What the first attempt taught.** Everything that needed no keyboard passed on the first design:
the menu existed, its flags followed state, its items drove the app. Then the keys did nothing.
And a tap of Alt, used by the test harness to get focus, appeared to put the window into
menu-bar mode: the page stopped answering the debug port and swallowed the Ctrl+2 that followed,
until Escape. That is ordinary Windows behaviour for a window with a menu bar, and it was seen
once, through the harness.

## Two capabilities, opposite widths, and why

`dialog` and `fs` joined `http` when the library arrived, and the filesystem scope is as narrow
as the HTTP scope is wide. That asymmetry is the decision, not an inconsistency.

**The fs capability grants the commands and no paths at all.** `capabilities/default.json` lists
`fs:allow-read-dir`, `fs:allow-read-file` and so on — what the window may *do* — and the set of
paths it may do them to starts empty. One `#[tauri::command]` in `src-tauri/src/lib.rs`,
`allow_library_folder`, widens it to exactly the directory the picker returned. Nothing else can
add to it, and nothing in the JS API could have done this, which is why the project's only piece
of application-shaped Rust exists.

An app that can read any path on the machine is not the same app as one that can read the folder
its user chose in a dialog, and a content index is a URL somebody publishes while a library is a
folder full of somebody's files.

**The window builds and runs** (`npm run desktop:app`, checked when the menu landed), but nothing
in this section was exercised by that run: the folder scope, `allow_library_folder` and the
dialogs were not driven. What is checked is that every permission identifier used exists in the
plugins' own manifests under `~/.cargo/registry/.../tauri-plugin-{fs,dialog}-*/permissions/`.
Treat the Tauri library path as unproven until someone opens a folder in the window.

## What belongs here

Windows and menus, navigation, file dialogs, keyboard shortcuts, the dense multi-pane
layout, and the platform implementations in `src/platform.ts`.

That file now carries six ports rather than two — `Fetcher`, `Storage`, `CharacterStore`,
`FilePicker`, `ZipCodec` and `CommandHost` — and it is still the only file allowed to say the word
Tauri.
Three of them are worth knowing about before changing anything:

- **`Storage` is IndexedDB in both builds.** It holds the content cache and the current draft:
  app-managed, invisible to the user. It was `localStorage`, which caps out near 5 MB and would
  silently fail to cache a 15 MB corpus. Real files were the other option and they lose on
  Windows — a cache key is a source URL plus a file URL, both percent-encoded, which comes to
  roughly 290 characters against a MAX_PATH of 260.
- **`CharacterStore` is the user's folder**, and is never in `Storage`. Different rules, so a
  different port (ADR 0027).
- **`FilePicker` is neither.** One file, outside both, read once in full and then forgotten —
  which is why it is not a method on `CharacterStore`, whose every method means "inside the
  folder the user chose". In the browser build it is `showOpenFilePicker`, and where that is
  missing so is the rest of the File System Access API, so there would be no library for an
  import to land in: the picker says it is unavailable rather than offering a dialog whose
  only possible ending is "no library folder has been chosen".

## What does not

Any rule about the game. If a bug is "the app computed the wrong AC", it must be fixable
in `packages/`, not here. See [docs/CODE-REUSE-POLICY.md](../../docs/CODE-REUSE-POLICY.md).

Most of what this app appears to "do" is `packages/ui`'s `CharacterBuilder`, rendered. The one
place that boundary was found to be wrong — a required build step with nothing picked reporting
itself complete — was fixed in `packages/ui`, not worked around here.
