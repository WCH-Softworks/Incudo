# 0078 — A print is chosen in a step of the app's own, and no edge of the page is left to the dialog

**Status:** Accepted · 2026-09-30 (proposed the same day) · implemented the same day, with what building it decided in
decision 6 · amends [0077](./0077-a-printed-sheet-is-the-sheet-pane-under-a-print-stylesheet-and-its-sections-flow-in-columns.md)
(decisions 6 and 8, and "What this does not do") · answers Phase 5's "Print options of the app's own, then the platform's
print dialog; and nothing of the web page on paper" · builds on
[0037](./0037-a-command-is-data-the-page-owns-the-keyboard.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0068](./0068-a-character-may-keep-content-beside-it-as-a-reference-shown-and-embedded-and-never-held.md),
[0073](./0073-a-creature-a-character-holds-is-derived-one-at-a-time-in-its-holder-s-namespace-and-shown-as-its-own-stat-block.md),
[0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md) ·
**format:** none (no system or character format change)

## Context

ADR 0077 prints the Sheet pane under print rules, through the platform's own dialog, and leaves paper, margins, headers
and scale to that dialog (its decision 8: "The print dialog's headers and footers are on by default … nothing here turns
them off"). On paper, and saved as PDF from WebView2's preview, that put the date and time at the top of every page and
the page's address (`localhost:5173`; an installed build prints `tauri.localhost`) and a page number at the bottom. The
maintainer decided a sheet should not show them, and chose a direction (ROADMAP Phase 5, 2026-09-30): "Print sheet…"
first opens a small options step of the app's own (which parts go on the page; whether the sheet prints its own page
numbers and the character's name on later pages; whether choices are remembered), then the platform's dialog unchanged;
and no page furniture in any shell, by taking the page margin away, since the dialogs print their headers and footers
only in the margin.

Two things had to be known first: what each part costs and how often a sheet has it, which decides what the step offers;
and whether a page with no margin really prints no furniture, in the PDF and in the preview, and where the content then
sits. The second found more than it was asked.

### What was measured

`tools/verify/src/print-options.test.ts`, report-only, committed and run before this record, on AuroraLegacy/elements at
`c28ce6c`. It reads `sheetDocument` over the thirty samples (found with `samplesWhere`), the same thirty keeping every text
their own elements print (ADR 0070's suggestions, what a player would be offered to keep), every creature (141) as an NPC
and as a Legendary Creature, and a Cairn character. "Lines" are lines before wrapping, as ADR 0077 counted them.

**What each kind can ever put on a page** (from what it declares):

| kind | the character's own sections | held creatures | kept texts |
|---|---|---|---|
| 5e Player Character | yes | yes ("Companions") | yes ("For reference") |
| 5e NPC / Monster, Legendary Creature | yes | no | yes ("For reference") |
| Cairn Adventurer | yes | no | no |

**Which parts a sheet has, and what they cost:**

| sheets | the character only | + held creatures | + kept texts | own sections | held creatures | kept texts |
|---|---|---|---|---|---|---|
| samples as saved (30) | 25 | 5 | 0 | 2,095 to 8,163 characters, 99 to 201 lines | one each, 631 to 731 characters, 32 to 33 lines (14 to 24 % of the sheet's lines) | — |
| samples keeping every text offered | 24 | 4 + 1 with both | 1 + 1 with both | as above | as above | offered on 2 sheets, one text each: 1,477 characters, 61 blocks |
| NPC, Legendary Creature (141 each) | 141 | — | 0 | 465 to 2,173 characters, 27 to 61 lines | — | — |
| Cairn | 1 | — | — | 65 characters, 7 lines | — | — |

ADR 0077 measured the rest of the kept side: the 116 texts a 5e kind may keep run 27 to 6,014 characters, with tables
twelve columns wide.

**What each part costs in pages**, printed in the Tauri window on Windows (below): each character printed with
`Page.printToPDF` on A4, then again with one part hidden (`display: none` in a scratch style), no source ever added.

| sheets | all parts | without held creatures | without kept texts | own sections only |
|---|---|---|---|---|
| the 30 samples | 2 pages on 12, 3 on 16, 4 on 2 | — | — | 2 on 13, 3 on 16, 4 on 1 |
| the 5 holding a creature | 4, 4, 3, 3, 3 | 3, 4, 3, 3, 2 (**a page saved on 2 of 5**) | — | — |
| a sample keeping its one offered text | 5 | — | 3 (**2 pages for one text**) | — |
| a sample with a creature and a kept text | 6 | 5 | 4 | 3 |
| a player character keeping the longest text and a 2024 stat block | 3 | — | 1 | 1 |
| the NPC (Triceratops), the Legendary Creature (Tyrannosaurus Rex) | 1, 1 | — | — | — |

So: a held creature costs nothing to a page; a kept text costs pages, because it starts a page and runs at full width
(ADR 0077 decision 5). A sheet runs past one page on every sample, and on no creature character.

**What the platform does with the margin.** WebView2 in the window reports Chromium 154. The page was printed under
scratch rules injected over the debug port (nothing committed), to PDF with the dialog's headers and footers switched on
(`displayHeaderFooter: true`, which prints what the dialog prints by default: date and time, title, address, "1/3") and
in WebView2's own print preview, read through its DevTools target. The PDFs were read back as text and rendered as
images in the window's own PDF viewer.

| print rule (scratch) | furniture in the PDF | the preview's "Headers and footers" option | where the content sits |
|---|---|---|---|
| ADR 0077's rules, no `@page` | date, title, `http://localhost:5173/`, "1/3" on every page | offered, **checked** | the dialog's default margin |
| `@page { margin: 12mm 14mm }` | (not printed) | offered, **checked** | 12 by 14 mm |
| `@page { size: A4 }` | (not printed) | offered, checked | the dialog's default margin |
| `@page { margin: 0 }` | **none** | **not offered at all** | **at the paper's edge**, text cut at the left |
| `@page { margin: 0 }`, `body { padding }` | none | not offered | the padding on the first page only: later pages start and end at the edge |
| `@page { margin: 0 }`, `.pane { padding; box-decoration-break: clone }` | none | not offered | the padding on every page |
| `@page { margin: 0; padding: 10mm }` | none | not offered | **the padding on every page** |
| a margin and `@page` margin boxes with content (`@top-left` a name, `@bottom-right` "Page N of M") | **none**: the app's name and "Page 1 of 3" where the dialog's were | not offered | the margin |
| a margin and an empty box (`content: ""` or `none`) | (not printed) | offered, checked | the margin |
| margin boxes, the first page's top box `none` | **date and title on page 1's top**, the app's own everywhere else | **offered** | the margin |
| margin boxes, the first page's top margin 0 with padding instead | none | not offered | the margin, and the padding on page 1's top |
| numbers only: bottom margin with a box, top margin 0 with padding | none | not offered | as set |
| `@page { margin: 0 }` with margin boxes | none | not offered | the name at the paper's edge in the page's default serif font; the number not printed |

Three things follow, and the first corrects the roadmap:

- **The dialog prints its headers and footers in any edge of the page that has a margin and no margin box with content,
  and offers the option only while some edge does.** With no such edge the option is not greyed or unchecked: it is not
  in the dialog. So "the dialog's own checkbox can still put them back" (the roadmap's words) does not hold in WebView2:
  a user cannot put them back with it. Whether choosing Minimum or Custom in the dialog's Margins list (it lists
  Default, None, Minimum, Custom, with Default selected) brings it back was not exercised: DOM clicks did not change the
  list's selection.
- **A page number needs a margin**: the only way Chromium prints one is `counter(page)` in a margin box, and a margin box
  lives in the margin. With no margin the box is not drawn (the number) or is drawn at the edge (the name). So "no margin"
  and "the sheet prints its own page numbers" are not one rule but two: an edge either has no margin, or has a margin
  that carries a box with content.
- **Moving the margin inside changes no page count.** `@page { margin: 0; padding: 10mm }`, and the numbered page with a
  10 mm margin, printed all 35 characters on exactly as many pages as ADR 0077's rules. `padding` on `@page` applies to
  every page; padding on the page's content applies only where the content starts and ends, unless it is
  `box-decoration-break: clone`.

**What the style of a margin box can say.** Its `content` is a string or a counter; Chromium reads no `string-set` and no
running element, so the character's name cannot be taken from the page's own markup and has to be written into the rule
as a CSS string. `counter(pages)` works ("Page 1 of 3"). `@page :first` addresses the first page. A named page (`page:` on
an element, `@page <name>`) lets a class on the Sheet choose which page rule its pages print under.

## Decision

### 1. "Print sheet…" opens a print options step, and its Print opens the platform's dialog

`print-sheet` (menu, the Sheet bar's button, Ctrl+P) opens a small step of the app's own, a dialog in the page, instead of
calling `window.print()`. Its Print button closes it and calls `window.print()`; Cancel closes it and prints nothing. The
platform's dialog that follows is unchanged: printer, copies, pages, paper, "Save as PDF". While the step is open the
app is modal as for any of its dialogs (ADR 0037's `modal` rule), so Ctrl+P is claimed and runs nothing, and Escape
cancels it. The command stays enabled on the Sheet only.

### 2. The options are a view-model in `packages/ui`, kind-agnostic, and the pane computes nothing

`packages/ui/src/print-options.ts`, under `node --test`: `printOptionsView(document, remembered)` returns what the step
shows and `printRendering(options, document)` what the Sheet is given. It reads the sheet document (ADR 0075), never
`BuilderState` and never a kind's id, and names parts by the document's own fields: `sections`, `companions`,
`references`. Labels are the document's own (a kind's `companions.label`, `references.label`: "Companions", "For
reference"), and the sentences are written there, as `sheet-document.ts` writes the Sheet's. The step's component renders
the view and calls back with a changed option.

What it offers:

- **Parts, only the parts this sheet has.** The character's own sections always; its held creatures when the document
  has any; what it keeps when it keeps anything. A sheet with only its own sections (25 of 30 samples, every creature
  character, Cairn) shows no parts group at all: one checkbox that cannot be unticked is not a choice. At least one part
  stays chosen; the last one cannot be unticked.
- **Page numbers**, "Page N of M" at the foot of every page.
- **The character's name on later pages**, at the head of every page after the first. The first page carries the name
  as its title already (ADR 0077 decision 3).

The title and the kind line under it print whatever parts are chosen: they head the page, and are not a part.

### 3. What it chooses reaches the print rules as classes on the Sheet, and one generated rule for the name

No second renderer (ADR 0077 decision 1 holds). `printRendering` returns:

- **Classes for the Sheet's root**, one per omitted part (`print-omit-sections`, `print-omit-companions`,
  `print-omit-references`) and one per running item (`print-page-numbers`, `print-running-name`). The stylesheet's
  `@media print` block hides an omitted part and chooses the page rule from the rest. Screen rendering is untouched: the
  classes mean something only in print.
- **One `@page` rule as text** when the running name is chosen: the name as a CSS string in a margin box. It has to be
  generated, because a margin box cannot read the page's markup (measured). `cssString(title)` escapes it (a quote, a
  backslash, a line break, anything below U+0020), and the pane renders the text in a `<style>` element it owns. It
  carries the name and nothing else; every other print rule stays in the stylesheet.

### 4. No edge of the page is left to the dialog

The print rules give every edge of every page either no margin or a margin box with content, which is the rule measured:

- **By default, no margin.** `@page { margin: 0; padding: 10mm }`. The padding keeps the content where the dialog's default
  margin kept it (no page count moved on 35 characters).
- **With page numbers**, the Sheet is a named page whose bottom edge has a 10 mm margin carrying `@bottom-right` with
  `"Page " counter(page) " of " counter(pages)`, and whose top edge keeps no margin.
- **With the name on later pages**, the named page's top edge has a 10 mm margin carrying `@top-left` with the name, and
  its first page (`:first`) has no top margin and 10 mm of padding instead. Without it, the dialog prints its date and
  title in the first page's empty top margin (measured).
- **Both**: both edges as above. The four combinations are four named pages, or one named page per edge; which is the
  implementation's choice, held by the test in the Evidence.

The boxes' text is set small in the page's muted colour and the page's own font; left unset, a box prints in the
platform's default serif (measured).

The roadmap's "the dialog's own checkbox can still put them back" is dropped: the dialog offers no such checkbox then
(measured). The furniture goes on every print, and that is the maintainer's call recorded in the roadmap. Asked (2026-09-30)
whether the step should offer to print the date and address instead, the maintainer said no: there is no case for them
on a sheet, so no option brings them back.

### 5. The choices are remembered per user, not per character

`PrintOptions` (which parts are left out, page numbers, running name) is written to the app's `Storage` under one key,
`print/options`, when Print is pressed (not on Cancel), and read when the step opens. A remembered "leave out held
creatures" applies to the next sheet that has creatures, and to a sheet without them it is simply not offered. A stored
value that does not parse, or names a part the view-model does not know, falls back to the defaults, part by part.

Not per character: a print option is not an input to anything a character derives (ADR 0006), and writing it into
`character.json` would raise every printed character's format for a preference about paper (ADR 0060's format rule), and
carry that preference to whoever the file is given to. Not per kind either: the parts are named by the document, not by
the kind, so one remembered choice means the same thing on every sheet that has the part.

**Defaults**: every part the sheet has, page numbers on, the name on later pages on. A one-page sheet (every creature
character measured) then reads "Page 1 of 1": CSS cannot ask how many pages there are before it prints a box, and
leaving the number off where there is one page would take a second rule the platform does not have.

### 6. What building it decided (2026-09-30)

- **The name's rule must beat nothing, so the first page's box is `!important`.** Printed in the window, the first build put
  the name at the head of page 1 too. `@page sheet-named-numbered:first` does match the first page (a box added there
  prints), but its `content: none` lost to `@page sheet-named-numbered { @top-left { content: "…" } }`, the name's rule,
  which the Sheet renders in the page and so comes later in the document than the stylesheet. Chromium 154 let the later
  rule win whatever the page selectors, where the spec ranks `:first` above a bare name; only `!important` held. The first
  page's `margin-top: 0` needs nothing, since it comes after the named page's margin in the same stylesheet. The test
  resolves pages the way Chromium was seen to, in document order with `!important` above it, and **resolving them by the
  spec passed the rules that printed the name on page 1**.
- **Three named pages, one per combination with a running item** (`sheet-numbered`, `sheet-named`,
  `sheet-named-numbered`), chosen by `page:` on `.sheet` with the classes; with neither, the default page. The name's
  rule names the page it is for (`printPageName`), never every page: on the default page, whose head has no margin, a box
  prints at the paper's edge (measured). The named page leans on that rule: forced onto `sheet-named` without it, the
  dialog printed its date and title in the head margin. `printRendering` gives the class and the rule together.
- **`window.print()` is called after the render that closed the step**, from an effect, not in the Print handler: there
  the platform would print the step on top of the sheet, and the Sheet still carrying the choices before. The step's own
  close runs in a child's effect, which React runs first. Print and Cancel both go through `finishPrintStep`, which writes
  only on Print, so "not on Cancel" is a test in `packages/ui` and not a promise of the shell's.
- **The step reads the remembered choices afresh each time it opens**, and a remembered omission of a part the sheet lacks
  is kept, not dropped: dropping it on every print of a sheet without creatures would forget "leave out held creatures" as
  soon as it was made. A remembered set that would leave out every part a sheet has prints its own sections. A part a
  sheet lacks has no class.
- **The character's own sections are called "The character's own sections"** in the step, written in the view-model: the
  document labels the other two parts and not this one. The parts group is headed "Print".
- **With the character's own sections left out and no creatures printed, what it keeps starts under the title** (no page
  break before it), or the first page would carry the title alone.
- **The boxes are 8 pt** in the page's own font family, written out (`system-ui, …`): a margin box is outside the page's
  elements, and custom properties were not relied on there.
- The App's source check (`print-sheet` opens the step, one `window.print()` call, after the step's Print, the step modal)
  is in `tools/verify/src/print-layout.test.ts`, beside the other reads of the shell's source, not in `commands.test.ts`,
  which reads no shell; `commands.test.ts` holds the modal claim.

## What this does not do

- **Choose paper, orientation, scale, copies or which pages.** The platform's dialog still does, as ADR 0077 said.
- **Put the dialog's headers and footers back.** Decision 4, and decided: no option for them.
- **Print without the platform's dialog**, or save a PDF without it (WebView2's `PrintToPdf`, Windows only). Phase 5's
  PDF item decides that.
- **Remember choices per character**, or skip the step ("don't ask again"). The step is one click; a way to skip it is a
  preference the settings pane can take later.
- **Choose which held creatures or which kept texts print**, one by one. Measured, a sheet has at most one creature and,
  kept as offered, at most one text; ADR 0077's stat blocks kept by a DM are where several texts appear, and choosing
  among them wants its own look.
- **Make the browser build's other browsers behave.** The browser build needs the File System Access API, which only
  Chromium browsers have, and that is the engine measured; no other engine was.
- **macOS and Linux.** Whether WebKit's print panels print furniture in a margin-less page, and whether they draw `@page`
  margin boxes at all, is part of the open "Print sheet… on macOS and Linux" item. If a panel does not draw margin boxes,
  page numbers print nothing there and the page is still margin-less.

## Alternatives considered

- **Replace the platform's print dialog with one of the app's own**: a printer list, a preview and settings. Passed over
  by the maintainer (ROADMAP, 2026-09-30): three native implementations, a printer list and a preview of its own, the loss
  of what users know from their own dialogs, and only Windows testable here.
- **Print without a dialog through WebView2** (`ICoreWebView2_16::Print` with settings that turn headers and footers off).
  Passed over by the maintainer: Windows only, reached only through Rust, absent from the browser build.
- **A margin-less page and nothing else** (the roadmap's first reading). Measured: it removes the furniture and leaves no
  room for a page number, which only a margin box can print. Kept as the default; margins return only on an edge that
  carries the app's own box.
- **Margin boxes on every page, always**, with no margin-less default. An empty box does not stop the dialog printing
  (measured), so with page numbers and the name off the page would need content in a box anyway.
- **Margin inside the page as padding on the Sheet** (`box-decoration-break: clone`). Works in Chromium 154 (measured),
  and is one more property a platform may not read; `@page` padding says the same thing where it belongs.
- **A running name from the page's markup** (`string-set`, `position: running()`): not in Chromium. `position: fixed` repeats
  an element on every printed page but cannot skip the first page or print a page number.
- **The options in `character.json`**, or per kind. Decision 5.
- **The parts as system format fields** ("print this section in the options"). The parts are the document's, and a kind
  already declares whether it has creatures or kept texts.

## Evidence

On AuroraLegacy/elements at `c28ce6c` and the thirty samples. Every perturbation named here was run (patched, run,
restored) and failed the test that names it.

| what | held by | perturbation that fails it |
|---|---|---|
| the step offers only the parts the document has, never none, and labels them with the document's own labels | `packages/ui/src/print-options.test.ts` | a parts group on a sheet with only its own sections; the last part allowed to be unticked; a label written as a game noun; a remembered part offered on a sheet without it |
| the classes name exactly the omitted parts and the running items | the same | an omitted part left without its class |
| `cssString` escapes a quote, a backslash, a line break and a control character, and the generated rule holds nothing but the name | the same | a name `A "B" \ C` written into the rule unescaped |
| remembered choices: written on Print, not on Cancel, read on open, applied only where a part exists, a garbage value falling back field by field | the same, over a `MemoryStorage` | a write on Cancel |
| for every sample (as saved and keeping what it is offered), every creature as an NPC and as a Legendary Creature, and the Cairn character, the parts offered are the parts the document has | `tools/verify/src/print-options.test.ts`, gaining that assertion | the kept texts offered on every sheet. (Offered whenever the document has a `references` part at all fails nothing: the document never has an empty one.) |
| under `@media print`, read as source: `@page` with no margin and padding; for each running-item combination, every edge of the first and a later page has no margin or a margin box drawing in it, no box sits on an edge without a margin, numbers and the name are where chosen, every box sets its font; a class hides each part the view-model can omit; the Sheet carries the classes and the name's rule | `tools/verify/src/print-layout.test.ts` | `:first` keeping its top margin; an empty box; a part's class with no rule; a margin on the default page; **the first page's box without `!important`** (decision 6) |
| `print-sheet` opens the step, not the dialog; modal while open; Ctrl+P claimed and runs nothing then | `packages/ui/src/commands.test.ts`, and `print-layout.test.ts` reading `App.tsx` | the command calling `window.print()` directly |

**What the tests cannot show** is that a page prints right. The drive below held the pages.

- **Printed in the Tauri window on Windows**, a fresh WebView2 profile, the library a scratch folder of 36 characters
  packed by the repository's own `packCharacter` (the thirty samples; the two samples offered a text to keep, keeping it;
  an NPC on the Triceratops and a Legendary Creature on the Tyrannosaurus Rex; a player character keeping the longest kept
  text and a 2024 stat block; a Cairn character), **no content source ever added**. Each opened from the library and shown
  on the Sheet by DOM clicks over the debug port; the step opened from the Sheet bar's button, its checkboxes set by
  clicks, and its Print pressed. **109 prints**: every character with all running items and with none; the 8 with more
  than one part also with each running item alone and with every proper subset of its parts left out; the Cairn character
  with the name alone too. So the name-only combination, which the measurement did not cover, printed on 9 characters.
- **Every print went through WebView2's preview**, opened by the step's Print and read through its own DevTools target:
  **the headers-and-footers option (`header-footer-checkbox`) absent in all 109**. A control, a scratch `@page` margin
  injected over the debug port, made it appear, so the check is live. Cancelled there, the page answered again.
- **Then `Page.printToPDF` on A4 with `displayHeaderFooter: true`**, which prints what the dialog prints by default, read
  back as text and as positioned runs (a small reader of the PDF's own text runs): **no date, no title, no address on any
  page of any print**; "Page *i* of *n*" in the foot margin of every page exactly when chosen, and nothing there otherwise;
  the name in the head margin of every page after the first exactly when chosen, never on page 1; everything else inside
  10 mm of every edge. **Every word of the Markdown export of the parts printed, and no other**, but for one thing the
  platform does: a kept table's header row is repeated at the top of the next page when the table breaks across one (10
  prints, one header each, a `<thead>` printing as it should). Two controls, a box put on page 1's head and a plain margin,
  were caught by the same check, the second printing the date, `http://localhost:5173/` and "1/2".
- **Pages**: the running items move no page count on any of the 36 (2 pages on 12 characters, 3 on 17, 4 on 2, 5 and 6
  on one each, 1 on the creature characters and Cairn). Left out: a held creature saves a page on 2 of the 5 that hold one
  (Samples 03 and 08); the kept texts save 2 on each of the three characters keeping any; the character's own sections, 1 to 3 pages, the kept
  texts then starting under the title.
- **Cancel, Escape, the record and Ctrl+P in the window**: Cancel and a `cancel` event on the dialog (what Escape raises;
  injected, not a real key) closed the step, wrote nothing to `print/options` and called no print; an injected Ctrl+P
  while the step was open was claimed (`defaultPrevented`) and printed nothing. The record read
  `{"omit":["companions","references"],"pageNumbers":false,"runningName":false}` after the drive, and the next sheet
  with creatures and a kept text opened with both unticked and its own sections greyed, the last part left.
- **The native menu**: File's "Print sheet…" (`Ctrl+P` printed beside it), sent `WM_COMMAND`, opened the step.
- **The oracle cannot move**: nothing in `packages/core`, `packages/content`, `packages/aurora-import`, `systems` or
  `schemas` changed from the commit before this record's work to the last of it; the derivation is untouched.
- `npm run typecheck` exits 0; `npm test` passes 1,232 of 1,232.
- **Not exercised:** real keys and a real mouse (the window was not given for it), paper (no printer was used), the
  dialog's Margins list, the browser build, and macOS and Linux.

### The drive this record was written from (2026-09-30)

In the Tauri window on Windows (`npm run desktop:app`, WebView2 reporting Chromium 154), a fresh WebView2 profile, the
library a scratch folder of characters packed by the repository's own `packCharacter` (the thirty samples, two of them
also keeping the one text they are offered, an NPC on the Triceratops, a Legendary Creature on the Tyrannosaurus Rex, a
player character keeping the longest kept text and a 2024 stat block), no content source ever added. Each opened from the
library and shown on the Sheet by DOM clicks over the debug port. Every print rule tried was a scratch `<style>` put into
the page over the debug port; nothing in the repository was changed for it. PDFs were made with `Page.printToPDF` on A4,
read back as text with a small reader of the PDF's own text runs, and seen as images in the window's own PDF viewer; the
preview was opened with `window.print()` and read and cancelled through its own DevTools target, its `FLUENT-CHECKBOX`
`header-footer-checkbox` present or absent. **Not exercised:** real keys, a real mouse, paper (no printer was used), the
dialog's Margins list (its selection did not change under DOM clicks), the name-only combination, and the browser build.
