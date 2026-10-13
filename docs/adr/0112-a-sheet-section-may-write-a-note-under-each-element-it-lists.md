# 0112 — A sheet section may write a note under each element it lists

**Status:** Accepted · 2026-10-13 · answers the last part of ROADMAP Phase 4's "Attacks a character makes beyond a weapon's
single row" (a held creature's actions with what its holder adds) · amends
[0073](./0073-a-creature-a-character-holds-is-derived-one-at-a-time-in-its-holder-s-namespace-and-shown-as-its-own-stat-block.md),
[0076](./0076-content-s-sheet-hints-are-read-every-description-kept-chosen-by-the-level-the-element-gates-at.md) · builds on
[0005](./0005-aurora-import.md) · **format:** a sheet section gains an optional `elementNote` (`formatVersion` stays 1); no
character format change

## Context

A held creature's actions give their numbers only in prose ("Melee Weapon Attack: +4 to hit … plus your proficiency
bonus"). Since ADR 0093 a held creature's stat block has an "Added by Its Holder" section reading content's
`companion:attack` and `companion:damage`. The maintainer chose (2026-10-13) to say it under each action instead: "a line
under each action". Measured (AuroraLegacy/elements at `c28ce6c`):

- **196 `Companion Action` elements, none tagged as an attack** and none carrying a rule; 146 say "Weapon Attack" or
  "Attack Roll" in their prose, which is not read (ADR 0005). Every one has a sheet line.
- **One element writes what a holder adds**: the 2014 Ranger's Companion, `companion:attack` and `companion:damage` each
  the holder's proficiency bonus. Every other creature's own numbers already read its scope (ADR 0073).

## Decision

A sheet section may declare `elementNote: { text, showWhen? }`. Under each element the section lists, the sheet writes
`text`, its `{{stat}}` placeholders filled as a sheet line's are (ADR 0076, unsigned), when `showWhen` names a stat that
is not zero or is absent. It is the sheet's words, never content's, so it is kept apart from the element's own text
(`SheetListedElement.note`) and every renderer writes it as a line of its own.

5e's held creature's Actions section declares "If it is an attack, its holder adds {{companion:attack}} to the attack roll
and {{companion:damage}} to the damage.", shown when `companion:attack` is not zero. Since nothing marks an action as an
attack, the note says "if it is an attack" rather than guess. The "Added by Its Holder" rows stay: they are the numbers,
and the note says where they apply.

## Evidence

- `packages/ui/src/element-note.test.ts`: the note is filled and shown under each listed element, left out when its
  `showWhen` reads zero, and not merged into content's text. Each fails under the perturbation it names.
- `tools/verify/src/attacks.test.ts` and `companions.test.ts`: a 2014 Beast Master 3's beast's actions each carry "its
  holder adds 2"; a Battle Smith's Steel Defender's carry none.
- **Driven in the browser build** (2026-10-13): a new 2014 Human Ranger 3, Beast Master, holding a Wolf: under its Bite,
  "If it is an attack, its holder adds 2 to the attack roll and 2 to the damage." Not the Tauri window or the phone.

## What this does not do

- Rewrite an action's numbers, or tell an attack from another action: content says neither as a rule.
