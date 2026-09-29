# 0074 — A kind's sheet shows its printed page, and every row says what it is

**Status:** Accepted · 2026-09-29 · answers the roadmap's "Kind-specific sheets and exports", and moves its exports to
Phase 5 · builds on [0003](./0003-system-agnostic-content-model.md), [0009](./0009-character-kinds.md),
[0018](./0018-tables-and-track-stats.md), [0020](./0020-stats-keyed-on-declared-blocks.md),
[0041](./0041-aurora-records-a-slot-row-per-block-and-the-shared-caster-level-once.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0062](./0062-an-npc-s-other-speeds-saves-and-skills-are-its-creature-s-rules-and-its-senses-are-what-it-prints.md),
[0073](./0073-a-creature-a-character-holds-is-derived-one-at-a-time-in-its-holder-s-namespace-and-shown-as-its-own-stat-block.md) ·
**format:** three optional fields in the system format, `signed` on a stat, `label` on a `blockStats` entry and `beside`
on a sheet section (`formatVersion` stays 1); no character format change

## Context

Phase 4's last buildable item was one line, "Kind-specific sheets and exports", with nothing measured behind it. Every
kind already renders its sheet from its own `kind.sheet` through core's `renderSheetSection` (ADR 0009, 0020, 0062), so
"kind-specific" had to mean something other than "each kind has a sheet": that was true before this.

### What each kind's sheet shows

Measured by `tools/verify/src/kind-sheets.test.ts` on AuroraLegacy/elements at `c28ce6c`, reading the sheet the way the
Sheet pane drew it (a row labelled by its stat's label, else by its key; a per-block row by its key; its value the
stat's text or number, else "—"), reported as `ℹ` lines and asserting nothing (ADR 0042).

**The player character, over the thirty samples.**

| | |
|---|---|
| the Spell Slots section reading nothing but 0 | **23 of 30**: the 10 that cast nothing, and **all 13 single-class casters** |
| rows shown by an internal key | the two spellcasting rows of **every casting block**, 29 blocks in 20 samples: "wizard:spellcasting:dc" on screen |
| skill proficiencies the derivation holds (non-zero `<skill>:proficiency`) | **153**, 10 of them doubled (expertise), and 12 half-proficiency bonuses (`<skill>:misc`, Jack of All Trades) |
| saving throw proficiencies it holds | **60** |
| rows showing a saving throw, a skill, passive Perception or an ability modifier | **0**: nothing declares their totals for a player character, and no section names them |
| held elements no section lists | Race 30, Class 40, Archetype 39, Background 30, Sub Race 5, Vision 5, beside what is internal (Grants 350, Level 179, Option 48, …) |

The Spell Slots section read `spellcasting:slots:1` to `:9`, the multiclass table ADR 0018 derives from the shared
caster level. A single-class caster has no shared caster level: its slots are its block's own table,
`wizard:spellcasting:slots:1`, which ADR 0041 found is what Aurora records per block. So a Wizard 5's sheet said it had
no spell slots, and no test saw it, because the oracle compares the stats and never the sheet.

Content already states everything the first page of the two-page sheet needs. A skill proficiency is a
`Proficiency` element's `<skill>:proficiency` rule (`bonus="proficiency"`), expertise a second one in `bonus="double"`,
Jack of All Trades a `<skill>:misc` of `proficiency:half` required on not being proficient, a saving throw proficiency
`<ability>:save:proficiency`, Observant a `perception:passive`. What was missing is the total each is part of, which the
NPC has declared since ADR 0062 and the player character never did.

**The NPC, over the 141 creatures.** Every creature prints `size`, `type`, `alignment`, `ac` ("13 (natural armor)") and
`hp` ("45 (6d10 + 12)") as setters, and no NPC section shows them: the stat block's first line and its hit dice. The
sheet named no creature either (the Creature and Companion types are listed by no section). An NPC's initiative is
declared, labelled and on no section. No section reads nothing but 0.

**Content's own sheet hints**, over the corpus. `<sheet>` is on 5,968 elements: `display="false"` on 1,779 (Archetype
Feature 363, Class Feature 252, Racial Trait 251, …), `alt` 1,014, `usage` 958, `action` 799, a sheet-only
`description` 4,433. The importer parses all of it into `Element.sheet`, and nothing reads it. On the samples every
character lists 2 to 12 elements content marks not for the sheet: Human, Spellcasting, Darkvision, Tough, Skill
Expertise (Stealth), Arcane Tradition.

**Cairn**, the one system that is not 5e, and the real test of "the engine names no kind". Its only kind draws a sheet
(STR, DEX, WIL, Hit Protection, Inventory Slots, every row labelled) from the same machinery. But its Abilities step
declares no budget, the shape ADR 0017 calls inert: it reports itself complete and nothing on the Build pane can set a
score, so every Cairn character reads 10, 10, 10 and 1. Its Background step cannot close either: no Cairn content exists.

**What the printed pages have.** The 5e two-page sheet's first page is the six scores with their modifiers, the six
saving throws and eighteen skills with proficiency marks, passive Perception, armour class, initiative, speed, hit points,
hit dice, and a header naming class and level, background, race and alignment; its third page is each casting class's
save DC, attack bonus and slots. A Monster Manual stat block opens with size, type and alignment, gives armour class and
hit points as printed (the dice with them), initiative (2024), the scores with modifiers, saves and skills with their
signs, and then senses, languages and the creature's features.

### Exports

Phase 5 is "Export & sharing": a PDF sheet, Markdown, a print layout. An export of a character is a rendering of its
sheet, so a kind-specific export is a kind-specific sheet written somewhere else. Building exports here would build
Phase 5 early and twice.

## Decision

### 1. Exports are Phase 5's; this item is the sheet

The roadmap item becomes **Kind-specific sheets**. Phase 5's exports render the same sheet view (decision 2), so an
NPC's Markdown is its stat block and a player character's PDF is its page, with nothing kind-specific of their own.

### 2. The sheet is a view-model, and the pane draws rows

`packages/ui/src/sheet.ts` turns a kind's sections and a derivation into what is drawn: sections with rows (a stat, its
label, its value as shown, and what is shown beside it), printed lines, and listed elements, empty sections left out.
The character's Sheet and each held creature's stat block (ADR 0073) are built by the same function, and the Sheet pane
computes nothing. Everything an export will need is in it, so Phase 5 starts from rows rather than from a component.

### 3. Every row says what it is

A row's label is its stat's `label`; **a per-block row's is its `blockStats` entry's `label`** (new, optional), so the
Wizard's block reads "Spell Save DC" and "Spell Attack Bonus". A row nothing labels still falls back to its key rather
than disappearing, because a user's system (ADR 0011) may have one; every shipped kind is held to having none by a test.

**A stat may be `signed`** (new, optional): a bonus is written with its sign, "+2", "+0", "-1", wherever it is shown.
It is display and evaluates nothing. **A section may say what is shown `beside` each row** (new, optional): a stat
template with `{stat}` for the row, as `showWhen` has (ADR 0062), so a score reads "18 (+4)". A `beside` key the kind
does not declare is refused by the validator, as a row's stat is.

### 4. 5e's player character shows its first page, and the slots it casts with

System definition changes only; no engine noun, no engine change.

- **Saving throws, skills and passive Perception** are declared on `pc` with the NPC's formulas (ADR 0062): the ability
  modifier, plus `…:proficiency`, plus `…:misc`, and 10 plus Perception, each `signed`. All six saves and all eighteen
  skills are rows, as on the printed page, not only the proficient ones. What content contributes to the totals
  (Observant's +5 to `perception:passive`, Jack of All Trades' `initiative`) adds as it always did.
- **The scores show their modifiers beside them**; modifiers, proficiency bonus and initiative are `signed`.
- **A Character section heads the sheet**, listing race, subrace, class, subclass, background, alignment and deity: what
  the printed header names.
- **Senses** shows passive Perception and the character's `Vision` elements (Darkvision).
- **Spellcasting rows are labelled** (decision 3), and **spell slots are the ones the character casts with**: the shared
  pool where there is one, and each block's own table where it casts from it, which is every block of a single-class
  caster and pact magic beside a pool. That is a per-block stat, `{name}:spellcasting:table:<n>`, the block's own slots
  times `{name}:spellcasting:table` (1 when there is no shared caster level or the block casts alone, `…:solo`, which
  only pact magic grants, else 0), shown only where it is not 0. The name stays out of `spellcasting:slots:*`, which a
  spell select's filter reads (ADR 0030) and the oracle's row count measures.

### 5. 5e's NPC shows its stat block's first line and its dice

- The header lists the creature it is built on, prints its **size, type and alignment**, and its **armour class and hit
  points as printed** beside the numbers the NPC derives, which a typed value may replace (ADR 0059); the printed hit
  points carry the dice. **Initiative** joins the header.
- The scores show their modifiers beside them; saves, skills, proficiency bonus and modifiers are `signed`. A held
  creature's stat block (ADR 0073) gets the same.

### 6. Cairn's abilities can be entered

Cairn's Abilities step becomes a budget over Strength, Dexterity and Willpower with one method, entry from 3 to 18, and
a Hit Protection step one from 1 to 6: a system definition change, as ADR 0057 made for the NPC. Rolling in order, which
is Cairn's rule, is not offered: the budget's roll method assigns what it rolls, and offering it would be a different
rule under the same name.

### 7. Content's sheet hints are reported, not read

`display="false"` is how Aurora's own sheet keeps Darkvision, Tough or a skill's expertise out of a feature list: it
showed each one's effect elsewhere, in a senses box, the hit points, a skill's mark. Honouring it here hides Darkvision
from a player character whose sheet had shown it nowhere else until decision 4, and still hides Tough, whose effect is a
number with no reason beside it. So the hint is left unread and measured, and reading it (with `alt`, `usage` and
`action`, which a play sheet wants) is its own decision once the sheet shows what each hidden element does.

## What this does not do

- **Mark which saves and skills are proficient.** The totals are right and every row is shown; which proficiency makes
  one is in the Proficiencies list. A mark needs a second value per row that is a flag, not a number.
- **Levels per class.** The header lists each class, and the Combat section the character's level; "Wizard 4 / Rogue 4"
  needs a section that iterates tracks, as `perBlock` iterates blocks.
- **Hit dice, death saves, inspiration, personality, attacks.** The first has no stat (hit points follow the method,
  ADR 0044); the rest are play-time state or text nothing records yet.
- **Referee a player character's saves and skills against Aurora.** Aurora's save records the companion's and never the
  character's, and the readout has none. They are content's rules summed by the NPC's formulas, checked by perturbation
  and by one sample worked by hand from its recorded scores and proficiencies. Never describe them as verified.
- **Parse a creature's printed armour class or hit points.** Shown as written beside the derived numbers (ADR 0005).
- **Read `<sheet>` hints** (decision 7), **exports** (Phase 5), **a layout per kind** (a stat block drawn as a stat
  block rather than as sections): the sections are what an export and a print layout will lay out.

## Alternatives considered

- **Build the exports here**, a Markdown writer per kind. It would be Phase 5 done before its "print layout" and "PDF"
  siblings, and would duplicate the sheet view's rows in a second renderer.
- **Show only the proficient saves and skills on a player character**, as the NPC does (`showWhen`). A stat block does
  that; the printed character sheet does not, and a player reading "Stealth" needs its number whether or not they are
  proficient.
- **Fix the slots by showing every block's own table.** Right for a single-class caster and wrong for every multiclass
  one: a Paladin 3 / Sorcerer 3 casts from a pool of 4 and 3, not from the paladin's 3 and the sorcerer's 4 and 2.
- **Refuse a sheet row with no label in the validator.** It would break a user's system that shows one today, for a
  cosmetic fault; the shipped systems are held to it by a test instead.
- **Show the modifiers as a section of their own.** The printed pages put a modifier beside its score, and a second
  list of six numbers under the first says less.
- **Honour `<sheet display="false">` now.** Decision 7.

## Evidence

- `tools/verify/src/kind-sheets.test.ts`: the measurement above, report-only, run on the base commit before anything
  changed.
