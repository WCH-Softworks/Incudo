# 0026 — Armour class is derived from a published rule, and nothing checks it

**Status:** Accepted · 2026-09-11 · builds on [0016](./0016-stat-bounds-are-expressions.md), [0019](./0019-recorded-rolls-are-readable.md), [0022](./0022-kinds-contribute-systems-do-not-ship-content.md), [0023](./0023-attunement-gates-and-reports.md), [0025](./0025-slots-publish-tags.md)

Step 5 — the last — of [docs/INVENTORY-AND-AC-PLAN.md](../INVENTORY-AND-AC-PLAN.md). It builds
[ADR 0022](./0022-kinds-contribute-systems-do-not-ship-content.md)'s `contributions` and spends
it on two things: 5e's armour class, and the attunement limit
[ADR 0023](./0023-attunement-gates-and-reports.md) deferred.

Written because the plan's four-row table turns out to be **six rows**, and because a number no
oracle can see needs its arithmetic written down somewhere a reader can check it. That is
[ADR 0019](./0019-recorded-rolls-are-readable.md)'s position exactly, and this ADR is the same
shape: here is the rule, here is the sum, here is the list of what would have caught an error
and did not.

## Context

`ac` has been `default: 10` on every character Incudo has ever derived. Everything needed to
replace that has arrived: content writes 240 `ac:*` stat rules (plan), a slot answers
`[armor:heavy]` ([ADR 0025](./0025-slots-publish-tags.md)), and a kind may contribute a stat
conditionally (ADR 0022). What is left is arithmetic, and deciding where it goes.

### Nothing in the corpus writes `ac`

Re-measured against the parsed 12,058: **0** rules write `<stat name="ac">`. The bare stat is
Incudo's to derive and no content contribution can land in it, which is what makes replacing the
default safe rather than a collision.

What content does write, with the buckets it writes them in:

| stat | rules | buckets |
|---|---:|---|
| `ac:armored:enhancement` | 49 | `enhancement` 49 |
| `ac:misc` | 43 | unbucketed 40, `fighting style` 2, `defenders blade` 1 |
| `ac:calculation` | 31 | `calculation` 31 |
| `ac:armored:armor` | 25 | **unbucketed, all 25** |
| `ac:shield` | 13 | `shield` 2, `enhancement` 11 |
| `ac:armored:dexterity:cap` | 3 | `base` 3 |

Two of those rows decide things below. `ac:armored:armor` is unbucketed everywhere, so a
system-contributed base of 10 would **add** to a suit of armour rather than lose to it. And each
of the 31 `ac:calculation` rules is a *complete* armour class — the Aberrant Mind's is
`13 + dexterity:modifier`, summed on the element into its own private stat and then referenced —
so the best calculation is `max` against the armoured sum, never a component of it.

### `ac:armored:dexterity:cap` cannot express heavy armour

This is the finding that moved the plan's four rows to six. The Player's Handbook says of heavy
armour that it does not let you add your Dexterity modifier, **and that it does not penalise you
when that modifier is negative**. `min(dexterity:modifier, 0)` gets the first half right and the
second half wrong: a Strength paladin with Dexterity 8 in plate reads 17 where the book says 18.
That is not an exotic build, it is the standard one.

A cap alone cannot say it, because the statement is a floor and not a cap. So the dexterity term
gets both bounds — which is the vocabulary [ADR 0016](./0016-stat-bounds-are-expressions.md)
already uses for a stat, applied here to one term of a sum.

**The nine sample saves cannot tell the two readings apart.** Both characters in heavy armour,
Bran Brightwood and Vigaro Safeguard, have a Dexterity modifier of exactly **0**, where
`min(0, 0)` and `max(0, min(0, 0))` agree. Recorded here in the spirit of ADR 0018's rounding
note: a formula that agrees with a character it cannot disagree with has proved nothing.

### 103 of the 127 body-slot elements are not armour

Every element with `slot="body"` and no armour category — 103 of 127 — is an **adorner**: Mithral
Armor, Armor +1, the ten Dragon Scale Mails, whose `armor` setter is an attach constraint and not
a category (ADR 0025). Adorners occupy no slot, so none of them ever fills the `armor` stat by
the normal path. But a user *can* equip one on its own, and ADR 0025 called the resulting tag set
"a harmless nonsense string". With an armour class derived it stops being harmless: a slot
holding `mithral armor` answers `[armor:none]` with **no**, and a base of 10 gated on
`[armor:none]` would vanish. Hence the asymmetry in decision 2.

## Decision

### 1. The armour class of a 5e player character

```
ac = max( ac:calculation,
          ac:armored:armor
            + max( ac:armored:dexterity:floor,
                   min( dexterity:modifier, ac:armored:dexterity:cap ) )
            + ac:armored:enhancement )
     + ac:shield
     + ac:misc
```

It lives on the **`pc` kind's** `ac` stat, as a `derive`, and the kind's entry replaces the
system's — so `npc` and `legendary` keep `default: 10` and derive nothing (decision 4).

The `default: 10` does **not** survive on the `pc` kind. The engine adds a derivation on top of
whatever a stat already holds (`evaluateExpr(def.derive) + (result.get(key)?.value ?? 0)`), so
keeping it would have added a second 10 to every character the moment the unarmoured
contribution supplied the first. Exactly one of the two carries the base, and it is the
contribution — because an armour's own base has to be able to replace it.

### 2. Six contributions on the `pc` kind

```jsonc
{ "stat": "ac:armored:armor",           "value": 10,  "requirements": "[armor:none]" },
{ "stat": "ac:armored:dexterity:cap",   "value": 99,  "bonus": "base", "requirements": "![armor:medium],![armor:heavy]" },
{ "stat": "ac:armored:dexterity:cap",   "value": 2,   "bonus": "base", "requirements": "[armor:medium]" },
{ "stat": "ac:armored:dexterity:cap",   "value": 0,   "bonus": "base", "requirements": "[armor:heavy]" },
{ "stat": "ac:armored:dexterity:floor", "value": -99, "bonus": "base", "requirements": "![armor:heavy]" },
{ "stat": "ac:armored:dexterity:floor", "value": 0,   "bonus": "base", "requirements": "[armor:heavy]" }
```

**The base asks the exact question and the bounds ask the permissive one**, and that asymmetry is
the measurement above, not an oversight:

- `ac:armored:armor` is unbucketed in all 25 content rules, so a base of 10 that fired *beside*
  a suit of armour would read 28 for a character in plate. It must fire only when the slot is
  genuinely empty, which is what `[armor:none]` asks.
- A dexterity cap of 0 is the damaging default — it silently removes a real bonus — so the
  uncapped row fires for everything that is not medium or heavy: no armour, light armour, a
  third-party category this system has never heard of, or one of the 103 adorners equipped on
  its own. The same reasoning gives the floor's negation.

The `base` bucket on the four bound rows is what lets content raise them: Medium Armor Master
contributes `ac:armored:dexterity:cap` **3** in `base`, which beats the system's 2 by
largest-wins, and Serpent Scale Armor contributes `dexterity:modifier` in the same bucket, which
uncaps it for whatever the character's Dexterity happens to be. Both mechanisms are old; neither
needed a line of code.

`99` and `-99` are "no bound". A sentinel rather than an absent contribution, because the bucket
resolves largest-wins and an absent row would read 0 — which is a cap of zero, the exact wrong
answer.

### 3. The attunement limit lands, as ADR 0023 decision 3 wrote it

One more contribution, the first unconditional one:

```jsonc
{ "stat": "attunement:max", "value": 3, "bonus": "base" }
```

and the kind's inventory declaration names the two stats, because core cannot say the word:

```jsonc
"attunement": { "setter": "attunement", "requires": "true",
                "countStat": "attunement:current", "maxStat": "attunement:max" }
```

`attunement:current` is published from the bag as a **contribution**, not as an input stat
overwriting whatever is there — because content writes it too, twice (Soul of Artifice, `0` both
times), and a published input would have silently discarded that.

One attuned **entry** is one attunement. Aurora carries one flag per instance and none per
adorner (ADR 0024 decision 5), and that is also the rule: a Flame Tongue greatsword is one
attuned item, modelled as a mundane host plus a magical adorner. An entry counts when it is
equipped, flagged attuned, and its element or one of its adorners requires attunement.

Exceeding the limit is a problem code of its own, **`over-attuned`**, at error level — the family
`over-selected` belongs to, per ADR 0023. Not a refusal: the derivation completes and says what
is wrong.

**None of the nine sample saves is over.** Counted rather than assumed, because if one had been,
the report would be right and this paragraph would have to say so: 1, 0, 1, 0, 3, 2, 1, 1, 3.

### 4. A kind with no bag keeps the number it has

`npc` and `legendary` show `ac` on their sheets, declare no `inventory`, and are therefore the
state ADR 0025 decision 6 refuses to evaluate: `[armor:none]` has no answer for a creature with
no slots. They keep the system-level `ac` with `default: 10`, contribute nothing to it, and
derive nothing.

That is the right answer rather than a deferral. A monster's armour class is a number printed in
its stat block — "natural armor 17" — not a sum over what it is wearing. It arrives as a
contribution from the creature's own content, or from `overrides`, and a formula would only get
in the way. The `contributions` field is per kind precisely so this is expressible by leaving it
out.

### 5. `formatVersion` stays at 1

`contributions` is optional and additive, and so are `countStat` and `maxStat` on the attunement
block. Sixth additive change to `schemas/system.schema.json` in a row; the next breaking one
costs a version.

## The nine, and what checked them

The arithmetic, character by character, from the stats each save's items already contributed.
`dex` is the Dexterity modifier, and every row is
`max(calc, armor + applied + enh) + shield + misc`.

| character | armour | `calc` | `armor` | dex | cap | applied | `enh` | `misc` | **ac** |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Bran Brightwood | plate (heavy) | — | 18 | 0 | 0 | 0 | — | — | **18** |
| Deusinaldo | none (monk) | 18 | 10 | +4 | 99 | +4 | — | — | **18** |
| Hexadin | breastplate (medium) | — | 14 | +2 | 2 | +2 | — | 1 | **17** |
| Krusk Oathfang | studded leather (light) | — | 12 | +5 | 99 | +5 | 1 | — | **18** |
| Merilio | half plate (medium) | — | 15 | +2 | 2 | +2 | — | 1 | **18** |
| Paelias Amakiir | none | — | 10 | +2 | 99 | +2 | — | 1 | **13** |
| Theren Liadon | studded leather (light) | — | 12 | +4 | 99 | +4 | — | — | **16** |
| Vigaro Safeguard | plate (heavy) | — | 18 | 0 | 0 | 0 | 1 | 1 | **20** |
| arturo | none | — | 10 | +5 | 99 | +5 | — | 1 | **16** |

Every one of those agrees with the Player's Handbook worked by hand: plate is 18 and ignores
Dexterity; studded leather is 12 plus all of it; breastplate and half plate are 14 and 15 plus at
most 2; an unarmoured character is 10 plus all of it; a monk's Unarmoured Defence wins by `max`
against the 14 the armoured branch offers.

**Nothing else checked them, and nothing ever will.** No `.dnd5e` save records an armour class —
`<defenses>` holds an empty `<conditional>`, and the only `<attributes>` block in the format
belongs to the companion. `aurora verify` gains no comparison here and cannot: this is hit
points' position (ADR 0019), and `ac` must never be described as verified. It is derived from a
published rule, its inputs are checked against Aurora, and the sum itself is checked by reading.

What stands in for an oracle, and what each piece is actually worth:

- **The inputs are verified.** Which elements the bag brings into the derivation is checked
  against Aurora for 45 instances across nine characters (plan, step 3), and it is those elements
  that write `ac:armored:armor 18`. The 18 is Aurora's; the sum is not.
- **Perturbation covers the branches the saves do not.** Nobody in the nine carries a shield, so
  `ac:shield` is 0 on every row above and the `+ ac:shield` term has never once been exercised by
  a real character. Nobody has a negative Dexterity modifier in heavy armour, so the floor never
  bites. Both live in tests that force the slot, which is the same fallback ADR 0025 had to use.
- **The medium-armour cap is the weakest row.** Hexadin and Merilio both have a Dexterity
  modifier of exactly **+2**, so `min(2, 2)` agrees with `min(2, 99)` and with no cap at all.
  Two characters at precisely the boundary is not evidence that the cap works; the test that
  forces a +4 Dexterity into half plate is.
- **The attunement limit fires zero times**, as ADR 0023 said in advance, because no sample save
  is over it.

## Consequences

**Good**
- ADR 0022's mechanism is built and immediately has two unrelated users, one conditional and one
  not, which is the check that it was a general shape rather than an AC-shaped one.
- 5e's armour class is six lines of data plus one expression in `system.json`, the file a save
  does **not** embed — so correcting it corrects every character ever saved. That was the whole
  argument of ADR 0022 and it is now load-bearing.
- Every conditional the corpus already writes is answered off the same declaration `equipped=`
  reads, and nothing new was added to the expression or requirement languages.
- `attunement:max` reads 3 instead of 0, which removes the "warning nobody can act on" that
  ADR 0025 decision 8 deliberately refused to ship.

**Bad / accepted**
- A fifth thing on a kind that produces stats, after `stats`, `trackStats`, `blockStats` and the
  slot inputs. ADR 0022 accepted this in advance and the count is now what it predicted.
- **Spiked Armor reads 24.** Its `slot="armor"` is an upstream typo (ADR 0025), so it never
  reaches the armour slot, the slot stays empty, and the system's base of 10 lands *beside* the
  element's own 14. The `slot-unknown` warning already names it. Fixing it here would mean
  guessing that `armor` meant `body`, which is the guess ADR 0005 rules out — and the number is
  now visibly wrong rather than invisibly so, which is the trade this project keeps making.
- An adorner equipped as a top-level item still occupies the armour slot with a nonsense tag and
  contributes no base. The permissive bounds stop it reading 0, but it reads `0 + dexterity`
  rather than `10 + dexterity`. No importer produces this state; a UI can refuse it.
- `99` and `-99` are magic numbers in a data file. They are the honest spelling of "no bound"
  given that a bonus bucket resolves by largest-wins, and 99 was already the plan's.

## Alternatives considered

**Keep the plan's four rows and let heavy armour cap Dexterity at 0.** Half a row shorter and
wrong for every character with a Dexterity below 10 in plate. The nine saves cannot tell, which
is exactly why it would have shipped.

**Multiply the dexterity term by a 0/1 flag** — `min(dex, cap) * (1 - ac:armored:dexterity:ignored)`,
which needs one conditional row rather than two and keeps the table at four. It computes the same
answers. Rejected on legibility: a bounded term says "Dexterity applies, between these limits",
and a term multiplied by the complement of a flag says nothing until you have traced it. The
project has taken this trade before, in ADR 0022's rejection of the `table([99, 99, 2, 0])`
encoding of the same four rows.

**Publish `ac` for `npc` too, from the same formula.** Tempting for uniformity and wrong in
substance: a monster's armour class is printed, not computed, and deriving one would need the
kind to declare an inventory it has no use for. Decision 4.

**Put the base 10 on `ID_INTERNAL_GRANTS_ARMOR_CLASS_BASE`.** The marker exists, it is in the 5e
kind's `grants`, and it is named for this. Rejected for the third time on ADR 0022's grounds,
which are sharper here than anywhere they have been applied: a rule on that element is **copied
into every save**, so the day this formula needs correcting, every character written before the
fix keeps the old one. The seven markers carry zero rules and this is what that discipline is
for.

**Derive `ac` and leave the attunement limit for later.** They are two unrelated rules sharing
one mechanism, and splitting them would mean building `contributions`, shipping it with one user,
and coming back. ADR 0023 decision 3 named `contributions` as the limit's only possible home, and
ADR 0025 decision 8 deferred it to exactly this step.
