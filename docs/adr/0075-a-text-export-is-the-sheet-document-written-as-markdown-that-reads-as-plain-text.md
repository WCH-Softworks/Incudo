# 0075 — A text export is the sheet document written as Markdown that reads as plain text

**Status:** Accepted · 2026-09-29 · answers Phase 5's "Plain-text / Markdown export" · builds on
[0012](./0012-self-contained-saves.md), [0037](./0037-a-command-is-data-the-page-owns-the-keyboard.md),
[0038](./0038-a-copy-goes-through-a-save-port-and-changes-nothing-else.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0068](./0068-a-character-may-keep-content-beside-it-as-a-reference-shown-and-embedded-and-never-held.md),
[0069](./0069-what-a-description-embeds-is-shown-in-place-and-a-save-carries-it-for-its-text.md),
[0073](./0073-a-creature-a-character-holds-is-derived-one-at-a-time-in-its-holder-s-namespace-and-shown-as-its-own-stat-block.md),
[0074](./0074-a-kind-s-sheet-shows-its-printed-page-and-every-row-says-what-it-is.md) ·
**format:** none (no system or character format change)

## Context

Phase 5 is "Export & sharing": a PDF sheet, a plain-text / Markdown export, a "content has been updated" flow and a print
layout. The text export was one line with nothing measured behind it. ADR 0074 made the sheet a view-model
(`packages/ui/src/sheet.ts`) so that an export would start from rows rather than from a component; this is the first
export, and it has to be something the print layout and the PDF can start from too, not a third way of drawing a sheet.

### What was measured

`tools/verify/src/sheet-export.test.ts`, report-only, committed and run on the commit before anything here, on
AuroraLegacy/elements at `c28ce6c`. It reads what the Sheet pane draws, `BuilderState.sheet`, `companions` and
`references`, over the thirty samples as player characters, every creature (141) as an NPC and as a legendary creature,
and a Cairn character.

| question | answer |
|---|---|
| a sample's sheet | 9 to 15 sections, 43 to 54 rows, 47 to 138 listed elements; up to one held creature; no kept reference |
| an NPC's and a legendary creature's | 2,226 and 2,367 rows and 1,021 printed lines over the 141 |
| the view packed and reopened against nothing but what the save embeds | **identical** for all 30 samples, all 282 creature characters and the Cairn one |
| strings the view shows as text that carry a tag or an entity | **0** of 6,524 (samples), 9,684 and 10,107 (creatures), 15 (Cairn) |
| strings with a character Markdown reads as markup | 21 per creature kind, all square brackets in a printed line ("Hit Dice [d8s]"); 0 on the samples |
| what the listed elements' own descriptions would add | 1,375 of 2,729 have one; **18,635 to 93,290 characters a sample** (median 37,551) as plain text |
| the importer's `freeform` text (backstory, traits, ideals, bonds, flaws, currency, attack notes) and the portrait path | in the character, **never in the view** |
| texts a kind may keep (`Information`, 116), expanded as the pane expands them | 27 to 6,014 characters; tags `td b li strong p i tr em h4 ul table thead h5 h3 br`, **every one on the shell sanitizer's allowlist**; attributes `style` and `class` (which it strips) and `colspan` |
| their tables | 110: 63 with cells spanning columns and **no header row** (the 2024 stat block's ability grid, whose first row is `<td colspan="2"/>MOD SAVE` three times), 47 with a `thead`; **every row the same width once spans count**; nothing but `b`, `i` and `strong` inside a cell; no cell spanning rows; no table in a table |
| other structure | no block inside a list item or a cell; **100 empty headings** once self-closing ones are opened (`<h4 style="…" />`); one entity (`&amp;`); in the text itself, 9 square brackets, 1 ampersand and 1 line that starts like a list |

And, by reading the three components that draw the Sheet (`SheetPane.tsx`, `Companions.tsx`, `References.tsx`): they
draw nothing the view does not hold **except three sentences they compose themselves**, "(prerequisites not met)" beside
an added element whose prerequisites are unmet, "From A, B" under a held creature, and "It has no text to show." for a
kept element with no description, plus the lede's element count. The kept text is HTML, and the only thing that turns it
into something shown is the shell's DOM sanitizer, which cannot run in `packages/ui`.

## Decision

### 1. The sheet is one document, and the pane and every export read it

`packages/ui/src/sheet-document.ts`: `sheetDocument(state)` gathers what the Sheet pane shows into one value, the
character's name and kind, its sections (ADR 0074's `SheetSectionView`s), its held creatures (ADR 0073) and what it keeps
for reference (ADR 0068), in the pane's order. **The three sentences the pane composed move into it**: a creature's
`from` line, a kept element's `note` when it has no text, and the words beside an unmet addition
(`PREREQUISITES_UNMET`). The Sheet pane renders the document and composes nothing; the Markdown writer renders the same
document. The print layout and the PDF are two more renderers of it, so what a sheet shows is decided once.

A kept element's text stays HTML in the document, as `expandDescription` makes it: each renderer turns it into what it
draws (the pane through its sanitizer, Markdown below). A renderer never looks anything up: the document is a pure
function of `BuilderState`, which is why it needs no index and is the same with no source (ADR 0012), measured above.

**What the document leaves to the pane**: the element count on the lede is a pane-only figure. It counts internal
elements (levels, grants) and says nothing on paper; the document carries it and the export does not write it.

### 2. Plain text and Markdown are one format

The export is Markdown written so that it reads as plain text: `#` headings, `- Label: value` lists, a blank line
between blocks, emphasis only where content had it, and tables as pipe tables. A `.txt` would differ only by dropping the
`#`, the asterisks and the pipes, which is what plain text written by hand already uses; a second format would be a
second writer and a second set of tests for no reader who is served worse by the first. The file is UTF-8 with `\n`
line ends and ends in a newline, named after the character (`sample-01.md`).

- **Names, not descriptions**, as the Sheet shows. A listed element's description would add 18,635 to 93,290 characters
  to a sample; a sheet that prints each feature's text is a different document (Aurora's third page, `<sheet>`'s short
  descriptions, ADR 0074 decision 7) and not this item.
- **What the Sheet shows and nothing else.** No `freeform`, no portrait, no source versions, no ids. The measurement
  shows the view reaches none of them; the tests hold the export to it.
- **Escaped where Markdown would misread it, and nowhere else.** A backslash, a backtick, `*`, `_` and `<` always; `&`
  where it would spell an entity; `]` where a link or a definition would follow; `|` in a table cell; and a paragraph or
  item that begins like a heading, a quote, a list or a rule. `<` always, because a Markdown reader that renders raw HTML
  would otherwise run what content wrote: the export writes no HTML at all. The measurement found 30 such characters in
  all the corpus's kept texts and creature lines, so the escaping costs a reader almost nothing.

### 3. A kept text is read into Markdown in `packages/ui`, by a reader of the markup the corpus uses

`packages/ui/src/html-markdown.ts`, `htmlToMarkdown(html)`: a small tolerant tag reader (no DOM, no dependency), run
after `openSelfClosingTags`, that writes paragraphs, headings, lists, tables, bold, italics, links and line breaks, and
unwraps anything else as the sanitizer does. Every tag the corpus's kept texts use is one it writes (decision 2's
table). Tables: the first row is the header, as GFM requires, whether it is a `thead`, `th`s or the 2024 grid's labels;
a cell spanning columns is followed by empty cells so every row has the table's width. A heading with no text is
dropped (100 of them). Content's headings sit under the kept element's own, from level four.

It is not a sanitizer and does not need to be one: it writes text, escapes `<`, and drops `script`, `style` and the
rest of the sanitizer's removed list with their contents, so nothing content wrote becomes markup a reader runs.

### 4. It is a command on the Sheet, through `FileSaver`

"Export sheet as text…" (`export-sheet`) writes the Markdown through ADR 0038's `FileSaver`, the port Save a copy uses:
bytes and a suggested name in, a name or a cancel out. **Enabled on the Sheet only**, where its outcome can be seen (ADR
0037): the Sheet gains a bar with the button and the note "Exported the sheet as sample-01.md." It needs no library and
no content, only a platform that can save a file. It is listed in the File menu below Save a copy. **No shortcut**: the
free Ctrl+Shift chords were found by pressing real keys in the Windows window (ADR 0038), which this work could not do,
and a chord that WebView2 takes is worse than none.

Like a copy, an export changes nothing: `exportSheet` takes the document and returns a name, and touches no library
entry, no draft and no character.

## What this does not do

- **Copy to the clipboard.** It would be a port of its own (a browser asks permission, a phone's clipboard is not a file)
  and a second gesture for the same bytes. A file is what the PDF will also be.
- **Print or make a PDF.** Both are renderers of the same document, and the pane is already most of a print layout.
- **Print feature descriptions, personality, notes, the bag or prepared spells.** None is on the Sheet; each is a sheet
  decision first.
- **A shortcut** (decision 4).

## Alternatives considered

- **Write the Markdown from `BuilderState` directly**, leaving the pane as it was. Two renderers composing the same three
  sentences, and a print layout would be a third: exactly the drift the document removes.
- **Put the sanitized HTML in the Markdown**, which Markdown allows. A plain-text reader would see tags, and a Markdown
  reader would render content's HTML with no sanitizer between it and the page.
- **Strip the tags from a kept text.** A stat block's ability grid would read as a run of numbers, and headings and lists
  would run together.
- **Two formats, `.txt` and `.md`.** Decision 2.
- **Descriptions of every listed element.** Decision 2; 18,635 to 93,290 characters a sample.
- **A Markdown library.** `packages/ui` has no runtime dependency but React; the corpus's markup is fifteen tags and
  measured, and a small reader is held to all of it by a test.

## Evidence

Each test names the perturbation that fails it, and each perturbation was run.

- `tools/verify/src/sheet-export.test.ts`: the measurement above, committed and run on the base commit, and since then
  what holds against any corpus. For every sample, all 282 creature characters, an NPC and a player character each
  keeping all 116 texts, and a Cairn character: the Markdown is **identical packed and reopened with no source**; it heads
  every section and writes every row, listed element and printed line; it writes no unescaped `<`, no empty heading and
  no uneven table; a sample's holds none of the importer's prose and no portrait path. The 232 kept texts say **the same
  words in the same order** as their HTML with the tags taken away, and their 220 tables have **the same columns**, a
  spanning cell counted as the columns it spans. Perturbed: a spanning cell written as one cell; an empty heading
  written; bold text dropped by the reader; printed lines left out of a section; the collector not seeding kept
  references. **What did not work first**: a count of pipes per table row. Every row is padded to the table's width, so
  a spanning cell written as one shifted the grid's MOD and SAVE headers a column and the count stayed equal; the test
  compares columns now. And the collector not following embeds was expected to fail it and does not: no text a kind may
  keep embeds another element (every `h5` in them is content's own caption), so none depends on it today.
- `packages/ui/src/html-markdown.test.ts`: the 2024 grid and a `thead` table, an empty self-closing heading, lists with
  emphasis whose spaces sit inside the tag, entities, `<script>` in the text and in the markup, links, hard breaks, the
  escapes, a stray closing tag. `packages/ui/src/sheet-document.test.ts`: the document's sentences, the Build pane's
  entry, the whole Markdown of a fixture with a creature and three kept elements, an unnamed and a markup-named
  character, the export through a fake save port (UTF-8 bytes, `.md`, a name and nothing else in the result, a cancel, a
  failed write, no dialog). `packages/ui/src/commands.test.ts`: the command on the Sheet only, without a library or
  content, not twice, not behind a dialog, below Save a copy. Perturbed: `escapeMarkdown` made the identity and a title
  left unescaped (**caught here and not by the corpus test**: the corpus gives escaping almost nothing to do, as
  measured); the lede's count written; the `from` line not written; a text-less kept element given no sentence; the
  command enabled on Build.
- The oracle's thirty-sample table is **identical** before and after (`INCUDO_ORACLE_SNAPSHOT` on the ADR's commit,
  `INCUDO_ORACLE_BASELINE` after, same checkout, no `.env.local`), and a baseline with one difference removed fails, so
  the comparison was live. `npm run typecheck` and `npm test` pass (1,184 tests).
- **Driven in the browser build** (an origin-private folder standing in for the folder picker and the save dialog, a
  sample served by the dev server for the import dialog). Sample 05, a Wizard 3 / Rogue 3 / Warlock 3 holding an Owl,
  imported and exported from the Sheet: `sample-05.md`, **byte-identical** to what the tests write from the corpus. An
  NPC on the Triceratops named `Old Horn [the *Grey*]` keeping the Kraken's stat block: its title escaped, its stat
  block as a pipe table and lists. Both saved, the source switched off and the page reloaded ("no content loaded"),
  both reopened and exported again: **identical to the first exports**. A Cairn character with entered scores exported
  its two sections. The Sheet still showed "From Find Familiar" under the Owl. No console errors.
- **Driven in the Tauri window on Windows** (a fresh WebView2 profile, the library a scratch folder holding Sample 05
  packed by the repository's own code, DOM clicks over the debug port, no keystrokes, not macOS or Linux). **No content
  source was ever added.** The native File menu, read with Win32, showed "Export sheet as text…" enabled on the Sheet
  with Save and Save a copy greyed, and greyed on Build; `WM_COMMAND` on it opened the real Windows save dialog titled
  "Export this character's sheet as text", a scratch path was typed into it by `WM_SETTEXT` and Save pressed by
  `BM_CLICK`. The file written is **byte-identical** to the browser's and the tests', and the bar read "Exported the
  sheet as tauri-sample-05.md." The dialog's replace prompt and its Cancel were not exercised in the window; the port's
  cancel is Save a copy's, unchanged (ADR 0038).
