# 0128 — A candidate note may group a picker, and spells are listed by level

**Status:** Accepted · 2026-10-20 · the maintainer's call · builds on
[0079](./0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md)
(a sheet section's `group`, whose order this reuses), [0117](./0117-the-add-item-list-is-grouped-by-a-setter-the-system-names.md)
(the add-item list in groups, whose shape the phone reuses), [0124](./0124-spells-get-a-tab-a-settled-choice-is-changed-in-the-middle-column-and-a-spell-a-feature-needs-is-a-warning.md)
· **format:** system format `groups` on a kind's `candidateNotes` entry (`formatVersion` stays 1); no character format
change

## Context

A spell list in a picker was one alphabetical list of every level: a Wizard 4's spellbook decision offered 193 spells,
level 1 and level 2 interleaved, each row saying its level in its label ("Alter Self (Level 2)"). The maintainer asked for
the list in collapsible groups by spell level. The system already says what a spell's level is and how it reads: 5e's
`candidateNotes` prints the `level` setter as "Level {value}", 0 as "Cantrip". The engine knows nothing of spells, so the
grouping has to be the same kind of data.

## Decision

1. **A candidate note may declare `groups: true`** (system format, optional). A picker then lists candidates of its types
   in groups, one per value of its setter, labelled as the note reads ("Cantrip", "Level 1"), in the values' order with
   their digits read as numbers (`compareSheetGroups`' rule), each keeping the order it was given. What the note does not
   reach is "Other", last. A list all of one value is not grouped. 5e's spell note declares it.
2. **`candidateGroups(ids, notes, index)`** (`packages/ui/src/candidate-label.ts`) builds the groups as `OfferGroup`s,
   so both shells read one function.
3. **The desktop's picker** shows each group under a heading that folds its rows on a click and stays at the top of the
   list while they scroll. While something is typed every group with a match is shown open and the rest are hidden, so a
   search is never hidden in a closed group. The Build pane hands the kind's notes to every picker in it (a React context),
   so the spell decisions, a settled spell's Change and "Prepare a spell" are all grouped.
4. **Spell decisions are ordered by the lowest group they offer** (`byLowestCandidateGroup`, the same note): on the
   Spells tab a Wizard's cantrip decision comes before its spellbook decision, though the cantrip pool opened at a later
   level. Stable, applied before the list is split into required and optional, so what must be answered still comes first.
5. **The phone's picker** opens such a list on its groups, as the add-item list does (ADR 0117), with "All options" first
   for a search across them.

## Consequences

- A Wizard 4's Spells tab lists its new cantrip before its spellbook, whose decision reads "Level 1 (75)" and "Level 2 (118)", either folded by a click.
- Nothing derived moves; labels and search are unchanged.
- Evidence: `packages/ui/src/candidate-groups.test.ts`, each case failing under its named change. Driven in the Tauri
  window on Windows (2026-10-20): the Wizard 4's two groups, Level 1 folded with a real click, a search showing only the
  group with a match. The phone is typechecked, not driven.
