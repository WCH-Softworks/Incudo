# 0001 — Tech stack: TypeScript core, Tauri desktop, Expo mobile

**Status:** Accepted · 2026-09-09

## Context

HeroForge needs a desktop app (character building, the Aurora replacement) and a mobile app
(at minimum, playing from a sheet). The bulk of the work is a rules engine and an Aurora XML
importer — neither of which cares about the UI framework.

The author's experience: C#/WinForms desktop, React Native mobile, plus small Electron and
Capacitor projects. No Rust, no Dart, no MAUI.

Options weighed:

1. **.NET (C#) with MAUI or Avalonia.** Strongest language match. One toolchain, excellent XML
   handling, and Avalonia genuinely covers desktop well. Against it: MAUI's mobile story is
   thinner than React Native's, the community around hobby cross-platform .NET apps is small,
   and — the deciding factor — it repeats Aurora's own trap of being a .NET desktop app whose
   ecosystem the maintainer is alone in.
2. **Flutter.** Best single-codebase story on paper. Against it: an entirely new language and
   ecosystem, no reuse of prior experience, and a solo open-source project cannot afford the
   learning curve on top of the domain complexity.
3. **Electron + Capacitor.** Fastest to a first build and the least new tooling. Against it:
   ~150MB desktop binaries and high idle memory for what should be a small utility, plus a
   web-app feel on mobile. Aurora is a lean desktop app; a heavier replacement is a bad trade.
4. **TypeScript core + Tauri desktop + Expo mobile.** Chosen.

## Decision

- **Language: TypeScript everywhere below the UI.** The engine, content layer and Aurora importer
  are plain TypeScript with no platform APIs; they run in Node, browsers and Hermes unchanged.
- **Desktop: Tauri 2 + React + Vite.** ~10MB binaries, native webview, Windows/macOS/Linux.
  No Rust is required for application code — the Rust side is the generated shell plus plugins.
- **Mobile: Expo (React Native).** Reuses existing experience; Expo removes most of the native
  build pain and supports over-the-air updates.
- **Package manager: npm workspaces.** Not pnpm — Metro's handling of symlinked workspaces is
  still the flakiest part of an RN monorepo, and npm's flat install avoids it. Revisit if the
  install time becomes a problem.

## Consequences

**Good**
- The expensive, interesting code is written once and testable in Node with no mocks.
- A small desktop binary — appropriate for a tool that replaces a lean native app.
- Two shells means each app can be shaped for its platform instead of being a compromise.
- A CLI falls out for free, which is how the importer gets validated before any UI exists.

**Bad / accepted risks**
- Two UI codebases to maintain. Mitigated by the layering in ADR 0002 — the shells are thin, and
  view-models are shared.
- Tauri means a Rust toolchain in the build, and Rust knowledge if a custom plugin is ever
  needed. Accepted; the escape hatch is that the frontend is portable to Electron in a day if it
  ever becomes a real blocker.
- Tauri's webview is the OS webview, so rendering varies slightly across platforms (notably older
  WebView2/WebKitGTK). Acceptable for a form-heavy app; would not be for a canvas-heavy one —
  **this needs revisiting before the Phase 3.x mapmaking work.**
- No compile-time guarantee that a package stays platform-free. Enforced by lint rules and CI
  instead (see `docs/CODE-REUSE-POLICY.md`).

## Revisit if

- Mapmaking (roadmap 3.x) needs heavy canvas/GPU work the OS webview handles badly.
- The mobile app needs deep native integration Expo does not cover.
- Maintaining two shells measurably slows feature work — the fallback is to collapse to one
  React Native + RN Web codebase, which the layering already permits.
