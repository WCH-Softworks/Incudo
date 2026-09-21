# 0040 — A chosen element follows the track of the element that offered it

**Status:** Accepted · 2026-09-20 · amends [0015](./0015-class-levels.md) (its "grants inherit
their granter's track" rule) and touches [0018](./0018-tables-and-track-stats.md) ·
**no system-format change**

## Context

[ADR 0015](./0015-class-levels.md) made a level gate read the size of *its own track*: an element
named in `Character.advancement` starts a track, everything it grants inherits that track, and
`level="6"` on a Rogue feature means Rogue level 6. That is what makes a multiclassed character
possible at all. The rule it wrote down was about **grants**.

A subclass is not granted. A Rogue's Roguish Archetype is a `select` in a class feature, and the
character's answer is a recorded *choice*, which the engine seeds into the derivation exactly as it
seeds anything else the user picked: with **no track**. An element in no track gates on the
character's total progression (0015's deliberate fallback, "right for a race"). So a subclass
picked through a `select` reads the character's level, not its class's.

Nothing saw it, because nothing had both halves. A single-class character has no tracks and the
total *is* the class level. The one multiclass oracle, a level 20 Paladin 2 / Warlock 18, has no
Paladin oath and a Warlock patron whose gates are all below 18. Trying to build ROADMAP Phase 2's
exit criterion in the running app, a level 8 Rogue/Wizard with a subclass, found it in the first
hour.

### What it costs, measured

A Wizard 4 / Rogue 4 (Arcane Trickster, School of Evocation), character level 8, against the real
corpus. Every wrong figure below is a gate reading 8 where the book means 4.

| | before | Player's Handbook |
|---|---|---|
| Potent Cantrip (a Wizard 6 feature) | granted | not until Wizard 6 |
| Arcane Trickster's own slots (Rogue 4) | 4 first, 2 second | 3 first |
| Trickster spells owed at Rogue 4 | 6 | 4 |
| **Multiclass caster level** | **4** (slots 4/3/0) | **5** (slots 4/3/2) |

Wizard 1 / Rogue 3 read the same way: 5 Trickster spells owed at Rogue 3 against the book's 3
(`level="4"` and `level="7"` selects counted because the total was 7), and a caster level of 1 where
it is 2.

The last row is a *second* defect and the bigger one. ADR 0018 counts a marker element once per
track that contains it, and the Arcane Trickster grants
`ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_THIRD`. A track is a set of members inherited
through grants, so the marker was a member of nothing, and the third-caster contribution was never
made: every Rogue/Wizard and Fighter/Wizard the engine could build had slots one tier short, with no
error anywhere. `aurora verify` could not see it for the reason ADR 0030 and ADR 0036 already give
for their own blind spots: it compares what a character *chose*, and no sample save has a
subclass caster beside a full one.

## Decision

**A recorded choice is an edge in the same graph a grant is.** An element that offers a `select`
passes its track, and its track *membership*, to every element recorded in that pool, and those
pass it on through whatever they grant or offer in turn. Core learns no new noun: it already says
"an element in `advancement` starts a track and what it reaches inherits it", and a pick is now
reached.

Three things in the mechanism are decisions rather than plumbing.

1. **A pick is expanded after its chooser, not before.** A pick is a seed, so it is in the derivation
   from the first step, and every seed used to be expanded immediately. Expanding a pick first reads
   its level gates before its chooser has passed the track on. The answer would then turn on which
   of the two a character's `choices` list names first. Picks are now queued only when an edge
   reaches them; whatever nothing reaches is expanded last, on no track.
2. **Only where there are tracks.** A character with no `advancement` defers nothing and derives in
   the order it always did. Measured, not argued: every save in a set of real saves was derived with the
   engine before and after, and the whole output (element order, every stat, pending and answered
   choices, problems) is identical on every one, the multiclass Paladin 2 / Warlock 18 included.
   It has no chosen subclass with a gate between its class level and its total, which is the
   reason it never saw this.
3. **A pick whose chooser is gone still seeds, on the total.** ADR 0015's carried gap, "nothing
   prunes the picks of a class whose levels went away", is kept exactly. Inheriting a track is not
   a reason to start pruning; that wants a decision about every pick, not about levels.

### What it deliberately does not do

- **A second chooser does not re-expand.** If two tracks each offer the same element (a spell in
  the Wizard's spellbook and in the Trickster's list), the first edge to arrive decides the level
  gate, the second only adds membership, and elements the pick has already expanded do not
  inherit that second membership. This is the limit 0018 already documents for a grant's
  descendants; the engine reports `ambiguous-track` only when a level gate rides on it, and spells
  carry none.
- **No new problem code, no format change, no system-definition change.**

## Consequences

- A chosen subclass's `level=` grants, stats and select pools read its class's level, and its
  markers count for its class. Multiclass slots for a subclass caster are the book's.
- The derivation order of a multiclassed character's *granted* elements can differ from before,
  because a pick's grants are discovered later. Nothing compares that order: a summary sorts, and
  the UI ranks by declared priority (ADR 0034).
- The Aurora oracle is unchanged and proves only that nothing regressed. The
  evidence for this decision is `engine.test.ts`, where each half of the mechanism is removed in
  turn and the tests fail (four fail without the deferral, five without the edge), and the Wizard 4
  / Rogue 4 rebuild in `tools/verify/src/rogue-wizard.test.ts`, worked by hand against the book.
