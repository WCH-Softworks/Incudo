# 0025 — A slot publishes a set of tags, and `equipped` starts being evaluated

**Status:** Accepted · 2026-09-11 · builds on [0003](./0003-system-agnostic-content-model.md), [0005](./0005-aurora-import.md), [0020](./0020-stats-keyed-on-declared-blocks.md), [0021](./0021-equipped-is-a-condition.md), [0023](./0023-attunement-gates-and-reports.md), [0024](./0024-inventory-is-a-list-of-instances.md)

Step 4 of [docs/INVENTORY-AND-AC-PLAN.md](../INVENTORY-AND-AC-PLAN.md). Written before the code
because it adds to `schemas/system.schema.json`, which users author against
([ADR 0011](./0011-user-systems.md)).

Every number below was measured against the 740-file corpus and a set of real saves. The saves
are personal data and stay out of this repository; the counts and the content ids are not.

## Context

[ADR 0021](./0021-equipped-is-a-condition.md) made `Rule.equipped` a parsed condition and then
deliberately evaluated nothing, because there was no inventory for `[armor:none]` to be a
question about. [ADR 0024](./0024-inventory-is-a-list-of-instances.md) gave the character a bag
and step 3 made an equipped item seed the derivation. What is still missing is the one thing in
between: **the bag does not say what is in the armour slot.**

### The whole vocabulary is twelve operands

Re-measured from the parsed corpus rather than by grepping, because the parse is what the engine
sees. **78** rules carry an `equipped=` condition — 75 `<stat>` and 3 `<grant>`, all three of the
latter on the same element. That is one fewer than ADR 0021's 79: the 79th is the Dueling
fighting style's `melee:damage`, which upstream has commented out. Their operands:

```
38  [armor:none]      33  [armor:heavy]    9  [armor:medium]     3  [armor:any]
17  [shield:none]      3  [shield:any]
 1  [primary:none]     1  [primary:any]    1  [primary:versatile]
 1  [primary:double-bladed scimitar]
 1  [secondary:none]   1  [secondary:any]
```

**Three different kinds of thing share one syntax**, and that is the finding this ADR is built on:

- `heavy`, `medium`, `none` and `any` describe the slot's *state*;
- `versatile` is a **weapon property** — a setter on 15 weapons, whose value is a die (`1d10`
  nine times, `1d8` five, `1d12` once), so the check is asking whether the setter is *there*,
  not what it says;
- `double-bladed scimitar` is the item's **name**. The element is
  `ID_WOTC_ERLW_WEAPON_DOUBLE_BLADED_SCIMITAR`, and the Revenant Blade feat asks for it by name
  because Aurora has no other way to say "this specific weapon".

A slot therefore cannot publish one string. It publishes a **set of tags**, drawn from whatever
is in it.

### Widening `equals` is a change with eight things in its blast radius

Of **117** `equals` checks in the whole corpus, **109 are these twelve operands**. The other
eight are `type = spell` (7) and `type = class` (1). There are **zero** `flag` checks anywhere.
So `equals` is, to two significant figures, the equipment predicate, and string equality has to
keep working for eight uses that name no slot.

### Content says where an item goes, and Aurora's app keeps the answer

1,070 elements carry a `slot` setter, with 18 distinct values:

```
onehand 277   misc 195   gift 154   body 127   head 67   neck 59   ring 51
twohand 36    shoulders 36   feet 19   waist 18   hands 14   arms 8   belt 3
companion 2   onehand,secondary 2   legs 1   armor 1
```

Two of those are worth stopping on.

**`onehand,secondary` is the shield**, both times — the 2014 and 2024 `Shield`, the only two
elements in the corpus with `<set name="armor">Shield</set>`. Nothing else in 740 files declares
a compound slot. Magic shields are *adorners*: `Shield, +1` has no `slot` at all, and its
`armor` setter is `ID_INTERNAL_ARMOR_GROUP_SHIELD`, an attach constraint rather than a category.

**`slot="armor"` is an upstream typo**, on exactly one element — Spiked Armor, from the Sword
Coast Adventurer's Guide. Every other armour in the corpus says `body`. It is named here because
this ADR's design makes it *visible* rather than silent, which is the outcome the project keeps
choosing ([ADR 0005](./0005-aurora-import.md)) and the reason `KNOWN_UPSTREAM_TYPOS` exists
rather than a fix-up table.

### The `armor` setter means two different things

On an **Armor** element it is the category: `Medium` 11, `Heavy` 8, `Light` 6, `Shield` 2 —
exactly the 27 Armor elements. On a **Magic Item** it is a requirement expression naming what the
item may be attached to. **129 elements carry both a `slot` and an `armor` setter, and 102 of
them are not Armor** — Mithral Armor is `slot="body"` with
`armor="(ID_INTERNAL_ARMOR_GROUP_MEDIUM||ID_INTERNAL_ARMOR_GROUP_HEAVY),!Hide"`. Any design that
reads the `armor` setter as a tag has to survive those 102.

### What the nine bags put where

```
armor=none    three saves
armor=light   two saves                          (studded leather)
armor=medium  two saves                          (a breastplate, a half plate)
armor=heavy   two saves                          (plate)
shield        nobody, on any save
primary       a weapon on every save but three, which are two-handed
```

And **eight rules across the nine characters carry an `equipped=` condition at all**: a monk's
Unarmored Defence and the five movement modes of its Unarmored Movement
(`[armor:none],[shield:none]`), and the Defense fighting style twice (`[armor:any]`).

## Decision

### 1. A character kind declares its inventory, in one block

```jsonc
"inventory": {
  "slotSetter": "slot",
  "occupiedTag": "any",
  "emptyTag": "none",
  "tagSetters": ["armor"],
  "flagSetters": ["versatile"],
  "slots": [
    { "id": "body",              "label": "Armor",  "stats": ["armor"] },
    { "id": "onehand,secondary", "label": "Shield", "stats": ["shield"] },
    { "id": "onehand",           "label": "Hands",  "stats": ["primary", "secondary"] },
    { "id": "twohand",           "label": "Two-Handed", "stats": ["primary"] },
    { "id": "head" }, { "id": "neck" }, …
  ],
  "attunement": { "setter": "attunement", "requires": "true" }
}
```

One block, because the slots and the attunement flag are the same kind of statement — *how this
system reads the setters its content puts on an item*. [ADR 0023](./0023-attunement-gates-and-reports.md)
decision 4 asked for the attunement setter to live "the same place step 4 declares slots", and
this is that place.

Core never says `armor`, `shield`, `primary`, `secondary`, `body`, `versatile`, `any` or `none`.
Every one of them is a string 5e supplies, which is [ADR 0003](./0003-system-agnostic-content-model.md)'s
requirement and also [ADR 0020](./0020-stats-keyed-on-declared-blocks.md)'s precedent: a system
declares how a key is built and the engine builds it.

### 2. The stat list *is* the capacity

A slot's `stats` are the stats it publishes into, **in fill order**, and an item takes the first
one that is free. That makes capacity fall out of the declaration instead of being a second
field: one stat holds one item, so `body → ["armor"]` is one suit of armour and
`onehand → ["primary", "secondary"]` is two hands. A slot with no `stats` publishes nothing and
holds any number of things.

That last clause is deliberate and is the honest answer to the plan's open question about
capacity. 5e has no rule limiting how many cloaks you may wear — attunement is the limiter — so
declaring `shoulders` as holding one would be **me** deciding a rule rather than the system
declaring one. A set of real saves contains a live case: one wears a Cloak of Displacement *and* a
Cloak of Protection, both equipped, both in Aurora's own `<sum>`. Incudo says nothing about it,
and says nothing on purpose.

### 3. A two-handed weapon fills `primary`, and only `primary`

Both halves are measured rather than assumed, which the plan expected to be impossible.

**It fills `primary`:** the Double-Bladed Scimitar is `slot="twohand"`, and the Revenant Blade
feat's condition is `equipped="[primary:double-bladed scimitar]"`. Content would be asking an
unanswerable question otherwise.

**It does not fill `secondary`:** the Dual Wielder feat's +1 AC is
`[primary:any],[secondary:any],![primary:versatile]`, which is 5e's "a separate melee weapon in
each hand". A greatsword occupying both hands would earn that +1, which is wrong. The one rule
that wants the opposite reading — Dueling's `[primary:any],([secondary:none]||[shield:any])`,
where a greatsword user ought to be excluded by `secondary` being occupied — is commented out
upstream and evaluates nowhere. So of the two active rules that can tell these readings apart,
one favours primary-only and the other does not exist.

It is still a reading of two rules rather than an oracle, and it is recorded here so the next
person finds the argument instead of re-deriving it.

### 4. A slot's tags are the item's, and only the item's

For an occupied slot: the `occupiedTag`, the element's **name** lowercased, each `tagSetters`
setter's **value** lowercased, and the **name** of each `flagSetters` setter that is present.
For a declared slot with nothing in it: the `emptyTag`, alone.

The name is always a tag and needs no flag to turn on — an item's name is not a game-specific
noun, and `[primary:double-bladed scimitar]` is the corpus asking for it.

**Adorners occupy nothing and contribute no tags.** A Mithral Armor has `slot="body"` of its own,
and 15 of the 15 adornments in a set of real saves would have fought their hosts for a slot. It is
also what keeps the two meanings of the `armor` setter apart in practice: the 102 non-Armor
elements carrying both setters are adorners, so their requirement-expression `armor` value never
becomes a tag. If a user equips one as a top-level item anyway, the tag is a harmless nonsense
string — `[armor:none]` correctly reads false, `[armor:any]` correctly reads true, and nothing
asks for `(id_internal_armor_group_medium||…)`.

### 5. `equals` is a membership test when the stat publishes tags, and string equality otherwise

```
[armor:medium]  ->  the "armor" slot's tags contain "medium"
[type:spell]    ->  the "type" stat's text is "spell"
```

One branch, chosen by whether anything published tags for that stat. The eight `type =` checks
keep the behaviour they have. There are no `flag` checks to worry about.

### 6. `equipped` is evaluated only when the kind declares an inventory

Exactly parallel to how `activeRules` already handles level gates: a kind with
`progression.kind: "none"` ignores `level=` rather than reading every gate as unmet. A kind with
no `inventory` ignores `equipped=` the same way, and keeps today's behaviour.

This is not tidiness. ADR 0021 measured what evaluating with no slots does: it drops all 41
positive checks and keeps all 38 negations, so a monk is simultaneously not-unarmoured and
not-in-heavy-armour. A system that has not declared an inventory should not be put in that state
by a field it never asked about.

### 7. An unattuned item contributes none of its rules, and says so

[ADR 0023](./0023-attunement-gates-and-reports.md) decided this; here is the mechanism. An
element reached from the bag whose `attunement` setter says it requires attunement, on an entry
that is not attuned, has **all** of its rules suppressed, and a warning names the item.

Three details the corpus settled:

- **The host and its adornment are gated separately, by the one flag.** Aurora has no per-adorner
  attunement tag (ADR 0024 decision 5), so an unattuned Flame Tongue greatsword is a greatsword —
  the mundane element is untouched because it is a different element.
- **Setters are not rules.** A gated item still weighs what it weighs.
- **An element the character has for another reason is never gated.** If an id is also a choice,
  an advancement entry or part of the kind's baseline, the bag does not get to suppress it.
  Nothing in the corpus needs this; it exists so that a coincidence of ids cannot silently delete
  a class feature.

### 8. The attunement **limit** is not here. It rides with `contributions` at step 5

The plan flagged the dependency and left the call open. Taking the gate now and the limit later,
because the limit cannot be computed correctly yet: ADR 0023 puts the base of **3** in a kind's
`contributions`, which is [ADR 0022](./0022-kinds-contribute-systems-do-not-ship-content.md)'s
mechanism and is not built. Without it `attunement:max` reads 0 for everyone except an Artificer,
and **every one of a set of real saves would be reported over the limit** — the exact "a warning nobody
can act on" failure ADR 0023's reporting clause exists to avoid. `attunement:current` alone would
be a number with nothing to compare against.

Gating needs no `contributions` and is the half that changes an answer. It lands here.

### 9. Every declared slot publishes a stat, occupied or not

`armor`, `shield`, `primary` and `secondary` become real stats on a 5e character: `text` is the
occupying element's name, or the `emptyTag`. They are **inputs**, published like the progression
number and the per-track counts — nothing contributes to them and nothing derives them.

This is what the step's title means by "slots publish what is in them", and it is also what makes
the mechanism inspectable: `incudo character show` can print `armor = plate` next to the
condition that read it. It is safe because the corpus writes no `<stat name="armor">`,
`"shield"`, `"primary"` or `"secondary"` anywhere — measured in the plan and re-checked here.

The tag set is *not* stored on the stat. `equals` reads it from the resolved equipment state,
which is computed once from the bag and the index before the fixed point starts, because slot
occupancy depends on the character and its content and never on the derivation.

### 10. Two diagnostics, both warnings

- **`slot-unknown`** — an equipped item whose slot string the kind does not declare. This is
  what makes Spiked Armor's `slot="armor"` visible instead of silently unarmoured. It is also why
  5e declares all 17 of the corpus's real slot values and not only the four that publish stats:
  a vocabulary that is written down can be checked against.
- **`slot-full`** — an item whose every candidate stat is already taken: a third one-handed
  weapon. Reported rather than resolved, because which one the character is actually holding is
  the user's answer, not the engine's.

An item with **no** slot setter occupies nothing and reports nothing. That is not an edge case:
Aurora's three inventory proxies have no slot, and two of a set of real saves equip one.

### 11. `formatVersion` stays at 1

`inventory` is optional and additive, on the kind. Every existing system definition stays valid
and a kind without it behaves exactly as before. This is the fifth additive change to
`system.schema.json` in a row; the next breaking one costs a version.

`character.json` does not move either. Nothing about a save changes — step 4 reads the bag ADR
0024 already defined.

## What the oracle proves, and what it does not

**Prediction, recorded before the run: not one derived stat changes on any of a set of real saves.**
Every gate resolves in favour of what is already applying — the Monk is unarmoured and
shieldless so `[armor:none],[shield:none]` holds; the Paladin 2 / Warlock 18 and the Fighter 12 are
armoured so `[armor:any]` holds. And all 12 attunement-requiring equipped items across the nine are attuned, so gate 7
fires zero times.

That prediction is *cheap*, and saying why matters more than the green run. Before this change,
`equipped` was evaluated nowhere, so **all 78 rules applied unconditionally**. Evaluating can
therefore only ever *remove* a contribution — there is no path by which a number goes up. A
passing `aurora verify` means the eight conditions on these nine characters all came out true. It
is not evidence that a false one comes out false.

So, stated as plainly as ADR 0018 stated its rounding and ADR 0020 stated its `8`:

- **Every negative case is unverified.** No character in the nine wears armour while carrying a
  rule gated on `[armor:none]`, and **nobody carries a shield at all**, so `[shield:any]` has
  never once been true. `[primary:*]` and `[secondary:*]` are eight rules in the corpus and zero
  rules on these characters.
- **The attunement gate is unverifiable against Aurora**, as ADR 0023 said in advance.
- **The slot-to-stat mapping is unverified.** Aurora records a `location` and never a derived
  consequence of it.

What is verified is done by **perturbation**, and it has to be, because a green differential run
here proves only that nothing broke. Forcing a slot's tags and watching the right rules drop is
the check that has content: a monk handed `[armor:heavy]` loses exactly Unarmored Defence and
Unarmored Movement, and an armoured fighter handed `[armor:none]` loses exactly the Defense
fighting style. Those live in `packages/core/src/equipment.test.ts` and in the engine tests, not
in `aurora verify`.

## Consequences

**Good**
- The four constructs ADR 0021 left inert are live, and the monk's Unarmoured Defence now holds
  for a reason rather than by accident.
- Step 5's four conditional AC rules have something to be conditional on, which was the point of
  doing this first.
- ADR 0023 is implemented apart from its limit, and the limit's blocker is named rather than
  discovered later.
- A slot's capacity, the thing with no oracle, is expressed as "how many stats does it publish"
  and so never needed a guess.

**Bad / accepted**
- `system.schema.json` grows a fifth additive block, and it is the largest of the five.
- Reading the compound string `onehand,secondary` as the shield slot is literal. It is exactly
  what the two elements say, and the alternative readings are worse (below), but a third-party
  shield spelled any other way will land nowhere and report `slot-unknown` — which is at least
  the visible failure rather than the silent one.
- Some derived numbers are still wrong, and differently wrong from yesterday. An equipped plate
  contributes `ac:armored:armor 18` and nothing sums it, because `ac` is still `default: 10`
  (step 5). What has changed is that a barbarian in plate no longer *also* shows Unarmoured
  Defence.
- 5e's kind now lists 17 slot ids, four of which do anything. The other 13 exist to make
  `slot-unknown` mean something.

## Alternatives considered

**Keep `equals` a string comparison and publish a single "best" tag per slot.** Smallest change,
and it cannot express the corpus: `[primary:versatile]` and `[primary:double-bladed scimitar]` and
`[primary:any]` are three questions about one item, and any single string answers at most one of
them.

**Give the slot stat a `tags` field on `ResolvedStat` and have `equals` read the stat map.**
Tidier-looking, and wrong in one specific way: the stat map is rebuilt every pass of the fixed
point, so a condition would read the *previous* pass's slot state. Occupancy is a function of the
character and the index alone, so it is computed once, before the loop, where it cannot be stale.

**Publish `shield` from a tag rather than from a slot** — "any equipped item whose `armor` setter
is `Shield`". More robust against content that spells the slot differently, and it introduces a
second mechanism for publishing a stat, sitting beside the slots and overlapping them. Rejected
for one mechanism over two, with the note that the day a shield turns up with a sane `slot`, the
fix is one more `id` in the `slots` array and not a new concept.

**Let a compound `slot` mean "any of these slots, first free wins",** which is how
`packages/aurora-import`'s `slotOverride` reads it when deciding whether a recorded `location`
disagreed with the element. Applied here it puts a shield in `primary`, which makes
`[shield:any]` false for a character holding a shield and `[secondary:any]` true for one holding
a sword and board — breaking the barbarian's `!([armor:heavy]||[shield:any])` and handing a
sword-and-board fighter the Dual Wielder bonus. The two readings answer different questions and
both are right for theirs: the importer asks "did the user contradict the element", this asks
"what is in the character's off hand".

**Declare only the four slots that publish stats.** Half the JSON, and it throws away
`slot-unknown` — Spiked Armor's typo becomes a character who is silently not wearing armour, and
the corpus's slot vocabulary stops being written down anywhere a validator can see it.

**Gate attunement and enforce the limit in the same change.** Measured and rejected on the
measurement, in decision 8: without ADR 0022's `contributions` the limit reads 0 and all nine
saves report over it.

**Make the whole thing implicit — core knows that an item has a slot and a slot has a name.**
This is the one that would have been easy and is the one ADR 0003 exists to refuse. The moment
core knows `body` means armour it knows what D&D is.
