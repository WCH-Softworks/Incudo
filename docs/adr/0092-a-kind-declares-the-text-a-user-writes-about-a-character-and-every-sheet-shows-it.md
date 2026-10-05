# 0092 — A kind declares the text a user writes about a character, and every sheet shows it

**Status:** Accepted · 2026-10-05 · answers ROADMAP Phase 4's "Personality, appearance, backstory and notes can be
written" · amends [0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md)
(the personal-text check) and [0079](./0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md)
(decision 4's "kept out") · builds on [0003](./0003-system-agnostic-content-model.md),
[0006](./0006-derived-character-state.md), [0008](./0008-aurora-compatibility-frozen.md),
[0078](./0078-a-print-is-chosen-in-a-step-of-the-app-s-own-and-no-edge-of-the-page-is-left-to-the-dialog.md),
[0084](./0084-play-state-is-an-input-on-the-character-and-what-it-tracks-is-read-from-the-sheet.md) and
[0086](./0086-a-phone-builds-and-edits-with-the-desktop-s-builder-its-content-loaded-when-a-build-opens.md)
· **format:** one optional field on a character kind in the system definition (`formatVersion` stays 1), one rule in the
form map (its `formatVersion` stays 1); none for characters

## Context

`Character.freeform` has been in the save format since Phase 0: a `Record<string, string>` of text the rules never
read. The Aurora importer fills it, and nothing else does. Neither app has an editor for it, so a character built in
Incudo has no personality, appearance, backstory or notes; and nothing shows it, so an imported character's are carried
in the file and seen nowhere. ADR 0075 kept it off the sheet document on purpose (an import also writes coins, the
experience total, a background feature's text and row numbers of list picks there, none of it for a page), and ADR 0079
left the official form's personality, appearance and backstory boxes blank until this was decided.

### Measured

`tools/verify/src/freeform-fields.test.ts` (report-only lines, plus what holds against any save) reads the thirty sample
saves. Aurora writes the same `<input>` and `<appearance>` vocabulary into every save, filled or not: `gender`,
`player-name`, `experience`, `attacks`, `backstory`, `background-trinket`, `background-traits`, `-ideals`, `-bonds`,
`-flaws`, a background feature's text, `organization` (`name`, `symbol`, `allies`), `additional-features`, `currency`
(five coins, `equipment`, `treasure`), `notes` (two columns, `left` and `right`), `quest`, and `age`, `height`, `weight`,
`eyes`, `skin`, `hair` and the portrait's path. The importer flattens them to keys (`background-traits`,
`organization.allies`, `notes.note.left`, `appearance.eyes`) and drops what is empty. In the samples, which were built
anonymous, 18 carry a backstory and the four personality lines, all of it the books' suggested text, and none carries an
appearance, a note, a faction or a player name; the coins and experience are on all thirty.

The 2014 form has a box for each of personality traits, ideals, bonds, flaws, the player's name, age, height, weight,
eyes, skin, hair, faction name, allies and organisations, backstory and treasure (read off the user's own copy, outside the
repository, as ADR 0079 read it): the four personality boxes are about 153 points wide and 35 to 49 high, the backstory
164 by 370, allies 176 by 219, treasure 354 by 152.

## Decision

### 1. A kind declares the fields a user may write, by the `freeform` key each is kept under

`freeform` on a character kind (system format, optional, replaced along `extends`): a `label` for the whole ("About the
character"), an optional `description`, and `fields`, each a `key` (the `Character.freeform` key it reads and writes), a
`label`, an optional `group` (consecutive fields with one group are shown under it) and `multiline`. The validator
refuses a key twice. A kind that declares none has nothing to write, and what an import put in `freeform` is kept and
shown nowhere, as before. Core names no field: "Personality Traits" and "Age" are 5e's words, in `system.json`.

**The keys are the ones the importer already writes**, so an imported character's text appears in the editor and on the
sheet with no change to the frozen importer, and a character built in Incudo is written under the same keys. 5e's player
character declares, in four groups: Player name and Gender; Age, Height, Weight, Eyes, Skin and Hair; Personality Traits,
Ideals, Bonds, Flaws, Trinket, Backstory, Organisation, Allies and organisations, Treasure, Other features and traits;
Notes, More notes (Aurora's two columns, one field each rather than a merge) and Quests. Its NPC (and so the legendary
creature) declares a Description and Notes; Cairn's character declares Appearance, Background story and Notes.

**Not declared, on purpose:** the coins and `currency.equipment` (money is ADR 0087's, counted in units), `experience` (a
number, and a progression's), `attacks.*` (Aurora's attack notes; attacks are their own open item), a background
feature's text (content's own words, which the sheet already shows from the element), the faction symbol (an image
path) and `list.*` (row numbers of list picks).

### 2. Writing is an input that derives nothing

`setFreeform(character, key, value)` (core): a value that is blank once trimmed removes the key; anything else is kept as
typed (the sheet trims). No format version moves: `freeform` is required since format 1. The builder's `setFreeform`
keeps the derivation, as a play edit does (ADR 0084): nothing derived can move. `BuilderState.freeform`
(`freeformState`, `packages/ui/src/freeform.ts`) is the editor's state: the label, description, and each group's fields
with their values. Both shells render it and compute nothing: the desktop on Build, the phone on its Build screen (ADR
0086), saved with Save as everything else there.

### 3. Every sheet shows what is written, and only the declared fields

The sheet document (ADR 0075) gains `freeform`: the kind's label, and per group the fields **with text**, trimmed, in the
kind's order; absent when nothing declared is written. So the Sheet pane shows it after the character's sections and held
creatures and before kept texts, the print gains a part the print options step offers (ADR 0078), and the text export
writes it (`##` the label, `###` a group, a one-line field as a list item, a multi-line one as a `####` heading over its
paragraphs). An undeclared key is never in the document.

**This amends ADR 0075's personal-text check.** It held that no freeform value reaches the sheet. It now holds two
things: every declared field's text reaches the document and the export word for word, and no undeclared key's text
does (a background feature's text excepted where it is content's own words, as before). The portrait's path still never
reaches either.

### 4. The official form fills its personal boxes from the document

A form-map rule `{ field, freeform: key }` writes a document entry's text, and with an optional `capacity` (`lines`,
`perLine`, `fontSize`, as a flow's) writes it at that size and, when it is longer, writes it all and names it in the
result's left-off line rather than cutting it (ADR 0079 decision 5: never dropped silently, and prose cut mid-sentence
is worse than prose past a box's edge). The 2014 map fills the fifteen boxes above. ADR 0079 decision 4's "kept out" is
amended: personality, appearance, backstory and the player's name are on every sheet now; coins and play state still
are not.

## What building it found

- **The phone's Sheet built its document from parts it picked**, and left `freeform` out: the sample's backstory was in
  the editor and not on the sheet. Found by running it on the emulator, not by a test. `SheetDocumentSource.freeform` is
  required now, so a caller picking parts does not compile without it.
- **Two suggested personality traits overflow the form's box at 7 pt** on 9 of the 18 samples that write them
  (`pdf-sheet.test.ts`'s left-off lines): written whole and named, as decision 4 says. The backstory box holds every
  sample's.
- **A printed `dl` is kept whole** (ADR 0077), and a backstory can run past a page, so the sheet's part is not a `dl`, and
  it is left out of the rule that keeps a section without listed elements whole.
- Driven in the browser build (typed on Build, read on the Sheet, offered by the print step, kept across a reload, an
  emptied field leaving the sheet) and on the Pixel 9 Pro emulator in Expo Go (a sample's imported text on its sheet and in
  its editor, a typed field marking the build unsaved; left unsaved). Not in the Tauri window, on a real phone, iOS,
  macOS or Linux; the text export and the form fill are held by the tests, not driven.

## Consequences

- A character's personal text is shown on the Sheet, printed and exported by default. The print step can leave it out;
  the text export cannot (it has no options step), which is the same as every other part.
- An imported character with text under a key no field declares keeps it in the file and shows it nowhere. Adding a
  field to the system later shows it, with no change to any save.
- No oracle row moves: the derivation never reads `freeform`.

## What this does not do

- A portrait editor (`assets.portrait` is kept and shown on the library card, and the form's image button is not filled).
- Rich text: a field is plain text, its line breaks kept.
- A suggested personality from the background's tables (`list.*` keeps Aurora's row numbers; turning them into text is
  a separate question).
