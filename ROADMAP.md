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
7. **Free and open source.** MIT, GitHub, Patreon and Ko-fi links, no paywall and no accounts.

### Non-goals (for now)

- No virtual tabletop, no combat tracker, no dice roller with 3D physics.
- No server, no account system, no cloud sync in 1.0. Files are files.
- No hosting of copyrighted rulebook content. Incudo ships an engine; users point it at
  content indexes, exactly like Aurora's "Additional Content" tab.
- **No Aurora export.** Aurora is discontinued; nothing would read it ([ADR 0008](./docs/adr/0008-aurora-compatibility-frozen.md)).

---

## Phase 0 — Foundation ✅

*Goal: a monorepo that builds, and a data model that can express D&D 5e without mentioning it.*

*The `incudo` CLI several items below name was removed in Phase 2 ([ADR 0039](./docs/adr/0039-the-cli-is-removed-and-what-it-measured-becomes-tests.md)); each thing it measured is a test in `tools/verify`.*

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

## Phase 1 — Aurora compatibility, finished ✅

*Goal: read everything Aurora ever produced, then close the book on it.*
See [ADR 0008](./docs/adr/0008-aurora-compatibility-frozen.md) — this phase has an end, and
this is it.

*Unfrozen 2026-10-15 by [ADR 0119](./docs/adr/0119-aurora-content-is-converted-into-incudo-content-and-nothing-past-the-conversion-knows-aurora.md):
the importer is the converter, and it was not converting. Import-only and no export stand; the fix is a Phase 9 item.*

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
- [x] **Differential verification**: `incudo aurora verify` (now `tools/verify/src/aurora-oracle.test.ts`) re-derives each imported character
      and diffs against the `<sum>` / `<magic>` Aurora itself wrote.
- [x] Mark `packages/aurora-import` 🔒 **DONE** — bugfix-only from here *(lifted by ADR 0119, 2026-10-15)*

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

## Phase 2 — Desktop character builder MVP ✅

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

- [x] **Desktop shell scaffolded and running.** Vite + React in `apps/desktop`, which boots, validates
      the shipped 5e definition, loads a real Aurora index over the network, renders
      `CharacterBuilder`'s decisions and the kind's own sheet, and persists the character through
      the injected storage. `npm run desktop`. `apps/desktop` joined the workspaces;
      `apps/mobile` deliberately did not, because the ~700 MB was always Expo.
      Built late, and it should not have been: **the first five minutes of using it found a
      view-model bug no test had** — a required build step with nothing picked reported itself
      `complete`, so a character could not choose a race or a class at all. Fixed in
      `packages/ui` as a third decision kind, `pick`, keyed `build/<stepId>`, which is the
      convention the fixture save and `aurora-import` already used.
  - [x] **The Tauri app builds.** The gap this entry described was an icon: the Rust shell, its
        config and its HTTP capability were all written, and `tauri-build` stopped on a missing
        `icons/icon.ico` that the project would not fill with generated artwork. The maintainer
        supplied a logo — an anvil under a gear, black and white colourways — so `brand/` now
        holds the source art and `npx tauri icon` generates the set from it. Every pixel of the
        glyph is drawn; the README's commitment is intact.
        The logo is a single-colour glyph on transparency, so the icon **vanishes against its own
        colour** — white is the default because the app shell and the stock Windows/macOS chrome
        are dark, and switching to black is one command. An icon that reads everywhere wants the
        glyph on a solid tile, and that tile's colour is a brand decision rather than something
        to infer from a stylesheet, so it is named in
        `apps/desktop/src-tauri/icons/README.md` and left for a person.
  - [x] **Menus and keyboard shortcuts** ([ADR 0037](./docs/adr/0037-a-command-is-data-the-page-owns-the-keyboard.md)).
        Twelve commands (a thirteenth, Save a copy…, arrived with the export below) are data in `packages/ui` — id, label, shortcut, and a rule for when each
        is available — and the Tauri window's native menu and the browser build's key handler both
        render that one list; the mobile shell inherits it. **The page owns the keyboard in every
        build and the menu is for the mouse.** The first design gave the keys to the menu's
        accelerators; pressing them in the Windows window showed WebView2 hands the page the key
        and the accelerator never runs, so it was replaced the same day. A disabled command still
        claims its key, and no shortcut touches text editing or AltGr. 31 tests, each checked by
        breaking the behaviour it names (34 perturbations, none survived).
        **Verified by pressing real keys, in the browser build and in the Tauri window on
        Windows:** the five navigation chords, Refresh, Ctrl+S refused where it is off, typing
        `n s l , 1–4` unaffected, and — in the window, where real input is possible — Ctrl+A/C/X/V/Z
        actually editing a text field with none of those keys claimed. Also seen: the native menu
        matches the list exactly, its enabled flags follow app state live (all twelve off on the
        launcher), and its items drive the app. Browser build only: Ctrl+N, Save from inside the
        name field, refusals behind a dialog. **Not verified:** the macOS menus (written, never
        run) and how a macOS or Linux menu renders the shortcut text; a chord in a real browser tab
        (Chromium reserves Ctrl+N); New character and Save in the Tauri window, which would have
        written to the developer's own library. New character and Import are live only on the
        characters screen, Save only on Build: New replaces the character being edited without
        asking, and nothing tracks unsaved work yet. *(Since ADR 0120 the shell tracks it, asks before
        replacing unsaved changes, and New character is live on every pane.)* **"Save a copy…" was left out on purpose** and
        arrived with the explicit export below, as the thirteenth command.
  - [x] **`$(...)` in a `<select supports=…>` resolves**
        ([ADR 0030](./docs/adr/0030-a-declared-block-answers-a-filter.md)), so a caster can
        choose spells — the last engine-side blocker on this phase's exit criterion.
        `candidatesFor` used to say the UI layer supplied that build context; no caller did
        and none could have, because the context is which block the rule belongs to and what
        the derivation published for it. A character kind now declares how a key expands
        (`blockFilters`), so the two Aurora keys live in `systems/dnd5e/system.json` and the
        engine still cannot spell "spell".
        The entry this replaces also blamed a Rogue's empty skill and expertise picks on it,
        which was **wrong twice over**: that was a `<supports>` block stored as one tag
        (fixed in c239c44), and the real `$(…)` cases were the spell lists. Do not re-merge
        the two.
        Making it resolve turned out to be one of four things, and the other three were
        defects in the filter language itself — `||` bound tighter than `,`, parentheses
        never parsed at all (131 attributes), and an operand could not name a setter's value,
        which is where a spell keeps its level and its school. Fixing those took the
        interpolation-free select filters that match **nothing** from 343 to 124, so a Battle
        Master's manoeuvres and a Find Familiar started working alongside the spell lists.
        A fifth silently dropped Aurora construct came out of it: `<spellcasting><list>`,
        17 blocks, which is the tag `$(spellcasting:list)` needs and had never reached the
        engine.
- [x] **The app asks which system, then opens on the library**
      ([ADR 0031](./docs/adr/0031-a-system-is-chosen-and-it-scopes-everything.md), amending
      ADR 0027). The header used to read "Dungeons & Dragons 5th Edition" from the first frame
      to a user who had never been asked, `boot.ts` was a single hardcoded import, and the
      second shipped system was unreachable. A launcher lists the shipped definitions with the
      facts each can be judged on — characters in your library, sources assigned and enabled —
      remembers the answer, and scopes everything downstream to it: choose D&D and the library
      shows D&D characters and only those, with a count of what it is hiding so a filter never
      reads as an empty folder.
      It gates a *question*, never content: picking a system leads straight to the library, and
      a save still opens with nothing configured. Three correctness bugs went with it — a Cairn
      save opened from the library was being derived against the 5e definition, every enabled
      source loaded into every character regardless of game, and a draft of one system was
      handed to another. Content sources now carry the system they were added under, recorded
      and never inferred, and a system definition can **suggest** indexes so the common case
      never sees a system field at all.
      **ADR 0011's user-authored systems became reachable with it** — promised since Phase 0,
      with the format a public API since ADR 0007, and no way to get a file into the app until
      now. `Add a system…` validates a picked `system.json` through the same validator
      everything else uses and lists it beside the shipped ones. The cards were rewritten for
      players at the same time: `description` is prose about the game rather than a note to
      whoever maintains the definition, and a definition may carry an optional `logo`.
- [x] **The app opens on a character library**
      ([ADR 0027](./docs/adr/0027-a-library-is-a-folder.md)). It used to open on Sources, with
      an index URL in a text box, doing nothing at all until 238 files had come down over the
      network — the first screen contradicting ADR 0012, which is the decision that a save
      carries its content and opens with nothing configured. The library is a folder the user
      picks, remembered between launches and rescanned on open: every `.incu` in it, plus every
      subfolder holding a `manifest.json`, and nothing else touched. No index file and no
      database, because the folder is the list and the user edits it directly.
      `CharacterLibrary` is a view-model in `packages/ui`; the folder picker and the directory
      scan are a `CharacterStore` port with three implementations (Tauri, the browser's File
      System Access API, and `node:fs` in a test).
      **Listing and opening need zero sources**, which is asserted twice: against a fake store
      in `packages/ui`, and against a set of real `.dnd5e` saves in
      `tools/verify/src/library.test.ts`. The `.dnd5e` **import** landed with the line below,
      and that same test now drives it. Still to do: renaming a file, and
      the refresh that would move a recorded source version. (The explicit export landed later.)
- [x] **Content manager: add an index by URL, enable/disable sources, stream or download**
      ([ADR 0028](./docs/adr/0028-sources-are-a-profile-characters-carry-an-allowlist.md),
      [ADR 0029](./docs/adr/0029-a-cache-is-keyed-by-source-and-evicted-by-version.md)). Add,
      name, remove, enable, disable, per-source stream/download, check for updates, refresh,
      and what each source contributes. The configured sources are a *profile* that no
      character depends on; a character's own `sources` is a record of what it was built
      against, and the two are allowed to disagree — that disagreement is what makes ADR 0004's
      promised warning possible, as `present` / `moved` / `missing` per source.
      ADR 0004's composition was finally wired up: the cache goes in front of the network, so
      a reload costs 0.5 s instead of re-fetching 238 files. Both of ADR 0004's open questions
      are answered — pinning is a **no**, and the rate-limit measurement is in ADR 0029.
      What is *not* done and is named rather than implied: `stream` and `download` differ only
      in **when** files are fetched, because ADR 0004's lazy per-file loading needs an
      `ElementIndex` that can miss and there is not one. (Measured and declined later, ADR 0051.)
      **The cache shipped subtly wrong and the `.dnd5e` import found it.**
      `CachedContentSource.loadFile` returned everything the network layer did except
      `appends`, so all 171 `<append>` blocks were dropped on every load after the first —
      no error, no warning, the same 740 files and 12,058 elements, and a corpus whose
      elements simply reach 23 fewer things. It showed up as the same Aurora save importing
      250 elements and then 227 a minute later. Fixed, and `compose.test.ts` now asserts the
      two layers *agree* rather than that the cache merely answers.
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
- [x] **The ability score editor, so a character can have ability scores.** Until this, every
      character built in the app had straight 10s — 0 hit points and a meaningless sheet — and
      `BuilderPane` rendered a paragraph saying the editor was still to be built. All four of
      5e's methods work in the running app: point buy against the declared cost table, the
      standard array, `4d6dl1` × 6, and free entry. The logic is `packages/ui/src/budget.ts` and
      `dice.ts`, testable in Node; `BudgetEditor.tsx` computes nothing, so
      CODE-REUSE-POLICY rule 2's stated test — "point buy let me spend 28 points" must be
      fixable in a package — still holds. Rolling lives above the engine because ADR 0019
      forbids core learning to roll, and below the shell because `"4d6dl1"` is declared in
      `system.json` and parsing it is a rule about the game.
      Three decisions that could have gone the other way are recorded in the commits: a points
      method **seeds every target at the cheapest value it prices** (otherwise an untouched
      target derives the stat's declared default — 10 in 5e, higher than the 8 point buy gives
      free, and a set nobody bought); an assignment method **swaps rather than duplicating**;
      and a change of method **keeps only what the new method can express**, which is what
      saves an imported character's six scores when the user picks "enter manually".
      **Using it found three bugs, none with a failing test.** Two were pre-existing and in the
      shell, both in `use-builder.ts`: changing a content source rebuilt the builder from the
      shell's stale copy and **silently threw away every edit** (then autosaved the reverted
      character over the draft, so a reload did not bring it back), and "New character" did
      nothing at all because the memo saw no changed dependency. The third was in this work: the
      editor hid its rows until a method was picked, which is exactly the state every Aurora
      import lands in — six real scores and no recorded method — so picking one to see them was
      how a user would have lost them.
- [x] **Level-up.** `level="N"` grants and pending `<select>` choices already arrived correctly —
      `setProgress` changes a number and ADR 0017/0018's machinery was right without rework. What
      was missing, found by trying to level a character up rather than by reading the checklist,
      was hit points: `hp`'s `rolls` derive (ADR 0019) had nothing to read, because nothing in the
      app had ever written `hp:level:N`. A fresh level 1 wizard's sheet read **-1 hit points**.
      A `perLevel` step may now declare `levelRoll: { pattern, dieSetter, classType }`
      (`systems/dnd5e/system.json`'s "levels" step: `"hp:level:{n}"`, `"hd"`, `"Class"`).
      `packages/ui/src/hitpoints.ts` reads the die off the governing element's own setter —
      Aurora's content convention, `<set name="hd">d8</set>`, not something a system has to
      invent — falling back to the character's single element of `classType` when no
      `advancement` (ADR 0015) says otherwise, which is every character built in the app today.
      Recording reuses `dice.ts` exactly as a budget's rolls do: idempotent (a level already
      holding a value is left alone, so there is no path from a repaint to a reroll), and the
      first level of the track is always the die's maximum — a rule the Player's Handbook states
      outright, not a choice, so `planHitPointRecord` takes it regardless of which button was
      pressed. The decision renders as a small table, one row per level, next to the ability
      score editor in the same "outstanding, then settled" shape ADR 0017 already established.
      **Run against the real AuroraLegacy corpus**: a level 1 Wizard read 6 hit points on
      recording the maximum (a d6, Constitution 10); levelled to 5 with two averages, one actual
      roll and one more average, the sheet read 22, matching the arithmetic by hand. The known
      gaps this surfaced are pre-existing and already named above and in "Known from running
      it" — the level 4 Ability Score Improvement reported "no candidate", and the sheet did not
      render features or proficiencies. Both are fixed since: the next two entries.
- [x] **Levelling past level 3** ([ADR 0035](./docs/adr/0035-a-repeatable-element-counts-once-per-pick.md)).
      A level 4 Fighter opened a blocking Ability Score Improvement decision with no candidates and
      no diagnostic, and the diagnosis on file — the `Class` `supports` operand — was wrong.
      Reproducing it first showed `candidates: []` *and* `unresolved: []`: the filter was fine and
      nothing carried the tags, because **Aurora's app generates these options** and only the two
      Artificers' are written in a file. 88 of the 123 select filters in the corpus that match
      nothing were this one protocol; **123 → 35 after**, the 35 being exactly `!` negation,
      `Ritual` and two proficiency lists.
      `improvement-options.ts` derives an ASI option and a feat option for every class and level the
      loaded content asks for and nothing declares (73 pairs, 146 elements; generated 83 → 229),
      and the six `ID_INTERNAL_ASI_*` elements gained the two tags the filter names.
      **Taking +2 to one score turned out to need more than offering it.** It is the same +1
      picked twice, and Aurora's `<sum>` lists the id twice, so a character kind may now declare a
      `repeatableSetter` (5e: `allow duplicate`) — an element carrying it is offered again and its
      stat rules apply once per pick. The importer had been **dropping the second pick**, so an
      imported Fighter 12 read Constitution 19 where Aurora computes 20, and `aurora verify` cannot
      see it. In the running app a level 4 Fighter takes the improvement, picks Strength twice and
      reads 12; raising the level to 8 opens the level 6 and 8 improvements beside it.
  - [x] **The feat half was generated and unreachable; now it is reachable.** It is gated on
        `ID_INTERNAL_OPTION_ALLOW_FEATS`, and switching that on is the campaign options step
        below. **Eight of the nine characters in a set of real saves took a feat at level 4.** With feats on, a
        level 4 Fighter's improvement offers 2 options where it offered 1, and taking the feat
        opens a real feat choice (`tools/verify/src/campaign-options.test.ts`). Not measured
        here: every feat's own prerequisites and what each grants — that is content's, read by
        the engine as it reads everything else, and nothing in this change touches it.
- [x] **Character sheet.** `SheetPane` renders whatever the kind's own `sheet` declares: stats,
      per-block sections such as a spellcaster's save DC (through the shared
      `renderSheetSection`, which the CLI uses too), and the elements a section lists by type —
      features, proficiencies, spells, inventory. The character's name is editable from it, with a
      confirmation before it renames the file. It used to drop every section that named types and
      no stats, so a level 1 wizard's sheet showed six scores and some numbers. Not built: a
      print layout or a PDF (Phase 5), and nothing on it is interactive during play (Phase 6).
- [x] **Open decisions can be skipped, ranked, and picked from a real list.**
      [ADR 0033](./docs/adr/0033-declining-a-decision-is-its-own-input.md): a non-blocking
      decision can be declined (`decline`, `reconsider`), recorded as its own input rather than as
      an empty answer, because an empty answer is indistinguishable from "never looked".
      [ADR 0034](./docs/adr/0034-open-decisions-rank-by-a-declared-step-priority.md): what an
      answered pick opened ranks by its step's declared `priority` — Sub Race beside Race — and not
      by a hardcoded rule or by recency, which measured wrong against the real corpus. The element
      picker stopped being a `<select>`: `CandidatePicker` is searchable and no longer capped at
      40, and hovering a candidate reads its description in a fixed dock beside the list
      (`PreviewDock`), which replaced a Details button and then a floating panel. A spell reads
      "Fireball (Level 3)" and a level 0 one "(Cantrip)": a kind's `candidateNotes` names the
      setter and the wording, so nothing in core or the pane knows what a spell level is, and the
      note is part of the label, so searching "cantrip" or "level 3" filters the list.
- [x] **A decision can record more than one element, and stays as editable as any other once it
      does** ([ADR 0032](./docs/adr/0032-a-build-step-may-offer-a-set.md)'s bug fix — the ADR
      itself stays proposed; see the entry below). Two passes, found live rather than by a test.
      First: `BuilderPane` answered a select with `choose(id, [value])`, and `setChoice`
      **replaces**, so a wizard owed three cantrips and six spellbook spells could record exactly
      one of each — pick a second and it overwrote the first, and the select could never close. A
      player choosing a Skill Proficiency after a background had "Insight" stuck on screen no
      matter what they picked next. `OpenDecision` gained `chosen: ElementId[]` alongside
      `candidates`, and the pane's write while a pool is open became
      `choose(id, [...decision.chosen, value])` — "replace" for a `pick`, where `chosen` is
      always `[]`, and "add to" for a `select` asking for more than one, with no branch between
      the two.
      Second: filling the last slot made the whole decision **vanish outright**, exactly the hole
      ADR 0017 had already named and fixed for a top-level pick — a wizard's second Skill
      Proficiency had nowhere to be changed once chosen, any more than Race did before `picks`
      existed. The engine gained `answeredChoices` beside `pendingChoices`
      (`packages/core/src/engine.ts`), publishing every slot's answer and what any one slot could
      hold instead once a pool has nothing left to choose; `packages/ui` folds these into the same
      `picks`/`SettledPick` array a top-level pick already used. A full Skill Proficiency now
      renders in "Choices already made" exactly like Race or Background: one `<select>` per
      filled slot, each independently changeable, each excluding every *other* slot's current
      answer. `pendingChoices` kept its existing contract throughout — it still means only
      "outstanding", so the CLI and the self-containment test needed no changes.
      Third: an answered slot used to wait for the *whole pool* to close before it could settle,
      so a wizard's first cantrip sat inside the still-open decision as a tag until the second
      and third were also picked. Every slot with an answer now settles into `picks` the moment
      it is recorded, whether or not its pool owes more — `use-character-builder.ts` builds this
      straight from `pendingChoices`, whose own `candidates` already excludes everything the
      character holds, so the same "add `chosen` back for this pool's entries" trick a full pool
      uses works unchanged for a partial one. Choosing one of three cantrips now reads "Cantrip
      (Wizard), 2 left" with a plain dropdown in Open Decisions and the one already picked beside
      Race and Class in Choices Already Made, in the same render.
      The engine's candidate-and-remaining math needed nothing for any of the three passes —
      `candidatesFor` and `remaining` were already right for a multi-element `Choice`, proved by
      a same-render three-cantrip test that predates all of them. Every bug was in the pane and
      in what the engine chose to publish once a pool closed or a slot filled.
  - [x] **`multiple: true` on a build step — campaign options.**
        ([ADR 0032](./docs/adr/0032-a-build-step-may-offer-a-set.md).) A system-format change
        (`schemas/system.schema.json`, plus the `required`-and-`multiple` validation rejection;
        `formatVersion` did not move) that makes a build step publish a decision answered by
        zero or more of its candidates, never blocking, skippable, and recorded under
        `build/<stepId>`. The mechanism was entirely content's already — 294 `<select …
        requirements="ID_WOTC_TCOE_OPTION_CUSTOMIZED_ASI">` across the corpus, each paired with
        the fixed `<stat>` it replaces — and `aurora-import` has always written a save's options
        to `build/options`, which is why an imported character kept its options while one built
        in Incudo could not have any: no build step offered a set. `systems/dnd5e/system.json`
        now declares one, over `Option`, which offers all **8** (the six real ones and the two
        the overlay supplies) with no id named anywhere. Measured against the corpus: a Dwarf's
        Constitution reads 12 with Customized Ability Score Increases off and 10 on, and a
        6-candidate choice takes the fixed bonus's place; the Human Variant is offered with
        feats on and not off (10 → 11 for a Human); a level 4 Fighter's improvement goes from 1
        option to 2. `aurora verify` is byte-identical on all nine saves, as the ADR predicted,
        and proves nothing but that nothing regressed.
        **Found while doing it:** the Human Variant is a `Race Variant` that a Human offers
        through its own select, not something a Race list ever drew — the ADR's sentence about
        "every race list" was wrong about where it lives, right about why it was missing.
  - [x] **A new character starts with feats and multiclassing on**
        ([ADR 0080](./docs/adr/0080-a-set-step-may-name-what-a-new-character-starts-with.md)). A set step may declare
        `initial`, written into a new character as its recorded answer and the user's to change from then on; a character
        that records none (every save before this, every import) still means none. 5e's options step declares the two.
        **Open, and left visible (closed 2026-10-05 by ADR 0088, below):** the overlay's `ID_INTERNAL_OPTION_ALLOW_MULTICLASSING` is an
        `Option`, so it is offered, and **nothing reads it** — 0 of 740 files, and the class
        control is deliberately not gated on it (ADR 0036). Ticking it does nothing, which is
        misleading on screen. Not fixed by naming an id in the builder: either the class control
        starts honouring it, or the overlay stops calling it an option. A decision, not a bug fix.
        Touches the system definition format, which is why it is an ADR and not a commit.
        *(An open item at the end of Phase 3 since 2026-10-05: "Allow multiclassing" does what it says.)*
- [x] Save/load `.incu` files; **import `.dnd5e`** (the importer was done — this was the UI
      for it). The library reads and writes `.incu` in both forms, and the desktop shell has a
      `ZipCodec` — the framing moved into `packages/core` so the browser's `CompressionStream`
      and Node's `zlib` share one implementation. **Import from Aurora…** picks one or more
      `.dnd5e` files and writes each into the library; the sequence between the picker and the
      folder is `importAuroraSaveIntoLibrary` in `packages/ui`, so the mobile shell inherits it
      and `tools/verify/src/library.test.ts` drives the identical function over a set of real saves. Reading a file from outside the library is a fifth port, `FilePicker` — deliberately
      not a method on `CharacterStore`, whose every method means "inside the folder the user
      chose". Importing is the one library operation that needs a content source, because a
      `.dnd5e` records Aurora's element ids and nothing about what they mean; the app says so
      rather than writing a character full of ids nothing can resolve.
  - [x] **An explicit export: "Save a copy…"** ([ADR 0038](./docs/adr/0038-a-copy-goes-through-a-save-port-and-changes-nothing-else.md)).
        Writes the character on screen, unsaved edits included, to a `.incu` the user picks
        anywhere. The write half of the port is `FileSaver`, a sibling of `FilePicker` (bytes in,
        a file name out, `null` for a cancel); the packing is `packCharacter`, the function the
        library's Save now calls too, so a copy is by construction the file Save would write.
        **A copy is not a Save As:** it takes no library and returns no entry, so the file being
        edited, its conflict timestamp and its saved name are untouched — held by a test with a
        store that records every call, and seen in the app (the next Save still raised the rename
        prompt and still saved without a conflict). Ctrl+Shift+D, Build only, beside Save; it needs
        no library folder. Tauri needed one permission (`dialog:allow-save`) and no Rust: the
        dialog's own `save` command widens the fs scope to the file it returns. **Round-tripped
        over a set of real saves:** each copy opens with zero sources and derives identically.
        **Found doing it, and fixed straight after:** the app's Save had been dropping every opened
        character's portrait bytes (9 of 9). **The shortcut moved once:** it was Ctrl+Shift+S, and pressing real
        keys in the Windows window showed WebView2 never delivers it to the page (an injected key
        event had hidden that), so it is Ctrl+Shift+D, checked with real keys through the real
        dialog. **Not verified:** macOS and Linux, and the real browser save dialog (native;
        replaced by a recording handle).
- [x] **Inventory**, which Phase 1 deferred with the gap named: items, equipped slots,
      attunement, and magic items attached to other items. Planned in
      [docs/INVENTORY-AND-AC-PLAN.md](./docs/INVENTORY-AND-AC-PLAN.md) — five steps, of which
      the first three can be checked against Aurora and the last two cannot. It is the same
      piece of work as the armour class below, and it came first. **All five are done**, and
      step 3 was the last point at which Aurora could referee. The remaining inventory work is
      UI: nothing here puts a bag on a screen. That is an open item of its own now, with starting
      equipment, at the end of Phase 3.
  - [x] **Step 1 — the model** ([ADR 0024](./docs/adr/0024-inventory-is-a-list-of-instances.md)).
        `Character.inventory` is a list of *instances*, `character.json`'s `formatVersion` is 2,
        and the container embeds every entry's element with the carried ones included. Nothing
        derives from it yet, and no baseline moved — which is the test that step 1 was step 1.
  - [x] **Step 2 — the importer fills it**, plus the 3 inventory proxies into
        `generated-elements.ts` (80 overlay elements became 83). All 45 item instances across
        a set of real saves come across, and every one of ADR 0024's measurements held on the real
        files — including its falsifiable one: `slot` was written **zero** times.
        No `aurora verify` count moved, which is what makes step 3's diff readable.
  - [x] **Step 3 — the engine seeds equipped items.** The step the oracle checked, and the
        only baseline move in the five. 48 `not-modelled` notes became comparisons and all 48
        agree, so `not-modelled` fell 51 → 3 with `stat-mismatch` still 0. `element-extra`
        rose 53 → 55, and those two are a finding rather than overhead: a **Mithral Armor**
        adornment suppresses its host armour's stealth-disadvantage grant in Aurora's app and
        in no content file, with a real save's mithral-less plate as the control case.
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
        *penalise* a negative Dexterity modifier, so the term got a floor as well — and a set of real saves cannot tell the two readings apart, because both plate wearers have a Dexterity
        modifier of exactly 0. Same for the medium cap: both medium-armoured saves sit at exactly
        +2, where `min(2, 2)` and no cap at all agree.
        The nine now read 18, 18, 17, 18, 18, 13, 16, 20, 16 and **nothing checked them** — no
        save records an armour class, `aurora verify` is byte-identical on all nine, and it would
        be byte-identical if every number were wrong. `ac` is `hp`'s position (ADR 0019) and must
        never be called verified. The evidence is perturbation, in
        `tools/verify/src/armour-class.test.ts`. `attunement:max` reads 3; none of the nine is
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
        used to have 0 hit points; the Paladin 2 / Warlock 18 save now has 207.
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
      already met in Phase 0 and duplicated here, and `tools/verify/src/self-contained.test.ts`
      has been proving it against the real 12,058-element corpus since. A bag does not weaken
      it: all nine imported saves still re-derive identically with no sources configured.
- [x] **Multiclassing** — the model half was [ADR 0015](./docs/adr/0015-class-levels.md) and the
      slot table [ADR 0018](./docs/adr/0018-tables-and-track-stats.md); this is the writing half
      ([ADR 0036](./docs/adr/0036-a-level-is-spent-on-a-class-by-writing-two-records.md)). The
      builder spends a level on a class (`addLevel`, `setLevelClass`), publishes per class whether
      it is eligible and why not, and keeps `advancement` in step with `setProgress` and a changed
      first class; the desktop **Classes** control renders it and computes nothing.
      **A level is two records, not one.** The oracle showed it: keep `advancement`, drop the
      class's multiclass element, and caster level goes 1 → 0 with every slot and an unearned
      skill pick opens. The builder writes both, keyed as an Aurora import keys them.
      **The blocker was not the UI.** Content reads `[cha:13]` and its siblings 72 times and no
      stat was called `cha`, so every multiclass gate — and 24 feat prerequisites — read false for
      every character. Six declared stats in `systems/dnd5e/system.json` fixed it with no format
      change, and `aurora verify` could not have seen it (byte-identical on all nine saves).
      **Rebuilt through the builder, the level 20 Paladin 2 / Warlock 18 oracle is the character
      Aurora wrote:** same `advancement`, same record, every element and stat, the same
      differences against the save. Hit points are the one number that comparison cannot vouch
      for (ADR 0019). Gated on what content declares only: not the campaign option (0 of 740
      files read it), not the current class's prerequisite (content never states it), and not
      *when* a score was met. Known gap: picks of a class whose levels went away stay in
      `choices` *(an open item at the end of Phase 3 since 2026-10-05)*. Found while doing it and fixed afterwards, in the builder and not the frozen
      importer: an imported save records Race, Class and Background under Aurora's keys, so it
      opened with all three listed as unanswered. A top-level pick is now answered by any recorded
      choice holding an element of its step's types (`packages/ui/src/top-level-pick.ts`).
- [x] **The exit criterion's character, built end to end** — a level 8 Wizard 4 / Rogue 4 (variant
      Human, School of Evocation, Arcane Trickster, Alert and War Caster), built in the running app
      and again through the builder in `tools/verify/src/rogue-wizard.test.ts`, every figure worked by
      hand from the Player's Handbook. **It found a real engine bug on the first try**
      ([ADR 0040](./docs/adr/0040-a-chosen-element-follows-the-track-of-the-element-that-offered-it.md)):
      a subclass picked through a `select` was in no level track, so its gates read the character's
      total. At level 8 the engine granted a Wizard 6 feature, gave the Trickster 4 first-level
      slots for the book's 3, owed it 6 spells for 4, and — because the Trickster's third-caster
      marker belonged to no track — read a multiclass caster level of 4 (slots 4/3/0) where it is 5
      (4/3/2). No test, and not the multiclass oracle, could have seen it: none has a multiclassed
      character with a chosen subclass. A recorded choice is now an edge like a grant; all nine sample
      saves derive identically before and after, element order included.
      **What the app run showed:** the flat decision list handled all eight levels without a dead end;
      the Rogue's multiclass skill and Expertise, the Trickster's pool, the improvement-or-feat choice
      and prerequisite-gated feats (Grappler withheld at Strength 8, War Caster and Ritual Caster
      offered) all behaved. **A quirk, not fixed:** a pool's rules fill in level order, so the
      Trickster's any-school spell has to be taken *before* the enchantment/illusion ones or that
      slot is gone — documented behaviour, easy to trip over *(an open item at the end of Phase 3 since
      2026-10-05)*. **Not verified:** a save of this
      character written and reopened through the real dialogs (the port and the round trip are
      tested; the native dialog cannot be driven); and an Aurora save of exactly these choices —
      but see the next entry, which referees each half of it separately.
  - [x] **Against Aurora: every save through the builder, and the Rogue/Wizard itself.**
        `tools/verify/src/builder-rebuild.test.ts` rebuilds *every* real save through `CharacterBuilder`
        (class chosen, `setProgress`, `addLevel` for each level that goes to a second class, every pick
        replayed through `choose`) and each is the character its import is, with the differences against
        Aurora it always had and **0 `stat-mismatch`, 0 `spell-missing``**. Broken three ways on purpose
        (a level sent to the wrong class, the Arcane pick dropped, the first class's levels off by one)
        and each fails at the save it should. It replays picks the save holds, so it says nothing about
        which choices the builder *offers*.
        **Then the maintainer built the description in Aurora** (a Wizard 4 / Rogue 4, saved as a tenth
        sample), and `rogue-wizard-aurora.test.ts` builds the same description through the builder and
        compares it with that save. **It agrees on every number Aurora records**: both casting blocks' slot
        rows, both save DCs, both attack bonuses, the shared caster level (5) and every spell listed. The
        differences left are inputs and known Aurora behaviour, not rules: the Aurora multiclass marker, a
        campaign option the description did not name (Customized Proficiencies), and a Thieves' Tools
        expertise pair Aurora did not derive, most likely because its updater rewrote `class-rogue.xml` a
        quarter of an hour before the save and it kept the older copy — **unconfirmed**; restarting Aurora,
        reopening the character and saving again would settle it.
        **It corrected the referee too** ([ADR 0041](./docs/adr/0041-aurora-records-a-slot-row-per-block-and-the-shared-caster-level-once.md)):
        the comparison expected the shared multiclass pool in every block's slot row, and this is the first
        save with two ordinary casting blocks. Aurora records each block's *own* table and the pool only as
        a caster level (`<magic level="5">`), so two `stat-mismatch`es were false alarms, and the caster
        level is now a compared row. That level also pins, for the first time, that a third-caster's levels
        round *down* (rounding up reads 6). **The oracle stopped pinning the folder:** it pinned totals over
        "the nine files" and asserted there were nine, so adding this save failed it; each save now has its
        own pin keyed by a fingerprint of its bytes, and a new one is checked and reported without failing.
- [x] **Remove the CLI (`tools/incudo`, `npm run incudo`).**
      ([ADR 0039](./docs/adr/0039-the-cli-is-removed-and-what-it-measured-becomes-tests.md), written
      before the code.) The app is the product, and a command line over the same engine was a
      second surface to keep in step with it for people the project does not have. It was not a
      folder to delete, because three different things lived in it, and they went in this order:
      - **Moved first: the regression suite.** `corpus.test.ts` is `incudo validate` with its
        budgets, configured by `INCUDO_*` environment and with the same four numbers in the same
        `ci.yml`; `aurora-oracle.test.ts` is `incudo aurora verify` over a set of real saves, pinned as
        a table. **Both were run against the CLI's own output before a line was removed, and the
        numbers reproduce exactly:** 740 files, 14,316 elements (+229 generated), 0 errors, 1
        unresolved, 23 unmeetable, 57 warnings, 2,258 from inline text; `validate --json` identical
        on both layouts; all nine saves' `aurora verify --json` identical, difference for
        difference. Perturbed on purpose so a green run means something (ten breakages, in the
        ADR). The classification was never in the CLI — `compareWithAurora` is in the frozen
        `aurora-import` package — so nothing there moved.
      - **Went:** `cli.ts`, `aurora-commands.ts`, `character-commands.ts`, the `incudo` script and
        `bin`, `accountedFor` and its tests (its only caller was `character verify`), and every
        instruction to type one: README, CONTRIBUTING, AGENTS, `systems/README.md`, CLAUDE.md's
        Commands section, and the comments that described it. `renderSheetSection` stays in core
        for `SheetPane`. Phase 7's `incudo system validate` and `system new` went with it.
      - **Stayed, and renamed:** the tests and the Node adapters became `tools/verify`
        (`@incudo/verify`), in its own commit, with a README that says what the folder is.
        `summarize()`, the definition of derived output four test files share, moved to
        `derived-summary.ts` unchanged.

      **Found doing it:** the CLI never reported how many slot, save DC and attack rows were
      *compared*, so "8, 8 and 8" was a claim in prose; the oracle now measures it by shifting each
      family of published stat and counting what notices, and silently disabling the DC comparison
      leaves `stat-mismatch` at 0 and fails only that measure. A test that skips when its corpus is
      absent passes on a failed checkout (`node --test` reports a skip as green), so a configured
      corpus that is missing **fails**. `.gitattributes` and `.gitignore` both named the folder by
      path — the golden fixture's LF rule among them — and neither shows up in a search of source.
      **Not verified:** the GitHub Actions run itself (nothing was pushed); the `repository` layout
      against a real checkout (none is on this machine, so it was exercised on one rebuilt from the
      install); `npm ci` from a clean tree; macOS and Linux. **Not covered, and was not before:** a
      reachability bug that leaves every count alone. Tests went 662 → 667: eleven corpus tests and
      one oracle test in, seven `accountedFor` tests out. **A loss, named:** nobody can now validate
      a third-party index, look up one element or bundle a corpus from a terminal without writing
      code; the in-app equivalents are Phases 7 and 8.
- [x] **Start a character as a multiclass from the outset.** Raised by the maintainer, from a
      long-standing annoyance with Aurora: to make a level 17 character in two classes you cannot
      say so up front. You build the full level in one class, then level up one at a time the rest
      of the way. The builder should let a character be declared multiclass from the start, with
      the class split (say Fighter 12 / Wizard 5) as one input, and open every decision that split
      owes at once, in the same flat list (ADR 0017), instead of walking there a level at a time.
      Multiclassing has minimum ability scores, and those are **flagged, not enforced**: while a
      score falls short, the character is allowed to exist and the builder shows which gate is
      unmet and by how much, and clears the flag when the score rises. That is a change of stance
      from ADR 0036, which offers a class only when its gate is met, so it wants an ADR before
      code. Two things to settle in it: what the per-level order is when the user gives only totals
      (`advancement`, ADR 0015, is a per-level record, and Wizard 4 / Rogue 4 read differently
      from Rogue 4 / Wizard 4, so a split needs either an order or an explicit "which levels went
      where"), and how a flagged character is written to `.incu`, which must still open with zero
      sources (ADR 0012). **Done: [ADR 0045](./docs/adr/0045-a-class-split-is-one-input-and-an-unmet-ability-score-minimum-is-a-flag.md).**
      The split is an ordered list of (class, levels), written as the ordinary `advancement` plus the second
      class's multiclass element (no format change). Only the ability score minimum is soft: a short score is
      flagged with the shortfall and never refuses a class; the other edition of a class and a class with no
      multiclass block still refuse. Proved on the official corpus (a split equals the same levels taken one at a
      time; the refused set is the same at score 3 and 30), through a save-and-reopen with zero sources, and by
      using it in the running app (Fighter 12 / Wizard 5 in one click). **Not verified:** the Tauri window, the
      layout by eye, and macOS or Linux.
- [x] **Speed, from every source that changes it.** The 5e definition declares `speed` with a default
      of 30 and nothing feeds it, so every character reads 30. Content writes speed under other names
      (a race's `innate speed`, and class features, items and feats that add to it), and none of that is
      read. Found by hand-reading Aurora's screen for the 30 generic sample saves
      (`tools/verify/fixtures/saves/READOUT.md`): **nine differ, and the maintainer's readings are right**
      (Wood Elf 35, Halfling and Dwarf 25, Barbarian and Monk 40). Probably a system-definition change
      with no engine one, but the first step was finding which stat names content actually uses.
      **Done ([ADR 0043](./docs/adr/0043-speed-is-the-race-base-plus-what-content-adds-to-it.md)).** Counted
      first: a race writes `innate speed` (base), classes and feats `innate speed:misc`, a handful of things
      `speed`/`speed:misc`, armour subtracts from `speed` (2024: `innate speed`). The pc kind now derives
      `speed` from the first three; a system-definition change, no engine one. **All 30 samples agree with the
      readout** (seven differed when re-measured, not nine), so `aurora-oracle.test.ts` now holds speed to it.
      Perturbation: dropping the `innate speed:misc` term fails the Barbarian, Barbarian / Monk and Monk.
      **Not verified:** the armour Strength penalty, Armorer's cancellation and the 2024 armour rule (no sample
      wears armour that costs speed), and the other movement modes. A raceless character now reads 0, not 30.
- [x] **Hit points from the method Aurora used, not from every die a save records.** `hp` sums the
      recorded per-level dice and adds the Constitution modifier, and three separate things make that
      disagree with Aurora's screen (17 of the 30 samples, checked by hand by the maintainer):
      - **The average option.** A campaign option, `ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP`, is on in 15 of
        the 30 samples. With it on Aurora applies the die's average (the first level is the maximum) and
        the dice in `rndhp` are *stale*: one sample records `8,8,8` for the levels the screen counts as
        `8,5,5`. So the derivation must read the option and **calculate** the average, not copy dice.
        Where the option is off and the maintainer set the average by hand, the recorded dice are the
        applied values and must still be read: both situations have to work.
      - **A second class's own dice.** A multiclass save carries a second `rndhp` on the level where the
        second class began. Whether the import uses it is unchecked, and the multiclass samples without
        the option (2 to 6) disagree by −6 to +18, unexplained.
      - **An item that sets an ability score.** The Amulet of Health sets Constitution to 19, and the
        derivation does not apply it: two samples read exactly 10 low, which is 2 modifier points for
        5 levels. This is a gap in ability scores, not in hit points, and it will bite armour class and
        saves the same way.
      **The principle, which applies beyond hit points:** when converting a save, do not copy what is
      cheap to calculate. Copy only what has no formula (rolled hit points, chosen scores). Where
      Incudo's number disagrees with Aurora's recorded one, **tell the user, and keep Incudo's.**
      `packages/aurora-import` is frozen (ADR 0008), so most of this belongs in the derivation and in the
      builder rather than the importer, and a change there wants an ADR. **Done: [ADR 0044](./docs/adr/0044-hit-points-follow-the-method-the-character-uses.md).**
      An item's set score is a lower bound, a single class publishes `level:<class>`, the importer files each
      class's own dice under the levels it was taken at, and the average option chooses where the dice come from
      (per-class averages, the character's first level the maximum, read off `hd` by a per-track setter
      expression and `track:first`; the builder's `levelRoll.fixedWhen` stops asking for rolls). **All 30
      samples agree with the maintainer's readout and `aurora-oracle.test.ts` holds hit points to it**, as it
      holds armour class and speed. Perturbation: ignoring the option fails 11 samples (14, 15, 16, 18, 19, 22, 23,
      24, 25, 27, 29); dropping the first-level term or the progress term fails 15 each; reading the option as always
      on fails the three option-off samples whose recorded dice are not the averages (04, 10, 20); dropping the rolls branch fails the 15
      option-off samples. Oracle tables are identical to the snapshot before the change. **Not verified:** the readout
      is a person's transcription; prepared spells were still not modelled when this landed (they are now, below); the
      builder's fixed-value screen was covered by tests and not driven in the running app; and nothing was run on
      macOS or Linux.
- [x] **Prepared spells: one recorded list per casting block, and everything else derived.** The last clause of
      the exit criterion. Measured first, against the 30 samples and the official corpus, and **content already
      states nearly all of it**: every preparing class ships `<class>:spellcasting:prepare` as level and ability
      stats, always-prepared spells are `<grant … prepared="true">`, and Incudo already agreed with Aurora's screen
      for 10 of the 15 preparing blocks. The other five were one bug, and a general one: a stat reference ending
      `:half` or `:half:up` was read as a stat nobody publishes and contributed 0 (61 uses in the corpus).
      **Done ([ADR 0046](./docs/adr/0046-preparing-spells-is-a-recorded-list-per-casting-block-and-the-rest-is-derived.md)).**
      `:half` is read when a reference is evaluated (rounds down; `:half:up` up). What has no formula is one input,
      `Character.prepared`, keyed by block, embedded in the save so it opens with no source, and copied from an
      Aurora save by a bugfix to the frozen importer. A kind declares `preparation` in the system format; the
      engine publishes each block's limit, what is always prepared, what counts and how far over that is (a
      reported `over-prepared`, never a refusal); the builder has `prepare`, `unprepare` and a pool; the Build pane
      shows "N of M prepared" per class for a multiclass caster. **All 30 samples agree with Aurora and it is held**:
      the flagged set exactly, the limit against the maintainer's readout, a book or a list as Aurora's own listing
      says, and everything Aurora lists held or offered. Perturbation fails the specific samples (no importer copy,
      a wrong or short limit, `:half` read as nothing, no book, a first-level-only filter, no always-prepared
      marker). Every other oracle table is identical to the base commit; sample 03 gains one problem, its Wizard,
      which records 10 prepared against a limit of 8 (Aurora does not enforce it). Every sample was rebuilt
      through the builder and each prepared spell had to be *offered* first.
      **Not verified / not done:** the 2024 Paladin and Ranger, whose prepared count is a book
      table content carries only as prose in the class description, not as a stat (Aurora's screen reads 0 and so does
      Incudo; corrected 2026-10-05, and an open item at the end of Phase 3 with the next clause); the Wizard's minimum of one; a
      list on the Sheet; a per-character source allowlist for the list pool (Aurora's lists are narrower than
      Incudo's because it had sources switched off); driven in the browser build and not in the Tauri window, and
      the folder dialog that saves and reopens a character could not be answered by a script.
- [x] **The `Ritual` filter operand is read** ([ADR 0047](./docs/adr/0047-a-filter-operand-may-name-a-true-setter-and-the-system-says-which.md)).
      One of ADR 0030's three unread operands, 17 uses in the official corpus, all on spell selects: the Ritual
      Caster feat (2014 and 2024), Pact of the Tome, Book of Ancient Secrets, Quicksmithing. Measured first: 69 of
      1,079 spells carry `isRitual` true, no element carries a `Ritual` tag, and two samples (06 and 30) pick four
      spells through such a filter, all of them ritual, which is the second witness ADR 0030 wanted. The general rule
      ("a true boolean setter is a tag") was **not** adopted: the only other setters that are filter operands
      (`exotic`, `standard`) are also written as tags and so witness nothing, so the fix is one named pair,
      `setterTags` on a character kind, and a second entry would be the case for a rule. Nothing in core names a game.
      `rogue-wizard-aurora.test.ts` lost its one named exception: the builder now offers Comprehend Languages and
      Alarm and accepts them. `ritual-filter.test.ts` seeds every Ritual select in the corpus and compares what it
      offers with a list read straight from the spells, and removing the declaration empties every one. Every table
      in `aurora-oracle.test.ts` is identical to the base commit (`INCUDO_ORACLE_SNAPSHOT` on it, `INCUDO_ORACLE_BASELINE`
      on the change, and a deliberately altered baseline fails). **Driven in the Tauri window (Windows, 2026-09-24):**
      a Wizard 4's Ritual Caster feat offered 17 first-level rituals and nothing else, and two picks settled and
      survived a save, restart and reopen with no source. **Not verified:** `aurora verify` cannot see a
      candidate list, so the evidence is the corpus-read expectation and perturbation; six of the eight 2024 Ritual Caster slots (the 3rd to the 8th) are gated on proficiency and were not open for the
      test's fresh character; macOS and Linux untouched.
- [x] **A leading `!` on a filter operand is read** ([ADR 0048](./docs/adr/0048-a-leading-bang-on-a-filter-operand-negates-it-and-is-read-when-the-filter-is-evaluated.md)).
      The last of ADR 0030's unread operands: 18 `supports=` attributes, 14 select rules (the Artificer's
      infusions and specialist in Eberron and Tasha's, the Dragonmark ability increases, Bladesinging's weapon
      training) offered an empty list because `!TCOE Base` was a tag nothing carries. It negates one operand, a
      tag, an id or a setter value, and is read where the filter is evaluated and not in the parser, so saves
      written before it are fixed without a re-save. Two samples pick ten elements through such selects and all
      pass; `negation-filter.test.ts` compares each select with a list read straight from the elements, and
      fails without the change. Oracle tables identical to the base (snapshot and baseline, and a doctored baseline
      fails). **Driven in the Tauri window (Windows, 2026-09-24):** the infusion list at level 2 (11 offered, none of
      Eberron's), the specialist list at level 3 (5), and a Dragonmark's ability increase without the ability the
      mark fixes; ADR 0048 has the detail. **Not verified:** the ten infusion selects were seen at level 2 only, and
      macOS and Linux untouched.

### Where this phase actually stands

**Closed by the maintainer on 2026-09-24.** Every box above is checked, and the exit criterion below is met
on every clause. What follows is how it stood when it closed, kept because the lessons in it outlived the phase.

**What shipped against what was planned.** The phase was planned as eight boxes; all eight shipped, and three of
them changed shape on the way:

- **"Save/load `.heroforge` files"** became `.incu` ([ADR 0007](./docs/adr/0007-native-formats.md)), a zip that
  carries the content it uses, and the phase added a library folder to hold them (ADR 0027) and a copy written
  anywhere (ADR 0038).
- **"Build flow driven by the system's `buildSteps`: race → class → background → …"** is not a sequence. It is one
  list of open decisions with no current step and no Back button ([ADR 0017](./docs/adr/0017-open-decisions-not-steps.md)).
- **"Tauri desktop shell … routing"** has no router: five panes and a command list the menu and the keyboard both
  render (ADR 0037).

Unplanned and shipped, because building the planned eight needed them: the system launcher and user-added systems
(ADR 0031), campaign options (ADR 0032), inventory and a derived armour class (ADR 0021 to 0026), the spell slot,
save DC, hit point and speed derivations (ADR 0018 to 0020, 0043, 0044), the filter language (ADR 0030, 0047,
0048), prepared spells (ADR 0046), class splits (ADR 0045), thirty committed sample saves read in CI (ADR 0042),
and the CLI's removal (ADR 0039). Not shipped, and carried: the gaps listed under "Known gaps" below, the
per-character source allowlist (Phase 3), and anything run on macOS or Linux, which no part of this phase was.

**How it stood when it closed.** Its exit criterion — one exact character, built end to end in the running
app and compared with Aurora's output — is now met on every clause, built, checked against the book, and
compared with an Aurora save of the same choices (prepared spells were the last, ADR 0046). Nothing in the rules engine is outstanding, though the
first two levelling bugs ("nothing to choose", "the +2 lands as +1") were found by running it
and not by any test, which is worth keeping in mind before believing that sentence.

That is a change of kind, not just of subject, and it is worth naming before the first screen
is written. Every number settled in this phase was settled against Aurora's own arithmetic, or
was explicitly marked as one Aurora could not check. **A view layer has no oracle at all.**
There is no `<sum>` for a screen, and "it looked right" is the evidence a UI usually ships on.
Decide how the shells are kept honest before building them, not after.

**Two answers to that, from the library work, and they are worth reusing.** First: put the
screen's *state* in `packages/ui` as a view-model and test it in Node, so "which characters
exist, which are broken, which sources have moved" has assertions even though the grid does
not. Second, and the one that keeps earning: **run it against the real data**. The nine
`.dnd5e` saves are not only an oracle for arithmetic — driven through the library they caught a
portrait that is a **JPEG**, which every unit fixture had assumed was a PNG. Neither of those
replaces using the app. Of the three real bugs the library session found, two came from the app
in a browser and one from the real saves, and **none had a failing test first**.

The ability score editor then found three more the same way, and one of them was **data loss**:
changing a content source reverted the character to what it was when opened, then autosaved the
reversion over the draft. Twelve green test files over the same code said nothing, because
nothing there rebuilds a builder mid-edit. That is now three sessions running in which using the
app found every bug that mattered, and the tally for the view layer is worth keeping: the tests
protect the rules, and **running it protects the product**.

### Known gaps, carried deliberately

Things the engine work left visible rather than fixed. None has a symptom today; all are here
so that finding one again is recognition rather than discovery.

- **~~Nothing checks that a recorded choice was legal for the slot it fills.~~** A `select` pool is
  keyed on (element, name) and its allowance is the sum of the active rules', but 89 groups in
  the corpus have rules that differ in `supports`, `requirements` or `type` — a wizard's first
  six spellbook entries are 1st level and the two it adds each level afterwards are not. The
  pending pool offers the union of the candidates of the rules with room left, and a pick
  recorded against the wrong rule is accepted in silence. Wants a builder before it matters.
  *(Closed by [ADR 0096](./docs/adr/0096-a-pick-counts-while-its-slot-exists-and-a-pool-s-slots-are-filled-as-a-matching.md): picks are placed as a matching and one no rule offers is flagged.)*
- **One grant cannot cancel another.** A Mithral Armor adornment suppresses its host armour's
  `ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE`, and no content file expresses that — it is Aurora
  app behaviour. It is 2 of the 55 `element-extra`, and a set of real saves carry the control case:
  plate with no mithral does keep the marker. Not invented (ADR 0005). *(Unchanged by ADR 0061 and ADR 0067, which
  let the **user** take away what a creature gives an NPC: an input, not content cancelling content.)*
- **`ID_INTERNAL_MULTICLASS_LEVEL_3`** — the single `element-missing`, an Aurora-app marker
  nothing in the 740 files references and that carries no rules. Honestly unmodelled.
- **One unresolved reference upstream** — the `…VULNERAILITY…` typo. It is a *grant* to an id
  nothing declares, so a character silently loses something. Zero the day AuroraLegacy fixes
  the spelling; not Incudo's to fix.
- **`hp` and `ac` are unverifiable against Aurora's file, permanently.** The save format records the
  per-level rolls and never the total, and records no armour class at all. Both are derived
  from published rules and checked by perturbation, and both agree with what the maintainer read off
  Aurora's screen for all 30 samples (ADR 0026's note, ADR 0044). Do not describe either as verified
  beyond that.
- **A granted ability point is only spendable under a method that prices values.** ADR 0017's
  headline case — "a class gave you one more attribute point" — works for point buy, where the
  cost table says what a point buys. Under the standard array or a rolled set there is no cost
  table, so a granted point is reported on `BudgetState.granted` and cannot be spent. Inventing
  "one point is +1" would be the guess ADR 0005 rules out. Nothing in the 740 files contributes
  to 5e's `ability points` today, so this fires zero times; an ASI is a `+1` straight to the
  stat and lands as an ordinary contribution.
- **~~An NPC or legendary creature still has no way to set ability scores.~~** Fixed by
  [ADR 0057](./docs/adr/0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md), and not only by the budget named below: a creature's printed scores are where
  an NPC's start, and the manual budget replaces them. Both kinds declare a
  required `abilities` step with `"types": []` and **no `budget`**, which is the shape ADR 0017
  called inert: it matches no pending choice and reports itself complete. The editor is ready
  for them — it is a budget renderer and knows nothing about 5e — so this is one `budget` block
  per kind in `systems/dnd5e/system.json`, deliberately not written while the phase is about a
  PC. A monster's scores are printed rather than bought, so the method is `manual`.

**Exit criteria:** a level 8 multiclassed Rogue/Wizard with a subclass, feats and prepared
spells is buildable end to end and matches Aurora's output for the same choices.

The engine side of that is met: an Arcane Trickster in the running app is offered its
school-restricted spell list, a bard's pool widens from 54 to 161 between levels 1 and 5, and
`aurora verify` still reports 0 `spell-missing` across a set of real saves. Levelling works — an
answered pick can be changed, and raising the level opens hit points, a subclass and each
ability score improvement in the same list, with a +2 landing as +2. A class can now be chosen
at each level: a Fighter 4 / Rogue 1 / Wizard 3 built in the running app is offered the Rogue's
multiclass skill, the Wizard's cantrips and spellbook, Arcane Tradition and hit points on each
level's own die. Feats were the last item and are reachable now: the campaign options of ADR 0032
(`multiple: true`) switch them on, and a level 4 Fighter takes one — so the Rogue/Wizard-with-feats
sentence above is met on the engine side. That exact character has since been built end to end in the
running app (see the entry above), which found and fixed a real multiclass defect. Every part of it that Aurora
records has been compared with Aurora: the builder path on every sample save, and the Rogue/Wizard on a save
of the same description (see the entry above). **Prepared spells, the last clause, are met** ([ADR 0046](./docs/adr/0046-preparing-spells-is-a-recorded-list-per-casting-block-and-the-rest-is-derived.md)):
the Rogue 4 / Wizard 4 built through the builder has the Wizard's limit Aurora's screen showed, and preparing the
spells its save prepared is offered and accepted, giving the list the save records. `hp` stays unverifiable as a
number Aurora records, as it always was: the save's rolls differ from the description's averages, and Aurora
records rolls and never a total (it agrees with the maintainer's screen readout, ADR 0044).

---

## Phase 3 — Content story ✅

- [x] **Update checks that see an update, and a refresh that keeps what it cannot reach**
      ([ADR 0050](./docs/adr/0050-an-update-check-asks-every-cached-file-and-a-refresh-keeps-what-it-cannot-reach.md)).
      The ETags and offline-fallback half of "live mode hardening". "Check for updates" compared the top index's
      version, and AuroraLegacy's has been 0.0.1 since 2023, so it could never flag the source it suggests. It now
      asks every cached file with its ETag where the transport can (the Tauri build; a browser page cannot, the
      host refuses the preflight) and says how many changed. Refresh is network first: a 304 keeps the cached copy
      without downloading it, a failure keeps it and says so, and files the index stopped naming are removed;
      offline, it changes nothing, where it used to evict everything first. Running it found that
      `tauri-plugin-http` opens a connection per request, which the host throttles: a check of 800 files took 113 s
      and then never finished. The shell now fetches through its own command over one client; the check takes
      3.1 s, a refresh with nothing changed 6.2 s and a full download 10.8 s, where it was 81 s. Driven in the
      Tauri window and the browser build on Windows. **Not done:** partial index loading (below); the window was not
      taken offline (the tests hold that); macOS and Linux.
- [x] **Live mode hardening, the rest: partial index loading, measured and declined, and the index walk made
      concurrent instead** ([ADR 0051](./docs/adr/0051-lazy-loading-is-declined-and-the-index-walk-stops-waiting-on-itself.md)).
      Measured first: a character holds 7 to 18 of AuroraLegacy's 740 files, but the builder's first screen needs 373
      of them (every race, class, background and book, and the files whose appends reach across), an Aurora index says
      nothing about what a file holds, and after the first load everything is cached (a reload is 0.8 s). Lazy loading
      would save part of one load and needs an index that can miss. The same measurement found where a cold first load
      waited: 60 of its first 63 requests are nested indexes, fetched one at a time. Each is now fetched as soon as the
      index naming it is read, within the same six requests in flight, and applied in the same order. Adding the source
      on a fresh profile in the Tauri window went from 36.7 s to 25.7 s; the rest is 740 files from a host that keeps
      them five minutes. A test loads the real corpus both ways and compares every element and diagnostic. Driven in
      the Tauri window and the browser build on Windows. **Not done:** anything that makes the element files faster *(in Beyond 1.0's "Left from Phases 3 to 5" since 2026-10-12)*;
      macOS and Linux.
- [x] Download mode: versioned cache, update checks against the index version — ADR 0029 built the cache, the
      version stamp and the check, and ADR 0050 made the check look at files rather than the index version, which a
      source may never bump
- [x] **Content browser: search across all loaded elements** ([ADR 0053](./docs/adr/0053-a-content-browser-searches-everything-loaded-and-groups-by-what-the-system-declares.md)).
      A Browse pane (Ctrl+5) looks through what the enabled sources loaded, not a character's view of it and not a
      save's own content. Measured first: 14,545 elements in 42 types, two the 5e definition does not declare, and a
      plain scan over names and description text takes under 8 ms a query in the Tauri window, so there is no index.
      With nothing typed it offers the system's `browsable` types, a field the format has carried since Phase 0 and
      nothing had read; a search covers every element, ranked name, prefix, word start, every word, the start of an id,
      then description text, and narrows by type and by book. The 2,258 inline list items stay in, since only 244 of them
      can be read anywhere else, and each says which select offers it, found from the select's one-tag filter rather
      than from its id. An element shows its book, source, file, id and tags. Running it changed the order within a
      rank (a table row called "Elf" came before the Elf races), the narrow layout, and kept the search across panes.
      Driven in the Tauri window, Ctrl+5 and typing with real keys, and the browser build on Windows. **Not done:**
      filters by tag or setter ("3rd-level spells"); what grants an element; macOS and Linux. *(The first two are
      in "Beyond 1.0" since 2026-10-05.)*
- [x] **When two sources define the same id** ([ADR 0054](./docs/adr/0054-when-two-sources-define-the-same-id-the-later-one-in-the-list-is-used-and-the-list-says-so.md)).
      Measured first: AuroraLegacy alone has no id another source defines, but beside the original Aurora repository,
      which someone coming from Aurora may still have, 7,262 ids are defined by both and 1,978 of them differently (450
      spells, 622 subclass features, the rules of 382). Which one a character was offered depended on the order the
      sources were added, and the evidence was one warning per id in a list that shows fifty. The later source is
      still used, now as the stated rule: the Sources pane says it above the list, Move up and Move down change it, and
      each source's line says what it shares with each other source, how many differ and whose version is used, with
      the ids behind a click. Nothing is blocked or chosen per id, and a saved character keeps what it embeds. Driven
      in the browser build on Windows with the original's Core beside AuroraLegacy, reordered both ways. **Not done:**
      a per-id override *(in Beyond 1.0's "Left from Phases 3 to 5" since 2026-10-12)*; "also defined by" on the Browse pane; the Tauri window, macOS and Linux. *("Also defined
      by" is in "Beyond 1.0" since 2026-10-05.)*
- [x] **Say when a source refers to content no enabled source has** ([ADR 0052](./docs/adr/0052-a-source-that-refers-to-content-no-enabled-source-has-is-reported-and-never-blocked.md)).
      Any inner index can be added as a source, and 58 of AuroraLegacy's 60 grant ids only another declares: the 2014
      Player's Handbook alone refers to 110 missing things and offers no skill at all, and used to do it in silence. Each
      source's line on the Sources pane now says how many things it refers to that no enabled source contains, and how
      many of its additions wait for a target, with the ids behind a click. Never enforced, never a guess at which source
      is missing; requirement-only references are left out, since content writes those on purpose. Running it removed
      "it may need another source enabled", wrong on AuroraLegacy's own line, whose one missing thing is an upstream
      typo. Driven in the browser build on Windows. **Not done:** ~~naming a configured-but-disabled source that declares
      what is missing~~ (done since 2026-10-05, ADR 0090, at the end of this phase); Incudo's own content format, which
      will declare dependencies (the ADR says what it must carry); the Tauri window, macOS and Linux.
- [x] **Choose parts of a source before loading it** ([ADR 0055](./docs/adr/0055-a-source-records-the-parts-switched-off-and-the-load-skips-them.md)).
      Measured first: AuroraLegacy is 60 indexes at most two levels deep, no part named twice, and three indexes list
      files beside nested ones (Core lists the skills-and-languages file itself; Unearthed Arcana lists 64 documents), so
      the tree offers files as well as indexes. A source records the parts switched off, and the load and the refresh
      skip each wherever it is named; a book upstream adds later arrives switched on. "Choose parts first" beside Add, and
      "Choose parts" on a source's line, read the tree from the indexes alone and say how many files will load, a figure a
      test holds equal to what a load reports. A test on the real corpus holds the tree to the URLs a load requests, one
      for one. What a switched-off part leaves missing is ADR 0052's line. Driven in the browser build on Windows.
      **Not done:** the Tauri window, macOS and Linux.
- [x] **Which books a character is offered** ([ADR 0049](./docs/adr/0049-a-character-records-which-publications-it-is-offered-and-it-narrows-offers-only.md)).
      The item was "source enable/disable per character", and a content source is the wrong unit: one index holds
      every book. The unit is Aurora's, the book (`type="Source"`), which the system marks `publication: true`.
      `Character.publications` is an optional allowlist of book names, absent for every book; the builder offers from
      a view of the index that leaves other books out of every list and still answers every id, so nothing a
      character holds moves. A book content marks required (`requiredWhen`, 5e's `core`: Aurora Legacy Essentials,
      which holds every skill and language) is always offered. The Build pane has a Books list. A level 1 wizard
      offered only the 2014 Player's Handbook is offered 88 things instead of 452 (races 139 to 9), and all thirty
      samples derive identically offered no book at all. Running it found the required book, which the first design
      would have hidden with every skill in it, and a settled pick that dropped its own answer from its alternatives.
      Driven in the Tauri window on Windows, save and reopen with no source included. **Not done:** the Aurora importer
      does not fill the list from a save's `<restricted>` (frozen, and the samples have none to witness it); no edition
      switch; no per-user default for new characters *(these two in "Beyond 1.0" since 2026-10-05)*; macOS and Linux
      not driven.
- [x] **Add a raw Aurora `.xml` the user drops in or picks** ([ADR 0056](./docs/adr/0056-an-aurora-file-the-user-adds-is-a-source-of-its-own-kept-as-a-copy.md)).
      Each file is a source of its own, tagged with the system in view, kept as a copy in the app's storage (outside the
      content cache, which may be pruned), and named by its file name, so adding it again replaces the copy. An index,
      or a file with no elements, is refused with a sentence. It has its line like any source (what it lacks, what it
      shares), and no update check or refresh. Dropped on the window while Sources is open, or "Choose files…". A corpus
      file added this way loads to the same elements the corpus load made of it. Driven in the browser build on Windows
      by a dropped file: added, shown in Browse, replaced, kept across a reload, removed with its copy. **Not done:** ~~the
      picker and the Tauri window's drop were not driven~~ (both driven in the Tauri window on 2026-09-28, with the ADR
      0065 item in Phase 4: a real OS drop and "Choose files…" through the native dialog); a folder or zip of files *(in Beyond 1.0's "Left from Phases 3 to 5" since 2026-10-12)*;
      macOS and Linux.
- [x] **Read Aurora's `[character:N]` and `[type:X]`, and withdraw a granted element its own requirements rule out**
      ([ADR 0071](./docs/adr/0071-an-element-s-own-requirements-hold-it-as-well-as-offer-it-and-a-granted-element-they-rule-out-is-withdrawn.md)).
      Measured first: an element's own requirements were read when it was offered and never once it was granted, so a
      2014 Ranger who takes Tasha's Deft Explorer also kept Natural Explorer; the two terms parsed into stats nothing
      published, so a level 4 2024 character was offered none of the 50 general feats of its book. 5e now declares a
      `character` stat (the level) and its kinds a `heldTypesStat`, `type`, whose tags are the held elements' types; a
      granted element whose own requirements are false is withdrawn (never a seed) and published in
      `DerivedCharacter.withdrawn`, not as a problem, and a recorded answer under its select waits for it. The oracle,
      before and after on the same checkout: 30 `element-extra` rows go (73 to 43), the Artificers' 22 firearm
      proficiencies and the Thieves' Tools expertise pair on four samples, and nothing else moves. A level 4 2024
      Fighter is offered 23 of the 50 feats, the Ability Score Improvement feat among them. Driven in the browser build
      and in the Tauri window on Windows (DOM clicks over the debug port, the saved file derived with no source).
      **Not done:** the replacement itself cannot be driven, since the app cannot put an item in the bag (next item,
      since done);
      ~~a seed whose own requirements have become false is not flagged~~ *(flagged since [ADR 0096](./docs/adr/0096-a-pick-counts-while-its-slot-exists-and-a-pool-s-slots-are-filled-as-a-matching.md))*; macOS and Linux
      not driven.
- [x] **Take a Tasha's optional class feature in the app**
      ([ADR 0072](./docs/adr/0072-a-build-step-may-offer-items-a-character-equips-and-what-it-takes-is-a-bag-entry.md)).
      Measured first: the 36 items carry no requirements of their own (their grants are gated on the class level), nothing
      offers or selects them, none of the samples carries one, and a 2024 class answers their gates as a 2014 one does. A
      build step may now declare `equip`, a setter and its values: it is a skippable set like campaign options, and what
      it takes is an equipped bag entry, the record an Aurora import makes, so an imported one reads as taken. Taking one
      back removes a bare entry and drops the answers it closed, and keeps a replaced feature's. 5e declares "Optional
      class features" after class levels; its inventory names `inventory-hidden`, which keeps the item off the sheet; and
      Build lists what is withdrawn under "Not held". A 2014 Ranger takes Deft Explorer, loses Natural Explorer, and taken
      back has it again with its favoured terrain. Running it found `setInventoryEntry` lowering a later format version to 2.
      The oracle is identical on all thirty samples. Driven in the browser build and in the Tauri window on Windows (DOM
      clicks over the debug port, the saved file read back from disk with no source). **Not done:** a general bag editor;
      saying which items give a character anything; the other hidden item families (climb speeds, feat unlockers, the
      companion and familiar selections) *(the first two in the inventory item below, the third an open item at the end
      of this phase since 2026-10-05, done the same day by ADR 0089)*; macOS and Linux not driven.
- [x] **Optional class features follow the class**
      ([ADR 0081](./docs/adr/0081-an-equip-step-may-offer-only-what-is-gated-on-what-the-character-has.md)). An equip step
      may declare `gatedOnHeld`: an item is offered only when one of its grants is gated on a stat the character publishes
      or an element it holds. 5e's step offers nothing before a class, then that class's features (1 to 7 per class),
      each class's to a multiclass character, and Primal Companion once Beast Master is chosen.
- [x] **Starting equipment, and an inventory the player manages** (the maintainer's request, 2026-10-05). The bag is
      modelled, imported, derived and saved (the five inventory steps in Phase 2), and armour class and attunement read
      it, but nothing in either app puts an item in it: a character built in Incudo starts empty and stays empty, and
      5e's "Equipment" build step is a heading with nothing to choose, so it always reads complete. Two parts:
  - [x] **A starting equipment step**, a full step of the build: the character takes its class's starting items **or**
        the gold they are worth instead, and its background's, and what it takes lands in the bag (equipped where it is
        worn or wielded). **Measured before planning it, and it decides the design:** content states starting equipment
        only as prose, never as rules. The 2014 Player's Handbook's 12 classes write "You start with the following
        equipment" as lines of *(a)* / *(b)* alternatives and no gold option; the 2024 book's 12 write a "Starting
        Equipment" table row, "Choose A, B or C", where the last is gold alone (the Fighter's (C) 155 GP); all 31 core
        background files write an "Equipment:" line (a 2024 one, "Assemble a package worth 50 GP"); a handful more in
        Eberron, Tasha's, Ravnica and Unearthed Arcana. No `<select>`, `<grant>` or setter carries any of it, and a
        character has no field for money (Aurora's saves record `<currency>`, which the importer drops). **Decided in
        [ADR 0087](./docs/adr/0087-starting-equipment-is-a-data-file-beside-the-system-and-money-is-counted-in-the-units-the-system-declares.md)**
        (the maintainer chose the data file): packages live in `systems/dnd5e/starting-equipment.json` beside the system,
        keyed by class and background id, each an option list (a package of item lines and *(a)* / *(b)* choices and
        filtered picks, fixed coins, or a wealth roll); the 2014 per-class wealth roll is the book's rule and sits in each
        class's entry, rolled by `packages/ui` and recorded in `rolls`; only the first class gives a package; what is
        taken is written once into the bag and the purse, and taken back only while untouched. Money is
        `Character.money`, counts per unit, in units the system definition's `currency` declares, each with the
        `exchangeRate`s the book states ("gp": { "sp": 10 }), held consistent by the validator (5e: cp, sp, ep, gp, pp);
        format 9; an import reads `<currency>`. **Built 2026-10-07** (ADR 0087's note): character format **11**, not 9; the
        record of what a package wrote is `Character.startingEquipment` (the option, the entries it added, the coins), not a
        choice, which would seed the derivation; 2024 rows measured as 11 "A or B" and one "A, B or C"; the file covers the
        Player's Handbooks' 24 classes and 29 backgrounds, held to the corpus and to the 2024 book's own pack items (`<extract>`,
        44 blocks the parser does not read). Driven in the browser build and in the Tauri window on Windows (2026-10-20); not on a phone.
  - [x] **Inventory management at any point**, not only while building: add any item from loaded content to the bag,
        remove it, change quantity, equip and unequip it into the kind's slots, attune (the limit shown, never refused,
        as `over-attuned` already is), attach a magic item to a host, rename an instance and write notes; and spend or
        receive money once it is recorded. The model and the engine are there (`setInventoryEntry`, ADRs 0024 to 0026);
        what is missing is the view-model in `packages/ui` and a screen in both shells, the desktop and the phone. Also
        say which items give the character anything, which ADR 0072 left undone. **Hidden is not a reason to leave an item
        out** (ADR 0089 decision 3): the 2024 mounts are hidden, priced and without rules, so they are goods this editor
        offers; the families the equip steps already offer are the ones it may leave to them. **Built 2026-10-08**
        ([ADR 0098](./docs/adr/0098-the-bag-and-the-purse-are-edited-in-place-and-what-an-item-gives-is-read-off-the-derivation.md)):
        an Inventory section on Build in both shells; buying pays in the item's own coin and change is only an Exchange the
        player asks for; an adornment admits its host by name too; a pack opens into its `<extract>` contents (now parsed);
        each entry says what it gives, read off the derivation; the Sheet, the Markdown and the 2014 form list the bag and
        the purse. Driven in the browser build; the phone screen is written and **not yet run on the emulator**, which is
        what the item's exit criterion still waits for (`inventory-editor-build.test.ts` reads the desktop's file with the
        phone's zip in Node).
      **Exit:** a character built from nothing in either app takes a class's package or its gold, then buys, equips and
      attunes items later; its armour class and attunement follow; the file opens identically on the other app.
      **Done** (2026-10-12): both parts are built in both shells, from one view-model each (`starting-equipment.ts`,
      `inventory.ts`), and a Fighter built from nothing takes its wealth, buys, equips, attunes and opens a pack, armour
      class 18 to 19 and speed 20 to 30, with the desktop's file read by the phone's zip and reopened with no source to the
      same bag, purse and sheet (`inventory-editor-build.test.ts`, `starting-equipment-build.test.ts`). Driven in the
      browser build. The phone's two screens are written and not yet run on the emulator, and neither is driven in the
      Tauri window: both are Phase 9's drive item, not open work here.

*The items below were found on 2026-10-05 by an audit of what the ticked items of Phases 0 to 5 left undone, written
inside them rather than as items of their own. The first four were buried in Phase 2, which stays closed; each keeps
its original text with a pointer here.*

- [x] **"Allow multiclassing" does what it says.** *Buried in Phase 2's ADR 0080 sub-item.* Campaign options list the
      overlay's `ID_INTERNAL_OPTION_ALLOW_MULTICLASSING`, a new character starts with it on (ADR 0080), and nothing reads
      it (0 of 740 files; the class control is deliberately not gated on it, ADR 0036): unticked, Build still adds a
      second class, which is misleading on screen. Multiclassing stays; the item is that switching the option off is
      honoured. What the class control does then, and what a character that already has two classes shows, touch ADR
      0036's gate and want an ADR.
      **Done** ([ADR 0088](./docs/adr/0088-a-per-level-step-may-name-the-option-that-allows-another-class.md)): a per-level
      step may name the option that allows another class (`multiclassWhen`, the shape of `levelRoll.fixedWhen`), and 5e's
      names this one. Off, a class the character has no level in is unavailable and both apps say so once in the option's
      own name; a character already holding two classes keeps them and is flagged, never changed; one that records no
      options reads as off (ADR 0080). Measured first: 9 of the 30 samples record the option, all 8 multiclass ones among
      them, so no import is flagged and the 21 without it are offered no second class, as Aurora's screen does. Driven in
      the browser build and in the Tauri window on Windows (2026-10-20) (a Wizard with the option off offered no second class); not on the phone.
- [x] **Choices that no longer apply stop counting.** *Buried in Phase 2's multiclassing item and this phase's ADR 0071
      item.* Picks of a class whose levels went away, and picks a lowered level no longer opens (a Wizard 5 lowered to 3
      keeps its level 4 improvement), stay in `choices` and still seed the derivation (ADR 0036), so the character keeps
      what it no longer qualifies for, with nothing on screen saying so. A seed whose own requirements have since become
      false is not flagged, and stale choices are not pruned in general (ADR 0071 decisions 2 and 3). Dropping or
      flagging them wants a decision about every pick, not only about levels.
      **Done** ([ADR 0096](./docs/adr/0096-a-pick-counts-while-its-slot-exists-and-a-pool-s-slots-are-filled-as-a-matching.md)), with the item below: a pick under a pool content declares counts only while
      something held opens that pool, and only as many as it has slots. The rest stay in `choices`, seed nothing, are
      listed on Build under "Not counting" with a sentence saying why, and count again when the slot is back; only the
      user's Forget removes one. Records under keys no pool owns (Aurora's race, class, background and multiclass
      records, a build step's) always count. A held pick whose own requirements are false is flagged as an addition is.
      Measured first: 0 of the 826 sample picks is stale, over its pool or flagged, and the oracle is identical. Driven in
      the browser build (a Rogue 3 lowered to 2, a Wizard level moved to Rogue, a Rogue 4 improvement lowered); not on the
      phone or in the Tauri window.
- [x] **A pool's slots do not depend on the order they are picked in, and a pick that fits no slot is flagged.**
      *Buried in Phase 2's exit-criterion character item and its "Known gaps".* A pool's rules fill in level order, so an
      Arcane Trickster's any-school spell has to be taken before its enchantment and illusion ones or that slot is gone.
      And a pick recorded against the wrong rule is accepted in silence: 89 groups in the corpus mix rules that differ in
      `supports`, `requirements` or `type` (a wizard's first six spellbook entries are 1st level, later ones are not), and
      an import or an older save can hold one.
      **Done** ([ADR 0096](./docs/adr/0096-a-pick-counts-while-its-slot-exists-and-a-pool-s-slots-are-filled-as-a-matching.md)): picks are placed into a pool's rules as a matching (augmenting paths in record
      order), an open pool offers what any rule a further pick can reach would take, and a counted pick no rule offers is
      a `choice-unplaced` warning, marked on its slot, never refused. Measured: reversing every sample's records, the old
      fill would have misplaced 19 picks; the matching places all and nothing derived moves. Driven in the browser build: a
      2014 Arcane Trickster takes Charm Person first and is still offered Magic Missile.
- [x] **The 2024 Paladin and Ranger prepare as many spells as their table says, and a Wizard at least one.** *Buried in
      Phase 2's prepared spells item (ADR 0046), which said content does not carry the count; corrected by the
      maintainer:* both classes print a Prepared Spells column, level by level, in the Features table of their class
      description (`core/players-handbook-2024/classes/class-paladin.xml` and `class-ranger.xml` in AuroraLegacy), as
      prose rather than as a `…:spellcasting:prepare` stat, so both read a limit of 0 and anything prepared is over it.
      Aurora's app did not systematise it either. How Incudo reads it without parsing prose (ADR 0005), most likely as a
      table in the system definition beside the other numbers the book states, wants deciding first. The Wizard's
      minimum of one is the same item's smaller half.
      **Done** ([ADR 0097](./docs/adr/0097-a-2024-half-caster-s-prepared-count-is-its-spell-picks-and-an-added-spell-is-cast-through-a-block-the-user-names.md), decision A), and measured first it needed no table: content states the column as the
      allowance of each class's `Spell (Paladin)` / `Spell (Ranger)` select, equal to the printed column at all 20 levels
      (so do the 2024 Bard, Sorcerer, Warlock, Eldritch Knight and Arcane Trickster), and the builder already owed exactly
      that, with no prepared list, so nothing read a limit of 0. Their prepared spells are their picks, changed as any
      settled pick is. `prepared-counts.test.ts` holds the Paladin, Ranger, Wizard, Cleric and Druid to the columns typed
      from the book. A kind's preparation may now declare a `minimum`; 5e's is 1, for every preparing block (the 2014
      book's "minimum of one"). The oracle is identical. Driven in the browser build: a 2024 Paladin 5 owes 6 spells.
- [x] **Take the other hidden item families.** *Buried in the ADR 0072 item.* Aurora switches some things on by an
      `inventory-hidden` item: climb speeds, feat unlockers, Lycanthropy, the Companion and Familiar Selection items
      (Aurora Legacy Essentials' Companion Selection, equipped, opens 117 creatures), UA's additional ability score items.
      Incudo offers only the Tasha's optional class features this way, and a bag editor leaves hidden items out (ADR 0072
      decision 4), so the inventory item above will not offer the rest either. Each family is a declaration away and wants a look first (ADR 0072 decision 6).
      **Done** ([ADR 0089](./docs/adr/0089-the-other-hidden-item-families-are-two-more-equip-steps-and-a-player-character-s-sheet-shows-its-other-speeds.md)).
      Measured first (`hidden-items.test.ts`): 55 hidden items outside Tasha's, 35 "Additional Feature" and 12 "Additional
      Ability Score Improvement" switches whose grants are all unconditional, and 8 2024 mounts with no rules; no sample
      carries one; each equipped on a fresh character derives as it says. Two things did not show: the climb, swim and fly
      items move `innate speed:<mode>`, which the player character's sheet never showed (nor a Tabaxi's climb), and the
      multiclass unlocker works only through the classes' `<multiclass>` blocks (`… || marker`), where with it no score is
      flagged. 5e now declares two more equip steps, "Additional features" and "Ability score adjustments", by category,
      and the player character derives `speed:burrow`, `:climb`, `:fly` and `:swim` as walking speed is and shows them under
      Other Speeds. The mounts are goods, offered by no step and left to the inventory editor. No engine change; the oracle is
      identical; one sample (a 2024 Thief) shows a climbing speed. Driven in the browser build and in the Tauri window on Windows (2026-10-20) (a Wizard
      taking Fly +5 Feet, its Sheet's Other Speeds reading Fly 5); not on the phone.
- [x] **Say which switched-off source would supply what is missing.** *Buried in the ADR 0052 item.* A source's line
      says how many things it refers to that no enabled source has, never that a source the user configured and switched
      off declares them. A disabled source is not loaded, so this needs a record of what each source declared, kept from
      its last load.
      **Done** ([ADR 0090](./docs/adr/0090-a-switched-off-source-is-named-for-what-it-declared-at-its-last-load.md)).
      Measured first (`switched-off-sources.test.ts`, AuroraLegacy's indexes as separate sources): the 2014 Player's
      Handbook alone misses 110 ids and Core has all of them; Tasha's alone misses 181, Core has all and the Player's
      Handbook index 123 (Core lists it); the upstream typo is in no source. Each successful load now keeps the ids a
      source's files declare, with the parts it had switched off, under `sources/declared/` (not the cache, which a refresh
      prunes), written only when it changes. A line that misses something names each switched-off source whose record,
      made with its current parts, has some of it: "Core, which is switched off, had all of them when it was last loaded."
      Never enforced, never a guess. Found on the way: a source loaded after one holding the same files reads none of them,
      so the record walks the indexes rather than counting what the load read. Driven in the browser build; not in the
      Tauri window, on the phone (which shows no missing content yet *(in Beyond 1.0's "Left from Phases 3 to 5" since 2026-10-12)*) or on macOS and Linux. Seen and not fixed: two quick
      toggles start two desktop reloads, and the slower first can finish last *(an open item at the end of this phase since 2026-10-12)*.
- [x] **Mark an offer whose proficiency the character already has** (the maintainer's request, 2026-10-05). When a
      candidate in a build step (a background, say) would grant a proficiency the character already has from another
      choice (an Elf's Perception), the picker marks it, so the player sees what is redundant before choosing. A pool's
      own candidates already leave out what the character holds; this is about what a candidate grants in turn. Whether
      the replacement proficiency the 2014 rules allow is then offered is a separate question.
      **Done** ([ADR 0091](./docs/adr/0091-an-offer-that-would-give-what-the-character-already-has-is-marked-and-the-system-says-which-types.md)).
      Measured first (`candidate-overlaps.test.ts`, every decision of the thirty samples): what an offered candidate would
      give again is mostly proficiencies (3,548), then sizes, internal markers, languages (209), spells and senses. A kind
      now declares which types are worth naming (`candidateOverlaps`; 5e's player character: Proficiency and Language),
      and the picker shows "The character already has Perception" under such a candidate, on the desktop and the phone. The
      walk follows a candidate's grants through content, gated by level and by requirements read against the character
      (203 overlaps exist only if requirements are ignored, nearly all Tasha's customised origin); a settled slot is judged
      without its own answer. A fresh 2014 Elf sees 13 of 118 backgrounds marked. Display only. Driven in the browser build
      and in the Tauri window on Windows (2026-10-20) (a Fighter / Rogue's Criminal background marked for Thieves' tools); not on the phone. Still open: the 2014 replacement proficiency *(an open item at the end of this phase since 2026-10-12)*.

*The items below were found on 2026-10-12 by sorting every note the ticked items of Phases 3 to 5 left open. The
maintainer chose which come before 1.0; the rest are in Beyond 1.0's "1.x — Left from Phases 3 to 5", and each note
points to where it went.*

- [x] **Two quick source toggles cannot leave the wrong content loaded.** *From the ADR 0090 item.* Each toggle on the
      Sources pane starts a reload of the desktop's content, and nothing stops an earlier, slower load finishing after a
      later one: its content is then the one in use, with the source switched last in the wrong state, and the first
      load to finish says the pane is idle while the other still runs.
      **Done** (2026-10-12): the phone's `ContentSources.load` had the same shape. A load now publishes only when the
      sources it loaded are still the ones switched on when it ends, and "loading" ends when one publishes or the last
      one running ends (`SourceLoads`, `packages/ui/src/source-loads.ts`, used by both shells); a phone load that does not
      publish hands its caller the current sources' load. Not "the load begun last": switching a source off and on again
      makes an earlier set current again. No format change, no ADR (nothing to reverse). Driven in the browser build: two
      to five switches of two sources within a fifth of a second, each ending with exactly the switched-on sources'
      content loaded and the pane idle.
- [x] **Every class and background whose book lists starting equipment offers it.** *From the ADR 0087 item.*
      `systems/dnd5e/starting-equipment.json` covers the two Player's Handbooks (24 classes, 29 backgrounds). Anything a
      book lists as starting equipment belongs there too (the maintainer's call, 2026-10-12: it is the book's own text,
      not a new mechanic): the Artificer in Eberron and Tasha's, and the backgrounds of the other books. Measured first:
      which classes and backgrounds in the corpus write starting equipment, and in what shape.
      **Done** (2026-10-12, ADR 0087's note): measured, 5 classes and 89 backgrounds were missing, every one a list of the
      shapes the file already has. Added from each book's list: the four Artificers and the Unearthed Arcana Mystic, 88
      backgrounds from 27 books, and the 2024 Dungeon Master's Guide's custom background as 50 gp to spend. The 2014
      custom background lists nothing of its own and is left out. 382 ids, all declared in the corpus. Driven in the
      browser build: a Tasha's Artificer with two chosen simple weapons and studded leather, and a Sword Coast Clan
      Crafter with smith's tools and 5 gp.
- [x] **The 2014 replacement proficiency.** *From the ADR 0091 item.* **Not built, by the maintainer's call
      (2026-10-12):** a player whose DM allows a replacement adds the proficiency under "Added to this character" (ADR
      0064). Incudo does not make up mechanics for D&D.

**Closed 2026-10-12.** The phase had no exit criteria of its own; it closed when nothing before 1.0 was left in it. Every
note its items left open was sorted with the maintainer: the two kept before 1.0 are done above, the rest are in Beyond
1.0's "Left from Phases 3 to 5" and "Finding and choosing content", and what was only not driven in the Tauri window or on
the phone is Phase 9's drive item. "Not on macOS or Linux" notes are Beyond 1.0's "macOS, Linux and iOS".

---

## Phase 4 — More than one kind of character ✅

*The first real use of [ADR 0009](./docs/adr/0009-character-kinds.md). Also the first proof that
the kind machinery is not decorative.*

- [x] **NPC / monster kind for 5e: stat block, challenge rating instead of level**
      ([ADR 0057](./docs/adr/0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md)). Measured first, and the measurement changed the fix: the corpus states a creature as
      a `Companion` element (141 of them, from 23 books) that prints its six ability scores as setters and nowhere
      else, and its armour class, hit points and speed a second time as its own `companion:*` rules. A kind may
      now declare `setterStats`, a held element's setter that is where a stat *starts*: a score the DM types
      replaces it, and content adds to either. The 5e NPC reads the six scores that way and armour class, hit
      points and speed from the creature's rules; its ability score step is a manual-only budget, closed by a
      creature and blocking for an NPC built from nothing; traits and actions are sets. The library starts any kind
      the system declares, and a card says "NPC / Monster · Challenge Rating 5". Running the real corpus through it
      found that the six ability stats carried a player character's cap of 20, which clipped the Triceratops and
      the Tyrannosaurus; the NPC's are capped at 30. All 141 creatures derive the scores they print; no player
      character derivation moved. Driven in the browser build. **Not done:** a creature's own named traits and
      actions (its `traits`/`actions` setters) do not reach the NPC, the printed challenge rating is shown and
      not read, an NPC built from nothing cannot set armour class, hit points or speed, and skills, saves, senses
      and other speeds are not on the sheet. The Tauri window, macOS and Linux were not driven. *(The first of
      these was closed by ADR 0058, the next item; the second and third by ADRs 0060 and 0059, two items on.)*
- [x] **A creature's own traits and actions reach the NPC it starts**
      ([ADR 0058](./docs/adr/0058-a-setter-may-name-elements-its-holder-has-and-the-kind-says-which.md)). A creature
      names them as ids in its `traits`, `actions` and `reactions` setters and grants none. A kind may now declare
      `setterGrants`, a setter on some element types whose ids the holder is granted as a `<grant>` would be; per
      setter, because 212 item `proficiency` setters also name ids and are not grants. One function feeds the
      derivation and the save's content, so a Triceratops NPC has Trampling Charge, Gore and Stomp and keeps them when
      reopened with no source; all 373 resolving ids reach their NPC, and the 3 upstream typos are reported. The player
      character declares none. A set step no longer offers what the character already holds. Driven in the browser
      build. **Not done:** a granted trait cannot be removed from an NPC; the Tauri window, macOS and Linux.
      *(The first of these was closed by ADR 0061, below.)*
- [x] **An NPC's challenge rating, armour class, hit points and speed start where its creature states them, and
      what the creature gives can be taken away** ([ADR 0059](./docs/adr/0059-a-stat-may-start-where-another-stat-is-and-a-typed-value-replaces-it.md),
      [ADR 0060](./docs/adr/0060-a-character-may-leave-its-progression-to-what-it-chose-and-that-is-format-3.md),
      [ADR 0061](./docs/adr/0061-what-a-creature-gives-may-be-removed-from-its-npc-as-a-recorded-input.md)). The three
      gaps the two items above left. A stat may declare `startsFrom`, another stat that is where it starts: the NPC's
      armour class, hit points and speed start at the creature's own rules, a value the DM types replaces them, and an
      NPC from nothing enters all three from 0 with no maximum (the Tarrasque's 697 hit points fit). A character may
      leave `progress` out, and then starts where the creature it chose prints it: 121 of 141 creatures print a rating
      as a number and start there, the Triceratops and the Tyrannosaurus Rex now at +3 proficiency, and a typed rating
      replaces the print. A DM may remove a trait, action or reaction the creature gives (`removedGrants`), including
      the twelve a creature also grants by its own rule; a removed one is neither derived nor saved, and can be given
      back. Leaving `progress` out or recording a removal is **character format 3**, and only those characters move to
      it: a reader of 2 would get them wrong without a word, and gets every other character right. No player character
      derivation moved. Driven in the browser build. **Not done:** speeds other than walking, senses, skills and saves on
      the sheet; the Tauri window, macOS and Linux. *(The first of these was closed by ADR 0062, the next item.)*
- [x] **An NPC's other speeds, saving throws and skills are on its sheet, and its senses, defences and languages as
      its creature prints them** ([ADR 0062](./docs/adr/0062-an-npc-s-other-speeds-saves-and-skills-are-its-creature-s-rules-and-its-senses-are-what-it-prints.md)).
      Measured first: a creature states its fly, climb, swim and burrow speeds (43, 23, 22 and 5 creatures), its skill
      proficiencies (77) and its save proficiencies (16) as its own rules, written against a proficiency bonus Aurora's
      app supplies, and states no sense as a rule at all (113 print one). The NPC now supplies that bonus from its
      challenge rating and publishes each rule under the name a character's content uses (`speed:fly`, `perception`,
      `dexterity:save`, `perception:passive`), starting where the creature's rule is, so a typed value replaces it. A
      sheet section may show only the rows that apply (`showWhen`: a stat block lists the skills a creature is
      proficient in, not eighteen) and text a held element prints (`printed`), shown as written and never parsed.
      Derived and compared with the print: other speeds 91 agree and 0 differ, skills 113 and 1, saves 8 and 2. No
      player character derivation moved. Driven in the browser build, including a save reopened with no source.
      **Not done:** senses as numbers (content states none), an editor for the other speeds and proficiencies, and a
      fly speed's hover *(an open item at the end of this phase since 2026-10-12)*; the Tauri window, macOS and Linux. *(The editor was answered by ADR 0063, the next item, except
      switching a proficiency on: an open item at the end of this phase since 2026-10-05, done by ADR 0094.)*
- [x] **A DM may write a feature of an NPC's own that adds to or sets its numbers**
      ([ADR 0063](./docs/adr/0063-a-character-may-carry-features-its-user-writes-which-add-to-a-stat-or-set-where-it-starts.md)). Typing a number (ADR 0059)
      gives it no reason; a feature does: "Godspeed", Speed set to 60, listed with the creature's traits and saved with
      the character. Each line adds to a stat, as content does, or sets where it starts, replacing what the creature
      states, with what the NPC holds still adding to it. A typed value still wins, and the entry step, the feature's
      line and the problems list each say what it replaced; clearing it gives the feature's back. A line may name what
      the NPC's sheet shows, grouped as the sheet groups it: running the first version offered spell slots and item
      slots, and "Strength" twice. Only a character with one moves to **character format 4**. Every creature in the
      corpus takes one and keeps it through a save opened with no source; no player character derivation moved. Driven
      in the browser build. A feature never names an ability score, for any kind: the scores have their own editor.
      **Not done:** ~~reusing a feature on another character~~ (Phase 8, done by ADR 0106), ~~features
      for a player character~~ (whose armour class, hit points and speed are worked out, so a feature could only add to
      them; an open item at the end of this phase since 2026-10-05, done by ADR 0094), conditions or grants
      on one *(in Beyond 1.0's "Left from Phases 3 to 5" since 2026-10-12)*; the Tauri window, macOS and Linux.
- [x] **A DM or player may put existing content on a character, whatever its prerequisites**
      ([ADR 0064](./docs/adr/0064-a-character-may-carry-elements-its-user-adds-from-loaded-content-and-an-unmet-prerequisite-is-a-flag.md)).
      ADR 0063's sibling: an element a source declares rather than one the user writes. Aurora's users wrapped these
      in homemade items; here the Build pane has **Added to this character**, a type filter and a search over every
      feat, racial trait, class and subclass feature, background feature, proficiency, language, condition and spell
      loaded, for the player character and the NPC alike. Measured first: 249 of 320 feats carry requirements, so a set
      step, which offers only what the character qualifies for, would have offered a DM almost none. What is added is
      held and saved with the character; one whose prerequisites fail is kept and **marked**, on its row, on the sheet
      and as a reported problem (the engine's `requirement-unmet`, declared since the start and never emitted until
      now), never refused. Removing one takes off the answers to the choices it opened. The additions are a list of
      their own and not a recorded choice, so nothing that finds a race or a first class by what a record holds can
      mistake one. Only a character with one moves to **character format 5**. The NPC's sheet gained Feats and Features
      and Proficiencies and Conditions. Every element of the nine types in the corpus is offered, held once added,
      flagged exactly when its own requirements fail, and survives a save opened with no source; no player character
      derivation moved. Driven in the browser build. **Not done:** ~~casting for an added spell~~ (it belonged to no class;
      an open item at the end of this phase since 2026-10-05, done by ADR 0097), conditions in the rules' sense (the corpus's 23 `Condition` elements are damage
      resistances and immunities, and there is no Blinded to add), reuse across characters (Phase 8); the Tauri window,
      macOS and Linux.
- [x] **Decide where legendary content comes from, before any UI for it**
      ([ADR 0065](./docs/adr/0065-legendary-content-is-content-of-the-types-the-system-declares-and-a-dm-may-write-it-on-the-creature.md)).
      *Reworded by ADR 0057's measurement;* was "Legendary creature kind: legendary actions, lair actions, regional
      effects". Measured again first, as a test: the corpus declares nothing of the three types, names none by a setter
      or a grant, and has them only as prose, seven 2025 stat blocks with a Legendary Actions heading, none with a lair
      or regional one, none printing a cost, each printing three uses. Decided: a legendary action is an element of the
      type the system declares, with no format of its own, and it comes from a **user's own Aurora file** (ADR 0056:
      reusable, and a creature in the file grants its own) or from a **feature the DM writes on the creature**, which
      may now be listed under any heading its kind names: an NPC's under Traits, Actions or Reactions, a legendary
      creature's also under Legendary Actions, Lair Actions or Regional Effects. Only a feature listed away from the
      default moves its character to **format 6**. No cost field: the name carries one as a book prints it. **Legendary
      Action Uses** is a number on the sheet, 3 unless a feature changes it ("Lair: +1"). The two steps are sets now:
      as optional single picks they had offered nothing, not three empty pickers. No player character derivation moved.
      Driven in the browser build, with a homebrew file dropped on the Sources pane and the creature reopened with no
      source. **Not done:** an NPC's sheet lists none of the legendary content a creature it is built on grants (the
      legendary kind is for that creature); reusing a written legendary action (Phase 8); play-time tracking of uses;
      the Tauri window, macOS and Linux. *(Closed the same day, below, except reuse, play and macOS and Linux. Reuse is
      ADR 0106's feature library, which keeps a written feature's type; play is ADR 0084's, whose legendary creature
      tracks its Legendary Action Uses.)*
- [x] **What ADR 0065 left open** (its decision 7 and evidence). An NPC built on a creature that grants legendary
      content now lists it, under the legendary creature's two headings, each saying that setting how many it takes a
      round, or adding more, is a Legendary Creature's; an NPC whose creature grants none shows neither. The test that
      only reported it now asserts it. Driven in the browser build: an NPC's own action and reaction, listed and kept
      through a save opened with no source, and a hand-edited feature of a type the NPC cannot hold, which now reads
      "Legendary Actions (not available)" rather than the type's own name, changes nothing, and is repaired by choosing
      a heading. Doing so found that **opening a library file did not show it** when the character on screen had the
      same id (the builder kept its own copy); fixed. The kind's description, a tooltip nothing showed, is now a line
      under the Characters header. **Driven in the Tauri window on Windows**, for the first time for ADR 0056's file
      sources too: a real OS drop added the homebrew file, "Choose files…" replaced it through the native dialog, and a
      Legendary Creature with a taken and a written legendary action and a "Lair" adding one use read the same sheet
      after a reload with the source off. **With this, the phase's exit criterion holds**: a PC, an NPC and a
      legendary creature are built in one app, and the engine names none of them (only comments do). The items below
      are still open. **Not done:** removing a creature's own `<grant>`s from its NPC (ADR 0061 cancels what a setter
      names); macOS and Linux. *(A draft reloaded with no source enabled lost its file's embedded content, and the next
      Save wrote a second file embedding none of it; fixed by ADR 0066. The grants, by ADR 0067, the next item.)*
- [x] **What a creature grants can be removed from its NPC, like what it names**
      ([ADR 0067](./docs/adr/0067-what-a-creature-grants-may-be-removed-like-what-it-names-and-only-a-holder-s-gifts-are.md),
      amending ADR 0061). An element the kind's `setterGrants` reads (a creature) is a *holder*, and everything it gives
      is removable: what its setters name and what its own `<grant>`s give, whatever the type. So an NPC or Legendary
      Creature on a user's homebrew creature can lose the legendary action, lair action or regional effect the creature
      grants, and an NPC lists them under the sheet's headings, since it offers no step for them. Nothing that is not a
      holder gives anything removable: the player character has none, so a class's features stay content's, even
      against a hand-edited `removedGrants`. Measured: in the official corpus every creature grant is already named by
      its setter (12 of 12), so no corpus NPC changes. No player character derivation moved. Driven in the browser
      build and in the Tauri window on Windows (a native file dialog, a real file on disk read back, reopened with the
      source off); running it made two removals opened with no source read as one line rather than two. **Not done:**
      macOS and Linux.
- [x] **Show each creature a character holds as its own stat block, with numbers derived from the character**
      ([ADR 0073](./docs/adr/0073-a-creature-a-character-holds-is-derived-one-at-a-time-in-its-holder-s-namespace-and-shown-as-its-own-stat-block.md)).
      *Split from "Companions and sidekicks" by its measurement;* sidekicks are the next item. Measured first, as a
      test: content writes a held creature's numbers in its holder's derivation, in one `companion:` namespace, reading
      the holder (a Steel Defender's hit points, a class level) and added to by the holder's own features (Ranger's
      Companion, Improved Defender); it never publishes the six scores (setters only), and supplies no proficiency bonus
      for 129 of 141 creatures, so a held Owl was proficient in nothing. It assumes one creature, as Aurora's app does
      ("a limitation of the app", in content), and only 4 of the 26 creature selects keep a character to one: a Battle
      Smith with the Homunculus Servant infusion holds two, and they summed (armour class 28 where they are 13 and 15).
      So each held creature is **derived in a scope of its own**: the character with the other creatures left out, plus
      what the kind's new `companions` declaration adds (5e's player character: the six scores from the print,
      modifiers, a proficiency bonus of 2, saves, skills, passive Perception, and the traits, actions and reactions it
      names, held in its scope and never by the character). The Sheet shows each after the character's own sections,
      with what gave it. The character's own derivation is unchanged, so no player character derivation and no oracle
      row moved; no character format change. Aurora records a companion block in every save: the four samples holding
      the 2014 Owl agree with it on every score, save and skill. Running it found the proficiency bonus's bucket: 11 of
      the 12 class summons that supply their own read their holder's bonus. Driven in the browser build and in the
      Tauri window on Windows, the saved file read back from disk and reopened with the source off. **Not done:** which
      creature a holder's feature is for when two are held (Improved Defender's +2 applies to both) *(an open item at the end of this phase since 2026-10-12)*; the Eberron
      homunculus's bonus row (+2 over, upstream's content); a creature's challenge rating for its bonus (two
      creatures above challenge 4) *(an open item at the end of this phase since 2026-10-12)*; ~~a creature's attack bonus~~ (`companion:attack` is shown as what its
      holder adds since ADR 0093; its actions' own numbers are prose); tracking a creature's hit points *(in Beyond 1.0's "Left from Phases 3 to 5" since 2026-10-12)*;
      macOS and Linux.
- [x] **Sidekicks: an NPC serves as one**
      ([ADR 0121](./docs/adr/0121-an-npc-serves-as-a-sidekick-and-the-sidekick-kind-is-removed.md), superseding
      [ADR 0118](./docs/adr/0118-a-sidekick-is-a-character-of-its-own-built-on-a-creature-and-levelled-in-a-sidekick-class.md)).
      *Split from "Companions and sidekicks" by ADR 0073's measurement.* ADR 0118 built a sidekick kind levelled in a
      `Sidekick Class`, and it was removed on 2026-10-17 (the maintainer's call): no sidekick class content exists anywhere
      a user has it (AuroraLegacy has none, and the rules are not SRD, so Incudo cannot ship them), so the kind only worked
      for a user writing their own file. An NPC already covers a sidekick: its creature's print is where it starts, any
      feature, feat, proficiency or spell is added through Additions whatever its prerequisites, the DM writes features of
      its own, hit points and armour class are typed, and its proficiency bonus follows the challenge rating the DM types.
      The kind's four system-format additions went with it. Letting an NPC be built on a race as well as a creature is the
      next item.
- [x] **An NPC may be built on a race**
      ([ADR 0122](./docs/adr/0122-an-npc-may-be-built-on-a-race-and-a-race-s-speed-is-where-its-speed-starts.md)). The
      maintainer's ruling after a UX pass found no goblin among the NPC's creatures: the official content writes only beasts,
      familiars and summons as creatures. Measured first, as a test, by building each of the 139 races as an NPC and as a
      player character: a race recorded on an NPC already derived its increases, traits, languages, proficiencies and
      selects, but nothing offered one, its speed read 0, and its vision, size and the race itself were on no sheet. The NPC
      and the legendary creature now have a Race step beside the Creature step (both skippable); a race's increases add to
      the printed or typed scores; its speeds are where the NPC's speeds start while no creature is held (a gated kind
      contribution to `companion:speed`, no engine change), and a typed speed replaces them; Creature lists the race,
      subrace and size and Senses its vision. With a creature as well, the creature's speed is used. Proficiency still
      follows challenge rating. Every race derives the player character's six scores and five speeds and reopens with no
      source to the same sheet. **Not done:** a race's per-level numbers (a breath weapon's dice, Dwarven Toughness) read 0
      on an NPC, which has no level; natural armour is typed. Driven in the browser build.
- [x] **Show the 2025 Monster Manual's prose stat blocks as a reference beside an NPC**
      ([ADR 0068](./docs/adr/0068-a-character-may-keep-content-beside-it-as-a-reference-shown-and-embedded-and-never-held.md)).
      *Reworded by ADR 0057's measurement;* was "Wire up the 2025 Monster Manual creature content already in the
      corpus". Measured first, as a test: 63 descriptions print a stat block (the book's 45, 16 summons from the 2024
      Player's Handbook, 2 from the 2024 Dungeon Master's Guide), all of type `Information`, which also holds 53 texts
      that are not stat blocks; nothing but the prose sets one apart, and nothing links one to a structured creature
      (8 share a name). So nothing recognises a stat block: an NPC or legendary creature may **keep content beside it
      for reference**, any element of the types its kind lists (5e: `Information`, 116 of them, searched by name). A
      reference is shown on the Build pane beside the decisions where its numbers are entered, and after the Sheet,
      and saved with the character so it shows with no source; it is **never held**, so nothing derives from it. Only
      a character that keeps one moves to **character format 7**. Running it found that an NPC built from nothing,
      the ordinary case beside a prose block, could never be finished: its Creature decision was required and nothing
      could answer it. A build step may now be a **pick that can be skipped** (`pick`), and the two Creature steps
      are. A library card said "1 elements embedded"; fixed. No player character derivation moved. Driven in the
      browser build and in the Tauri window on Windows, the saved file read back from disk and reopened with the
      source off. **Not done:** ~~content embeds all 63 stat blocks in other descriptions (a summoning spell's, a
      scroll's) with `<div element>`, and Incudo shows nothing there~~ (the next item); ~~references for a player
      character~~ and ~~a library card naming what is kept~~ (ADR 0070, below); macOS and Linux.
- [x] **Show what a description embeds, and save it with the character**
      ([ADR 0069](./docs/adr/0069-what-a-description-embeds-is-shown-in-place-and-a-save-carries-it-for-its-text.md)).
      Found by the item above. Content writes `<div element="…" />` where another element's text belongs, 3,202 times
      in 1,273 descriptions: a subclass's features, a class's, a 2024 background's feat, a summoning spell's creature,
      a scroll's stat block. Measured first, as a test: every one in one shape, 3,200 resolving, two levels deep at
      most, none circular, and **no embedder writes the embedded element's name**, so it is shown as a heading over
      its text wherever a description is (Browse, a picker's preview and its dock, a kept reference), with a sentence
      where it names nothing loaded, closes a circle or nests too deep. A save carries the embedded elements **for
      their text only**, not their rules: 23 more across the thirty samples, in 16 of them, every embed in the saved
      descriptions resolving with no source. No derivation moved. Running it found two more: five markers sit inside
      XML comments (content switching an embed off), which the first reader counted; and every prose stat block
      rendered inside its own opening `<h4 />`, which an HTML parser leaves open, since ADR 0068 showed the first.
      Driven in the browser build. **Not done:** searching embedded text, linking an embed to its element *(in Beyond 1.0's "Left from Phases 3 to 5" since 2026-10-12)*, saves
      written before this (they carry what they reached); the Tauri window, macOS and Linux.
- [x] **Let a player character keep text for reference, and say on a library card what a character keeps**
      ([ADR 0070](./docs/adr/0070-a-player-character-keeps-text-for-reference-and-a-creature-it-holds-is-not-a-reference.md)).
      ADR 0068 left the player character keeping nothing. Measured first, as a test: a player character's own
      elements print 113 of the 116 `Information` elements (summoning spells, the 2024 Beast Master, scrolls and
      items), and 100 of those 116 are stat blocks once plain table cells are counted (ADR 0068's bold-cell count was
      63); Wild Shape prints and selects none. So the player character keeps `Information` too, and **what its own
      elements print is suggested first**, with what prints it ("Bestial Spirit, in Summon Beast"), read with the
      embed reader of ADR 0069 and recorded nowhere, the same with no source. **A structured creature is not a
      reference**: the player character already holds one where content gives one, 29 of them scale with their
      holder, and most carry no text (shown as held since ADR 0073, above). A library card names what a character keeps
      ("For reference: Kraken, Rat, Bat and 1 more"). No player character derivation moved. Driven in the browser build
      and in the Tauri window on Windows, the saved file read back from disk and reopened with the source off.
      **Not done:** ~~a held creature on the sheet~~ (ADR 0073, above); a 2014 druid's Wild Shape forms (structured beasts only; the tier
      the druid is at, *(an open item at the end of this phase since 2026-10-12)*); a held element's own text on the Sheet (Phase 5's open item, 2026-10-12); macOS and Linux.
- [x] **Each kind's sheet shows its printed page, and every row says what it is**
      ([ADR 0074](./docs/adr/0074-a-kind-s-sheet-shows-its-printed-page-and-every-row-says-what-it-is.md)).
      *Reworded by its measurement;* was "Kind-specific sheets and exports". Every kind already drew its sheet from its
      own declaration, so the question was what each one leaves out. Measured first, as a test, the sheet as the pane drew
      it: the Spell Slots section read the multiclass pool, which only a multiclass caster has, so **every single-class
      caster's sheet said it had no spell slots** (13 of the 30 samples, and 23 read nothing but zeros); each casting
      block's two rows were labelled with their internal keys; a player character's derivation held 153 skill and 60 save
      proficiencies and no row showed a save, a skill, passive Perception or a modifier; race, class and background were
      listed nowhere; no creature's size, type, alignment or printed armour class and hit points were shown; and Cairn's
      scores could not be set at all. **Exports are Phase 5's**: an export renders the sheet, so the sheet is now a view
      (`packages/ui`) that the Sheet pane, a held creature's stat block and a future export share. Three optional fields
      in the system format: a stat may be `signed` (+2), a block stat may carry a `label`, a section may show a stat
      `beside` each row ("18 (+4)"). 5e's player character now shows its first page, saves and skills worked from
      Aurora's own list of each sample's elements agreeing on all 682 rows the book decides alone, and the spell slots it
      casts with (the pool, a block's own table, pact magic beside a pool: all 20 casting samples exact); its NPC names its
      creature and prints its first line and its dice; Cairn's scores and Hit Protection are entered, and its sheet names
      the background. No oracle row moved; no character format change. Running it found the order a section lists
      things in, and a 5e sentence under Cairn's score editor. Driven in the browser build and in the Tauri window on
      Windows, saved files reopened with the source off. **Not done:** ~~a mark on the saves and skills a character is
      proficient in; levels per class on the sheet ("Wizard 4 / Rogue 4"); hit dice~~ (Phase 5, ADR 0079 decisions 6, 7
      and 9), ~~death saves, inspiration~~ (tracked in play since ADR 0084, Phase 6),
      ~~personality~~ (ADR 0092) and ~~attacks~~ (ADR 0093); ~~reading content's `<sheet>` hints~~ (done in Phase 5, ADR 0076); ~~a
      stat block laid out as a stat block~~ (ADR 0126, 2026-10-28); the "Progress" number a level-less Cairn character is shown on Build *(in Beyond 1.0's "Left from Phases 3 to 5" since 2026-10-12)*; Cairn in
      the Tauri window; macOS and Linux. *(Personality and attacks: open items at the end of this phase since
      2026-10-05.)*

*The items below were found on 2026-10-05 by the audit described at the end of Phase 3, buried in this phase's ticked
items; each keeps its original text with a pointer here.*

- [x] **Personality, appearance, backstory and notes can be written.** *Buried in the ADR 0074 item ("personality"),
      and in Phase 5's text export (ADR 0075) and PDF (ADR 0079 decision 4) items.* `Character.freeform` holds them, and
      an Aurora import fills it, but nothing in either app writes it, so a character built in Incudo has none; the Sheet,
      the text export and the official form's boxes leave them blank. An editor in both shells, and whether and where the
      Sheet and the exports then show them.
      **Done** ([ADR 0092](./docs/adr/0092-a-kind-declares-the-text-a-user-writes-about-a-character-and-every-sheet-shows-it.md)).
      Measured first (`freeform-fields.test.ts`): Aurora writes one vocabulary into every save, filled or not, and the
      samples carry backstory and the four personality lines on 18 of 30, coins and experience on all. A kind now declares
      the fields a user may write (`freeform` in the system format), each by the key the importer already uses, so an
      imported character's text appears with no change to the frozen importer: 5e's player character has 21 in four groups
      (player, appearance, personality and story, notes), its NPC a description and notes, Cairn's character three. Writing
      re-derives nothing and changes no format. Everything written is on the Sheet, the print (a part the step can leave
      out), the text export and the phone's sheet, and fifteen of the 2014 form's boxes; a key no field declares (coins,
      experience, attack notes) still shows nowhere, which ADR 0075's check now holds both ways. Driven in the browser build
      and on the phone emulator, where it found the phone's sheet leaving the part out, and in the Tauri window on Windows (2026-10-20) (typed with real keys, on
      the Sheet, the text export and the official form).
      Two suggested personality traits overflow the form's box at 7 pt on 9 samples and are named as running past it.
- [x] **Attacks on the sheet.** *Buried in the ADR 0074 item ("attacks") and the ADR 0073 item.* A character's sheet
      has no attacks section (a weapon's attack bonus and damage), and a held creature's `companion:attack` and
      `companion:damage`, which content writes (the Ranger's Companion), are read by nothing.
      **Done** ([ADR 0093](./docs/adr/0093-an-attack-is-a-weapon-in-the-bag-and-the-kind-declares-what-it-adds-up.md)).
      Measured first (`attacks.test.ts`): every one of the corpus's 97 weapons writes a damage die and names its
      proficiency, what kind of weapon it is is a support tag (the 2014 properties name no element), a magic weapon is an
      adorner with an `enhancement` setter, and content adds `ranged:attack` and weapon-named stats (`longsword:attack`,
      Bracers of Archery's `longbow:damage`). Aurora writes a row for every weapon in the bag, carried too, and all eight
      in the samples agree with the book. A kind now declares its attacks (`attacks` in the system format): the types an
      attack is an entry of, and what it adds up, as contributions in a scope of its own after the derivation settles, its
      weapon's tags and setters readable there. No stat of the character moves; the oracle is identical. 5e's player
      character has an Attacks section ("Longsword: +6, 1d8+3 slashing (two-handed 1d10+3 slashing; Versatile)") on the
      Sheet, the print, the text export and the phone's sheet, the 2014 form's three weapon rows are its first three
      attacks, and a held creature's stat block shows what its holder adds to its attack and damage rolls. A save carries the weapon properties its attacks are named by. Driven in the browser build with
      no source, and in the Tauri window on Windows (2026-10-20); not on the phone. Not done: unarmed strikes and martial arts, spell attacks as
      rows, two-weapon fighting and Dueling (commented out upstream), a melee weapon's reach as a distance, rewriting a
      creature's actions with its holder's bonus *(an open item at the end of this phase since 2026-10-12)*.
- [x] **An added spell can be cast.** *Buried in the ADR 0064 item.* A spell put on a character through "Added to this
      character" belongs to no casting block: no save DC, no attack bonus, no slots, not preparable, and the pane says
      so. Which block it is cast through (the user's choice, or the character's only one) wants deciding.
      **Done** ([ADR 0097](./docs/adr/0097-a-2024-half-caster-s-prepared-count-is-its-spell-picks-and-an-added-spell-is-cast-through-a-block-the-user-names.md), decision B). The user chooses ("Cast as" on the added row, desktop and phone), and the
      character's only class is chosen when the spell is added; the choice is recorded (`Character.additionBlocks`,
      character format 10 only when recorded), so a class taken later never moves it. On a class that prepares, the
      spell is always prepared and counts against nothing; a recorded class the character no longer has is a warning and
      casts through none. The Sheet, print, text export and phone read "Fireball (Level 3, always prepared, cast as
      Cleric)", beside that class's DC, attack and slots. A save carries the class, so it reads the same with no source.
      The oracle is identical. Driven in the browser build (a 2024 Paladin, then Cleric) and in the Tauri window on Windows (2026-10-20) (a 2014 Wizard's
      Cure Wounds); not on the phone.
- [x] **Written features for a player character, and an NPC's proficiency switched on.**
      **[ADR 0094](./docs/adr/0094-a-player-character-s-written-features-only-add-and-a-feature-line-may-mark-a-row.md),
      accepted 2026-10-06**, measured first. The maintainer's calls: a player character carries written features, and
      they only add (the 34 numbers its sheet offers all derive), held as a Class Feature, Racial Trait, Feat or Background
      Feature, all listed under Features & Traits; a DM makes an NPC proficient through a feature line; and the NPC's
      sheet marks its saves and skills as the player character's does ("Stealth +7 (expertise)"). A feature line may now
      **mark** a row whose section declares a mark, when the kind declares the stat the mark is read from: it sets where
      that stat starts as so many proficiency bonuses, so "Athletics: proficient" follows the challenge rating, and "not
      proficient" takes a printed one away (character format 9). Measured: all 300 saves and skills the 141 creatures show
      hold a whole number of the NPC's bonus. No player character derivation moved; the oracle is identical. Driven in the
      browser build (a Wolf NPC and a Human Fighter), and in the Tauri window on Windows (2026-10-20) the NPC's marks only ("Perception +3 (proficient)"); not on
      the phone. Not done: a mark on a held
      creature's stat block *(an open item at the end of this phase since 2026-10-12)*.

*The items below were found on 2026-10-12 by the sorting described at the end of Phase 3. The maintainer chose them for
before 1.0.*

- [x] **Every speed a creature prints is on its sheet as printed, hover included.** *From the ADR 0062 item.* A
      creature's speeds are shown as numbers its rules give (Speed 30, Fly Speed 30), and the line it prints, "30 ft., fly
      30 ft. (hover)", is shown nowhere, so a hovering creature reads as any flier. Four structured creatures print
      "(hover)": the Wildfire Spirit, its Unearthed Arcana version, the Inkling Mascot and the Puppeteer Parasite. The
      maintainer's call (2026-10-12): every speed a stat block declares (walking, burrowing, climbing, swimming, flying,
      hovering) is printed explicitly, on an NPC's sheet and a held creature's stat block, as armour class and hit points
      already are; a speed the block does not declare is not shown, and what hovering does in play is the DM's.
      **Done** (2026-10-12): measured, all 141 creatures print a speed line, 4 with "(hover)", 3 swimming only and one "see
      bad flier below". The NPC's and the legendary creature's Stat Block and a held creature's print it as "Speed, as
      printed", one declaration each in 5e's system definition and no code. The derived Speed and Other Speeds rows stay,
      as Armor Class does beside its print. Every NPC export gains the line. `kind-sheets.test.ts` holds it for every
      creature in both kinds and for a hovering one held, each failing without the declaration.
- [x] **A holder's feature changes the creature it is about, not every creature held.** *From the ADR 0073 item.* The
      book says "Your steel defender gains a +2 bonus to Armor Class", and content writes Improved Defender as
      `companion:ac` +2, so a Battle Smith who also holds a Homunculus Servant shows the +2 on both. ADR 0073 left it
      as a guess about prose; the book is explicit about which creature, so it is pre-1.0 (the maintainer's call,
      2026-10-12). How a feature is tied to its creature (most likely: what granted both) is decided in an ADR,
      measured first over every holder feature that writes a `companion:` stat.
      **Done** ([ADR 0109](./docs/adr/0109-a-holder-s-feature-changes-the-creature-it-is-about-found-by-what-reached-both.md)):
      measured, 10 elements outside creatures write a creature's stats, 7 of them traits a creature grants itself (already
      right) and 3 a holder's features (the 2014 Ranger's Companion, Eberron's and Tasha's Improved Defender), each tied to
      its creature by what reached both. A feature is about a creature when it, or what gave it, is among what reached the
      creature; in any other held creature's scope its rules on the creature's stats are not applied, and a feature about
      none applies to all. The character's own numbers are unchanged. A Tasha's Battle Smith 15 holding a Homunculus
      Servant too: steel defender armour class 17, homunculus 13 (it read 15). No format change. Driven in the browser build:
      that character built from nothing, both stat blocks on the Sheet as the test reads them.
- [x] **A held creature's proficiency bonus follows its own challenge rating** when it does not take its holder's.
      *From the ADR 0073 item.* Every held creature but the class summons gets +2, right for challenge 0 to 4; the
      Triceratops (5) and the Tyrannosaurus Rex (8), reachable through the item that offers every creature, should get +3,
      so every proficient save and skill on their stat blocks reads one low. The NPC already reads its creature's
      printed rating; a class summon prints "—" and must not be warned about.
      **Done** (2026-10-12): the creature's scope reads its printed `challenge` into a challenge rating of its own, and
      its default bonus is the book's, +2 to challenge 4 and +1 for every 4 above, as an NPC's; a creature supplying its
      own (a class summon) is unchanged. A lone dash, which all 20 creatures without a number print, now reads 0 and warns
      nowhere (the maintainer's call: the lowest rating there is), so no Steel Defender carries a note; ADR 0060 amended.
      The Triceratops and Tyrannosaurus Rex read +3. `companions.test.ts` fails without the declaration or the dash.
- [x] **A held creature's stat block marks its proficient saves and skills**, as an NPC's does ("Stealth +5
      (proficient)"). *From the ADR 0094 item.*
      **Done** (2026-10-12): the held creature's Saving Throws and Skills declare a mark counted in the creature's own
      bonus. Measured over all 141 creatures: 294 of the 300 rows shown hold a whole number of it (203 skills proficient,
      25 expertise where content doubles the bonus, as the 2025 Owl's Perception +5; 66 saves); the other 6 are fixed
      numbers content writes (a UA Ancient Companion, upstream's Eberron homunculus) and read the whole bonuses they hold.
      No code; `companions.test.ts` fails without the declaration. Every held creature's export gains its marks.
- [x] **Attacks a character makes beyond a weapon's single row.** *From the ADR 0093 item; essential before 1.0, the
      maintainer's call (2026-10-12).* An unarmed strike and a Monk's Martial Arts die; spell attacks as rows ("Fire
      Bolt: +5, 1d10 fire"); two-weapon fighting (the off-hand attack's damage without the ability modifier, unless a
      fighting style says otherwise); reach and range for a melee weapon; a held creature's actions with what its holder
      adds applied. Each is measured first, and nothing is read out of prose (ADR 0005).
      **Done** (2026-10-12/13, [ADR 0110](./docs/adr/0110-a-kind-declares-attacks-no-item-gives-an-off-hand-row-and-a-melee-reach.md)):
      three of the five parts. The kind declares rows no item gives (5e: Unarmed Strike, with Strength or, with a Martial
      Arts die, the better of Strength and Dexterity; the Martial Arts or Unarmed Fighting die, else 1), an "off-hand" row
      on each equipped Light melee weapon while both hands hold one (no positive ability modifier to its damage unless a
      Two-Weapon Fighting style is held), and a melee weapon's reach where content writes no range ("10 ft" with Reach,
      else "5 ft"). Driven in the browser build: a new Monk reads "Unarmed Strike: +5, 1d4+3 bludgeoning", two equipped
      Shortswords "off-hand 1d6 piercing", a 2024 Pike "range 10 ft".
      **Done** (2026-10-13, [ADR 0111](./docs/adr/0111-a-cantrip-is-an-attack-row-its-roll-read-from-content-or-chosen-by-the-user.md)):
      cantrips as attack rows (levelled spells are after 1.0, the maintainer's call). A cantrip tagged "Spell Attack" or
      "Spell Saving Throw" is a row, its bonus or DC its casting class's, its dice counted by character level. Content
      states no die, damage type or save ability as a rule, so the user chooses them on Build (kept on the character,
      format 13; "rolls nothing" and Toll the Dead's two dice allowed), and a cantrip no class casts (High Elf, Magic
      Initiate) is cast as a class the user names. Only regular scaling: Eldritch Blast reads as more dice. Driven in the
      browser build: "Fire Bolt: +3, 2d10 fire", "Acid Splash: DC 11 Dexterity, 2d6 acid".
      **Done** (2026-10-13, [ADR 0112](./docs/adr/0112-a-sheet-section-may-write-a-note-under-each-element-it-lists.md)):
      a held creature's actions with what its holder adds, as a line under each action (the maintainer's call): "If it is
      an attack, its holder adds 2 to the attack roll and 2 to the damage." Content tags no action as an attack and only
      the 2014 Ranger's Companion adds anything, so the line says "if" and nothing is read out of prose. A sheet section
      may declare `elementNote`. Driven in the browser build (a Beast Master's Wolf).
- [x] **A druid's Wild Shape tier on the sheet.** *From the ADR 0070 item.* The 2014 Player's Handbook's Beast Shapes
      table sets the highest challenge rating and the limits (no swimming, no flying speed) by druid level, and the beast
      must be one the druid has seen. The maintainer's call (2026-10-12): the sheet shows the tier the character is at,
      not the whole table. Measured first: whether content states the tiers as rules or only as prose.
      **Done** (2026-10-13, [ADR 0113](./docs/adr/0113-a-2014-druid-s-wild-shape-tier-is-a-table-in-the-system-definition.md)):
      the 2014 table is prose only, so 5e's player character declares it (the maintainer's call: a table in the system
      definition), keyed on holding the 2014 Wild Shape feature. A Wild Shape section reads "Highest Challenge Rating: 1/2"
      and "Limitations: No flying speed" at druid 4; a 2014 Moon druid reads its Circle Forms' rating (content's
      `circle forms:cr`) with the table's limits. The 2024 Druid needed nothing: its own sheet line states its tier at
      each level. No engine or format change. Driven in the browser build.

**Exit criteria:** a DM can build a PC, an NPC and a legendary creature in one app, and the
engine has no code that names any of them.

---

## Phase 5 — Export & sharing ✅

*An export is a rendering of the sheet, which is already one view per kind (ADR 0074, `packages/ui/src/sheet.ts`): an
NPC's export is its stat block and a player character's its page, with nothing kind-specific of the export's own. What the
Sheet shows, its creatures and kept text included, is one document (`packages/ui/src/sheet-document.ts`, ADR 0075) that the
pane draws and every export renders: the PDF and the print layout start from it, not from the pane.*

- [x] **PDF character sheet: Incudo's own sheet as a PDF, and the official 2014 form filled into the user's own copy.**
      **[ADR 0079](./docs/adr/0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md),
      accepted 2026-09-30**, measured first (`tools/verify/src/pdf-sheet.test.ts`, the official sheets read outside the repository, the
      print layout printed to PDF in headless Edge). The maintainer's calls: Incudo's PDF is the print layout, not a layout of
      its own; it is written without the print dialog, on Windows first (WebView2's `PrintToPdfStream`, so the preview's
      Margins list cannot undo the page rules), with A4 or Letter chosen in the print options step; the official form is
      never shipped or downloaded by Incudo (its notice permits personal photocopying, and D&D Beyond's and Wizards' terms
      forbid unauthorised software reaching the service), so the user downloads it from a link and points Incudo at their
      copy, recognised by its 334 fields. It is filled from the sheet document only, which first grows what a sheet needs and
      the Sheet will show too, each its own change. Measured: the document fills about 155 of the form's 334 fields a sample
      and never holds 167 (personality, coins, appearance and play state stay blank; personality and appearance are filled
      since ADR 0092); proficiencies overflow their box on 29
      of 30 samples and features on 12. The 2024 sheet has no form fields and is not filled. Not on macOS or Linux (the print
      item below). The work, in order:
  - [x] **save and skill proficiency marks**: a sheet section's `mark` counts how many proficiency bonuses a row's
        proficiency stat holds; 5e's Saving Throws and Skills read "+7 (expertise)" on the Sheet, the print and the text
        export (ADR 0079 decision 6; 203 proficient and 10 expertise rows on the samples, all matching the derivation)
  - [x] **levels per class**: a sheet section's `trackProgress` writes a listed class with the count its track publishes;
        5e's Character section reads "Paladin 3", "Sorcerer 3" on the Sheet, the print and the text export (ADR 0079
        decision 7; the 40 classes of the thirty samples, all as the split, single-class ones from their implicit track)
  - [x] **a spell's level and its prepared mark**: a sheet section's `group` lists by a setter and its `preparedMark` marks
        what the prepared lists hold, listing a list preparer's prepared spells too, which no sheet showed; 5e's Spells
        section reads "Bless (Level 1, always prepared)", cantrips first, on the Sheet, the print and the text export (ADR
        0079 decision 8; 311 spells on the samples, 29 always prepared and 92 prepared, all matching the derivation)
  - [x] **hit dice per class**: a sheet section's `trackDie` writes a listed class with its track's count of the die its
        setter names; 5e's Character section reads "Paladin 3 (3d10)", "Sorcerer 3 (3d6)" on the Sheet, the print and the
        text export (ADR 0079 decision 9; all 29 classes in the corpus carry a die, and the 40 classes of the thirty
        samples read as the derivation and the class element say)
  - [x] **"Export sheet as PDF…" in the Windows window, with paper in the print options step**: the print options step
        offers A4 or Letter (the first from the user's languages, then the last chosen) and writes what "Print sheet…"
        prints through WebView2's `PrintToPdfStream`, no print dialog, saved where the user says; no such command where
        no PDF writer exists (ADR 0079 decision 10; driven in the Windows window: A4 and Letter at their sizes, the
        print's page counts, every word of the text export, a Cancel writing nothing)
  - [x] **"Fill the official sheet…": the user's copy kept and recognised, the field map shipped with the 5e system, what
        does not fit named in the result line**: a form map beside 5e's `system.json` (`forms/official-2014.json`, its own
        schema, not the system format) names the 2014 sheet's 334 fields and which takes what from the sheet document;
        `formValues` in `packages/ui` fills them knowing no game; pdf-lib in `apps/desktop` writes a copy of the user's
        kept copy, recognised by its fields; proficiencies past their box, spells past a level's lines and a second casting
        block are named in the result line (ADR 0079 decision 11; every sample against its own document, a stand-in form
        in CI, a real copy locally; driven in the Windows window)
- [x] **Plain-text / Markdown export: "Export sheet as text…" writes the Sheet as Markdown that reads as plain text**
      ([ADR 0075](./docs/adr/0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md)).
      Measured first, over the thirty samples, every creature as an NPC and a legendary creature, and Cairn: the Sheet's
      view is identical reopened with no source, none of its text is markup, and the only HTML is a kept element's text
      (fifteen tags, 110 tables, 63 of them the 2024 grid with spanning cells and no header row). A listed element's
      description would add 18,635 to 93,290 characters to a sample, so the export lists names, as the Sheet does. The
      Sheet pane composed three sentences of its own, so the sheet became one document the pane and the export both read.
      Plain text and Markdown are one format (`#` headings, `- Label: value` lists, pipe tables), escaped only where
      Markdown would misread a character, and writing no HTML. A kept text is read into Markdown in `packages/ui`
      (`htmlToMarkdown`), where the shell's DOM sanitizer cannot run; every kept text says the same words, and every
      table has the same columns, as its HTML. A command on the Sheet through Save a copy's save port, needing no library
      and no content. No oracle row moved; no system or character format change. Driven in the browser build (a sample,
      an NPC keeping a stat block, a Cairn character; the first two exported again with the source off, byte for byte the
      same) and in the Tauri window on Windows (a sample opened with no source ever added, exported from the native menu
      through the real save dialog, byte for byte the tests' file). **Not done:** a copy to the clipboard (a port of its
      own; *(in Beyond 1.0's "Left from Phases 3 to 5" since 2026-10-12)*); a shortcut (a Ctrl+Shift chord has to be found by pressing real keys in the Windows window;
      *(an open item at the end of this phase since 2026-10-12)*); feature
      descriptions, personality, notes, the bag and prepared spells, none of which the Sheet shows (~~personality and notes~~
      are written and shown since ADR 0092; ~~the bag~~ since ADR 0098; ~~prepared spells~~ since ADR 0079 decision 8; a
      feature's sheet line, not its whole description, since ADR 0076; the whole description is *(an open item at the end of this phase since 2026-10-12)*); the save dialog's
      replace prompt and Cancel, not exercised for an export in the window; macOS and Linux.
- [x] **Content's sheet hints are read: a feature's sheet line, at its level, filled**
      ([ADR 0076](./docs/adr/0076-content-s-sheet-hints-are-read-every-description-kept-chosen-by-the-level-the-element-gates-at.md)).
      Groundwork for the PDF and the print layout, which lay out the lines this gives them. Measured first: content's
      `<sheet>` is feature text, short, and fully fillable from what a derivation publishes, and **the importer kept only
      its first `<description>`**: 220 sheets write two to five, gated by `level=`, so 320 were dropped (a sixth silently
      dropped construct, fixed as a bugfix; a save written before reads its one text at every level). The text shown is
      the one for the level the element's own rules read, which the derivation now publishes (`gateLevels`: a class
      feature's class level, not the character's; the one sample that separates them agrees). `{{stat}}` is filled as the
      sheet writes the stat, `:half` read by the engine's own code; nothing unpublished on the samples. The Sheet and the
      Markdown export show "**Rage** (Bonus Action; 3/Long Rest): …", keeping the lines content wrote. A section may
      declare `omitHidden` (system format): 5e's feature and proficiency lists leave out what content marks
      `display="false"` (188 and 10 on the samples: Spellcasting, subclass placeholders, Tough), the header and Senses
      keep theirs, and a hidden element a section lists anyway is named without its line (found in the Tauri window: a
      2014 class's header read its sheet text). A stat block's traits keep "Primal Bond", which the book prints. No oracle
      row moved; no character format change. Driven in the browser build (samples, a held Owl, an NPC and a held creature
      from a user's own file whose lines name stats and change with level, reopened with the sources off, exports byte for
      byte the tests') and the Tauri window on Windows (the same, no source ever added, exported from the native menu
      through the real save dialog, byte for byte the tests'); driving a held creature found its unfilled placeholders
      counted nowhere. **Not done:** spells, proficiencies and backgrounds described on the sheet (content writes no sheet
      text for them); ~~a reason beside a number a hidden feature moved~~ (Tough; an open item at the end of this phase since
      2026-10-05, done by ADR 0095); ~~counting uses~~ (Phase 6, ADR 0084); a hidden trait a
      stat block prints is named without its line (three Tasha's "Primal Bond"s, which no sample holds; part of the whole
      descriptions *(an open item at the end of this phase since 2026-10-12)*); macOS and Linux.
- [x] **"Content has been updated — refresh?": a character whose sources changed what it carries is offered a refresh,
      reviewed as the Sheet it would make** ([ADR 0082](./docs/adr/0082-a-refresh-compares-what-a-character-carries-with-what-its-sources-load-and-shows-the-sheet-it-would-make.md)).
      Measured first against older checkouts of AuroraLegacy/elements: the index's version was 0.0.1 then and now, so
      recorded versions say nothing, while 81 (April 2026) to 410 (August 2024) of the samples' embedded elements differ
      today and a refresh would add held elements and, against the older one, move armour class, scores and skills. So
      the open character's copies are compared with what its sources load; Build and the Sheet offer a review, which
      lists the Sheet's rows and listed elements that would change and the elements changed or kept; Refresh takes up the
      sources' definitions, keeps every copy they lack, leaves choices alone, moves the recorded versions, and reaches
      the file on Save. Driven in the browser build: a sample saved against April 2026's content, today's AuroraLegacy
      loaded; the review, the refresh, a reload, the unsaved file still offering it, Save and reopen, Not now.
- [x] **Print layout: "Print sheet…" prints the Sheet through the platform's own dialog**
      ([ADR 0077](./docs/adr/0077-a-printed-sheet-is-the-sheet-pane-under-a-print-stylesheet-and-its-sections-flow-in-columns.md)).
      Measured first: a sample's sheet is 109 to 233 lines before wrapping, an NPC's 27 to 61; the shell had no print rule
      at all, and would have printed it one window tall, with the app's chrome, a name field for a title and, in the dark
      scheme, light grey text. The print layout is print rules over the Sheet pane, which already draws the one document and
      nothing else, not a second renderer (content's HTML is made safe only by the shell's DOM sanitizer). The sections
      and held creatures flow down two columns, laid out by what they hold and never by name: a layout by shape would have
      moved Worn & Wielded and Senses between treatments from one character to the next. Kept texts start a page of their
      own. The document gained its `title`, which the Markdown export reads too. Printed to PDF in the Tauri window on
      Windows for the thirty samples, the creature characters, a character keeping the longest texts and Cairn, no source
      ever added: every word of the text export in order and nothing clipped, samples on 2 to 4 A4 pages, an NPC on 1; the
      native menu item, the Sheet's button and Ctrl+P (real keys: claimed on every pane, one preview on the Sheet) open
      WebView2's print preview, from which the sheet went to a real printer and to "Save as PDF" with its layout intact;
      the browser build prints the same. What did not work first: keeping every section whole, which left pages half
      empty. No oracle row moved; no system or character format change. **Not done:** ~~a stat block drawn as the book
      prints it~~ (ADR 0126, 2026-10-28); ~~turning off the dialog's default header and footer~~ (ADR 0078, the
      next item); macOS and Linux.
- [x] **Print options of the app's own, then the platform's print dialog; and nothing of the web page on paper.**
      Seen on paper (2026-09-30): the print dialog's default headers and footers put the date and time at the top of
      every page and the page's address and a page number at the bottom (`localhost:5173` in the dev build; an installed
      build would print `tauri.localhost`). ADR 0077 left them to the dialog; the maintainer's call is that a sheet should
      not show them. Chosen direction (2026-09-30), over replacing the platform's dialog with one of the app's (three
      native implementations, a printer list and a preview of its own, and the loss of what users know from their own
      dialogs; only Windows testable here) and over printing without a dialog through WebView2 (Windows only, Rust):
  - **"Print sheet…" first opens a small options step of the app's own**, deciding what goes on the page: which parts
    (the character, its held creatures, what it keeps for reference), and whether the sheet prints its own page
    numbers and the character's name on later pages (a three-page sheet that loses a page is worse without them). A
    view-model in `packages/ui`, kind-agnostic and under `node --test`, as the commands and the sheet are; the pane
    renders it and computes nothing. What it chooses reaches the print rules as classes or attributes on the Sheet,
    never as a second renderer (ADR 0077 decision 1). Whether the choices are remembered, per character or per user,
    is part of it.
  - **Then the platform's own dialog**, unchanged: printer, copies, pages, "Save as PDF". The same in every shell,
    the browser build included.
  - **No page furniture, in every shell**: the print rules take the page margin away (`@page` with no margin, the
    margin moved inside the page), since the dialogs print their headers and footers only in the margin. The dialog's
    own checkbox can still put them back, which is the user's choice. Whether WebKit's print panels on macOS and Linux
    honour this as Chromium does is part of the macOS and Linux item below.
  - Wants an amendment to ADR 0077 first, measured as that ADR was: what each part costs in pages on the samples,
    and that a margin-less page prints no furniture, to PDF and on paper, in the Windows window.
  - **Proposed as [ADR 0078](docs/adr/0078-a-print-is-chosen-in-a-step-of-the-app-s-own-and-no-edge-of-the-page-is-left-to-the-dialog.md)**
    (2026-09-30), measured to PDF and in the preview in the Windows window, not yet on paper. The measurement corrects
    two things above: with no margin the dialog does not offer its headers-and-footers option at all, so it cannot put
    them back; and a page number needs a margin, since only a margin box prints one. So every edge of the page gets
    either no margin or a margin carrying the app's own box.
  - **Built** (2026-09-30), ADR 0078 accepted: the step, remembered per user; no margin by default and a margin only
    under the app's own page number or name. Printed in the Windows window 109 times (36 characters, every combination of
    running items, every choice of parts), through the preview (no headers option in any) and to PDF with the dialog's
    headers on (no date, title or address on any page). Building it found that Chromium lets a later `@page` rule beat
    `:first`, which put the name on page 1; held with `!important` and a test that resolves pages as Chromium does.
  - **Driven with real keys, a real mouse and paper** (2026-09-30): the step, Ctrl+P, Escape and Tab behave as designed
    (Enter on any box prints, Print… being the form's submit); A4 paper and a PDF saved through the real dialog carry
    nothing of the dialog and the app's items where chosen; the choices survive a restart. **One limit found**: the
    preview's own Margins list (Minimum, Custom) brings the headers option back, can print the dialog's date and title on
    page 1 and drops the app's page numbers, and is remembered by the preview. It opens on Default, which the rules hold
    for; nothing in the page was found to hold against it (ADR 0078, "What this does not do"). Not on macOS or Linux (Beyond
    1.0's "macOS, Linux and iOS").
- [x] **Say why a number moved when what moved it is hidden.** *Buried in the ADR 0076 item; found on 2026-10-05 by
      the audit described at the end of Phase 3.* A section declaring `omitHidden` leaves out what content marks
      `display="false"`, so Tough is not on the feature list and the hit points it adds have no reason beside them, as on
      Aurora's sheet. On the Sheet and in every export that reads the document.
  - **Built** (2026-10-06, [ADR 0095](docs/adr/0095-a-row-names-what-moved-it-that-the-sheet-lists-nowhere.md)):
    "Hit Points: 45 (including Tough)". Measured first on the samples: of 1,399 rows, 5 are moved directly by a left-out
    element (all Hit Points: Tough, Dwarven Toughness) and 24 through a formula the kind declares (Speed by Fleet of Foot,
    skills by Jack of All Trades, Thaumaturge, Magician, and Skill Expertise, which the row's "expertise" already says).
    A row's `including` reads the derivation's contributions and follows the kind's `derive` formulas by name, never
    evaluating them; `rowAside` words it, so the Sheet, print, text export, phone and refresh review all show it. 19 rows
    on 9 samples now name something; the oracle is identical. Driven in the browser build.

*The items below were found on 2026-10-12 by the sorting described at the end of Phase 3. The maintainer chose them for
before 1.0.*

- [x] **Incudo's sheet shows a listed element's whole description, and the official form does too where it fits.**
      *From the ADR 0070 item (a held element's own text on the Sheet), the ADR 0075 item (feature descriptions) and the
      ADR 0076 item (a hidden trait a stat block names without its line, "Primal Bond", folded in by the maintainer's
      call).* The Sheet shows a feature's one sheet line, and a description only for a kept reference. The maintainer's
      call (2026-10-12): Incudo's own sheet shows the whole text; the 2014 form if it can be made to fit. Measured first:
      ADR 0075 found descriptions add 18,635 to 93,290 characters to a sample, so what the print, the text export, the
      phone and the form's boxes do with that much is the question.
      **Done** (2026-10-13, [ADR 0114](./docs/adr/0114-the-sheet-ends-with-the-whole-descriptions-of-what-its-sections-list.md)):
      measured, whole descriptions are 3 to 14 printed pages a sample, 61% of it race, class and background chapters. The
      maintainer's calls: features, spells and a held creature's traits, actions and reactions get their whole text
      (about 2 pages a sample), in a Descriptions part after the sheet. A sheet section may declare `describe`; the pane,
      the phone, the Markdown and print (a part the print step can leave out, starting a page) all show it, so "Primal
      Bond" is read whole there. The 2014 form's Features and Traits box gets the whole texts when all of them fit (5 of
      the 30 samples) and the lines otherwise. Driven in the browser build.
- [x] **A keyboard shortcut for "Export sheet as text…".** *From the ADR 0075 item.* A Ctrl+Shift chord that reaches
      the page, found by pressing real keys in the Windows window (ADR 0038 lists those that do).
      **Done** (2026-10-12): Ctrl+Shift+O ("out"; no free chord spells "text"), from the chords ADR 0038 saw arrive with real
      keys in the window, and a test now refuses any Ctrl+Shift shortcut not on that list. Shown in the File menu and on
      the Sheet's button. Driven in the browser build: claimed on every pane, runs the export on the Sheet only. Pressing it
      in the Tauri window is Phase 9's drive.

**Closed 2026-10-13.** The phase had no exit criteria of its own; it closed when nothing before 1.0 was left in it: the
last item, a listed element's whole description (ADR 0114), is done above. What its items left for after the first release
is in Beyond 1.0's "Left from Phases 3 to 5"; what was only not driven in the Tauri window or on the phone is Phase 9's
drive item, and "not on macOS or Linux" notes are Beyond 1.0's "macOS, Linux and iOS".

---

## Phase 6 — Mobile app ✅

*Deliberately after the desktop builder: the shared core must be proven first.*

- [x] **Expo shell, navigation, storage**
      ([ADR 0083](./docs/adr/0083-the-phone-app-is-expo-in-the-workspace-its-storage-is-sqlite-and-its-library-is-its-own-folder.md)).
      Expo SDK 57 in Expo Go, `apps/mobile` a workspace (the install went from 45 packages and 6 s to 519 and 69 s,
      measured), React Navigation's native stack, `Storage` as one SQLite table (a full AuroraLegacy download measured
      at 800 values and 14.75 MB, twenty keys over 255 bytes; 16.9 MB written in 14.5 s on the emulator), the library the
      app's own folder with files added through the document picker (`CharacterLibrary.add`, unchanged bytes), DEFLATE
      by fflate in the shell. `core` gained nothing.
- [x] Character sheet — **read and play** first; building second.
      **Read is built** (ADR 0083): the sheet document drawn natively, content's HTML through `htmlToBlocks`, which reads
      every corpus text to the same words as the text export. Five samples opened on the emulator with no source gave
      a sheet byte-identical to the desktop's for the same file.
      **Play is built** ([ADR 0084](./docs/adr/0084-play-state-is-an-input-on-the-character-and-what-it-tracks-is-read-from-the-sheet.md)).
      Measured first: Aurora's saves record no play state at all, and 632 of content's 968 usage hints are a count per
      rest or per day. What is spent is `Character.play`, an input in `character.json` (format 8, only when recorded);
      what is tracked and what a rest gives back is the kind's `play` in the system definition, every maximum read off
      the sheet (hit points with temporary ones, hit dice, both slot sections with pact magic back on a short rest,
      limited uses, Ki, Focus, Sorcery and Psi points, superiority dice, inspiration, death saves, exhaustion, and
      fourteen conditions as names). The phone writes each edit back to the library file at once, rewriting only
      `character.json` and the manifest; the desktop's Sheet shows and edits the same view and saves it with Save. The
      sheet document and every export are unchanged. Driven on the emulator and in the browser build, the same file
      both ways. Not yet: the maintainer's own phone, iOS, the Tauri window; spending a pool from the features that name
      it ("Channel Divinity"), per-turn uses.
- [x] **Full build flow** ([ADR 0086](./docs/adr/0086-a-phone-builds-and-edits-with-the-desktop-s-builder-its-content-loaded-when-a-build-opens.md)).
      Measured first (`mobile-build.test.ts`, and a probe on the emulator): a load of AuroraLegacy was 82 s from the
      network and 15 s from the raw cache on the phone, and no corpus file reaches the UTF-16 decoder Hermes lacks. Asked
      about that 15 s, the maintainer chose to **convert a source into Incudo's own form** ([ADR 0085](./docs/adr/0085-a-source-is-kept-converted-into-incudo-s-own-form-and-loaded-from-that.md)),
      with keeping the files as the choice for sparing space, on both apps: one value per file, written in one batch, a
      later load on the phone 2.3 s converted against 6.6 s from the files, and identical elements and diagnostics on the
      real corpus. The phone's Content screen adds the game's suggested source in full; New character and a sheet's Edit
      open one Build screen (decisions, a searchable picker, choices made, scores, hit points, class levels, prepared
      lists, books, skipped and not held), loading content when it opens, saved with Save and asking before leaving
      unsaved. Shared wording and rules moved to `packages/ui` (`build-view.ts`, `content-sources.ts`, `edit-session.ts`)
      and the desktop's panes call them. Driven on the emulator: a character built from nothing and a sample edited, both
      saved, exported and read in Node with the desktop's code to the phone's own sheet checksum. **Second pass** (ADR
      0086, same ADR): what a creature gives (removed and given back), features of the user's own (each line a row of
      the stat, Adds or Sets, the number, the maintainer's choice), additions (a full-screen picker per type, an unmet
      prerequisite marked) and references, their grouping and wording moved to `packages/ui` for both shells. Driven:
      an NPC built on a Wolf with a trait removed and a written "Godspeed: Speed 60", a player character given a feat
      it does not qualify for and a kept stat block, both exported to the phone's sheet checksum in Node. **Third pass**
      (ADR 0086): the class split editor, inline (the maintainer's choice), and the link back to a creature's rating,
      their rows and words moved to `packages/ui` for both shells; a Save measured (the library's rescan was 2.3 of a
      player character's 3.2 s on the emulator) and made to rescan nothing (1.5 s), and Back during a Save waits for it.
      Driven: a Fighter 3 / Rogue 2 split applied and levelled to 7, an NPC's rating typed and set back to its Wolf's,
      both exported to the phone's sheet checksum in Node. **Not yet:** a source of the user's own on the phone; a Cairn
      character built on the phone; a real phone; iOS.
- [x] **Import/export via share sheet and file picker** (ADR 0083, [ADR 0099](./docs/adr/0099-a-file-shared-to-the-phone-is-added-as-a-picked-one-is-and-receiving-needs-the-app-s-own-build.md)).
      Import through the file picker and export from the sheet's header, to a folder or through the share sheet, of the
      library file unchanged (ADR 0083). **Receiving** (ADR 0099): measured first, Expo Go registers no intent filter for
      a file and Android types both a `.incu` and a `.dnd5e` `application/octet-stream`, so the phone app gained a
      development build of its own (the maintainer's choice; Expo Go stays for everything else) whose manifest takes
      `SEND`, `SEND_MULTIPLE` and `VIEW` of that type and `application/zip`, through `expo-sharing`'s plugin and React
      Native's `Linking`. A shared file, an "Open with" and a picked file go through one function, `receiveFiles`
      (`packages/ui`), which decides by contents and not by name: a character is added unchanged under a free name,
      saying so when its own was taken; an Aurora save is recognised and not imported, and says to import it on a
      computer (importing needs content a phone loads only to build). Driven on the emulator: shared from the Files
      app's share sheet, opened with Incudo, three shared at once with a taken name and an Aurora save among them, and
      picked from Recent files (whose names are provider ids, which the old extension check would have refused); every
      sheet opened to Node's checksum. **Not yet:** a real phone, iOS, a release build (a share that starts a
      development build goes through its launcher and loses the read grant), ~~importing an Aurora save on the phone~~
      (ADR 0101, below).
- [x] **Import an Aurora save on the phone: a `.dnd5e` shared, opened or picked is offered for import, and imported with
      the content a build loads** ([ADR 0101](./docs/adr/0101-an-aurora-save-received-on-the-phone-is-offered-for-import-and-imported-with-the-content-a-build-loads.md)).
      Measured first: the desktop's import takes all thirty samples on the phone's terms (with only AuroraLegacy's core
      part on, every one imports and says what it misses), but refused a file named by a provider id, which is how Android's
      Recent files hands one over; a UTF-16 save is refused with a sentence and nothing throws. Import is a tap, never
      automatic: a file whose name does not say is asked about among the games that read Aurora content, a game with every
      source off says so, and one with none offers its suggested source with ADR 0100's words (the metered sentence on a
      metered connection). The result says a taken name and what was missing, and offers the importer's notes and Open.
      Driven on the emulator in the development build, shared and picked, no source, metered, three at once and the source
      off; every sheet equals the desktop's import of the same save. **Not yet:** a real phone, iOS, a release build,
      Expo Go's picker.
- [x] **Download mode on metered connections: the phone asks before a fetch that downloads a source, and the mode
      setting goes** ([ADR 0100](./docs/adr/0100-on-a-metered-connection-the-phone-asks-before-a-fetch-that-downloads-a-source-and-the-mode-setting-goes.md)).
      Measured first: *stream* and *download* fetch the same files at the same moment and no load reads the setting, so
      no default of it saves data; what spends data on a phone is adding a source, Refresh (all of it again when kept
      converted, what changed when kept as files) and switching from converted to files (all of it again). The phone reads
      whether the connection is metered (NetInfo) and, when it is, asks before Refresh and the switch and says on Add what
      it will download; on Wi-Fi nothing changes. The desktop's Stream/Download select is gone (the maintainer's choice);
      the field stays in profiles and saves. Driven on the emulator with Wi-Fi off and on, in Expo Go and the development
      build, and the Sources pane in the browser build. **Not yet:** the desktop, a real phone, iOS.

**Exit criteria:** the same `.incu` file opens identically on desktop and mobile, and
`@incudo/core` still has zero platform-specific code. Met on the emulator, every sheet held to the desktop's checksum.
The items' "not on a real phone" and "not iOS" notes moved after 1.0 (2026-10-12): a real phone is driven before the
Google Play listing, iOS with macOS (Beyond 1.0, below).

---

## Phase 7 — Systems as a first-class user surface ✅

*This is the phase that makes or breaks the project's premise. It should not slip.*
See [ADR 0011](./docs/adr/0011-user-systems.md).

- [x] **Fork** an official system into user space.
      **Done: [ADR 0104](./docs/adr/0104-a-new-system-starts-from-a-file-the-app-writes-and-a-copy-keeps-what-it-was-copied-from.md)**,
      with the scaffold below. **New system…** on the launcher offers, for each shipped system, *changes to* it (an overlay
      that changes nothing yet) and *a copy of* it (the whole definition under the user's own id). Measured first: a full copy of
      5e validated and loaded **no content**, since AuroraLegacy is tagged with 5e and a source has one tag, and it lost 5e's
      starting equipment and form, the gap ADR 0011 calls a bug. So a copy records an optional root `copiedFrom` (a deliberate
      format addition), which joins `systemLineage` after `extends`: a copy loads its original's sources and is offered what
      ships beside it, and receives none of its later changes. The file is saved where the user chooses and those bytes added
      through `UserSystemStore`, so editing it and adding it again is how it changes; an id already in use gets `-2`, never
      replacing a system. The oracle is identical. **Driven in the browser build** (the save dialog stood in for by a script):
      a copy of 5e loaded a file source added under 5e, its row saying the switch is 5e's too.
      **Not done:** forking a user's own system from the app; an in-app editor; the phone; the Tauri window.

- [x] **Overlay** an official system (`extends` + patch), so house rules survive upstream updates.
      **Done: [ADR 0102](./docs/adr/0102-an-overlay-is-a-patch-applied-to-its-parent-on-every-load-and-validated-as-the-system-it-makes.md).**
      A definition with a root `extends` is a patch: objects merge, entries with an identity (a stat's name, a kind's or
      step's id) merge by it, anything else is replaced, and `null` or `"remove": true` removes. It is applied to its parent
      as the parent is on every load and the result is validated as a complete system, so a fix to 5e the overlay does not
      touch reaches it and a change that breaks it is named, never half-loaded. Measured first: the root `extends` was read by
      nothing, ADR 0011's own example was refused with three errors, and 5e's `version` has read 0.2.0 through 72 commits, so
      the parent-version warning was declined. An overlay loads its parent's sources and is offered its starting equipment and
      form; its launcher card says what it is built on and what it changes. The oracle is identical. **Driven in the browser
      build** (the file picker stood in for by a script): added, its card, 14,320 elements from 5e's source, its stat on the
      Sheet, a broken one refused. **Not done:** overlays of overlays, placing a new entry before another, errors pointing at
      the overlay's own lines, the phone (no user systems there yet), the Tauri window.
- [x] Scaffold a working system from the app's system flow, never an empty file (this was
      `incudo system new <id>` until the CLI was scheduled for removal — see Phase 2).
      **Done: [ADR 0104](./docs/adr/0104-a-new-system-starts-from-a-file-the-app-writes-and-a-copy-keeps-what-it-was-copied-from.md).**
      **New system…**'s first start is a small starter system of Incudo's own words (not Cairn's): two element types, three
      scores entered through a budget step, a level, a Health derived from a score and the level, notes and a sheet. It builds a
      character with no content, held by `tools/verify/src/system-new.test.ts`, and was built in the browser build: Might 14,
      Agility 9, Wits 12, Health 16, nothing open.

- [x] User systems load through *exactly* the same path as official ones, clearly labelled
      **Done: [ADR 0107](./docs/adr/0107-shipped-and-user-systems-are-read-by-one-loader-and-differ-only-in-where-they-came-from.md).**
      Measured first, file to loaded system in the desktop, the phone and the tests: both reached the one validator, but the
      shipped definitions were read by three copies of a loader that dropped their warnings, had no text to give a problem a
      line and offered an overlay no parent, and a user's version of a game was handed its lineage's starting equipment
      **unchecked**: an overlay with no gold was offered 5e's wealth roll in gold and wrote a character its own system refuses.
      Now one loader in `packages/ui` reads every definition, from its text where there is text (the desktop imports the
      shipped files as text), and labels each system and failure by where it came from, the one difference ADR 0011 allows.
      Shipped starting equipment is checked against every system its lineage reaches and offered only where it fits, the card
      saying why when it does not; a shipped definition that fails says it comes with Incudo rather than "add the file again".
      The cards were already labelled ("yours", "Built on …", "A copy of …"). **Driven in the browser build** (the files written
      into the app's storage as an add writes them): the silver overlay's card and warning, a broken file with its line.
      **Not done:** a user's system shipping starting equipment or a form of its own (1.x); the phone's shipped problems have no
      line (Metro gives JSON as a value); the Tauri window.
- [x] Validation errors that a non-programmer can act on.
      **Done: [ADR 0103](./docs/adr/0103-a-system-error-says-where-in-the-file-by-line-and-by-the-ids-written-there.md).**
      Measured first on 33 authoring mistakes and six JSON slips: the words were mostly good, the locations were positions
      (`characterKinds[0].buildSteps[2]`), nothing had a line, syntax errors were V8's, three ambiguities validated (a stat or
      element type twice, a min above its max) and the launcher showed the first eight. Now every problem reads like
      `Line 47, column 9: characterKinds "hero" › buildSteps "talents" › label: is required`, in the file's order, all of
      them (five open). A core JSON reader records positions and names the slips (a trailing comma, a comment, single
      quotes) at their line; it is held to `JSON.parse` on every repository JSON file and 4,000 broken variants. An overlay's
      error is at the overlay's own line, or said to be in the parent's part. An identity twice is refused in every array an
      overlay merges by. **Driven in the browser build** (the picker stood in for by a script). **Not done:** reference checks
      still point at the container when the entry they name may be inherited; structural errors are shown before reference
      ones, so fixing the first round can show a second.
- [x] "How to write a system definition" guide.
      **Done: [docs/SYSTEM-GUIDE.md](./docs/SYSTEM-GUIDE.md)**, with [ADR 0105](./docs/adr/0105-a-stat-name-one-slip-from-a-declared-one-is-a-warning-when-a-system-loads.md).
      Measured first by growing the starter as an author would: the starter writes 57 of the schema's 334 field paths, 242 have
      an example only in 5e, formulas are trees (5e's median 210 characters), and four slips validate. One of those was silent
      and wrong (a misspelled stat in a formula read 0, Health 2 for 16), so a stat name one slip from a declared one is now a
      warning listed under the system's card; a blanket warning was ruled out, since 5e names 72 formula stats it does not
      declare. The starter's Traits and Gear steps offered nothing and are sets now. The guide walks the starter field by
      field, formulas, a worked game with its content and the sheet it makes, overlays, and what each problem means; every
      example in it is read by a test, problem lines and sheet included. **Driven in the browser build** (the warning on a
      card). **Not done:** a link from the app (waits for the published schema's address); the editor `$schema` lines were
      not tried in an editor; an overlay's error inside a formula it replaced is located in the parent's part.
- Publishing the schema and a second official system were moved to "Beyond 1.0" by the maintainer's call
  (2026-10-09).

**Exit criteria:** ~~someone who is not the maintainer adds a system without touching engine code,~~ and a house-rule
overlay still receives upstream fixes (ADR 0102). The first half moved to Beyond 1.0's "Systems for authors" by the
maintainer's call (2026-10-12): systems written by someone else come after 1.0.

---

## Phase 8 — Homebrew content authoring ✅

*Systems are the container; this is the content inside them.*

*Closed 2026-10-15 by the maintainer's call: what is built ships in 1.0, and the rest of writing game content (the
element editor's next parts, validating a whole source, exporting it) is after 1.0, in Beyond 1.0's "1.x — Writing game
content".*

- [x] In-app element editor — homebrew without hand-writing JSON. *Its first slice is 1.0's; what it left is in
      "1.x — Writing game content" (2026-10-15).*
      **First slice done: [ADR 0108](./docs/adr/0108-a-user-writes-elements-into-a-homebrew-source-of-their-own-kept-in-incudo-s-content-format.md).**
      Measured first (`tools/verify/src/homebrew-elements.test.ts`): of the types a character can be given whatever it is
      (the kinds' `additions.types`), a slice of name, description, setters, tags, lines adding a whole number to a stat
      and plain grants writes all of the corpus's conditions, 98% of its languages, 95% of its spells, 68% of its
      background features, 67% of its proficiencies, 59% of its racial traits, 41% of its archetype features, 22% of its
      class features and 9% of its feats; a feat is mostly a choice (200 of 320), a class feature mostly a prerequisite.
      Built: a **homebrew source** of the user's own (`kind: 'homebrew'`), one line in the Sources pane like any other,
      kept in the app's storage, its body a `ContentBundle` (the shape a save's `content.json` already is): the first
      content Incudo keeps in its own format. "Make a homebrew source", then **Edit elements** on its line: types from
      the kinds' addable ones, setter names and tags suggested from what loaded elements of the type carry, lines that
      add to a number a written feature may name or give a loaded element. An id is minted once from type and name and
      kept through renames; a character embeds what it holds, so its save opens with no source, and a later edit is what
      the content refresh offers. **Driven in the browser build** (a feat adding to Speed and giving a homebrew
      language, given to a character, edited, reloaded; a spell beside AuroraLegacy taking its suggested setters and
      tags). **Left:** choices (`select`), prerequisites and level gates, which stop most feats and class features; races,
      classes, subclasses, backgrounds and items; turning an add-only library feature into content; the Tauri window and
      the phone (which loads a homebrew source and has no editor); a library save reopened with the source off, driven
      in the app (held in Node).
- [x] **Reuse what a user writes across characters.** A custom feature ([ADR 0063](./docs/adr/0063-a-character-may-carry-features-its-user-writes-which-add-to-a-stat-or-set-where-it-starts.md))
      belongs to the one character it was written for, and a DM who gives three NPCs "Godspeed" writes it three times.
      This phase gives the user a library of their own features (and whatever else they author) that any character can
      pick from, and a way to move a feature already written on a character into it. Its shape is an element's on
      purpose, so the move is a copy. Not optional: the phase is not done without it.
      **Done: [ADR 0106](./docs/adr/0106-a-user-s-features-are-kept-in-a-file-in-the-library-folder-and-given-to-a-character-as-a-copy-that-remembers-where-it-came-from.md).**
      Measured first: "its shape is an element's" holds only for a line that adds. A line that sets where a number starts
      (Godspeed) or marks a row is not a rule any element can carry, so the library keeps features as features. 5e's
      three kinds name the same 34 numbers; an NPC may set 7 a player character works out, and the two share no type. The
      library is `incudo-features.json` in the character library folder (the maintainer's choice), every system's features
      in one file. Giving one copies it onto the character and records which feature and revision it came from (character
      format 12): a newer revision is offered with **Update** and never applied unasked, a copy changed on the character is
      marked and not nagged, and a character always opens without the library. **Save to your feature library** on any
      feature adds it, or saves a copy's changes back, which offers them to every character holding it. On the desktop's
      Build and the phone's. **Driven in the browser build** (a private browser folder for the picker, DOM events for the
      controls): written on one NPC, given to another, changed and saved back, offered, updated, reopened. **Driven again in
      the Tauri window on Windows** (a scratch folder, DOM events over the debug port) **and on the phone** (the Pixel 9 Pro
      emulator, the development build, `adb` taps; the file read back with `run-as`): the same steps, revision 1 then 2
      on disk, the second character's saved `character.json` recording revision 2 at format 12; Remove from library asking
      first and leaving the copies; a broken file named as unreadable and left byte for byte through a character's Save;
      the character list ignoring the file; on the phone, a file changed outside the app read again when Build is entered.
      Two bugs found that way and fixed: the desktop's Remove (and the Sheet's rests) asked nothing in the Tauri window,
      whose dialog plugin makes `window.confirm` async, so they ask by a second click now; and the phone's number fields
      kept nothing typed until the field was left, which hiding the keyboard does not do, so Godspeed was saved to the
      library as Speed 0. **Not done:** an editor of the library itself; real keys and mouse in the window (the screen was
      in use); Expo Go, a real phone, iOS, macOS and Linux.
- Validation and linting with good error messages, and exporting a homebrew source as a publishable index, moved to
  "1.x — Writing game content" (2026-10-15).

**Exit criteria:** a feature written once is offered to every character of its system, and a feature already
written on a character can be moved into the user's library without being typed again. **Met** (ADR 0106).

---

## Phase 9 — 1.0 🟡

> **The maintainer's calls, 2026-10-27:** 1.0 is the **desktop** release, and it ships **unsigned** (a code-signing
> certificate costs too much to make sense now; signing moved to Beyond 1.0's "1.x — macOS, Linux and iOS"). The phone's
> release, and its half of the drive below, come after the desktop 1.0 (Beyond 1.0's "1.0.x — The phone app on Google
> Play"). No more release candidates until every item here is ticked.

- [x] **Release pipeline: main builds the installers and puts them on GitHub.** Written 2026-10-07 as
      `.github/workflows/release.yml`, for the first public release candidate, to the shape below; the release it
      makes is a draft the maintainer publishes. Ticked when a real tag has produced installers that were downloaded
      and installed. Until then `ci.yml` (typecheck, test,
      the corpus budget) is the whole of main's pipeline. The shape, so that writing it is not a
      design session:
  - **Triggered by a tag, not a push.** A `vX.Y.Z-rc.N` tag on a commit reachable from `main`
    starts it; a plain `vX.Y.Z` tag later makes a final release. A tag with `-rc` is published as
    a GitHub **pre-release**. Deciding that RC1 exists is the maintainer's call and no rule here
    makes it.
  - **Gated on CI.** The tagged commit must pass the same jobs as `ci.yml` — `build` and
    `aurora-corpus` — before any installer is built, and the tag must match the version in
    `apps/desktop/src-tauri/tauri.conf.json` (and its `Cargo.toml`, which Tauri also reads),
    or the run stops before it builds anything.
  - **Builds with `tauri-action` on a Windows, macOS and Linux runner**, attaches every bundle to
    one GitHub Release, and writes the release notes from what the run actually did. `bundle.targets`
    is `"all"` today; **only Windows has ever been run** (see Phase 2's menus and export entries), so
    the notes must say which platforms were exercised and which were only built. An untested
    installer is labelled untested, not omitted and not implied.
  - **Nothing goes to npm** (CLAUDE.md), and no rulebook content is bundled: an installer is the
    engine and the shipped system definitions, as everything else here is.
  - **Unsigned at RC1, and said so.** Windows SmartScreen and macOS Gatekeeper will warn on an
    unsigned build, which is acceptable for a candidate and not for 1.0 — signing is the next
    item and needs certificates only the maintainer can supply, stored as repository secrets.
  - **Settle before RC1, not by the pipeline:** the app icon reads only against a dark
    background (`apps/desktop/src-tauri/icons/README.md` names the tile colour as an open brand
    decision), and an installer is the first place a user sees it.
    Localization is after 1.0 (Beyond 1.0, below) and does not hold RC1 back.
  - **Not verified when written:** nothing here had run. Ticked on a real RC tag that produced
    installers, downloaded from the release page and installed, not on a green workflow.
  - **It has run, twice** (found 2026-10-13, reviewing it): `v0.1.0-rc.1` (published as a pre-release, 2026-10-07)
    and `v0.1.0-rc.2` (still a draft) each went green on every job (the tag check, both CI jobs, four installer
    builds) in about 15 minutes and made one release with nine assets: the Windows `.msi` and `-setup.exe`, a `.dmg`
    and `.app.tar.gz` per Mac chip, and Linux's `.deb`, `.rpm` and `.AppImage`. The runs' only notices are GitHub's
    (`ubuntu-latest` moves to Ubuntu 26 from 2026-10-19, which reaches the check and CI jobs; the installers stay on
    `ubuntu-22.04`) and dependency deprecations. Every action version, the `workflow_call` wiring and its inherited
    read permission, the corpus checkout, the Linux packages and the macOS targets are therefore checked by a run, not
    by reading.
  - **Changed in the review:** the macOS bundle is signed ad hoc (`bundle.macOS.signingIdentity: "-"`, Tauri's
    advice: Apple silicon will not run unsigned code, and a downloaded app with no signature reads as "damaged"), and
    the notes give today's macOS route ("Open Anyway" under Privacy & Security; right-click Open no longer does it
    since macOS 15) and Linux's (an AppImage needs making executable). `tools/verify/src/release-workflow.test.ts`
    holds the three version fields to each other and to X.Y.Z, runs the workflow's own tag pattern against what this
    item accepts and refuses, and holds the CI gate, the draft, both Mac targets and the ad-hoc identity.
  - **Since rc.2, not yet built off Windows:** the Windows-only Rust (context menu, browser keys, the PDF writer, each
    with a `cfg(not(windows))` stub that reads right), `tauri-plugin-opener`, the window created hidden and shown in
    setup, and the ad-hoc identity. The next tag is the first macOS and Linux compile of them; a failure there stops
    only that platform's job (`fail-fast: false`), and the draft lacks its files.
  - **Built and started locally on Windows** (2026-10-13): `tauri build` made `Incudo_0.1.0_x64_en-US.msi`
    (4.93 MB) and `Incudo_0.1.0_x64-setup.exe` (3.55 MB), against rc.2's 4.70 and 3.38 MB. Not installed over the
    maintainer's own install: the `.msi` was extracted (`msiexec /a`) and its `incudo-desktop.exe` (13.6 MB) run with a
    scratch WebView2 profile, which showed its window at the configured size and closed cleanly. The page inside was
    not driven.
  - **Open, the maintainer's:** whether rc.1's installer, downloaded once from its release page, was installed and
    run (an Incudo 0.1.0 is installed on the maintainer's machine), which would meet this item's condition for
    Windows; what to do with rc.2's unpublished draft; and the icon's tile colour, above.
  - **rc.2 tagged and built, 2026-10-20.** main was pushed (143 commits), `ci.yml` passed on it, and `v0.1.0-rc.2` on
    `24145aa` ran the whole workflow green in about 15 minutes: the tag check, both CI jobs, and the four installer jobs
    (Windows 7m23s, macOS Apple silicon 7m11s, macOS Intel 7m55s, Linux 5m53s), so the Windows-only Rust above now
    compiles on macOS and Linux. One draft pre-release, nine assets. The maintainer installed its `-setup.exe`, and the
    installed `incudo-desktop.exe` was driven on a scratch WebView2 profile and library over the debug port (the next
    item's first run): AuroraLegacy added (14,320 elements from 740 files, 1 unresolved, 57 warnings, the baselines), a
    Hill Dwarf Wizard 3 built, saved, exported as text and PDF through the native dialogs, and reopened with the source
    off to an identical Sheet; Sample 09 imported to Aurora's armour class, hit points and speed. The draft is not
    published.
  - **Candidates carry 1.0.0 since 2026-10-23** (the maintainer's call). The app had been versioned 0.1.0 since rc.1,
    with no reason recorded, though these candidates are for 1.0. `v0.1.0-rc.3` was built green the same day and its
    draft deleted; the app's version is now 1.0.0 and candidates number again from `v1.0.0-rc.1`. A 1.0.0 installer
    upgrades an installed 0.1.0.
  - **`v1.0.0-rc.1` tagged and built, 2026-10-23** on `c3e326a`: every job green in about 18 minutes (Windows 10m53s,
    macOS Intel 8m04s, Apple silicon 6m48s, Linux 8m42s), one draft pre-release, nine assets named 1.0.0. The maintainer
    installed its `-setup.exe` and checked it by hand (passed). **The drive, 2026-10-24**, of the installed
    `incudo-desktop.exe` on a scratch WebView2 profile and library over the debug port, the native dialogs by window
    messages: About reads 1.0.0; adding AuroraLegacy kept Build and Browse on their loading panel for the whole 25 s
    download, then the campaign options opened with named options; its line read 14,320 entries from 740 files, 1 thing
    missing, 57 warnings (the baselines). A Hill Dwarf Wizard 3 (Evocation, Sage, an Owl, both starting packages, 5 of 5
    prepared) read AC 12, HP 26 (including Dwarven Toughness), speed 25, spell save DC 12, attack +4, slots 4 and 2,
    passive Perception 11; saved; exported as text (every one of its 742 distinct words in the PDF) and as a 7-page PDF;
    printed through its step to WebView2's preview (7 sheets, no headers option) and cancelled; reopened with the source
    off to an identical Sheet (16,788 characters). Sample 09 imported through the open dialog to AC 21, HP 44, speed 30
    (its readout), its card naming no missing source. Browse found Fireball; switching to Cairn showed its own library.
    Still seen, from rc.2's list: an unarmed strike with Strength 8 reads "1-1 bludgeoning", and Fire Bolt's damage
    reads "—" until it is set under Spells with nothing asking for it. Not driven: real keys and mouse, uninstall.
    *(Both fixed 2026-10-24, after the drive: a flat amount is added up and stops at 0, "0 bludgeoning"; a spell row's
    unset damage or class is still never required, and every sheet shows it as a warning beside the row, "Damage not set:
    choose its dice on Build, under Spells" (`attackWarnings`, a label on the desktop's Sheet). Seen in the Tauri window.)*
  - **`v1.0.0-rc.2` tagged and built, 2026-10-26** on `dc82707`, carrying those two fixes: the release workflow green in
    about 15 minutes, one draft pre-release, nine assets. The maintainer installed its `-setup.exe` and checked it by hand.
    **The drive, 2026-10-27**, the same way as rc.1's (the installed `incudo-desktop.exe` on a scratch WebView2 profile
    and library over the debug port, the native dialogs by window messages): About reads Version 1.0.0; adding
    AuroraLegacy and pressing New character at once kept Build and Browse on the loading panel with live progress for the
    whole download (about 30 s, 799 requests), then the campaign options opened with named options and no id; its line
    read 14,320 entries from 740 files, 1 thing missing, 57 warnings (unchanged). A Hill Dwarf Wizard 3 (Evocation, Sage,
    an Owl, both starting packages, Average hit points, 5 of 5 prepared) read AC 12, HP 26 (including Dwarven Toughness),
    speed 25, spell save DC 12, attack +4, slots 4 and 2, passive Perception 11. **Both fixes confirmed:** Attacks reads
    "Unarmed Strike: +1, 0 bludgeoning (range 5 ft)", and Fire Bolt's row "+4, — (range 120 feet)" carries a separate
    `.sheet-warning` label, "Damage not set: choose its dice on Build, under Spells", which the text export writes after
    the row as its own sentence. Saved; exported as text and as a 7-page PDF (every one of the export's 744 distinct words
    in the PDF); printed through its step to WebView2's preview (7 sheets, no headers option) and cancelled; reopened with
    the source off to an identical Sheet (16,795 characters). Sample 09 imported through the open dialog to AC 21, HP 44,
    speed 30 (its readout), its card naming no missing source (the import said 4 items the save uses are not in the
    loaded content, and 8 notes). Browse found Fireball; switching to Cairn showed its own, empty library and the two 5e
    characters counted as another system's. Not driven: real keys and mouse, uninstall.
- [x] **A release candidate is checked the same way every time.** Raised by the maintainer on 2026-10-20, after rc.2
      was checked twice, once by a scripted drive of the installed build and once by hand, from no written list. Today
      what a candidate must do before it is published lives in session notes, and two checks of one build cannot be
      compared. The shape:
  - **One written smoke test, `docs/RELEASE-CHECK.md`**, that a person follows with the installer from the draft and a
    drive follows step for step: install, first launch on a fresh profile, choose a system and a library folder, add the
    suggested source (the corpus line it must show), build a named character through every kind of decision, save,
    export text and PDF, print through its step, reopen with every source off, import a named sample and compare it to
    `manifest.json`'s readout, Browse, the menus, switching system, uninstall. Each step says what passing looks like,
    as a number or a sentence on screen, never "looks right".
  - **The drive half is a test that skips unless pointed at an installed app**, in the project's own pattern: an
    environment variable naming the installed executable (in `.env.local`, never committed); unset, it skips and says
    how to run it; set to a path that is not there, it fails. It starts the app on a scratch profile and library with
    the debug port, reads every number the written test names, and writes a short report beside the run. No CLI (ADR
    0039), no machine path in the repository, never run in CI (a runner has no installed build and no screen).
  - **The person's half is what no drive can see**: SmartScreen's wording, the installer's own screens, real keys and
    mouse, how the window looks and reads, and the platforms nobody has driven. The written test marks which steps are
    the person's.
  - **A candidate's check is recorded with its release**, as a short table in the draft's notes or a file per tag:
    which build, which steps passed, on which platform, by a person or a drive.
  - **Found by the first drive (2026-10-20), for the written test to catch next time:** ~~an imported character's
    library card reads "Not in your sources: Player's Handbook, …" with AuroraLegacy loaded, because the importer
    records books in `Character.sources` and the card compares them with configured source URLs~~ (fixed the same
    day: the importer records no book there, the library drops what an older import recorded, and
    `imported-sources.test.ts` imports every sample with the corpus configured and holds each card to its one source,
    present; driven in the browser build); the Sheet writes an
    unarmed strike with Strength 8 as "1-1 bludgeoning"; Fire Bolt's attack row reads "—" for damage ("chosen on
    Build, under Spells") though no open decision asked for it; Cairn's library shows "Import from Aurora…" while the
    File menu has it off.
  - **Built 2026-10-27.** [`docs/RELEASE-CHECK.md`](docs/RELEASE-CHECK.md) is the list: fifteen numbered steps, each
    marked "Drive and person" or "Person only" (install, how the window looks, uninstall), and a readings table for the
    Hill Dwarf Wizard 3 it builds (AC 12, HP 26, speed 25, DC 12, +4, slots 4 and 2, passive Perception 11, the unarmed
    strike's and Fire Bolt's rows). The imported sample, the 2014 Fighter 5 in plate (Sample 09), is held to
    `manifest.json`'s readout, and the source's line to `RECORDED_BUDGET`, so a corpus that moves upstream does not need
    the list edited. The drive is `tools/verify/src/release-check.test.ts`, run when `INCUDO_INSTALLED_APP` in
    `.env.local` names the installed `incudo-desktop.exe` (`real-data.ts`; unset it skips and says how, named and missing
    it fails, never in CI). *(Since 2026-10-30 it is `tools/verify/src/release-drive/drive.ts`, run by hand as
    `npm run release:drive -- <its incudo-desktop.exe>` and not by `npm test`: no variable names a file one machine has.
    The two other machine-only cases went the same day: the official sheet is filled only into the stand-in, its flowed
    boxes sized from the map, and the refresh measurement reads `.corpus-base/`, a pinned older AuroraLegacy commit that
    `corpus:sync` and CI fetch.)* It starts the app on a scratch WebView2 profile and library under the system's temporary
    folder with the debug port open, drives the page over it (`release-drive/cdp.ts`) and the file dialogs and the native
    menu by window messages (`release-drive/win32.ps1`: the menu's labels compared with `MENUS`, View → Browse clicked),
    reads every number by its row's label in the text export and never by position, takes its steps and readings from the
    list itself (`release-drive/check-doc.ts`, whose shape a test that always runs holds), and writes `report.md` in its
    run folder. A check is recorded as a file per tag in `docs/release-checks/`; the first is
    [`v1.0.0-rc.2.md`](docs/release-checks/v1.0.0-rc.2.md), the drive run once more on the installed rc.2 (about 85 s):
    every step it can check passed, with the numbers above, all 744 words of the export in the 7-page PDF, a 7-sheet
    preview with no headers option, the Sheet identical offline (16,795 characters), Sample 09 at 21, 44 and 30. Found
    while building it: WebView2's preview reads "Total: 0 sheets of paper" while it lays out, and Windows PowerShell
    prints the menu's "…" in the console's code page unless told UTF-8. Not driven: the folder dialog (the folder is
    written into the profile), real keys and mouse, install and uninstall. Those are the person's steps.
- [x] **The desktop app behaves like an application, not a web page.** Raised by the maintainer after using it
      (2026-09-30). Each part is small; together they are most of why the window still feels like a browser tab. Some
      are Tauri or WebView2 settings rather than page code, and the one that needs a picture already has one:
  - **No right-click menu.** Today a right click opens WebView2's own menu (Back, Refresh, Save as, Print, and Inspect
    in a dev build), none of it the app's. Remove it, and bring a menu back only when a feature belongs in one, as the
    app's own. Either the page declines the `contextmenu` event or WebView2's default menus are switched off from
    Rust; the second also covers a moment before the page has loaded. What goes with it: a text field loses right-click
    Cut, Copy, Paste and spelling suggestions (the keyboard chords stay). Decide whether text fields keep theirs.
    **Done** (2026-10-13): text fields keep theirs, without what is about the page (the maintainer's call). WebView2's
    `ContextMenuRequested` in `src-tauri/src/lib.rs`: off a text field the menu is not shown; in one, only the items
    named on an allowlist stay (spelling suggestions, Emoji, Undo, Redo, Cut, Copy, Paste, Paste as plain text, Select
    all), with a separator only between two groups that keep something. Measured in the window (WebView2 154): Print,
    More tools, Inspect and Writing direction went. Driven in the Tauri window on Windows by right-clicks over the debug
    port and the menu captured with `PrintWindow`; not with a real mouse, and the browser build keeps its menu.
  - **No blank white window while it starts.** The window is shown before the page has drawn anything, so it is white
    until React renders, even in the dark scheme. Tauri's window config has what it needs: `visible: false` and showing
    the window once the first screen has rendered, and a `backgroundColor` so what is shown first is the app's colour
    rather than white (the scheme decides which, so it may be set from the system theme at start rather than in the
    config). A loading screen, if one is still wanted after that, can be plain HTML and CSS in `index.html` that React
    replaces, which covers the browser build as well. **No new artwork is needed**: the window's background is a colour,
    and a loading screen can use the logo in `brand/` (downscaling supplied art is allowed, generating it is not).
    Measure how long the blank window lasts first, cold and warm, so the fix can be shown to work.
    **Done** (2026-10-13). Measured on a release build in the dark scheme, sampling the window with `PrintWindow`: it
    appeared white at 0.15 s (0.41 s cold, a fresh WebView2 profile) and stayed white until 0.67 s (1.08 s). Setting the
    colour in Rust's setup with the window visible changed nothing (setup runs about when the page paints). So the window
    is created hidden (`tauri.conf.json`), coloured by the system's scheme and shown in setup (`src-tauri/src/lib.rs`),
    and `index.html` gives the page its background before the bundle loads (the browser build too). After: no white frame,
    cold or warm; the window appears at 0.6 s (0.95 s cold), already the app's colour, and the first screen draws at the
    same moment as before. `tools/verify/src/desktop-start.test.ts` holds the three copies of the colour to `styles.css`.
    No loading screen was added. Not measured in the light scheme, where the white was already the page's own colour.
  - **The dev server stays off the common ports.** An installed build runs no server: Tauri serves the built files
    through its own protocol (`http://tauri.localhost` on Windows), with no port to collide. Only development does:
    `npm run desktop` and `npm run desktop:app` run Vite on 5173, Vite's own default and the port every other Vite
    project on the machine wants. `strictPort` and `scripts/check-port.mjs` already refuse to move and name the process
    holding it (a dev server that moved would leave the Tauri window blank). Move it to a fixed port no popular
    framework or database uses, named in one place: `vite.config.ts`, `tauri.conf.json`'s `devUrl` and
    `check-port.mjs` all repeat 5173 today, and so do the READMEs and CLAUDE.md.
    **Done** (2026-10-13): 41730, below Windows' dynamic range (49152 and up, where Hyper-V's reservations fall on this
    machine) and clear of the common defaults (Vite 5173, Tauri's template 1420, Metro 8081, Expo 19000+, Node's
    inspector 9229). `apps/desktop/dev-port.json` holds it; `vite.config.ts` and `check-port.mjs` read it, and
    `tauri.conf.json`'s `devUrl`, which cannot read a file, is held to it by `tools/verify/src/desktop-start.test.ts`. Run:
    the browser build and the Tauri window both open on it.
  - **The browser's own keys and gestures, and selecting the text of buttons and headings by dragging across them.**
    **Done** (2026-10-13). Measured first with real key and mouse events (`keybd_event`, `mouse_event`) in the Windows
    window, a release and a dev build, on a scratch WebView2 profile: F5, Ctrl+R and Ctrl+Shift+R reloaded the page;
    Ctrl+F, F3 and Ctrl+G opened a find bar; F7 offered caret browsing; Ctrl+J opened a downloads panel; Alt+Left, the
    BrowserBack key and the mouse's back button went back a page; a dev build's F12 opened DevTools. Already inert:
    Ctrl+plus, Ctrl+minus, Ctrl+0 and Ctrl+wheel (Tauri's `zoomHotkeysEnabled`, false by default, also turns off pinch),
    Alt+Right, the forward button, middle click, Backspace off a field, F11, Ctrl+U, Ctrl+T, Ctrl+H, Ctrl+W,
    Ctrl+Shift+Delete, and Ctrl+Shift+I, J and C (a release build has no DevTools; the keys reach the page as Shift only).
    So `src-tauri/src/lib.rs` switches WebView2's `AreBrowserAcceleratorKeysEnabled` off in every build, and a dev build
    opens DevTools on F12 by hand. After, in both builds: none of those keys does anything; every chord of
    `commands.ts` (Ctrl+1 to 5, Ctrl+comma, Ctrl+N, Ctrl+S, Ctrl+P, Ctrl+Shift+D, O and L) still reaches the page and is
    claimed; typing, Ctrl+A, C, X, V, Z, Y and Backspace work in a text field (the Sheet's name). The mouse's back button
    still goes back, but only over a history entry, and the app never makes one (it was the test's own `pushState`).
    Ctrl+Shift+S, E, M, U, G and X are still swallowed before the page, as ADR 0038 found: not browser accelerators.
    Selection: buttons, labels, legends, summaries and headings are `user-select: none` (`styles.css`), but for the
    Sheet's headings, content's own, Browse's element name and text fields. Dragged with the real mouse in both builds:
    the header's tabs and a pane's heading select nothing (they gave "INCUDO / Characters / Build / …"), prose and the
    Sheet's headings with its rows do; Ctrl+A off a field copies the page without its headings and buttons.
    `tools/verify/src/desktop-window.test.ts` holds the setting, the dev-only F12, zoom off and the two CSS rules. Not
    driven: a real touch pinch (an injected one did nothing, with no control case showing injection works), Esc while a
    load is in progress (the release build loads too fast to catch), the browser build (it keeps every browser key),
    macOS and Linux.
- [x] Stable formats with a real versioning and migration policy — from here on, the system
      format is a public API ([ADR 0011](./docs/adr/0011-user-systems.md)). *Found 2026-10-15, reviewing readiness:* no
      ADR states the policy yet. The character format is at 13 (`LATEST_CHARACTER_FORMAT_VERSION`) and the system format
      still reads 1 after many optional additions; what 1.0 freezes, and what a later change to either must carry, is
      undecided. *Decided by the maintainer the same day, for the ADR to record:* only 1.0's formats are supported; the
      numbers are kept and 1.0's are the baseline (character format 13, or what ADR 0119 makes it), and a file from the
      betas opens if it opens; converting older formats is after 1.0, capped at breaking changes. Waits for ADR 0119,
      which changes the content, system and character formats first. *Recorded 2026-10-28 as
      [ADR 0130](./docs/adr/0130-only-1-0-s-formats-are-supported-its-numbers-are-the-baseline-and-a-newer-file-is-refused.md):* 1.0's baseline is character 14 and every other format (container, content, system,
      feature library) 1, held by `format-versions.test.ts`; a number moves exactly when a reader of the previous one
      would get the new shape wrong without a word, which is the rule the character format followed since ADR 0024; and
      (the maintainer's answer the same day) a file a newer Incudo wrote is refused by every reader with one sentence
      naming why, never opened, since a Save would write back the loss. Measured first: no reader checked a newer number,
      and a character at 15 would have opened and lost its unknown fields on the next Save.
- [x] **Aurora content is converted into Incudo content, and nothing past the conversion knows Aurora**
      ([ADR 0119](./docs/adr/0119-aurora-content-is-converted-into-incudo-content-and-nothing-past-the-conversion-knows-aurora.md),
      accepted 2026-10-15, **built 2026-10-28**). *Built in eight steps, the oracle identical on each:* Incudo's content
      format has a schema, a version and one checker; `convertAuroraSource` turns a source into one file of it, kept where
      the user can open it (Show file), and the library loads only that (no Aurora parse, no invented elements; warnings
      57 to 60, three ids twice in one file now reported); the engine reads none of Aurora's spellings; starting equipment
      is read from the books' prose (86% of the old file's items), a line no item matched waiting as a pending item on
      Build, and the data file is gone; the 5e definition's 34 Aurora ids were reviewed one by one (the average hit points
      option, which nothing declared, is the converter's now); and a second class's multiclass element is implied by
      `advancement` (character format 14). Not done: a phone card for pending items. The maintainer's rule: Incudo converts Aurora files into Incudo files and never reads Aurora
      past that point; reusing Aurora's ids and names is fine, carrying its limitations is not. The readiness review
      found the 5e definition naming 34 Aurora ids, the content library inventing Aurora's app elements on every load,
      Aurora's expression quirks read by the engine at evaluation, and the character format keyed and shaped as
      Aurora's saves are. All of it in 1.0 (the maintainer's call), because 1.0 freezes the formats these live in.
      Decided with it: `packages/aurora-import` is unfrozen and is the converter; no Aurora file is kept; a converted
      source is a file the user can open; unmatched starting equipment becomes a codified pattern only when one covers a
      good share of the misses, a pick when it is generic, and otherwise a pending item the user resolves on Build.
  - [x] **Optional class features and Aurora's additional features are options, not items** (decision 3's last bullet,
        decision 7's "optional features taken as bag entries become recorded choices";
        [ADR 0129](./docs/adr/0129-optional-class-features-and-additional-features-are-options-a-character-chooses-not-items.md),
        2026-10-21). The maintainer, seeing them under the inventory's "Taken on Build": "Those aren't items." The converter
        gives the 83 a type of their own (`Optional Class Feature`, `Additional Feature`, `Ability Score Adjustment`), the
        three equip steps are ordinary sets recorded as choices, the `.dnd5e` import writes a save's equipped ones as those
        choices, and the overlay's three bag proxies are imported as what they stand for (a score adjustment, a language
        added). `equip`, `takenOnBuild` and `hiddenSetter` are gone; beta saves holding them in the bag are not upgraded
        (the maintainer's call). The oracle is identical; driven in the browser build.
- ~~Signed desktop installer for Windows~~ — **not for 1.0** (the maintainer, 2026-10-27: too expensive to make sense
  now). 1.0's Windows installer is unsigned, and its release notes say so, as the candidates' did. Moved to Beyond 1.0's
  "1.x — macOS, Linux and iOS" with the other platforms' signing.
- [x] Docs site, contribution guide, issue templates. *As of 2026-10-15:* the contribution guide exists
      (`CONTRIBUTING.md`); there is no docs site, and `.github/` holds no issue templates. *Done 2026-10-27:* measured
      first, no user guide existed (README's "Try it" is a developer's setup, `docs/SYSTEM-GUIDE.md` is for system authors,
      the rest of `docs/` for maintainers). The maintainer chose the smallest thing: **`docs/USER-GUIDE.md`**, one page
      GitHub renders (install and the unsigned installer's SmartScreen warning, the first run, building, the Aurora import,
      exports and print, where files are kept, reporting a problem), linked from README's new "Using it" section and from
      the issue chooser; no Pages site. `.github/ISSUE_TEMPLATE/`: a bug report (version from About, operating system,
      content sources, steps, expected, actual) and a content or system question that says first that Incudo ships no
      rulebook content and that a source's own content belongs to its publisher.
- [x] `docs/LICENSING.md` complete for every shipped system. *Found 2026-10-15, reviewing readiness:* two things are
      open. 5e's `licence.attribution` (the SRD 5.2.1's CC-BY-4.0 notice) is read by no screen, though LICENSING.md says
      the About screen shows it: About Incudo (`packages/ui/src/about.ts`) names only Incudo's own MIT licence, and rc.1
      was published so. And `cairn` ships in `systems/` while the register reads "structural sketch only; replace the
      content before shipping", with no licence assessed and no `licence` block in its definition. *Done 2026-10-27:*
      About Incudo shows each shipped system's notice word for word under "Game systems" (`systemAttributions`,
      `packages/ui/src/about.ts`); `tools/verify/src/about-attributions.test.ts` fails on a shipped system with no licence
      block, attribution or date, on About leaving one out, and on the apps shipping other systems than `systems/` holds.
      Cairn's licence was read (cairnrpg.com: CC-BY-SA 4.0, every edition; third-party material needs no permission) and
      recorded, and **Cairn is not shipped in 1.0** (the maintainer's call): its sketch is a test fixture in
      `tools/verify/fixtures/systems/cairn`, the tests still build with it, and no app loads it. What shipping it again
      needs is in LICENSING.md and Beyond 1.0's Cairn item.
- [x] Patreon and Ko-fi links in README and in-app About — never on a screen showing licensed material,
      never gating anything. Done 2026-10-07: README's Support section, and an About Incudo section at the foot of
      Settings (the one pane that shows no content), reached from Help > About Incudo too. The words and addresses are
      `packages/ui/src/about.ts`; `tools/verify/src/support-links.test.ts` holds them to README, `.github/FUNDING.yml`
      and the window's capability, which lets the opener plugin open those addresses and no other. The phone has no
      About screen yet.
- [x] **Unsaved edits are never replaced without a word, and nothing points at Build before a character is started**
      ([ADR 0120](./docs/adr/0120-the-shell-knows-whether-the-character-on-screen-is-saved-and-asks-before-replacing-unsaved-changes.md)).
      Found by a hands-on pass on 2026-10-17: Open on the card of the character being edited read the file over the
      edits under a bar still saying "Saved to …", and the Build tab counted a blank character's decisions on a first
      launch. Done the same day: the working state keeps the character as last opened, saved or started, so the bar says
      "Unsaved changes"; Open on that card shows Build without reading the file; New character (now on every pane),
      opening another character and Change system ask "Save first", "Discard changes" or "Keep editing"; before anything
      is started Build and the Sheet say "No character yet" and nothing acts on the blank one. Driven in the browser build
      only. Left: the Build tab still counts optional decisions, and the phone keeps its own check (`edit-session.ts`).
- [x] **Build's decisions read in the order they must be answered, and what shapes the build is asked first**
      ([ADR 0123](./docs/adr/0123-required-decisions-come-first-and-what-shapes-the-build-is-asked-before-it.md)).
      From the same hands-on pass, the maintainer's six calls, done 2026-10-19: required decisions before optional ones,
      which fold under "Optional (N)"; campaign options asked in a dialog when a character is started, and changed
      from the choices made; "Additional features" and "Ability score adjustments" offered only with a campaign option
      that says so; the first level's hit points recorded, never asked; the scores card kept until Done; the card that
      takes the top marked for a moment. Both apps. Driven in the browser build (a wizard started, a Fighter 2 / Rogue 1);
      the phone typechecked only. Left as their own tasks: spells in a tab of their own, a settled choice's editor in the
      middle column, duplicate printings, and the Build tab's count of optional decisions.
- [x] **Spells have a tab of their own, a settled choice is changed in the middle column, and a spell a feature needs is a
      warning** ([ADR 0124](./docs/adr/0124-spells-get-a-tab-a-settled-choice-is-changed-in-the-middle-column-and-a-spell-a-feature-needs-is-a-warning.md)).
      From the same hands-on pass, the maintainer's calls, done 2026-10-19: Change and Edit on what is settled open in the
      middle column with the current answer marked and first, Back or Escape to return; a Spells tab, shown only for a
      character with spells, holds the spell choices, spell attack settings, prepared lists and spells chosen or added;
      an invocation that needs Eldritch Blast is offered with a warning instead of hidden (10 such in the corpus, a kind's
      `softRequirements`); a short window scrolls the pane as one page, picker lists are taller and the description dock
      smaller. Driven in the browser build (a wizard and a Warlock 2); the phone, one page with a spells heading, is
      typechecked only. Left: the top bar's Build badge still counts optional decisions, and ~~duplicate printings~~
      (ADR 0125, below).
- [x] **A character is not offered a second printing of what it has, and two identical rows are told apart**
      ([ADR 0125](./docs/adr/0125-a-system-names-the-types-whose-name-is-the-thing-and-a-character-is-not-offered-another-printing-of-what-it-holds.md)).
      From the UX pass of 2026-10-19 (a cantrip pool took Acid Splash from both Player's Handbooks; an NPC's Traits list
      showed "Agile — Monster Manual (2025)" twice). Measured first: 430 spell names, 82 feat names, 9 proficiency and 6
      language names are printed in more than one book, content links none of the spells, and one book repeats a feat on
      purpose. Done 2026-10-19: a system marks the types whose name is the thing (`identifiedByName`; 5e Spell, Feat,
      Language, Proficiency); both printings are listed until one is taken, then the other is not offered, and the slot
      holding one may change book; the offer to prepare leaves out a second printing; a character holding two is warned
      and unchanged; an addition or a candidate's grant that is another printing is marked; two rows a list would print
      the same name what gives them ("Agile (from Deer)"). Driven in the browser build (a 2014 Wizard's cantrips, a new
      NPC's traits); the phone typechecked only.
- [x] **The Sheet is revamped: laid out as a page, play state where its number is, what another entry covers folded**
      ([ADR 0126](./docs/adr/0126-the-sheet-is-laid-out-as-a-page-play-state-sits-where-its-number-is-and-what-another-entry-covers-is-folded.md),
      proposed 2026-10-19, built 2026-10-28; [mockups](./docs/adr/0126-sheet-mockups.html)). From the UX pass's F8 and the
      maintainer's call that the Sheet needs a full revamp. Measured first: at 1280 × 800 the Play panel fills the first
      screen (479 px for a Wizard 1, 811 px for a Cleric 20) and a level 1 character's Sheet is 7,844 px; proficiencies are
      22 to 85 rows per sample (median 45), 1,196 of the 1,738 granted by another listed proficiency and 213 already marked
      on a save or skill row; 53 of 359 features have no text, 34 of them answered by a choice. Proposed: a kind declares a
      head band, a side column and tabs, and where each section goes; a player character opens on who it is and its
      turn-to-turn numbers, scores with saves and skills beside; proficiencies folded; a feature written with its answer;
      spells a table by level; an NPC drawn as a stat block; play spent in place and the Play panel gone; print the same
      areas flattened. The steps, in order (the ADR has each one's tests and drive):
  1. A report-only test of what the document holds (folds, marks, text-less features, spell setters, creature prints).
  2. Fold, omit marked, answers, and the "Also" line in the sheet document (`fold`, `omitMarked`, `answers`); 5e declares
     them; the Markdown, the phone and the form follow.
  3. The layout declaration (`sheet.layout`, `sheet.tabs`, `place`, `tab`, `tiles`, `under`) in the schema, the
     validator and the document; 5e's three kinds declare it.
  4. The desktop page: head band, side column, tabs, cards, section explanations behind an "i".
  5. Play in place (`PlayTracker.at`), conditions as chips, `PlayPanel` removed.
  6. The Spells tab and `facts`.
  7. The stat block layout for the NPC and legendary kinds (`layout: "statBlock"`, a printed line's `stat`).
  8. Print and PDF for the new areas, with ADR 0078's drive repeated in the window.
  9. The phone: order from the document, the folded lists and stat block lines.
  10. CLAUDE.md and the ADR notes; Beyond 1.0's "A laid-out sheet" removed.
      Ten open decisions are the maintainer's, listed at the end of the ADR: where play lives, the section explanations,
      grouping proficiencies, tabs or one page, text-less features, Worn & Wielded, before or after 1.0, the spell table's
      columns, the stat block's ability table, and how a mark is drawn.
      *2026-10-28: built, every step committed with its tests, and the decisions recorded in the ADR (the maintainer took
      every recommendation; both ability table shapes, opening in the creature's book's, switched by a radio button that
      nothing records). Measured: the samples' proficiencies 22 to 85 a sheet before, 6 to 24 after; 164 play trackers drawn
      where their number is and 120 on the strip; of 141 creatures the printed AC, HP and speed agree with the derived
      number for 122, 131 and 138, the rest written beside the row. Driven in the Tauri window on Windows with a scratch
      profile and library: a Wizard 1 and a Cleric 20 at 1280 × 800 open on who they are, their numbers and their scores;
      play spent in place, saved and read back from the file; a 2025 Imp as a stat block in the 2024 shape; seven PDFs
      holding their exports' words (but headings drawn differently, spell levels once per group, hyphen joins); the print
      step and preview with no headers and footers option. Not done: proficiencies grouped by kind (after ADR 0119), a
      spell's text a click away, passive Perception beside Perception, a level's slots heading its spells. The phone is
      typechecked, not driven.*
- [x] **Drive everything in the Tauri window before 1.0** *(the phone half moved after the desktop 1.0, with the phone's
      release: the maintainer, 2026-10-27; what is left here is the window, for whatever changes before 1.0).* Raised
      2026-10-11, last on purpose. Many
      features were driven only in the browser build (CLAUDE.md says "Driven in the browser build only" fifteen times),
      and the first feature driven in both shells afterwards found two bugs no test and no browser drive could see: the
      Tauri window's dialog plugin makes `window.confirm` async, so a Remove asked nothing, and the phone's number fields
      kept nothing typed until the field was left (ADR 0106's evidence). So: every user-visible feature, walked in the
      Tauri window on Windows and in the phone's development build on the emulator (Expo Go where it differs), each as its
      ADR's own drive describes, with the files read back from disk. Real keys and mouse in the window where the screen is
      free. The inventory starts from every "Driven in…" and "Not run" note in CLAUDE.md, the ADRs and this file. A bug
      found is fixed with a test that fails without the fix where one can, and every note is updated to say what was
      driven where. Done when no feature reads "browser build only" and none is missing from the phone that the phone
      offers. A real phone is driven right after 1.0, before the Google Play listing, and macOS, Linux and iOS after that
      (Beyond 1.0, below): neither is part of this one.
      *The Tauri window half was driven on 2026-10-20* (a fresh WebView2 profile, a scratch library, DOM events over the
      debug port and real keys and mouse where the screen was free; every file written read back from disk, and seven of
      them reopened in the window with every source off to Sheets byte-identical to Node's): the launcher's new, added and
      broken systems; the library's open, save, rename, copy, delete, folder change and unsaved-changes guard; a .dnd5e
      import; Sources (parts, a URL source, a user's file by the dialog and by a real drop, shared ids and order, what is
      missing, switched off, a homebrew source and its editor); Browse; Build (start options, decision order, the Spells tab
      and the middle column, printings, levels and multiclassing on and off, the four score methods, hit points, the equip
      steps, starting equipment, inventory and purse, additions and cast-as, written features and the feature library,
      references, Books); NPCs on a creature, a race and neither, a legendary creature, an NPC as a sidekick; the Sheet,
      play and rests, a held creature, attacks and cantrips; the text and PDF exports, print through its step and the
      official form; the menus, the shortcuts with real keys, the right-click menu, the browser keys, Settings and About.
      Four bugs were found and fixed there. Left: the phone half, macOS and Linux (Beyond 1.0), and what the maintainer's
      own pass covers.
      *What ADR 0119 changed was driven again on 2026-10-29* (a fresh WebView2 profile and a scratch library, DOM events
      over the debug port, the native dialogs by window messages, every file read back from disk in Node): a `.incu` shaped
      as a beta wrote it (sample 03 with Aurora's level keys, the multiclass record and literal negated filters) opened,
      was offered a content refresh that cleared its unplaced infusions, and saved to a file deriving as today's import
      does; a 2024 multiclass `.dnd5e` imported through the real dialog to the file Node's import writes (8 missing in
      both); a user's `.xml` added by Choose files and converted to a file passing the content schema; Browse over both
      sources; a 2024 Fighter's option C (155 gp alone) and Soldier's option A (the book's list, its gaming set chosen);
      a restart loading both sources, Check for updates ("none of 800 files has changed") and a part switched off (738
      files, 0.5 s) and on. One bug found and fixed: a `character.json` that does not derive blanked the window; it is
      refused on the Characters screen now (`characterOpenProblem`, `open-check.test.ts`), by the desktop and the phone.
      *The last pass, 2026-10-29 and 30, done* (a dev window and a release build from the branch, scratch WebView2 profiles
      and library, DOM events over the debug port, the native dialogs by window messages, every file read back in Node): a
      failed source and AuroraLegacy loading behind the panel; a 2014 Paladin 2 / Warlock 1 and a 2024 Cleric 3 through
      every step (point buy and the standard array, starting packages with pending items named and chosen, a pack opened,
      a +1 weapon attached, attunement, buying, spending and exchange refused and made, prepared spells, cantrip rows,
      additions cast as a class, a written feature saved to the feature library, notes, a reference); a 2014 Ranger with
      Deft Explorer and Favored Foe and a Beast Master's wolf; NPCs on a creature and on a race, a legendary creature with a
      user's file and written actions; play spent, saved and rested; text, PDF, print and the official form (a stand-in
      copy); rename, save a copy, delete, the unsaved prompt, a draft after a reload and one of a removed kind; four
      `.dnd5e` imports at their readout; six sheets reopened with every source off equal to Node's; parts, a chosen `.xml`,
      a homebrew source; a starter, an overlay (a broken one named at its line, a slip warned) and a copy; uncounted picks,
      grouped spell lists, embeds and Browse. Then `tools/verify/src/release-check.test.ts` end to end on the release build,
      every step it checks passing. Three things fixed: a stat block's one-row line dropped the row's name ("Senses 13"); a
      system with no source of its own switched on waited for ever on "Loading content" (the starter, or 5e opened with its
      source off); and the release check still expected Cairn, compared the PDF with section headings the laid-out Sheet
      does not draw, raced a fast load, and compared one tab of the Sheet. Found and not fixed, for after 1.0: a 2014
      class's "a martial weapon" offers 2024 and futuristic weapons (the prose reader has no edition filter); a select with
      one candidate and a `default=` (2024 Channel Divinity) is a click; a written feature's description is on no sheet
      (ADR 0063), which a DM's legendary action feels. Not driven: real keys and mouse (the screen was not free), macOS,
      Linux and the phone.

---

## Beyond 1.0

Committed to as *direction*, not scope. Each gets a design doc before work starts.

### 1.0.x — The phone app on Google Play
Right after 1.0, by the maintainer's call (2026-10-11), and first among these. The phone app has only ever run as a
development build and in Expo Go on an emulator; no release build has been made, and a store build is one. What is known
it needs, before anything is decided:
- **A release build that works.** Never built. Things only a release build can answer: a file shared to the app while it
  is closed (a development build's launcher drops the sender's read grant, ADR 0099), Hermes without the dev tools, size.
- **Signing.** An upload key kept by the maintainer, Play App Signing, and where the key lives so that losing a machine
  does not lose the app. Built by CI like the desktop installers, or by hand: to decide.
- **Its icon, splash and store graphics are a person's work.** The app has Expo's stand-ins; `brand/`'s tile is an open
  design decision, and nothing here is generated (CLAUDE.md, "Never generate artwork"). Screenshots of the app are fine.
- **What the listing has to state**: a privacy policy and Play's data safety form (to be checked against the code:
  as built, it fetches the content sources the user adds and sends nothing), a content rating, and what the app reads
  (it ships no game content: the user adds sources). The licensing notes for shipped systems (Phase 9's `docs/LICENSING.md`) are an input.
- **Versioning**: the phone's version beside the desktop's (`app.json` against `tauri.conf.json`), and a version code
  that only rises.
- **Which devices it is driven on before a listing**: the emulator and at least one real phone, which nothing has been
  run on yet.
An ADR first. Not iOS: that waits for the maintainer's environment, as macOS does.
- **Real phones are driven here** (the maintainer's call, 2026-10-12): every feature walked on at least one real Android
  phone, right before the listing.
- **The emulator drive moved here too** (the maintainer, 2026-10-27: the phone's release is after the desktop 1.0): every
  user-visible feature walked in the phone's development build on the emulator, as Phase 9's drive item describes, before
  the real phone.

### 1.x — macOS, Linux and iOS
After 1.0, by the maintainer's call (2026-10-12): none of the three has an environment to run on yet, and testing on them
is not an immediate priority. Linux will probably come first. Until then every "not on macOS or Linux" and "not iOS" note
in this file and the ADRs is an open question of this section, not a gap in its phase.
- **Drive the desktop app on macOS and Linux** as Phase 9 drives it on Windows: the native menus (written for macOS and
  never run, ADR 0037), the shortcuts, the file dialogs and drops, the fetch command, saving and opening a library.
- **"Print sheet…": does it print at all?** Moved from Phase 5. The command calls `window.print()`, which Tauri's own
  documentation says works on every platform. But the same documentation says Tauri's Rust `print()` is only supported
  on macOS, and the wry version the lockfile pins has no handling of the page's `window.print()` in its macOS webview
  that could be found (its macOS print is `NSPrintOperation`, reached only through that `print()`), so on macOS the
  command may do nothing. On Linux wry's `print()` opens GTK's print dialog; whether `window.print()` does the same in
  WebKitGTK is unseen. What settles it: pressing "Print sheet…" and Ctrl+P (⌘P) in the window on each, and, where it does
  nothing, printing through a Tauri command that calls `print()` instead. Neither platform has run any of ADR 0077.
- **Signed installers, Windows included.** The release workflow builds every platform's unsigned (macOS's never
  installed). 1.0 ships the Windows installer unsigned too (the maintainer, 2026-10-27: a certificate is too expensive to
  make sense now); signing any of them waits until it does.
- **The phone app on iOS**: a build, signing, and the App Store, after the Google Play listing has shown what a store needs.

### 1.x — Finding and choosing content
After the first release, by the maintainer's call (2026-10-05). Both were buried in Phase 3's ticked items and found by
the audit described at the end of that phase.
- **Browse filters and links** (the ADR 0053 and ADR 0054 items): filter by tag or setter value ("3rd-level spells",
  "the Wizard list"), say what grants or offers an element beyond a select filtering on one plain tag, and show "also
  defined by" for an id two sources define (Browse shows only the definition that is used).
- **Editions and a default book list** (the ADR 0049 item): a 2014 / 2024 switch over a character's Books list, where the
  two Player's Handbooks are separate books and a table drops one by unticking, and a per-user default list for new
  characters, which today start offered every book.
- **Shorter picker lists** (found by a UX pass on 2026-10-19): Race offers 139 rows, Background 118, a level 1
  Wizard's spellbook 87 spells and a 2014 Fighter's feat list 183, most of them two or three printings of one thing,
  and every row ends with its book, alignments and languages included. Three changes: the character's Books list
  where the choice is made (at the head of Build or in the picker), so a table that plays one edition can narrow it
  there; reprints grouped under one name with an edition chip, so a new player is not left to guess which "Elf" to
  take; and the book left off where every row in a list shares it. After the first release, by the maintainer's call:
  players coming from Aurora are used to long lists.
- **Update notices at launch** (the maintainer's call, 2026-10-22: "definitely post v1"): as Aurora did, check the
  enabled sources for upstream changes when the app starts, and tell the user when content has changed, with Refresh one
  click away. The check exists and runs only on request: each source's "Check for updates" (ADR 0050), one conditional
  request per cached file. To decide: how often, what it says with no network, whether a metered phone asks first (ADR
  0100), and whether it waits until the launch's own load has ended (Build and Browse are blocked during one).

### 1.x — Left from Phases 3 to 5
After the first release, by the maintainer's call (2026-10-12), when every note the ticked items of Phases 3 to 5 left
open was sorted. Each item names where it came from.
- **A source's first download, faster** (ADR 0051). Adding AuroraLegacy cold takes about 25 s, 740 files from a host
  that keeps them five minutes; every later load is under a second from the cache.
- **Saying which source a race or class comes from, when two define it** (ADR 0054). Not a per-id override: two sources
  defining a class may differ in more than one of its elements, so the user names the source the character takes its
  race or class from. Wants more planning than an override.
- **A folder or a zip of Aurora files as one source** (ADR 0056), as another way of reading a source, beside the one
  file a source of today and not in its place.
- **The phone's Sources screen says what the desktop's does** (ADRs 0052, 0054, 0090): what a source refers to that no
  enabled source has, which switched-off source had it, and what two sources share.
- **A written feature that grants elements** (ADR 0063): a line that gives the character a language or a resistance,
  held and removed with the feature. "Added to this character" (ADR 0064) does it today as a separate step.
- **Tracking a held creature's hit points in play** (ADR 0073), and how it is decided: features used mid-play are not the
  priority before 1.0.
- **Searching the text a description embeds** (ADR 0069), soon after 1.0; and **an embed linking to its element**.
- **Levelled spells as attack rows** (ADR 0110's item in Phase 4): by the maintainer's call (2026-10-12), only cantrips
  get rows before 1.0; a levelled spell's dice change with the slot it is cast with.
- **Copying the sheet as text to the clipboard** (ADR 0075), low priority; the text must read clearly as plain text.
- **Cairn**: everything Cairn is after 1.0, first the "Progress" field a level-less Cairn character shows on Build
  (ADR 0074). Since 2026-10-27 Cairn is not shipped (Phase 9's licensing item): shipping it again needs a `licence` block
  (CC-BY-SA 4.0, credit to Yochai Gal), a decision on whether `systems/cairn/` itself is CC-BY-SA 4.0, and the sketch
  checked against the edition it claims (docs/LICENSING.md).

### 1.x — Systems for authors
After the first release, by the maintainer's call (2026-10-09): everything about creating a system or copying one waits
for it. The first two were Phase 7 items, and neither is in its exit criteria.
- **The schema where an author's editor can read it.** The app needs no served schema: it bundles all five and validates
  with the one validator the tests share. Serving one helps only someone writing a system in a text editor, which reads
  the file's `$schema` line. Whether the app hands over its own copy (beside a file **New system…** writes) or something
  serves it is open; `$id` (`https://incudo.dev/schemas/…`) serves nothing today and nothing reads it. The guide's
  `$schema` lines and ADR 0102's note (an editor given the root schema validates an overlay as a complete system) were
  never tried in an editor.
- **A second official system**, licence permitting ([ADR 0010](./docs/adr/0010-licensing-and-funding.md)).
- **An overlay's error inside a formula it replaced, at the overlay's own line.** An overlay merges a `derive` key by key,
  so replacing a formula with one of another shape keeps the parent's `op`, `left` and `right`, and is refused with "In
  <parent>'s part, which something this file changes or removes breaks: …" and no line, because ADR 0103 locates only
  what the overlay writes. Either locate it at the overlay's `derive` and say `null` removes the leftover (amends ADR
  0103; docs/SYSTEM-GUIDE.md section 7 and its test change), or replace a formula whole (an overlay format change, and
  the guide's partial edit would stop working). Measure first how many places hold a formula.
- **Someone who is not the maintainer adds a system without touching engine code**, from docs/SYSTEM-GUIDE.md and the
  app alone: Phase 7's exit criterion, moved here (2026-10-12). What they stumble on is the guide's and the error
  messages' next work.
- **Also left from Phase 7's items:** forking a user's own system from the app, an in-app system editor, overlays of
  overlays and placing a new entry before another.

### 1.x — Writing game content
After the first release, by the maintainer's call (2026-10-15), which closed Phase 8 with what was built: the feature
library (ADR 0106) and the element editor's first slice (ADR 0108). Its content format is decided by ADR 0119 first.
- **The element editor's next parts** (ADR 0108's "Left"): choices (`select`), prerequisites and level gates, which stop
  most feats and class features; races, classes, subclasses, backgrounds and items; turning an add-only library feature
  into content; an editor on the phone, which loads a homebrew source and has none; the Tauri window.
- **Validation and linting with good error messages** over a whole homebrew source, not only the element being saved.
- **Export a homebrew source as a publishable index**, so others can add it as a source.

### 1.x — Localization

- **Localization.** Moved here from Phase 9 (2026-10-13, the maintainer's call: it is after 1.0). No ADR
  covers it and nothing is built for it: every string on screen is English written inline, in
  `apps/desktop` panes and in some `packages/ui` view-models, and counts and dates follow the platform's
  locale only where a pane happened to call `toLocaleString`. Two of the
  places text lives are public formats, and a translation mechanism added after they are declared stable is a
  breaking change to both. Wants an ADR first; what it has to settle:
  - **The app's own text.** Where strings live and which layer owns them: the rule that panes compute nothing
    means a sentence built in a view-model is a view-model's string, and the native menu's labels come from
    `packages/ui/src/commands.ts`. How a missing translation falls back, plural rules (English "1 match / 2
    matches" is hand-written in panes today) and number and date formats.
  - **Derivation problems.** Each `Problem` in `packages/core` carries a stable `code` and an English `message`;
    whether the shell renders from the code and its data, so core stays free of any language, or the message is
    translated where it is written.
  - **System definitions (ADR 0011, a public format).** A system's `label`, `plural`, `description` and sheet and
    step headings are user-facing text written by whoever authored the system: 5e's alone has 219 of them. Whether a
    system may carry translations of its own text, and in what shape, is a system format question, and `plural` as
    a single English word does not survive languages with more plural forms.
  - **Saves (ADR 0012, a public format).** Probably nothing, since a character stores choices and ids, not text;
    to be confirmed, including what a custom feature's name or a written description means in another language
    (it is the user's own words and is not translated).
  - **Content.** AuroraLegacy's elements are English and Aurora import is converted into Incudo content (ADR 0119). Translating game
    content is not Incudo's to do; whether a translated content source a community publishes can stand beside or in
    place of the English one is the open question, and ADR 0054's "the later source wins" may already answer it.
  - **Which languages ship first**, and whether right-to-left is in scope, are the maintainer's call.
  - **The formats will be stable by then.** A system's own translations and anything a save might need arrive
    as a change to two public formats after 1.0 has declared them stable: a `formatVersion` bump with a migration,
    under the policy Phase 9's stable-formats item writes, not a quiet addition.

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
- 🔒 means done **and frozen** — bugfix-only. Nothing holds it today: Aurora compatibility did until ADR 0119
  (2026-10-15) reopened its importer as the converter.
