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
    <description> …HTML… </description>
    <sheet display="false" alt="…" usage="…" action="…"> … </sheet>
    <setters>
      <set name="hd">d8</set>
    </setters>
    <rules>
      <grant  type="Racial Trait" id="ID_…" level="1" requirements="…" />
      <select type="Proficiency" name="Skill Proficiency (Rogue)" supports="Skill,Rogue" number="4" />
      <stat   name="darkvision:range" value="60" />
      <supports>Skill</supports>
    </rules>
    <multiclass id="ID_…"> … </multiclass>
    <spellcasting name="…" ability="…"> … </spellcasting>
  </element>
</elements>
```

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
| `supports` | (text content) |
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

## Aurora **character** files — resolved

Documented separately in **[AURORA-SAVE-FORMAT.md](./AURORA-SAVE-FORMAT.md)**, from 8 real
`.dnd5e` files. Short version: XML, save `version="1.0.3"`, a nested tree of chosen element IDs
that maps almost directly onto the Incudo character model — plus inline base64 portraits, a
full derived snapshot, and a 37,000-entry exclusion list that together account for well over 99%
of the bytes.

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
elements: 12,058
errors:   0
unresolved references: 57
```

Of those 57 dangling references:

- **45 are `ID_INTERNAL_*`** — elements Aurora's app materializes itself, which no XML file
  declares. Exactly the class of thing `core/internal.xml` exists to patch around. Incudo
  will need its own equivalent overlay; until then they are expected, not bugs.
- **12 are genuine upstream content typos**, e.g.
  `ID_PHB_SPELL_ARCANA_EYE` (should be `ARCANE_EYE`),
  `ID_WOCT_PSA_BACKGROUND_FEATURE_...` (`WOCT` for `WOTC`),
  and the `ID_SIZE_*` family, referenced but never defined.
  These are worth reporting upstream to AuroraLegacy.

**This number is the regression baseline.** CI fails if it grows. When the internal-elements
overlay lands, 45 of these disappear and the baseline drops accordingly.

### One thing the format does not tell you

`<multiclass id="ID_WOTC_PHB_MULTICLASS_ROGUE">` declares an id that other content references
(`requirements="!ID_WOTC_PHB_MULTICLASS_ROGUE"`), but nothing in the XML ever declares an
*element* with that id — Aurora's app creates one when you multiclass. The importer synthesizes
it (type `Multiclass`), which resolved 24 dangling references in `core.index` alone. Expect more
undocumented app-side behaviour of this kind; the way to find it is to keep running the CLI over
the whole corpus.
