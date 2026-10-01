# 0079 — A PDF sheet is the print layout written to a file, and the official form is the user's own copy, filled from the document

**Status:** Accepted · 2026-09-30 (proposed the same day) · being built: decision 4's proficiency marks and levels per class the same day (decisions 6 and 7), a spell's level and prepared mark and hit dice per class on 2026-10-01 (decisions 8 and 9), "Export sheet as PDF…" the same day (decision 10) · answers Phase 5's "PDF character sheet (fillable official sheet + a clean Incudo sheet)"
· builds on [0012](./0012-self-contained-saves.md), [0037](./0037-a-command-is-data-the-page-owns-the-keyboard.md),
[0038](./0038-a-copy-goes-through-a-save-port-and-changes-nothing-else.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0056](./0056-an-aurora-file-the-user-adds-is-a-source-of-its-own-kept-as-a-copy.md),
[0074](./0074-a-kind-s-sheet-shows-its-printed-page-and-every-row-says-what-it-is.md),
[0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md),
[0077](./0077-a-printed-sheet-is-the-sheet-pane-under-a-print-stylesheet-and-its-sections-flow-in-columns.md),
[0078](./0078-a-print-is-chosen-in-a-step-of-the-app-s-own-and-no-edge-of-the-page-is-left-to-the-dialog.md) ·
**format:** none yet (decision 4 grows the sheet document; decision 5 may want a system format field, decided when it is
built)

## Context

Phase 5's PDF item is one line: "fillable official sheet + a clean Incudo sheet". Since it was written, ADRs 0077 and 0078
made "Print sheet…" print the Sheet through the platform's own dialog, after a print options step of the app's own, with
no edge of the page left to the dialog's headers and footers; that dialog's "Save as PDF" already writes a PDF. So the
question is no longer how to make a PDF, but what a PDF export adds to printing, and whether the official sheet can be
filled at all.

### What was measured

**The official sheets.** D&D Beyond's character sheet page (the old `dnd.wizards.com/resources/character-sheets` now
redirects there) offers, among others, a 2014 "Fillable Character Sheet" (`dnd_5e_charactersheet_formfillable.pdf`, 388,396
bytes) and the 2024 sheet (`DnD_2024_Character-Sheet.pdf`, 16.4 MB). Both were downloaded once, with the maintainer's
leave, into a scratch folder outside the repository, read, and not committed:

| | 2014 fillable | 2024 |
|---|---|---|
| pages, paper | 3, US Letter | 2, 603 by 774 pt |
| form fields | **334**: 210 text, 124 check boxes; no XFA; Helvetica at automatic size (`/Helv 0 Tf`), not embedded; no appearance-regeneration flag; 12 field names with a stray space | **none**: a sheet to print and write on |
| notice printed on it | "TM & © 2014 Wizards of the Coast LLC. Permission is granted to photocopy this document for personal use." | "TM & © 2024 Wizards of the Coast LLC." |
| how it lays out proficiencies | one box, "other proficiencies & languages" | "Equipment Training & Proficiencies": armour training as four boxes (Light, Medium, Heavy, Shields), then Weapons and Tools; Languages on their own; features split into Class Features, Species Traits and Feats; a spell table with level, casting time, range, Concentration/Ritual/Material marks and notes |

The 2014 file's SHA-256 is `37e63eb0e4d2b58b28f4aea1b1465eb77567ebb72ee64deb8d96c0cdfc13f605`; its metadata says it was
made in 2014 and last modified in 2014, while the host says August 2024 (it moved hosts then). Neither sheet is part of the
SRD (CC-BY-4.0); each is published on its own under its own notice.

**The terms**, read (through a page summariser, so close to but not guaranteed verbatim) on 2026-09-30:

- **D&D Beyond's Terms & Conditions** (updated 2026-06-25) cover "the dndbeyond.com website and mobile applications,
  associated software … and all digital tools, content, or Services", grant a personal, non-commercial licence, and in
  §5.2 forbid "automation software, bots, … scripts, … extraction tools, or any other unauthorized software", and
  "modifying, merging, distributing … or creating derivative works" without permission.
- **Wizards' general Terms** (updated 2025-12-10), §2.2: no "unauthorized means, process, or software that accesses,
  collects … including … scripts", and no "unauthorized connection … using third-party programs or tools not expressly
  authorized by Wizards".
- The sheet's own notice permits photocopying for personal use. Nothing grants redistribution, or software fetching the
  file.

So: the file cannot ship with Incudo, and **Incudo fetching it from D&D Beyond's host on a user's request is, to the letter
of both terms, unauthorised software connecting to the service**, however small the file. A user downloading it in their
own browser is not. Filling a copy the user already has, on their own machine, never touches the service; it is what a
form-fillable PDF is for, and what any PDF reader does when the user types into it, within "personal use". This record is
not legal advice.

**What other projects do** (forums and repositories, 2026-09-30): a Foundry VTT module that fills the official 2014 and 2024
sheets ships neither and says "Due to licensing and copyright rules I can't bundle the official sheets in the module, so you
supply your own copy"; two MIT-licensed fillers on GitHub (`dndfiller`, `DnD-CharacterSheet-Generator`) have the user save
the PDF beside the script, and commit none. The cautionary case is MPMB's character record sheets, taken down from the DMs
Guild at Wizards' request and reissued with SRD content only, which was about the rules text in them, not a sheet design.
A D&D Beyond forum thread on the 2022 terms' data-mining clause has no staff answer.

**What the sheet document gives the 2014 form.** `tools/verify/src/pdf-sheet.test.ts`, report-only, committed on the commit
before this record, on AuroraLegacy/elements at `c28ce6c`. It lists the form's boxes in its own words (334 fields, a test
holds the count) and reads `sheetDocument` for the thirty samples (found with `samplesWhere`):

| per sample | fields |
|---|---|
| filled from the document | 46 to 165 (median 155) |
| filled in part, the form's shape not fitting | 0 to 107 (median 1) |
| empty for that character (no spells, no weapon in hand, no alignment) | 1 to 118 (median 5) |
| **never in the document** | **167** on every sample |

| what the document lacks | fields | where it is instead |
|---|---|---|
| save and skill proficiency marks | 24 check boxes | the derivation (`<ability>:save:proficiency`, `<skill>:proficiency`): 6 to 11 marks a sample |
| spell prepared marks | 92 check boxes | `Character.prepared`, on 13 samples, 3 to 21 spells |
| spell level (the form is by level) | (100 lines) | each spell element's `level` setter; the Spells section lists names |
| levels per class | (1 line) | `Character.advancement`; the document has the character level and the class names (8 multiclass samples) |
| personality, ideals, bonds, flaws; backstory; coins; experience | 11 | the importer's `freeform` (on 18, 18, 30, 30 samples); ADR 0075 keeps it out of the document on purpose |
| hit dice, attack bonus and damage, attacks and spellcasting notes | 9 | the classes' `hd` setters, nothing, the importer's attack notes (6 samples) |
| current and temporary hit points, slots expended, inspiration, death saves | 12 text, 6 checks | play state, which nothing records (Phase 6) |
| player name, appearance, allies and faction, treasure, additional features and traits, portrait | 13 | nothing, or `assets` (no sample keeps a portrait) |

Where the form's shape does not fit: **proficiencies and languages overflow their box on 29 of 30 samples** (486 to 2,592
characters against about 750 at 7 pt) and features and traits on 12 (up to 4,409 against about 2,160); the form has one
casting block and 7 samples have two or three; 4 samples have more spells at one level than the form has lines (13, 14
and 15 first-level spells against 12; 9 cantrips against 8). No weapon list is longer than its three lines. No character on
any sample, creature or Cairn sheet is outside the form font's WinAnsi encoding.

There is no official form for the other kinds. An NPC's or Legendary Creature's document is 6 to 12 sections, a stat block,
and Cairn's is two (its fillable sheet's text is CC-BY-SA 4.0; not downloaded or read here).

**What the print path already gives.** The print layout of 0077/0078 printed with `Page.printToPDF` in headless Edge 154 on
the dev server (the browser build), six packed characters (Samples 01, 03, 06, 17, 26 and an NPC on the Triceratops), no
content source, five ways each (30 PDFs):

| | result |
|---|---|
| A4 against Letter | **the same page counts** for all six (1, 3, 3, 3, 4, 3); every word in both (one word differs on one sample, a line break) |
| the dialog's headers and footers forced on (`displayHeaderFooter`) | **no date, title or address** on any page (ADR 0078 holds) |
| Letter paper with a scratch `@page { size: A4 }` and `preferCSSPageSize` | **A4 pages**: a page rule sets the paper whatever paper the call is given |
| fonts, text | the page's font embedded as a subset (Segoe UI on Windows); every word selectable |
| cost | 0.17 to 0.33 s and 47 to 120 KB a sheet |

And what it cannot do, by the reading of ADRs 0077 and 0078: the platform's dialog is always between the command and the
file; its file name is the page title the app sets while printing; the browser build gets the same dialog; the paper is
the dialog's (a printer's default, or Letter once "Save as PDF" is chosen) unless a page rule says otherwise; and **the
preview's Margins list (Minimum, Custom) undoes ADR 0078's page rules, brings the dialog's headers back on page 1, drops the
app's page numbers, and is remembered for the next print**. A PDF saved through the dialog is only as right as that list
was left.

**What a dialog-free PDF would take.** WebView2 has `ICoreWebView2_7::PrintToPdf` and `ICoreWebView2_16::PrintToPdfStream`,
with print settings for paper width and height, margins, backgrounds, scale and `ShouldPrintHeaderAndFooter`. The lockfile's
`webview2-com-sys` 0.38.2 binds them, and Tauri 2.11.5's `with_webview` hands a command the platform webview (its
`controller()` on Windows), so a Rust command in `apps/desktop/src-tauri` can reach them. Windows only; not built or run
here. macOS's and Linux's webviews have their own print-to-PDF calls, unseen.

**What filling a form would take.** A PDF form writer: none in the repository. A library belongs in `apps/desktop`, which
may import anything; `packages/ui` may import only `react` beside the workspace packages, and `core`, `content` and
`aurora-import` would need an ADR for any runtime dependency (CODE-REUSE-POLICY). The form names its fields; which field
takes what is a fact about one game's form, and the engine and the view-models name no game.

## Decision

### 1. Incudo's own PDF is the print layout, written to a file

The maintainer's call (2026-09-30): the PDF does not differ from the print. "Export sheet as PDF…" writes what "Print
sheet…" prints, with the same print options step (ADR 0078) first: the same parts, page numbers and running name, under the
same print rules, which are the only layout. No PDF renderer, no PDF-only rules. A PDF has a paper, so the step offers one
more choice when it leads to a PDF, **A4 or Letter**, remembered with the other print options; it reaches the page as a
page rule (`@page { size }`, measured to win), not as a second layout. The page counts did not move between the two on any
character measured.

### 2. It is written without the print dialog, on Windows first

The maintainer's call: a Windows-only path at first is acceptable. In the Tauri window on Windows, a Rust command prints the
page with WebView2's `PrintToPdfStream` (headers and footers off, the paper chosen, margins zero so the page rules decide)
and hands the bytes back; the page saves them through ADR 0038's `FileSaver`, so the user picks the file name in the system's
save dialog, and no print dialog or preview is involved. That is what a PDF export adds to "Save as PDF": one step, a file
name the user chooses with the character's name suggested, a paper the app chose, and nothing the preview's Margins list can
undo.

`packages/ui` knows a port, not WebView2: a PDF writer the shell may supply (`core/platform.ts`, beside `FileSaver`). The
command is enabled on the Sheet only (ADR 0037), and only where that port exists. Where it does not (the browser build, and
the Tauri window on macOS and Linux until those are seen), there is no "Export sheet as PDF…": "Print sheet…" and the
dialog's "Save as PDF" are the PDF there, as now. macOS and Linux stay open roadmap items; nothing here plans them.

### 3. The official sheet is the user's own copy; Incudo never ships or fetches it

The maintainer's call (2026-09-30), after the terms above: Incudo keeps its own sheet, and a user who wants the official 2014
form points Incudo at their own copy. Incudo:

- **never ships it, never downloads it**, and never sends it anywhere. It links to D&D Beyond's character sheet page
  (`https://www.dndbeyond.com/resources/1779-d-d-character-sheets`) for the user to download it in their own browser. The
  shell opens the link in the user's browser (an opener the Tauri build does not have yet), or shows it to copy.
- **keeps the picked copy** in `Storage` beside a user's own source files (ADR 0056's place for a user's file, not a
  cache), so it is picked once, and removable.
- **recognises the form by its fields, not by its bytes**: a file whose field names and types are the 2014 form's 334 is
  accepted, anything else refused with a sentence. A hash would refuse an identical form re-saved by a PDF reader; the fields
  are what filling depends on.
- **fills a copy and saves it through `FileSaver`**, leaving the user's copy untouched. Filled values get their appearance
  written, so the file reads the same in every viewer, and not only in those that redraw form fields.

Only the 2014 form: the 2024 sheet has no fields, and laying text over its artwork would be writing on Wizards' design rather
than filling a form. Not the NPC, the Legendary Creature or Cairn: Wizards publishes no form for them. Cairn's CC-BY-SA sheet
could use the same mechanism later, when someone reads it.

### 4. The form is filled from the sheet document, and the document grows to hold what a sheet needs

The maintainer's call: the official form is a renderer like the others (ADR 0075 decision 1) and reads only `sheetDocument`;
what it needs and a player wants anyway is added to the document, so the Sheet, the print, the text export and Incudo's PDF
show it too. In that order, each its own change and its own measurement:

- **Save and skill proficiency marks**: a row says whether the character is proficient (and has expertise), from the
  `…:proficiency` stats the derivation already publishes. ADR 0074 listed it as not done.
- **Levels per class**: the Character section names each class with its level, from `advancement`; "Paladin 2 / Sorcerer 4"
  fills the form's one line and reads better on every sheet. *(Built from what the derivation publishes per track, not
  from `advancement`, which a single-class character does not record: decision 7.)*
- **A spell's level, and whether it is prepared**: a listed spell carries its level (its element's setter) and a prepared
  mark (`Character.prepared` and always-prepared, ADR 0046), so a sheet can list spells by level as the 2014 and 2024 sheets
  both do.
- **Hit dice**: per class, from the classes' `hd`, as both official sheets print it.

**Proficiencies grouped as the 2024 sheet groups them** (armour training, weapons, tools, then languages) is the 1.x
"Proficiencies are not a list of words" item, which the 2024 sheet now gives an official model for. Not here: a first count
finds a group tag on 140 of 198 proficiency elements (Weapon 61, Tool 55, Skill 18, Saving Throw 6) and none on the other
58, armour among them, so what content declares has to be measured first, as that item says.

**Kept out**, and blank on the form: the importer's personal text (`freeform`: personality, backstory, coins, experience),
which ADR 0075 kept off the document on purpose and which wants its own decision about showing it at all; play state (Phase
6); the player's name and appearance, which nothing records.

### 5. Which field takes what is the system's data, read by a kind-agnostic filler

The engine and the view-models name no game, and a form's field names are one game's. So the map from the form's fields to
the document (a field takes a row's value, a row's beside, a mark, a section's names by type, the n-th spell of a level) is
data shipped with the 5e system, beside `system.json`, and a function in `packages/ui` (`formValues(document, map)`, under
`node --test`) turns a document and a map into field values, knowing nothing of 5e. The PDF library that writes them is in
`apps/desktop`. Whether the map is a system format field (a public API, ADR 0011) or a file the shell reads beside the
system is decided when it is built; the map names Wizards' field names, which is describing their form, not copying it.

**Where the form does not fit** (measured above): what overflows a box is not shrunk below legibility. Features continue in
the form's own "additional features & traits" box on page 2; anything else that does not fit (a second casting block, spells
past a level's lines, proficiencies past their box) is left off the form, and the export's result line names what was left
off and says Incudo's own sheet has it. A character the form's font cannot write is named the same way, never dropped
silently.

### 6. What building it decided (2026-09-30)

**Proficiency marks** (decision 4's first item), measured first by `tools/verify/src/proficiency-marks.test.ts`
(report-only on the commit before them, on AuroraLegacy/elements at `c28ce6c`):

| rows | the row's `…:proficiency` over `proficiency` | ratio and contributions disagree | something else added (`…:misc`) |
|---|---|---|---|
| the thirty samples, 720 | 0 on 507, **1 on 203** (all bucket `proficiency`), **2 on 10** (`proficiency` and `double`) | 0 | 27 (Jack of All Trades and the like) |
| the creatures five samples hold, in their scope, 120 | 0 on 110, 1 on 8, 2 on 2 | 0 | 0 |
| every creature as an NPC, 3,384 | 0 on 3,084, 1 on 268, 2 on 32 | 0 | 0 |

Content writes a proficiency as the bonus into the row's `…:proficiency` and expertise as a second one in the `double`
bucket; Jack of All Trades' half bonus goes to `…:misc`. So a mark is a count, and the engine never needs the word:

- **A sheet section may declare `mark`** (system format, optional; `formatVersion` stays 1): `stat`, a row template
  (`"{stat}:proficiency"`), `per`, the stat counted (`"proficiency"`), and `labels`, what one, two, … are called.
  `renderSheetSection` publishes each row's mark stat aligned with the rows `showWhen` keeps, block placeholders resolved,
  as it does `beside`. The validator refuses a `per` the kind does not declare, a `stat` with no `{stat}`, no labels, and a
  mark on a section with no rows. **The row's own stat is not required to be declared**: content supplies 5e's
  `<skill>:proficiency`, which `pc` never declares, and declaring 24 stats would add them to every derivation's summary for
  no reader.
- **`SheetRow.mark`** is `{ label, count }`, only when the row holds at least one whole multiple and `per` is positive
  (`rowMark`, `packages/ui/src/sheet.ts`); more multiples than labels read as the last label. **`rowAside`**
  (`sheet-document.ts`) is the one wording of what follows a value, "+7 (expertise)", "18 (+4)", beside and mark joined in
  one pair of parentheses; the pane and the Markdown both call it, so the print shows it too.
- **5e's `pc` declares it on Saving Throws (`["proficient"]`) and Skills (`["proficient", "expertise"]`).** Not on the NPC,
  the Legendary Creature or a held creature's stat block, though measured clean on all three: a book's stat block prints
  proficient skills and saves only (`showWhen` already does) and marks none. A declaration away when a sheet wants it.
- Nothing derives differently: the system definition is not embedded in a save (ADR 0022), so every save, those written
  before this included, shows its marks. The oracle cannot move (no derivation changed).

Evidence: `tools/verify/src/proficiency-marks.test.ts` now asserts, against any corpus, that every sample's save and skill
rows carry a mark exactly when and as the derivation's proficiency stat reads (203 proficient, 10 expertise), and fails
when the mark is read from the row's value instead; `packages/core/src/system.test.ts`, `packages/ui/src/sheet.test.ts`,
`sheet-document.test.ts` and `tools/verify/src/schemas.test.ts` each fail under their named perturbations (the mark not
published, not aligned with `showWhen`, not counted against `per`, not clamped to the last label, a zero `per` dividing,
the mark left out of a row's wording, the validator removed). The PDF coverage test now counts the 24 mark boxes as
filled on all thirty samples: fields filled a sample go from a median of 155 to 179, and 143 are never in the document.
Driven in the browser build (headless Edge on the dev server, every click injected over the debug port, six characters
packed before the change): the Sheet reads "Stealth +10 (expertise)" and "+5 (proficient)" where the samples are
proficient, the Triceratops nothing, and the printed PDFs carry the same words on the same page counts as before. Not in
the Tauri window.

### 7. What building it decided: levels per class (2026-09-30)

**Levels per class** (decision 4's second item), measured first by `tools/verify/src/class-levels.test.ts` (report-only on
the commit before them, on AuroraLegacy/elements at `c28ce6c`): over the thirty samples, 22 single-class and 8 multiclass,
every one of the 40 classes held has a track stat, `level:<name>` as the progression's `trackStatPattern` names it, whose one
contribution is the class element; it agrees with the manifest's split on all 40, with `gateLevels` on all 40, and the
counts add up to the character level on all thirty. A single-class character publishes its count from its implicit track
(ADR 0044 decision 5), so `advancement`, which it does not record (ADR 0036), is not needed, and nothing is recomputed. The
Character section already listed the classes in the order first taken, the interleaved Rogue/Wizard included.

- **A sheet section may declare `trackProgress`** (system format, optional boolean; `formatVersion` stays 1): a listed
  element a track is rooted on carries that track's count. Core's `trackProgress(progression, element, stats)` reads the
  stat `trackStatKey` names and returns its value **only when that element contributed it**, so a stat content writes
  under the same name, or an element that merely shares a track's name, reads as none. The kind already said where a
  track's count is (`trackStatPattern`); the section says where it is shown. No game noun in core or `packages/ui`.
- **`SheetListedElement.progress`** holds it (`sheetSections` reads the kind's progression through
  `SheetVocabulary.progression`; a creature's scope passes none). **`listedName` writes it after the name the sheet gives
  the element**, "Paladin 3", so the pane, the print and the Markdown export name it one way. Joining the classes into the
  form's one line ("Paladin 3 / Sorcerer 3") is the form filler's, decision 5.
- **The validator refuses** `trackProgress` on a section listing no types, on a kind whose progression publishes no
  track count (no `trackStatPattern`), and in a creature's stat block, which has no tracks of its own.
- **5e's `pc` declares it on its Character section.** Not the NPC or the Legendary Creature, whose progression is a rating
  with no tracks. Nothing derives differently, and the system definition is not embedded in a save (ADR 0022), so every
  save shows its levels; the oracle cannot move.

Evidence: `class-levels.test.ts` now asserts, against any corpus, that every sample's Character section names its classes
with the levels its split took, first taken first, and that the text export lists each; it fails with 5e's declaration
removed. `packages/core/src/system.test.ts`, `packages/ui/src/sheet.test.ts`, `sheet-document.test.ts` and
`tools/verify/src/schemas.test.ts` each fail under their named perturbations (a stat not contributed by the element read
as its count, the track looked up other than as `trackStatKey` names it, the progression not handed to the sections, the
section's flag unread, the count left out of the name, the validator's check removed). The PDF coverage test reads the
form's class and level line from the document's listed classes: filled on all thirty, where the 8 multiclass samples were
"in part"; fields filled a sample go from a median of 179 to 180. Driven in the browser build (headless Edge on the dev
server, every click injected over the debug port, an origin-private folder for the folder picker, six characters packed by
`packCharacter` and opened with no content source): the Sheet reads "Wizard 4", "Paladin 3", "Fighter 3" for the
three-class sample, "Rogue 4", "Wizard 4" for the interleaved one and "Ranger 5" for a single-class 2024 one, the
Triceratops NPC unchanged; the text exports (through a stand-in save picker) and A4 PDFs printed with `Page.printToPDF`
carry the same words. Not in the Tauri window.

### 8. What building it decided: a spell's level and prepared mark (2026-10-01)

**A spell's level and whether it is prepared** (decision 4's third item), measured first by
`tools/verify/src/spell-levels.test.ts` (report-only on the commit before them, on AuroraLegacy/elements at `c28ce6c`): over
the thirty samples, 20 have a Spells section and it listed 261 spells, every one with a `level` setter reading a whole
number from 0 to 5. There are 15 preparing blocks (ADR 0046). Their 29 always-prepared spells were all listed; of their 94
chosen ones, **50 were on no sheet**: a block preparing from a list (Cleric, Druid, Paladin, Artificer) records spells the
derivation does not hold, because `Character.prepared` is embedded and never seeded. A Cleric 20's eleven prepared spells
were nowhere but the Build pane. One sample prepares two spells in two blocks: its Wizard's book holds Magic Missile and
Thunderwave and the Wizard prepared them, and its Artificer always prepares them. The
section listed spells in the order held, by level then name on only 3 of the 20.

- **A sheet section may declare `group`** (system format, optional; `formatVersion` stays 1): a setter its listed elements
  are grouped by, and what a group is called (`label` with `{value}`, `labels` for exact values, as `candidateNotes` names a
  spell's level in a picker). Core's `sheetGroup` reads the setter (case ignored) and `compareSheetGroups` orders groups
  by their values with digits read as numbers ("2" before "10"). The section then lists by group, by name within one, and
  what is in no group last, in the order held. `SheetListedElement.group` is `{ value, label }`; the value is what a form
  filler places by.
- **A sheet section may declare `preparedMark`**: what an element is called when content always prepares it and when the
  player chose it. Core's `preparedState` reads `DerivedCharacter.preparation` across every block, `always` before
  `chosen`, never what a block cannot prepare (`unavailable` counts for nothing, as in the limit): a spell listed once is
  prepared if any block prepares it. `SheetListedElement.prepared` is `{ label, always }`. **Such a section also lists what
  a prepared list holds and the character does not** (`preparedListIds`), looked up through the builder's index, where a
  save's embedded content comes first, so a save with no source lists them too. Not a derivation change: they are listed,
  never held.
- **`listedAside`** (`sheet-document.ts`) is the one wording of what follows a listed element's name, "Level 1, prepared",
  "Cantrip", beside `listedName`, `listedUsage` and `rowAside`; the pane, so the print, and the Markdown export call it.
- **The validator refuses** a group on a section listing nothing; a prepared mark on a kind with no `preparation`, on a
  section whose types leave out the kind's `preparation.elementType`, and in a creature's stat block, whose scope publishes
  no preparation.
- **5e's `pc` declares both on its Spells section**: `level`, "Level {value}", "Cantrip" for 0; "always prepared" and
  "prepared". Nothing derives differently, and the system definition is not embedded in a save (ADR 0022), so every save
  shows them; the oracle cannot move.

Evidence: `spell-levels.test.ts` now asserts, against any corpus, that every sample's Spells section lists exactly what it
holds and what its prepared lists hold, once each, every spell grouped by its level setter, in level order, and marked
exactly as `preparedState` reads the derivation, and that the text export lists each so; it fails with either of 5e's
declarations removed, and with the builder's lookup removed. On the samples: 311 spells listed (the 50 added), levels 0 to 9,
29 always prepared and 92 prepared (the two spells prepared in two blocks counted once). `packages/core/src/system.test.ts`,
`preparation.test.ts`, `packages/ui/src/sheet.test.ts`, `sheet-document.test.ts` and `tools/verify/src/schemas.test.ts`
each fail under their named perturbations (exact labels not tried first, the setter matched by case, groups compared as
text, name order within a group dropped, the grouping or the lookup unread, the two labels swapped, a section without the
declaration marking, `chosen` read before `always`, the aside left out of the Markdown or its parts reordered, each
validator check removed, either field left out of the schema). The PDF coverage test reads the form's spells by level and
its 92 prepared boxes from the document: the boxes go from "not in the document" to filled on 9 samples and in part on 4
(a level with more spells than lines has no box for the rest); fields never in the document go from 143 to 51 on every
sample, the median filled stays 180 (the most is 278), and five samples now have a level with more spells than the form
has lines, one more than before because a Paladin's prepared spells are listed. Driven in the browser build (headless Edge
on the dev server, every click injected over the debug port, an origin-private folder for the folder picker, five samples
packed by `packCharacter` and opened with no content source): the Sheet reads "Bane (Level 1, prepared)", "Bless (Level 1,
always prepared)" and "Thaumaturgy (Cantrip)", a Cleric 20's prepared spells through "Mass Heal (Level 9, prepared)", the
Wizard/Artificer's Magic Missile once, as always prepared (the stronger of its two marks); the five text exports (through a stand-in save picker) are byte
for byte the tests' Markdown, and A4 PDFs printed with `Page.printToPDF` carry every spell line. Not in the Tauri window.

### 9. What building it decided: hit dice per class (2026-10-01)

**Hit dice** (decision 4's fourth item), measured first by `tools/verify/src/hit-dice.test.ts` (report-only on the commit
before them, on AuroraLegacy/elements at `c28ce6c`): all 29 `Class` elements in the corpus carry an `hd` setter, every one a
`dN` die (d6 4, d8 17, d10 6, d12 2), and no other element carries one. Over the thirty samples, the 40 classes held read d6
9 times, d8 16, d10 12 and d12 3; the 11 classes held in both editions read the same die in each; and the track's count
(decision 7) agrees with the split on every class, so a class's hit dice are its count of its die. Nothing else in content
names or adds to hit dice but Durable's `durable:hd:bonus`, a bonus to what a die regains when spent, which is play state.
Of the 8 multiclass samples, 3 have two classes sharing a die (a Paladin 3 / Ranger 3 has 6d10).

- **A sheet section may declare `trackDie`** (system format, optional string; `formatVersion` stays 1): the setter naming
  the die a listed element's track adds once per count. Core's `trackDie(element, setter)` reads it (case ignored, as a
  group's setter is) as a `dN` value through `dieSides`, the one parsing rule ADR 0044's `setter` expression uses, and a
  value that is not one reads as none. The count is the track's, as decision 7 reads it from what the derivation published;
  nothing is recomputed from `advancement`.
- **`SheetListedElement.dice`** is `{ count, sides }`, only beside a positive `progress` and a die. **`listedDice`** writes
  it "3d10", and `listedAside` puts it first in what follows the name, so the pane, the print and the Markdown export read
  "Paladin 3 (3d10)". The form's total line ("3d10 + 3d6", dice of one size added) is the form filler's to compose from
  the listed classes, as joining the classes into "Paladin 3 / Sorcerer 3" is (decision 5); the Sheet does not repeat it.
- **The validator refuses** `trackDie` on a section that writes no track count (no `trackProgress`), and in a creature's
  stat block, which has no tracks; the schema refuses it blank.
- **5e's `pc` declares `"trackDie": "hd"` on its Character section.** Nothing derives differently, and the system
  definition is not embedded in a save (ADR 0022), so every save shows its hit dice; the oracle cannot move.

Evidence: `hit-dice.test.ts` now asserts, against any corpus, that every sample's Character section writes each class with
its track's count of the die its element's `hd` names, on the Sheet and in the text export (40 classes on 30 samples); it
fails with 5e's declaration removed. `class-levels.test.ts` reads a class's export line through `listedAside`.
`packages/core/src/system.test.ts`, `packages/ui/src/sheet.test.ts`, `sheet-document.test.ts` and
`tools/verify/src/schemas.test.ts` each fail under their named perturbations (the setter matched by case, a missing or
non-die value read as 0 or as a die, the section's field unread, a count of one in place of the track's, a section without
it writing dice, the dice left out of the wording or after the group, count and die swapped, each validator check removed,
the field left out of the schema or allowed blank). The PDF coverage test splits the form's two hit dice fields: the total
is read from the document on all thirty (the multiclass samples read "3d10 + 3d6", "6d10 + 4d6", "6d10",
…), the dice remaining is play state; fields never in the document go from 51 to 50, the median filled from 180 to 181.
Driven in the browser build (headless Edge on the dev server, every click injected over the debug port, an origin-private
folder for the folder picker, six samples packed by `packCharacter` and opened with no content source): the Sheet reads
"Paladin 3 (3d10)", "Sorcerer 3 (3d6)", the three-class sample's "Fighter 3 (3d10)", the interleaved one's "Rogue 4 (4d8)",
"Wizard 4 (4d6)", a Cleric 20's "Cleric 20 (20d8)" and a 2024 Ranger's "Ranger 5 (5d10)"; the six text exports (through a
stand-in save picker) are byte for byte the tests' Markdown, and A4 PDFs printed with `Page.printToPDF` carry every word of
them and every class line. Not in the Tauri window.

### 10. What building it decided: "Export sheet as PDF…" (2026-10-01)

Decisions 1 and 2, built. No measurement came first: decision 2 already said what the platform offers, and the window was
the measurement.

- **A port, `PdfWriter`** (`core/platform.ts`, beside `FileSaver`): a paper size in inches in, the page's PDF bytes out,
  nothing written. It decides nothing but the paper: margins are zero so the page's own print rules (ADR 0078) place
  everything, and the platform prints no header or footer. `exportSheetPdf` (`packages/ui/src/sheet-export.ts`) asks it
  for the bytes, then asks `FileSaver` where, so the user names the file and a cancel is an answer; a writer that fails
  opens no save dialog.
- **The Windows window's writer is a Rust command, `print_to_pdf`** (`src-tauri/src/lib.rs`): WebView2's
  `ICoreWebView2_16::PrintToPdfStream`, print settings from `ICoreWebView2Environment6::CreatePrintSettings` (the paper,
  portrait, margins 0, scale 1, backgrounds on, headers and footers off), reached through Tauri's `with_webview`, the stream
  read and handed back as raw bytes (`tauri::ipc::Response`). `webview2-com` 0.38 and `windows` 0.61 (`Win32_System_Com`)
  are what wry already builds, so nothing new is compiled. It is the shell's third command and its second that is more than
  a transport line; ADR 0001's "the Rust side stays small" is kept by it deciding nothing about a sheet. Elsewhere it
  answers that it is Windows only. The page uses it only where `navigator`'s platform is Windows in the Tauri build.
- **The paper is a print option** (`PrintOptions.paper`, `'a4' | 'letter'`, remembered with the others and parsed field by
  field), offered only when the step leads to a PDF (`printOptionsView(document, options, 'pdf')`, which also says
  "Export sheet as PDF" and "Export…"). A print still leaves the paper to the dialog. A first PDF is offered Letter when the
  user's first language naming a region names one CLDR gives Letter (US, Canada, Mexico, the Philippines and nine others),
  A4 otherwise (`paperForLocales`); after that, the one last chosen.
- **The paper reaches the page as a rule**: `printRendering(…, 'pdf')` puts `@page { size: … }` before the running name's
  rule, and the shell takes the target back to `'print'` once the PDF is written or cancelled, so a later print is the
  dialog's paper again. The PDF is written from an effect after the render that closed the step and put the choices on the
  Sheet, as the print dialog is (ADR 0078).
- **The command, `export-sheet-pdf`**, "Export sheet as PDF…", below Print in the File menu, no shortcut (the text export's
  reason), enabled on the Sheet where the shell can write a PDF and save a file and no export is in flight. **A shell with
  no PDF writer has no such command** (decision 2), not a greyed one: `menuModel(os, absent)` leaves it out and tidies the
  separators (`absentCommands`), and the Sheet's bar shows no button. In the browser build nothing changes.

Evidence: `packages/ui/src/print-options.test.ts`, `sheet-document.test.ts` and `commands.test.ts`, each failing under its
named perturbations (a print given a size, a PDF given none or the other paper's, a paper offered on the way to a print,
the paper not remembered, a known paper of an inherited name accepted, the first regional language not deciding, a script
subtag hiding the region, the writer not handed the paper, a failed writer still opening the dialog, the writer's absence
not checked by the command, separators not tidied, an absent command greyed rather than left out);
`tools/verify/src/print-layout.test.ts` now holds that both commands open the step through one opener that prints nothing.
`cargo check` builds the command with no warning. **Driven in the Tauri window on Windows** (a fresh WebView2 profile, a
scratch library of six samples packed by `packCharacter`, no content source; no real keystrokes or mouse): the menu item,
fired by window message, opened the step, offering Letter first (the window's language is en-US); A4 then Letter were
chosen over the debug port; the system's save dialog, titled "Export this character's sheet as PDF", was answered by
window messages. The three-class sample on Letter with no running items: 4 pages of 612 × 792 pt, no page numbers, the
name once. The Paladin/Sorcerer on A4 with both: 3 pages of 594.96 × 841.92 pt, "Page N of 3" and the name on each later
page, no date, title or address of the platform's. Both page counts are the print's (decision 1's measurement), and every
word of each sample's text export is in its PDF (pdftotext's reading of a non-breaking hyphen aside). The PDF took under
0.2 s. The step remembered A4 for the next export; a Cancel in the save dialog wrote nothing, kept the note on the bar,
and took the paper rule off the page; "Print sheet…" still opens its step with no paper. Not driven: real keys and mouse,
a WebView2 Runtime too old for `ICoreWebView2_16` (the command says to update it), the replace prompt, macOS and Linux.

## What this does not do

- **Ship, download, or cache from the network the official sheet.** Decision 3.
- **Fill the 2024 sheet**, or any sheet without form fields.
- **A PDF layout of its own**, a stat block as the book prints it, or a card layout: Incudo's PDF is the print (decision 1);
  the laid-out sheet is the 1.x item.
- **Personality, backstory, coins, appearance or play state** on any sheet (decision 4).
- **A dialog-free PDF in the browser build**, or on macOS and Linux until those environments exist (decision 2).
- **Hold the dialog's "Save as PDF" against its Margins list.** Where "Export sheet as PDF…" exists, it is the answer; where
  it does not, the limit ADR 0078 recorded stands.

## Alternatives considered

- **No PDF command at all**: "Print sheet…" then "Save as PDF" is the PDF. Kept where no PDF writer exists. Passed over on
  Windows for decision 2's reasons: a dialog every time, a paper the dialog picks, and a Margins list that silently undoes the
  page.
- **A PDF layout of its own** (fixed paper, its own columns, links). Passed over by the maintainer: a second set of rules to
  keep in step with print.
- **A PDF writer in TypeScript drawing the document** (a library in `apps/desktop`). It would work in every shell, but it is a
  second renderer of the whole sheet, with its own text layout, fonts and tables, which is the drift ADR 0075 removed and ADR
  0077 decision 1 declined; and content's HTML reaches a page safely only through the shell's DOM sanitizer.
- **Ship the official sheet.** Its notice permits photocopying for personal use, not redistribution.
- **Download it on the user's request.** It would never be in the repository or the installer, and Wizards would serve it to
  the user, as the content sources are fetched for them. But both sets of terms forbid unauthorised software and scripts
  reaching the service, and a link the user follows does the same with no such question. The projects that fill the official
  sheet do it from a copy the user supplies.
- **Fill only what the document holds today** (about 155 fields a sample), and leave the marks blank. Passed over by the
  maintainer for decision 4: the marks and levels are wanted on every sheet.
- **Let the form filler read the character and its derivation** beside the document. Fills more at once, and makes the form
  the one renderer that shows what the Sheet does not: the drift again.
- **Lay text over the 2024 sheet's artwork.** Not filling a form; writing on Wizards' design.
- **WebView2's `PrintToPdf` to a path** instead of a stream. The stream lets the existing save port write the file, so the
  save dialog, the suggested name and the result line are ADR 0038's.

## Evidence

On AuroraLegacy/elements at `c28ce6c` and the thirty samples.

| what | held by |
|---|---|
| what the derivation publishes as each class's level, against the samples' split | `tools/verify/src/class-levels.test.ts`, report-only before decision 7, asserting since |
| each listed spell's level setter, the prepared lists per block, spells prepared in two blocks, the Spells section's order | `tools/verify/src/spell-levels.test.ts`, report-only before decision 8, asserting since |
| every class's `hd` setter in the corpus and on the samples, the two editions' dice, the track's count against the split, what else names hit dice, the multiclass samples' dice | `tools/verify/src/hit-dice.test.ts`, report-only before decision 9, asserting since |
| the 2014 form's boxes and counts (334 fields: 210 text, 124 check boxes; 100 spell lines), and for the samples what the document fills, fills in part, leaves empty and never holds; where the form's shape does not fit; characters outside WinAnsi; what the NPC, Legendary Creature and Cairn documents hold | `tools/verify/src/pdf-sheet.test.ts`, report-only (ADR 0042), committed before this record; it asserts only that the listed boxes add up to the form's counts and that samples were read |

- **The official PDFs** were downloaded once with the maintainer's leave into a scratch folder outside the repository, read
  with a PDF library (fields, types, widgets and their rectangles, metadata, printed text), and are not committed. The test
  carries no copy and downloads nothing; its box list is in its own words.
- **The print path** was measured in headless Edge 154 (no extensions, a scratch profile) on the dev server: the library an
  origin-private folder standing in for the folder picker, holding six characters packed by `packCharacter`; every click
  and every print was injected over the debug port (`Runtime.evaluate`, `Page.printToPDF`), none real. The PDFs were read
  back for pages, paper, words, furniture and fonts.
- **Not exercised:** the Tauri window (nothing was run in it this time: the maintainer was using the computer), WebView2's
  `PrintToPdf` and `PrintToPdfStream`, the dialog's own "Save as PDF" with a page rule setting the paper, any form filling,
  macOS and Linux.
- **The terms and the forums** were read on the web on 2026-09-30, through a summariser for the two sets of terms; the
  sources are D&D Beyond's Terms & Conditions, Wizards' Terms, D&D Beyond's character sheet page, the three repositories
  named above, an EN World thread on MPMB's sheets and two D&D Beyond forum threads.
