# The Aurora save format

Reverse-engineered from 8 real `.dnd5e` files (2024–2026, Aurora save `version="1.0.3"`).
This is the reference for importing existing characters, and — just as usefully — a catalogue
of what **not** to do in Incudo's own format.

**Status: implemented and frozen.** All 8 import and re-derive with no missing elements, no
missing spells and no mismatched numbers; see [the results](#differential-verification--the-results)
below for the differences that remain and why each one is not a bug. `packages/aurora-import`
is bugfix-only from here ([ADR 0008](./adr/0008-aurora-compatibility-frozen.md)).

The sample files are personal data. They stay local, they are gitignored, and quoting a
character's name or notes into a commit message or a test fixture is the same leak as
committing the file — which is why every fixture in this repository is written by hand.

## Shape

Saves are XML. The extension is the system id: `.dnd5e`.

```xml
<character version="1.0.3" preview="false">
  <information>            <!-- group, generationOption -->
  <display-properties>     <!-- DENORMALIZED CACHE: name, race, class, level, portrait -->
    <portrait>
      <local>C:\...\portraits\shardmind male 2.png</local>
      <base64><![CDATA[ iVBORw0K... ]]></base64>     <!-- the whole PNG, inline -->
  <build>
    <input>                <!-- freeform: name, gender, player, xp, manual attacks,
                                 backstory, background answers, currency, notes, quest -->
    <appearance>           <!-- portrait path, age, height, weight, eyes, skin, hair -->
    <abilities available-points="15"> <!-- raw scores -->
    <elements level-count="12" registered-count="52">
                           <!-- THE ACTUAL BUILD: a nested tree -->
    <equipment>            <!-- the bag: one <item> per instance, plus empty <storage> tags -->
    <sum>                  <!-- DERIVED: every resulting proficiency and feature, flattened -->
    <magic>                <!-- DERIVED: slots, DC, attack bonus, known/prepared spells -->
  <sources>
    <restricted>           <!-- every source and element the user DISABLED -->
```

### The elements tree

The only part that is genuinely input. Two kinds of node:

```xml
<element type="Level" name="1" id="ID_LEVEL_1" rndhp="10,10,1,3,4,4,10,3,8,2,...">
  <element type="Race" requiredLevel="1" checksum="1597ef76" registered="ID_RACE_ELF">
    <element type="Racial Trait" name="Keen Senses" id="ID_RACIAL_TRAIT_KEEN_SENSES">
      <element type="Proficiency" name="Perception" id="ID_PROFICIENCY_SKILL_PERCEPTION" />
```

- **`registered="ID_…"`** — a *decision the user made*. This is the real payload.
- **`id="ID_…"`** — an element that was *granted* as a consequence. Fully derivable; recorded
  anyway.
- `checksum` — Aurora's guard against the underlying content changing under a saved choice.
- `number="1"`/`"2"` — disambiguates repeated selects with the same name (e.g. picking two
  Fighter skills). Incudo needs the same thing; its `select` rules are keyed by name for
  exactly this reason.
- `rndhp="10,10,1,3,…"` — **rolled hit points per level.** See "What this taught us", below.
- `class="ID_…"` on a `type="Level"` node — **which class that level was taken in**, alongside
  `multiclass="true"` and, on the first such level, `starting="true"`. A level with no `class=`
  belongs to the class chosen at level 1. This is the only record of a multiclass split, and it
  names the **multiclass** element (`ID_WOTC_PHB_MULTICLASS_WARLOCK`) rather than the class
  (`ID_WOTC_PHB_CLASS_WARLOCK`); the two are separate elements and both matter. See
  [ADR 0015](./adr/0015-class-levels.md).

### The equipment block

The second genuinely-input part, and the only other one. 45 `<item>` instances across the nine
sample saves — 26 equipped, 12 attuned, 15 adorned, 4 stacked.

```xml
<item identifier="42462837-…" name="Half Plate" id="ID_WOTC_ARMOR_MEDIUM_HALF_PLATE" sidebar="true">
  <equipped location="Armor">true</equipped>
  <attunement>true</attunement>
  <items><adorner name="Mithral Armor" id="ID_WOTC_DMG_MAGIC_ITEM_MITHRAL_ARMOR" /></items>
  <details card="true"><name/><notes/></details>
</item>
```

- **`identifier`** — a GUID, present and distinct on all 45. It is what an instance *is*: one
  save carries two greatswords under one element id with different enchantments.
- **`amount`** — a stack. 2, 5, 5 and 10 in the corpus, and **none of the four** is equipped,
  attuned or adorned, so a stack never carries per-instance state.
- **`<equipped location="…">`** — `Primary Hand`, `Armor` and `Two-Handed` are the only three
  values, and 11 of the 26 equipped items record no location at all: a cloak, a ring or boots
  takes its slot from the element's own `slot` setter. Where a location *is* recorded it agrees
  with that setter 15 times out of 15.
- **`<attunement>`** — on the item, never on an adorner, and it covers both: 5 of the adorners
  that require attunement are recorded by a flag on their mundane host.
- **`<items><adorner>`** — a magic item attached to this one. Never nested, never more than one
  per host, never carried standalone, and with no `identifier` of its own. Its `name=` is
  byte-identical to the element's in 15 of 15 cases.
- **`<details><name>`/`<notes>`** — the user's own words, as opposed to the `name=` attribute,
  which is a denormalized copy of the element's name and is stale in 1 of 42 known cases. Both
  tags are written on every item and usually hold nothing but whitespace: 1 of 45 items has a
  name, 0 have notes.
- `sidebar`, `hidden`, `card` — display state for a UI that no longer exists. Not modelled.
- `<storage name="#1" />` — empty in every sample. Aurora's container feature; no save nests an
  item inside another, so nothing about containers is modelled either.

Three ids in these bags are declared by no content file: two "Additional Language, …" proxies
and one "Additional Ability Score Improvement, Intelligence". They are Aurora's way of putting
a bare grant in the inventory, and they are supplied by `generated-elements.ts`.

## What the files actually contain

| file | size | base64 | `<sources>` | real decisions |
|---|---:|---:|---:|---:|
| Vigaro Safeguard | 318 KB | 278 KB (88%) | 0 KB | 42 |
| Deusinaldo | 2.9 MB | 300 KB | ~2.6 MB | 23 |
| arturo | 3.1 MB | 45 KB | **3.1 MB** | 57 |
| Merilio | 3.1 MB | 45 KB | ~3.0 MB | 52 |
| Theren Liadon | 7.3 MB | 4.6 MB | ~2.7 MB | 49 |
| Krusk Oathfang | 7.8 MB | 5.1 MB | ~2.6 MB | 28 |
| Bran Brightwood | 7.9 MB | 5.2 MB | 2.7 MB | 34 |

**A 3.1 MB file records 57 decisions.** Everything else is a portrait, a derived snapshot, or
an exclusion list.

## The three things that make saves enormous

1. **Base64 portraits inline** — up to 5.2 MB of PNG in the XML, *and* the original path is
   stored right next to it. Base64 costs 33% over the bytes, and XML text nodes make it worse.
2. **`<sources><restricted>` is an exclusion list.** Aurora records every element the user
   *turned off*: **37,235 element IDs and 177 sources** in one file. It stores the complement
   of a short answer.
3. **`<sum>` and `<magic>` duplicate the derivation.** Every granted proficiency, feature and
   spell slot is written out alongside the choices that produce them.

## What this taught us

Three of these landed directly in Incudo's design:

**Rolled values are inputs, not derivations.** `rndhp` is the one thing in `<sum>`-adjacent
territory that genuinely cannot be recomputed — a die roll has no formula. This refines
[ADR 0006](./adr/0006-derived-character-state.md): a character stores choices *and recorded
random results*, and nothing else. Missing this would have silently rerolled everyone's HP.

**Store the allowlist, not the blocklist.** `Character.sources` records the handful of sources
a character actually uses. The same information, three orders of magnitude smaller, and it
stays correct when new content appears upstream — an exclusion list silently *includes*
everything published after it was written.

**`checksum` is the right instinct in the wrong place.** Aurora checksums each individual
choice. Incudo records a version per source instead, which catches the same drift with one
field instead of fifty and gives a better error ("Xanathar's changed since you built this")
than a per-element mismatch.

## What the importer does — `packages/aurora-import`

| Aurora | Incudo | why |
|---|---|---|
| `registered=` nodes | `choices` | the only real input in the file |
| `<abilities>` | `baseStats` | [ADR 0014](./adr/0014-base-stats-are-inputs.md) |
| `rndhp` | `rolls` | a die roll has no formula |
| `<input>`, `<appearance>` | `freeform` | the rules never read it |
| top-level `type="Option"` grants | a `build/options` choice | a setting, not a consequence |
| inline base64 portrait | `assets/portrait.png` | bytes, never base64 (ADR 0007) |
| `<sources><restricted>` | inverted, then discarded | a blocklist is the wrong thing to keep |
| nested `id=` nodes, `<sum>`, `<magic>`, `<display-properties>` | **nothing** | derived; re-derived instead |
| `class=` on a `Level` node | `advancement` | the only record of a multiclass split ([ADR 0015](./adr/0015-class-levels.md)) |
| `<equipment>` | `inventory`, one row per `<item>` | [ADR 0024](./adr/0024-inventory-is-a-list-of-instances.md). An **equipped** entry and its adornments seed the derivation; a carried one seeds nothing |

Three details that are not obvious from the format:

**A bare `id=` means the opposite thing at the top level.** Nested, it is a consequence of a
choice above it and gets re-derived. At the top of the tree nothing granted it, so it is a box
the user ticked: `ID_INTERNAL_OPTION_ALLOW_FEATS`, `ID_WOTC_TCOE_OPTION_CUSTOMIZED_ASI`. Around
200 requirement expressions in the corpus test for those, so dropping them changes the build.

**`isList="true"` means `registered` is a row number, not an element id.** The fourth suggested
bond on a background's list is `registered="4"`. Read as an element id it produces a character
that has chosen an element called "4". These become `freeform` entries.

**`rndhp` carries twenty entries even for a level 3 character**, because Aurora rolls the lot up
front. All twenty are imported. Keeping only the used ones would re-roll the rest at level 4,
which is the failure [ADR 0007](./adr/0007-native-formats.md) exists to prevent, just deferred.

Portraits: decode the base64 once, write it beside the character as an ordinary image file,
and reference it. The extension comes from the bytes' magic number, not from the path Aurora
recorded next to them — that path points at a file on someone else's machine.

## Differential verification — the results

`incudo aurora verify <file.dnd5e> --index <index>` imports a save, re-derives it, and diffs
against the `<sum>` and `<magic>` blocks Aurora wrote. This was the point of building the save
importer at all ([ADR 0008](./adr/0008-aurora-compatibility-frozen.md)): Aurora already did the
maths for every character anyone ever built, and those answers were checked for ten years by
people whose characters would have been wrong otherwise.

Against all 9 sample saves, 2026-09-11 — 1,158 element ids, 8 spell slot rows, 8 save DCs and
8 attack bonuses compared:

| | count |
|---|---:|
| `element-missing` — Aurora derived it, Incudo did not | **1** |
| `spell-missing` — a spell Aurora listed that Incudo did not derive | **0** |
| `stat-mismatch` — both computed a number, differently | **0** |
| `element-extra` — Incudo derived it, Aurora did not | 55 |
| `content-missing` / `not-modelled` — reported, not counted | 16 |

The last two rows moved with step 3 of
[the inventory plan](./INVENTORY-AND-AC-PLAN.md), where an equipped item's element and its
adornments started seeding the derivation. `not-modelled` fell from **51 to 3**: 47 of its notes
were "this came from the bag" and one was "the bag moves this DC", and all 48 became comparisons
instead. `element-extra` rose from **53 to 55**, and the two are one finding rather than
overhead. `content-missing` is unchanged at 13. Incudo's own element total went from 1,151 to
1,200; Aurora's stayed at 1,158, because it is the same nine files.

The three counts that did **not** move are the ones worth reading first. No `stat-mismatch`
appeared, no spell went missing, and no new pending decision opened on any of the nine saves —
which is the prediction the plan made in advance, on the grounds that no bag element in any of
them opens a `<select>`. Nothing new is reported as an engine problem either.

**Step 4 moved nothing at all**, and the table above is unchanged by it. Slots publish tags and
`equipped=` is evaluated since [ADR 0025](./adr/0025-slots-publish-tags.md), and the output of
`aurora verify` is byte-identical across all nine saves. Read that as weakly as it deserves:
before step 4 all 78 `equipped=` rules applied unconditionally, so evaluating one can only ever
*remove* a contribution, and the nine characters carry only eight conditioned rules between them
— a monk's Unarmored Defence and its five movement modes, and the Defense fighting style twice
— every one of which comes out true. No save in this corpus has a character wearing armour while
carrying a rule that wants none of it, and **none of the nine carries a shield**, so `[shield:*]`
has never been exercised here at all. The attunement gate fires zero times, because all 12
attunement-requiring equipped items are attuned. This is a file about what Aurora can referee,
and step 4 is a thing it cannot.

**Step 5 moved nothing either, and it could not have.** `ac` is derived since
[ADR 0026](./adr/0026-armour-class-is-derived-and-checked-by-nobody.md) — the nine saves now read
18, 18, 17, 18, 18, 13, 16, 20, 16 — and **no `.dnd5e` save records an armour class**. The
`<defenses>` block holds an empty `<conditional>` and the only `<attributes>` block in the format
belongs to the companion, so there is nothing to diff and there never will be. A byte-identical
`aurora verify` here means the derivation did not disturb anything else; it is not evidence about
a single one of those nine numbers. `ac` sits beside `hp` ([ADR 0019](./adr/0019-recorded-rolls-are-readable.md))
as a number this file cannot see, and neither should ever be described as verified.

The attunement limit landed with it and is in the same position: `attunement:max` is 3 and
`attunement:current` is 1, 0, 1, 0, 3, 2, 1, 1, 3 across the nine, so nobody is over and
`over-attuned` fires zero times. Aurora records the attunement flag and never a derived
consequence of it.

The single `element-missing` is `ID_INTERNAL_MULTICLASS_LEVEL_3` on the ninth save: an
Aurora-app marker that nothing in the 740 files references and that carries no rules.
Deliberately unmodelled rather than budgeted — inventing a rule for it would be the guess
[ADR 0005](./adr/0005-aurora-import.md) rules out.

Spell slots joined the compared numbers with
[ADR 0018](./adr/0018-tables-and-track-stats.md), and what they proved is set out there:
pact magic being outside the multiclass table, and a half-caster's contribution being halved,
are both pinned by the ninth save. Rounding *down* rather than up is not — `floor(2/2)` and
`ceil(2/2)` are both 1, and no sample save has two classes with the Spellcasting feature.

The **spell save DC and attack bonus** joined them with
[ADR 0020](./adr/0020-stats-keyed-on-declared-blocks.md), and that one changed what the check
means rather than adding to it. Before, this file's own `saveDcBase: 8` rebuilt the DC and
compared it against Aurora's identically-computed one — which confirmed the ability modifier
and the proficiency bonus, and nothing about whether Incudo could show a DC, because no stat
held one. Both numbers are now published per casting source by the system definition, and it
is those that are compared: **8 DC rows and 8 attack rows** across the nine saves. The eighth
pair used to be carved out — it belongs to a wizard with a Tome of Clear Thought equipped — and
it is the subject of the next section, because it is the one number the bag was hiding.

### The Tome of Clear Thought, and what the eighth DC proves

The one sample wizard is a Wizard 12 with six items equipped, two of which touch Intelligence:
`ID_WOTC_DMG_MAGIC_ITEM_TOME_OF_CLEAR_THOUGHT` (its own `intelligence +2` and
`intelligence:max +2`) and `ID_PHB_INTERNAL_ITEM_PROXY_ASI_INTELLIGENCE` (the overlay's +1).
Aurora records attack **10** and DC **18**, which at proficiency +4 means an Intelligence
modifier of **+6**.

The arithmetic, and it is worth writing out because it is the only place a derived ability
score is checkable at all:

| | |
|---|---:|
| `<abilities>` → `baseStats` | 18 |
| `ID_WOTC_TCOE_OPTION_CUSTOMIZED_ASI_INTELLIGENCE_INCREASE_2`, a chosen ASI | +2 |
| the Tome, equipped | +2 |
| the ASI proxy's `ID_INTERNAL_ASI_INTELLIGENCE`, equipped | +1 |
| = | 23 |
| capped at `20 + intelligence:max`, and the Tome raises that cap by 2 | **22** |
| modifier, DC `8 + 4 + 6`, attack `4 + 6` | **+6, 18, 10** |

Both numbers agree with Aurora exactly. Two things that settles, and two it does not — and the
second pair is the more useful half, for the same reason [ADR 0018](./adr/0018-tables-and-track-stats.md)
went to the trouble of saying that its rounding was unproved.

- **`<abilities>` is a base, not a final score.** It records 18 and the sheet says 22. This was
  genuinely open: a save that already folded everything in would have made `baseStats` wrong
  ([ADR 0014](./adr/0014-base-stats-are-inputs.md)) and gone unnoticed for as long as nothing
  else contributed, which on these nine files is exactly how long it did.
- **Aurora applies the Tome's own rule, so it is not treated as a spent consumable.** Take the
  Tome out of the bag and the score is 18 + 2 + 1 = 21 against an unraised cap of 20, so 20, for
  a modifier of +5 and a DC of 17 — a number Aurora does not record. The content file says the
  same thing in a comment above its `slot` setter: *"consumable items that apply rules not
  implemented, equip this item as alternative to activate it"*. The hypothesis was worth testing
  and it is falsified.

What the save cannot see, stated because an agreeing number invites more confidence than it has
earned:

- **The proxy's +1 is invisible here.** Drop `ID_PHB_INTERNAL_ITEM_PROXY_ASI_INTELLIGENCE`
  from the bag and the total is 18 + 2 + 2 = 22 — the same 22, because the cap was clipping the
  23 anyway. The proxy is right by ADR 0024's step-2 argument and by Aurora writing the granted
  element as the proxy's only child in the build tree, and not by this DC.
- **The cap is invisible here too**, for the mirror-image reason: uncapped, the score is 23, and
  `floor((23-10)/2)` and `floor((22-10)/2)` are both +6. That `intelligence:max` is read at all
  rests on [ADR 0016](./adr/0016-stat-bounds-are-expressions.md), not on this.
- **Nothing checks Intelligence 22 against a recorded 22.** The save holds no derived ability
  scores. The DC and the attack bonus are the only window onto one, and what they see is the
  modifier — so the arithmetic above is pinned at its *total* and unpinned at every step.

Both directions were checked by perturbation rather than by the check passing, which is the
lesson [ADR 0020](./adr/0020-stats-keyed-on-declared-blocks.md) left behind: removing the Tome
from the bag moves the DC to 17 and removing the proxy moves nothing.

### The two new `element-extra` differences: mithral armour

Seeding the bag added two, and they are one behaviour on two characters: an equipped suit of
plate or half plate grants `ID_INTERNAL_GRANTS_STEALTH_DISADVANTAGE`, and Aurora's `<sum>` does
not contain it when a **Mithral Armor** adornment is on the same item.

The corpus does not express that anywhere — the mithral grants
`ID_INTERNAL_GRANTS_IGNORE_STEALTH_DISADVANTAGE` and nothing cancels anything. It is Aurora
application behaviour, the same family as the ability score maximum, the slot table, hit points,
the save DC and armour class.

The nine saves happen to contain the control case, which is what makes this a measurement rather
than a story:

| save | equipped | mithral | `…GRANTS_STEALTH_DISADVANTAGE` in `<sum>` |
|---|---|---|---|
| Bran | Plate | yes | no |
| Merilio | Half Plate | yes | no |
| Vigaro | Plate | **no** | **yes** |

So it is not that Aurora never emits the marker; it is that the mithral suppresses it. Left
unmodelled and visible rather than guessed at, per [ADR 0005](./adr/0005-aurora-import.md) —
one grant cancelling another is a mechanism the engine does not have, and inventing it for two
rows would be the wrong order of work. It is also the first `element-extra` on these saves that
is *not* content drift.

**The other 53 `element-extra` differences are one species: content AuroraLegacy added after
these saves were written.** That is not a guess — each family was traced to its upstream commit:

| family | added upstream |
|---|---|
| `ID_INTERNAL_GRANTS_SPELLCASTING_FEATURE` | 2026-02-02, *[PHB24] Backgrounds and Feats* |
| `ID_INTERNAL_GRANT_RACE_*` | 2026-02-25, *[Internal, PHB24] Race/Species Backwards Compatibility* |
| `ID_INTERNAL_GRANTS_ABILITY_SCORE_MAXIMUM_OVER_20` | 2026-03-21, *[PHB, PHB24] Miscellaneous Fixes* |
| 2024 firearm proficiencies | 2026-08-18, *[DMG24] Full Book Content Upload* |

This is exactly what Aurora's per-choice `checksum` attribute was for, and it is the reason
Incudo records a version per *source* instead. It is also indistinguishable, from inside the
diff, from a level gate that fired when it should not have — so `element-extra` still counts as
a mismatch and the report names the granting element, which is where the history lives.

### What is deliberately not compared

Counting these would make the exit code permanently non-zero, and a check that can never pass
is a check nobody runs.

- **A whole-class spell list.** A cleric prepares from every spell of its class and Aurora
  expands that in code. One note, not sixty failures.
- **Content from a source this run did not load.** A statement about which books are enabled.
  When an absence traces back to such an element, the whole subtree is attributed to it —
  a Half-Elf variant that is not loaded takes its Keen Senses and its Perception proficiency
  with it, and that is one report rather than three engine failures.

The character's inventory used to be the third entry in this list and the largest — 47 of the
51 notes. It is gone: an equipped entry's element and its adornments are seeded like any other
choice, so the bag is compared rather than excused, in both directions. A *carried* entry is
still not derived, and that is not an exemption either: Aurora leaves 18 of the 19 carried items
across these saves out of its own `<sum>`, so the two engines agree by omitting the same thing.
If one ever shows up in Aurora's set, it is reported as `element-missing` and the message says
which pile of the bag it came from.

### What it found

The verification paid for itself immediately. Diffing against real derivations, and then
counting what the corpus actually contains, turned up three constructs the *content* importer
had been walking straight past — including element-level `<supports>`, which meant **no
`<select supports="…">` had ever matched anything**. See
[AURORA-FORMAT.md](./AURORA-FORMAT.md). None of that was visible from reading the format.
