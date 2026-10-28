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
                  │      @incudo/content        │  sources, profiles, loading converted content
                  └───────────────┬───────────────┘
      ┌───────────────────────────┼───────────────────────────┐
┌─────▼────────────┐    ┌─────────▼─────────┐    ┌────────────▼────────┐
│ @incudo/core  │◄───┤ @incudo/       │    │ systems/*           │
│ model + engine   │    │ aurora-import     │    │ (dnd5e, cairn, ...) │
│                  │    │ (the converter)   │    │                     │
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
> assumptions, and (b) Cairn (`tools/verify/fixtures/systems/cairn` since 2026-10-27, not shipped in 1.0), a deliberately tiny non-D&D system added early enough
> that violations hurt immediately.

## Content sources: converted once, loaded from Incudo's own format

Incudo reads one content format, its own: `schemas/content.schema.json`, `formatVersion` 1, checked by
`checkContentBundle` in core. A save's `content.json`, a homebrew source and a converted source are all that
format ([ADR 0119](./adr/0119-aurora-content-is-converted-into-incudo-content-and-nothing-past-the-conversion-knows-aurora.md)).

**Aurora's content is converted, never read.** `@incudo/aurora-import` is the converter: `convertAuroraSource` walks
an Aurora index over an injected `Fetcher` (nested indexes asked for as soon as they are named, ADR 0051), parses every
file, and writes one bundle: the elements, each `<append>` as an *extension* (rules and tags for an element another
source declares), Aurora's app elements and the improvement options it derives, each class's and background's starting
equipment read from its prose, and a description of the source (its parts, its files, their ETags, the diagnostics,
which converter version wrote it). Aurora's spellings are written as Incudo's on the way (a negated filter operand as a
`not` node, `:half` as `floor` of a half, `[character:N]` on `level`, `isRitual` as a tag), so nothing past the
converter knows Aurora: not the library, not the engine, not a system definition.

`@incudo/content` does not import the converter. It is handed one (`SourceConverter`), as it is handed a fetcher and
storage, and it keeps each source's conversion as a file through a third port, `SourceFiles` (the desktop's sources
folder in the app's data folder, which **Show file** opens; the phone's documents folder). Loading reads those files
only: no network, no Aurora parse. A refresh converts again from the network; no Aurora file is kept. A user's own
`.xml` is converted once when it is added, and a homebrew source is written in the format directly.

A source is fetched in full when it is added and kept. There used to be a per-source toggle, *stream*
or *download*; measured, the two did the same thing, and it left the UI (ADR 0100), though profiles and
saves still carry the field. On a metered connection the phone asks before an action that downloads a
source (adding, refreshing, keeping it as files) and says what it will fetch. ADR 0004's lazy per-file
loading was measured and declined (ADR 0051). A character holds a dozen of AuroraLegacy's 740 files,
but building one is offered choices from 373 of them, and an Aurora index cannot say which without
fetching them. What a load does instead is fetch nested indexes as soon as they are named, which was
where a cold first load waited on itself.

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
