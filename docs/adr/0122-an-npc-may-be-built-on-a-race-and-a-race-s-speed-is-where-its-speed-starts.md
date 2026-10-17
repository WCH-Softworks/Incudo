# 0122 — An NPC may be built on a race, and a race's speed is where its speed starts

**Status:** Accepted · 2026-10-17 · the maintainer's ruling ("NPCs can be any race") · builds on
[0057](./0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md),
[0059](./0059-a-stat-may-start-where-another-stat-is-and-a-typed-value-replaces-it.md),
[0062](./0062-an-npc-s-other-speeds-saves-and-skills-are-its-creature-s-rules-and-its-senses-are-what-it-prints.md),
[0068](./0068-a-character-may-keep-content-beside-it-as-a-reference-shown-and-embedded-and-never-held.md),
[0071](./0071-an-element-s-own-requirements-hold-it-as-well-as-offer-it-and-a-granted-element-they-rule-out-is-withdrawn.md),
[0121](./0121-an-npc-serves-as-a-sidekick-and-the-sidekick-kind-is-removed.md) ·
**format:** none (a change to `systems/dnd5e/system.json` only; no system or character format change, no engine change)

## Context

A UX pass found a DM searching the NPC's creatures for "goblin" and finding nothing. The official content writes 141
creatures as data (`Companion` elements), every one a beast, a familiar or a class summon; the Monster Manual's monsters
exist only as prose stat blocks an NPC can keep for reference (ADR 0068). So a goblin, an elf guard or a human bandit
captain could only be built from nothing: every score, the speed, the senses and the languages typed or written by hand,
though the race that says all of it is loaded. ADR 0121 made the NPC the sidekick too, and a sidekick made from a
humanoid needs the same thing. The maintainer's ruling: an NPC can be any race.

**Measured first** (`tools/verify/src/npc-races.test.ts`, AuroraLegacy at `c28ce6c`). Each of the 139 races was built as
an NPC and as a level 1 player character, every score 10 and its first subrace taken:

- **What a race gives.** Stat rules on the six scores, on `innate speed` (all 139) and the other innate speeds, and on
  per-feature numbers (a breath weapon's DC and dice, a trait's range). Elements: 481 racial traits, 194 languages, 111
  sizes, 66 proficiencies, 64 visions, 38 conditions (resistances), 25 spells, 15 subraces (and 137 internal `Grants`).
  Decisions it opens: languages (87), ability score increases (85, the Half-Elf's and Tasha's custom ones), racial traits
  (65, a subrace's own or a draconic ancestry), proficiencies (37), race variants (4), spells (3, the High Elf's cantrip),
  feats (2, the Variant Human's).
- **What an NPC already did with one.** A race recorded on an NPC was derived in full before this: the engine seeds any
  recorded choice, so its increases added to the scores, its traits, languages, proficiencies and resistances were held
  and listed under the NPC's Feats and Features and Proficiencies and Conditions, and its selects opened. Nothing offered
  one. What was lost: its **speed** (the NPC's speed starts from `companion:speed`, which no race writes, so a dwarf read
  0), its **vision** (the NPC's Senses printed only the creature's prose), and **the race, subrace and size** themselves
  (no section listed those types).
- **What still reads differently** from a player character on the same race, every score at 10: per-level numbers. A
  Dragonborn's breath weapon dice (7 races) and the Hill Dwarf's Dwarven Toughness (2) read the character's `level`, and an
  NPC has a challenge rating, not a level, so they read 0. Also one shifting trait's temporary hit points, one Aasimar's
  healing, one mind link's range. Natural armour (12 races write `ac:calculation`) is not read either: the NPC's armour
  class is printed or typed.
- **A race and a creature together**: 0 of the 117 creatures a fresh NPC is offered print a humanoid type, so the two meet
  only when a DM puts them together on purpose (an awakened beast, a user's own humanoid creature).

## Decision

1. **5e's NPC (and so the legendary creature, which repeats its steps and sheet) has a Race step beside the Creature
   step**: a `pick` that is not required (ADR 0068), types `Race` only, as the player character's. A subrace, variant,
   language, cantrip or increase is the race's own select, opened by content and offered as on a player character.
   Neither step is required: an NPC may be a creature, a race, both, or neither.
2. **A race's increases add to whatever the score starts at**: the creature's print, or the DM's typed score. That is the
   engine's ordinary order (ADR 0059: starts, then contributions), so nothing new decides it.
3. **A race's speed is where the NPC's speed starts**, as a creature's is. The kind contributes `innate speed +
   innate speed:misc` to `companion:speed` (and the same for burrow, climb, fly and swim), gated on
   `[type:race],![type:companion]`: only when the NPC holds a race and no creature. `speed` already `startsFrom`
   `companion:speed`, so a typed speed replaces the race's, the build step shows it faded as it shows a creature's, and the
   sheet's other speeds appear when the race has one. The first term keeps a creature-less, race-less NPC exactly as it was
   (a contribution of 0 would still count as a start, and the entry step would read speed as set); the second is decision
   4. Written through `companion:` because that is the one stat the NPC's speed starts from; the kind already writes
   `companion:proficiency` (ADR 0062). No engine change: a list of stats a start may come from was the alternative, and a
   gate does it with what exists.
4. **With a creature as well, the creature's speed is used and the race's is not**: both state where speed starts, and a
   start is not a sum (ADR 0059). The race's increases still add to the creature's printed scores, and everything it grants
   is held. Not refused: the official content never puts the two together, a DM who does means it, and a refusal would need
   a step that knows about another step, which the format does not have.
5. **The sheet names what the race is and sees**: the Creature section lists `Race`, `Sub Race`, `Race Variant` and `Size`
   after the creature, and Senses lists `Vision` elements (as the player character's does), with each vision's text
   ("Darkvision: You can see in dim light within 60 feet…").
6. **The NPC's proficiency bonus still follows its challenge rating** (ADR 0060). A race-built NPC with no rating has +2.
   Per-level numbers a race writes read the character's level, which an NPC does not have, and read 0: the DM writes a
   feature of the NPC's own or types the number. Natural armour is the DM's to type, as every NPC armour class is.
7. **The build steps' descriptions and the faded-number hint name the race** ("what the creature or its race states").

## Consequences

- A DM picks Dwarf, then Hill Dwarf, types armour class and hit points, and has a stat block with Constitution and Wisdom
  increased, Speed 25, Darkvision, Medium, its resistance, weapon proficiencies and languages; saved and reopened with no
  source it reads the same (the save embeds the race like any held element). The test holds this for every race content
  offers, against any corpus.
- No player character moves (the change is in the NPC kind only), and the oracle is identical: no sample is an NPC.
- What is not done: per-level racial numbers on an NPC; a race's natural armour; a race's `speed:misc` contributions
  (the player character adds them after its innate speed, the NPC's speed never read them, before or after this); a
  creature type line for a race-built NPC (content gives races no type setter). The legendary creature inherits all of it.
- A Monster Manual humanoid is still prose: its NPC is the race, with the stat block kept beside it for reference (ADR
  0068) and its armour class, hit points and actions typed or written from it.
