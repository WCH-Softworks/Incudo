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

A character is then **a list of chosen element IDs plus a few free-text fields**, and the recorded
results of any dice it rolled. Everything else — AC, speed, spell slots, proficiency bonus — is
*derived* by running the rules. Rolls are the one exception, and a principled one: a die roll has
no formula, so re-deriving it would silently reroll it ([ADR 0007](./adr/0007-native-formats.md)).

The **saved file** is bigger than the character, on purpose. A `.incu` is a zip carrying the
character *and* the slice of content it references, so it opens on a fresh install with no
content sources configured ([ADR 0012](./adr/0012-self-contained-saves.md)). The trade that buys
it is real and stated there: upstream content fixes no longer apply silently, they become an
offer to refresh.

See [`DATA-MODEL.md`](./DATA-MODEL.md) for the concrete types and
[`AURORA-FORMAT.md`](./AURORA-FORMAT.md) for the format this was reverse-engineered from.

## What makes it system-agnostic

The engine never says "Strength". It says "the stat named `strength`". A **game system
definition** (`systems/<id>/system.json`) is data that declares:

- which element types exist and how they relate (`Class` has `Archetype` children, etc.)
- which stats exist, their defaults, and how derived stats are computed
- which **kinds of character** it can build, each declaring its own build flow (which steps, in
  which order, which are required), its sheet layout, and how it progresses — a level, a
  challenge rating, an xp total, or not at all ([ADR 0009](./adr/0009-character-kinds.md))

D&D 5e is `systems/dnd5e`. Nothing in `@incudo/core` imports it. Phase 5 of the roadmap
exists specifically to prove this by shipping a second one.

> **Reality check:** 5e will be the only serious test for a long time, so the engine *will*
> drift 5e-shaped. The mitigations are (a) `tools/verify`, whose tests exercise the engine with no UI
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
  degrades gracefully to whatever was last seen rather than failing. The app composes one of
  these per enabled source (ADR 0029). It did not until the library work — it built a bare
  `HttpContentSource` whose `writeThrough` wrote a cache nothing read back — so a reload
  re-fetched all 238 files every time. `BundledContentSource` is still the one implementation
  in this list that does not exist; nothing has needed it.

The user-facing toggle is **per source**: *stream* or *download*. Mobile defaults to download
(metered connections); desktop defaults to stream with an opt-in download. Today the two differ
only in *when* files are fetched — ADR 0004's lazy per-file loading needs an `ElementIndex` that
can miss, and there is not one. ADR 0029 says so rather than letting the toggle imply more.

Which sources exist is a **profile** the user owns; a character's `sources` is a record of what
it was built against. The two are allowed to disagree, and that disagreement is what lets the app
say "Xanathar's has moved since you built this" instead of silently changing someone's character
(ADR 0028). Neither is consulted to *open* a character — a save carries its own content.

## Platform boundaries

Core and content never import platform APIs. They take two injected interfaces:

```ts
interface Fetcher        { fetchText(url: string): Promise<FetchResult> }
interface Storage        { read(key): Promise<string|null>; write(key, value): Promise<void>; ... }
interface ZipCodec       { zip(files): Promise<Uint8Array>; unzip(bytes): Promise<...> }
interface CharacterStore { location(); choose(); list(); read(entry); write(entry, files); ... }
```

| | desktop | mobile | tests |
|---|---|---|---|
| `Fetcher` | Tauri HTTP plugin | `fetch` | `fetch` |
| `Storage` | IndexedDB | `expo-file-system` | node `fs` |
| `ZipCodec` | `CompressionStream` | a native module | `node:zlib` |
| `CharacterStore` | Tauri dialog + fs | `expo-file-system` | node `fs` |

`CharacterStore` is the user's **library folder** (ADR 0027) and is deliberately not `Storage`:
`Storage` is the app's own key/value space, holding a content cache and a draft that the user
never opens, while a library is their files, very possibly in git. `ZipCodec` is DEFLATE only —
the zip framing itself lives in `core`, so the two shells cannot drift.

This is the single rule that keeps one codebase serving two apps. It also means the whole engine
is testable in Node with no mocks beyond a fake fetcher.

## Code reuse policy

The short version, in priority order:

1. **Domain logic goes in `@incudo/core`.** If a rule about the game lives in a component,
   that is a bug.
2. **Platform I/O is injected, never imported** (above).
3. **`@incudo/ui` holds components with no platform imports.** React Native Web is *not*
   used to force sharing.
4. **View-models are shared, views are not.** `CharacterBuilder` is shared; the screen that
   renders it is per-app. This is where the real leverage is — the hard logic is shared, and
   the layout is free to be a dense pane on desktop and a card stack on mobile. What is *not*
   free to differ is which decisions are outstanding ([ADR 0017](./adr/0017-open-decisions-not-steps.md)).

Expected shape: ~80% of the code (core + content + import + view-models) shared, ~20% per-shell.
See [`CODE-REUSE-POLICY.md`](./CODE-REUSE-POLICY.md) for the enforceable version.

## Why Tauri + Expo and not one framework

Full reasoning in [ADR 0001](./adr/0001-tech-stack.md). Summary: the hard part of this project is
the rules engine and the Aurora importer, and that part is shared regardless of UI framework.
Given that, the UI choice optimizes for a small, fast desktop binary (Tauri ≈10MB vs Electron
≈150MB) and a genuinely native mobile feel (Expo), while reusing existing React Native
experience. The cost is two shells instead of one — accepted, because the shells are thin.
