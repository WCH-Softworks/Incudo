# Incudo desktop

Tauri 2 + React + Vite. **Not scaffolded yet** — this is ROADMAP Phase 1.

`src/platform.ts` is already here because it is the contract with the shared packages:
it is the only file in this app allowed to know it is running in Tauri.

## To scaffold (when Phase 1 starts)

```bash
npm create tauri-app@latest -- --template react-ts   # into a scratch dir, then merge
npm install -w @incudo/desktop
npm run tauri:dev -w @incudo/desktop
```

Requires a Rust toolchain (`rustup`) plus the platform prerequisites listed at
https://v2.tauri.app/start/prerequisites/. No Rust is needed for application code.

## What belongs here

Windows and menus, navigation, file dialogs, keyboard shortcuts, the dense multi-pane
layout, and the two platform implementations in `src/platform.ts`.

## What does not

Any rule about the game. If a bug is "the app computed the wrong AC", it must be fixable
in `packages/`, not here. See `docs/CODE-REUSE-POLICY.md`.
