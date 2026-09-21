# 0021 — `equipped` is a condition, and it is not evaluated yet

**Status:** Accepted · 2026-09-10 · builds on [0005](./0005-aurora-import.md), [0008](./0008-aurora-compatibility-frozen.md)

## Context

`packages/aurora-import/src/parse-elements.ts` read Aurora's `equipped=` attribute as a
boolean, in two places:

```ts
equipped: child.attrs['equipped'] === 'true',
```

**The corpus contains 79 `equipped=` attributes and not one of them is `"true"`.** Every one
is a requirement expression over equipment state:

```
22  equipped="[armor:none]"                 16  equipped="[armor:none],[shield:none]"
15  equipped="![armor:heavy]"                9  equipped="![armor:medium],![armor:heavy]"
 6  equipped="[armor:heavy]"                 3  equipped="!([armor:heavy]||[shield:any])"
 2  equipped="[armor:any]"                   1  equipped="![armor:any]"
 1  equipped="[shield:none]"                 1  equipped="[primary:none],[secondary:none]"
 1  equipped="[primary:double-bladed scimitar]"
 1  equipped="[primary:any],[secondary:any],![primary:versatile]"
 1  equipped="[primary:any],([secondary:none]||[shield:any])"
```

So all 79 parsed to `false`. And the field was dead a second time over: `Rule.equipped` was a
`boolean` on both `GrantRule` and `StatRule`, and nothing in the engine, the verifier or the
CLI read it. **All 79 rules applied unconditionally.**

That makes it the fourth construct in the family `<supports>` (3,611 blocks), element-level
`<requirements>` (1,845) and `<append>` (171) belong to — every one of them silently dropped,
and every one found by counting what the corpus actually contains rather than by reading the
format. The syntax is the same language `packages/core/src/requirements.ts` already parses,
including `[flag]` membership, `!`, `,`, `||` and parentheses. Nothing new had to be written
to read it.

76 of the 79 sit on `<stat>` and 3 on `<grant>`. None names an element id, so nothing about
reference resolution or `.incu` self-containment moves.

## Decision

### 1. `Rule.equipped` is a `RequirementExpr`

The importer parses it with the same `safeRequirements` wrapper `requirements=` already uses,
so an unparseable one is an import diagnostic rather than a silent `false`. A missing
attribute is `undefined`, not `false` — the 16 `"equipped": false` keys in the committed
fixture container disappeared on rebuild, which is the data loss becoming visible.

### 2. Nothing evaluates it yet

This is the part that was a decision rather than a bugfix, and it was measured before it was
made. Evaluating `equipped` in `activeRules` today moves **no `aurora verify` count** —
1 `element-missing`, 0 `spell-missing`, 0 `stat-mismatch`, 53 `element-extra`,
51 `not-modelled`, 13 `content-missing`, all unchanged. It does change four derived stats
across three of a set of real saves, and **every one of those changes is wrong rather than merely
unknown**:

| save | stat lost | the rule |
|---|---|---|
| a monk | `ac:calculation` 18 | `equipped="[armor:none],[shield:none]"` — Unarmoured Defence |
| the same monk | `innate speed:misc` 10 | `equipped="[armor:none],[shield:none]"` — Unarmoured Movement |
| a paladin/warlock in plate | `ac:misc` 1 | `equipped="[armor:any]"` — Defense fighting style |
| a fighter in a breastplate | `ac:misc` 1 | `equipped="[armor:any]"` — Defense fighting style |

The reason is worth stating exactly. With no inventory in the model there is no `armor` stat,
so `statString('armor')` is `undefined` and `[armor:none]` compares `''` against `'none'` and
reads **false** — against a character wearing nothing, which is the opposite of the truth.
`[armor:any]` reads false as well, against a character in plate. Meanwhile `![armor:heavy]`
reads **true**, because negating a false is a true.

So evaluating today is not "unknown, so nothing applies". It drops all 41 positive checks and
keeps all 38 negations, which is a combination no real character is ever in: the monk is
simultaneously not-unarmoured (loses Unarmoured Defence) and not-in-heavy-armour (keeps the
`![armor:heavy]` bonuses). A wrong answer that looks like a considered one.

Parsing stops the data loss. Evaluating waits for something for `[armor:none]` to be a
question about.

### 3. No `formatVersion` moves

`Rule.equipped` is a `packages/core` model change, not a save-format change. `schemas/` does
not mention `equipped` at all — the three schema documents cover `system.json`,
`character.json` and `manifest.json`, and an `Element` inside `content.json` is not schema'd.
Regenerating `tools/verify/fixtures/aelin` with `npm run fixtures:rebuild` is the whole of the
migration, and it only *removes* keys.

## Why this is a bugfix, under the freeze

`packages/aurora-import` is frozen to bugfix-only ([ADR 0008](./0008-aurora-compatibility-frozen.md)).
This is the same argument [ADR 0015](./0015-class-levels.md) made for the
`<element type="Level" class=>` fix, and it is worth making explicitly rather than assuming:

**the importer reads a documented Aurora construct and produces the wrong value.** Not a
missing feature, not speculative support for something Aurora might have done — a value that
is `false` 79 times out of 79 where the source says `[armor:none]`. The freeze exists to stop
Aurora compatibility growing new surface, and reading an attribute the corpus has always
carried is not new surface.

The half that is *not* a bugfix — evaluating it — is deliberately not in this change, and it
would not belong in `aurora-import` anyway. That is engine and system-definition work, above
the frozen layer.

## Consequences

**Good**
- 79 conditions the corpus has always carried are readable, and correct when inventory arrives.
- The fourth silently-dropped construct is closed. It was found the same way as the other
  three: by counting the corpus instead of trusting the parser.
- A malformed `equipped=` is now an import diagnostic rather than a silent `false`.

**Bad / accepted**
- `Rule.equipped` is a known-inert field: parsed, stored, round-tripped, read by nothing. That
  is the honest cost of splitting this in two, and it is recorded here so the next reader does
  not mistake it for an oversight the way the boolean was mistaken for a feature.
- Every one of the 79 rules still applies unconditionally, so a character in plate still shows
  a barbarian's Unarmoured Defence in `ac:calculation`. Visibly a placeholder rather than
  quietly wrong, which is the trade [ADR 0005](./0005-aurora-import.md) keeps making — and
  `ac` itself is still `default: 10` with nothing derived, so nothing on the sheet reads it.

## Alternatives considered

**Parse and evaluate in one change**, accepting the movement. Measured above and rejected on
the measurement: it makes four numbers wrong on three of a set of real saves and would have had me
record a baseline I believe is incorrect. The `aurora verify` counts staying identical is not
an argument for it — it is a reminder that the differential check does not compare `ac`.

**Give `armor` a default of `"none"` in `systems/dnd5e/system.json`**, so `[armor:none]` reads
true for a character with nothing modelled. It makes the monk right and the plate-wearer worse
— every armoured character would gain Unarmoured Defence — and it puts a guess about
unmodelled state into the system definition, where it would quietly survive the arrival of the
real inventory.

**Leave the boolean and widen it later**, when inventory lands. It keeps one change instead of
two, and it means the corpus keeps being read wrong in the meantime, in a field that looks
deliberate. The whole reason this was found at all is that a `boolean` named `equipped` reads
like a decision someone made.

**Include `equipped`'s expressions in `referencedElementIds`.** None of the 79 names an
element id — they are all bracketed stat checks — so it would change nothing today and add a
path to keep correct. Named here so the next reader knows it was looked at rather than missed.
