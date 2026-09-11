# Incudo Roadmap

This file is the long-lived plan for Incudo. It is meant to be edited as the project
evolves — every phase below should either get shipped, get re-scoped, or get explicitly
dropped with a note saying why. Nothing here is a promise or a date; the ordering is the
commitment, not the calendar.

**Status legend:** ⬜ not started · 🟡 in progress · ✅ done · 🔒 done and frozen · ❄️ deferred · ❌ dropped

---

## The point of the project

Aurora Builder is the best offline D&D 5e character builder that exists, and it is
discontinued. Incudo aims to be:

1. **A modern replacement** — actively maintained, cross-platform, not Windows-only.
2. **Not D&D-exclusive.** The engine knows nothing about D&D. 5e is the first *system
   definition*, not the architecture — and users can author their own.
3. **Both desktop and mobile** — the same character, the same content, two shells.
4. **Content that is either downloaded or live** — read straight from a repo without
   downloading first (which Aurora cannot do), or download for full offline use.
5. **Able to read the whole Aurora ecosystem** — content *and* saved characters — while
   keeping none of its formats.
6. **Saves that always open.** A character built with 200 books loaded opens on a fresh
   install with zero sources. The save file is the product.
7. **Free and open source.** MIT, GitHub, a Ko-fi link, no paywall and no accounts.

### Non-goals (for now)

- No virtual tabletop, no combat tracker, no dice roller with 3D physics.
- No server, no account system, no cloud sync in 1.0. Files are files.
- No hosting of copyrighted rulebook content. Incudo ships an engine; users point it at
  content indexes, exactly like Aurora's "Additional Content" tab.
- **No Aurora export.** Aurora is discontinued; nothing would read it ([ADR 0008](./docs/adr/0008-aurora-compatibility-frozen.md)).

---

## Phase 0 — Foundation ✅

*Goal: a monorepo that builds, and a data model that can express D&D 5e without mentioning it.*

- [x] Monorepo scaffolding, workspaces, TypeScript project references
- [x] `ROADMAP.md`, `docs/ARCHITECTURE.md`, ADR process
- [x] `@incudo/core`: element/rule/stat model, requirements parser, stat resolver
- [x] `@incudo/core`: `GameSystem` descriptor
- [x] `@incudo/aurora-import`: Aurora `.index` + elements XML
- [x] `@incudo/content`: `ContentSource` abstraction (live / cached / layered)
- [x] CLI (`tools/incudo`) — the engine's first consumer, before any UI
- [x] Aurora **save** format reverse-engineered ([docs/AURORA-SAVE-FORMAT.md](./docs/AURORA-SAVE-FORMAT.md))
- [x] **Restructure `GameSystem` for character kinds** ([ADR 0009](./docs/adr/0009-character-kinds.md)) — breaking, so do it now
- [x] **Define the native formats** ([ADR 0007](./docs/adr/0007-native-formats.md)): `.incu`, `.incuset`, `system.json`, plus JSON Schemas in `schemas/`
- [x] **`.incu` as a self-contained zip container** ([ADR 0012](./docs/adr/0012-self-contained-saves.md)) — embed the element subset + assets; read/write the unpacked folder form too
- [x] Add `rolls` to the character model — recorded random results are inputs, not derivations
- [x] Unit tests for the stat resolver and the engine's fixed-point derivation
- [x] `incudo character` and `incudo system validate` — the whole lifecycle with no UI
- [x] **Self-containment proved, not hoped**: `incudo character verify` derives a character twice,
      once against the full corpus and once against the save alone, and diffs. A level 3 rogue
      built from the 12,058-element corpus embeds 47 elements in 23 KB and opens identically with
      zero sources. Same test on a committed fixture corpus, so CI runs it too.
- [x] CI: typecheck, test, and the corpus baseline — two jobs, `build` and `aurora-corpus`,
      the second resolving the AuroraLegacy checkout by repository path against the budgets in
      `.github/workflows/ci.yml`. Ticked on a confirmed green run of the tree it describes,
      not on local evidence.

**Exit criteria:** `incudo validate` resolves the whole AuroraLegacy index with no new unresolved
references, and a character round-trips through `.incu` JSON unchanged. **Both met**, and the
second one turned out to be the weaker claim — the container round-trips *and* re-derives
identically with no sources, which is what ADR 0012 actually asks for.

---

## Phase 1 — Aurora compatibility, finished 🔒

*Goal: read everything Aurora ever produced, then close the book on it.*
See [ADR 0008](./docs/adr/0008-aurora-compatibility-frozen.md) — this phase has an end, and
this is it.

- [x] Elements XML importer, validated against 12,058 elements with 0 errors
- [x] `.dnd5e` **character save importer**: decisions, abilities, `rndhp`, freeform, appearance
- [x] Portrait extraction — decode inline base64 out to a real image file
- [x] Invert `<sources><restricted>` into a source allowlist — and then discard all but the
      handful the character actually draws on. 37,235 disabled ids become 1–4 source refs.
- [x] `ID_INTERNAL_*` overlay so those dangling references resolve. It ended up covering **80**
      elements, not 45: real saves revealed a second family no content file mentions (twenty
      levels, two campaign options, seven baseline grants). The `ID_SIZE_*` family turned out
      to be generated too, not the upstream typos this file used to call them — they are in
      all 8 saves' `<sum>`.
- [x] **Differential verification**: `incudo aurora verify` re-derives each imported character
      and diffs against the `<sum>` / `<magic>` Aurora itself wrote.
- [x] Mark `packages/aurora-import` 🔒 **DONE** — bugfix-only from here

**Exit criteria met.** All 8 import and re-derive with **0 `element-missing`, 0 `spell-missing`,
0 `stat-mismatch`** across 951 compared element ids. The 52 remaining differences are one
species — content AuroraLegacy added *after* those saves were written — traced to four upstream
commits dated Feb–Aug 2026 and recorded in
[docs/AURORA-SAVE-FORMAT.md](./docs/AURORA-SAVE-FORMAT.md).

### What the oracle was worth

It earned its keep before it verified anything, which is the argument for building this kind of
check early rather than last. Three Aurora constructs turned out to be silently dropped by the
*content* importer:

- **element-level `<supports>`** — 3,611 blocks, 890 distinct tags, and **not one** of them was
  being read. Every `<select supports="…">` in the game matched nothing, with no error anywhere.
- **element-level `<requirements>`** — 1,845 blocks. This is how content says "the Human Variant
  exists only in a campaign using feats".
- **`<append id="…">`** — 171 blocks, the mechanism a supplement uses to extend a core element
  without editing it.

It also forced two model additions, both of them things Aurora answers in application code and
Incudo had nowhere to put: `Character.baseStats`
([ADR 0014](./docs/adr/0014-base-stats-are-inputs.md)) and a character kind's baseline `grants`
plus `progression.elementIdPattern`.

### Left for Phase 2, with the gap named

Each of these is reported by `aurora verify` as `not-modelled` rather than quietly skipped:

- **Inventory.** `<equipment>` is read and deliberately not imported — `Character` has no home
  for items, their equipped slot, or attunement. This is the `equipment` build step below.
  *(The home arrived with [ADR 0024](./docs/adr/0024-inventory-is-a-list-of-instances.md); the
  importer filling it is step 2, and nothing is derived from it until step 3.)*
- **Spell slots and spell save DC as stats.** Aurora computes the multiclass slot table in its
  own code; the 5e system definition declares no slot table, no `spellcasting:dc`, and no
  ability-score maximum. *(All three landed: the maximum with ADR 0016, the slot table with
  ADR 0018, and the save DC and attack bonus with ADR 0020.)*

---

## Phase 2 — Desktop character builder MVP 🟡

*Goal: build a legal level-1-to-20 5e PC on the desktop, offline.*

Started with the engine rather than the shell, because the differential verification of Phase 1
can check these numbers today and cannot check them through a view layer. Two ADRs landed
before any code, both touching a public API:

- **[ADR 0015](./docs/adr/0015-class-levels.md) — class levels.** The exit criterion is a
  multiclassed character and the model could not express one: level gates read the character's
  *total*, and `level:<class>` — read 150-odd times by content, written nowhere in it — was
  always zero. `Character.advancement` and engine-level tracks fix both. A ninth sample save
  (level 20 Paladin 2 / Warlock 18) was built to be the oracle the other eight could not be,
  and took `element-missing` across all nine from 9 to 1.
- **[ADR 0016](./docs/adr/0016-stat-bounds-are-expressions.md) — stat bounds.** The ability
  score maximum, and the discovery that `min`/`max` never ran for a stat without a `derive`,
  so `"max": 20` would have been a no-op.

- [ ] Tauri desktop shell, React UI, routing, persistence
- [ ] Content manager: add an index by URL, enable/disable sources, **stream or download**
- [x] **Build flow as open decisions rather than a wizard**
      ([ADR 0017](./docs/adr/0017-open-decisions-not-steps.md)). `CharacterBuilder` publishes one
      flat, always-current `decisions` list and has no cursor, so there is nothing to navigate
      back from; `buildStep` gained `requires` (order is a topological sort of it) and `budget`
      (points content adds to with the `stat` rule that already exists). The 5e order is now
      abilities → race → class → background → levels → equipment → spells → details, and that
      falls out of the data rather than out of a rule in the app. Ability scores stopped being
      a placeholder: the step used to declare `"types": []`, match no pending choice, and report
      itself complete from the first render, and the view-model had no way to set a score at all.
      What remains for the shells is the rendering — this is the view-model, not a screen.
- [ ] Level-up with `level="N"` grants and pending `<select>` choices — no longer a separate
      screen (ADR 0017): `setProgress` changes a number and the decisions it opens arrive in the
      same list as every other, tagged with the level that raised them.
- [ ] Character sheet
- [ ] Save/load `.incu` files; import `.dnd5e` (the importer is done — this is the UI for it)
- [ ] **Inventory**, which Phase 1 deferred with the gap named: items, equipped slots,
      attunement, and magic items attached to other items. Aurora's `<equipment>` block is
      already parsed and waiting. Planned in
      [docs/INVENTORY-AND-AC-PLAN.md](./docs/INVENTORY-AND-AC-PLAN.md) — five steps, of which
      the first three can be checked against Aurora and the last two cannot. It is the same
      piece of work as the armour class below, and it comes first.
  - [x] **Step 1 — the model** ([ADR 0024](./docs/adr/0024-inventory-is-a-list-of-instances.md)).
        `Character.inventory` is a list of *instances*, `character.json`'s `formatVersion` is 2,
        and the container embeds every entry's element with the carried ones included. Nothing
        derives from it yet, and no baseline moved — which is the test that step 1 was step 1.
  - [ ] Step 2 — the importer fills it, plus the 3 proxy ids into `generated-elements.ts`.
  - [ ] Step 3 — the engine seeds equipped items. **The step the oracle checks**, and the one
        that deliberately moves 47 `not-modelled` notes into compared elements.
  - [ ] Steps 4 and 5 — slots publish tags, `equipped=` starts being evaluated, and `ac` gets
        its derivation. A separate run: step 3 is the last point at which Aurora can referee.
- [ ] **Fill in the 5e system definition's remaining numbers.** Said here to be three things
      the differential verification could check the moment they existed. Reading the engine
      corrected that on two counts:
  - [x] **The ability score maximum**, which needed [ADR 0016](./docs/adr/0016-stat-bounds-are-expressions.md):
        an expression, because the corpus only ever contributes the *delta* above 20 and
        Aurora hardcodes the 20 — and a clamp that runs at all for a stat with no `derive`.
  - [x] **The spell slot table**, which needed [ADR 0018](./docs/adr/0018-tables-and-track-stats.md):
        a `table` expression, and a way for each *track* to contribute a number computed from
        its own progression, because a system definition cannot enumerate the 25 casting
        classes in the corpus. Reading the 740 files first shrank this a long way — content
        already declares every class's own table as level-gated stats, and ADR 0015's tracks
        already made those come out right. What was missing was the multiclass caster level,
        the table it indexes, and any aggregate at all. All 8 recorded slot rows across the
        nine saves are now compared and agree, and the first thing the comparison caught was
        a real bug: a negated stat reference read as a stat *named* with a leading minus,
        which gave every warlock four pact slots at every tier instead of one.
        What the oracle proves and what it does not is set out in the ADR — pact magic being
        outside the table is pinned; rounding down rather than up is not, because
        `floor(2/2)` and `ceil(2/2)` agree and no sample save has two Spellcasting classes.
  - [x] **Hit points**, which needed [ADR 0019](./docs/adr/0019-recorded-rolls-are-readable.md).
        Not a missing formula so much as a missing *reader*: `deriveCharacter` had never once
        touched `character.rolls`, so the per-level results the importer writes and the `.incu`
        round-trips were consumed by nothing. A `rolls` expression sums them over the
        progression, and `hp` is that plus `constitution:modifier × level`. Every 5e character
        used to have 0 hit points; the Hexadin now has 207.
        **Not verified against Aurora, and it cannot be** — the save format records the rolls
        and never the total, so there is no `<sum>`, no `<magic>` and no stat block to diff.
        This is the first Phase 2 number settled by reading the rules rather than by the
        differential check, and it should be read that way.
  - [x] **Spell save DC and attack bonus as declared stats**, which needed
        [ADR 0020](./docs/adr/0020-stats-keyed-on-declared-blocks.md). Written here as though
        only the *publishing* were missing, on the grounds that `aurora verify` already
        rebuilt both and reported 0 mismatches. That reading was wrong in the way that
        matters: the verifier carried its own `saveDcBase: 8` and was comparing
        `8 + proficiency + ability` against Aurora's `8 + proficiency + ability` — real
        evidence that the modifier and the bonus were right, and no evidence at all that
        Incudo could show a DC, because no stat held one. A third keying was needed: stats
        published per *declared block*, because the namespace is the block's name and an
        Eldritch Knight's is `eldritch knight` while its ADR 0015 track is `fighter`.
        Seven DC rows and seven attack rows are now compared against Incudo's own published
        number and agree; the eighth pair belongs to a wizard whose Tome of Clear Thought
        Incudo has nowhere to put, and is reported as `not-modelled` until inventory lands.
  - [ ] **Armour class**, which this list never counted and should have. `ac` is `default: 10`
        with nothing derived, so every character — imported or built — shows 10. It is the
        fifth instance of the same pattern: content declares each armour's base, each magic
        bonus and each alternative calculation, and Aurora keeps the composition in its app.
        Unlike the four above it is **not** a number that can be added on its own. 31 of the
        alternative calculations are gated on `equipped="[armor:none]"` and 33 more on
        `[armor:heavy]`, none of which can be answered until a character can wear armour —
        so this is the last step of the inventory work rather than a parallel one, and it has
        no oracle at all: no save records an armour class.
        Planned in [docs/INVENTORY-AND-AC-PLAN.md](./docs/INVENTORY-AND-AC-PLAN.md).
- [ ] **Verify self-containment:** a save built with the full corpus loaded opens correctly in a
      profile with zero sources configured. This is a test, not a hope.
- [ ] Multiclassing — the model half is done ([ADR 0015](./docs/adr/0015-class-levels.md)) and
      so is the slot table ([ADR 0018](./docs/adr/0018-tables-and-track-stats.md)); what remains
      is the UI for choosing a class at each level.

**Exit criteria:** a level 8 multiclassed Rogue/Wizard with a subclass, feats and prepared
spells is buildable end to end and matches Aurora's output for the same choices.

---

## Phase 3 — Content story ⬜

- [ ] Live mode hardening: HTTP caching, ETags, offline fallback, partial index loading
- [ ] Download mode: versioned cache, update checks against the index version
- [ ] Content browser (search across all loaded elements)
- [ ] Conflict resolution when two sources define the same ID
- [ ] Source enable/disable per character
- [ ] Import a raw Aurora `.xml` the user drops in

---

## Phase 4 — More than one kind of character ⬜

*The first real use of [ADR 0009](./docs/adr/0009-character-kinds.md). Also the first proof that
the kind machinery is not decorative.*

- [ ] NPC / monster kind for 5e: stat block, challenge rating instead of level
- [ ] Legendary creature kind: legendary actions, lair actions, regional effects
- [ ] Companions and sidekicks
- [ ] Wire up the 2025 Monster Manual creature content already in the corpus
- [ ] Kind-specific sheets and exports

**Exit criteria:** a DM can build a PC, an NPC and a legendary creature in one app, and the
engine has no code that names any of them.

---

## Phase 5 — Export & sharing ⬜

- [ ] PDF character sheet (fillable official sheet + a clean Incudo sheet)
- [ ] Plain-text / Markdown export
- [ ] "Content has been updated — refresh?" flow, diffing recorded source versions against
      available ones and showing what would change before touching the character
- [ ] Print layout

---

## Phase 6 — Mobile app ⬜

*Deliberately after the desktop builder: the shared core must be proven first.*

- [ ] Expo shell, navigation, storage
- [ ] Character sheet — **read and play** first; building second
- [ ] Full build flow
- [ ] Import/export via share sheet and file picker
- [ ] Download mode as the default on metered connections

**Exit criteria:** the same `.incu` file opens identically on desktop and mobile, and
`@incudo/core` still has zero platform-specific code.

---

## Phase 7 — Systems as a first-class user surface ⬜

*This is the phase that makes or breaks the project's premise. It should not slip.*
See [ADR 0011](./docs/adr/0011-user-systems.md).

- [ ] `schemas/system.schema.json` published, with `incudo system validate` and in-app validation
      sharing one implementation
- [ ] **Fork** an official system into user space
- [ ] **Overlay** an official system (`extends` + patch), so house rules survive upstream updates
- [ ] `incudo system new <id>` — scaffold a working system, never an empty file
- [ ] User systems load through *exactly* the same path as official ones, clearly labelled
- [ ] Validation errors that a non-programmer can act on
- [ ] "How to write a system definition" guide
- [ ] A second **official** system, licence permitting ([ADR 0010](./docs/adr/0010-licensing-and-funding.md))

**Exit criteria:** someone who is not the maintainer adds a system without touching engine code,
and a house-rule overlay still receives upstream fixes.

---

## Phase 8 — Homebrew content authoring ⬜

*Systems are the container; this is the content inside them.*

- [ ] In-app element editor — homebrew without hand-writing JSON
- [ ] Validation and linting with good error messages
- [ ] Export a homebrew source as a publishable index

---

## Phase 9 — 1.0 ⬜

- [ ] Stable formats with a real versioning and migration policy — from here on, the system
      format is a public API ([ADR 0011](./docs/adr/0011-user-systems.md))
- [ ] Signed desktop installers (Windows/macOS/Linux); mobile store presence TBD
- [ ] Docs site, contribution guide, issue templates
- [ ] `docs/LICENSING.md` complete for every shipped system
- [ ] Ko-fi link in README and in-app About — never on a screen showing licensed material,
      never gating anything

---

## Beyond 1.0

Committed to as *direction*, not scope. Each gets a design doc before work starts.

### 2.x — Story building tools ❄️
Campaign and session notes, NPC and faction tracking, timelines, relationship maps, linking
notes to characters and content elements. Same local-first, file-based, no-account model. The
interesting technical question: a note graph that references content elements by ID across
systems. Phase 4's NPC kinds are a prerequisite worth having first.

### 3.x — Mapmaking ❄️
Battle maps and/or region maps. Likely a canvas editor with asset packs, exportable to image and
to a Incudo map file. Two open questions: whether it is a mode in the app or a sibling app
sharing the shell and file layer, and **whether Tauri's OS webview is adequate for canvas-heavy
work** — that is the trigger to revisit [ADR 0001](./docs/adr/0001-tech-stack.md).

### Unscheduled ideas ❄️
- Party view: several characters side by side
- Optional peer-to-peer or file-drop sync between a player's own devices
- Plugin API so systems can ship custom UI, not just data
- A community index of known content sources and user systems (carries ADR 0010's questions)

---

## How this file is maintained

- Every phase gets an issue/milestone on GitHub; this file is the narrative, the tracker the detail.
- When a decision inside a phase is non-obvious or reversible-at-a-cost, write an ADR in
  `docs/adr/` and link it from here.
- When a phase ships, mark it ✅ and note what actually shipped vs what was planned.
- If a phase is deferred or dropped, say so here rather than silently deleting it.
- 🔒 means done **and frozen** — bugfix-only. So far only Aurora compatibility earns that, and
  only because the format it targets can no longer change.
