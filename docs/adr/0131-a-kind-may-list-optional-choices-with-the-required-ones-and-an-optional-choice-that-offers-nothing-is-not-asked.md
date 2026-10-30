# 0131 — A kind may list optional choices with the required ones, and an optional choice that offers nothing is not asked

**Status:** Accepted · 2026-10-30 · the maintainer's call · extends
[0127](./0127-an-optional-step-may-be-listed-with-the-required-decisions-and-optional-class-features-are.md) · amends
[0123](./0123-required-decisions-come-first-and-what-shapes-the-build-is-asked-before-it.md) (what is folded under
"Optional") · **format:** system format `listedWithRequired` on a character kind, and on a heading build step
(`formatVersion` stays 1); no character format change

## Context

ADR 0123 folds every decision nothing owes an answer to under "Optional (N)", closed by default. ADR 0127 took one
family out of the fold, Tasha's optional class features. The maintainer, on the hands-on pass of rc.3, named two more a
player loses too much by never seeing, though both stay optional:

- **A race's or background's variant.** Content marks the choice itself optional (`<select type="Race Variant"
  name="Half-Elf Variant" … optional="true" />`): a plain Half-Elf is complete without one, and the 150 optional selects
  in the corpus must not block. 4 are race variants, 1 a subrace, 8 background variants.
- **Starting equipment** (ADR 0087), optional so a table may hand equipment out itself. A character that never opens
  the fold starts with nothing.

And: a Half-Elf's variants come from the Sword Coast Adventurer's Guide and Eberron. A character offered neither book
(ADR 0049), or with neither loaded, was asked "Half-Elf Variant" with no candidate, only to skip it.

## Decision

1. **A character kind may declare `listedWithRequired: { types }`** (system format, optional, replaced along `extends`;
   each type declared, or the system is refused). An optional content choice of one of those types is listed with the
   required decisions, as ADR 0127 lists a step: sorted among them, still skippable, not counted as owed
   (`OpenDecision.withRequired`). 5e's player character names Sub Race, Race Variant and Background Variant.
2. **A build step that only heads what content opens of its types may declare `listedWithRequired`** too: ADR 0127
   allowed it only on a set or a pick that is not required, and now refuses it only on a step that must be answered
   (required, or a budget). On a heading step it lists the optional choices grouped under it and, on the starting
   equipment step, the starting equipment decisions. 5e's Equipment step declares it.
3. **An optional choice nothing loaded can answer is not offered**: no candidate, nothing chosen, nothing Incudo cannot
   read. Not only the listed types: an optional choice offering nothing has nothing to skip. A required one still shows,
   since something owes it, and one whose filter Incudo cannot read still shows, since that is Incudo's to say.

## Consequences

- A Half-Elf with the books loaded meets its variant beside its required choices; offered only the Player's Handbook,
  it is asked none. A Fighter Soldier meets both starting equipment decisions there.
- The top bar's Build badge still counts every open decision (ADR 0124's known item).
- Evidence: `tools/verify/src/listed-with-required.test.ts` (the Half-Elf with and without the books, the starting
  equipment, against the corpus), `tools/verify/src/schemas.test.ts` (a heading step accepted, a required one refused,
  the kind's types checked). Each fails under its named perturbation. The oracle is unaffected: nothing derived moves.
