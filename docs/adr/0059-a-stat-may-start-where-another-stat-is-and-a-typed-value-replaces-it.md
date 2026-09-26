# 0059 — A stat may start where another stat is, and a typed value replaces it

**Status:** Accepted · 2026-09-25 · closes [0057](./0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md)'s
third gap · builds on [0006](./0006-derived-character-state.md), [0012](./0012-self-contained-saves.md),
[0014](./0014-base-stats-are-inputs.md), [0017](./0017-open-decisions-not-steps.md) · **format:** an optional
`startsFrom` on a stat in the system format (`formatVersion` stays 1); no character format change

## Context

ADR 0057 gave the 5e NPC its creature's armour class, hit points and speed by declaring each as a derived stat
that reads the creature's own rule: `ac` derives `companion:ac`, `hp` derives `companion:hp:max`, `speed`
derives `companion:speed`. It left one gap: **an NPC built from nothing had no way to set any of the three**,
and published 0. ADR 0057 named why the obvious fix was wrong — a `manual` budget writes `baseStats`, and a
`derive` *adds* to whatever the stat holds, so a DM's typed 15 on a creature whose rule says 13 reads 28 — and
suggested the starting-value model instead: what the creature states is where the stat starts, a typed value
replaces it.

### What the corpus holds

Measured on AuroraLegacy/elements at `c28ce6c`, 141 `Companion` elements, with a throwaway script (not committed):

| | |
|---|---|
| creatures with a `companion:ac` rule | **141 of 141** |
| creatures with a `companion:hp:max` rule | **141 of 141** |
| creatures with a `companion:speed` rule | **141 of 141** |
| elements of the NPC's types (`Companion`, `Companion Trait`, `Companion Action`, `Companion Reaction`) contributing to `ac`, `hp` or `speed` directly | **0** |
| largest printed hit points / armour class | 136 (Tyrannosaurus Rex) / 16 |
| printed speed | display text, never a plain number: `40 ft., climb 30 ft.`, `20 ft., fly 30 ft. (hover)` |

So every creature states all three as a rule, and the printed setters are the worse source: ADR 0057 measured
them readable as numbers for 123 armour classes and 112 hit point totals of 141, and speed not at all, where the
rules are there for all 141. What an NPC from nothing needs is somewhere to type, and a hit points field capped
at an ability score's 30 would refuse the Tarrasque's 697 (a 2025 Monster Manual prose stat block a DM would copy
by hand, ROADMAP Phase 4).

## Decision

### 1. A stat may declare another stat as where it starts

```jsonc
{ "name": "ac", "label": "Armor Class", "default": 0, "startsFrom": "companion:ac" }
```

When content contributes to the named stat at all, its value is where this stat **starts**. It is a start, in
the one ordering every start already follows, most general first:

1. the stat's declared `default`;
2. `startsFrom`, which replaces the default;
3. a held element's printed setter (`setterStats`, ADR 0057), which is more specific and stays;
4. a base the user set (`Character.baseStats`, ADR 0014), which replaces any of them;

and everything content contributes to the stat itself adds to whichever is in force. Nothing contributing to
the named stat means nothing states it: the default stands, or nothing. The named stat is read as content
contributed it, after every contribution and before the derivations. Core names no stat.

### 2. The derivation publishes where each stat started

`DerivedCharacter.starts` holds every start that came from content — a printed setter or a `startsFrom` — with
its value, what it came from, and whether a base replaced it. It is published even when replaced, because an
editor shows the creature's number beside the typed one, and "clear" goes back to it. A budget row's `printed`
is now read from it rather than recomputed from setters, so the ability scores and these three are one answer,
from the numbers the engine used.

### 3. The 5e NPC reads the three that way, and asks for them

`ac`, `hp` and `speed` on the `npc` kind (and `legendary`, which inherits its stats) are `default: 0` and
`startsFrom` the creature's rule, in place of a `derive`. A new required step, **Armor Class, Hit Points and
Speed**, is a budget over the three with one method, `entry`: typed, from 0, with no maximum. A creature closes
it, as it closes Ability Scores; an NPC from nothing has three to enter.

A budget offering one method applies that method's bounds whether or not it was recorded. Nothing records it (the
editor shows no choice of one), so the bounds the system declared for the NPC's ability scores (1 to 30) used to
apply to nothing; they apply now, and this step's floor of 0 does.

## What this does not do

- **~~Speeds other than walking, senses, skills and saves are still not on the sheet~~** (ADR 0057). Done by
  [ADR 0062](./0062-an-npc-s-other-speeds-saves-and-skills-are-its-creature-s-rules-and-its-senses-are-what-it-prints.md), with this ADR's `startsFrom` for each. As first written: The
  `companion:speed:<mode>` rules exist; an NPC does not publish them under names of its own.
- **The step's pool stat is nominal.** A budget declares the stat content adds points to; `stat block points`
  has no contributor, as the NPC's `ability points` has none. The decision's id is that name.
- **No per-target bounds.** One method, one floor, no ceiling: an armour class of 900 is accepted. The three
  differ in range by two orders of magnitude, and a bound that fits one is wrong for another.
- **The printed setters are not read for these three.** Where the rule and the print disagree (2 armour classes,
  1 hit point total, ADR 0057) the rule is used, as before.

## Alternatives considered

- **A `manual` budget over the three, on top of the `derive`.** The failure ADR 0057 named: the typed value adds
  to the creature's.
- **Read the printed setters through `setterStats`**, the model ADR 0057 already had. It would reach 123 armour
  classes and 112 hit point totals where the rules reach 141, and no speed at all; the rule is the better
  statement.
- **Make `default` an expression.** ADR 0014 declined it for storing scores, and here it would blur a constant
  with something that needs the derivation's own contributions to evaluate, and cannot say "nothing states it".
- **A conditional in the expression language** (`if the base is set, the base, else the rule`). There is no such
  operand, a base is not a stat an expression can see, and it would put the ordering of starts into every system
  that wants it rather than once in the engine.
- **An override.** `overrides` wins over everything and is a repair tool (ADR 0006); a DM entering a stat block
  is not repairing one.

## Evidence

- `packages/core`: `stat-starts.test.ts` — the named stat is the start and content adds; a base replaces it and is
  still published; nothing contributing supplies nothing; it replaces a default; a printed setter stays; a stat
  declaring none is unchanged. Each was checked by removing or changing the line it guards.
- `packages/ui`: `printed-scores.test.ts` — a row started from a rule counts as set, a typed value replaces it and
  the printed value stays shown, and the only method's floor applies unrecorded; it fails when the row reads
  setters alone, or when the single method is not applied.
- `tools/verify`: `npc-creatures.test.ts` — every creature's three are what its rules state and its NPC asks for
  none (fails without `startsFrom` on the kind, or without `starts` published); an NPC from nothing is asked for
  three, takes a hit point total of 697, keeps it when a creature is then chosen, goes back to the creature's when
  cleared, and reopens from its save with no source (fails when a typed value adds, or with the method capped at 30).

Measured after it was built, against `c28ce6c`: 141 of 141 creatures state all three by their rules and leave the
step closed. Every creature's NPC and all thirty sample saves derive identically before and after, element for
element and stat for stat (a summary of each derivation, compared with a throwaway script), and the oracle's
tables are unchanged (`INCUDO_ORACLE_SNAPSHOT` on the base, `INCUDO_ORACLE_BASELINE` on the change).

**Driven in the browser build only**, not the Tauri window, macOS or Linux, with an origin-private folder standing in for the native folder picker. An NPC started from nothing showed Armor Class, Hit Points and Speed as an open, blocking step with three to enter; 697 hit points were typed and kept; choosing the Triceratops then kept the typed values, and clearing hit points and speed went back to the creature's 95 and 50, shown faded, while a typed armour class of 15 stayed. Running it found one thing no test had: the step showed the player character's ability score paragraph ("in 5e an ability score stops at 20") under hit points and speed, and now shows the step's own sentence while nothing is stated.
