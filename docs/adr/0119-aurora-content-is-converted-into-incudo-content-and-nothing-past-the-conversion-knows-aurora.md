# 0119 — Aurora content is converted into Incudo content, and nothing past the conversion knows Aurora

**Status:** Accepted 2026-10-15, with the maintainer's answers (below) · **built 2026-10-28** (see "Built", at the end) · lifts ADR 0008's freeze on
`packages/aurora-import` · answers the maintainer's rule "we convert Aurora files to Incudo files", stated
during the 1.0 readiness review · supersedes the "native input format" and "superset of Aurora's semantics" decisions of
[0005](./0005-aurora-import.md) · amends [0008](./0008-aurora-compatibility-frozen.md) (what is frozen),
[0085](./0085-a-source-is-kept-converted-into-incudo-s-own-form-and-loaded-from-that.md) (what conversion means),
[0087](./0087-starting-equipment-is-a-data-file-beside-the-system-and-money-is-counted-in-the-units-the-system-declares.md)
(where starting equipment lives), [0108](./0108-a-user-writes-elements-into-a-homebrew-source-of-their-own-kept-in-incudo-s-content-format.md)
(Incudo's content format becomes the one format) · touches [0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md),
[0072](./0072-a-build-step-may-offer-items-a-character-equips-and-what-it-takes-is-a-bag-entry.md),
[0089](./0089-the-other-hidden-item-families-are-two-more-equip-steps-and-a-player-character-s-sheet-shows-its-other-speeds.md),
[0092](./0092-a-kind-declares-the-text-a-user-writes-about-a-character-and-every-sheet-shows-it.md) · **format:** the
content format gains a schema and a version of its own; the system definition stops naming Aurora's internal ids; a
character format change is likely (decision 7) and lands before 1.0's baseline

## Context

The maintainer's first statement about Aurora was that **Incudo converts Aurora files into Incudo files and does not
read Aurora files directly**. The point of Incudo is to not have Aurora's limitations. Reusing Aurora's ids and names is
fine; what is not fine is Incudo's own formats and engine carrying Aurora's behaviour and shape.

The 1.0 readiness review (2026-10-15) swept the ADRs, the roadmap and the code for where that line is crossed. Nothing
aims at Aurora's app reading Incudo's files (ADR 0008 rules export out, and ADR 0118 states compatibility is not a
goal). The crossing runs the other way: to make an import land without translation, Incudo's own formats and engine
took Aurora's vocabulary and reproduce its app's behaviour at run time.

### What was measured

All of it is read from this repository at `ab2d8db`.

| where | what Aurora brings into Incudo past the import |
|---|---|
| `systems/dnd5e/system.json` | names **34 Aurora ids**: Aurora's app-internal ones (`ID_INTERNAL_OPTION_ALLOW_MULTICLASSING`, `…_ALLOW_FEATS`, `…_ALLOW_AVERAGE_HP`, the armour class, hit point and spellcasting baselines, the four multiclass slot weightings, eleven `ID_INTERNAL_WEAPON_PROPERTY_*` and two weapon categories) and content ids (`ID_WOTC_PHB_CLASS_FEATURE_DRUID_WILDSHAPE`, the Moon druid's Circle Forms, two-weapon fighting in both books, the 2024 two-handed property); its fields read Aurora's setter names (`hd`, `allow duplicate`, `inventory-hidden`, `name-format`) |
| `packages/content/src/library.ts` | on every load of a source whose format is `aurora`, adds the **83** elements Aurora's app invents (`generated-elements.ts`) and derives **146** ability score improvement options from what is loaded (`improvement-options.ts`), and folds `<append>` blocks across sources after each one, withdrawing warnings as targets arrive |
| `packages/content` | five files import `@incudo/aurora-import`; `ContentSource.format` is `'aurora' \| 'incudo'`, so the library branches on where content came from |
| ADR 0085's conversion | stores **what the Aurora parser returned**, per Aurora file, `<append>`s and diagnostics included (`CONVERTER_VERSION` 2). It is a cache of the parse, not Incudo content; `keep: files` still keeps the XML and parses it on every load |
| `packages/core` | Aurora's expression quirks are interpreted at **evaluation**, on purpose, because a save embeds parsed elements: `:half` / `:half:up` in a stat reference (ADR 0046), a `!` at the front of a tag operand (ADR 0048), `$(…)` interpolation resolved through the system's `blockFilters` (ADR 0030), `[character:N]` and `[type:X]` through `heldTypesStat` (ADR 0071), and the `Ritual` tag through `setterTags` (ADR 0047) |
| the character format | race, class and multiclass records are keyed as Aurora's saves key them (`ID_LEVEL_1/select:Class`, `ID_LEVEL_N/select:Multiclass (Level N)`, ADR 0036) and the builder finds them by that shape; Tasha's optional class features and Aurora's "hidden item" switches are taken as **equipped bag entries** because that is the record an Aurora import makes (ADRs 0072, 0089) |
| tests | `freeform-fields.test.ts` holds the system's declared freeform keys to Aurora's save vocabulary |
| `systems/dnd5e/starting-equipment.json` | exists because Aurora's content states starting equipment only as prose, so the data was written beside the system (ADR 0087); it names item ids from about 50 books, many outside the SRD |
| CLAUDE.md | states it as a principle: "5e content in this project *is* Aurora content" |

None of these is a bug. Each was the cheapest correct answer on the day, and each followed from ADR 0005, which
decided that Aurora files are **native input formats, not a migration step**, and that Incudo's model is **a superset
of Aurora's semantics** ("compatibility is worth more than purity here"). That decision is what this ADR reverses.

Why it matters now: 1.0 declares the content, system and character formats stable (the format policy, with character
format 13 as the baseline). Whatever Aurora vocabulary they hold on that day is frozen with them, and every later
capability (a sidekick class, a homebrew editor that writes choices, a second system's content) has to be expressed in
the shape Aurora's app needed in 2015.

## Decision

1. **Two layers, one boundary.** Aurora is an input format and nothing else. A **converter** turns an Aurora source (an
   index and its files) or an Aurora file into an **Incudo content source**, once: when the source is added, refreshed,
   or the converter's version changes. Everything past the converter (the content library, the engine, the system
   definitions, the builder, saves, both apps) reads Incudo content only and imports nothing from the Aurora packages.
   `ContentSource.format` goes; there is one format past the boundary.

2. **Ids and names may be reused as they are** (the maintainer's call). `ID_WOTC_PHB_CLASS_WIZARD` stays
   `ID_WOTC_PHB_CLASS_WIZARD`, and `hd` may stay `hd`. The distinction is about behaviour and shape, not about strings:
   nothing past the converter may depend on something only Aurora's app knew, and Incudo's formats are free to express
   what Aurora's could not.

3. **What Aurora's app did at run time, the converter writes down.** Each of these moves from the library or the engine
   into the converter, and its output is ordinary Incudo content:
   - the 83 app-internal elements and the 146 improvement options, written into the converted source (or into an
     Incudo-authored source the converter adds beside it) as elements like any other;
   - `<append>` blocks folded into their targets, across sources, with what could not be folded reported;
   - `$(…)` filters, `!` negation, `:half`, `[character:N]`, `[type:X]` and `isRitual` turned into Incudo expressions
     the engine reads without knowing their Aurora spelling. Where an Aurora construct needs the character to resolve
     (a `$(…)` naming a casting block), the converter writes Incudo's own construct for it, and the system definition
     declares that construct in Incudo's terms;
   - starting equipment: the converter reads each class's and background's equipment prose and writes it as rules on
     that element in the converted source, matching item names to item ids. `systems/dnd5e/starting-equipment.json`
     goes, and with it every non-SRD id the app ships. What the lookup does not match is handled by decision 9;
   - Tasha's optional class features and the "hidden item" switches become what they are (options a character takes)
     instead of invisible items in the bag.

4. **Incudo's content format is one format, with a version and a schema.** ADR 0108's homebrew bundle (the shape of a
   save's `content.json`) becomes the format of every source: converted, homebrew, and any native source published
   later. It gets `formatVersion` and a JSON Schema in `schemas/`, checked by the one validator. A save's embedded content
   is the same format.

5. **The 5e system definition speaks Incudo only.** Where it names an Aurora app-internal id today, it names an element
   the converter guarantees (the same id string is fine, decision 2) or a field of the system, decided per id. Content
   ids it names (Wild Shape, Circle Forms, two-weapon fighting) are reviewed one by one: a system definition naming one
   content source's element is a dependency on that source.

6. **`packages/aurora-import` is unfrozen and is the converter** (the maintainer's call). It is the same converter,
   not working as it should, so this is a fix and not new work beside it: ADR 0008's freeze is lifted, and the package
   is where Aurora XML and `.dnd5e` saves become Incudo content and Incudo characters. Aurora-only logic now outside it
   (the library's calls to `generated-elements.ts` and `improvement-options.ts`, the `<append>` folding in
   `packages/content`, the evaluation-time quirks in `core`) moves into it. ADR 0008's other decisions stand: import
   only, no export, no speculative support for Aurora formats that will never exist.

7. **The character format follows.** The builder stops finding records by Aurora's key shape. Keys may keep Aurora's
   strings (decision 2), but what a record *means* is said by the format, not by its spelling. Optional features taken
   as bag entries become recorded choices. The `.dnd5e` save import goes through the same converter, so an imported
   character is an Incudo character with nothing Aurora-shaped left in it. This is a character format change, and it
   lands before 1.0's baseline; saves from the betas open if they open (the maintainer's rule).

8. **The oracle stays.** Comparing a derivation with what Aurora wrote (`aurora-oracle.test.ts`, the thirty samples)
   is verification, not compatibility, and it is how the converter is proved: a sample converted and derived must agree
   with Aurora exactly where it agrees today.

9. **Starting equipment the lookup does not match** (the maintainer's call):
   - **A pattern is codified only when it covers a good share of the misses.** "Fine clothes" against an item named
     "Clothes, Fine" is such a pattern; a rule that rescues one line is not worth writing. The measurement of what is
     missed, and how much each candidate pattern rescues, comes before any rule.
   - **A generic line becomes a pick.** "Any one musical instrument" is written as one pick among the items of that
     kind, as "a simple weapon" already is.
   - **What is left is a pending item.** The converter keeps the line's name, and Build shows a "Pending items" card
     listing it. The user decides: pick an item for it, or give it a name of their own, which lands in the bag as an
     entry with that name (an inventory entry's user-given name, ADR 0024), so "fine clothes" may show in the bag as
     "tuxedo".

10. **No Aurora file is kept** (the maintainer's call). A source is downloaded to be converted, and only the converted
    source is kept. ADR 0085's `keep: files` choice and its raw cache go. Converting again (a refresh, or a new converter
    version) downloads again.

11. **A converted source is a file the user can see and open** (the maintainer's call), in Incudo's content format, the
    format every future Incudo source follows, so it is not hidden in the app's storage as ADR 0085's conversion is.

12. **All of it is 1.0** (the maintainer's call).

## Order of work

Each step is held by the oracle being identical before and after, as every engine change here has been.

1. **Measure the converter's input.** Every Aurora construct the library and the engine still interpret, with its count
   in the corpus and where it is read. The table above is the start; the measurement is a test in `tools/verify`.
2. **The content format**: schema, version, validator; a save's `content.json` and a homebrew source read through it.
3. **The converter**: `packages/aurora-import` unfrozen (its FROZEN banner in `src/index.ts` rewritten), writing that
   format, with the run-time overlay, the improvement options and the appends moved into it. The library loses its
   `aurora` branch; ADR 0085's `keep: files` and raw cache go (decision 10); a converted source is a file the user can
   open (decision 11).
4. **The expression quirks** moved from evaluation to conversion, one at a time, each with its own perturbation test.
5. **Starting equipment** written by the converter, after measuring what the lookup misses and which patterns rescue a
   good share of it; generic lines as picks; the rest as pending items on Build (decision 9); the data file removed.
6. **The system definition** reviewed id by id (decision 5).
7. **The character format**: records by meaning, optional features as choices, the save import through the converter.
8. **CLAUDE.md, the ADRs this amends, and docs/ARCHITECTURE.md** rewritten to say where the boundary is.

## The maintainer's answers (2026-10-15)

- **Where the converter lives**: in `packages/aurora-import`, unfrozen. "It's the same converter. It's not working as it
  should. Unfreeze and fix it. This is effectively a bug." (decision 6)
- **A converted source is visible**: future content written for Incudo follows this format, so it should be
  accessible. (decision 11)
- **No Aurora files are kept**: a source is downloaded to be converted. (decision 10)
- **Unmatched starting equipment**: codify a pattern only when it covers a good share of the misses; generic lines are
  picks; the rest are pending items the user resolves on Build, by an item or a name of their own. (decision 9)
- **Scope**: all of it in 1.0. (decision 12)

## Consequences

**Good**
- Incudo's formats and engine are free of Aurora's limits, and new capabilities are written in Incudo's terms.
- A second content ecosystem, or a native one, is one more converter or none, not a second set of run-time behaviours.
- The app ships no data derived from non-SRD books: what a user's Aurora content implies is computed from that content,
  on their machine, when it is converted.
- One content format for converted, homebrew and embedded content.

**Bad / accepted**
- A large change, close to 1.0, across the content library, the engine, the 5e definition and the character format.
- The conversion becomes a real program with its own bugs, where today the parse is faithful by construction. The oracle
  and the 30 samples are what keep it honest.
- Converting starting equipment from prose will miss some lines; they reach the user as pending items, not as silence.
- A refresh, or a new converter version, downloads the source again, since no Aurora file is kept.
- The one package ADR 0008 let the project call finished is open again.
- Saves from the betas may not open in 1.0 (accepted by the maintainer's rule).

## Built (2026-10-28)

All eight steps, each committed with its tests and each held to the oracle: the thirty samples' table of differences is
identical before and after every step (a snapshot on the base, a baseline on the change), every sample still rebuilds
through the builder to its import, and the corpus budget holds. Measured against AuroraLegacy/elements at `c28ce6c`.

1. **Measured** (`tools/verify/src/aurora-constructs.test.ts`, report-only): the 227 elements the library invented on
   every load (81 fixed, 146 improvement options), 169 appends (168 into another file's element), 61 `:half` references
   and 35 `:half` placeholders, 18 negated filter operands, 546 `$(…)` interpolations, 8 `[type:X]` and 55
   `[character:N]` terms, 69 `isRitual` spells, 48 `allow duplicate` setters, 34 Aurora ids in the 5e definition.
2. **The content format** is `schemas/content.schema.json`, `formatVersion` 1, and `checkContentBundle` (core,
   `content-format.ts`) is its one checker. A save's `content.json`, a homebrew body and a converted source are read
   through it. A bundle holds `elements`, `extensions` (rules and tags for an element another source declares: what an
   `<append>` was) and a `source` description (name, address, version, the parts tree, the files in load order, the
   diagnostics, the ETags, which converter version wrote it).
3. **The converter** is `convertAuroraSource` (`packages/aurora-import/src/convert-source.ts`): it walks an index (the
   nested indexes asked for ahead, ADR 0051), parses every file and writes one bundle, Aurora's app elements first and
   the improvement options last. The library loads bundles only (`loadBundle`): no network, no Aurora parse, no invented
   element. `packages/content` no longer depends on `aurora-import`; it is handed a `SourceConverter`, as it is handed a
   `Fetcher`, and `converter-boundary.test.ts` holds that. The conversion is kept as a file (`SourceFiles`, core): the
   desktop's `sources` folder in the app's data folder, the phone's documents folder, and **Show file** on the Sources
   line opens that folder (revealing the file in Explorer answered after 20 s and showed nothing, so it opens the folder).
   `keep: files`, the raw cache, ADR 0085's per-file values and the cached, layered, converted and HTTP sources are gone; a
   refresh converts again from the network, and a file it cannot fetch keeps the previous conversion's copy. Three ids
   the corpus declares twice inside one file are now reported, the later kept: **warnings 57 to 60, 14,317 distinct
   elements.** The corpus converts in about 0.6 s to a 20.5 MB file that reloads in about 0.1 s; in the Tauri window,
   adding AuroraLegacy takes about 25 s.
4. **The expression quirks** are written as Incudo's by the converter (`incudo-expressions.ts`), so the engine reads
   none: a leading `!` on a filter operand is a `not` node of the filter grammar, written at parse; `:half` and
   `:half:up` are `floor` and `ceil` of the stat over 2; `[character:N]` is a requirement on `level`, and 5e's `character`
   stat is gone; `isRitual` is the tag `Ritual` on the spell, and 5e's `setterTags` pair is gone (`setterTags` stays a
   system feature). A sheet text has no expressions, so `{{level:wizard:half}}` stays Incudo's sheet notation
   (`halfPlaceholder`). `heldTypesStat`, `blockFilters` and `repeatableSetter` stay: they are system features 5e uses,
   named in the system's own words.
5. **Starting equipment** is read from each class's and background's prose by the converter
   (`packages/aurora-import/src/starting-equipment.ts`) and written on the element as `startingEquipment`; the kind says
   where it is offered (`kind.startingEquipment`). Measured against the file ADR 0087 wrote by hand, kept as the fixture
   `tools/verify/fixtures/starting-equipment-key.json`: **86% of its 1,137 items are found** (the test holds 85), 146
   classes and backgrounds get a package, and the 2024 pack items' `<extract>` lists agree with 128 of 129 items (the
   2024 Wizard's prose says Spellbook, which that book declares no item for; the 2014 one is used). A pattern was kept
   only where it rescued a share of the misses (an item without its first word, 144; an armour named without "armor",
   34; …); "one of two items" rescued 2 and was dropped. Generic lines are picks (weapons by category, a musical
   instrument, artisan's tools, a gaming set, a holy symbol, an arcane or druidic focus). **What is left is 177 pending
   lines**, recorded when a package is taken and resolved on Build's Equipment & notes tab (the Pending items card) with
   an item or a name of the user's own, which enters the bag as `ID_INTERNAL_ITEM_OWN` ("An item of your own") under
   that name. A 2014 class is offered no wealth roll: its dice are in a table the prose does not carry (the maintainer's
   call), and the purse is set by hand. `systems/dnd5e/starting-equipment.json` and its schema are removed.
6. **The system definition** was reviewed id by id: 11 grants and the Feats, Multiclassing and Additional Features
   options are elements the converter writes itself (kept, as decision 5 allows); 15 weapon property and category ids are
   support tags content writes on a weapon (kept as content spells them); Wild Shape, Circle Forms and the two Two-Weapon
   Fighting features are one source's content, a reviewed dependency that does nothing without it. One was declared by
   nothing: `ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP`, which only a save named, so a built character could never take it.
   The converter writes it now (the maintainer's call), and the start dialog offers Average Hit Points.
7. **The character format** says what a record means: a class `advancement` spends a level on, other than the first,
   holds its multiclass element by that alone (`impliedMulticlassIds`, core), and the importer records race, class and
   background under the kind's build steps (`build/race`, …), not under Aurora's level elements. **Character format 14**:
   a character whose advancement names a second class, or whose starting package records a pending line. The optional
   features as choices were ADR 0129. The `.dnd5e` import goes through the same converter.
8. **This note, CLAUDE.md, docs/ARCHITECTURE.md and the ADRs this amends** (dated notes in 0005, 0008, 0036, 0046, 0047,
   0048, 0071, 0085, 0087 and 0108).

**The converter's elements are 83** (81 that Aurora's app materializes, the average hit points option among them, Incudo's Additional Features option, and the item of
the user's own), **229 generated in all** with the 146 improvement options. `CONVERTER_VERSION` is 9; its guard hashes the
converter's files and core's three grammars.

**What it cost a beta's files** (the maintainer's rule: a file from the betas opens if it opens): a save embedding a
negated filter holds the literal tag until a refresh replaces the element; a character recording a multiclass element
as a choice keeps the record, which the builder drops on its next split; what a beta kept under `content/<source>/` is
removed once the converted file is written.

**Not done:** the phone shows pending lines in a taken package's text but has no card to resolve them yet; a pick reads
items of both editions where the hand-written file named one book; a trailing aside in brackets ("a holy symbol (a gift
…)") is not read past, one line in the corpus.
