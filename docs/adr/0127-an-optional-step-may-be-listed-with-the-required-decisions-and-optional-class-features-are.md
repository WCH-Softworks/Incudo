# 0127 — An optional step may be listed with the required decisions, and optional class features are

**Status:** Accepted · 2026-10-20 · the maintainer's call · amends
[0123](./0123-required-decisions-come-first-and-what-shapes-the-build-is-asked-before-it.md) (what is folded under
"Optional") · builds on [0034](./0034-open-decisions-rank-by-a-declared-step-priority.md),
[0072](./0072-a-build-step-may-offer-items-a-character-equips-and-what-it-takes-is-a-bag-entry.md),
[0081](./0081-an-equip-step-may-offer-only-what-is-gated-on-what-the-character-has.md) · **format:** system format
`listedWithRequired` on a build step (`formatVersion` stays 1); no character format change

## Context

ADR 0123 put every decision nothing owes an answer to below every one that is owed, folded under "Optional (N)". That
included Tasha's optional class features (ADR 0072), which is wrong for them. Several replace a class's own feature, and
the class asks about that feature first: a 2014 Ranger answered Favored Enemy, then opened "Optional" and took Favored
Foe, which replaces Favored Enemy, so the answer was for nothing and a different choice was owed. Natural Explorer and
Deft Explorer are the same shape. The maintainer's call: optional class features are asked right after the class is
chosen. The other optional decisions (a variant, a specialty, alignment, deity, the additional features) stay at the
bottom.

## Decision

1. **A build step may declare `listedWithRequired`** (system format, optional, `formatVersion` stays 1). What it opens is
   sorted with the blocking decisions, by the level it opens at and then its step's rank as before (ADR 0034), and a
   screen shows it with them. It still blocks nothing: it keeps "optional" and Skip, and the counts of what is owed (the
   Open decisions heading, a tab's number, "Nothing more has to be decided") leave it out. Only on a step a character may
   leave unanswered (a set, a step that equips, a pick that is not required), as `advanced` and `offeredWhen`; the
   validator refuses it elsewhere.
2. **`OpenDecision.withRequired`** carries it; the builder's sort reads it, and `decisionGroups` (`build-view.ts`) puts
   such a decision in `required` and counts only blocking ones in `owed`. Both shells read the same function.
3. **5e's optional class features step declares it.** Its rank, 2.7, is after the levels step's hit points (2.5) and
   before the class's own selects, which rank with the class (3), so a Ranger meets it right after its class and before
   Favored Enemy. It offers nothing until a class has a feature of its own there (ADR 0081), so without Tasha's loaded
   nothing changes.

## Consequences

- A 2014 Ranger 1 lists Optional class features before Favored Enemy, still skippable. Without the feature the class's
  own choice is answered after it, as before.
- The top bar's Build badge still counts every open decision (a known item since ADR 0124).
- Evidence: `packages/ui/src/build-flow.test.ts` (a step listed with the required ones sorts among them, is shown there
  and is not counted), `tools/verify/src/optional-feature-offer.test.ts` (the Ranger, against the corpus),
  `tools/verify/src/schemas.test.ts` (the key validates on a set and is refused on a required step). Each fails under
  its named perturbation. The oracle is unaffected: nothing derived moves.
