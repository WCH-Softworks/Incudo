# Inventory and armour class — the plan

**Status:** proposed · 2026-09-10 · nothing here is implemented · **D1 settled 2026-09-11 by
[ADR 0022](./adr/0022-kinds-contribute-systems-do-not-ship-content.md)**

ROADMAP Phase 2 lists **Inventory** and the `ac` derivation as two items. They are one piece
of work in a fixed order, and this file is the plan asked for before any of it is written.

It is a plan and not an ADR because it spans three format changes and at least two ADRs. Those
get written as their steps come up; what follows is the evidence, the sequence, and the
decisions that have to be made before step 1.

---

## The one-paragraph version

`ac` is `default: 10` with nothing derived, and every imported character shows 10. That is not
an AC problem. 31 of the corpus's alternative AC calculations are gated on `equipped="[armor:none]"`
and 33 more on `[armor:heavy]`, and none of those can be answered until a character can wear
armour. Content already declares everything about an item except where it went — the armour's
base AC, its category, its slot, its attunement, its dex cap delta. What is missing is a place
to record that the character is wearing it, five stats Aurora keeps in application state
(`ac`, `armor`, `shield`, `primary`, `secondary`), and one mechanism the expression language
does not have. The inventory half has a strong differential oracle. **The AC number has none
and never will.**

---

## What was measured

Every number below came from the 740-file corpus or the nine sample saves. Nothing here is
recalled; the probes are cheap to re-run and the commands are in this repo's history.

### Content already declares the item

1,070 elements carry a `slot` setter — **Magic Item 757, Item 189, Weapon 97, Armor 27**. Of
those, **271** grant something, **268** contribute stats, **19 open a `<select>`** (the Book of
Vile Darkness asks which ability it raises), **485** declare `attunement`, **21** are
containers.

A suit of armour is fully described:

```xml
<element name="Padded" type="Armor" id="ID_WOTC_ARMOR_LIGHT_PADDED">
  <supports>ID_INTERNAL_ARMOR_GROUP_LIGHT</supports>
  <setters>
    <set name="slot">body</set>
    <set name="armor">Light</set>
    <set name="armorClass">11 + Dex modifier</set>
    <set name="proficiency">ID_PROFICIENCY_ARMOR_PROFICIENCY_PADDED</set>
    <set name="stealth">Disadvantage</set>
  </setters>
  <rules>
    <grant type="Grants" id="ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE" />
    <stat name="ac:armored:armor" value="11" />
  </rules>
</element>
```

`slot` has 18 values across the corpus — `onehand` 287, `misc` 195, `gift` 154, `body` 127,
`head` 67, `neck` 59, `ring` 51, `twohand` 37, `shoulders` 36, and a tail down to `legs` 1.
One is compound (`onehand,secondary`, twice). The four armour categories are `Medium` 11,
`Heavy` 8, `Light` 6, `Shield` 2 — exactly the 27 Armor elements.

Note that `<set name="armor">` means two different things by element type. On an **Armor** it
is the category. On a **Magic Item** it is a requirement expression saying what the item may be
attached to — `ID_INTERNAL_ARMOR_GROUP_LIGHT|…|HEAVY` 59 times, `Scale Mail` 21,
`(ID_INTERNAL_ARMOR_GROUP_MEDIUM||ID_INTERNAL_ARMOR_GROUP_HEAVY),!Hide` 6. Adorners constrain
their hosts, and they do it in the requirement language.

### Nothing declares the five numbers Aurora keeps in its app

There is **no `<stat name="ac">`, `"armor"`, `"shield"`, `"primary"` or `"secondary"` anywhere
in the 740 files.** All five are Aurora application state, and all five have to come from
Incudo. This is the fifth time this pattern has turned up, after the ability score maximum
(ADR 0016), the slot table (ADR 0018), hit points (ADR 0019) and the save DC (ADR 0020):
content contributes only deltas, never a base.

What content does contribute, 240 `ac:*` stat rules in total:

| stat | rules | what it is |
|---|---|---|
| `ac:armored:enhancement` | 49 | `+1`/`+2`/`+3` magic armour, bucket `enhancement` |
| `ac:misc` | 43 | flat adds — a fighting style, a cloak of protection |
| `ac:calculation` | 31 | alternative calculations, bucket `calculation` |
| `ac:armored:armor` | 25 | the armour's own base, 11–18 |
| `ac:shield` | 13 | 2 in bucket `shield` (the shields), 11 in `enhancement` |
| `ac:armored:dexterity:cap` | 3 | Medium Armor Master's `3`, bucket `base` |
| `ac:unarmored defense …` etc. | ~75 | the components each calculation sums |

**The bonus-bucket mechanism already does the hard part twice over.** `bonus="calculation"`
resolves largest-wins, which is exactly 5e's "use the best calculation available" across 31
candidates. `bonus="base"` on the dex cap is how Medium Armor Master raises the cap from 2 to
3 without knowing what the 2 was. Incudo's engine has resolved buckets that way since Phase 0.

### The equipment vocabulary is twelve operands

Since ADR 0021 the 79 `equipped=` attributes parse. Their operands, all 109 uses:

```
38  [armor:none]      33  [armor:heavy]    9  [armor:medium]     3  [armor:any]
17  [shield:none]      3  [shield:any]
 1  [primary:none]     1  [primary:any]    1  [primary:versatile]
 1  [primary:double-bladed scimitar]
 1  [secondary:none]   1  [secondary:any]
```

That is the entire surface. Two things fall out of it:

- **A slot is not one string.** `[primary:versatile]` tests a weapon *property* (15 weapons
  carry a `versatile` setter), `[primary:double-bladed scimitar]` tests its *name*, and
  `[primary:any]` tests only that the slot is occupied. A slot publishes a **set of tags**.
- **`equals` is essentially the equipment predicate.** Of 117 `equals` checks in the whole
  corpus, **109 are these**; the other 8 are `type = spell` (7) and `type = class` (1). There
  are **zero** `flag` checks in the corpus. So widening `equals` into a membership test is a
  change with eight things in its blast radius, both of them harmless.

### The save records instances, and equipped means derived

45 item instances across the nine saves — 26 equipped, 12 attuned, 15 adorners.

```xml
<item identifier="42462837-…" name="Half Plate" id="ID_WOTC_ARMOR_MEDIUM_HALF_PLATE">
  <equipped location="Armor">true</equipped>
  <attunement>true</attunement>
  <items><adorner name="Mithral Armor" id="ID_WOTC_DMG_MAGIC_ITEM_MITHRAL_ARMOR" /></items>
  <details card="true"><name/><notes/></details>
</item>
```

Three findings, each from counting rather than reading:

- **Equipped ⇒ derived. Carried ⇒ not.** All **26** equipped items are in Aurora's `<sum>`;
  **18 of 19** carried ones are not. The exception is not one: Vigaro carries *two* greatswords,
  one equipped, so the element id is in `<sum>` on the other instance's account. Adorners
  follow their host — 13 of 15 in `<sum>`, and the 2 outside both hang off carried items.
- **An item is an instance, not a reference.** Vigaro's two greatswords carry different
  enchantments: a Vorpal Sword on the carried one and a Frost Brand on the equipped one. Any
  model that keys the bag by element id loses that on the first real character.
- **`location` is set only for the hand and body slots** — `Primary Hand`, `Armor`,
  `Two-Handed` are the only three values in the nine saves. A cloak, boots or a ring is
  equipped with no location at all, and its slot comes from the item's own `slot` setter.

The bag also carries things that are not items. `ID_PHB_INTERNAL_ITEM_PROXY_ASI_INTELLIGENCE`
is how Aurora records the Tome of Clear Thought's permanent +2, and
`ID_PHB_INTERNAL_ITEM_LANGUAGE_PROXY_LANGUAGE_ORC` is how it records a learned language. These
are **the only 3 ids in all nine bags that neither the 740 files nor the 80-element overlay
declare** — a third family of Aurora-app-materialized elements, the same shape as the two
already handled.

### The oracle is strong for inventory and absent for AC

**47 of the 51 `not-modelled` notes across the nine saves are "comes from the character's
inventory"**, plus the one spell save DC that a Tome of Clear Thought moves — 48 of 51. Step 3
below converts all of them into compared numbers, in both directions: an item that fails to
contribute becomes `element-missing`, one that contributes when it should not becomes
`element-extra`.

**No save records an armour class.** `<defenses>` contains an empty `<conditional>` and the
only `<attributes>` block belongs to the companion and is all tens. There is no AC in the
format, so `aurora verify` will never gain a comparison for it. This is exactly hit points'
position (ADR 0019): settled by reading the published rule, and by nothing else.

One more thing the oracle cannot settle: **whether attunement gates a contribution.** All 12
equipped items in the nine saves that require attunement *are* attuned, so there is no
counter-example in either direction. 5e says an unattuned item gives nothing; the saves neither
confirm nor deny it.

---

## The sequence

Five steps. The first three are oracle-backed and should land before the last two, which are
not.

### Step 1 — `Character.inventory` · ADR · `character.json` formatVersion moves

The model, and the expensive-to-reverse decision. An entry is an **instance**:

```jsonc
{ "instanceId": "…", "elementId": "ID_WOTC_ARMOR_MEDIUM_HALF_PLATE",
  "quantity": 1, "equipped": true, "slot": "body", "attuned": true,
  "adorners": [{ "instanceId": "…", "elementId": "ID_…_MITHRAL_ARMOR" }],
  "name": "…", "notes": "…" }
```

It is an input, not a derivation, so ADR 0006 is satisfied: the user put it there and no
formula produces it.

`collectCharacterContent` must embed the elements of **every** entry, carried included — a save
whose bag cannot be read is a broken save under ADR 0012 — while only equipped entries seed the
derivation. This is the same trap the kind's `grants` set: the container walks the character,
and anything the character references without *choosing* has to be added deliberately.

### Step 2 — the importer fills it · bugfix-shaped under ADR 0008

`save.equipment` is already parsed and complete: id, name, amount, equipped, location, attuned,
adorners. This maps it onto step 1's model and nothing else.

Not new surface under the freeze: ROADMAP Phase 1 deferred this *by name* — "`<equipment>` is
read and deliberately not imported — `Character` has no home for items". The home arrives in
step 1.

Plus the 3 proxy ids into `generated-elements.ts`, which is the same argument the 80 already
there were added under.

### Step 3 — the engine seeds equipped items · **the step the oracle checks**

An equipped entry's element and its adorners join the derivation exactly as a choice does.
Carried entries contribute nothing (26/26 and 18/18 above).

**Expect the baseline to move, and expect it to be the point.** 47 `not-modelled` notes become
compared elements; some will land as `element-missing` or `element-extra` on the first run and
each one is a real finding. `.github/workflows/ci.yml` and CLAUDE.md's numbers get re-recorded
once, deliberately.

This is the last step that can be checked against Aurora. It is worth landing it on its own and
reading the diff carefully before going further.

### Step 4 — slots publish tags · `equals` becomes membership · ADR

Three pieces:

- **The system declares its slots.** Which slots exist, what each publishes into, and where a
  slot's tags come from — the item's name, plus named setters. 5e maps `body → armor`,
  `shield → shield`, `onehand → primary`/`secondary`, `twohand → primary`. An empty slot
  publishes `none`; an occupied one always publishes `any`. Core must not know any of those
  words (ADR 0003).
- **`equals` reads a tag set.** `[armor:medium]` is true when the `armor` slot's tags contain
  `medium`. String equality stays, for the 8 `type =` uses.
- **`equipped=` starts being evaluated**, finishing the half ADR 0021 deliberately deferred.
  The four stats that measurement showed going wrong — a monk's Unarmoured Defence and
  Unarmoured Movement, two fighters' Defense fighting style — come back, and this time with an
  `armor` stat that has a real answer behind it.

### Step 5 — the `ac` derivation · `systems/dnd5e/system.json`

With slots publishing tags, the whole of 5e's armour class is one expression over stats content
already writes:

```
ac = max( ac:calculation,
          ac:armored:armor + min(dexterity:modifier, ac:armored:dexterity:cap)
                           + ac:armored:enhancement )
     + ac:shield + ac:misc
```

`max` is already in the expression language, and the buckets do the rest: `calculation` picks
the best alternative, `enhancement` stops two +1s stacking, `base` lets Medium Armor Master's
`3` beat the system's `2`.

**The one thing missing is a conditional**, and it is needed twice — the dex cap is 2 in medium
armour, 0 in heavy and unbounded otherwise, and an unarmoured character's base is 10 rather
than an armour's 11–18. Both disappear if "no armour" is modelled as an armour:

| when | `ac:armored:armor` | `ac:armored:dexterity:cap` (bucket `base`) |
|---|---|---|
| `[armor:none]` | 10 | 99 |
| `[armor:light]` | (the armour's) | 99 |
| `[armor:medium]` | (the armour's) | 2 |
| `[armor:heavy]` | (the armour's) | 0 |

Four conditional stat contributions, and the formula above becomes uniform with no branching at
all. A barbarian's `10 + dex + con` still wins through `max`, and a shield still adds to it,
which is what the Player's Handbook says.

So step 5 reduces to: **somewhere to put four stat rules that carry a `requirements`.** That
was decision D1, and it is now a kind's `contributions` (ADR 0022).

---

## Decisions

D1 is settled. D2 and D3 remain open, and neither blocks step 1.

### D1 — where does the 5e baseline live? · **settled, [ADR 0022](./adr/0022-kinds-contribute-systems-do-not-ship-content.md)**

**A character kind declares `contributions`, and a system ships no content.** Not what this
file recommended when it was written, and the reversal is the useful part.

The recommendation was (b), a system-shipped `.incuset` of ordinary elements with ordinary
rules, on the grounds that `<stat requirements=…>` already does conditionals and the format
already exists. What that missed is where the elements end up. `collectCharacterContent` seeds
from `baselineElementIds(kind, progress)`, so **anything a kind grants is embedded in the
save** — and a rule embedded in a save is frozen at the moment the file was written. Fixing
5e's armour class would have fixed nothing already built, which is the failure ADR 0006 exists
to prevent. `system.json`, by contrast, is the one thing a save deliberately does *not* embed.

So the project has been following a rule without stating it: **identity is embedded, mechanics
are not.** That is why all seven ids in the 5e kind's `grants` carry zero rules, and why only
six of the overlay's 80 elements carry any — all six ability score improvements, where the
rule *is* the identity.

What this means for the steps below: the inventory work needs **no loader change, no second
file per system, and no origin filter** in the container or in `aurora verify`. Step 5 gets
four lines of data in `system.json`.

### D2 — does attunement gate an item's contribution?

5e says an unattuned magic item does nothing. The saves cannot confirm it: all 12
attunement-requiring equipped items are attuned. Enforcing it is correct by the rulebook and
unprovable here; not enforcing it is one more place the sheet is quietly generous. Either way
it should be written down as unproved, the way ADR 0018 wrote down its rounding.

### D3 — sequencing

Steps 1–3 are checkable and steps 4–5 are not. My recommendation is to land 1–3 first, re-record
the baseline, and treat steps 4–5 as a separate run — rather than carrying an unverifiable AC
formula through the same commits that move 47 compared elements.

---

## What will not be verified, stated in advance

- **The armour class number.** No save records one. Like hit points, it will be derived from
  the published rule and checked by nothing, and it should never be described as verified.
- **Attunement gating**, per D2.
- **Slot capacity rules** — that a two-handed weapon occupies both hands, that only one body
  slot exists. The nine saves show `Primary Hand`, `Armor` and `Two-Handed` and never a second
  hand, a shield or a ring slot, so the interesting conflicts have no oracle either.

What *is* verified, and strongly, is the closure: which elements a bag brings into a
derivation, for 45 item instances and 15 adorners across nine characters.
