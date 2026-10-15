# 0119 — Aurora content is converted into Incudo content, and nothing past the conversion knows Aurora

**Status:** Proposed · 2026-10-15 · answers the maintainer's rule "we convert Aurora files to Incudo files", stated
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
     that element in the converted source, matching item names to item ids, and **reports every line it cannot match**
     rather than guessing (ADR 0005's "diagnostics over guessing" holds: a name lookup with a report is not a guess).
     `systems/dnd5e/starting-equipment.json` goes, and with it every non-SRD id the app ships;
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

6. **What is frozen.** ADR 0008's freeze applies to **reading** Aurora: the XML and save parsers in
   `packages/aurora-import` stay bugfix-only. The converter is new code, not frozen, because it is where Incudo's side of
   the boundary is decided. Aurora-only logic now outside that package (`generated-elements.ts` and
   `improvement-options.ts` as the library calls them, the evaluation-time quirks in `core`) moves to the converter.

7. **The character format follows.** The builder stops finding records by Aurora's key shape. Keys may keep Aurora's
   strings (decision 2), but what a record *means* is said by the format, not by its spelling. Optional features taken
   as bag entries become recorded choices. The `.dnd5e` save import goes through the same converter, so an imported
   character is an Incudo character with nothing Aurora-shaped left in it. This is a character format change, and it
   lands before 1.0's baseline; saves from the betas open if they open (the maintainer's rule).

8. **The oracle stays.** Comparing a derivation with what Aurora wrote (`aurora-oracle.test.ts`, the thirty samples)
   is verification, not compatibility, and it is how the converter is proved: a sample converted and derived must agree
   with Aurora exactly where it agrees today.

## Order of work

Each step is held by the oracle being identical before and after, as every engine change here has been.

1. **Measure the converter's input.** Every Aurora construct the library and the engine still interpret, with its count
   in the corpus and where it is read. The table above is the start; the measurement is a test in `tools/verify`.
2. **The content format**: schema, version, validator; a save's `content.json` and a homebrew source read through it.
3. **The converter**, writing that format, with the run-time overlay, the improvement options and the appends moved
   into it. The library loses its `aurora` branch.
4. **The expression quirks** moved from evaluation to conversion, one at a time, each with its own perturbation test.
5. **Starting equipment** written by the converter; the data file removed.
6. **The system definition** reviewed id by id (decision 5).
7. **The character format**: records by meaning, optional features as choices, the save import through the converter.
8. **CLAUDE.md, the ADRs this amends, and docs/ARCHITECTURE.md** rewritten to say where the boundary is.

## Open questions for the maintainer

- **Where the converter lives**: a new package (`packages/aurora-convert`, importing the frozen parser) or the frozen
  package reopened for it. The first keeps ADR 0008's freeze honest.
- **Whether a converted source is a file the user sees**, exports and can open in the homebrew editor, or stays in the
  app's storage as ADR 0085's conversion does.
- **`keep: files`**: whether a source may still be kept as Aurora XML (reconverted on load) for space, or whether a
  source is always kept converted.
- **Unmatched starting equipment**: shown on the source's line as ADR 0052's missing content is, and offered to the
  user as a plain text line, or left out.
- **How much of this is 1.0**: all of it touches the formats 1.0 freezes, which argues for all of it; the converter's
  breadth argues for a staged 1.0 with the format decisions (steps 2 and 7) first.

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
- Converting starting equipment from prose will miss some lines, and says so.
- Saves from the betas may not open in 1.0 (accepted by the maintainer's rule).
