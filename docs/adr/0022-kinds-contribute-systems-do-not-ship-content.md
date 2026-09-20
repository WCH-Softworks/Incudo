# 0022 — A character kind may contribute a stat conditionally, and a system ships no content

**Status:** Accepted · 2026-09-11 · builds on [0006](./0006-derived-character-state.md), [0011](./0011-user-systems.md), [0012](./0012-self-contained-saves.md)

Decided ahead of the code it enables, which is step 5 of
[docs/INVENTORY-AND-AC-PLAN.md](../INVENTORY-AND-AC-PLAN.md). It is written now because the
answer changes what `kind.grants` is for, and that question arrives at step 1.

## Context

The plan's D1: armour class needs four conditional stat contributions and there is nowhere to
put them.

```
[armor:none]    ac:armored:armor          = 10      (an unarmoured character's base)
[armor:none|light]  ac:armored:dexterity:cap = 99   (uncapped)
[armor:medium]      ac:armored:dexterity:cap =  2
[armor:heavy]       ac:armored:dexterity:cap =  0
```

With those four, the whole of 5e's armour class is one expression over stats content already
writes, and the bonus buckets do the rest — `calculation` picks the best of 31 alternatives,
`base` lets Medium Armor Master's `3` beat the system's `2` without knowing what the `2` was.
Without them the formula needs a conditional the expression language does not have, twice.

Three candidates, and the plan recommended the wrong one.

## What settles it: a save embeds content and does not embed its system

Two facts, both checked rather than remembered.

**A kind's `grants` are embedded in the save.** `collectCharacterContent` seeds from
`baselineElementIds(options.kind, character.progress)` — that is deliberate and CLAUDE.md warns
about it, because without it ADR 0012 quietly breaks. So any element the kind names ends up
inside `content.json`, frozen at the moment the file was written.

**The system definition is the one thing a save does not embed.** `loadShippedSystem` (`tools/verify`, formerly
`loadSystemForCharacter`) says so in as many words. A `.incu` records `systemId` and the installed system supplies the rest.

Put together, those two give the project a rule it has been following without stating:
**identity is embedded, mechanics are not.** It is why the overlay's doctrine — markers carry
identity and no rules — has held up twice under pressure, in [ADR 0018](./0018-tables-and-track-stats.md)
for the caster level and [ADR 0020](./0020-stats-keyed-on-declared-blocks.md) for the save DC.
It is not only that a second copy of the arithmetic goes stale. It is that a rule on an element
a character holds is **copied into that character's save**, and a rule in `system.json` is not.
Fix `system.json` and every existing character is fixed. Fix an embedded element and you fix
the ones saved afterwards.

The evidence is exact. All seven ids in the 5e kind's `grants` carry **zero rules**. Of the 80
elements the overlay supplies, only six carry a rule at all, and all six are ability score
improvements — `ID_INTERNAL_ASI_CHARISMA` contributes `charisma +1`. Those are not an exception
to the doctrine but a sharpening of it: **a generated element carries a rule only when the rule
is its identity.** Choosing "+1 Charisma" *is* that element; there is nothing else it could
mean, and nothing about it a later system version would want to fix.

The four armour-class rules are the opposite. They are 5e's reading of a published rulebook,
exactly the kind of thing that gets corrected in version 0.3.0.

## Decision

### 1. A character kind may declare `contributions`

```jsonc
"contributions": [
  { "stat": "ac:armored:armor", "value": { "kind": "number", "value": 10 },
    "requirements": "[armor:none]" },
  { "stat": "ac:armored:dexterity:cap", "value": { "kind": "number", "value": 2 },
    "bonus": "base", "requirements": "[armor:medium]" }
]
```

Read as: **contribute `value` to `stat` for a character of this kind, when `requirements`
holds.** It is the fourth thing on a kind that produces a stat, after `stats` (which declares),
`trackStats` (once per track, ADR 0018) and `blockStats` (once per block, ADR 0020) — and it is
the base case those two are variations of. Contributions land with theirs, before derivations
read them.

Three deliberate choices in the shape:

- **`requirements` is a string in content's own requirement language**, not a JSON tree. A
  system definition is authored by hand, `[armor:medium]` is the form its author has already
  read a thousand times in content, and `parseRequirements` exists. An expression that will not
  parse makes the system invalid and is refused rather than partly loaded, which is ADR 0011's
  standing rule. It is named `requirements` and not `when` precisely so that a reader who knows
  content knows it instantly — `trackStats.when` is an element id and means something else.
- **`bonus` is carried**, because without it the `base` bucket cannot be joined and Medium
  Armor Master could not raise a cap it did not write.
- **`max` is not carried.** `StatRule` has one and nothing here needs it; a bound belongs on
  the `StatDef`, where ADR 0016 put it.

Nothing here is armour. It is "a kind may contribute a number, and may say when".

### 2. A system definition does not ship elements

Stated as a decision rather than left as an absence, because the plan proposed the opposite and
someone will propose it again. `systems/<id>/` contains `system.json` and nothing that declares
content. A system says what stats mean, what element types exist and how a character is built;
the elements themselves come from content sources the user configures, and from the two small
generated families the importer supplies.

`.incuset` keeps its job — a compiled content bundle, from ADR 0007 — and stays out of the
system-loading path.

### 3. `formatVersion` stays at 1

Additive and optional; a kind with no `contributions` behaves exactly as before. This is the
fifth additive change to `schemas/system.schema.json` in a row. The next breaking one costs a
version, and that has been true for a while now.

## Consequences

**Good**
- 5e's armour class becomes four lines of data in the file that is *not* copied into saves, so
  correcting it corrects every character ever built.
- No new expression kind and no conditional in the expression language. `RequirementExpr`
  already says `[armor:medium]`, `!([armor:heavy]||[shield:any])` and everything else the
  corpus uses, and the engine already evaluates it against an `EngineContext`.
- The rule the project had been following unstated — identity is embedded, mechanics are not —
  is now written down, with the reason that makes it more than a style preference.
- The inventory work (steps 1–4) needs no loader change, no second file per system and no
  origin filter in the container or in `aurora verify`. That is the practical payoff of
  deciding this before step 1 rather than after.

**Bad / accepted**
- A fourth thing on a kind that produces stats. ADR 0018 flagged this drift when it added the
  third; the count is now stable in the sense that `contributions` is the general case and the
  other two are the iterating specialisations, but it is four fields where a reader might
  reasonably expect one.
- `requirements` as a string is the first place the system format embeds a *different*
  language inside JSON. The schema can only check that it is a string; the parse and the
  report happen in `checkSystemReferences`. Accepted because the alternative is asking a
  human to write a requirement AST by hand.
- A system author can now write a contribution whose `requirements` names a stat nothing
  publishes, and it will silently never fire. That is the same failure content has always
  had, and `validate` reports unmeetable requirements the same way.

## Alternatives considered

**A system ships its own content bundle** — `systems/dnd5e/baseline.incuset`, ordinary elements
with ordinary rules. This is what the plan recommended a day ago, and it is wrong for a reason
that only appears when you ask where the elements end up.

It has two horns and neither works. If the baseline elements are reachable from `kind.grants`,
they are **embedded in every save** by the code quoted above — so their rules are frozen into
each character, and fixing 5e's armour class would fix nothing already built. That is precisely
the failure [ADR 0006](./0006-derived-character-state.md) exists to prevent, and it is why the
seven markers carry no rules today. If instead they are *excluded* from the embed and loaded
alongside the system, then they are `system.json` reached through a second file, a second
loader, an origin filter in `collectCharacterContent` and another in `aurora verify` — which
would otherwise report every one of them as `element-extra` on all nine saves. Three moving
parts to host four stat rules.

There is a third cost worth recording: the ids. Baseline elements need them, and they either
collide with the overlay's (a duplicate id is already one of the 57 warnings) or they are new
ids that no Aurora save can contain, which is the `element-extra` problem again.

None of this says a system may never ship content. If one ever needs to — a system with no
Aurora corpus behind it, shipping its own starter set — the question is worth reopening on its
own merits. It is not the way to host four conditional stat rules.

**`packages/aurora-import`'s overlay**, as rules on the two armour-class markers it already
supplies. The smallest change of all and rejected for the third time, on the same grounds as
ADR 0018 and ADR 0020: it puts a game rule in the package frozen to bugfixes, below the layer
where game rules belong. The embed argument above now also applies to it, which makes the third
rejection stronger than the first two.

**Publish the armour category as a number and index a `table`.** If a slot published
`armor:tier` as 0/1/2/3, the dex cap is `table([99, 99, 2, 0])` and no conditional is needed
anywhere — ADR 0018's `table` already does it. Genuinely tempting, and rejected on legibility:
`[99, 99, 2, 0]` indexed by a tier is a worse description of "medium armour caps Dexterity at
2" than the sentence is, and it makes the system definition declare an ordering of armour
categories that 5e does not otherwise need. It also solves only this; the next conditional
baseline rule would have to invent its own numbering.

**A conditional in the expression language** — an `if` kind on `StatExpr`. It would serve this
and read well inside a `derive`. Rejected because the thing actually missing is not a
conditional *value* but a conditional *contribution*: a `derive` cannot join a bonus bucket, so
`ac:armored:dexterity:cap` could not be raised from 2 to 3 by a feat, and that mechanism is the
one part of 5e's armour class the engine already gets right.
