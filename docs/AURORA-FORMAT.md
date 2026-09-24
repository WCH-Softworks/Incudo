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

### Constructs that are easy to miss, and were

There are six of them now. Every one was read past in silence, none of them errored, and
every one was found the same way — by counting what the corpus contains rather than by
reading the format. Three are below, `equipped=` follows them, the fifth is
`<spellcasting><list>` in the `supports` section further down, and the sixth is a `<select>`'s
own nested `<item>`s, right after this list. The first is the expensive one.

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

**`equipped="…"` is a requirement expression, not a boolean.** The corpus contains **79 of
them, not one of which is `"true"`**:

```
22  equipped="[armor:none]"                 16  equipped="[armor:none],[shield:none]"
15  equipped="![armor:heavy]"                9  equipped="![armor:medium],![armor:heavy]"
 6  equipped="[armor:heavy]"                 3  equipped="!([armor:heavy]||[shield:any])"
 2  equipped="[armor:any]"                   1  equipped="![armor:any]"
 1  equipped="[shield:none]"                 1  equipped="[primary:none],[secondary:none]"
 1  equipped="[primary:double-bladed scimitar]"
 1  equipped="[primary:any],[secondary:any],![primary:versatile]"
 1  equipped="[primary:any],([secondary:none]||[shield:any])"
```

The importer used to read it as `attrs['equipped'] === 'true'`, so all 79 parsed to `false`,
and `Rule.equipped` was a boolean that was always false — dead twice over, since nothing read
it either and all 79 rules applied unconditionally. That was the fourth construct in this
family, after `<supports>`, element-level `<requirements>` and `<append>`.

Since [ADR 0021](./adr/0021-equipped-is-a-condition.md) it is a `RequirementExpr`, parsed by
the same `parseRequirements` that reads `requirements=`. 76 of the 79 sit on `<stat>` and 3 on
`<grant>`; none names an element id.

**It is evaluated since [ADR 0025](./adr/0025-slots-publish-tags.md)**, against slots a
character kind declares. 78 of the 79 attributes reach the engine: the 79th is the Dueling
fighting style's `melee:damage`, which upstream has commented out, so nothing parses it.

The reason it took two changes to get here is worth keeping. A slot publishes a **set of tags**
rather than a string, because the twelve operands above are three different kinds of thing in
one syntax — `heavy` is the value of the `armor` setter, `versatile` is the *presence* of a
setter whose value is a die (`1d10` ×9, `1d8` ×5, `1d12` ×1), and `double-bladed scimitar` is
`ID_WOTC_ERLW_WEAPON_DOUBLE_BLADED_SCIMITAR`'s name. `equals` answers by membership when the
stat publishes tags and by string comparison otherwise, which leaves the corpus's other eight
`equals` checks — `type = spell` ×7, `type = class` ×1 — exactly as they were. There are **no
`flag` checks anywhere in the corpus**.

That last weapon settles something else the corpus cannot otherwise say: it is `slot="twohand"`
and the check asks `[primary:…]`, so **a two-handed weapon fills the primary hand**. It does not
fill the off hand, because Dual Wielder's `[primary:any],[secondary:any],![primary:versatile]`
would then pay a greatsword user, and the one rule wanting the opposite reading is the
commented-out one.

The vocabulary content uses for `slot` is 18 values — `onehand` 277, `misc` 195, `gift` 154,
`body` 127, down to `legs` 1 — of which `onehand,secondary` (2, both shields) is the only
compound and `armor` (1, Spiked Armor) is an upstream typo for `body`. 5e declares 17 of them
and not that one, so equipping spiked armour reports `slot-unknown` rather than quietly leaving
the character unarmoured.

`equipped` is still the thing holding up armour class, because it is how the corpus says
*which* AC calculation applies:

```xml
<stat name="ac:calculation" value="ac:unarmored defense barbarian"
      bonus="calculation" equipped="[armor:none]" alt="Unarmored Defense (Barbarian)" />
```

Note `bonus="calculation"`. Every alternative AC — a barbarian's, a monk's, a tortle's shell,
a robe of the archmagi — contributes to one stat in one bonus bucket, and Incudo's engine
already resolves a bucket by taking the largest. **Unarmoured defence needs no special
treatment**; it needed `equipped` to parse and then to be evaluated, both of which now happen,
and what is left is a system definition that derives `ac` from `ac:calculation` — step 5, and
the only piece of 5e's armour class still missing.

**A `<select>`'s candidates are usually elements — 346 of them are text.** A background's
suggested Personality Trait, Ideal, Bond and Flaw (and a few similarly-shaped tables —
Trinket, Specialty, …) are written as `<select type="List" name="Ideal">` wrapping
`<item id="1">Tradition. The ancient traditions…</item>` children, each with a small local
number rather than a real `ID_…`. Nothing else in the corpus works this way — every other
`<select>` offers elements the index already knows about — so `candidatesFor`'s
`elements.byType(type)` found nothing for `type="List"`: no `<element type="List">` has ever
existed to find. 2,258 of these across 346 selects, and every one read "No candidate in the
loaded content matches this choice" until the importer started reading `<item>` at all.
`parseRules` in `packages/aurora-import/src/parse-elements.ts` now synthesizes one element per
item — id `<owner id>/list:<select name>/<item id>`, no rules, name is the item's text — so
the rest of the select/candidate/`Choice` pipeline needs nothing new. Gated on the `<item>`
shape being present, not on `type="List"` by name: the corpus happens to only use that type
for this, but the construct is structural, and a system with a different type string for the
same shape should get it for free.

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
| `select` | `type`, `name`, `supports`, `requirements`, `number`, `level`, `spellcasting`, `default`, `optional`, `allowReplace`, `prepared`, `default-behaviour` + nested `<item id="…">text</item>` on 346 of them — see below |
| `stat` | `name`, `value`, `bonus`, `level`, `requirements`, `equipped`, `alt`, `inline`, `max`/`maximum`, `base`, `condition` |
| `supports` | (text content) — but see above: in practice it lives outside `<rules>` |
| `append` | `id` + nested `supports`, `rules`; a child of `<elements>`, not of `<element>` |
| `spellcasting` | `name`, `ability`, `prepare`, `extend`, `allowReplace`, `all` + a nested `<list>` — see below |
| `multiclass` | `id` + nested `prerequisite`, `requirements`, `setters`, `rules` |
| `setter` / `set` | `name` + text; extra attrs `currency`, `lb`, `addition`, `type`, `modifier`, `override`, … |

### Same-named `<select>`s on one element are **one pool**

A growing allowance is written as several `<select>` rules sharing a name, one per level
that widens it — not as one rule whose `number` goes up:

```xml
<select type="Spell" name="Cantrip (Warlock)" supports="…" level="1"  number="2" />
<select type="Spell" name="Cantrip (Warlock)" supports="…" level="4"  />
<select type="Spell" name="Cantrip (Warlock)" supports="…" level="10" />
```

`number` defaults to 1, so a warlock 10 knows **four** cantrips: one pool, allowance
`2 + 1 + 1`. The save format agrees — a decision records the `name` it belongs to plus the
`requiredLevel` and `number` of the slot it fills:

```xml
<element type="Spell" name="Cantrip (Warlock)" requiredLevel="1"  number="1" registered="…" />
<element type="Spell" name="Cantrip (Warlock)" requiredLevel="1"  number="2" registered="…" />
<element type="Spell" name="Cantrip (Warlock)" requiredLevel="4"            registered="…" />
<element type="Spell" name="Cantrip (Warlock)" requiredLevel="10"           registered="…" />
```

So the pool's identity is **(owning element, select name)**, which is exactly the key Incudo
uses for a `Choice`: `<owner>/select:<name>`. The engine used to check each rule's own
`number` against the whole recorded list, which made a correctly-built warlock report
`"Cantrip (Warlock)" allows 2 choice(s) but 4 are recorded` — 26 such errors across a set of real saves, on 8 of the 9, and on non-casters too (a rogue's Expertise is the same shape).
It now sums the allowance over the rules the character has actually reached.

> **Note, 2026-09-23 — re-derived from the thirty sample saves**, as a before/after over the commit that
> made a select pool one allowance (`9616da8^` against `9616da8`, one script at both, corpus at `c28ce6c`).
> Before it, the samples report **50** `over-selected` errors on **16** of the 30 (casters and non-casters alike, a
> rogue's Expertise being the same shape), where the text has 26 on 8 of 9; after it, **0**, and the only other
> problem in the 30, one unresolved element, does not move. The mechanism reproduces at a larger size. The
> 2,553 groups and 89 multi-rule groups are corpus counts and were not re-run.

2,553 select groups in the corpus, of which **89 have more than one rule** — up to 20, for a
wizard's spellbook. Their rules are not interchangeable: 32 groups differ in `requirements`,
18 in `supports`, 7 in `type`. A wizard's first six spellbook entries are 1st-level spells
(`supports="$(spellcasting:list), 1"`) and the two it adds every level afterwards go up to
its highest slot. So a pending pool offers the union of the candidates of the rules that
still have room — over-inclusive rather than short, and Incudo does not enforce which slot a
recorded pick was legal for. Aurora records that partition and Incudo keeps only the order,
which is enough to say *which level* the next pick belongs to and not enough to re-derive
the filter it was made under.

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

A filter over an element's `supports` tags, its id, **and its setter values**:

- `"Skill"` — element must support `Skill`
- `"Skill,Rogue"` — must support **both** (AND)
- `"Standard||Exotic"` — must support **either** (OR)
- `"1,(Druid||Wizard)"` — parentheses group
- `"ID_PHB_FEAT_ASI_STRENGTH|ID_PHB_FEAT_ASI_DEXTERITY"` — bare IDs are legal operands
- `"0"`, `"Evocation"`, `"Tiny"` — so are **setter values**: a spell's level and school and
  a companion's size are `<set>`s, not tags
- `"$(spellcasting:list), $(spellcasting:slots)"` — `$(…)` expands to a sub-expression before
  matching. The nastiest corner of the format and where a naive importer breaks.

**Precedence: `,` (and) binds tighter than `||` (or)** — the same reading `requirements`
gets, and Incudo read it the other way round until
[ADR 0030](./adr/0030-a-declared-block-answers-a-filter.md). The corpus settles it, with a
piece of content written specifically to be OR-ed in. Tasha's Aberrant Mind writes

```xml
<select type="Spell" supports="1,(Divination||Enchantment),(Sorcerer||Warlock||Wizard)||Arms of Hadar" />
<append id="ID_PHB_SPELL_ARMS_OF_HADAR"><supports>Arms of Hadar</supports></append>
```

Arms of Hadar is a 1st-level **Conjuration**, so under the other precedence the school clause
ANDs across the whole filter, excludes the very spell the `||` exists to add, and that appended
tag is dead content. Find Familiar is the second witness from another book:
`"Familiar||Variant Familiar||Beast,0"` means "any familiar, or a CR 0 beast", and the Imp is
CR 1 and tagged `Familiar` precisely so this finds it.

**Three things about this language were unread until ADR 0030**, all found by counting the
corpus rather than by reading the format, and all three had to be fixed before a caster could
choose a spell:

| | count | what it broke |
|---|---|---|
| precedence inverted | 40 filters changed | `||<named exception>` clauses, and Find Familiar |
| `(` `)` never parsed | **131** of 2,466 `supports=` attributes | `Skill,(Intelligence||Wisdom||Charisma)` offered only the Wisdom skills |
| setter values never read | **210** filters changed | every level or school clause matched nothing |

Together those take the number of interpolation-free select filters that match **nothing** in
the corpus from 343 to 124. Most of the remaining 124 name options no loaded book provides,
which is a legitimate answer; three constructs in them are genuinely unread and are listed at
the end of this section.

**A paren in a filter groups; a paren in an element's `<supports>` is a character.** The two
are different languages — one an expression, one a comma-separated list of literal tags — and
16 elements carry a tag like `Fighter (Eldritch Knight)`. A filter can no longer name such a
tag. Measured before deciding that was acceptable: **zero** of the corpus's 2,466 filters have
a `(` following a word character, so nothing existing is affected.

#### `<spellcasting><list>` — the fifth dropped construct

`parseSpellcasting` read every attribute of `<spellcasting>` and dropped its one child
element, so the tag `$(spellcasting:list)` needs never reached the engine at all. **17 blocks
carry a `<list>`, across 10 distinct values.** Fixed under ADR 0008's freeze as a bugfix.

Two things about those 17 that a naive fix gets wrong:

- **A `<list>` is usually absent.** 17 of the corpus's 91 *named* blocks declare one; the other
  74 do not, including Cleric and Druid, whose spells are tagged with the block's own name. So
  the fallback to the name is the path almost every caster takes, not the exception.
- **It is not always the block's name, and not always one tag.** Five of the 17 differ, and two
  are sub-expressions: `Wizard,(Abjuration||Evocation)` for the 2014 Eldritch Knight and
  `Wizard,(Enchantment||Illusion)` for the 2014 Arcane Trickster. Nothing in the corpus is
  tagged `Eldritch Knight`, so a name-only fallback offers that character zero spells forever.

(Block counts, since two docs used to have them upside down: **118** `<spellcasting>` blocks,
**91 named** and 27 nameless, **93** carrying `extend="true"` of which 66 are named.)

#### `$(…)` — two keys, and both need a block

```
$(spellcasting:list)    280 occurrences
$(spellcasting:slots)   266 occurrences
```

That is the whole vocabulary. They appear in **one attribute** (`supports`) on **one tag**
(`<select>`), across **328** select rules, and **every one of those 328 names its block** with
`spellcasting="…"` — 11 distinct names. Nothing else in the corpus interpolates anything.

`$(spellcasting:list)` is the block's `<list>` child, falling back to the block's name.
`$(spellcasting:slots)` is the set of levels the character can cast at, read off the slot stats
content and the system already publish (ADR 0018), filled downwards from the highest — a
warlock publishes exactly one positive slot stat and can really pick spells of every level
below it. Incudo resolves both through a character kind's `blockFilters`, so the keys live in
`systems/dnd5e/system.json` and not in the engine; see ADR 0030.

#### Still unread, and reported rather than guessed at

- **`!` negation inside a filter** — 13 uses (`Artificer Infusion, !TCOE Base`). Read as a
  literal tag, so those nine selects offer an empty list. Unambiguous; simply not done yet.
- **~~`Ritual`~~** — 17 uses. A spell carries `<set name="isRitual">true</set>` and no element carries a
  `Ritual` tag. **Read since ADR 0047**: a kind's `setterTags` names the pair `isRitual` / `Ritual`, for a
  select's filter only. Two saves that pick spells through such a filter give a second witness (all four picks
  are `isRitual` true); a general rule for every true boolean setter was not adopted, because the other setters
  that are filter operands (`exotic`, `standard`) are also written out as explicit tags.
- **`Class`** — 15 uses, on the level 4/8/12/16/19 ability score improvement. Not a tag on any
  of the 12,058 elements, not any setter's value, unexplained by anything in the corpus.

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
what found the dropped constructs above. `tools/verify/src/aurora-oracle.test.ts` is that diff (it
was the command `incudo aurora verify` until [ADR 0039](./adr/0039-the-cli-is-removed-and-what-it-measured-becomes-tests.md)).

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
no network, no re-download, instant migration. Loading the whole corpus from an install takes
a couple of seconds (`tools/verify/src/corpus.test.ts` does it) versus ~2 minutes over the network.
CI reads a git checkout instead, which is the second mode below.

Two resolution modes therefore exist, and they are not interchangeable:

| `INCUDO_CORPUS_LAYOUT` | layout | use |
|---|---|---|
| `aurora-folder` (default) | Aurora's download folder (by `name`) | a user's real install |
| `repository`, with `INCUDO_CORPUS_ROOT` | the repository's own paths | a git checkout of the content |

## Import baseline (measured)

`corpus.test.ts` (then the command `incudo validate`) run against a full local copy of
AuroraLegacy/elements, 2026-09-17:

```
files:    740
elements: 14,316  (+229 Aurora generates at runtime)
errors:   0
unresolved references:              1
requirements that can never be met: 23
warnings:                           57
```

It was 12,058 elements until a `<select>`'s nested `<item>`s started being read (see above) —
2,258 of them, synthesized from inline text rather than an `<element>` tag, and every other
number here held exactly still: same 0 errors, same 1 unresolved reference, same 23 unmeetable
requirements, same 57 warnings. None of the new elements carry a rule or a support tag, so
they had nothing to newly break.

It was 57 unresolved references when this document was first written. Two things changed.

**The generated-element overlay landed.** `packages/aurora-import/src/generated-elements.ts`
declares the 80 elements Aurora's app materializes — damage resistances, sizes, the six
ability bumps, twenty levels, the 5e baseline grants. That resolved 51 of the 57. The
`ID_SIZE_*` family was listed above as "genuine upstream typos" and that was **wrong**: every
one of a set of real saves has `ID_SIZE_MEDIUM` in its `<sum>` block, which is Aurora's own
record of a derivation it performed. They are generated, not missing.

> **Note, 2026-09-23:** re-derived from the samples, every one of the 30 has a size in its `<sum>` (28
> `ID_SIZE_MEDIUM`, 2 `ID_SIZE_SMALL`), so "every one … has `ID_SIZE_MEDIUM`" is 28 of 30 and the rest are
> Small; the conclusion, that Aurora derives them, is unchanged.

**Grant references and requirement references are now counted separately**, because they fail
differently. A `<grant>` to an id nothing declares is broken content: a character silently
loses something. A `requirements="…"` naming an id nothing declares is a membership test that
reads false, and `!ID_X` against an id that will never exist is ordinary content — eighteen of
the twenty-three are the 2024 rules saying "unless the replacement feature is in play". Only
the first kind is budgeted in CI.

**A sixth thing the app generates, and this one is derived rather than listed** — ADR 0035. Every
class's `Ability Score Improvement` feature declares a `<select supports="Improvement
Option,Fighter,4">` per level and no file declares what it offers: 73 (class, level) pairs across
14 classes, and the Artificers are the only ones written out. A set of real saves record what the app
generated for them (`ID_INTERNAL_CLASS_FEATURE_{ASI|FEAT}_{level}_{CLASS}`), so
`improvement-options.ts` derives the same two elements per pair from whatever content is loaded.
That is 146 of the 229. The count above was 83 until that landed; nothing that comes from a file
moved.

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

### Two things the format does not tell you

`<multiclass id="ID_WOTC_PHB_MULTICLASS_ROGUE">` declares an id that other content references
(`requirements="!ID_WOTC_PHB_MULTICLASS_ROGUE"`), but nothing in the XML ever declares an
*element* with that id — Aurora's app creates one when you multiclass. The importer synthesizes
it (type `Multiclass`), which resolved 24 dangling references in `core.index` alone.

A `<select type="List">`'s `<item>`s are the same move for a different reason: nothing is
*missing* here, the text is right there in the file, but there is still no `<element>` for it
to become a candidate — Aurora's app reads the `<item>`s itself and Incudo has to too. Same
fix, same shape: mint a deterministic id and synthesize an element, so the format's own
`<select>`/`Choice` machinery needs nothing new. Expect more undocumented app-side behaviour of
this kind; the way to find it is to keep loading the whole corpus and counting what it contains.
