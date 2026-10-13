# 0114 — The sheet ends with the whole descriptions of what its sections list

**Status:** Accepted · 2026-10-13 · answers ROADMAP Phase 5's "Incudo's sheet shows a listed element's whole description,
and the official form does too where it fits" · amends
[0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md),
[0076](./0076-content-s-sheet-hints-are-read-every-description-kept-chosen-by-the-level-the-element-gates-at.md),
[0078](./0078-a-print-is-chosen-in-a-step-of-the-app-s-own-and-no-edge-of-the-page-is-left-to-the-dialog.md),
[0079](./0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md) ·
**format:** a sheet section gains an optional `describe`, a form map's list rule an optional `describe` (both
`formatVersion` 1); no character format change

## Context

The Sheet shows a feature's one sheet line (ADR 0076) and a whole text only for a kept reference (ADR 0068). The
maintainer's call (2026-10-12): Incudo's own sheet shows the whole text, and the 2014 form does where it fits. Measured
(`tools/verify/src/whole-descriptions.test.ts`, the thirty samples against AuroraLegacy/elements at `c28ce6c`, embeds
expanded, tags stripped):

- **2,571 listed elements, 1,217 with a description; 18,000 to 83,000 characters a sample (median 37,000), roughly 3 to
  14 printed pages.** 136 descriptions hold a table.
- **61% is what a character is**: race, class and background descriptions are book chapters (762,000 characters over 144
  elements; the Monk class alone is 15,000). Features are 183,000 (356 elements), spells 158,000 (311), proficiencies
  144,000 (387), a held creature's traits and actions about 1,000.
- **The 2014 form's Features and Traits flow holds about 4,100 characters** (43 lines of 44 and 23 of 97 at 7 pt); the
  features' whole text fits it on 9 of the 30 samples, before any line wraps short.

The maintainer chose (2026-10-13): **features, spells and a held creature's traits, actions and reactions** get their
whole text, about 11,000 characters a sample; race, class, background and proficiencies keep their name and line. And the
text goes in **a part after the sheet**, not under each line.

## Decision

1. **A sheet section may declare `describe: true`**: the whole descriptions of the elements it lists (the same elements,
   hidden ones left out as the section leaves them out) go into the sheet's Descriptions part, grouped under the
   section's label, a held creature's under "<creature>: <section>". An element listed by two such sections is described
   once. 5e declares it on the player character's Features & Traits and Spells and on a held creature's Traits, Actions
   and Reactions. A hidden trait a stat block names without its line ("Primal Bond", ADR 0076) is now read there whole.
2. **`SheetDocument.descriptions`** (`sheetDescriptions`, `packages/ui/src/sheet-descriptions.ts`), read through the
   builder's index so a save reopened with no source shows what it embeds, each description expanded as Browse expands
   one (ADR 0069). It comes after the creatures and what the user wrote, before kept references.
3. **Every renderer writes it**: the Sheet pane (as kept texts are, sanitized), the phone (as its kept texts are), the Markdown (`## Descriptions`, `###` per group, `####` per element, content's headings from `#####`),
   and print, where it is a part of its own the print options step offers (`descriptions`) and starts a page.
4. **The form writes whole text where it fits.** A form map's list rule may declare `describe: true`: when every listed
   element's whole text, in plain words, fits the flow's capacity, the box gets the whole texts; otherwise it keeps the
   sheet lines, as before. 5e's Features and Traits rule declares it: whole on 5 of the 30 samples once lines wrap.

## Evidence

- `packages/ui/src/sheet-descriptions.test.ts`: only a describing section's elements, once each, grouped, empty texts left
  out, a creature's under its name; the Markdown's headings; each fails under the perturbation it names.
- `tools/verify/src/whole-descriptions.test.ts`: the measurement, and every sample's part holding exactly its describing
  sections' described elements, the same reopened with no source.
- `packages/ui/src/sheet-descriptions.test.ts` holds the form's rule on a stand-in box: whole texts in a roomy box, the
  heads in a tight one, and what is past it named; `tools/verify/src/official-sheet.test.ts` finds the Features and
  Traits box written whole on 5 of the 30 samples (08, 09, 11, 26, 28) and with lines on the rest.
- **Driven in the browser build** (2026-10-13): a 2014 Moon druid's Sheet ends with Descriptions, "Features & Traits",
  Druidic, Spellcasting with the book's own subheadings beneath it. The group and element headings were drawn smaller
  than content's subheadings at first, found by running it, and are now larger. Not the Tauri window, a print or the
  phone.

## What this does not do

- Show race, class, background or proficiency descriptions (the maintainer's call), or any NPC's (its traits' lines are
  their text).
- Shorten or summarise a description.
