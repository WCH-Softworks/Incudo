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
- [x] **Differential verification**: `incudo aurora verify` (now `tools/verify/src/aurora-oracle.test.ts`) re-derives each imported character
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
        asking, and nothing tracks unsaved work yet. **"Save a copy…" was left out on purpose** and
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
        **Open, and left visible:** the overlay's `ID_INTERNAL_OPTION_ALLOW_MULTICLASSING` is an
        `Option`, so it is offered, and **nothing reads it** — 0 of 740 files, and the class
        control is deliberately not gated on it (ADR 0036). Ticking it does nothing, which is
        misleading on screen. Not fixed by naming an id in the builder: either the class control
        starts honouring it, or the overlay stops calling it an option. A decision, not a bug fix.
        Touches the system definition format, which is why it is an ADR and not a commit.
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
      UI: nothing here puts a bag on a screen.
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
      `choices`. Found while doing it and fixed afterwards, in the builder and not the frozen
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
      slot is gone — documented behaviour, easy to trip over. **Not verified:** a save of this
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
      table content does not carry (Aurora's screen reads 0 and so does Incudo); the Wizard's minimum of one; a
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

- **Nothing checks that a recorded choice was legal for the slot it fills.** A `select` pool is
  keyed on (element, name) and its allowance is the sum of the active rules', but 89 groups in
  the corpus have rules that differ in `supports`, `requirements` or `type` — a wizard's first
  six spellbook entries are 1st level and the two it adds each level afterwards are not. The
  pending pool offers the union of the candidates of the rules with room left, and a pick
  recorded against the wrong rule is accepted in silence. Wants a builder before it matters.
- **One grant cannot cancel another.** A Mithral Armor adornment suppresses its host armour's
  `ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE`, and no content file expresses that — it is Aurora
  app behaviour. It is 2 of the 55 `element-extra`, and a set of real saves carry the control case:
  plate with no mithral does keep the marker. Not invented (ADR 0005).
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
- **An NPC or legendary creature still has no way to set ability scores.** Both kinds declare a
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

## Phase 3 — Content story 🟡

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
      the Tauri window and the browser build on Windows. **Not done:** anything that makes the element files faster;
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
      Driven in the Tauri window and the browser build on Windows. **Not done:** real keystrokes in the window (the
      screen was locked; Ctrl+5 was sent by the menu and as an injected event); filters by tag or setter ("3rd-level
      spells"); what grants an element; macOS and Linux.
- [ ] Conflict resolution when two sources define the same ID
- [x] **Say when a source refers to content no enabled source has** ([ADR 0052](./docs/adr/0052-a-source-that-refers-to-content-no-enabled-source-has-is-reported-and-never-blocked.md)).
      Any inner index can be added as a source, and 58 of AuroraLegacy's 60 grant ids only another declares: the 2014
      Player's Handbook alone refers to 110 missing things and offers no skill at all, and used to do it in silence. Each
      source's line on the Sources pane now says how many things it refers to that no enabled source contains, and how
      many of its additions wait for a target, with the ids behind a click. Never enforced, never a guess at which source
      is missing; requirement-only references are left out, since content writes those on purpose. Running it removed
      "it may need another source enabled", wrong on AuroraLegacy's own line, whose one missing thing is an upstream
      typo. Driven in the browser build on Windows. **Not done:** naming a configured-but-disabled source that declares
      what is missing; Incudo's own content format, which will declare dependencies (the ADR says what it must carry);
      the Tauri window, macOS and Linux.
- [ ] Choose parts of a source (a tree of its indexes) before loading it. Adding one inner index as a source already
      works; the report above is what makes a partial choice safe to make.
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
      switch; no per-user default for new characters; macOS and Linux not driven.
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

- [ ] `schemas/system.schema.json` published, with in-app validation and any other checker
      sharing one implementation (`incudo system validate` goes with the CLI — see Phase 2)
- [ ] **Fork** an official system into user space
- [ ] **Overlay** an official system (`extends` + patch), so house rules survive upstream updates
- [ ] Scaffold a working system from the app's system flow, never an empty file (this was
      `incudo system new <id>` until the CLI was scheduled for removal — see Phase 2)
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

- [ ] **Release pipeline: main builds the installers and puts them on GitHub.** Does not exist
      yet, **and is not added until the first release candidate is cut** — the commit that cuts RC1
      adds the workflow, so nothing before it can start one. Until then `ci.yml` (typecheck, test,
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
  - **Not verified when written:** nothing here has run. Ticked on a real RC tag that produced
    installers, downloaded from the release page and installed, not on a green workflow.
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
