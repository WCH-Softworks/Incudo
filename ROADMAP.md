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
- [x] `ID_INTERNAL_*` overlay so those dangling references resolve. It ended up covering **83**
      elements, not 45: real saves revealed a second family no content file mentions (twenty
      levels, two campaign options, seven baseline grants). The `ID_SIZE_*` family turned out
      to be generated too, not the upstream typos this file used to call them — they are in
      all 8 saves' `<sum>`. Reading `<equipment>` later found a third family of 3, the
      inventory proxies — and finding them needed a *bag*, not a reading of the format.
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
  *(Closed. The home arrived with [ADR 0024](./docs/adr/0024-inventory-is-a-list-of-instances.md),
  the importer fills it, the derivation reads it, the slots publish what is in them and the
  armour class is derived from them — steps 2 to 5. 48 of these notes became compared numbers
  and all 48 agree, leaving 3 `not-modelled` in total.)*
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
- [x] **Inventory**, which Phase 1 deferred with the gap named: items, equipped slots,
      attunement, and magic items attached to other items. Planned in
      [docs/INVENTORY-AND-AC-PLAN.md](./docs/INVENTORY-AND-AC-PLAN.md) — five steps, of which
      the first three can be checked against Aurora and the last two cannot. It is the same
      piece of work as the armour class below, and it came first. **All five are done**, and
      step 3 was the last point at which Aurora could referee. The remaining inventory work is
      UI: nothing here puts a bag on a screen.
  - [x] **Step 1 — the model** ([ADR 0024](./docs/adr/0024-inventory-is-a-list-of-instances.md)).
        `Character.inventory` is a list of *instances*, `character.json`'s `formatVersion` is 2,
        and the container embeds every entry's element with the carried ones included. Nothing
        derives from it yet, and no baseline moved — which is the test that step 1 was step 1.
  - [x] **Step 2 — the importer fills it**, plus the 3 inventory proxies into
        `generated-elements.ts` (80 overlay elements became 83). All 45 item instances across
        the nine saves come across, and every one of ADR 0024's measurements held on the real
        files — including its falsifiable one: `slot` was written **zero** times.
        No `aurora verify` count moved, which is what makes step 3's diff readable.
  - [x] **Step 3 — the engine seeds equipped items.** The step the oracle checked, and the
        only baseline move in the five. 48 `not-modelled` notes became comparisons and all 48
        agree, so `not-modelled` fell 51 → 3 with `stat-mismatch` still 0. `element-extra`
        rose 53 → 55, and those two are a finding rather than overhead: a **Mithral Armor**
        adornment suppresses its host armour's stealth-disadvantage grant in Aurora's app and
        in no content file, with Vigaro's mithral-less plate as the control case.
        The 48th note was the wizard's save DC below, which now agrees at 18 — and the
        arithmetic behind it, with the two steps the save cannot see, is written out in
        [AURORA-SAVE-FORMAT.md](./docs/AURORA-SAVE-FORMAT.md).
        No new pending decision, no new derivation problem, and the corpus baseline untouched.
  - [x] **Step 4 — slots publish tags, and `equipped=` is evaluated**
        ([ADR 0025](./docs/adr/0025-slots-publish-tags.md)). A character kind declares which
        slots exist, what stat each publishes into and which setters become tags; `equals`
        becomes a membership test where a stat publishes tags and stays string equality
        everywhere else. ADR 0023's attunement **gate** landed with it; its limit did not,
        because the base of 3 needs ADR 0022's `contributions` and step 5 is where that is.
        **No count moved and no derived stat moved** — which is the weak result it looks like:
        all 78 rules used to apply unconditionally, so evaluating can only ever remove one, and
        only eight conditions exist across the nine characters, all of them true. Perturbation
        is what proves it, and it is in the tests: the monk put into plate loses exactly
        Unarmoured Defence and Unarmoured Movement, the monk handed a shield makes
        `[shield:none]` false for the first time in this project, and an unattuned Ring of
        Protection takes its +1 AC and +1 to all six saves with it.
  - [x] **Step 5 — the `ac` derivation, on a kind's `contributions`**
        ([ADR 0026](./docs/adr/0026-armour-class-is-derived-and-checked-by-nobody.md)). ADR 0022's
        mechanism built and spent on two users, one conditional and one not: 5e's armour class
        and ADR 0023's attunement limit, whose base of 3 had nowhere else to live.
        **Six conditional rows, not four.** A cap cannot say that heavy armour also does not
        *penalise* a negative Dexterity modifier, so the term got a floor as well — and the nine
        saves cannot tell the two readings apart, because both plate wearers have a Dexterity
        modifier of exactly 0. Same for the medium cap: both medium-armoured saves sit at exactly
        +2, where `min(2, 2)` and no cap at all agree.
        The nine now read 18, 18, 17, 18, 18, 13, 16, 20, 16 and **nothing checked them** — no
        save records an armour class, `aurora verify` is byte-identical on all nine, and it would
        be byte-identical if every number were wrong. `ac` is `hp`'s position (ADR 0019) and must
        never be called verified. The evidence is perturbation, in
        `tools/incudo/src/armour-class.test.ts`. `attunement:max` reads 3; none of the nine is
        over it.
- [x] **Fill in the 5e system definition's remaining numbers.** Said here to be three things
      the differential verification could check the moment they existed. Reading the engine
      corrected that on two counts — and the list grew to five, because armour class was never
      counted and should have been. All five are done; three were settled by Aurora and two by
      reading the rulebook, and the difference is recorded on each.
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
        Eight DC rows and eight attack rows are now compared against Incudo's own published
        number and agree. The eighth pair was carved out until step 3 of the inventory work,
        because it belongs to a wizard with a Tome of Clear Thought equipped; that carve-out
        was the last thing in `verify-character.ts` holding arithmetic of its own, and losing
        it took `proficiency` and `abilityModifier` out of the verifier's options with it.
  - [x] **Armour class**, which this list never counted and should have
        ([ADR 0026](./docs/adr/0026-armour-class-is-derived-and-checked-by-nobody.md)). The fifth
        instance of the same pattern: content declares each armour's base, each magic bonus and
        each alternative calculation, and Aurora kept the composition in its app. Unlike the four
        above it was **not** a number that could be added on its own — 31 alternative
        calculations are gated on `equipped="[armor:none]"` and 33 more on `[armor:heavy]`, so it
        had to be the last step of the inventory work rather than a parallel one.
        It is now six contributions and one expression in `systems/dnd5e/system.json`, the file a
        save deliberately does **not** embed, so correcting it corrects every character ever
        saved — which was ADR 0022's whole argument.
        **And it is the one number on this list with no oracle at all.** The four above are
        checked against Aurora on every run; this one is checked by reading the Player's Handbook
        and by perturbing slots in a test. Do not let its position in this list imply otherwise.
- [x] **Verify self-containment:** a save built with the full corpus loaded opens correctly in a
      profile with zero sources configured. This is a test, not a hope. Ticked late — it was
      already met in Phase 0 and duplicated here, and `tools/incudo/src/self-contained.test.ts`
      has been proving it against the real 12,058-element corpus since. A bag does not weaken
      it: all nine imported saves still re-derive identically with no sources configured.
- [ ] Multiclassing — the model half is done ([ADR 0015](./docs/adr/0015-class-levels.md)) and
      so is the slot table ([ADR 0018](./docs/adr/0018-tables-and-track-stats.md)); what remains
      is the UI for choosing a class at each level.

### Where this phase actually stands

**The engine half of Phase 2 is finished and everything left is a shell.** Every remaining box
above is view-layer work — the desktop shell, the content manager, the sheet, save/load, the
level-up and multiclass screens. Nothing in the rules engine is outstanding.

That is a change of kind, not just of subject, and it is worth naming before the first screen
is written. Every number settled in this phase was settled against Aurora's own arithmetic, or
was explicitly marked as one Aurora could not check. **A view layer has no oracle at all.**
There is no `<sum>` for a screen, and "it looked right" is the evidence a UI usually ships on.
Decide how the shells are kept honest before building them, not after.

### Known gaps, carried deliberately

Things the engine work left visible rather than fixed. None has a symptom today; all are here
so that finding one again is recognition rather than discovery.

- **Nothing checks that a recorded choice was legal for the slot it fills.** A `select` pool is
  keyed on (element, name) and its allowance is the sum of the active rules', but 89 groups in
  the corpus have rules that differ in `supports`, `requirements` or `type` — a wizard's first
  six spellbook entries are 1st level and the two it adds each level afterwards are not. The
  pending pool offers the union of the candidates of the rules with room left, and a pick
  recorded against the wrong rule is accepted in silence. Wants a builder before it matters.
- **One grant cannot cancel another.** A Mithral Armor adornment suppresses its host armour's
  `ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE`, and no content file expresses that — it is Aurora
  app behaviour. It is 2 of the 55 `element-extra`, and the nine saves carry the control case:
  plate with no mithral does keep the marker. Not invented (ADR 0005).
- **`ID_INTERNAL_MULTICLASS_LEVEL_3`** — the single `element-missing`, an Aurora-app marker
  nothing in the 740 files references and that carries no rules. Honestly unmodelled.
- **One unresolved reference upstream** — the `…VULNERAILITY…` typo. It is a *grant* to an id
  nothing declares, so a character silently loses something. Zero the day AuroraLegacy fixes
  the spelling; not Incudo's to fix.
- **`hp` and `ac` are unverifiable against Aurora, permanently.** The save format records the
  per-level rolls and never the total, and records no armour class at all. Both are derived
  from published rules and checked by perturbation. Do not describe either as verified.

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
