# 0014 — Ability scores are inputs, in their own field

**Status:** Accepted · 2026-09-09 · amends [0006](./0006-derived-character-state.md)

## Context

Writing the Aurora `.dnd5e` save importer turned up a hole in the character model that nothing
had yet needed: **there is nowhere to put an ability score.**

Aurora stores them as raw numbers:

```xml
<abilities available-points="15">
  <strength>8</strength>
  <intelligence>15</intelligence>
  …
</abilities>
```

Nothing in Aurora's content produces those numbers. No element grants them, no rule computes
them; the app owns the block entirely, because a point-buy spend, a standard-array pick and
four rolled d6s are all just *a number the user decided on*. Incudo's content model has the same
shape — `systems/dnd5e/system.json` declares `strength` with `default: 10`, and every
contribution (`<stat name="dexterity" value="2"/>` on the Elf) adds to it.

So a character built with the corpus and no ability scores derives a Strength of 10 for
everybody. Every downstream number — the modifier, the save, the spell DC — is then wrong, and
the differential verification against Aurora's own `<magic>` block (ADR 0008) cannot run at all,
because Aurora's recorded spell save DC encodes the ability modifier and ours would be zero.

Three places already existed, and all three are wrong:

- **`choices`** — a choice names an element id. There is no element for "Intelligence 15", and
  inventing 6 × 21 of them to have one would be absurd.
- **`overrides`** — the tempting one, and the trap. Overrides are applied last and win over
  everything (ADR 0006). Storing Strength 8 there would make it 8 *after* the half-orc's +2,
  silently discarding the racial bonus. It would look right on a human and be wrong on
  everything else.
- **`rolls`** — the closest in spirit and still wrong. `rolls` means *recorded random results*
  (ADR 0007), and its whole justification is that a die roll has no formula. Point buy is not
  random. Overloading it would make the field's name a lie and its documentation unwritable.

## Decision

Add a fourth input to `Character`:

```ts
baseStats?: Record<StatKey, number>;
```

It is the **starting value** of a stat, replacing the kind's declared `default`. Contributions
add on top of it, in the same pass they already run in, so the Elf's +2 still lands. It is not
an override and does not win over anything.

The engine applies it between the declared defaults and the contribution loop — six lines in
`computeStats`. Keys are stat names, matched case-insensitively like every other stat key.

`Character` now has exactly four kinds of input, and the boundary between them is stateable in
one line each:

| field | what it holds | why it cannot be derived |
|---|---|---|
| `choices` | element ids the user picked | the user picked them |
| `rolls` | recorded random results | a die roll has no formula |
| `baseStats` | starting values the user set | point buy has no formula either |
| `freeform` | text the rules never read | it is prose |

Plus `overrides`, which is not an input but a repair tool, and stays one.

`formatVersion` stays at 1. The field is additive and optional, and no `.incu` file exists
outside this repository yet — the format has not shipped. Had it shipped, this would have needed
a version bump, because a reader that ignored `baseStats` would compute a wrong sheet rather
than a degraded one. That is worth remembering the next time something looks additive.

## Consequences

**Good**
- Ability scores have an honest home, and the reason each of the other three fields was wrong is
  now written down instead of rediscovered.
- The Aurora importer maps `<abilities>` straight across, one line.
- The differential verification against Aurora's `<magic>` block becomes possible, which is the
  whole point of ADR 0008's second DONE criterion.
- Still system-agnostic: `StatKey` is an opaque string, and `core` never learns what strength is.

**Bad / accepted**
- A fourth input field is a fourth thing to explain. Accepted — the alternative was overloading
  one of the other three, and both candidates produce numbers that are quietly wrong rather than
  obviously missing.
- Nothing stops a system author putting a `baseStat` on a derived stat, where it will add to the
  derivation rather than replace it. Documented rather than forbidden: the same escape hatch is
  occasionally what someone needs, and validating it away would cost more than it saves.
- Point-buy *validity* is not modelled. Aurora records `available-points="15"`; Incudo imports
  the resulting scores and not the budget that produced them. A builder UI will want that budget
  later, and it belongs in the system definition, not here.

## Alternatives considered

**Synthesize an element per score.** `ID_ABILITY_STRENGTH_15` as a chosen element, contributing
+5 over the default. Keeps the model unchanged, and poisons the content index with 126 elements
per system that exist only to carry a number. It also breaks `.incu` self-containment in an
irritating way: the save would embed synthetic content that no source declares.

**Let the system declare which stats are "user-set" and keep them in `overrides`,
applied earlier.** Two behaviours for one field, chosen by data — which is exactly the sort of
thing that reads fine when written and is unexplainable a year later.

**Make `default` a function of the character.** Pushes the problem into the system format, which
is a public API (ADR 0011) and much more expensive to get wrong than a character field.
