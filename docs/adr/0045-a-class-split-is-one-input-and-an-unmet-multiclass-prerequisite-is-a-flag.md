# 0045 — A class split is one input, and an unmet multiclass prerequisite is a flag, not a gate

**Status:** Proposed · 2026-09-23 · builds on [0012](./0012-self-contained-saves.md),
[0015](./0015-class-levels.md), [0017](./0017-open-decisions-not-steps.md),
[0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md) ·
amends [0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md) (decision 4) ·
**no format change** (`advancement` and the multiclass record are written exactly as before)

## Context

Aurora makes you say "level 17 Fighter / Wizard" one level at a time: build the whole level in one class,
then level up in the other, and do it in an order the app dictates. ROADMAP Phase 2 records the maintainer's
long-standing annoyance with that, and asks for two things:

1. declare a character as a multiclass from the start, with the class split as **one input**, and open every
   decision that split owes at once, in the flat list ([ADR 0017](./0017-open-decisions-not-steps.md));
2. multiclass ability minimums are **flagged, not enforced**: the character is allowed to exist, the builder
   shows which gate is unmet and by how much, and clears the flag when the score rises.

What already exists ([ADR 0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md)): a per-level
record (`advancement`), the second class's multiclass element written beside it, `planProgress`,
`planLevelClass` and `planFirstClass` in `packages/ui/src/multiclass.ts`, and a class-levels control. The
per-level editor can already build a Fighter 12 / Wizard 5, by adding levels and reassigning them. What is
missing is only the *input* (totals), and a different *stance* on eligibility. So this is small in code and
large in meaning, which is why it is an ADR.

### What the two open questions in the roadmap turn on

**Totals do not say an order, and the order is observable.** `advancement` is per level, and the engine reads
it as a sequence: `ID_LEVEL_n` gates, `track:first` (the character's very first level is the hit die's
maximum, [ADR 0044](./0044-hit-points-follow-the-method-the-character-uses.md)), and the multiclass element's
key (`ID_LEVEL_{n}/select:Multiclass (Level {n})`) all name *a level number*. A Wizard 4 / Rogue 4 built
Wizard-first differs from the same totals built Rogue-first in exactly these ways: which class holds the first
level, and so the maximum die, the starting proficiencies and the saving throws.

**"Flagged" needs a number, and the requirement language can supply it.** A multiclass block's requirement is
an expression over `atLeast` terms (`[cha:13]`, `([str:13]||[dex:13])`,
[the requirements parser](../../packages/core/src/requirements.ts)). Evaluating it gives a boolean. "By how
much" needs the terms that failed and the character's value for each, which is a walk over the same tree
`forbiddenBy` (ADR 0036) already does for negations.

## Decision

### 1. A split is an ordered list of segments, and its order is the order the levels were taken

The input is `[{ class, levels }, …]`: Fighter 12, then Wizard 5 means levels 1 to 12 went to the Fighter and
levels 13 to 17 to the Wizard. **The first segment is the first class**, and the sum is `progress`. This is
the reading a person means by "Fighter 12 / Wizard 5", it needs no new concept, and it is exactly what
`advancement` records, so the split *is written as* `advancement` plus each later class's multiclass element
(ADR 0036 decision 2). No new field on `Character`, no `formatVersion` change.

Consequences of choosing the simplest order rather than asking for more:

- **Interleaving is not expressible in a split, and stays what the per-level control is for.** A player who
  wants Rogue, Wizard, Rogue, Wizard writes the split (Rogue 4 / Wizard 4) and then reassigns levels one at
  a time, as today. The split is the fast path to a valid character, not a second model of levels.
- **The order matters and the control says so**: the segments are an ordered list a person can reorder, the
  first row is labelled as the class the character started as, and the hint under it says what that changes.
- **Re-entering a split replaces per-level assignments.** Applying a split rewrites `advancement` from the
  segments. If the character already had interleaved levels, that is a loss, so the control applies a split
  only on an explicit action and never as a side effect of typing. A recorded hit point roll is kept unless
  its level now belongs to a class with a different die (ADR 0036 decision 5), and the cleared roll reopens
  as a decision.

### 2. Applying a split opens everything it owes, in the list that already exists

Nothing new opens decisions: the engine derives which selects a set of classes owes, and the builder already
publishes them in one flat list ([ADR 0017](./0017-open-decisions-not-steps.md)). Applying a Fighter 12 /
Wizard 5 therefore opens the Fighter's fighting style and subclass, the Wizard's cantrips and spellbook, every
ability score improvement level 4, 8, 12 and 16 (the level in its own class, ADR 0035), hit points where the
average option is off, and so on, at once. The requirement is met by the split *writing the two records*, and
by nothing else. Perturbation and a Fighter 12 / Wizard 5 built from a split, compared with the same character
built one level at a time, are the proof (both must have the same `advancement`, the same choices and
derivation).

### 3. An unmet multiclass prerequisite is a flag: derived, per class, never stored

This amends ADR 0036 decision 4, which offered a class only when its gate held.

- **Every class with a multiclass block is takeable.** `ClassOption.eligible` stops being a gate on the write
  (`planLevelClass`, `planProgress` and the new split write) and becomes what it always described: whether the
  requirement holds *now*.
- **A class the character has, and whose block's requirement does not hold, carries a flag.** The flag is
  computed on every read from the derivation, exactly as `unavailable: 'prerequisite'` is today, and lists the
  failed terms as data: `{ stat: 'cha', needs: 13, has: 10 }` for a plain `atLeast`, and for an `or` the
  alternatives that are closest, not all of them. The shell words it ("Charisma 13 needed, you have 10, 3
  short"); package code never writes a sentence.
- **The flag clears itself.** Nothing is stored. Raising the score (a feat, an improvement, an item that sets
  it, ADR 0044's minimum) changes the derivation, and the next read reports no flag. There is no
  "acknowledged" state and none is needed.
- **`excluded` is a flag too, of a different kind.** The 2014/2024 pair of one class (`!(ID_…_CLASS_X||
  ID_…_MULTICLASS_X)`) is not fixable by a score, so it is reported as `excluded` with `excludedBy`, and it does
  not clear. It is still not *refused*: a person building a house-ruled character may want both, and Incudo
  reports rather than forbids ([ADR 0005](./0005-aurora-import.md)).
- **The one thing still unavailable is a class with no multiclass block** (`no-multiclass-rules`, the one
  Unearthed Arcana class in the corpus). Not because it is illegal, but because the multiclass element ADR
  0036 says must be written does not exist, and writing `advancement` alone is measured wrong.
- The three deliberate omissions of ADR 0036 stay: the current class's own prerequisite (content is silent),
  *when* a score was met, and the campaign option. A flag is honest about that with one sentence in the
  control ("prerequisites shown are the ones the content states").

The flag is a *report*, like `over-attuned` ([ADR 0023](./0023-attunement-gates-and-reports.md)): Incudo says
what the rules say and lets the character exist.

### 4. How a flagged character is written to `.incu`, and why ADR 0012 holds

Exactly as any multiclass character is. The flag is not an input and is not stored. Reopening a saved
character with zero sources re-derives it from the embedded class elements, whose `multiclass` blocks
(including `requirements`) are part of the element and so already in `content.json`, and from the character's
own scores. So the save opens, and the flag reappears, with no source configured. This is an assumption to
**verify**, not to trust: a test builds a flagged split, packs it, opens it against an empty index and reads the
flag back (see Order of work).

### 5. Where the code goes

All in `packages/ui/src/multiclass.ts` under `node --test`, with the shell computing nothing (the same rule as
ADR 0036): `planSplit(character, segments, config, elements)`, `ClassOption.flag`, and one
`CharacterBuilder.applySplit(segments)`. The desktop control is a rendering of `ClassLevelState`: a segment
list (class, levels, up/down), an Apply button, and flags beside each class.

## Consequences

**Good**
- A level 17 Fighter 12 / Wizard 5 is one screen and one action, and every decision it owes is on screen at
  once.
- The stance matches how people actually play (a house rule, a DM's allowance, a build planned around a score
  the next feat will reach) and the builder still says what the book says.
- No format change; imported and built multiclass characters keep one representation.

**Bad / accepted**
- **The builder is permissive by design now.** A character can be built that the Player's Handbook forbids.
  It is flagged and never hidden, which is the point of the change, and it reverses ADR 0036's "never offers
  what it refuses".
- **A split loses interleaving** if applied over a hand-built order. The action is explicit and says so.
- **The current class's own prerequisite is still not checked** (content is silent).
- Flag wording for `or` requirements is a judgement (which alternative to show). Chosen: the alternative
  with the smallest total shortfall, and all of them when they tie.

## Alternatives considered

**Ask for the order too** (a full per-level table as the input). Right for interleaved builds and it is what
the per-level control already is; making it the only input is the annoyance being removed.

**Count the split as unordered totals and pick an order** (largest first, or the class with the strictest
prerequisite first). Rejected: it decides which class holds the maximum die and the starting proficiencies on
the user's behalf, and the choice is observable. Ordering by what was typed is the least surprising.

**Store the flag, or an "I know" acknowledgement, on the character.** A stored derived fact goes stale the
moment a score changes ([ADR 0006](./0006-derived-character-state.md)), and an acknowledgement is one more
input with no formula behind it for a warning that costs nothing to keep showing.

**Keep gating and add a "force" switch.** Two modes to describe, test and explain, where one report does the
job, and the gate is the thing the maintainer asked to be rid of.

## Order of work, each step provable alone

1. **The flag.** `ClassOption.flag` from the requirement tree, shortfall as data. Proof: the 28 blocks against
   characters with scores just under and just over each minimum; `or` and `and` shapes from the corpus.
   `planLevelClass` stops refusing on eligibility. Perturbation: a score below a minimum reads the flag, raised
   reads none.
2. **`planSplit`.** Proof: Fighter 12 / Wizard 5 from a split equals the same character built level by level
   (advancement, choices, derivation); Rogue 4 / Wizard 4 and Wizard 4 / Rogue 4 differ in exactly the first
   level's maximum die and starting proficiencies; a die change clears only the rolls it should.
3. **The container.** A flagged split, packed and opened against an empty index, re-derives identically and
   shows the flag (ADR 0012).
4. **The control.** Segment list, Apply, flags, the plain wording; driven in the running app against the real
   corpus, because the view layer has no oracle (ROADMAP Phase 2's lesson).
