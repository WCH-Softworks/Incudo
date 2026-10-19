# 0123 — Required decisions come first, and what shapes the build is asked before it

**Status:** Accepted · 2026-10-19 · answers the maintainer's six calls on the hands-on pass's Build findings (F2, F4,
F11 and the scores card) · amends [0034](./0034-open-decisions-rank-by-a-declared-step-priority.md) (the order),
[0080](./0080-a-set-step-may-name-what-a-new-character-starts-with.md) (where `initial` is shown),
[0115](./0115-a-build-step-may-be-advanced-and-how-a-user-likes-the-build-is-a-preference.md) (5e's two steps no longer
use `advanced`) · builds on [0017](./0017-open-decisions-not-steps.md), [0019](./0019-recorded-rolls-are-readable.md),
[0044](./0044-hit-points-follow-the-method-the-character-uses.md),
[0089](./0089-the-other-hidden-item-families-are-two-more-equip-steps-and-a-player-character-s-sheet-shows-its-other-speeds.md) ·
**format:** system format `offeredWhen` and `askedAtStart` on a build step (`formatVersion` stays 1); no character
format change

## Context

A hands-on pass of the desktop app found Build's decisions hard to follow, and the maintainer asked for six changes.
Measured first on the official corpus (`c28ce6c`), by building a 2014 and a 2024 Human Soldier Fighter and taking each
to level 3 (`tools/verify/src/decision-order.test.ts` now reports the after):

- **Optional decisions sat among required ones.** The order was by the level a decision opens at, then by its step's
  rank (ADR 0034). So the 2014 Fighter 3 listed Campaign options second, and five optional first-level decisions (Human
  Variant, Optional class features, Variant Feature, Specialty, Alignment, Deity) came before "Hit Points, level 2",
  "Martial Archetype" and "Hit Points, level 3", which were last. The 2024 Fighter had the same shape with three
  optional decisions.
- **Campaign options were a decision at the top of the list for the whole build**, already answered by ADR 0080's
  `initial` (feats and multiclassing on) and never closing, since an option not taken could still be added.
- **"Additional features" and "Ability score adjustments"** (ADR 0089) were hidden behind ADR 0115's "Show advanced
  options". That is a preference of the user's, so once someone switched it on, every character they built was offered
  both. The maintainer wants each character's table to turn them on.
- **"Hit Points, level 1 — Record the maximum"** was a required card in both books, and its only button wrote the die's
  maximum: a rule (ADR 0019), shown as a choice.
- **The scores card vanished** the moment the last score was set, while a hit point roll's card waits for its Done.
- **Each pick put the next card in the same place**, so a quick second click landed on the new card.

## Decision

1. **Required before optional.** The builder sorts Open decisions by whether they block first, then as before (the
   level each opens at, then its step's rank). Shells split the list with `decisionGroups` (`build-view.ts`) and fold the
   optional ones under "Optional (N)". Whether that group is open is remembered in ADR 0115's `build/view` record
   (`optionalOpen`, closed by default). The count beside "Open decisions" counts only the required ones.
2. **A set may be asked at the start** (`askedAtStart`, system format, only on a `multiple` step). It opens no decision.
   `BuilderState.startOptions` publishes each such set with what it offers and what it holds, even when that is nothing,
   and `chooseAtStart(stepId, ids)` writes it whole. New character opens a dialog with `initial` ticked: "Start building"
   writes the ticked set, and Cancel keeps the defaults. On Build the set is listed under the choices already made, with
   "Change…" opening the same dialog. 5e marks its campaign options. The dialog is `StartOptions.tsx` on the desktop and
   `StartOptionsView.tsx` on the phone, which asks once its content has loaded.
3. **A step may wait on an element** (`offeredWhen`, system format, refused on a step a character must answer). While
   the character does not hold that element, the step opens no decision and has no line among the character's parts.
   What was taken through it stays settled and changeable, as with `advanced`. It is the character's own answer, not a
   view, so nothing is declined. 5e's two steps declare `ID_INTERNAL_OPTION_ALLOW_ADDITIONAL_FEATURES`. That is a new
   campaign option ("Additional Features") in the Aurora overlay (`generated-elements.ts`, 83 to 84 elements), beside the
   feats and multiclassing switches. It is Incudo's, not Aurora's: Aurora's app offers these items to everyone. They no
   longer declare `advanced`, so 5e has no advanced step and the switch is not shown. The mechanism stays for other
   systems.
4. **The first level's hit points are recorded, never asked.** On every read after a change, `getState` records the
   first level's die maximum once its die is known and nothing is recorded (`firstLevelRecord`, `hitpoints.ts`). It is
   what the old card's button wrote, so the character format, the derivation and the oracle are unchanged. When the first
   class changes to another die, a first level holding the old die's maximum moves to the new one. Any other value there
   was typed or imported, and is kept. Nothing is recorded while ADR 0044's fixed (average) mode reads its own.
5. **A budget changed while its card is open waits for Done** (`confirmBudget`), as a hit point roll does. A budget
   changed from the settled column does not bounce back. The review is the builder's, never the character's.
6. **The card that takes the top is marked.** `arrivedDecision` (`build-view.ts`) names it when the top has changed. The
   desktop gives it a 400 ms slide-in, and for those 400 ms it takes no click (`ARRIVAL_GUARD_MS`). Under
   `prefers-reduced-motion` it is an outline instead. The phone fades it in, or outlines it when reduce motion is on.

## Consequences

- After the change, the 2014 Fighter 3 lists its twelve required decisions (Ability Scores, Language, Personality
  Trait, Ideal, Bond, Flaw, Fighting Style, Skill Proficiency, Gaming Set, Hit Points 2, Martial Archetype, Hit Points 3),
  then six optional ones. The 2024 Fighter lists thirteen required ones, then three optional. Neither has a level 1 hit
  point card or a Campaign options decision, and both record a d10's 10 for level 1.
- A character opened with a class and no first-level roll gets one on its first read. It reads as unsaved, which is true
  (ADR 0120).
- A table that wants the additional features ticks the option, at New character or later. A character imported or built
  earlier that took one keeps it listed.
- The overlay is 84 elements. ADR 0119 will replace the overlay's internal ids with Incudo's own, and this option goes
  with them.
- Not done here (separate tasks): spells in their own tab, editing a settled choice in the middle column, duplicate
  printings. The Build tab's badge still counts optional decisions.

## Evidence

- `packages/ui/src/build-flow.test.ts`, each test failing under the perturbation it names: the blocking key taken out of
  the sort, `askedAtStart` ignored, `offeredWhen` ignored, `firstLevelRecord` answering nothing for an unrecorded level,
  `reviewBudget` a no-op, `arrivedDecision` naming any top. `use-character-builder.test.ts` and
  `build-preferences.test.ts` were changed to the new behaviour.
- `tools/verify/src/schemas.test.ts`: both keys validate on a set, and each refusal is held.
- `tools/verify/src/decision-order.test.ts`: required before optional for a Fighter 6 and a Wizard 6, and the 2014 and
  2024 Fighter 3 reported line by line with their invariants. `campaign-options.test.ts` reads the options from
  `startOptions` (9 with the new one). `hidden-items.test.ts` ticks the option where it measures the two steps.
- Driven in the browser build at 1280×860, against the official source: New character opens the dialog with feats and
  multiclassing ticked; Start building; the scores stay with Done after the standard array is placed; Done brings Race to
  the top marked and unclickable for 400 ms; Alignment and Deity are folded. With "Additional Features" ticked in the
  dialog, the two steps appear among the optional decisions. A Human Soldier Fighter showed no level 1 hit point card;
  levelled to 2, then to 3 in Rogue (Fighter 2 / Rogue 1), its new hit points (levels 2 and 3) and the Rogue's skill and
  expertise were among the twelve required decisions, above all ten optional ones. Not driven on the phone (typechecked only) or in the Tauri window.
