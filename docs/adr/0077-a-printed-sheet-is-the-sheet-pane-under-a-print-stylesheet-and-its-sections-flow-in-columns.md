# 0077 — A printed sheet is the Sheet pane under a print stylesheet, and its sections flow in columns

**Status:** Proposed · 2026-09-30 · answers Phase 5's "Print layout" · builds on
[0012](./0012-self-contained-saves.md), [0037](./0037-a-command-is-data-the-page-owns-the-keyboard.md),
[0038](./0038-a-copy-goes-through-a-save-port-and-changes-nothing-else.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0068](./0068-a-character-may-keep-content-beside-it-as-a-reference-shown-and-embedded-and-never-held.md),
[0073](./0073-a-creature-a-character-holds-is-derived-one-at-a-time-in-its-holder-s-namespace-and-shown-as-its-own-stat-block.md),
[0074](./0074-a-kind-s-sheet-shows-its-printed-page-and-every-row-says-what-it-is.md),
[0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md),
[0076](./0076-content-s-sheet-hints-are-read-every-description-kept-chosen-by-the-level-the-element-gates-at.md) ·
**format:** none (no system or character format change); one field on the sheet document (`title`)

## Context

Phase 5's "Print layout" is two words with nothing measured behind them. ADRs 0075 and 0076 settled where it starts:
what the Sheet shows is one document (`sheetDocument`, `packages/ui/src/sheet-document.ts`), which the pane draws and the
Markdown export writes, and a print layout is one more renderer of it, never of `BuilderState`. ADR 0075 also said the
pane is already most of a print layout. That left three questions: how much a printed page has to hold, whether the
document says enough to lay it out without the renderer knowing a game noun, and whether "a renderer" here means a
stylesheet over the pane or a second drawing of the document.

### What was measured

`tools/verify/src/print-layout.test.ts`, report-only, committed and run before anything here, on AuroraLegacy/elements
at `c28ce6c`. It reads `sheetDocument` over the thirty samples (found with `samplesWhere`), every creature (141) as an
NPC and as a Legendary Creature, a player character and an NPC keeping every text their kind may keep (116), and a Cairn
character, and reads the shell's stylesheet and the three components that draw the Sheet as source. "Lines" are lines
before wrapping: one per row, per listed element and per line of its sheet text, per printed line, per heading.

**How much is on the page.**

| sheet | characters of its own sections | lines | held creatures | kept texts |
|---|---|---|---|---|
| a sample (player character) | 2,095 to 8,163 (median 4,650) | 109 to 233 (median 152) | 5 of 30 hold one, 0 to 731 characters | none keeps one |
| an NPC | 465 to 2,134 (median 883) | 27 to 59 (median 34) | none | none |
| a Legendary Creature | 504 to 2,173 (median 922) | 29 to 61 (median 36) | none | none |
| a Cairn character | 62 | 7 | none | none |

Where a sample's length is:

| section (player character) | on | listed | with a sheet line | characters |
|---|---|---|---|---|
| Proficiencies | 30 | **22 to 85**, names only | 0 | 455 to 2,435 |
| Features & Traits | 30 | 4 to 22 | 3 to 19 | **425 to 4,388** (median 1,909) |
| Spells | 20 | 3 to 27, names only | 0 | 37 to 303 |
| Character, Inventory | 30, 8 | 4 to 8, 1 to 6, names only | 0 | 100 or fewer |
| Ability Scores, Combat, Saving Throws, Skills | 30 | rows only: 6, 6, 6, 18 | — | 74 to 360 |

| sheet lines (ADR 0076) | how many | characters | lines each | longest |
|---|---|---|---|---|
| on the samples | 325 | 21 to 972 (median 122) | 1 to 7 | Wild Shape, 972; Arcane Armor, 747; Magical Tinkering, 744 (7 lines) |
| on the creatures' stat blocks | 364 | 31 to 697 (median 99) | 1 to 4 | Abyssal Curse, 697; Alchemical Salve, 609 (4 lines) |

| kept texts | how many | characters | tables |
|---|---|---|---|
| every text a kind may keep | 116 | 27 to **6,014** (median 1,101; Maneuver Options, Wild Magic Surge Table) | 110 in 104 texts: **63 twelve columns wide** (the 2024 ability grid, spans counted), 37 six, 10 two; 2 to 26 rows (Wild Magic Surge Table) |

Set one line per line at about fifty lines a page, a sample is two to five pages and an NPC one. The bulk of a sample is lists of names
(Proficiencies alone is up to 85 lines) and Features & Traits' sheet lines; no single sheet line is longer than a
paragraph, and a kept text can be longer than a page.

**What could sit side by side, and whether the document says so.** A section was called *figures* when it holds rows
and nothing else and every value, with what is beside it, is eight characters or fewer ("18 (+4)", "+11", "1/4"). By
shape alone, never by name:

| kind | figures on every sheet | figures on some sheets only |
|---|---|---|
| player character | Ability Scores, Combat, Saving Throws, Skills (30 of 30), every Spellcasting and Spell Slots section | **Worn & Wielded 23 of 30** (an item's name is up to 15 characters); **Senses 25 of 30** (the other 5 list Darkvision with its line) |
| NPC and Legendary Creature | Ability Scores (141), Other Speeds (89), Skills (83), Saving Throws (22), and the Legendary Creature's Legendary Actions (141) | **Senses 28 of 141** (113 add the creature's printed senses); Stat Block never (its printed armour class and hit points are lines) |
| a held creature | Stat Block, Ability Scores, Other Speeds, Skills | Senses never (printed senses) |
| Cairn | Abilities, Inventory | — |

On a sample the four "figures on every sheet" sections come one after another (positions two to five, then Senses and
Worn & Wielded), in all four of the most common orders of shapes. So a renderer *can* find the scores, saves and skills
by shape, and the shape of the next two sections moves from one sheet to another. **A layout that classifies sections by
shape would put Worn & Wielded in a box on 23 sheets and across the column on 7**, for no reason the reader could see.

**What the document has for a stat block.** Of 370 features listed in an NPC's Traits, Actions and Reactions, **364
carry their sheet line**; the other 6 are the hidden "Primal Bond" traits, named only (ADR 0076 decision 6), and of
those **3 have a line content wrote** (Tasha's), which the page loses. On the samples, held creatures' 14 traits and
actions all carry theirs, and the only hidden elements listed anyway are the 116 in the Character header, 46 of which
have a line (every 2014 class and subclass), named without it on purpose. A stat block's first line, its armour class
and hit points as printed, and its scores with modifiers beside them are all in the document (ADR 0074). What the
document does not say is which sections *form* the book's stat block: only their ids do (`creature`, `header`,
`abilities`), and those are the system's names.

**What the shell does that a printed page would have to undo** (the stylesheet and components read as source):

| | today | on paper |
|---|---|---|
| print rules | **0** `@media print`, 0 `@page`, 0 `break-*` | nothing is styled for print |
| `.app` | `height: 100vh; overflow: hidden` | **the page is one window tall**: everything below the fold is cut off |
| `.pane` | `overflow-y: auto` | the Sheet scrolls inside itself instead of growing |
| `header`, `.pane-bar` | the app's navigation and the Sheet's export bar, with a sunken background | printed above the sheet |
| the lede | the kind, and how many elements the derivation holds | a pane-only count (ADR 0075) |
| `.sheet-name` | the name is an **`<input>`** | prints as a text box of the input's own width; a long name is cut |
| dark scheme | `--fg: #e6e6e9`, `--fg-muted: #9b9ba3` | light grey text on white paper once backgrounds are not printed |
| `.reference-text` | `overflow-x: auto` | a twelve-column table is cut at the column's edge |
| `.sheet-text` | `white-space: pre-line` | must stay: it keeps content's lines (ADR 0076) |
| print calls | none in the shell's source; no command claims Ctrl+P | Ctrl+P prints whichever pane is showing, one window tall |

The pane computes nothing a print would repeat: `SheetPane.tsx` imports only types from `@incudo/ui`, and
`Companions.tsx` and `References.tsx` call the two wording functions and the shell's sanitizer. **The shell's sanitizer
is the only one** (`sanitize-html.ts`, over a DOM): a renderer in `packages/ui` could not make content's HTML safe.

**What the platforms offer**, from the sources the lockfile pins (tauri 2.11.5, wry 0.55.1, webview2-com-sys 0.38.2):

- **Tauri**: `WebviewWindow::print()` opens a print dialog for the webview, and its doc comment says it is supported only
  on macOS through wry and that `window.print()` works on all platforms.
- **wry**: on WebView2 its `print()` *is* `window.print()` evaluated in the page; on WebKitGTK a `PrintOperation` dialog;
  on macOS `printOperationWithPrintInfo`.
- **WebView2** itself exposes more than either uses: `ICoreWebView2_7::PrintToPdf` (the page to a PDF file, no dialog),
  and `ICoreWebView2_16::Print` (to a printer with settings, no dialog), `ShowPrintUI` (the browser's print preview or
  the system's dialog) and `PrintToPdfStream`. All print the page as its print stylesheet lays it out. Nothing in Tauri's
  API reaches them; a Rust command could, through the platform webview handle, on Windows only.
- **The browser build**: `window.print()`, `@media print`, `@page`, `break-before`, `break-inside`, and the
  `beforeprint` / `afterprint` events. Chromium's and Edge's print dialogs offer "Save as PDF".

None of the dialogs has been seen from Incudo yet: that is part of the planned evidence.

## Decision

### 1. The print layout is a print stylesheet over the Sheet pane

`@media print` rules in the shell's stylesheet, applied to what the Sheet pane already draws from the document. No second
renderer: the pane draws the document and nothing else (measured), content's HTML reaches the page only through the
shell's sanitizer, and a second drawing of the same document would be a second set of markup to keep in step with the
first, which is the drift ADR 0075 removed. A print is the pane on paper, as the export is the pane in text.

### 2. It undoes what binds the pane to the window, and hides what is not the sheet

Under `@media print`: `.app` and `.pane` grow with their content and do not scroll; the header, its navigation and the
Sheet's bar are not printed; the lede's element count is not printed; the colour tokens are the light scheme's whatever
the screen uses, and nothing depends on a background being printed; a kept text's tables are shown whole rather than
scrolled. `.sheet-text` keeps `white-space: pre-line`.

### 3. The document carries its title, and the page prints it as text

`SheetDocument` gains `title`: the character's name trimmed, or "Unnamed character" when it is blank, which is what the
Markdown export writes today (`UNNAMED_CHARACTER`) and will read from the document instead. The pane draws it as a
heading shown only in print, beside the name's `<input>`, which is hidden in print. While printing (`beforeprint`, put
back on `afterprint`), the page's own title is the sheet's, so a print dialog's header and the file name "Save as PDF"
suggests name the character rather than the app.

### 4. Sections flow in two columns and are laid out by what they hold, never by what they are called

- **The character's sections flow down two page columns**, in the document's order. Rows are the label and value pairs
  the pane already wraps across a line, lists are one item a line, printed lines are label and text: every section is
  drawn by what it holds, as the pane draws it, and no section is classified. The scores, saves and skills come out
  beside each other because they are short and consecutive (measured), not because anything names them; Worn & Wielded
  and Senses flow like everything else whatever their width on a given sheet.
- **Nothing is split that fits**: a section, a row, a listed element (at most 972 characters, 7 lines) and a printed line
  each prefer not to break across a column or a page; a heading never ends one. A section longer than a column (a
  sample's Proficiencies) breaks, as a preference allows.
- **The same rule lays out a stat block.** An NPC's sections flow the same way and come to under a page.

No system format field and no view-model classification. The measured instability is the reason: a classification by
shape moves two sections between treatments from sheet to sheet, and a classification by name puts a game's names in
the shell.

### 5. The three parts break where a reader expects

- **Held creatures follow the character in the same flow**, each kept whole (at most 731 characters on the samples), so
  a familiar does not cost a page of its own.
- **Kept texts start a new page, in one column**: they are content's pages, up to 6,014 characters with tables twelve
  columns wide, which half a page cannot hold. A kept text may break between its blocks; a table row never splits.

### 6. "Print sheet…" is a command on the Sheet, and Ctrl+P is tried for it

`print-sheet`, "Print sheet…", enabled on the Sheet only (ADR 0037: where its outcome can be seen), listed in the File
menu below "Export sheet as text…", with a button on the Sheet's bar. It calls `window.print()` in both builds, which is
what Tauri documents for every platform and what wry's own `print()` does on Windows; nothing in `packages/ui` prints, so
no port is added. It needs no library and no content.

**Ctrl+P is the proposed shortcut**, claimed everywhere and run only on the Sheet, so pressing it on Build no longer
prints a clipped Build pane. It is kept only if **real keys pressed in the Windows window** reach the page (ADR 0038:
WebView2 took Ctrl+Shift+S before the page ever saw it); if WebView2 takes Ctrl+P, the command has no shortcut, and
Ctrl+P prints the Sheet through WebView2's own preview under the same stylesheet.

### 7. ADR 0076's "Primal Bond" cost stays open, with no per-section flag

A layout reads the same document the pane and the export read, so it loses the same three lines they do, and no more:
3 of the 364 stat-block features, 0 on the samples. A flag saying which sections want a hidden element's line would be
a system format field for three elements that no sample holds. It is added when a sample or a user's own file shows
the cost, and the print stylesheet does not change that decision.

## What this does not do

- **Draw a stat block as the book prints it**: one boxed column, the six scores as one table, run-in "Name. Text."
  paragraphs. The document has everything such a block prints (364 of 370 features with their lines, the first line,
  the scores with modifiers), and it does not say which sections form the block except by the system's own ids. That is
  a declaration for the system format, decided on its own, and the flow of decision 4 does not stand in its way.
- **The PDF sheet.** Phase 5's other item: a fillable official sheet is a PDF form, not a page; a "clean Incudo sheet"
  may turn out to be this page printed to PDF (the browser's dialog offers it, and WebView2's `PrintToPdf` could do it
  without one on Windows). That is the PDF item's decision.
- **Choose paper, margins, headers or scale.** Those are the print dialog's, and a user's.
- **A print preview inside the app**, or printing from any pane but the Sheet.
- **Anything the Sheet does not show**: proficiency marks, levels per class, hit dice, personality, notes, the bag, prepared
  spells (ADRs 0074 and 0075 list them).
- **Mobile.** Phase 6's shell prints its own way; it reads the same document.

## Alternatives considered

- **A print renderer of its own**, a function in `packages/ui` writing the document as a printable HTML page opened in a
  frame or window and printed there. It could be tested under `node --test`, which a stylesheet cannot. But content's
  HTML would reach that page with no sanitizer (the only one needs the shell's DOM), it would draw the same document a
  second time, and printing a second page needs a frame or a window the platform prints, more moving parts than the pane
  already on screen.
- **Both**: the stylesheet now and a renderer for the PDF. The PDF item decides whether it needs one.
- **Classify sections by shape in `packages/ui`** (figures, lists, prose) and set figures in boxes. Measured: two
  sections change class between sheets. Rejected for decision 4's flow, which needs no class.
- **A layout field in the system format** (`columns`, `layout: "boxes"`). A public format change for what a column flow
  does without one; kept for the book's stat block, where the system does know something the document cannot.
- **One column.** A sample is 109 to 233 lines before wrapping, most of them short: two to five mostly empty pages.
- **A page per part.** A held Owl is 731 characters; a page of its own for it wastes paper. Kept texts do get one.
- **WebView2's native print APIs.** Windows only, reached only through Rust, and absent from the browser build; the
  dialog `window.print()` opens is WebView2's own print preview.
- **A flag for "Primal Bond".** Decision 7.

## Evidence (planned)

Nothing below has been run for this ADR yet except the measurement. Each test will name the perturbation that fails it.

- `tools/verify/src/print-layout.test.ts`: the measurement above, committed and run on the commit before anything here;
  then, what holds against any corpus, for every sample, every creature as an NPC and a Legendary Creature, a character
  keeping every text and a Cairn character: the document's `title` is the Markdown's first heading. And, reading the
  stylesheet as source as the measurement does, that under `@media print` the window bound is undone on `.app` and
  `.pane`, the header, bar and lede are not printed, the light tokens are set, a kept text's overflow is visible, kept
  texts break before a page and sit in one column, sections, rows, listed elements, printed lines and creatures avoid
  breaking inside, and the name prints as text. Perturbations: each of those rules removed, one at a time. **What this
  cannot show** is that a page prints right: it holds the rules to being written, and the drives below hold the page.
- `packages/ui/src/sheet-document.test.ts`: `title` for a blank, a spaced and a markup-named character, and the Markdown
  reading it. Perturbation: the Markdown computing its own fallback again with a different word; the title not trimmed.
- `packages/ui/src/commands.test.ts`: `print-sheet` on the Sheet only, without a library or content, not behind a dialog,
  below "Export sheet as text…"; Ctrl+P claimed on every pane and run only on the Sheet (if kept). Perturbations: the
  command enabled on Build; Ctrl+P not claimed off the Sheet.
- **The oracle's thirty-sample table identical** before and after (`INCUDO_ORACLE_SNAPSHOT` on the base commit,
  `INCUDO_ORACLE_BASELINE` after, same checkout, no `.env.local`), with one difference removed from a copy of the snapshot
  to prove the comparison live. Nothing here touches a derivation, so any difference is a mistake.
- **Printed in the Tauri window on Windows**, over the debug port with `Page.printToPDF` (the page as its print
  stylesheet lays it out): a two-class sample holding a creature, a single-class caster, an NPC on the Triceratops and a
  Legendary Creature, a player character keeping the longest kept text and a twelve-column grid, and a Cairn character.
  Each PDF's text, extracted, holds **every word of the Markdown export in the same order within each part**, so nothing
  is cut by the window, a column or a table; its page count is reported beside the measured lines; the same printed with
  the window in the dark scheme has dark text. Then the command, from the native menu and from the Sheet's bar, opening
  WebView2's print dialog, seen; Ctrl+P pressed with **real keys** (not an injected event) on the Sheet and on Build.
- **Printed in the browser build**: the same characters through Chromium's print preview and "Save as PDF", compared
  with the window's.
- **Not planned:** macOS and Linux, where Tauri's `print()` and a GTK or macOS dialog would be seen for the first time;
  a physical printer.
