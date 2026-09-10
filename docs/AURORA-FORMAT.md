# The Aurora content format

Notes from reading the whole of [AuroraLegacy/elements](https://github.com/AuroraLegacy/elements)
(as of 2026-09; 758 XML files, 60 index files, ~12,100 elements). This is the reference for
`@incudo/aurora-import`. There is no official schema — everything here is observed.

## Two file kinds

### `.index`

```xml
<index>
  <info>
    <name>Core</name>
    <description>The content from the core rulebooks.</description>
    <author url="http://dnd.wizards.com">Wizards of the Coast</author>
    <update version="0.2.8">
      <file name="core.index" url="https://raw.githubusercontent.com/.../core.index" />
    </update>
  </info>
  <files>
    <file name="internal.xml" url="https://raw.githubusercontent.com/.../core/internal.xml" />
    <file name="players-handbook.index" url="https://.../core/players-handbook.index" />
  </files>
</index>
```

Indexes nest: an index may list other indexes. `update/version` is what an update check compares
against. URLs are absolute in practice, but the importer resolves them relative to the index URL
anyway.

### elements XML

```xml
<elements>
  <info>
    <name>Elf</name>
    <update version="0.2.4"><file name="race-elf.xml" url="…" /></update>
  </info>
  <element name="Elf" type="Race" source="Player's Handbook" id="ID_RACE_ELF">
    <supports>Human</supports>                    <!-- OUTSIDE <rules>. See below. -->
    <requirements>ID_INTERNAL_OPTION_ALLOW_FEATS</requirements>   <!-- gates the element -->
    <description> …HTML… </description>
    <sheet display="false" alt="…" usage="…" action="…"> … </sheet>
    <setters>
      <set name="hd">d8</set>
    </setters>
    <rules>
      <grant  type="Racial Trait" id="ID_…" level="1" requirements="…" />
      <select type="Proficiency" name="Skill Proficiency (Rogue)" supports="Skill,Rogue" number="4" />
      <stat   name="darkvision:range" value="60" />
    </rules>
    <multiclass id="ID_…"> … </multiclass>
    <spellcasting name="…" ability="…"> … </spellcasting>
  </element>

  <append id="ID_DECLARED_IN_ANOTHER_FILE">      <!-- adds to an element declared elsewhere -->
    <supports>Extra Tag</supports>
    <rules><grant type="Proficiency" id="ID_…" /></rules>
  </append>
</elements>
```

### Three constructs that are easy to miss, and were

All three were being read past in silence until Phase 1, and the first is the expensive one.

**`<supports>` is a child of `<element>`, not of `<rules>`.** The corpus contains 3,611 of
them and **not one** inside `<rules>` — so an importer that only looks inside `<rules>` ends
up with 890 distinct support tags on zero elements, and every `<select supports="…">` in the
game matches nothing. Nothing errors; the candidate lists are just always empty. Incudo reads
both positions.

**`<requirements>` is also a direct child**, 1,845 times, and it gates the *element* rather
than one of its rules: the Human Variant exists only in a campaign using feats. Incudo puts
this on `Element.requirements` and uses it to filter candidate lists. It deliberately does
**not** remove an element the character already has — content that vanishes is worse for the
user than content that explains itself.

**`<append id="…">` adds rules and support tags to an element declared somewhere else**, 171
times — usually a supplement extending a core element without editing the core file (the 2024
DMG adds ten firearm proficiencies to `ID_PROFICIENCY_WEAPON_PROFICIENCY_MARTIAL_RANGED_WEAPONS`
this way). The target is routinely in a file that has not loaded yet, so appends cannot be
applied at parse time: `parseAuroraElements` returns them unapplied and `ContentLibrary`
folds them in once every file is in. An append whose target never loads is a warning, because
"that supplement is enabled and the book it extends is not" is a normal thing for a user to do.

**`equipped="…"` is a requirement expression, not a boolean.** The importer reads it as
`attrs['equipped'] === 'true'`, and the corpus contains **79 of them, not one of which is
`"true"`**:

```
22  equipped="[armor:none]"                 16  equipped="[armor:none],[shield:none]"
15  equipped="![armor:heavy]"                9  equipped="![armor:medium],![armor:heavy]"
 6  equipped="[armor:heavy]"                 3  equipped="!([armor:heavy]||[shield:any])"
```

So every one of them currently parses to `false`, and `Rule.equipped` is a boolean that is
always false. It is dead twice over: nothing in the engine, the verifier or the CLI reads it
either, so all 79 rules apply unconditionally. That is the fourth construct in this family,
after `<supports>`, element-level `<requirements>` and `<append>` — and it is the one holding
up armour class, because `equipped` is how the corpus says *which* AC calculation applies:

```xml
<stat name="ac:calculation" value="ac:unarmored defense barbarian"
      bonus="calculation" equipped="[armor:none]" alt="Unarmored Defense (Barbarian)" />
```

Note `bonus="calculation"`. Every alternative AC — a barbarian's, a monk's, a tortle's shell,
a robe of the archmagi — contributes to one stat in one bonus bucket, and Incudo's engine
already resolves a bucket by taking the largest. **Unarmoured defence needs no special
treatment**; it needs `equipped` to parse, an inventory to evaluate it against, and a system
definition that derives `ac` from `ac:calculation`.

## Element types seen in the wild

Aurora does **not** define these anywhere — they are just strings, and the app has hardcoded
behaviour for some of them. Counts from the AuroraLegacy repo:

```
Archetype Feature 1924   Magic Item 1843   Spell 1080   Grants 1063   Class Feature 1015
Racial Trait 1000   Item 919   Feat Feature 380   Feat 321   Deity 296   Archetype 272
Companion Action 229   Proficiency 198   Background Feature 179   Companion Trait 165
Companion 164   Race 139   Source 138   Ability Score Improvement 135   Background 118
Information 116   Weapon 100   Language 83   Sub Race 81   Class 29   Armor 27
Weapon Property 26   Race Variant 22   Rule 13   Dragonmark 12   Companion Reaction 12
Alignment 9   Support 8   Background Variant 7   Vision 6   Option 6   Weapon Group 2
Background Characteristics 1
```

**This list is exactly what Incudo turns into data.** In Incudo these are declared by the
game system definition (`systems/dnd5e/system.json`), which is the whole trick that makes the
engine system-agnostic: Aurora hardcodes them, Incudo reads them.

## The rule vocabulary

| tag | attributes observed |
|---|---|
| `grant` | `type`, `id`, `level`, `requirements`, `spellcasting`, `prepared`, `name`, `equipped`, `allowReplace` |
| `select` | `type`, `name`, `supports`, `requirements`, `number`, `level`, `spellcasting`, `default`, `optional`, `allowReplace`, `prepared`, `default-behaviour` |
| `stat` | `name`, `value`, `bonus`, `level`, `requirements`, `equipped`, `alt`, `inline`, `max`/`maximum`, `base`, `condition` |
| `supports` | (text content) — but see above: in practice it lives outside `<rules>` |
| `append` | `id` + nested `supports`, `rules`; a child of `<elements>`, not of `<element>` |
| `spellcasting` | `name`, `ability`, `prepare`, `extend`, `allowReplace`, `all` |
| `multiclass` | `id` + nested `prerequisite`, `requirements`, `setters`, `rules` |
| `setter` / `set` | `name` + text; extra attrs `currency`, `lb`, `addition`, `type`, `modifier`, `override`, … |

### `requirements` — a small boolean expression language

Operators: `!` (not), `,` (and), `||` and `|` (or), `( )` grouping.
Operands: an element ID, or a bracketed stat comparison `[str:13]` meaning *strength ≥ 13*.

```
!ID_WOTC_PHB_MULTICLASS_ROGUE
!(ID_WOTC_PHB_CLASS_WARLOCK|ID_WOTC_PHB_MULTICLASS_WARLOCK)
([dex:13],!(ID_WOTC_PHB24_CLASS_ROGUE||ID_WOTC_PHB24_MULTICLASS_ROGUE))||ID_INTERNAL_GRANTS_MULTICLASS_UNLOCKER
!([str:15]||ID_INTERNAL_GRANT_ARMOR_IGNORE_STRENGTH_REQUIREMENT)
```

Precedence observed: `!` > `,` (and) > `||` (or). `@incudo/core`'s
`parseRequirements()` implements exactly this.

### `supports` — the `select` filter language

`select@supports` is a filter over element `supports` tags:

- `"Skill"` — element must support `Skill`
- `"Skill,Rogue"` — must support **both** (AND)
- `"Standard||Exotic"` — must support **either** (OR)
- `"$(spellcasting:list), $(spellcasting:slots)"` — `$(…)` interpolates a stat/context value
  before matching. This is the nastiest corner of the format and where a naive importer breaks.
- `"ID_PHB_FEAT_ASI_STRENGTH|ID_PHB_FEAT_ASI_DEXTERITY"` — bare IDs are also legal operands.

### `stat` values

`value` is either a number, a literal string (`"Fire"`), or a **stat reference expression**:

```
proficiency          proficiency:half     level                level:ranger
charisma:modifier    companion:proficiency  innate speed       attunement:current
```

Stat names are `:`-delimited namespaces, e.g. `ac:armored:enhancement`,
`companion:hp:max`, `wizard:spellcasting:prepare`, `strength:save:misc`. Incudo keeps the
namespaced string keys verbatim — inventing a typed schema for 5e stats would defeat the point.

`bonus` names a bonus *bucket* (so bonuses of the same name don't stack), matching how 5e
"you can't add the same bonus twice" works. `level` gates the stat to a class level.

## Deliberate simplifications in the importer

- Aurora's `<description>` is loose HTML with app-specific bits (`<div class="reference">`,
  `<div element="ID_…"/>`). Incudo stores it as HTML and resolves `element="…"` references
  at render time; it does not try to normalize the markup.
- `<sheet>` is display metadata (`display`, `alt`, `usage`, `action`). Kept as-is, interpreted
  by the system definition's sheet layout.
- Aurora has undocumented app-side behaviour for certain IDs (`ID_INTERNAL_*` are helpers that
  the app itself generates). `core/internal.xml` in AuroraLegacy exists precisely to patch around
  this. Incudo treats them as ordinary elements — the importer flags any it cannot resolve.

## Aurora **character** files — resolved, and now imported

Documented separately in **[AURORA-SAVE-FORMAT.md](./AURORA-SAVE-FORMAT.md)**, from 8 real
`.dnd5e` files. Short version: XML, save `version="1.0.3"`, a nested tree of chosen element IDs
that maps almost directly onto the Incudo character model — plus inline base64 portraits, a
full derived snapshot, and a 37,000-entry exclusion list that together account for well over 99%
of the bytes.

Worth reading even if you only care about *content*, for one reason: the derived snapshot in
every save is a record of a derivation Aurora actually performed, and diffing against it is
what found the three dropped constructs above. `incudo aurora verify` is that diff.

---

## How Aurora stores downloaded content

Aurora's "Additional Content" tab downloads an index into the user's `custom/` folder — and it
does **not** mirror the upstream repository. The rule, verified against a real 740-file install:

> **Every index gets a folder named after it, and its files are written inside that folder by
> their `name` attribute — recursively.**

```
custom/AuroraLegacy.index                          -> folder custom/AuroraLegacy/
custom/AuroraLegacy/core.index                     -> folder custom/AuroraLegacy/core/
custom/AuroraLegacy/core/players-handbook.index    -> folder .../core/players-handbook/
custom/AuroraLegacy/core/players-handbook/spells.xml
custom/AuroraLegacy/unearthed-arcana/20150202.xml  (flat — upstream nests these under 2015/)
```

For the AuroraLegacy repo this *coincides* with the repository layout, which is a trap. It comes
apart on the original `aurorabuilder/elements` third-party index, whose files are listed with
URLs under `third-party/` but land directly in the `third-party/` folder rather than
`third-party/third-party/`. That mismatch is how the rule was found.

**Why it matters:** Incudo can point at an existing Aurora install and work entirely offline —
no network, no re-download, instant migration. `incudo validate <custom>/AuroraLegacy.index
--aurora-folder` loads the whole corpus in ~10 seconds versus ~2 minutes over the network, and
that is what CI uses.

Two resolution modes therefore exist, and they are not interchangeable:

| flag | layout | use |
|---|---|---|
| `--aurora-folder` | Aurora's download folder (by `name`) | a user's real install |
| `--local [--root DIR]` | the repository's own paths | a git checkout of the content |

## Import baseline (measured)

`incudo validate` run against a full local checkout of AuroraLegacy/elements, 2026-09-09:

```
files:    740
elements: 12,058  (+80 Aurora generates at runtime)
errors:   0
unresolved references:              1
requirements that can never be met: 23
warnings:                           57
```

It was 57 unresolved references when this document was first written. Two things changed.

**The generated-element overlay landed.** `packages/aurora-import/src/generated-elements.ts`
declares the 80 elements Aurora's app materializes — damage resistances, sizes, the six
ability bumps, twenty levels, the 5e baseline grants. That resolved 51 of the 57. The
`ID_SIZE_*` family was listed above as "genuine upstream typos" and that was **wrong**: every
one of the eight sample saves has `ID_SIZE_MEDIUM` in its `<sum>` block, which is Aurora's own
record of a derivation it performed. They are generated, not missing.

**Grant references and requirement references are now counted separately**, because they fail
differently. A `<grant>` to an id nothing declares is broken content: a character silently
loses something. A `requirements="…"` naming an id nothing declares is a membership test that
reads false, and `!ID_X` against an id that will never exist is ordinary content — eighteen of
the twenty-three are the 2024 rules saying "unless the replacement feature is in play". Only
the first kind is budgeted in CI.

What is left:

- **1 unresolved grant** — `ID_INTERNAL_CONDITION_DAMAGE_VULNERAILITY_BLUDGEONING`, a
  misspelling of an id that does exist. One character, upstream, fixable.
- **23 unmeetable requirements**, of which five are genuine typos worth reporting upstream:
  `ID_PHB_SPELL_ARCANA_EYE` and `ID_WOTC_PHB24_SPELL_ARCANA_EYE` (`ARCANA` for `ARCANE`),
  `ID_WOCT_PSA_BACKGROUND_FEATURE_…` (`WOCT` for `WOTC`),
  `ID_ARCHETYPE_FEATURE_BATTLE_MASTER_COMBAT_SUPERIORITY` (missing its `WOTC_PHB_` prefix),
  and `ID_WOTC_WGTE_GRANTS_DARKMARKED`. All six known mistakes are listed as data in
  `KNOWN_UPSTREAM_TYPOS`, so `validate` can tell them from a new one and the list visibly
  shrinks when AuroraLegacy fixes one.

**These numbers are the regression baseline.** CI fails if the budgeted one grows.

### One thing the format does not tell you

`<multiclass id="ID_WOTC_PHB_MULTICLASS_ROGUE">` declares an id that other content references
(`requirements="!ID_WOTC_PHB_MULTICLASS_ROGUE"`), but nothing in the XML ever declares an
*element* with that id — Aurora's app creates one when you multiclass. The importer synthesizes
it (type `Multiclass`), which resolved 24 dangling references in `core.index` alone. Expect more
undocumented app-side behaviour of this kind; the way to find it is to keep running the CLI over
the whole corpus.
