# Architecture

## One sentence

Incudo is a **generic rules-element engine** (`@incudo/core`) with a **content layer**
that can read from a remote repo or a local cache, wrapped by **two thin UI shells** — Tauri on
desktop and Expo on mobile — that share a React component library and shared view-models.

```
                  ┌───────────────────────────────┐
                  │  apps/desktop  (Tauri + React) │
                  ├───────────────────────────────┤
                  │  apps/mobile   (Expo + RN)     │
                  └───────────────┬───────────────┘
                                  │  UI only: layout, navigation, platform I/O
                  ┌───────────────▼───────────────┐
                  │        @incudo/ui           │  shared components + view-model hooks
                  └───────────────┬───────────────┘
                  ┌───────────────▼───────────────┐
                  │      @incudo/content        │  sources, cache, sync, indexes
                  └───────────────┬───────────────┘
      ┌───────────────────────────┼───────────────────────────┐
┌─────▼────────────┐    ┌─────────▼─────────┐    ┌────────────▼────────┐
│ @incudo/core  │◄───┤ @incudo/       │    │ systems/*           │
│ model + engine   │    │ aurora-import     │    │ (dnd5e, cairn, ...) │
└──────────────────┘    └───────────────────┘    └─────────────────────┘
```

Everything below `@incudo/ui` is **pure TypeScript with no platform APIs** — no `fs`, no
`window`, no `react-native`. That is what makes the two apps cheap.

---

## The central idea: elements and rules

Aurora got one thing very right, and Incudo keeps it: **all game content is the same shape.**
A race, a class feature, a magic item and a spell are all *elements*. An element has:

- an **id** (stable, globally unique, e.g. `ID_WOTC_PHB_CLASS_ROGUE`)
- a **type** (`Race`, `Class`, `Spell`, … — declared by the game system, not hardcoded)
- a **source** (which book/index it came from)
- **setters** — arbitrary key/value data (`hd: d8`, `school: Evocation`, `cost: 50 gp`)
- **rules** — what it *does* to a character
- **description** — rich text for display

There are only a handful of rule kinds, and they compose into everything:

| Rule | Meaning |
|---|---|
| `grant` | give the character another element (optionally at a level, optionally conditionally) |
| `select` | the character must choose N elements matching a filter |
| `stat` | add to / set a named numeric or string stat |
| `supports` | tag this element so `select` filters can find it |
| `requirements` | a boolean expression gating any of the above |

A character is then **a list of chosen element IDs plus a few free-text fields**. Everything
else — AC, speed, spell slots, proficiency bonus — is *derived* by running the rules. This makes
characters tiny, diffable, and forward-compatible: if content is fixed upstream, the character
re-derives correctly.

See [`DATA-MODEL.md`](./DATA-MODEL.md) for the concrete types and
[`AURORA-FORMAT.md`](./AURORA-FORMAT.md) for the format this was reverse-engineered from.

## What makes it system-agnostic

The engine never says "Strength". It says "the stat named `strength`". A **game system
definition** (`systems/<id>/system.json`) is data that declares:

- which element types exist and how they relate (`Class` has `Archetype` children, etc.)
- which stats exist, their defaults, and how derived stats are computed
- the shape of the build flow (which steps, in which order, which are required)
- character sheet layout hints

D&D 5e is `systems/dnd5e`. Nothing in `@incudo/core` imports it. Phase 5 of the roadmap
exists specifically to prove this by shipping a second one.

> **Reality check:** 5e will be the only serious test for a long time, so the engine *will*
> drift 5e-shaped. The mitigations are (a) the CLI, which exercises the engine with no UI
> assumptions, and (b) `systems/cairn`, a deliberately tiny non-D&D system added early enough
> that violations hurt immediately.

## Content sources: live vs downloaded

`@incudo/content` exposes one interface with several implementations:

- **`HttpContentSource`** — fetches an index and its files on demand, straight from the repo.
  Aurora cannot do this; it is the headline feature. Resolves relative URLs against the index
  and can lazily fetch only the files a character actually needs.
- **`CachedContentSource`** — a local, versioned copy on disk. Full offline. Update checks
  compare the index's `update.version` against what is cached.
- **`BundledContentSource`** — content shipped inside the app (SRD-safe material only).
- **`LayeredContentSource`** — composes the above: cache → network → bundled, so "live"
  degrades gracefully to whatever was last seen rather than failing.

The user-facing toggle is **per source**: *stream* or *download*. Mobile defaults to download
(metered connections); desktop defaults to stream with an opt-in download.

## Platform boundaries

Core and content never import platform APIs. They take two injected interfaces:

```ts
interface Fetcher  { fetchText(url: string): Promise<FetchResult> }
interface Storage  { read(key): Promise<string|null>; write(key, value): Promise<void>; ... }
```

| | desktop | mobile | CLI / tests |
|---|---|---|---|
| `Fetcher` | Tauri HTTP plugin | `fetch` | `fetch` |
| `Storage` | Tauri fs plugin | `expo-file-system` | node `fs` |

This is the single rule that keeps one codebase serving two apps. It also means the whole engine
is testable in Node with no mocks beyond a fake fetcher.

## Code reuse policy

The short version, in priority order:

1. **Domain logic goes in `@incudo/core`.** If a rule about the game lives in a component,
   that is a bug.
2. **Platform I/O is injected, never imported** (above).
3. **`@incudo/ui` holds components with no platform imports.** React Native Web is *not*
   used to force sharing.
4. **View-models are shared, views are not.** A `useCharacterBuilder()` hook is shared; the
   screen that renders it is per-app. This is where the real leverage is — the hard logic is
   shared, and the layout is free to be dense on desktop and a wizard on mobile.

Expected shape: ~80% of the code (core + content + import + view-models) shared, ~20% per-shell.
See [`CODE-REUSE-POLICY.md`](./CODE-REUSE-POLICY.md) for the enforceable version.

## Why Tauri + Expo and not one framework

Full reasoning in [ADR 0001](./adr/0001-tech-stack.md). Summary: the hard part of this project is
the rules engine and the Aurora importer, and that part is shared regardless of UI framework.
Given that, the UI choice optimizes for a small, fast desktop binary (Tauri ≈10MB vs Electron
≈150MB) and a genuinely native mobile feel (Expo), while reusing existing React Native
experience. The cost is two shells instead of one — accepted, because the shells are thin.
