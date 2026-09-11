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

**Start with `npm run desktop`.** It is the whole application in a browser: it loads and
validates the shipped 5e system definition, loads an Aurora content index over the network,
and builds a character. Every piece of UI work can happen there.

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

## What belongs here

Windows and menus, navigation, file dialogs, keyboard shortcuts, the dense multi-pane
layout, and the two platform implementations in `src/platform.ts`.

## What does not

Any rule about the game. If a bug is "the app computed the wrong AC", it must be fixable
in `packages/`, not here. See [docs/CODE-REUSE-POLICY.md](../../docs/CODE-REUSE-POLICY.md).

Most of what this app appears to "do" is `packages/ui`'s `CharacterBuilder`, rendered. The one
place that boundary was found to be wrong — a required build step with nothing picked reporting
itself complete — was fixed in `packages/ui`, not worked around here.
