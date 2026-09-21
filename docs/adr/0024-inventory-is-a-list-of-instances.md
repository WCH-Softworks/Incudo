# 0024 — A character's inventory is a list of item instances, and the save format moves to 2

**Status:** Accepted · 2026-09-11 · builds on [0006](./0006-derived-character-state.md), [0007](./0007-native-formats.md), [0012](./0012-self-contained-saves.md), [0022](./0022-kinds-contribute-systems-do-not-ship-content.md)

Step 1 of [docs/INVENTORY-AND-AC-PLAN.md](../INVENTORY-AND-AC-PLAN.md). It is written before the
code because it changes `character.json`, which is a public API: it is the user's own saved work.

Every number below was measured against a set of real saves and the 740-file corpus. The saves
are personal data and stay out of this repository; the counts and the content ids are not.

## Context

`Character` has six kinds of input — `choices`, `rolls`, `baseStats`, `advancement`,
`generation`, `freeform` — and no home for a bag. ROADMAP Phase 1 deferred the importer's
`<equipment>` block *by name* for exactly that reason. Nothing about armour class, attunement or
`equipped=` can be answered until the bag exists, so this is the first of the five steps.

An inventory is an **input** in the sense ADR 0006 means: the user put it there and no formula
produces it. That much was never in doubt. What had to be decided is its shape, and four
questions in it had plausible answers on both sides.

## What was measured

45 item instances across a set of real saves — 26 equipped, 12 attuned, 15 adorners.

```xml
<item identifier="42462837-…" name="Half Plate" id="ID_WOTC_ARMOR_MEDIUM_HALF_PLATE">
  <equipped location="Armor">true</equipped>
  <attunement>true</attunement>
  <items><adorner name="Mithral Armor" id="ID_WOTC_DMG_MAGIC_ITEM_MITHRAL_ARMOR" /></items>
  <details card="true"><name/><notes/></details>
</item>
```

| probe | result |
|---|---|
| distinct element ids per bag | 8 bags have no repeat; one has 3 items and 2 ids |
| `amount` > 1 | 4 items (2, 5, 5, 10) — **0** of them equipped, attuned or adorned |
| adorners per item | 15 hosts with exactly 1; **max 1**, and **0** adorners contain anything |
| adorner ids also carried as a top-level item | **0** of 13 distinct |
| adorner `name=` vs the element's own name | 15 of 15 identical |
| `<attunement>` on an adorner | the tag does not exist there; 7 of the 15 adorned *hosts* carry it |
| equipped items whose element declares a `slot` | **23 of 26** — the other 3 are Aurora's proxies |
| `location` agreeing with that `slot` setter | **15 of 15**, no exceptions |
| equipped with no `location` at all | 11 of 26 |
| `<details><name>` set by the user | 1 of 45; `<details><notes>` 0 of 45 |
| item `name=` attribute stale against the element | 1 of 42 (`"Crossbow, Hand"` vs `"Hand Crossbow"`) |

## Decision

### 1. An entry is an instance, not a reference

```jsonc
"inventory": [
  { "instanceId": "42462837-…", "elementId": "ID_WOTC_ARMOR_MEDIUM_HALF_PLATE",
    "equipped": true, "attuned": true,
    "adorners": [{ "elementId": "ID_WOTC_DMG_MAGIC_ITEM_MITHRAL_ARMOR" }] },
  { "instanceId": "…", "elementId": "ID_WOTC_PHB_WEAPON_GREATSWORD",
    "adorners": [{ "elementId": "ID_WOTC_DMG_MAGIC_ITEM_VORPAL_SWORD" }], "name": "Swiftpursuit" }
]
```

Keyed by `instanceId`, because one of a set of real saves carries **two greatswords with different
enchantments** — a Vorpal Sword on the carried one, a Frost Brand on the equipped one. A model
keyed by element id loses that on the first real character, and it is not a contrived case: it is
one bag in nine. Aurora's `identifier` is a GUID and is distinct on all 45 items, so the importer
has an id to carry across and mints nothing.

### 2. `quantity` is a count on the instance, not several instances

The four stacked entries in the corpus are 2, 5, 5 and 10, and **not one of them is equipped,
attuned or adorned**. So a stack never carries per-instance state, which is the only thing
exploding it into separate instances would preserve. Exploding would invent nine `instanceId`s
Aurora never wrote and make a bag of ten arrows ten rows in a list.

Omitted means 1. The derivation reads an entry **once** regardless of `quantity`; ten arrows are
not ten contributions of whatever an arrow contributes. That is a statement about step 3 rather
than about this format, and it is recorded here so step 3 does not have to decide it again.

### 3. Adorners nest, and an adorner is not itself an instance

```jsonc
"adorners": [{ "elementId": "ID_…_MITHRAL_ARMOR" }]
```

Flat-with-a-parent-reference was the alternative, and the measurements go the other way on all
four counts that matter. Adorners never nest (0 of 15 contain anything), never exceed one per
host (max 1), are never carried standalone (0 of 13 distinct ids appear as a top-level item), and
have **no identity of their own** in Aurora — the `identifier` GUID is on the item and not on the
adorner. Nesting says all of that structurally: an orphan cannot be expressed, a cycle cannot be
expressed, and an adornment moves, sells and burns with its host without a second bookkeeping
step. A flat list would need a referential-integrity check that nesting gets for free.

The adorner's `name=` attribute is dropped: 15 of 15 are byte-identical to the element's own name,
so it is denormalization and nothing else.

An `Adornment` is deliberately an object with one field rather than a bare element id string.
Adding an optional property to an object is a schema change; changing a string into an object is a
data migration, and ADR 0023 is already likely to want somewhere to hang a per-adornment note.

### 4. `slot` is an override, and is absent unless the user disagreed with the element

Every element that can be worn declares where it goes — 1,070 of them carry a `slot` setter, 23
of the 26 equipped items across a set of real saves among them, the other 3 being Aurora's non-item
proxies. And where the save *does* record a `location`, it agrees with that setter **15 times out
of 15**. Even the one case where a real choice existed goes the same way: a quarterstaff is
`slot="onehand"` with `versatile="1d8"`, and all three staves in the saves are at `Primary Hand`,
never `Two-Handed`.

So the slot is derived from the element, and `slot` on the instance means *the user put this
somewhere the element did not say* — a shield in the off hand, a versatile weapon in both. It is
the same shape as `baseStats` against a kind's declared default, and the same shape as `name`
below: present only when something was overridden.

The concrete prediction, which step 2 will test: the importer writes `slot` **zero times** across
all nine saves. If it writes one, this section is wrong and the measurement was misread.

### 5. `attuned` is on the entry and covers its adornment

Aurora has no per-adorner attunement flag — `<attunement>` is a child of `<item>` only — and 7 of
the 15 adorned hosts carry it, including the 5 whose *adorner* is the part that requires
attunement. So the flag has always meant "this instance, host and adornment together, is one of
the three things attuned", which is also what the rulebook means. ADR 0023's gating reads this
field; it does not need a second one.

### 6. `name` and `notes` are the user's own words

From `<details><name>` and `<details><notes>`, not from the `name=` attribute. The attribute is a
denormalized copy of the element's name and is already **stale in 1 of 42** known cases — a save
written when the Hand Crossbow was called "Crossbow, Hand". Copying it forward would mean
shipping a wrong name inside a save that also embeds the element with the right one. `<details>`
is genuinely used, if rarely: 1 of 45 items is named "Swiftpursuit".

Aurora's `sidebar` and `hidden` attributes (22 and 3 of 45) are display state for a UI that no
longer exists and are not modelled. Containers — 21 elements in the corpus declare themselves one
— are not modelled either: no sample save nests an item inside another, and inventing a structure
for it now would be the guess ADR 0005 rules out.

### 7. The container embeds every entry, carried included

`collectCharacterContent` seeds from the inventory as well as from choices, advancement and the
kind's baseline, and it seeds from **every** entry and every adornment — not only the equipped
ones. A save whose bag cannot be read is a broken save under ADR 0012, and a carried Frost Brand
is as much part of the character as a worn one.

This is the same trap `kind.grants` set and the reason CLAUDE.md warns about it: the container
walks the character, so anything the character *references without choosing* has to be added
deliberately or it silently is not there.

Note the asymmetry, because it looks like an inconsistency and is not: **everything is embedded,
and only equipped entries will seed the derivation** (step 3, where 26 of 26 equipped items are in
Aurora's own `<sum>` and 18 of 19 carried ones are not).

### 8. `character.json`'s `formatVersion` moves to **2**

Readers accept 1 and 2; writers write 2. A version 1 character has no inventory and needs no
migration beyond the number, which is what makes this the cheap moment to do it.

`baseStats` (ADR 0014), `advancement` (ADR 0015) and `generation` (ADR 0017) each landed with the
number at 1, each on the argument that the field was additive and no `.incu` existed outside this
repository. Both ADRs flagged the caveat themselves, and ADR 0015 wrote it as plainly as it can be
written: *"This is the last comfortable moment for that argument to hold."* This is the next one.

The cost of having been late is real and is worth stating rather than hiding: a file claiming
version 1 may or may not have any of those three fields, so a reader cannot use the number to tell
and has to probe for each. Version 2 is the first point at which the number means something. It
means: *this file may carry an inventory, and a reader that cannot see one will get the character
wrong.*

Wrong, and specifically wrong in a way nothing reports. `JSON.parse`/`JSON.stringify` preserves
properties a reader does not know about, so an old reader would keep the array and still
**re-collect `content.json` without the bag's elements** — leaving a file that looks intact,
validates against its own schema, and has quietly stopped being self-contained. That is ADR 0012's
central property failing silently, and `formatVersion` is the only field in the file that lets a
reader refuse instead of proceeding.

A character gains version 2 when it gains an inventory: `createCharacter` writes 2, and
`setInventoryEntry` raises an older character that it is adding to. Nothing downgrades.

### 9. A duplicate `instanceId` is a validation error

The one referential check the schema cannot express, and the one that matters: `setInventoryEntry`
replaces by `instanceId`, and a UI keys rows by it. Two entries sharing one is a file where an
edit hits the wrong item. `validateCharacter` gains the check, which also makes it symmetric with
`validateGameSystem`, whose referential checks have been there since ADR 0011.

## Consequences

**Good**
- The two greatswords survive, and so does every case like them. This is the one modelling
  mistake in this area that could not have been fixed later without a migration.
- Nesting adorners makes an orphaned adornment unrepresentable rather than merely invalid.
- Deriving `slot` means the 5e system does not have to name Aurora's three location strings
  anywhere, and core does not learn the word "armor" (ADR 0003).
- Steps 2–5 need no further `character.json` change. Step 2 maps `save.equipment` straight
  across; step 3 reads `equipped`; step 4 reads `slot`; step 5 touches `system.json` only.
- Under ADR 0022 this needs no loader change, no second file per system and no origin filter in
  the container or the verifier. That decision paying off here is why it was made first.

**Bad / accepted**
- A seventh input on `Character`, and the first one that is a list of structured objects rather
  than a map of scalars. It is also the first place the format has an id namespace of its own
  (`instanceId`), with the uniqueness rule that implies.
- `quantity` is a compromise. A stack of ten arrows is one row that cannot have nine of them
  enchanted; splitting it is a user action the app will have to offer, and the format permits it.
- Deriving the slot is right for all 26 measured cases and is a bet on the ones not measured.
  Two corpus elements declare a compound slot (`onehand,secondary`) and nothing in the saves
  exercises them; `slot` exists on the instance precisely so that bet is recoverable.
- Moving `formatVersion` costs nothing today and would have cost nothing three times before.
  Doing it now does not retroactively make those files self-describing.

## Alternatives considered

**Keep `formatVersion` at 1**, on the policy ADR 0022 restated for `system.schema.json`: the
version moves on a breaking change, not an additive one, and nothing has shipped. The policy is
right for a system definition and wrong for a save, because the two fail in opposite directions. A
system definition an app cannot read simply does not load, in front of the author who wrote it and
can fix it. A save is someone's own work, opened years later on a machine they do not control, and
the failure there is not a refusal but a sheet that is quietly missing its magic items. Refusing is
the correct failure for a save and there is nothing else it can be built on.

**Key the inventory by element id**, with a count — `{ "ID_…_GREATSWORD": 2 }`. Smallest possible
format, and it loses the two greatswords, every per-instance name, and any hope of one being
equipped while its twin is not. Measured and rejected in one probe.

**Flat adorners with a `parentInstanceId`.** The general case, and general is not free here: it
permits an orphan, a cycle, and an adornment left behind when its host is deleted, none of which
the corpus contains and all of which would need checking. Reconsider it the day something needs
two levels of nesting; nothing in 5e does.

**Store the slot on every entry**, since Aurora stores a `location`. Rejected on the 15-of-15
agreement: it would be a copy of the element's own setter, wrong the moment content is corrected,
and it would put "which of 18 slots exists" into the character rather than into the content that
declares them.

**Give adorners their own `instanceId`.** Aurora does not, so the importer would have to mint 15
ids from nothing — and minting makes `aurora import` non-deterministic, which would show up
immediately as a golden fixture that changes on every run. An adornment is addressed by its host
and its element id, both of which are stable.
