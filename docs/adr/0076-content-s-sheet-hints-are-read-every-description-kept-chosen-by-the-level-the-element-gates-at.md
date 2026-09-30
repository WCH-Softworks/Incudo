# 0076 — Content's sheet hints are read: every description kept, and the one shown chosen by the level its element gates at

**Status:** Accepted · 2026-09-30 (proposed 2026-09-29) · answers ADR 0074 decision 7 ("reading them is its own decision") and amends it ·
prepares Phase 5's PDF sheet and print layout · builds on [0005](./0005-aurora-import.md),
[0008](./0008-aurora-compatibility-frozen.md), [0012](./0012-self-contained-saves.md),
[0015](./0015-class-levels.md), [0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0046](./0046-preparing-spells-is-a-recorded-list-per-casting-block-and-the-rest-is-derived.md),
[0069](./0069-what-a-description-embeds-is-shown-in-place-and-a-save-carries-it-for-its-text.md),
[0074](./0074-a-kind-s-sheet-shows-its-printed-page-and-every-row-says-what-it-is.md),
[0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md) ·
**format:** one optional field on an element's sheet hints (the `.incu` content bundle, as ADR 0069's embeds); one
optional field on a sheet section in the system format (`formatVersion` stays 1); no character format change; one
field on a derivation (`DerivedCharacter.gateLevels`)

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

### 6. What building it decided (2026-09-30)

- **Where each piece lives.** Core has `sheet-hints.ts`: `sheetDescriptions` (the old-save fallback of decision 1),
  `sheetDescriptionAt` (decision 2's choice: the highest `level` at or below, an ungated description applying from 0,
  the later of two at one level) and `sheetPlaceholders` (`{{stat}}`, trimmed; `{{}}` names nothing). All three read the
  model's own format and name no game. `expression.ts` exports `halfReference`, the `:half` / `:half:up` reading its
  `statNumber` already did, and now calls it, so a sheet asks whether a placeholder names something published through
  the same code. `packages/ui`'s `fillPlaceholders` writes the numbers: a published stat by `formatStatValue`, unsigned;
  a half through core's `evaluateExpr`; a value escaped when it goes into the HTML-ish text.
- **A line break is a line break.** 824 of the 4,753 descriptions write one item per line ("• Bite: …", "• Claw: …"),
  indented as the XML is. HTML runs them together, so `text` keeps one line per line written, trimmed, blank lines
  dropped. The Sheet pane shows it with `white-space: pre-line` after the shell sanitizer; the export writes each line
  as a line of the list item, ending in two spaces so a Markdown reader breaks where a plain-text reader does.
- **A hidden element a section lists anyway is named and has no line** (found by running it: a 2014 sample's header in
  the Tauri window read "Paladin: A holy warrior bound to a sacred oath."). A 2014 class carries sheet text, and its
  `display="false"` says the line is for a feature list content keeps it out of. So in a section that does not declare
  `omitHidden`, a hidden element carries its sheet name if any and no text, usage or action. 46 header lines on the
  samples.
- **`listedName` and `listedUsage`** (`sheet-document.ts`) are the one wording of "**Rage** (Bonus Action; 3/Long
  Rest)": the pane and the export both call them. A listed element is in bold only when content writes it a line, so a
  list of proficiencies reads as it did.
- **The NPC and the legendary creature declare `omitHidden` on "Feats and Features" and "Proficiencies and
  Conditions"**, the same types the player character's two sections list, and **no stat block section declares it**
  (Traits, Actions, Reactions, on those kinds or on a held creature). Measured: creature content hides 9 of 147
  traits and none of 196 actions or 10 reactions; 6 of the 9 are "Primal Bond", which the 2024 book prints in the
  beast's stat block, and the other 3 are Unearthed Arcana spirits no creature names. A stat block is its printed page
  (ADR 0074). On the corpus the NPC declaration moves nothing: those sections hold only what a DM adds (ADR 0064).
- **The validator refuses `omitHidden` on a section that lists no types**, where it would say nothing.
- **What looks personal is not always.** Aurora copies a background feature's description into every save
  (`background.feature.<name>.description`); the sheet now shows content's own copy, and ADR 0075's check that no
  freeform text reaches the sheet read four samples as leaking. A freeform value that is text a held element writes
  itself (its description or sheet text), twenty characters or more, is content's words and is not counted.

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

## Evidence

On AuroraLegacy/elements at `c28ce6c` and the thirty samples. Every perturbation named here was run (patched, run,
restored) and failed the test that names it.

| what | held by | perturbation that fails it |
|---|---|---|
| every raw `<description>` reaches `Element.sheet.descriptions` in order, with its level, usage and action, and `description` is the first text: **4,753 compared, 0 differ** | `sheet-hints.test.ts` (any corpus); `parse-elements.test.ts` | the first description only (220 elements differ); a description's own `usage` unread (8 elements, 11 descriptions) |
| the level each held element's rules read is published, its track's else the character's | `engine.test.ts`; `summarize()` now carries it, so the self-containment, rebuild and reopen tests compare it | every element at the character's level; an element in no track at 0 |
| the choice by level, the old-save fallback, the placeholder reader, the `:half` reader | `packages/core/src/sheet-hints.test.ts` | the first text at every level; the gate compared with `<`; the last in file order; `descriptions` read alone; an untrimmed name; `{{}}` read; the case kept; `:half` rounding up |
| the view: text at the gate level with its own usage and action; `:half:up`, a text stat, escaping, "—" counted; `alt` then `name`; lines kept; `omitHidden` honoured only where declared; a hidden element listed anyway named without a line; the export's bold, parenthesis, lines and markup | `packages/ui/src/sheet-hints.test.ts` (10 cases) | 21, one or more per clause, among them the text chosen by the character's level and the line given back to a hidden element |
| on the samples: each shown text is the one the raw XML gives at `gateLevels`, filled; no shown hint keeps a `{{`; no "—" for a published stat; a hidden element leaves only a section declaring `omitHidden`, and one declaring it lists none; packed and reopened with no source, the same hints | `sheet-hints.test.ts` (any corpus) | the text by character level (sample 17's Font of Magic); braces left; `:half:up` unread; the hint honoured everywhere; `omitHidden` unread; a save embedding elements without their later descriptions |
| `omitHidden` is in the schema, a boolean, and refused beside no types | `schemas.test.ts` | the check removed; the property left out of the schema |

Measured on the samples as built: 2,545 listed elements (creatures' included), **325 with sheet text**, 99 with a
shorter sheet name, 76 with a usage, 64 with an action; **188 hidden elements leave Features & Traits and 10 leave
Proficiencies**; 46 hidden header entries are named without their line; **0 placeholders unfilled**. Before this, the
same sheets listed every one of them by name only.

- **The oracle is identical before and after**: a snapshot on the base commit (`INCUDO_ORACLE_SNAPSHOT`), the finished
  change compared with it (`INCUDO_ORACLE_BASELINE`) on the same checkout, `.env.local` moved aside; the comparison
  proved live by removing one difference from a copy of the snapshot, which failed naming it. The corpus budget is
  unchanged (57 warnings: no sheet description's level fails to read).
- `npm run typecheck` exits 0; `npm test` passes 1,206 of 1,206 with none skipped.
- **Driven in the browser build**: 5e's AuroraLegacy source enabled, a folder dialog and the save dialog patched to
  origin-private folders, "Import from Aurora…" fed samples 17 (2024 Paladin 3 / Sorcerer 3) and 11 (2014 Barbarian 5).
  The Sheet read "Lay On Hands (Bonus Action; 15 HP/Long Rest): …", "Font of Magic (Bonus Action): You have 3 Sorcery
  Points … (2 > 1st, 3 > 2nd)" (the Sorcerer 3 text, not the level 6 one), and Rage's three lines with "+2" filled;
  Tough and the other hidden features were absent from sample 17's features and its header named race, classes and
  background. Sample 17 reopened from the library after a reload with the source switched off showed the same Sheet
  text, character for character, and exported the same file byte for byte; both exports hash equal to the tests' own
  pipeline's. That run predates decision 6's hidden-element fix, and sample 11's header was not read.
- **Driven in the Tauri window on Windows**, with the fix: a fresh WebView2 profile, no source ever added, a scratch
  library of samples 02 (2014 Paladin 3 / Sorcerer 3) and 17 packed by the library's own `packCharacter`, DOM clicks
  over the debug port. Sample 02's header read names only, its Lay on Hands kept its three lines; sample 17's Font of
  Magic read the Sorcerer 3 text. Both exported from the native menu item through the real save dialog (window
  messages: `WM_COMMAND`, `WM_SETTEXT`, `PostMessage` `BM_CLICK`), and both files are byte for byte the tests'.
- **Not exercised:** real keyboard or mouse input; importing into the window (its samples were packed outside it); an
  NPC's or a held creature's sheet lines in either build (the samples assertion covers the held creatures' sections);
  the save dialog's replace prompt and Cancel; macOS and Linux.
