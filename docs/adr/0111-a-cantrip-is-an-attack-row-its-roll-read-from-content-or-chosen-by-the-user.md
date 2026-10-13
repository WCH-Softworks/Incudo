# 0111 — A cantrip is an attack row, its roll read from content or chosen by the user

**Status:** Accepted · 2026-10-13 · answers the cantrip part of ROADMAP Phase 4's "Attacks a character makes beyond a
weapon's single row" · amends [0093](./0093-an-attack-is-a-weapon-in-the-bag-and-the-kind-declares-what-it-adds-up.md),
[0110](./0110-a-kind-declares-attacks-no-item-gives-an-off-hand-row-and-a-melee-reach.md) · builds on
[0005](./0005-aurora-import.md), [0006](./0006-derived-character-state.md),
[0020](./0020-stats-keyed-on-declared-blocks.md), [0097](./0097-a-2024-half-caster-s-prepared-count-is-its-spell-picks-and-an-added-spell-is-cast-through-a-block-the-user-names.md) ·
**format:** the system format's `attacks` gains an optional `spells` (`formatVersion` stays 1); `Character.spellAttacks`,
character format **13**, only when recorded

## Context

The maintainer wants spells as attack rows before 1.0, and decided their shape on 2026-10-12 and 2026-10-13: **cantrips
only** (a levelled spell's dice change with its slot; after 1.0); attack or saving throw read from the spell's support
tags; the number of dice by character level, in the system definition; the die and damage type stated by content when it
states them, else chosen by the user and kept on the character, "none" allowed; Toll the Dead's two dice listed; the
save's ability chosen by the user; a cantrip no casting class holds is cast as a class the user picks, as an added spell
is (ADR 0097); and only a cantrip's regular scaling is modelled ("the system can't be too specific yet"). Measured first
(`tools/verify/src/cantrip-attacks.test.ts`, AuroraLegacy/elements at `c28ce6c`):

- **145 cantrips** (`level` 0), **51 tagged**: `Spell Attack` on 20, `Spell Saving Throw` on 31, none on both. Poison
  Spray is a save in 2014 and an attack in 2024, and the tags say so. 94 are not tagged: 40 UA Mystic disciplines, 7 UA
  alchemical formulas, utility spells, and a few that deal damage through a weapon attack or a buff (Booming Blade,
  Green-Flame Blade, Shillelagh, True Strike), which are not rows here.
- **No cantrip states its roll as a rule.** None carries a rule or a `<sheet>`; the die is only in the description
  ("1d10 fire damage … increases by 1d10 when you reach 5th level (2d10), 11th level (3d10), and 17th level (4d10)").
  `keywords` names a damage type on some (Fire Bolt: `fire`) but is a list of search words: absent on 11 of the 51,
  seven types on Sorcerous Burst, and "bright, dim, light, fire" on the 2024 Produce Flame. It is not read.
- **The save's ability is in no rule either**: the 2024 keywords name it on some (`dexterity, save`), the 2014 ones never.
- **The block.** A spell's DC and attack bonus are its casting block's stats (`{name}:spellcasting:dc`, `:attack`, ADR
  0020). 76 of the corpus's 129 cantrip selects attach to a block; 53 (High Elf, Magic Initiate, Wood Elf Magic, Aberrant
  Dragonmark and other feats and races) attach to none, so nothing publishes a number for what they pick. In the samples
  34 tagged cantrips are held: 30 through a block, 4 through none (two Toll the Dead, a Fire Bolt, a Sacred Flame).
- **Irregular scaling**: Eldritch Blast gains beams, not dice; Magic Stone never scales; Toll the Dead has two dice; Mind
  Sliver's d4 is a penalty, not damage. 47 of the 51 follow the book's table (1, 2, 3, 4 dice at levels 1, 5, 11, 17).

## Decision

### 1. `attacks.spells` declares which spells are rows and how they add up

```json
"spells": {
  "types": ["Spell"], "setter": "level", "values": ["0"],
  "attack": { "tag": "Spell Attack", "bonus": "{name}:spellcasting:attack" },
  "save": { "tag": "Spell Saving Throw", "dc": "{name}:spellcasting:dc" },
  "count": { "kind": "table", … },
  "dice": "damage", "damageType": "type", "range": "range",
  "sides": [4, 6, 8, 10, 12], "damageTypes": ["acid", …], "abilities": ["Strength", …]
}
```

A held element of `types` whose `setter` reads one of `values` and that carries the `attack` or the `save` tag is a row.
`{name}` in `bonus` and `dc` is the block's name (ADR 0020's placeholder). `count` is an expression read against the
character (5e: a table on `level`). `dice` and `damageType` name a setter and its attribute, as a weapon's do: **content
that states a die is read** (an Incudo-format spell written in a homebrew source, ADR 0108), and Aurora's spells state
none. A die written `d10` is rolled `count` times; one written in any other shape ("2d4+1") is written as it is, since
reading it would be parsing. `sides`, `damageTypes` and `abilities` are what the user is offered. Core names no game.

### 2. What the user chooses is an input on the character

`Character.spellAttacks`, keyed by element id: `{ sides?: number[], damageType?: string, ability?: string, block?: string }`.
`sides` is one die, or two (Toll the Dead: "2d8 or 2d12"), or `[]` for a cantrip that rolls nothing (Friends, Light,
Gust); absent, the row has no damage yet. `block` names the class it is cast as when no block holds it, as
`additionBlocks` does (ADR 0097), and replaces the block content gives otherwise. **Format 13**, only when recorded;
the validator refuses it below 13. It is an input in ADR 0006's sense: nothing works it out, and a save carries it.
A die content states wins over a chosen one, and the row says it is content's.

### 3. The engine publishes the rows

`deriveAttacks` appends one `DerivedAttack` per such cantrip after the bag's and the innate rows, with `spell: { kind:
'attack' | 'save', block?, dc?, ability?, chosen }`: the block attached by a grant or a recorded pick carrying a
`spellcasting` (every declared block, not only preparing ones), else the recorded one; the bonus or DC read from the
block's stat; the dice `count`×`d<sides>`. A cantrip cast through no block has no bonus or DC and says so. No damage
bonus is added: what adds to a cantrip's damage (Agonizing Blast, Potent Spellcasting) is a stat of its own name, not
read here.

### 4. Words and editing

`attackHead`/`attackAside` write "Fire Bolt: +5, 2d10 fire (range 120 feet)", "Sacred Flame: DC 13 Dexterity, 1d8
radiant (range 60 feet)", "Toll the Dead: DC 13 Wisdom, 1d8 or 1d12 necrotic", and with nothing chosen "Fire Bolt: +5
(its damage is chosen on Build)". Build gains a section listing each row with its die, type, ability and class, edited
through pure functions in `packages/ui`; the desktop and phone render it.

## Consequences

- Every character holding a tagged cantrip gains a row; every such export changes.
- **Eldritch Blast reads as more dice** (3d10 at level 11, not three 1d10 beams) and Magic Stone scales when it does not:
  only regular scaling is modelled, by the maintainer's call. The row is the user's to correct with "none".
- A cantrip held twice (two blocks) is one row, through the first block.

## Evidence

- **Core, no game** (`packages/core/src/spell-attacks.test.ts`): only a held spell of the setter value with a tag is a
  row; an attack reads its block's bonus, a save its DC, a spell no block holds neither; a chosen block replaces content's;
  the user's die rolled `count` times, a second die beside it, none rolls nothing; content's die wins; the format rises
  to 13 and an empty choice is forgotten. Each fails under the perturbation it names.
- **Words and the editor** (`packages/ui/src/spell-attacks.test.ts`): "+5", "DC 13 Grit", "—" and a note with no class,
  "1d8 or 1d12", "no damage"; a die, type, ability or class not offered is refused with a sentence.
- **The real corpus** (`tools/verify/src/cantrip-attacks.test.ts`): the measurement above; a Human Wizard 5's Fire Bolt
  "+6", then "2d10 fire" once d10 and fire are chosen, a d20 refused, the save valid at format 13 and reopened with no
  source to the same rows; a Cleric 1's Sacred Flame "DC 13 Dexterity, 1d8 radiant"; a High Elf Cleric's racial Fire Bolt
  "—" until cast as Cleric, then "+4". With 5e's declaration taken out they fail.
- **Driven in the browser build** (2026-10-13): a new Human Wizard took Fire Bolt and Acid Splash; Build's Spell attacks
  section chose d10 fire, and d6 acid with Dexterity (a second die tried and removed); at level 5 the Sheet read "Fire
  Bolt: +3, 2d10 fire (range 120 feet)" and "Acid Splash: DC 11 Dexterity, 2d6 acid (range 60 feet)", the same after a
  reload. Not the Tauri window or the phone.

## What this does not do

- Read prose or keywords (ADR 0005).
- Levelled spells (after 1.0), cantrips dealing damage through a weapon (Booming Blade), a cantrip's own damage bonuses.
