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
| `<equipment>` | `inventory`, one row per `<item>` | [ADR 0024](./adr/0024-inventory-is-a-list-of-instances.md). **Nothing derives from it yet** — that is step 3 |

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

Against all 9 sample saves, 2026-09-10 — 1,158 element ids and 8 spell slot rows compared:

| | count |
|---|---:|
| `element-missing` — Aurora derived it, Incudo did not | **1** |
| `spell-missing` — a spell Aurora listed that Incudo did not derive | **0** |
| `stat-mismatch` — both computed a number, differently | **0** |
| `element-extra` — Incudo derived it, Aurora did not | 53 |
| `content-missing` / `not-modelled` — reported, not counted | 64 |

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
is those that are compared: 7 DC rows and 7 attack rows across the nine saves. The eighth pair
belongs to a wizard carrying a Tome of Clear Thought and stays `not-modelled` with the item
named, for the same reason as everything else in the bag.

**All 53 `element-extra` differences are one species: content AuroraLegacy added after these
saves were written.** That is not a guess — each family was traced to its upstream commit:

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
- **Anything from the character's inventory**, transitively. A suit of plate brings a stealth
  marker; a Tome of Clear Thought brings +2 Intelligence and therefore +1 to a spell save DC.
  Incudo now *stores* the bag but derives nothing from it, so its number is lower and is not
  wrong to be. One sample wizard's DC differs by exactly this, and the report names the tome.
  The message still says "Incudo has no inventory yet", which since step 2 is stale in wording
  and true in substance; step 3 is where the sentence stops being true either way and the
  47 notes become compared elements.
- **Content from a source this run did not load.** A statement about which books are enabled.
  When an absence traces back to such an element, the whole subtree is attributed to it —
  a Half-Elf variant that is not loaded takes its Keen Senses and its Perception proficiency
  with it, and that is one report rather than three engine failures.

### What it found

The verification paid for itself immediately. Diffing against real derivations, and then
counting what the corpus actually contains, turned up three constructs the *content* importer
had been walking straight past — including element-level `<supports>`, which meant **no
`<select supports="…">` had ever matched anything**. See
[AURORA-FORMAT.md](./AURORA-FORMAT.md). None of that was visible from reading the format.
