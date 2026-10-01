# 0081 — An equip step may offer only what is gated on what the character has, and 5e's optional class features follow the class

**Status:** Accepted · 2026-10-01 · amends [0072](./0072-a-build-step-may-offer-items-a-character-equips-and-what-it-takes-is-a-bag-entry.md)
(what the step offers) · **format:** system, one optional field on an equip step (`formatVersion` stays 1); character, none

## Context

ADR 0072's "Optional class features" step offered all 36 of Tasha's optional class features to every character, a Wizard
the Ranger's and a character with no class all of them. The maintainer's call (2026-10-01): they are chosen after the
class and filtered by it.

Measured (`optional-features.test.ts`, then `optional-feature-offer.test.ts`, report-only on the commit before this, on
AuroraLegacy/elements at `c28ce6c`): none of the 36 carries requirements of its own. Each gates its grants on its own
class's level (`level:ranger >= 1`), but for Primal Companion, which gates them on holding the Beast Master subclass. The
step's `requires: ["class"]` only orders it after Class; Class is always available, so the step was always open.

## Decision

1. **An equip step may declare `gatedOnHeld: true`** (on `equip`): it offers an element only when one of its grants is
   gated on something the character has, a term of the grant's requirements, not under a `not`, naming **a stat the
   character publishes above zero, or an element it holds**. Not whether the requirement holds: a Fighter 1 is offered
   Martial Versatility, which gives its feature at Fighter 4, as a book lists a class's features with their levels. No
   game noun: the engine already publishes a class's level as a track stat (ADR 0015) only for a class the character has.
2. **5e's step declares it.** Before a class is chosen the step offers nothing, and a step with nothing to offer opens no
   decision, so it is chosen after the class; with one, it offers that class's features (1 to 7 per class, both editions,
   none of another's); a multiclass character is offered each of its classes'; Primal Companion once Beast Master is held.
   The Artificers and the UA Mystic are offered none, as Tasha's gives them no such item.
3. **What is taken stays taken.** A feature whose class goes away stays in the bag and settled on Build, where it can be
   taken back; its grants give nothing, being gated on that class.

## Evidence

`tools/verify/src/optional-feature-offer.test.ts`: the measurement, and an assertion through the builder against any
corpus (no offer with no class; every class offered only features gated on its own level), which fails with 5e's flag
removed. `packages/ui/src/equip-step.test.ts` (a term read as whether it holds, a negated term counted, the flag unread or
read when undeclared) and `tools/verify/src/schemas.test.ts` (the field's type) each fail under their named perturbations.
Driven in the browser build (headless Edge on the dev server, clicks injected over the debug port).
