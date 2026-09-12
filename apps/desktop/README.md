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
character library, reads and writes real `.incu` files in a folder you pick, manages content
sources, and builds a character. Every piece of UI work can happen there.

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
prerequisites at https://v2.tauri.app/start/prerequisites/, plus an icon this repo does not
ship — see below. No Rust is needed for application code.

## Icons — a deliberate gap

`src-tauri/icons/` is empty and the Windows build fails because of it. That is not a broken
checkout: Incudo never ships generated artwork, so the icon is left for a person to draw.
`src-tauri/icons/README.md` says exactly what is needed. `npm run desktop` is unaffected.

## Why Tauri rather than a web page

A browser `fetch` for a content index is subject to CORS, and
`raw.githubusercontent.com` happens to cooperate while plenty of hosts do not. The Tauri build
registers `tauri-plugin-http`, which is not.

Its capability allows `https://**` and denies `http://**`. That is wide, and it is wide on
purpose: the product is "point it at any content index you like", so an allowlist of hosts would
be a list of which third-party content packs are permitted to exist. Narrowing it to a few hosts
would be a product decision, not a security tidy-up.

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

**None of this is verified by a build.** `cargo check` stops in `build.rs` on the missing icon
below, so the Rust half of the library is written and unexercised. What *is* checked is that
every permission identifier used exists in the plugins' own manifests under
`~/.cargo/registry/.../tauri-plugin-{fs,dialog}-*/permissions/`. Treat the Tauri path as
unproven until someone with an icon runs it.

## What belongs here

Windows and menus, navigation, file dialogs, keyboard shortcuts, the dense multi-pane
layout, and the platform implementations in `src/platform.ts`.

That file now carries four ports rather than two — `Fetcher`, `Storage`, `CharacterStore` and
`ZipCodec` — and it is still the only file allowed to say the word Tauri. Two of them are worth
knowing about before changing anything:

- **`Storage` is IndexedDB in both builds.** It holds the content cache and the current draft:
  app-managed, invisible to the user. It was `localStorage`, which caps out near 5 MB and would
  silently fail to cache a 15 MB corpus. Real files were the other option and they lose on
  Windows — a cache key is a source URL plus a file URL, both percent-encoded, which comes to
  roughly 290 characters against a MAX_PATH of 260.
- **`CharacterStore` is the user's folder**, and is never in `Storage`. Different rules, so a
  different port (ADR 0027).

## What does not

Any rule about the game. If a bug is "the app computed the wrong AC", it must be fixable
in `packages/`, not here. See [docs/CODE-REUSE-POLICY.md](../../docs/CODE-REUSE-POLICY.md).

Most of what this app appears to "do" is `packages/ui`'s `CharacterBuilder`, rendered. The one
place that boundary was found to be wrong — a required build step with nothing picked reporting
itself complete — was fixed in `packages/ui`, not worked around here.
