# 0016 — A stat's bounds are expressions, and they apply to every stat

**Status:** Accepted · 2026-09-10

## Context

The 5e ability score maximum of 20 is the third of Phase 2's missing numbers, and the roadmap
records it as one change: make `StatDef.max` an expression instead of a fixed number. Reading the
engine and the corpus together, it is two, and the second one is the reason the first would not
have worked.

### The clamp does not run for the stats that need it

`StatDef` already has `min` and `max`, described as "clamp after derivation". They are applied in
exactly one place:

```ts
for (const def of kind.stats) {
  if (!def.derive) continue;
  …
  value = clamp(value, def);
}
```

`clamp` is inside the **derived-stat** loop. A stat with no `derive` never reaches it. Ability
scores have no `derive` — they have a `default` of 10 and take contributions from races, feats
and ability score improvements — so `"max": 20` on `strength` today does nothing at all. The
docstring says "clamp after derivation" and means it more literally than anyone reading it would
assume.

This is not specific to the 5e maximum. Any system that writes `min`/`max` on a contributed stat
gets silence, which for a public API (ADR 0011) is the worst of the three possible behaviours —
worse than rejecting it, and worse than honouring it.

### The corpus does not express the maximum the way it looks like it does

`strength:max` and its five siblings appear 11 times each, always as a **contribution**:

```xml
<element name="Ability Score Maximum Over 20" type="Grants"
         id="ID_INTERNAL_GRANTS_ABILITY_SCORE_MAXIMUM_OVER_20">
  <requirements>[type:class]</requirements>
  <rules>
    <stat name="strength:max" value="1" requirements="[strength:max:extra:1],![strength:max:extra:2]" />
    <stat name="strength:max" value="2" requirements="[strength:max:extra:2],![strength:max:extra:3]" />
    …
```

Searching all 740 files for a base value finds none: there is no `name="…:max" value="20"`
anywhere. Aurora hardcodes the 20 in application code, and content only ever describes the amount
by which an item or a boon lifts it. So `strength:max` is a **delta above 20**, not the maximum,
and a system definition that set `"max": 20` and left it there would cap a Manual of Bodily Health
recipient at 20 rather than 22.

The same shape appears on `attunement:max`, which the inventory work will need for the same
reason.

## Decision

### 1. `min` and `max` may be expressions

```jsonc
{ "name": "strength", "label": "Strength", "default": 10,
  "max": { "kind": "binary", "op": "+",
           "left":  { "kind": "number", "value": 20 },
           "right": { "kind": "ref", "stat": "strength:max" } } }
```

The schema accepts `{ "type": "number" }` **or** `{ "$ref": "#/$defs/expr" }` for both bounds, so
every existing definition stays valid and a plain number keeps meaning what it meant. The
expression evaluator is the one that already exists — no loops, no I/O, a fixed function set — and
bounds are evaluated in the same context derivations are, so they can reference any stat.

That is what makes the corpus's shape expressible: the base belongs to the system, the delta
belongs to content, and `20 + strength:max` is the sentence that joins them.

### 2. The clamp applies to every stat, not only derived ones

`clamp` moves out of the derived-stat loop and runs as its own pass over every stat the kind
declares, after contributions and derivations and **before** `overrides`. Overrides keep winning
over everything, bounds included: an override is a repair tool (ADR 0006), and a repair that the
engine then clamps is not a repair.

Order within the pass is settled and worth stating, because bounds can reference stats that are
themselves bounded: bounds are evaluated against the **unclamped** values of other stats, in one
pass, with no fixed point. A bound that depends on a bounded stat is therefore reading the number
before its cap, which is the less surprising of two surprising options and the only one that
cannot loop.

`formatVersion` on `system.schema.json` stays at **1**. Both halves are backward-compatible for
*files*: every valid system definition remains valid, and every `max` that a definition author
wrote already meant this. The behaviour change is that a bound on a contributed stat starts
working, which can only move a number that the author had already asked to be moved.

## Consequences

**Good**
- The 5e ability score maximum becomes expressible, correctly, including the items that raise it.
- A documented feature stops silently doing nothing. `min`/`max` on a contributed stat has been
  accepted by the schema and ignored by the engine since the schema was written.
- `attunement:max` — the inventory work's version of the same problem — is already covered.
- Nothing about this is 5e-shaped. A system with a sanity stat capped at `10 + wisdom:modifier`
  gets it for free.

**Bad / accepted**
- Bounds read unclamped values, so `a` bounded by `b` and `b` bounded by `a` produces an answer
  that depends on nothing sensible. Documented, not forbidden: the alternative is a second fixed
  point in the resolver, and the derivation already has one that is hard enough to explain.
- A bound is now arbitrary arithmetic over stats, so a slow or silly bound is possible. The
  expression language's existing limits are the whole defence, and they are the same ones
  derivations already rely on.
- Existing systems get a behaviour change without a format-version bump. Accepted because the
  change is confined to definitions that already wrote a bound on a contributed stat, of which
  there are currently none — `systems/dnd5e` and `systems/cairn` were both checked.

## Alternatives considered

**Leave `max` a number and let content own the whole cap.** Have the system declare nothing and
expect `ID_INTERNAL_GRANTS_ABILITY_SCORE_MAXIMUM_OVER_20` to supply the 20. The corpus does not
supply it, cannot be edited (ADR 0005), and the element is gated on `[type:class]`, so a character
with no class would have no maximum at all.

**A dedicated `cap` rule kind**, so content could say `<cap stat="strength" value="20"/>`. Adds a
sixth rule kind to a model whose whole appeal is that there are five, and it puts the base value
back in content, where this corpus demonstrably does not keep it.

**Clamp contributed stats only when the bound is an expression.** Would avoid the behaviour change
entirely, at the cost of a rule that no one could remember: the same field means two things
depending on which JSON type it holds. The behaviour change affects zero shipped definitions;
this cure is worse.
