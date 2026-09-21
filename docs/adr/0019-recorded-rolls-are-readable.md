# 0019 — A recorded roll is readable by a derivation

**Status:** Accepted · 2026-09-10 · builds on [0007](./0007-native-formats.md), [0015](./0015-class-levels.md)

## Context

Every 5e character Incudo can produce has **0 hit points**. `systems/dnd5e/system.json`
declares `{ "name": "hp", "label": "Hit Points", "default": 0 }` and nothing derives it.

The reason is smaller and stranger than "the formula is missing". Reading the engine:

```
$ grep -n rolls packages/core/src/engine.ts
(nothing)
```

**`deriveCharacter` has never read `character.rolls`.** The field is written by the save
importer — a real Paladin 2 / Warlock 18 save carries `hp:level:1` through `hp:level:20`, `10, 7, 8, 3, 3, 8, …` —
declared an input by [ADR 0007](./0007-native-formats.md), round-tripped faithfully through
the `.incu` container, and consumed by nothing. It is the only one of `Character`'s six
inputs that no derivation can see. `baseStats` lands in the stat table, `advancement` seeds
tracks and publishes their counts, `progress` is published as a stat, `choices` are the
whole point, `generation` is read by the builder. `rolls` is write-only.

### What content supplies, and what it does not

The same shape as the two numbers before it, for the third time running. Content contributes
to `hp` 162 times, and every one is a delta:

```xml
<stat name="hp" value="level" />                 <!-- Tough, Dwarven Toughness -->
<stat name="hp" value="level:sorcerer" />        <!-- Draconic Resilience -->
<stat name="hp" value="tough:hp" />
```

There is no base anywhere — no rule that says "a d10 class gives you a d10 a level", and no
rule that adds the Constitution modifier. Aurora computes both in application code, exactly as
it does the ability score maximum ([ADR 0016](./0016-stat-bounds-are-expressions.md)) and the
multiclass slot table ([ADR 0018](./0018-tables-and-track-stats.md)). The corpus does carry the
hit die, as a setter on each class — `<set name="hd">d12</set>`, 29 of them — but a setter is
not a stat and nothing reads it.

### There is no oracle for this one, and that has to be said out loud

Aurora's save format records the **rolls** and never the total. `<defenses>` is empty; the
only `<attributes>` block in that save belongs to its companion and is all tens. There is no
derived hit point value anywhere in any of a set of real saves.

So unlike the ability score maximum, the slot table and the spell save DC, this number cannot
be checked against Aurora. `incudo aurora verify` will not gain a comparison, a set of real saves
will not confirm it, and a passing test suite means only that the code does what this document
says — not that what this document says is right. Every other number in Phase 2 has been
settled by a differential check. This one is settled by reading the Player's Handbook, and it
is the first number in the project where that is the whole of the evidence.

## Decision

### 1. `rolls` is an expression kind

```jsonc
{ "kind": "rolls", "pattern": "hp:level:{n}" }
```

The sum of `character.rolls[…]` for `{n}` at each point of progression from the progression's
minimum to the character's current `progress`. Nothing else: no dice, no randomness, no
generation. Core does not roll and must never learn how — a roll is an input precisely because
it has no formula (ADR 0007), and an engine that could produce one could silently reroll it.

It is a `StatExpr`, so it composes with the arithmetic that already exists, and 5e's hit points
become one sentence in data:

```jsonc
{ "name": "hp", "label": "Hit Points", "default": 0,
  "derive": { "kind": "binary", "op": "+",
              "left":  { "kind": "rolls", "pattern": "hp:level:{n}" },
              "right": { "kind": "binary", "op": "*",
                         "left":  { "kind": "ref", "stat": "constitution:modifier" },
                         "right": { "kind": "ref", "stat": "level" } } } }
```

Content's 162 contributions add on top, because a `derive` adds to what was contributed.

**Bounded by the progression, not by the key space.** A character who drops from level 20 to
level 5 counts five rolls, and the other fifteen stay in the file untouched. That falls out of
ADR 0007's rule that a recorded result never silently disappears: deleting them on the way down
and asking for them again on the way up would be a reroll with extra steps.

### 2. What is *not* derived: the hit die

`hd` stays a setter that nothing reads, and level 1's maximum stays outside the model. Both are
questions for the builder — *what should this level offer, and what should it default to* — and
their answer is a recorded roll like any other. A shell reads `hd` off the class element it
already has in `derived.elements`, offers "roll a d10" or "take the average", and records the
result under `hp:level:7`. Putting the average-versus-rolled decision in the derivation would
make hit points partly an input and partly a formula, which is the shape ADR 0006 exists to
prevent.

The consequence is worth stating rather than hiding: **a character with no recorded rolls has
no hit points from levels**, only the Constitution modifier and whatever content grants. That
is visibly wrong rather than quietly wrong, which is the trade ADR 0005 keeps making.

### 3. `formatVersion` stays at 1

An additive expression kind. Every existing system definition remains valid and every existing
expression means what it meant.

## Consequences

**Good**
- Hit points exist. It is hard to overstate how much of a character sheet was waiting on a
  number that read zero.
- The last write-only field on `Character` becomes readable, and the fix is general rather
  than a hit-point special case. Any system with a recorded-result-per-level — a wound track,
  accumulated corruption, a per-session luck roll — gets it.
- Dropping a level stops silently discarding what was rolled above it.

**Bad / accepted**
- **Unverified, and unverifiable against Aurora.** Stated in the commit, in this ADR and in
  ROADMAP rather than left for someone to assume the differential check covered it.
- A character built with no recorded rolls shows too few hit points until the builder starts
  recording them. Preferred to inventing an average in the engine, which would mean the sheet
  disagreed with itself the moment a real roll arrived.
- `ExpressionContext` grows a third method, and a context with no character behind it sums
  nothing. Every such context in the engine already delegates to the one the character builds,
  so the only callers that see zero are ones with no rolls to read.

## Alternatives considered

**Publish each roll as an ordinary stat**, so `hp:level:3` is readable and the system sums the
twenty terms it needs. No new expression kind, and it puts twenty references in a definition
that means "all of them" — wrong the day the maximum level changes, and unwritable for a
progression whose maximum is open.

**Sum every roll sharing a prefix**, ignoring the progression. One less concept, and it counts
the rolls of levels the character no longer has. The bug would be a level 20 character who
respecs to 5 and keeps 20 levels of hit points, discovered by a player rather than a test.

**Derive hit points from the hit die and `advancement`**, taking the average where no roll is
recorded. It is what a builder should *offer*, and as a derivation it makes one number half
input and half formula: the sheet would change when a roll was recorded, and there would be no
way to say "I rolled a 1" without an override. ADR 0006 already settled this shape.

**Store the hit point total on the character.** It is a derived number, so ADR 0006 says no,
and the reasons are the usual ones: it goes stale when Constitution changes, and it cannot be
recomputed when content is updated.
