# 0126 — The Sheet is laid out as a page, play state sits where its number is, and what another entry covers is folded

**Status:** Accepted · 2026-10-27, built 2026-10-28 (proposed 2026-10-19; the maintainer's answers to the open decisions are recorded at the end) · answers the UX pass's finding F8 ("the Sheet opens on play trackers, not on the
character") and the maintainer's call that the Sheet needs a full revamp · would bring ROADMAP Beyond 1.0's "A laid-out
sheet" forward and replace it · would amend
[0062](./0062-an-npc-s-other-speeds-saves-and-skills-are-its-creature-s-rules-and-its-senses-are-what-it-prints.md),
[0074](./0074-a-kind-s-sheet-shows-its-printed-page-and-every-row-says-what-it-is.md),
[0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md),
[0077](./0077-a-printed-sheet-is-the-sheet-pane-under-a-print-stylesheet-and-its-sections-flow-in-columns.md),
[0084](./0084-play-state-is-an-input-on-the-character-and-what-it-tracks-is-read-from-the-sheet.md) (decision 7, where the
desktop shows play) · builds on [0009](./0009-character-kinds.md), [0011](./0011-user-systems.md),
[0076](./0076-content-s-sheet-hints-are-read-every-description-kept-chosen-by-the-level-the-element-gates-at.md),
[0078](./0078-a-print-is-chosen-in-a-step-of-the-app-s-own-and-no-edge-of-the-page-is-left-to-the-dialog.md),
[0079](./0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md),
[0092](./0092-a-kind-declares-the-text-a-user-writes-about-a-character-and-every-sheet-shows-it.md),
[0093](./0093-an-attack-is-a-weapon-in-the-bag-and-the-kind-declares-what-it-adds-up.md),
[0095](./0095-a-row-names-what-moved-it-that-the-sheet-lists-nowhere.md),
[0112](./0112-a-sheet-section-may-write-a-note-under-each-element-it-lists.md),
[0114](./0114-the-sheet-ends-with-the-whole-descriptions-of-what-its-sections-list.md),
[0119](./0119-aurora-content-is-converted-into-incudo-content-and-nothing-past-the-conversion-knows-aurora.md) ·
**format:** system format additions on a kind's `sheet` and on a sheet section (all optional, `formatVersion` stays 1); no
character format change · **mockups:** [0126-sheet-mockups.html](./0126-sheet-mockups.html), plain HTML and CSS

Built 2026-10-27 to 2026-10-28, all ten steps; the open decisions were answered on 2026-10-27 and 2026-10-28 (below), and
what building it changed is in the notes at the end.

## Context

### What the Sheet is today

The Sheet is one document (`sheetDocument`, `packages/ui/src/sheet-document.ts`, ADR 0075) built from a kind's declared
sections (`sheetView`, `packages/ui/src/sheet.ts`, ADR 0074). Five things read it: the desktop Sheet pane
(`apps/desktop/src/panes/SheetPane.tsx`), the Markdown export (`sheet-markdown.ts`), the print layout and Incudo's PDF (the
pane under the print rules at the end of `apps/desktop/src/styles.css`, ADRs 0077 to 0079), the official 2014 form fill
(`form-fill.ts` and `systems/dnd5e/forms/official-2014.json`, which names section ids), and the phone (`SheetView.tsx`). The
content refresh review (ADR 0082) builds it twice to compare. Play state (ADR 0084) is not in the document; the desktop
draws `PlayPanel` above it, the phone in a tab of its own beside the sheet.

The desktop pane draws, in order: the name field, the kind, the Play panel, then every section as a heading and a list,
one column at most 1,100 px wide, then what the user wrote, the whole descriptions (ADR 0114) and what the character keeps.
Nothing in the system format says where a section goes or how it looks; ADR 0077 decided on purpose that nothing would
classify sections, and left a layout declaration for later.

### What was measured (2026-10-19, `.corpus/` at AuroraLegacy/elements `c28ce6c`, the thirty samples)

Driven in the browser build at 1280 × 800 with AuroraLegacy loaded, the samples put in as the draft, plus a new NPC and a
new legendary creature built on the 2025 Imp; the sheet documents and their Markdown were also built in Node over all
thirty samples. Measured with throwaway scripts, not committed (build step 1 makes them a report-only test).

- **The first screen is play state.** At 1280 × 800 the pane shows about 700 px; the Play panel is 479 px for a level 1
  Wizard (Sample 08) and **811 px for a level 20 Cleric** (Sample 07: nine slot rows, Channel Divinity, conditions), so
  race, class and ability scores start below the fold on every character, and off the first screen entirely for a
  high-level caster. Conditions are fourteen checkboxes, always shown.
- **The page is long.** Sample 08 is 7,844 px tall (3,570 px of sections, 3,220 px of whole descriptions); Sample 07 is
  14,094 px (proficiencies alone 1,970 px, descriptions 7,930 px). Every section is a label above a list, so a level 1
  character is eleven screens.
- **Proficiencies: 1,738 listed across the thirty sheets, 22 to 85 per sheet, median 45.** Of them:
  - **1,196 are granted by another proficiency the same list shows.** Content says it structurally: "Weapon Proficiency
    (Martial Melee Weapons)" carries a `<grant>` of each of its 19 weapons, "Simple Weapons" grants "Simple Melee" and
    "Simple Ranged", "Tool Proficiency (Gaming set)" its four sets; 23 such group proficiencies in the corpus. No name is
    read to know it.
  - **213 are skill and saving throw proficiencies** that the Saving Throws and Skills rows already mark "(proficient)".
  - **What is left is 6 to 24 per sheet, median 11**: 105 languages, 52 single weapons, 46 tools, 46 armour, a few
    others. Content gives them no clean category: armour proficiencies carry `supports` such as "Dwarven Armor" or none
    at all, so a grouping key is not there to read today.
- **Features with no text: 53 of 359 listed features**, "Fighting Style", "Ability Score Improvement", "Feat", a Ranger's
  "Undead" and "Forest", "Feature: Researcher". **34 of the 53 are answered by a choice** of their own (`<element>/select:`
  recorded): the answer is what the line should say. The rest are a background feature or a heading whose text is in its
  description only.
- **Other repetition and filler found by looking**: a Combat section's "Level 1" beside "Wizard 1"; Worn & Wielded writing
  "Armor: none", "Shield: none", "Primary Hand: none" on most sheets; "Senses" as a heading that exists to carry passive
  Perception (as the 1.x roadmap item already says); every section's explanation ("The ability modifier, plus the
  proficiency bonus…") printed on the sheet and in the export; an attack row reading "its damage is chosen on Build, under
  Spells", an instruction, where a number should be; Sample 08's unarmed strike reading "1-1 bludgeoning".
- **An NPC's sheet repeats its numbers.** The Imp's "Stat Block" section lists Armor Class 13, Hit Points 21, Speed 20,
  then "Armor Class, as printed 13", "Hit Points, as printed 21 (6d4 + 6)", "Speed, as printed 20 ft., Fly 40 ft."; Other
  Speeds repeats Fly 40; Senses lists passive Perception and then the printed senses line that ends with it. It reads as a
  form, not as a stat block, and its Play panel (326 px) comes first again.
- **The print is the same column flowed in two** (ADR 0077). It is complete and every word of the export is in it, which
  is what it was built for; it has no hierarchy either.

### What sheets people know look like (described, not copied)

- **The 2014 official sheet**: a header strip (name, class and level, race, background); a narrow left column of the six
  scores with saving throws and skills beside them and passive Perception under them; a centre column with armour class,
  initiative and speed in a row, hit points, hit dice and death saves, then attacks and spellcasting, then equipment; a
  right column of personality and features. Proficiencies and languages are a small box at the bottom left. Spells are a
  separate page, by level, each level with its slot boxes.
- **The 2024 official sheet**: a header band carrying level, armour class, hit points with temporary and hit dice, and
  death saves; each ability is a block holding its own save and its skills; a wide column of weapons and class features;
  armour, weapon and tool training as a short block. Its spell page is a table with columns for level, casting time,
  range, concentration, ritual and material components.
- **D&D Beyond's sheet**: a header with name, race, class and level, a hit point box with Heal and Damage, rest buttons; a
  row of six ability boxes; a left rail of saving throws, senses, and proficiencies and languages grouped as armour,
  weapons, tools and languages; a skills list with proficiency dots; and a tabbed main area (actions, spells, inventory,
  features and traits, background, notes, extras). What is spent is spent in place: slot boxes beside each spell level,
  checkboxes on a limited-use feature. A monster is shown as a printed stat block.
- **Aurora's sheet**: a replica of the official form, as pages, with nothing played on it.

They agree on four things this proposal takes: who the character is and the turn-to-turn numbers come first; the scores,
saves and skills are one narrow block; long content (features, spells, inventory) is a wide area with its own grouping; a
monster is a stat block. They differ on play state; D&D Beyond, the only one that is software, puts it in place.

## Decision (proposed)

### 1. A kind's sheet is a page with three areas: a head band, a side column and a tabbed main column

A kind may declare `sheet.layout`: `"page"` or `"statBlock"` (decision 7). Under `"page"`, each section declares where it
goes, `place`: `"head"` (the band across the top: who the character is and the numbers looked at every turn), `"side"` (a
narrow column always shown, about 330 px), or `"main"` with a `tab` naming one of the kind's `sheet.tabs`
(`[{ id, label }]`, in order). A section that declares no place goes in the first tab. A kind that declares no layout is
drawn as today, one column, so a user's system that knows nothing of this still gets a sheet (ADR 0011).

The place is in the document, not only in the desktop renderer (`SheetSectionView.place`, `.tab`, and
`SheetDocument.tabs`), so every reader orders the same: the Markdown and the phone read it for order, print reads it to
lay out, the desktop for areas and tabs. Section ids do not change: the form map and the tests name them.

A section may also declare `tiles: true`: its rows are drawn as tiles, the label small above a large value (the head
band's numbers, the ability scores). Display only; a reader that does not know it draws rows.

This is the layout declaration ADR 0077 decision 4 left for later. It does not reverse that decision's reason: nothing
*classifies* a section by its shape or its name; the system says where each goes.

### 2. What a player character's sheet shows first

5e's `pc` would declare (mockup A):

- **Head band**: the name; race, class with level and hit die, background (the Character section, unchanged, drawn as one
  line); armour class, hit points, initiative, speed, proficiency bonus as tiles. The Combat section's "Level" row goes
  (the class names it). Passive Perception goes beside Perception (decision 4), not in the band.
- **Side column**: ability scores as tiles, each with its saving throw and the save's mark under it, so Saving Throws
  stops being a section of its own on screen (it stays a section in the document, `place: "side"`, drawn into the ability
  tiles by a section field `under: "abilities"` naming the section whose rows it pairs with, row by row); Skills with
  marks; Senses as one line; Proficiencies and languages (decision 3).
- **Tabs**, in this order: **Actions** (attacks, then what features say takes an action, a bonus action or a reaction:
  ADR 0076's `action` hint, and the slots row with save DC and attack), **Spells** (only when the character has any,
  decision 6), **Features** (decision 5), **Inventory** (the bag, the purse, attunement; Worn & Wielded folds into it as
  "equipped" marks and a line "Attuned 1 of 3", and its "none" rows go), **Companions** (held creatures, ADR 0073),
  **Background and notes** (what the user wrote, ADR 0092), **Descriptions** (ADR 0114's whole texts and ADR 0068's kept
  texts). An empty tab is not shown.
- **A section's explanation is not on the page.** `description` is drawn as an "i" beside the section's label (the shell
  already has `InfoTip`), not printed, and left out of the Markdown export. It explains the number; it is not the
  character (the 1.x roadmap item said so). This changes every export's bytes, which is why it is open question 2.

### 3. A listed element another listed element grants is folded into it, and one a shown mark already says is left out

Two rules in `sheetView`, kind-agnostic, each opted into by a section field so a system decides:

- **`fold: true`**: an element the section lists is not listed on its own when another element the same section lists
  names it in a `<grant>` of its own (read off the element's rules, as ADR 0091's walk reads grants, never by name). It
  is carried on its granter as `SheetListedElement.includes` (`{ elementId, name }[]`), which a renderer may show on demand
  ("Martial Weapons" opens to its nineteen weapons) and the Markdown does not write. Followed through more than one step
  (Martial Weapons, Martial Melee Weapons, Longsword). Measured: 1,196 of 1,738 rows on the samples.
- **`omitMarked: true`**: an element the section lists is left out when every stat it contributes to is the mark stat of
  a row the sheet shows with that row's mark (ADR 0079's `mark`, ADR 0094's custom marks): "Arcana" is already "Arcana +5
  (proficient)". Found through ADR 0095's contribution walk, which already reads which held element moves which stat.
  Measured: 213 rows.
- **Grouping what is left** (Armor, Weapons, Tools, Languages, Other) uses the section's existing `group` (a setter,
  ADR 0079) once content carries one. Today it does not (above); the place to add it is the conversion of ADR 0119, which
  makes Incudo's content format the only one: a converted proficiency can carry a category setter the system names.
  Until then the section lists languages after proficiencies, as its type order already does. Open question 3.

5e's `pc` Proficiencies section would declare both rules; the NPC's too. The official form's proficiencies box reads the
same document and gets the short list, which fits where the long one overflowed.

### 4. No heading exists only to hold a row

A row that belongs beside another goes there: a section field `beside` already writes a stat beside a row (ADR 0074);
5e's Perception row gets "passive 13" that way, and the Senses section keeps only what content lists (Darkvision), drawn as
one line, and is left out when empty. The same review is done for every 5e section as part of step 3, and each one moved is
named in the step's notes.

### 5. A feature is written with the answer it was given, and one with nothing to say is named once

- **`SheetListedElement.answers`**: the names of what the element's own selects chose (`<element>/select:` records), when
  the section declares `answers: true`. "Fighting Style: Defense", "Ability Score Improvement: Constitution, Constitution",
  "Favored Enemy: Undead". An answer that the same section would list on its own is folded into it (it would otherwise be
  written twice). Measured: 34 of the 53 text-less features.
- **A listed element with no sheet text, no answers and no usage** is written on one "Also:" line at the end of its
  section ("Also: Researcher"), its whole text under Descriptions. `listedIsNameOnly` in `sheet-document.ts` decides it,
  so every renderer agrees.
- **On screen, features are cards** grouped by what gave them (the class, the race, the background, a feat), each with its
  line, its usage and action, and, when it has a limited use, the use spent in place (decision 8). Grouping by giver needs
  `SheetListedElement.from` (the held element whose grants reached it, read as `HolderGrant`'s and ADR 0109's walk does);
  the Markdown keeps one list per section.

### 6. Spells are a table by level, with what the table needs

The Spells section already groups by level and marks prepared (ADR 0079). A section may declare **`facts`**: a list of
`{ label, setter }` or `{ label, flag, text }` read off each listed element (5e: casting time `time`, range `range`,
duration `duration`, components from `hasVerbalComponent`/`hasSomaticComponent`/`hasMaterialComponent`, concentration and
ritual from their flags; content carries these setters on spells, measured on Fireball). They are carried as
`SheetListedElement.facts` and drawn as columns on screen (mockup B), as a short parenthesis in print and in the Markdown.
Each level is headed by its slots, which are spent there (decision 8); the casting block's save DC, attack bonus and
prepared count head the tab. A spell row's text is a click away and in full under Descriptions.

An attack row's "its damage is chosen on Build, under Spells" (ADR 0111) is an instruction and moves off the sheet: the
row reads "—" with an "i" saying where to set it on screen, and the export writes "—".

### 7. An NPC and a legendary creature are drawn as a stat block

Under `sheet.layout: "statBlock"`, the sections are drawn in one column read as a printed stat block reads (mockup D): the
name, the first line in italics (size, type, alignment), rules, armour class / initiative / hit points / speed as lines,
the six scores as a table with each modifier and save, then labelled lines (Skills, Resistances, Immunities, Senses,
Languages, CR), then Traits, Actions, Reactions, Legendary Actions and Lair Actions under coloured headings, each entry
"**Name.** text". Two changes in the document make it read as one:

- **A printed line declares the stat it repeats** (`printed[].stat`): it is shown beside that row only when the number in
  force differs from the print's leading number ("Hit Points 27 (printed 21 (6d4 + 6))"), and otherwise its text replaces
  the row's value ("Hit Points 21 (6d4 + 6)"). Measured before it is built: how many of the 141 creatures' printed AC, HP
  and speed read as their derived value.
- **Other Speeds and the printed speed, and passive Perception and the printed senses, are one line each**, by the same
  rule.

Play for a creature (hit points, legendary action uses, conditions) is a narrow column beside the block on screen. The
legendary creature repeats the NPC's sections today (ADR 0074), and keeps doing so; it adds its own.

### 8. Play state is spent where its number is, and the Play panel goes

Each tracker of ADR 0084's `playView` is drawn beside what it counts, not in a panel of its own:

- a `stat` tracker on that stat's row (hit points in the head band, with Damage, Heal and Temporary; ki, sorcery and focus
  points as a line under the class in the band);
- a `rows` tracker on the row it reads (a slot level's pips in the Spells tab and the Actions tab's slot line);
- a `dice` tracker on the head band's strip (hit dice);
- a `uses` tracker on the feature's card (a box per use);
- a `max` tracker (inspiration, death saves, exhaustion) and the conditions on the strip under the head band. Conditions
  are a chip list with "Add a condition", not fourteen checkboxes; the ones on are shown.
- The rests are buttons at the end of the strip.

To join them `PlayTracker` gains where it came from (`at`: the stat, or the section and row, or the section and element),
which `playView` already knows when it reads the maximum; the document stays play-free (ADR 0084 decision 8), so the
export, the print and the form are unchanged by play and the phone's sheet checksum is unaffected. The phone keeps its
Play tab: on a narrow screen a separate tab is the better fit, and it is the phone's own renderer.

The alternative of a Play tab or a collapsible side panel on the desktop is open question 1.

### 9. Print and PDF draw the same areas, flattened

The print rules are rewritten for the areas: the head band across the top of page 1; the side column and the main column
side by side, every tab's sections one after another under the tab's label, empty tabs left out; Descriptions and kept
texts start a page, as now (mockup E). What is spent is printed as empty boxes and blank lines to fill in by hand (as ADR
0084 decision 8 already wants of a printed sheet), drawn by the print rules from the trackers, never the numbers on
screen. A stat block prints as a stat block. ADR 0078's print options (parts, page numbers, running name) keep their parts;
"the character's own sections" becomes the head, side and main areas together. ADR 0077 decisions 4 and 5 (sections flow
in two columns by what they hold) are replaced by this.

### 10. Narrow windows

At 1100 px and wider the page is as above. From 800 to 1100 px the head band wraps to two rows and the side column narrows.
Under 800 px it is one column: head band, side column, then the tabs. The phone is drawn in that order from the document's
`place`, its own components unchanged otherwise.

## What each reader gains or keeps

| Reader | Gains | Keeps |
|---|---|---|
| Desktop Sheet pane | The layout (decisions 1, 2, 7, 10), tabs, cards, the spell table, play in place (8), section explanations as "i" | Rendering the document and computing nothing (ADR 0074): every field is the document's |
| Markdown export | Order by area and tab; proficiencies folded and marked ones left out (3); answers and "Also" (5); spell facts (6); a stat block's merged lines (7) | One `##` per section with one list; plain text and Markdown one format (ADR 0075). Loses the section explanations if open question 2 is decided so |
| Print and Incudo's PDF | The areas laid out (9), a stat block as one, boxes for what is spent | The print options step, the page rules, the parts, the one `window.print()` (ADRs 0077 to 0079) |
| Official 2014 form fill | A proficiencies box that fits (3), feature lines with answers (5), spells with facts where a box has room | The form map's section ids and rules (ADR 0079); no new field needed, the map reads the same sections |
| Phone | The same folding, answers, facts and stat block lines, and the document's order | Its own renderer, its Play tab, one column |
| Content refresh review | Compares the same document | — |

## Build steps

The build steps are ROADMAP Phase 9's "The Sheet is revamped" item, in this order. Each step ends with the tests it names
failing under a named perturbation, the oracle identical, and the drive its ADR note says.

1. **Measure, as a report-only test** (`tools/verify/src/sheet-revamp.test.ts`): page heights by section in the browser
   build are not testable in Node, so the test measures what the document holds: rows a fold would remove, rows a mark
   already says, text-less features and their answers, spell setters for the facts, which creature prints agree with
   their derived AC, HP and speed, and the proficiency categories content carries. The figures above are its first run.
2. **Fold, omit marked, answers, name-only** in `sheet.ts` and `sheet-document.ts` (decisions 3 and 5), with the system
   fields `fold`, `omitMarked`, `answers`; 5e declares them; the Markdown, the phone and the form follow. Tests: a unit
   test per rule and `sheet-export.test.ts` updated to say every element listed before is still listed or included.
3. **The layout declaration**: `sheet.layout`, `sheet.tabs`, `place`, `tab`, `tiles`, `under`, in the schema, the
   validator (a tab named that the kind does not declare is refused) and the document; 5e's three kinds declare them, and
   each section moved or dropped (Combat's level, Senses, Worn & Wielded) is listed in the step's notes. No renderer
   changes yet: the Markdown reads the new order.
4. **The desktop page**: head band, side column, tabs, tiles, cards, section explanations as "i"; `SheetPane.tsx`
   rewritten over the same document; the print rules switched off for the duration (print still works as today's column
   until step 8).
5. **Play in place**: `PlayTracker.at`; the strip, hit points in the band, uses on cards, slot pips; `PlayPanel` removed;
   conditions as chips. Driven in the browser build and the Tauri window on Windows with the play edits read back from the
   file.
6. **The Spells tab**: `facts` (system field, document, 5e's declaration), the table, slots by level, the casting line.
7. **The stat block**: `layout: "statBlock"`, `printed[].stat`, the merged lines; the NPC and legendary kinds declare it;
   the play column. Measured first by step 1's creature check.
8. **Print and PDF** for the new areas (decision 9), the print-layout and print-options tests rewritten, the 109-print
   drive of ADR 0078 repeated in the window on a sample set, the PDF compared word for word with the export.
9. **The phone**: order from `place`, the folded lists, the stat block's lines; driven on the emulator, the sheet checksum
   logged equal to Node's.
10. **CLAUDE.md, ADR notes, the 1.x roadmap item removed**; the UX pass's F8 closed with screenshots at 1280 × 800.

## Open decisions for the maintainer

1. **Where play state lives on the desktop.** Proposed: in place (decision 8). Alternatives: a Play tab beside the
   others in the main column (as the phone does), or a collapsible side panel on the right. In place is what D&D Beyond
   does and keeps the numbers and what spends them together; a tab keeps the sheet read-only-looking.
2. **The section explanations**: proposed shown as an "i" on screen only, and left out of the print and the Markdown.
   Alternatives: keep them in the Markdown, or drop them everywhere and say it on Build.
3. **Grouping proficiencies by kind** (armour, weapons, tools, languages): proposed after ADR 0119's conversion, by a
   category the converter writes; until then fold and omit only (median 45 to 11 rows). Alternative: a grouping in the 5e
   system definition by support tags and ids now, which content's tags make untidy (armour carries none or "Dwarven
   Armor").
4. **Tabs, or one page with a jump bar.** Proposed: tabs on screen, everything in order in print and export.
   Alternative: one scrolling page with sticky links to each part, which keeps Ctrl+F over the whole sheet.
5. **A feature with nothing to say**: proposed an "Also:" line. Alternative: leave it off the sheet, its text still under
   Descriptions.
6. **Worn & Wielded into Inventory**: proposed. Alternative: keep it as a short side-column block without its "none" rows.
7. **Before or after 1.0.** The roadmap had a laid-out sheet after 1.0 (2026-09-30). This proposes it as a Phase 9 item,
   since the maintainer called the current Sheet unfit; all format changes are additive, so it could also land in 1.x.
8. **The spell table's facts**: proposed casting time, range, duration, concentration and ritual, components. Fewer
   columns (time and range only) would fit the side-by-side print better.
9. **A stat block's ability table**: proposed the 2024 shape (score, modifier and save in each column). Alternative: the
   2014 shape (score and modifier only, saves on a line).
10. **How a mark is drawn on screen**: proposed a filled dot for proficient and a double dot for expertise, with the word in
    the export, the print and for screen readers. Alternative: keep the words on screen.

## Consequences

- Eight system format fields on a sheet section (`place`, `tab`, `tiles`, `under`, `fold`, `omitMarked`, `answers`, `facts`),
  one on a printed line (`stat`) and two on a kind's sheet (`layout`, `tabs`), all optional. The system format is a public API (ADR 0011): each is
  documented in `docs/SYSTEM-GUIDE.md` and the schema, and a system that declares none gets today's sheet.
- The Markdown export, the print and the form fill change bytes for every character: shorter proficiency lists, answers
  on features, facts on spells, merged stat block lines. Tests that pin export text are updated in the step that changes
  them, never by regenerating a fixture without reading it.
- The document gains fields and keeps every field it has, so a reader written against today's document still reads it.
- ADR 0084 decision 7 (a Play section on the desktop's Sheet) is replaced; its decision 8 (play is not in the document)
  holds.
- The work is large: ten steps, three renderers and the print rules. Steps 2 and 3 alone change every export; steps 4 to
  7 are the visible part.

## What this does not do

- It does not copy any official sheet's layout or artwork; the mockups are boxes and type.
- It names no game in core or in a renderer: places, tabs, folds and facts are the system's.
- It does not add play state to the document, to print or to the export.
- It does not change what a sheet section shows (its rows and types), only where and how, except the drops named in
  decisions 2 and 4.
- It does not decide a palette, fonts or icons. Icons, if any are wanted, are a person's work (CLAUDE.md).

## Alternatives considered

- **Keep the column, only move Play below and fold proficiencies.** It answers F8's three bullets and leaves the
  maintainer's "full revamp" unanswered: the page would still be ten screens of labelled lists. It is steps 2 and 5 of
  this plan alone, and remains the fallback if the layout is deferred to 1.x.
- **Lay out by classifying sections in the renderer** (short rows become tiles, lists become cards). ADR 0077 measured
  why not: a section's shape changes between sheets, and a classification by name puts a game in the shell.
- **A layout template per kind (a grid of named cells).** More control, and a second language for system authors to
  learn; three areas and tabs cover every sheet measured.
- **A separate renderer for print**, from the document, in `packages/ui`. Content's HTML is made safe only by the shell's
  sanitizer (ADR 0077 decision 1); still true.
- **Copy D&D Beyond's layout closely.** The four points the known sheets agree on are taken; the rest is designed for
  Incudo's own content (cards for features with sheet lines, a spell table from content's setters).

## Evidence

The figures in Context, measured on 2026-10-19 against `.corpus/` at `c28ce6c` and the thirty committed samples: page and
section heights in the browser build at 1280 × 800 (Sample 08, Sample 07, an NPC and a legendary creature on the 2025 Imp);
proficiency, feature and section counts from `sheetDocument` built in Node over all thirty; the group proficiencies' grants
read from the corpus (23 elements). Build step 1 commits the Node half as a report-only test so that the figures can be
re-run.

## The maintainer's answers (2026-10-27)

1. **Play state**: in place, as decision 8 proposes. The Play panel goes.
2. **Section explanations**: on screen only, as an "i" beside the section's name; left out of print, the PDF and the text
   export.
3. **Proficiencies**: fold and leave out what a row already marks now; group by kind later, from a category the conversion
   (ADR 0119) writes.
4. **Tabs**: tabs on screen; print and export write everything in order.
5. **A feature with nothing to say**: an "Also:" line.
6. **Worn & Wielded**: folded into Inventory as equipped marks and the attunement line; its "none" rows go.
7. **Before or after 1.0**: in 1.0 (a Phase 9 item; the maintainer's call that 1.0 is the desktop release).
8. **The spell table's facts**: all six (casting time, range, duration, components, concentration, ritual).
9. **A stat block's ability table**: both shapes, chosen by a radio button. In the maintainer's words, "make it a choice
   based on source availability". Settled on 2026-10-28: a creature opens in its book's shape (the 2024 shape for one from
   a 2024 or 2025 book, the 2014 shape otherwise), and the switch is remembered nowhere: it lasts while the sheet is open.
10. **How a mark is drawn**: a filled dot for proficient, two for expertise, on screen; the words in print, the export and
    for screen readers.

## Notes as built (2026-10-28)

Each step is its own commit, with its tests failing under their named perturbations; the oracle is untouched (nothing here
moves a derivation). Driven in the Tauri window on Windows with a scratch profile and a scratch library of six packed
samples and a 2025 Imp NPC, never the browser build.

- **Step 1** (`tools/verify/src/sheet-revamp.test.ts`) reproduced the Context's figures: 1,196 of 1,738 proficiencies folded,
  213 already marked, 6 to 24 left (median 11), their tags no clean category; 52 features with no line or usage, 34 of them
  answered; all 311 listed spells carry time, range, duration and the verbal flag; of 141 creatures the printed armour
  class, hit points and speed lead with the derived number for 122, 131 and 138 (the rest print a formula).
- **Step 2, answers**: a chooser with nothing to say is folded into the answers its section lists ("Fighting Style: Defense",
  the answer keeping its own line); an answer with nothing to say is folded into its chooser ("Favored Enemy: Undead"); an
  answer listed nowhere is named under a chooser with nothing to say ("Ability Score Improvement: Constitution +1,
  Constitution +1"); anything else is left as it was. Descriptions still describe what was folded. The "Also" line is part
  of `answers`, not a field of its own. `sheet-export.test.ts` holds every element listed before still listed, included,
  answered or left out by a mark.
- **Step 3, what moved**: Combat's Level row went; Worn & Wielded went (its attunement rows are Inventory's now); Senses
  stayed in the side column, since `beside` writes no label and "passive 13" beside Perception needs one. The Actions tab
  holds the attacks only: "what a feature says takes an action" has no field to say it, and none was added.
- **Step 4** added `SheetListedElement.from` (the nearest giver another section lists), which the cards are grouped by.
  The section explanations left the text export with it (decision 2).
- **Step 5**: `PlayTracker.at` and `playPlaces`; 164 of the samples' trackers are drawn on a row or element the sheet shows,
  120 have no row and go on the strip under the head band. A sheet with no layout (a user's system) keeps the Play panel.
- **Step 6**: a fact is written as plain text, because one setter holds HTML (Shield's casting time names Magic Missile in
  italics). The slots stay rows with their boxes above the table, rather than heading each level: no field joins a slot row
  to a spell level, and none was added for it. Print draws the table, not a parenthesis, and writes each level once.
- **Step 7**: a creature's book edition is not in a save (its book's `release` is on the book's element, which a save does
  not embed), so `statBlock.wide.sources` names the books in the system, matched against the creature's own `source`. The
  printed senses line merges with passive Perception by its last number (`at: "last"`).
- **Step 8**: seven PDFs through the window's `print_to_pdf` held every word of their exports but headings the page draws
  differently, spell levels written once per group, and words `pdftotext` joins at a line-break hyphen; the print step and
  WebView2's preview offered no headers and footers option with the running items on or off.
- **Step 9**: the phone reads the document as it is; `tabStarts` heads each tab in its one column. Typechecked, not driven.
- **Not done**: proficiencies grouped by kind (after ADR 0119 writes a category); a spell's text a click away on screen (it
  is under Descriptions); passive Perception beside Perception; a level's slots heading its spells.
