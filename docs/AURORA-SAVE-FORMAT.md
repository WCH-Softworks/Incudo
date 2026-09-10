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
| `<equipment>` | **nothing yet** | no inventory in the model — Phase 2 |

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

Against all 8 sample saves, 2026-09-09 — 951 element ids compared:

| | count |
|---|---:|
| `element-missing` — Aurora derived it, Incudo did not | **0** |
| `spell-missing` — a spell Aurora listed that Incudo did not derive | **0** |
| `stat-mismatch` — both computed a number, differently | **0** |
| `element-extra` — Incudo derived it, Aurora did not | 52 |
| `content-missing` / `not-modelled` — reported, not counted | 63 |

**All 52 remaining differences are one species: content AuroraLegacy added after these saves
were written.** That is not a guess — each family was traced to its upstream commit:

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

- **Spell slots.** Aurora computes the multiclass slot table in application code; no content
  file describes it, so no system definition can disagree with it yet.
- **A whole-class spell list.** A cleric prepares from every spell of its class and Aurora
  expands that in code. One note, not sixty failures.
- **Anything from the character's inventory**, transitively. A suit of plate brings a stealth
  marker; a Tome of Clear Thought brings +2 Intelligence and therefore +1 to a spell save DC.
  Incudo has no inventory yet, so its number is lower and is not wrong to be. One sample
  wizard's DC differs by exactly this, and the report names the tome.
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
