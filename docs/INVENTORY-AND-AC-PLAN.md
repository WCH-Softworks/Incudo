# Inventory and armour class — the plan

**Status:** **done** · 2026-09-10 → 2026-09-11 · every decision settled — D1 by
[ADR 0022](./adr/0022-kinds-contribute-systems-do-not-ship-content.md), D2 by
[ADR 0023](./adr/0023-attunement-gates-and-reports.md), D3 below ·
**all five steps are built.** [ADR 0024](./adr/0024-inventory-is-a-list-of-instances.md) settled
the three questions step 1 left open, step 2 filled the bag from Aurora, step 3 seeded the
derivation from it, [ADR 0025](./adr/0025-slots-publish-tags.md) made the slots publish what is
in them, and [ADR 0026](./adr/0026-armour-class-is-derived-and-checked-by-nobody.md) derived the
armour class. Steps 1, 2, 4 and 5 moved no baseline; step 3 moved one, deliberately, and that was
the point of it.

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

Every number below came from the 740-file corpus or a set of real saves. Nothing here is
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

45 item instances across a set of real saves — 26 equipped, 12 attuned, 15 adorners.

> **Note, 2026-09-23 — re-derived from the thirty sample saves:** 24 instances in 8 saves, of which 22 are
> equipped, 7 attuned and 2 are adorned hosts. The figure comparison is in
> [ADR 0024](./adr/0024-inventory-is-a-list-of-instances.md)'s note; this plan is left as written.

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
  **18 of 19** carried ones are not. The exception is not one: one save carries *two* greatswords,
  one equipped, so the element id is in `<sum>` on the other instance's account. Adorners
  follow their host — 13 of 15 in `<sum>`, and the 2 outside both hang off carried items.
- **An item is an instance, not a reference.** That save's two greatswords carry different
  enchantments: a Vorpal Sword on the carried one and a Frost Brand on the equipped one. Any
  model that keys the bag by element id loses that on the first real character.
- **`location` is set only for the hand and body slots** — `Primary Hand`, `Armor`,
  `Two-Handed` are the only three values in a set of real saves. A cloak, boots or a ring is
  equipped with no location at all, and its slot comes from the item's own `slot` setter.

The bag also carries things that are not items. `ID_PHB_INTERNAL_ITEM_PROXY_ASI_INTELLIGENCE`
is how Aurora records an ability bump the character was simply given, and
`ID_PHB_INTERNAL_ITEM_LANGUAGE_PROXY_LANGUAGE_ORC` is how it records a learned language. These
are **the only 3 ids in all nine bags that neither the 740 files nor the 80-element overlay
declare** — a third family of Aurora-app-materialized elements, the same shape as the two
already handled. *(Step 2 added them; the overlay is now 83. The ASI proxy is not the Tome of
Clear Thought, as this paragraph originally said — the Tome is an ordinary corpus element
carrying its own `+2`, and the proxy grants the overlay's separate `+1`. Both are in one save's
bag, which is what made them easy to conflate.)*

> **Note, 2026-09-23:** no sample save contains an `ITEM_PROXY` or `PROXY_` id, so "the only 3 ids in all
> nine bags" cannot be re-derived from the samples; `location` takes four values there, not three (a shield
> records `Secondary Hand`).

### The oracle is strong for inventory and absent for AC

**47 of the 51 `not-modelled` notes across a set of real saves are "comes from the character's
inventory"**, plus the one spell save DC that a Tome of Clear Thought moves — 48 of 51. Step 3
below converts all of them into compared numbers, in both directions: an item that fails to
contribute becomes `element-missing`, one that contributes when it should not becomes
`element-extra`.

**No save records an armour class.** `<defenses>` contains an empty `<conditional>` and the
only `<attributes>` block belongs to the companion and is all tens. There is no AC in the
format, so `aurora verify` will never gain a comparison for it. This is exactly hit points'
position (ADR 0019): settled by reading the published rule, and by nothing else.

One more thing the oracle cannot settle: **whether attunement gates a contribution.** All 12
equipped items in a set of real saves that require attunement *are* attuned, so there is no
counter-example in either direction. 5e says an unattuned item gives nothing; the saves neither
confirm nor deny it.

> **Note, 2026-09-23:** two paragraphs above have moved on the samples. (1) "No save records an armour
> class, so nothing settles it but reading the rule": the file still records none, but the maintainer read
> the value off Aurora's screen for all 30 samples (`manifest.json`, `readout`) and the derivation agrees on
> **30 of 30**, including heavy armour at a Dexterity modifier of −1 and medium armour at +3. See ADR 0026's
> note. (2) Attunement: **7 of 7** attunement-requiring equipped items are attuned, so the gate is still
> untested against a counter-example, but one sample carries four attuned items and the limit reports it.

---

## The sequence

Five steps. The first three are oracle-backed and should land before the last two, which are
not.

### Step 1 — `Character.inventory` · **done**, [ADR 0024](./adr/0024-inventory-is-a-list-of-instances.md) · `character.json` formatVersion is 2

The model, and the expensive-to-reverse decision. An entry is an **instance**:

```jsonc
{ "instanceId": "…", "elementId": "ID_WOTC_ARMOR_MEDIUM_HALF_PLATE",
  "quantity": 1, "equipped": true, "slot": "body", "attuned": true,
  "adorners": [{ "instanceId": "…", "elementId": "ID_…_MITHRAL_ARMOR" }],
  "name": "…", "notes": "…" }
```

It is an input, not a derivation, so ADR 0006 is satisfied: the user put it there and no
formula produces it.

ADR 0024 shipped that shape with three changes, all of them measurements rather than taste.
`slot` stayed but is an **override**, absent unless the user disagreed with the element — the
saves' `location` agrees with the element's own `slot` setter 15 times out of 15. `adorners`
**nest** and carry no `instanceId`, because Aurora gives an adorner no identity and the saves
never nest one, never carry one alone, and never put two on a host. And an adorner's `name` is
dropped: 15 of 15 are a byte-for-byte copy of the element's own.

`collectCharacterContent` must embed the elements of **every** entry, carried included — a save
whose bag cannot be read is a broken save under ADR 0012 — while only equipped entries seed the
derivation. This is the same trap the kind's `grants` set: the container walks the character,
and anything the character references without *choosing* has to be added deliberately.

### Step 2 — the importer fills it · **done**, bugfix-shaped under ADR 0008

`save.equipment` was already parsed and nearly complete: id, name, amount, equipped, location,
attuned, adorners. `toInventory` maps it onto step 1's model and does nothing else. Two fields
the parser was not yet reading came with it — the `identifier` GUID that becomes `instanceId`,
and `<details>`, which is where the user's own `name` and `notes` live as opposed to the
denormalized `name=` attribute.

Not new surface under the freeze: ROADMAP Phase 1 deferred this *by name* — "`<equipment>` is
read and deliberately not imported — `Character` has no home for items". The home arrived in
step 1.

Plus the 3 proxy ids into `generated-elements.ts`, which is the same argument the 80 already
there were added under. They are a third family of Aurora-app-materialized elements and the
first that only a *bag* reveals. Each carries **one grant and nothing else** — the ASI proxy
grants `ID_INTERNAL_ASI_INTELLIGENCE`, which is already in the overlay carrying its own +1,
and the two language proxies grant ordinary corpus elements. That is the "the rule is the
identity" carve-out, not a widening of it, and two independent things say so. Aurora's save
writes the granted element as the proxy's *only child* in the build tree, so the grant is
stated rather than inferred. And the corpus declares two proxies of this same family itself
— `ID_INTERNAL_ITEM_PROXY_FAMILIAR_SELECTION` and `…_COMPANION_SELECTION`, both `type="Item"`,
both hidden from the sheet, both carrying the one rule they exist for — so a proxy with a rule
on it is the established shape and not a new one. It does make these the first overlay
elements to reference content outside the overlay.

**What the real files said.** All 45 instances across a set of real saves came across — 26 equipped,
12 attuned, 15 adorners, 4 stacked rows, 1 user-given name, 0 notes — and every ADR 0024
measurement held, including the falsifiable one: **`slot` was written zero times**. Both of
that save's greatswords survive with their different enchantments. All 60 element references the
bags make are embedded in `content.json`. `aurora verify` moved no count in either direction;
the only visible change is three `not-modelled` messages losing a `(via "…PROXY…")` clause,
because the proxies' grants now resolve in the index instead of through the save's own tree.

One gap left deliberately: `toSourceAllowlist` still reads only the decisions and Aurora's
`<sum>`, so a *carried* item from a book the character draws on nowhere else would not put
that book in `Character.sources`. No sample save exercises it — every bag element's source is
already in the allowlist — and a save embeds its bag's content regardless (ADR 0012), so this
costs only the update path. It belongs with step 3, where the bag starts being read.

### Step 3 — the engine seeds equipped items · **done**, and the step the oracle checked

An equipped entry's element and its adorners join the derivation exactly as a choice does — one
line in `deriveCharacter` seeding from `equippedElementIds`, next to the choices and the
advancement. Carried entries contribute nothing (26/26 and 18/18 above), while
`collectCharacterContent` goes on embedding all of them (ADR 0024 decision 7).

**What the diff said.** The prediction was that 47 `not-modelled` notes would become compared
elements and everything else would hold. It did, with two findings and one number recovered:

| | before | after |
|---|---:|---:|
| `element-missing` | 1 | 1 |
| `spell-missing` | 0 | 0 |
| `stat-mismatch` | 0 | **0** |
| `element-extra` | 53 | **55** |
| `not-modelled` | 51 | **3** |
| `content-missing` | 13 | 13 |

- **48 notes became comparisons**, and all 48 agree. 47 were "this element came from the bag";
  the 48th was the one save DC the bag moved.
- **The two new `element-extra` are one Aurora app behaviour**: a **Mithral Armor** adornment
  suppresses its host armour's `ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE` grant, which no content
  file expresses. A set of real saves contains the control case — one save's plate has no mithral and
  *does* carry the marker — so it is measured rather than assumed. Left unmodelled and visible,
  per [ADR 0005](./adr/0005-aurora-import.md).
- **The eighth spell save DC is now compared and agrees**, which is the number the old
  `statsFromInventory` carve-out in `verify-character.ts` was hiding. Removing that carve-out
  also removed the last two readers of `proficiency` and `abilityModifier` in the verifier's
  options, so the file no longer holds any arithmetic of its own at all.
- **Nothing else moved.** No new pending decision on any save (no bag element in the nine opens
  a `<select>`), no new derivation problem, and the corpus baseline of 740 / 12,058 / 1 / 57 is
  untouched because none of this is content-side.

The full arithmetic, and what the save can and cannot prove about it, is in
[AURORA-SAVE-FORMAT.md](./AURORA-SAVE-FORMAT.md) — including the two pieces of the Tome of
Clear Thought sum that the agreeing DC does *not* pin.

Two loose ends step 2 left here were closed with it: `toSourceAllowlist` now reads the bag, so a
carried item from a book nothing else uses puts that book in `Character.sources`; and the
verifier's "Incudo has no inventory yet (ROADMAP Phase 2)" messages are gone rather than
reworded, because the sentence is no longer true in substance.

This was the last step that can be checked against Aurora.

### Step 4 — slots publish tags · `equals` becomes membership · **done**, [ADR 0025](./adr/0025-slots-publish-tags.md)

Three pieces and one declaration, on the character kind:

- **The kind declares its slots** — which exist, what stat each publishes into, and which
  setters become tags. 5e maps `body → armor`, `onehand,secondary → shield`,
  `onehand → primary`/`secondary`, `twohand → primary`; core says none of those words.
- **`equals` reads a tag set** when the stat publishes one, and stays string equality
  otherwise, which left the 8 `type =` uses alone.
- **`equipped=` is evaluated**, finishing the half ADR 0021 deferred.

**What the diff said: nothing, exactly as predicted.** `aurora verify` output is byte-identical
across all nine saves, no pre-existing derived stat moved, the corpus baseline is untouched
(nothing here is content-side) and all nine still open with zero sources.

That is a weak result and the ADR says so at length. Before this, all 78 `equipped=` rules
applied unconditionally, so evaluating can only ever *remove* a contribution — there is no path
by which a number goes up. Only eight rules across the nine characters carry a condition at all
(a monk's Unarmored Defence and five movement modes, the Defense fighting style twice), and all
eight came out true. **Not one negative case exists in the corpus of saves**, and nobody carries
a shield.

Four things were proved by perturbation instead, run against the real saves before being written
down as tests:

| perturbation | result |
|---|---|
| the monk, put into plate | loses exactly `ac:calculation` 18 and `innate speed:misc` 10 |
| the fighter, breastplate removed | loses exactly the Defense fighting style's `ac:misc` 1 |
| the monk, handed a shield | `shield` reads `Shield`, `[shield:none]` is false for the first time, Unarmoured Defence drops |
| a save with nothing attuned | loses the Ring of Protection's +1 AC and +1 to all six saves, with three warnings naming the items |

Four smaller findings worth keeping:

- **A two-handed weapon fills `primary` and not `secondary`**, which the plan listed as having
  no oracle. It has one and a half: the Double-Bladed Scimitar is `slot="twohand"` and Revenant
  Blade asks `[primary:double-bladed scimitar]`, and Dual Wielder's `[secondary:any]` would
  otherwise pay a greatsword user.
- **Slot capacity needed no decision.** A slot's `stats` list *is* its capacity, so a slot that
  publishes nothing holds any number of things — which is what 5e says about cloaks, and one save
  wears two.
- **`slot="armor"` is an upstream typo**, on Spiked Armor alone among 1,070 slot setters. It is
  now a `slot-unknown` warning rather than a character silently unarmoured.
- **78 rules, not 79.** The 79th is the Dueling fighting style's `melee:damage`, commented out
  upstream.

Attunement's gate landed here and its **limit did not** — ADR 0023's base of 3 needs ADR 0022's
`contributions`, and without it every one of a set of real saves would report over the limit.

### Step 5 — the `ac` derivation · **done**, [ADR 0026](./adr/0026-armour-class-is-derived-and-checked-by-nobody.md)

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

Two things step 4 changed about the shape of that. The `requirements` on those four rules will
be ordinary `[armor:heavy]`-style checks, and they now have a real answer — the same one
`equipped=` reads, off the same declaration. And **ADR 0023's attunement limit rides with
`contributions` too**: the base of 3 has nowhere else to live, and until it does
`attunement:max` reads 0 and every character with a single attuned item is over it.

**What actually landed: six rows, not four**, and the extra two are the paragraph above being
wrong. `min(dexterity:modifier, cap)` with a cap of 0 says heavy armour ignores Dexterity, and
the Player's Handbook says it also does not *penalise* a negative one — so a Strength paladin in
plate with Dexterity 8 reads 17 where the book says 18. A cap cannot express a floor, so the
term gets both, and `ac:armored:dexterity:floor` is 0 in heavy armour and −99 everywhere else.
Two more things the corpus settled while the rows were being written, both in
[ADR 0026](./adr/0026-armour-class-is-derived-and-checked-by-nobody.md): all 25
`ac:armored:armor` rules are **unbucketed**, so the base of 10 has to ask `[armor:none]` exactly
or it would land beside a suit of plate and read 28; and a cap of 0 is the damaging default, so
the two bound rows ask their questions by negation and an unrecognised armour category comes out
uncapped rather than Dexterity-less.

The attunement limit landed with it, exactly as written: a seventh contribution, unconditional,
`attunement:max` 3 in the `base` bucket, with `attunement:current` counted per attuned **entry**
and `over-attuned` reported at error level. None of a set of real saves is over — 1, 0, 1, 0,
3, 2, 1, 1, 3 — which was checked rather than assumed.

**The nine armour classes, and the fact that nothing checked them.** 18, 18, 17, 18, 18, 13, 16,
20, 16, each agreeing with the Player's Handbook worked by hand and with nothing else. The
corpus baseline is untouched (nothing here is content-side), `aurora verify` is byte-identical
across all nine saves, and all nine still open with zero sources — and a byte-identical verify
run would have been byte-identical if every one of those nine numbers were wrong. The evidence
is perturbation, in `tools/verify/src/armour-class.test.ts`; see ADR 0026 for which branches the
nine saves cannot reach and why.

> **Note, 2026-09-23:** "None … is over" and "nothing checked them" are the original set's. In the samples one
> save is over the limit (4 attuned against 3) and armour class agrees with a hand-read screen value on all
> 30; both are in ADR 0026's and ADR 0023's notes.

Two things predicted here that did not happen, worth recording:

- **`npm run fixtures:rebuild` produced no diff.** `ac` is in `summarize()`, but the golden save
  is built in `tools/verify/fixtures/system.json`, which declares no `ac` and no
  `contributions`, so there was nothing new for it to print.
- **`collectCharacterContent` needed no change.** The worry was that a contribution's
  `requirements` naming an element id would break ADR 0012, since `system.json` is not embedded.
  It does not: `requirements="ID_X"` is a membership test against what the character already
  has, so it reads identically online and offline whether or not `ID_X` is in the save. Checked
  rather than assumed, and all nine imports still pass `incudo character verify`.

---

## Decisions

All three are settled. D1 and D2 have ADRs; D3 is sequencing and lives here.

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
six of the overlay's 80 elements carried any when this was written — all six ability score
improvements, where the rule *is* the identity. (Step 2 made it nine of 83, on the same
argument.)

What this means for the steps below: the inventory work needs **no loader change, no second
file per system, and no origin filter** in the container or in `aurora verify`. Step 5 gets
four lines of data in `system.json`.

### D2 — does attunement gate an item's contribution? · **settled, [ADR 0023](./adr/0023-attunement-gates-and-reports.md)**

**It gates, and every gate reports itself.** The saves still cannot confirm it — all 12
attunement-requiring equipped items are attuned — but the corpus had more to say than this
file assumed, and two findings settled it.

Because Aurora separates the mundane host from the magical adorner, **gating an adorner gates
exactly the magical benefit**: an unattuned Flame Tongue greatsword is still a greatsword,
with no special case. 336 of the 968 attunement-requiring elements are adorners, and 578 carry
no rules at all, so this is a no-op for three in five of them.

And **content declares the limit**. `attunement:max` appears 11 times — `4|5|6` in the `base`
bucket for the Artificer and the 2024 Thief, and unbucketed `+1`s for the 2017 playtest
artificer — which both come out right against a base of 3 contributed in the same bucket. A
limit nothing can exceed would be decoration, so content bothering to declare one is the
nearest thing to evidence that attunement is a constraint rather than a label.

**The gate landed at step 4 and the limit did not** (ADR 0025 decision 8). They came apart for
the reason the paragraph above implies: the limit needs the base of 3, the base needs ADR 0022's
`contributions`, and `contributions` is step 5. Shipping the limit early would report all nine
sample saves as over it.

The risk was never the rulebook; it was a user losing a bonus with no explanation. That is
answered by reporting: an equipped, unattuned, attunement-requiring item produces a warning
naming the item, and being over the limit is a problem in the family of `over-selected`.

The prose requirement — `addition="by a wizard"` — is shown and never evaluated. The corpus
writes the same condition four different ways, casing included.

### D3 — sequencing · **settled**

**Land steps 1–3, re-record the baseline, then treat 4–5 as a separate run.**

The reason is sharper than "the first three are checkable". **Step 3 is the last point at which
Aurora can referee.** Up to there, every movement in the counts has one possible cause: an
equipped item's element arriving in the derivation, or failing to. After step 4 starts
evaluating `equipped=`, a movement has two possible causes — the seeding or the gating — and
disentangling them costs more than the pause does.

Two smaller notes that follow:

- **Steps 2 and 3 are separate commits.** Step 2 stores the bag and nothing derives from it, so
  it moves no `aurora verify` count at all; step 3 moves 47. Keeping them apart is what makes
  the second diff readable.
- **The 3 proxy ids must land with step 2, not after it.** Once the importer writes inventory,
  `collectCharacterContent` tries to embed every entry's element — and
  `ID_PHB_INTERNAL_ITEM_PROXY_ASI_INTELLIGENCE` and the two language proxies are declared
  nowhere.

---

## What will not be verified, stated in advance

*(Written before step 1 and unchanged by any of the five. Everything on it is still true.)*

- **The armour class number.** No save records one. Like hit points, it will be derived from
  the published rule and checked by nothing, and it should never be described as verified.
  *(Step 5 confirmed it: `aurora verify` is byte-identical on all nine saves with the
  derivation in place, which is exactly as much as it would be if the formula were wrong.)*
- **Attunement gating**, per D2 — and step 4 confirmed it: the gate fired zero times on the
  nine saves, because all 12 attunement-requiring equipped items are attuned.
- **Slot capacity rules** — that a two-handed weapon occupies both hands, that only one body
  slot exists. A set of real saves show `Primary Hand`, `Armor` and `Two-Handed` and never a second
  hand, a shield or a ring slot, so the interesting conflicts have no oracle either.
  *(Step 4 took two of these off the list by a different route: the corpus's own rules settle
  what a two-handed weapon occupies, and capacity turned out to be "how many stats does this
  slot publish" rather than a number anyone had to guess.)*
- **Every negative `equipped=` case.** Step 4 evaluates 78 conditions and a set of real saves
  exercise eight of them, all of which come out true. `[shield:any]` has never been true on a
  real save, because nobody carries a shield. Perturbation is what covers this, and it is not
  the same kind of evidence as a differential run.

What *is* verified, and strongly, is the closure: which elements a bag brings into a
derivation, for 45 item instances and 15 adorners across nine characters.
