# 0102 — An overlay is a patch applied to its parent on every load, and validated as the system it makes

**Status:** Accepted · 2026-10-08 · answers ROADMAP Phase 7's "Overlay an official system" · amends
[0011](./0011-user-systems.md) (the overlay's shape, and the parent-version warning) and
[0031](./0031-a-system-is-chosen-and-it-scopes-everything.md) (decision 4: a source belongs to one system) · builds on
[0003](./0003-system-agnostic-content-model.md), [0009](./0009-character-kinds.md), [0012](./0012-self-contained-saves.md),
[0039](./0039-the-cli-is-removed-and-what-it-measured-becomes-tests.md),
[0079](./0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md),
[0087](./0087-starting-equipment-is-a-data-file-beside-the-system-and-money-is-counted-in-the-units-the-system-declares.md) ·
**format:** system format, additive (`formatVersion` stays 1)

## Context

ADR 0011 offers three ways to have a system of your own. The one it prefers is the **overlay**: a small file that names
an official system and states only what is different, so a house rule does not cut its author off from upstream fixes.
That is half of Phase 7's exit criterion ("a house-rule overlay still receives upstream fixes"), and none of it exists.

### Measured first

- **The root `extends` is declared and read by nothing.** `schemas/system.schema.json` has had
  `"extends": { "type": "string" }` at the root since ADR 0011. No code reads `GameSystem.extends`; the only `extends`
  that does anything is a character kind's (ADR 0009). No shipped or test system sets it.
- **ADR 0011's own example is refused.** Put through `validateGameSystem` as written, it gets three errors:
  `"elementTypes" is required`, `"characterKinds" is required`, `"stats" must be an array, not an object`. The schema
  only describes a complete system.
- **The parent's version says nothing.** ADR 0011 wants an overlay to record "the parent version it was written against"
  and warn on mismatch. `systems/dnd5e/system.json` has read `"version": "0.2.0"` since ADR 0009, through 72 commits that
  changed it. A warning keyed on it would never fire. This is the same finding ADR 0050 made about AuroraLegacy's index,
  which has been 0.0.1 since 2023.
- **Arrays carry most of a system, and most of them have an identity.** An inventory of the schema finds 41 arrays of
  objects. Fourteen have a field that names the entry: `elementTypes`, `stats` and a kind's `stats` and
  `companions.stats` by `name`; `generationMethods`, `characterKinds`, `buildSteps`, `sheet.sections`,
  `companions.sheet`, `inventory.slots`, `play.rests` and `play.trackers` by `id`; `blockFilters` and `freeform.fields`
  by `key`. (`suggestedSources` requires a `name`, but ADR 0031 decision 4 keys a source by its URL.) The rest are lists
  of rules with no identity: contributions, track and block stats, setter rules, candidate notes, an expression's
  arguments. A general JSON merge patch replaces arrays whole, so an overlay changing one stat would have to copy all of
  them and would stop receiving fixes to the rest. That is the failure the overlay exists to prevent.
- **An overlay of 5e needs 5e's sources and 5e's files.** Sources are tagged with the system they were added under and a
  URL can belong to only one system (ADR 0031 decision 4). Under that rule an overlay could not load AuroraLegacy without
  taking it away from 5e. Starting equipment (`file.system === system.id`) and the official form map
  (`map.system === system.id`) are matched by id too, so an overlay would lose both. Those are the capabilities an
  official system has and a user system would lack, which ADR 0011 calls a bug.

## Decision

### 1. A system definition with a root `extends` is an overlay, and it is never seen by the engine

An overlay is a document with `formatVersion`, `id`, `name`, `version` and `extends` (the parent's id), plus any other
root field of the system format, written as a **patch**. `validateGameSystem` recognises it by `extends` and, given a way
to find the parent, applies the patch to the parent and **validates the result as a complete system**, with the same
schema and the same reference checks as any other. What comes back is an ordinary `GameSystem` that keeps `extends` as a
record of its parent. The engine, the builder and the sheet never see a patch.

The overlay's own shape is `$defs/overlay` in `system.schema.json`: those five fields required, every other root field of
the format allowed, and its type checked (an array, an object or a string as the full format has it). The parts are
checked once they are applied, since a patch entry is a fragment and would fail the full schema on its own. A guard test
holds `$defs/overlay`'s field names to the root's, so a new root field cannot be left out of overlays.

**Validating the result is what makes upstream fixes safe.** An overlay is stored as the user wrote it. On every load it is
applied to the parent as it is *today* and checked again (`UserSystemStore` already revalidated every load). A fix to
the parent that the overlay does not touch is in the result. A change to the parent that breaks the overlay is a
validation failure, named on the launcher, and is never half-loaded (ADR 0011).

### 2. The patch: objects merge, identified entries merge by their identity, anything else is replaced

- **An object** merges key by key, recursively. A key set to `null` removes the parent's value. No field of the system
  format takes `null`.
- **An array whose entries have an identity**, the fourteen above and `suggestedSources` by `url`, merges entry by entry.
  An overlay entry whose identity the parent has is merged into that entry as an object, and keeps the parent's position.
  One the parent lacks is appended. An entry with `"remove": true` removes the parent's entry with that identity. No
  identified entry in the format has a field called `remove`, and a guard test holds that.
- **A kind's `elementTypes`** written with ADR 0009's `+Type` / `-Type` delta is applied to the parent's list, the way an
  inheriting kind's is. A plain list replaces it.
- **Any other array**, and any string, number or boolean, is replaced whole.

The identified arrays are a table in `packages/core/src/system-overlay.ts`, not something inferred. A guard test walks the
schema and fails on any array of objects whose entries require `id`, `name` or `key` and that the table neither merges nor
lists as replaced on purpose, so the format and the merge cannot drift apart.

ADR 0011's example becomes:

```jsonc
{ "formatVersion": 1, "id": "dnd5e-homebrew", "name": "5e (our table)", "version": "1.0.0", "extends": "dnd5e",
  "stats": [{ "name": "sanity", "label": "Sanity", "default": 10 }],
  "characterKinds": [{ "id": "pc", "progression": { "max": 30 } }] }
```

`add` and `patch` as verbs were considered and declined. They make every array two arrays and say nothing that "the
parent has this id or it does not" doesn't already say.

### 3. What an overlay changes is published, in words, and a removal of something absent is said

Applying an overlay gives back the list of what it changed: a field changed, an entry changed, added or removed, and a
`remove` naming nothing the parent has, which is reported and not refused. Upstream may have removed the entry already,
and what the overlay wanted is then true. The launcher card of an overlay says what it is built on and lists what it
changes. The words are `packages/ui`'s (`overlayView`). Nothing on the card is a path or an id the user did not write.

**The parent-version warning is declined** (amending ADR 0011's bullet). The version has said nothing for 72 commits, and
applying the overlay again and validating the result on every load covers what the warning was meant to catch, with a
result instead of a hint. If a parent's version ever starts saying something, an optional field can be added then.

### 4. An overlay's parent is a complete system, shipped or the user's

The parent is looked up among the shipped systems and the user's complete ones, never another overlay. Overlays of
overlays need an order of application and a depth limit, and nothing asks for them yet. An overlay naming no system
Incudo has, or naming an overlay, is refused with a sentence. A shipped id is still reserved (ADR 0031): an overlay has
its own id, not its parent's. A character built in the overlay records the overlay's id, and like any user system's it
opens when the overlay is present. A save still embeds every element it uses (ADR 0012) and never the system.

### 5. A system answers to its parent's id for what is kept beside it, and loads its parent's sources

`systemLineage(system)` (core) is the system's id, then its parent's. Three things that were matched by id ask it
instead:

- **Content sources** (amending ADR 0031 decision 4): a system loads the enabled sources tagged with its own id or its
  parent's. A source added while the overlay is chosen is tagged with the overlay's id and loads for it alone. One URL
  still has one tag, so a 5e source is not duplicated, and switching it off in the overlay switches it off for 5e. The
  Sources pane says which sources come from the parent.
- **Starting equipment** (ADR 0087) and **form maps** (ADR 0079): a file naming the parent's id serves the overlay. The
  existing checks still apply: the kind must exist and the step must be one the kind has. So an overlay that removes a step
  loses the package, and nothing fills a form for a kind it does not have.

Reading an Aurora save (`.dnd5e`) still picks a system by the extension, so an import on the phone picks 5e. The phone
has no user systems yet; that is the Phase 7 item "User systems load through exactly the same path".

## Consequences

**Good**
- A house rule is a few lines, and every fix to 5e that it does not touch arrives with the next update, checked.
- The engine is untouched: an overlay is a system by the time anything reads it, so official and user systems still load
  by one path (ADR 0011), and the Aurora oracle cannot move.
- The overlay's patch is the only new rule in the format. Fork and scaffold, the next Phase 7 items, write files this
  already reads.

**Bad / accepted**
- **An error is reported on the applied system**, with its paths (`characterKinds[0].progression.max`), not on the line of
  the overlay that caused it. Every error in the result is the overlay's, since the parent validates. Naming entries by
  their id rather than their position is the Phase 7 item on errors a non-programmer can act on.
- **A patch to an entry upstream renamed becomes an addition.** It shows on the card as "adds", and usually fails
  validation as a fragment. It is not detected as a rename, because nothing could tell one apart.
- **A new identified entry is appended.** An overlay cannot place a build step or a sheet section before another one.
  Asked for by nothing yet.
- **A source shared with the parent is one source.** Switching it off or removing it in the overlay does it for the parent.
- **No overlays of overlays**, and removing a user system that an overlay is built on leaves the overlay failing to
  load, named, until its parent returns.
- **A JSON editor pointed at `system.schema.json` still validates an overlay as a complete system** and complains. The
  overlay's own shape is a `$defs` entry of the same file, and the guide (a Phase 7 item) says how to point an editor at it.
