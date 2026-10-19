# 0124 — Spells get a tab, a settled choice is changed in the middle column, and a spell a feature needs is a warning

**Status:** Accepted · 2026-10-19 · answers the maintainer's calls on the hands-on pass's Build layout findings (F1, F3's
"the place to do it is hidden", F9, and the description dock) · amends
[0115](./0115-a-build-step-may-be-advanced-and-how-a-user-likes-the-build-is-a-preference.md) (a third tab; prepared
spells leave Equipment & notes), [0096](./0096-a-pick-counts-while-its-slot-exists-and-a-pool-s-slots-are-filled-as-a-matching.md)
(the wording of an unmet pick) · builds on [0017](./0017-open-decisions-not-steps.md),
[0032](./0032-a-build-step-may-offer-a-set.md), [0045](./0045-a-class-split-is-one-input-and-an-unmet-ability-score-minimum-is-a-flag.md),
[0064](./0064-a-character-may-carry-elements-its-user-adds-from-loaded-content-and-an-unmet-prerequisite-is-a-flag.md),
[0111](./0111-a-cantrip-is-an-attack-row-its-roll-read-from-content-or-chosen-by-the-user.md),
[0123](./0123-required-decisions-come-first-and-what-shapes-the-build-is-asked-before-it.md) · **format:** system format
`softRequirements` on a character kind (`formatVersion` stays 1); no character format change

## Context

A hands-on pass of the desktop app at 1280×800 found the Build pane cramped, and the maintainer made three calls.

- **Editors of settled choices opened in a strip.** "Change" on a choice already made, and "Edit" on values already set
  (ability scores, an NPC's armour class, hit points and speed), opened inside their card in the right-hand column, under
  the description dock, which took about two thirds of that column. What was left was 90 to 100 pixels tall; the NPC's
  score table was clipped with a horizontal scrollbar. The list Change opened did not mark the current answer, and had no
  way back: no Cancel, and Escape did nothing.
- **Spell work was scattered.** A wizard's cantrip and spellbook selects were among Build's open decisions, the cantrip
  attack settings in the right-hand column under the dock, prepared spells on Equipment & notes, and spells added by hand
  among every other addition. Aurora's builder keeps spells on a tab of their own.
- **The columns were short.** Each of the three columns scrolled on its own inside about 516 pixels; every picker list was
  a further 258-pixel scroll box inside its column; the dock kept describing whatever row the pointer last crossed.

And one rule to keep while there: **a spell a class feature requires must not block that choice.** Measured on the
official corpus (`c28ce6c`, `tools/verify/src/soft-requirements.test.ts` reports it): **10 elements** carry a
requirement naming a spell, every one an Eldritch Invocation (three Player's Handbook, two Xanathar's, five Unearthed
Arcana), **12 terms, all Eldritch Blast, none under a `not`**. A further 19 *grants* are gated on a spell (UA Theurgy's
cleric lists); they offer nothing, so they are out of scope. Before this, the engine's `candidatesFor` read a
candidate's requirements as a filter, so a Warlock 2 who had not taken Eldritch Blast was offered 12 of the book's 17
invocations and never saw Agonizing Blast, Eldritch Spear or Repelling Blast. The prerequisite is written twice in
content: once as the rule, once as prose ("eldritch blast cantrip").

## Decision

1. **A settled answer or set of values is changed in the middle column.** The pane holds what is being edited
   (`SettledEdit`: one slot of a settled choice, or one step's values) and `settledEditView` (`packages/ui/src/build-layout.ts`)
   reads it from the state as it is now: a title ("Change Race", "Edit Ability Scores"), the slot's current answer and
   its options, or nothing once the choice, the slot or the step's values are gone. While it is open, the middle column
   shows it in place of the level panel and the open decisions, scrolled into view; its card in the right-hand column is
   outlined. **Back to open decisions**, **Escape**, a new answer, Done, or switching tab closes it. Picking the current
   answer changes nothing. The current answer is marked "current choice" and **leads the list while nothing is typed**
   (`searchCandidates` takes it as `first`; a query ranks it like any other row). A slot with nothing else to hold shows
   no Change. Settled cards elsewhere (additions, references) keep their own inline behaviour.
2. **Spells get a tab, between Build and Equipment & notes.** A kind's spells are the type its `preparation` prepares
   (5e: Spell); nothing new is declared for it. `buildTabContent` splits the open decisions and the settled choices by the
   type of their pool (an open or answered select's type, else a build step with one type). The Spells tab lists the
   spell choices (required, then optional, folded as on Build), the spell attack settings (ADR 0111) and the prepared
   lists in its main column, and the spells chosen and the spells added by hand (`additionsOnTab`) beside them, with the
   dock. **The tab exists only when the character has any of those** (`hasSpellWork`), so a Fighter's pane has two tabs
   as before; a remembered Spells tab on such a character shows Build (`shownTab`). With no Spells tab, Build's additions
   still offer spells, so a first one can be added. Each tab with required decisions says how many ("Build 8", "Spells
   2"), and Build says "2 spell choices are waiting on the Spells tab" with a link while there are. Switch Build tab
   (Ctrl+Shift+H) cycles the tabs the character has (`nextBuildTab`). The preference record accepts `spells`.
3. **A requirement naming a spell flags an offer instead of filtering it.** A kind may declare
   `softRequirements: { types }` (system format, optional, replaced along `extends`, each type declared, refused
   otherwise); 5e's player character declares `["Spell"]`. Core's `evaluateRequirementsSoftly` reads a `has` term naming
   an element of such a type as met wherever it counts in the expression's favour, and **for real under a `not`**, where
   "met" would refuse. `candidatesFor` takes the predicate (`softRequirementTerms(kind, index)`), so both an open pool's
   candidates and a settled slot's options include such a candidate. Nothing else moves: placement (ADR 0096) already
   fits by type and filter only, and a held pick whose own requirements are false is already `requirement-unmet`, a
   warning that never stops it counting. That problem's words were "are no longer met", wrong for a pick taken unmet; they
   are "are not met" now.
4. **The warning is worded in `packages/ui`** (`soft-requirements.ts`), from the derivation and never stored:
   `softShortfalls` (core) lists, per way of meeting an expression, the soft elements still missing, and
   `softShortfallNote` writes "Needs Eldritch Blast, which this character does not have" (one way's names joined by
   "and", the ways by "or", each name once). `CharacterBuilder.softNotesFor(ruleKey)` answers it for an open decision's
   candidates or a settled pick's options and answers. The desktop's picker shows it under the row with a warning edge,
   and a settled card under its answer; the phone's picker and its settled rows show the same line.
5. **The layout, kept modest.** On a window 860 pixels tall or less the Build pane scrolls as one page, as it already
   did below 1000 pixels wide; the dock stays in view, sticky. A picker list is as tall as the window allows
   (`max(260px, min(55vh, 560px))`). The dock is at most a third of the window (`min(32vh, 320px)`, was `min(45vh,
   420px)`). When the pointer leaves a picker list, the dock lets its text go after 1.2 seconds unless the pointer reaches
   the dock first, so it no longer describes a row nobody is looking at, and a long description can still be scrolled.
6. **The phone shares the view-models, not the tabs.** It is one page: Open decisions and the choices made list Build's,
   and a "Spell choices" heading below them lists the spell decisions, the spells chosen, the spell attack settings and
   the prepared lists. Its picker already opens full screen and marks the current answer, so nothing else changed.

## Consequences

- A Warlock 2 without Eldritch Blast is offered all 17 invocations, 5 of them with the warning; taking Eldritch Blast
  removes it. The derivation flags a held one exactly as before (`requirement-unmet`). A kind that declares no
  `softRequirements` (5e's NPC, Cairn) filters exactly as before.
- The Sheet's notes on a spell attack say where to answer them: "its damage is chosen on Build, under Spells" (ADR 0111's
  words, so the Markdown export changes for a spell with no stated damage).
- The oracle is unaffected: no sample's derivation moves. A soft term changes what is offered, never what is held.
- Not done: the top bar's Build badge still counts every decision, optional ones included; Change on a settled card
  elsewhere (an addition, a reference) still opens inline; the phone has no tabs.

## Evidence

- `packages/ui/src/soft-requirements.test.ts`: a fixture with no game; candidates needing a soft element alone, either of
  two, both, with a non-soft element, or not one; each case fails under its named perturbation (no soft predicate in the
  engine, a negated term read as met, a settled pick not asked).
- `packages/ui/src/build-layout.test.ts`: which tab a choice is on, a settled spell choice staying there, no Spells tab
  without spells, additions split, an edit outliving nothing, and the current answer leading only while nothing is
  typed; each fails under its named perturbation.
- `tools/verify/src/soft-requirements.test.ts`: the measurement above, and a 2014 Warlock 2 built through the builder.
- Driven in the browser build at 1280×800 and 1024×700: a Human Sage Wizard (scores entered, cantrips and spellbook taken
  on the Spells tab, a cantrip changed from its card, the scores edited in the middle column, Race and Background changed
  and left with Escape and Back) and a Human Sage Warlock 2 (Agonizing Blast offered and taken with the warning, the
  warning gone once Eldritch Blast was taken). Not driven in the Tauri window or on the phone (typechecked).
