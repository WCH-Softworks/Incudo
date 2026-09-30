# 0076 — Content's sheet hints are read: every description kept, and the one shown chosen by the level its element gates at

**Status:** Proposed · 2026-09-29 · answers ADR 0074 decision 7 ("reading them is its own decision") and amends it ·
prepares Phase 5's PDF sheet and print layout · builds on [0005](./0005-aurora-import.md),
[0008](./0008-aurora-compatibility-frozen.md), [0012](./0012-self-contained-saves.md),
[0015](./0015-class-levels.md), [0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0046](./0046-preparing-spells-is-a-recorded-list-per-casting-block-and-the-rest-is-derived.md),
[0069](./0069-what-a-description-embeds-is-shown-in-place-and-a-save-carries-it-for-its-text.md),
[0074](./0074-a-kind-s-sheet-shows-its-printed-page-and-every-row-says-what-it-is.md),
[0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md) ·
**format:** one optional field on an element's sheet hints (the `.incu` content bundle, as ADR 0069's embeds); one
optional field on a sheet section in the system format (`formatVersion` stays 1); no character format change

## Context

A printed sheet lists a character's features as short lines, "Rage (Bonus Action, 3/Long Rest): …", not as their
rulebook pages. Aurora's content writes those lines itself, in `<sheet>`:

```xml
<sheet action="Bonus Action" usage="{{barbarian rage:count}}/Long Rest">
  <description>In battle, you fight with primal ferocity. … +{{barbarian rage:damage}} damage …</description>
  <description level="20" usage="Unlimited">…</description>
</sheet>
```

The importer parses it into `Element.sheet` and nothing reads it (ADR 0074 decision 7). Phase 5's PDF and print layout
both want it, and ADR 0075's sheet document is where a renderer would find it.

### What was measured

`tools/verify/src/sheet-hints.test.ts`, report-only, on AuroraLegacy/elements at `c28ce6c`, over the raw XML of every
file the load reads (captured through the load's own fetcher, comments stripped) and over the thirty samples' sheets.
Aurora's save records nothing of its sheet, so nothing here has a referee.

| question | answer |
|---|---|
| elements with a `<sheet>` | 5,984; attributes `display` 1,782, `alt` 1,014, `usage` 958, `action` 799, `name` 9 |
| descriptions per sheet | none 1,551, one 4,213, **two to five 220**; on a description, `level=` 332 times, a `usage` or `action` of its own 12 |
| what the importer keeps | **the first description only**: 320 dropped, and the 12 with their own usage or action (Rage's "Unlimited" at 20). What it keeps is exact, CRLF aside |
| a sheet description the same as the element's own | 1,090 of 4,400 |
| markup in a sheet description | an entity in 545 (`&#x2022;` bullets), `<i>` in 58 |
| `usage` | a count per rest (`N/Long Rest` 257, `N/Short Rest` 85, `{{proficiency}}/Long Rest` 169), a resource's name (`Channel Divinity` 71, `Ki` 15, …) |
| `action` | Bonus Action 322, Action 257, Reaction 181, Attack 32, and 8 others |
| `alt` and `name` | a shorter name: "Channel Divinity: Turn Undead" → "Turn Undead", "Feature: Researcher" → "Researcher". The 9 `name=` are Sword Coast backgrounds written in exactly `alt`'s shape |
| placeholders | `{{stat}}` in descriptions and usages: `proficiency` 270, the ability modifiers, `martial arts:dice` 27, … and `:half:up` suffixes |

On the samples (2,729 listed elements):

| question | answer |
|---|---|
| listed and `display="false"` | **314: 188 in Features & Traits** (Spellcasting, Ability Score Improvement, the subclass placeholders such as Arcane Tradition, Tough, Skill Expertise), **116 in the Character header** (every race, class, subclass and background), 10 in Proficiencies |
| a shown element with sheet text | Class Feature 184, Archetype Feature 69, Racial Trait 29, Feat 20, Vision 5, Background Feature 4: **302 of 341 shown features** |
| a shown element with none | Proficiency 1,632, Spell 261, Language 105, Class Feature 39, Background 28, …: their full descriptions are most of the text (proficiencies 139,015 characters, spells 133,053) |
| sheet text per sample | 453 to 4,056 characters |
| stats a shown sheet text names | 107 listed elements name one, and **every one is published** by the character's derivation, `:half:up` read as the engine reads it (ADR 0046). A later description names stats published only from its level on (Sear Undead's count, at cleric 5) |
| level-gated descriptions | 38 listed; in a multiclass sample, **one** reads differently at the character's level and at its class's: Font of Magic on a Paladin 3 / Sorcerer 3, gated 3/5/7/9, whose text is which slot levels sorcery points can make, and that follows the sorcerer's own level |

So: the hints are feature text, short, and fully fillable from what the derivation already publishes; `display="false"`
is Aurora keeping an element out of its feature list, including elements its header names; and the importer loses
exactly the part that changes with level.

## Decision

### 1. The importer keeps every sheet description, with its own level, usage and action

A bugfix, which ADR 0008's freeze allows: the sixth silently dropped construct, found as the other five were, by
counting what the corpus holds. `SheetHints` (`packages/core/src/model.ts`) gains

```ts
descriptions?: { text: string; level?: number; usage?: string; action?: string }[];
```

in the file's order, written only when a sheet has a description. `description` stays, the first one's text, so every
reader of it and every save written before this reads what it read. A reader that finds no `descriptions` treats
`description` as the one ungated description: a save written before this shows its first text at every level, and
saving it again with the source loaded carries all of them (the same trade ADR 0069 made for embeds). The XML reader
already skips comments, so a commented-out description is not one.

### 2. The description shown is the one for the level its element gates at

The highest `level=` at or below that level, else the ungated one; its own `usage` and `action` replace the sheet's.
**The level is the one the engine already reads for the element's own `level=` rules** (`trackLevelReader`, ADR
0015): its class track's level when it follows a class, the character's progression otherwise. A second rule for the
sheet would be a second answer to the same question. The derivation publishes it, `DerivedCharacter.gateLevels`
(held element → level), so `packages/ui` asks rather than recomputes. The one case the samples separate supports it
(Font of Magic above), and it is one case: say "consistent with", never "verified".

### 3. `{{stat}}` is filled from the derivation, and an unpublished one says so

A placeholder is replaced by the stat's value as the sheet writes it (`formatStatValue`, unsigned: `{{proficiency}}/Long
Rest` reads "3/Long Rest"), with `:half` and `:half:up` read by the same code that reads them in an expression (ADR
0046), not a copy of it. Core gets the one reader of the marker, `sheetPlaceholders(text)`, as `descriptionEmbeds` is
the one reader of an embed (ADR 0069); substitution is `packages/ui`'s. A stat nothing publishes is written as "—" and
counted on the view, never guessed (ADR 0005). Measured: none on the samples.

### 4. The sheet view carries it, and a section says whether it leaves hidden elements out

- `SheetListedElement` (ADR 0074) gains `sheetName` (`alt`, else `name`, when either differs from the element's name),
  `text` (the chosen description, filled, still HTML-ish: an entity or an `<i>`), `usage` and `action`, each only when
  content wrote one. The sheet document (ADR 0075) carries them unchanged; the Sheet pane and the Markdown export show
  them ("**Rage** (Bonus Action; 3/Long Rest): …"), the PDF and print layout will.
- **A sheet section may declare `omitHidden: true`** (system format, optional): it leaves out an element whose hints say
  `display: false`. 5e's player character declares it on Features & Traits and Proficiencies, **not on its Character
  header or Senses**: 116 of the hidden elements are the race, class, subclass and background the header names, and
  hiding Darkvision from Senses is what ADR 0074 decision 7 refused. This amends that decision: the hint is honoured
  where it means what it says. A hidden element is still held, derived, saved and listed on Build; nothing but a
  sheet section reads the hint.

### 5. Nothing else reads it

Not the derivation's numbers, not a picker, not Browse. A hint is display.

## What this does not do

- **Draw a stat block or a two-page sheet.** This gives the renderers text to put in the boxes; Phase 5's PDF and
  print layout lay them out.
- **Describe spells, proficiencies, languages or backgrounds on the sheet.** Content writes no sheet text for them, and
  their full descriptions are most of the text: a spell page lists spells, a proficiency box names proficiencies.
- **Tell a player why a number moved.** Tough hidden from the feature list leaves its hit points with no reason beside
  them, as Aurora's sheet did.
- **Track uses.** `usage` is shown as written; counting what is spent is Phase 6's play mode.

## Alternatives considered

- **Keep only the first description and show it at every level.** What happens today, and wrong for 220 features, the
  ones whose numbers grow (Sneak Attack's dice, Rage at 20, Font of Magic's slots).
- **Choose by the character's level.** Simpler, needs nothing published, and disagrees with the class level exactly
  when a multiclass character holds a class feature gated above its class's level; the one measured case reads right
  by class level, and the engine already reads rules that way.
- **Honour `display="false"` everywhere.** Empties the Character header of every sample.
- **Ignore `display` and list everything.** Keeps "Arcane Tradition" and "Ability Score Improvement" (placeholders
  whose real choice is listed beside them) and "Spellcasting" in the feature list of every caster.
- **Fill placeholders in core.** Core would learn how a sheet writes a number; it gets the marker's reader, not the text.

## Evidence (planned)

To be filled in as built, each with its perturbation:

- `tools/verify/src/sheet-hints.test.ts` keeps its report and gains what holds against any corpus: every raw
  description reaches `Element.sheet.descriptions` in order, with its level, usage and action (fails with the importer
  change reverted); every shown sheet text on a sample has no unfilled placeholder the derivation publishes; a hidden
  element never leaves a section that does not declare `omitHidden`; the samples packed and reopened with no source show
  the same texts.
- `packages/core` and `packages/ui` unit tests: the level choice (class track against progression), a description's own
  usage replacing the sheet's, `:half:up`, an unpublished stat as "—", a save written before this showing its first text.
- The oracle's table identical before and after, `npm run typecheck` and `npm test`, and the Sheet and a Markdown export
  driven in the browser build and the Tauri window, including a save reopened with no source.
