# 0080 — A set step may name what a new character starts with, and 5e starts with feats and multiclassing

**Status:** Accepted · 2026-10-01 · amends [0032](./0032-a-build-step-may-offer-a-set.md) (choosing none is no longer
5e's starting answer) · **format:** system, one optional field on a build step (`formatVersion` stays 1); character, none

## Context

5e's campaign options are a set step (ADR 0032, `build/options`), and a new character started with none of them. The
maintainer's call (2026-10-01): feats and multiclassing are used at nearly every table, so a new character should start
with both switched on, and a table that plays without them switches them off.

What the two options do today: `ID_INTERNAL_OPTION_ALLOW_FEATS` gates the feat half of every ability score improvement
(ADR 0035), so a level 4 character is offered a feat beside the increase. `ID_INTERNAL_OPTION_ALLOW_MULTICLASSING` is
read by nothing: multiclassing is gated only on what content declares (ADR 0036), and 0 of the corpus's files reference
the option. Switching it on changes what the character records, and what Aurora's own saves record for a character
built with it, and nothing derived.

The samples Aurora built for this repository record feats on 14 of 30 and multiclassing on 9; they were built to cover
cases, not to say what tables use, so they are not evidence either way.

## Decision

1. **A `multiple` build step may declare `initial`**, element ids a new character starts with in that set. It is a
   system's opinion of a starting answer, the same thing the user could have chosen, so it is **written into the
   character as a recorded choice** (`build/<stepId>`) when the character is created, and from then on it is the user's:
   unticking one changes it, and a character never reads `initial` again. Not a derivation default, because:
   - **a character that records no options keeps meaning none.** Every character written before this, and every
     Aurora import, records exactly what it had; reading an absent set as "the system's defaults" would switch feats on
     in saves that never had them (ADR 0006: characters store choices).
   - **a save embeds what it chose** (ADR 0012), so a character created with them carries them with no source.
2. **Only on a `multiple` step**, and the validator refuses it anywhere else, an id twice, and an empty id. It cannot
   check that content declares the id; a system's definition names content all the time (`kind.grants`).
3. **`newCharacterOfKind` writes it**, for every step of the kind that declares one, and nothing else does: an import
   keeps what its save recorded, and a character opened from a file is not new.
4. **5e's player character declares `initial: [ID_INTERNAL_OPTION_ALLOW_FEATS, ID_INTERNAL_OPTION_ALLOW_MULTICLASSING]`**
   on its campaign options step. The NPC and the Legendary Creature have no such step.
5. **A character created with no source loaded records them anyway** (the app starts a fresh character before any source
   is added), and they resolve once one is. Until then they are listed as not in any loaded source, like every other id
   such a character holds. Filtering them against what is loaded would leave the very first character without them.

## Not decided here

Whether `ID_INTERNAL_OPTION_ALLOW_MULTICLASSING` should gate multiclassing (ADR 0036 left it unread on purpose). Now
that a character can have it off deliberately, it could; that is its own change. *(Decided by
[ADR 0088](./0088-a-per-level-step-may-name-the-option-that-allows-another-class.md): it gates a class the character has no
level in, named by 5e's levels step.)*

## Evidence

`packages/ui/src/character-kinds.test.ts` (a new character records the step's `initial`, a step without one records
nothing), `tools/verify/src/schemas.test.ts` (the validator's refusals), and `tools/verify/src/campaign-options.test.ts`
(a new 5e player character through the builder holds both options and is offered a feat at level 4; unticking feats
removes the offer). Each fails under its named perturbation.
