# 0062 — An NPC's other speeds, saves and skills are its creature's rules, and its senses are what it prints

**Status:** Accepted · 2026-09-26 · closes the last gap [0057](./0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md),
[0058](./0058-a-setter-may-name-elements-its-holder-has-and-the-kind-says-which.md) and
[0059](./0059-a-stat-may-start-where-another-stat-is-and-a-typed-value-replaces-it.md) named · builds on
[0003](./0003-system-agnostic-content-model.md), [0005](./0005-aurora-import.md), [0006](./0006-derived-character-state.md),
[0012](./0012-self-contained-saves.md), [0020](./0020-stats-keyed-on-declared-blocks.md),
[0022](./0022-kinds-contribute-systems-do-not-ship-content.md) · **format:** three optional fields on a sheet section in the
system format, `showWhen`, `printed` and `description` (`formatVersion` stays 1); no character format change

## Context

ADRs 0057 to 0061 made an NPC start where its creature's stat block puts it: six scores, challenge rating, armour
class, hit points, walking speed, traits, actions and reactions. Each of the three ADRs closed with the same gap:
**speeds other than walking, senses, skills and saving throws are not on an NPC's sheet.** The rules for some of them
exist (`companion:speed:fly`, `companion:perception:proficiency`) and nothing published them under an NPC's names.

### What the corpus holds

Measured on AuroraLegacy/elements at `c28ce6c`, the 141 `Companion` elements, with a throwaway script (not committed).
A creature states a number a second time as its own rules in a `companion:` namespace, and prints its stat block as
setters that are display text:

| | own rules | creatures | printed setter | creatures |
|---|---|---|---|---|
| walking speed | `companion:speed` | 141 | `speed` ("30 ft., climb 30 ft.") | 141 |
| other speeds | `companion:speed:fly` / `climb` / `swim` / `burrow` | 43 / 23 / 22 / 5 | the same `speed` text | |
| skill proficiencies | `companion:<skill>:proficiency` | 77 | `skills` ("Athletics +5, Perception +3") | 76 |
| saving throw proficiencies | `companion:<ability>:save:proficiency` | 16 | `saves` ("Dex +4, Con +4") | 20 |
| senses | **none** | 0 | `senses` ("darkvision 60 ft., passive Perception 12") | 113 |
| languages | none | 0 | `languages` | 141 |
| damage and condition defences | none | 0 | `immunities` 25, `damage immunities` 3, `resistances` 10, `damage resistances` 1, `vulnerabilities` 2, `conditionImmunities` 18, `condition immunities` 3 | |

- **A skill or save proficiency is written against a stat the creature does not have.** 143 of the skill rules and
  30 of the save rules are `value="companion:proficiency"`, most in the `base` bucket, with a second
  `bonus="double"` rule for expertise (24). `companion:proficiency` is supplied from outside: 12 class summons
  contribute it themselves, from their summoner's `proficiency`, and eight of those also contribute `-2` in a bucket of
  its own named "base companion PB removal"; a player character's class feature supplies it for the companion it
  summons. No other creature supplies it, so for those it is Aurora's app that does, and the removal of 2 is what makes
  sense of that: the app's own 2 is unbucketed, and the summon's rule swaps it for the summoner's bonus.
- **Senses are prose only.** No rule anywhere states darkvision, blindsight or a passive Perception for a creature.
  Nine setters with two spellings each for three of them (`immunities` and `damage immunities`, `resistances` and
  `damage resistances`, `conditionImmunities` and `condition immunities`) carry the rest, with text such as
  "determined by the drake's Draconic Essence trait" and "passive Perception 12 + (PB × 2)".
- **The rules agree with the print where both exist.** Derived through the kind below and compared with the print
  (parsed only by the test that counts): other speeds 91 agree, 0 differ; skills 113 agree, 1 differs (a UA Wildfire
  Spirit's `companion:nature:misc`, below); saving throws 8 agree, 2 differ (the 2025 Cat and Goat print a save they
  state no rule for); passive Perception, 10 plus the Perception derived here, 70 agree and 13 differ, 8 of them class
  summons whose print leaves out the summoner's bonus and 5 where the print and the creature's own rules disagree.
- **A player character's content uses the same names without the prefix**: `speed:fly` 10 times, `speed:climb` 14,
  `speed:swim` 21, `speed:burrow` 4, `<ability>:save:misc` 18 each, `perception:passive` 2, `perception:proficiency` 2.

## Decision

### 1. The creature's proficiency bonus is the NPC's, and the kind says so

The `npc` kind contributes `companion:proficiency` = `proficiency`, the NPC's own bonus from its challenge rating,
**unbucketed** (ADR 0022's `contributions`). That is the one stat in the `companion:` namespace the kind writes, and it
is an input the creature's own rules read, not something the NPC publishes: ADR 0057's "an NPC is not someone's
companion" is about names on the sheet, and every name on the sheet is the NPC's own (decision 2). Unbucketed because
the class summons' "-2" says Aurora's own value is: in the `base` bucket it and a summon's `base` contribution would be
one bonus, and the removal would leave a Steel Defender proficient in nothing (measured: both Steel Defenders' five
proficiencies read 0). Unbucketed, a class summon built as an NPC reads its proficiencies at its own bonus of +2.

### 2. Each is published under the name a character's content uses, starting where the creature's rule is

On the `npc` kind (inherited by `legendary`), in `systems/dnd5e/system.json`, with no engine change:

- `speed:burrow`, `speed:climb`, `speed:fly`, `speed:swim`: `default: 0`, `startsFrom` the creature's
  `companion:speed:<mode>` (ADR 0059).
- `<ability>:save:proficiency` and `<skill>:proficiency`: `default: 0`, `startsFrom` the creature's
  `companion:<name>:proficiency`. What a 2024 Primal Companion's bond grants (proficiency in every save and skill) is
  collected with the creature's own, since it is contributed to the same stats.
- `<ability>:save` = `<ability>:modifier` + `<ability>:save:proficiency` + `<ability>:save:misc`, and `<skill>` =
  its ability's modifier + `<skill>:proficiency` + `<skill>:misc`, for the six abilities and the eighteen skills.
- `perception:passive` = 10 + `perception`.

The name is the creature's rule's name without `companion:`, which is also the name a player character's content
uses, so an item or a feat an NPC holds that adds to `speed:fly` or `perception:misc` adds to the same stat. A value
typed as a base **replaces** the creature's rather than adding to it, as ADR 0059 decided for the walking speed: a
`perception:proficiency` of 0 takes the creature's proficiency away.

### 3. A sheet section may show only the rows that apply, and text a held element prints

Three optional fields on a sheet section, all read by `renderSheetSection` in core so that no shell decides it:

- `showWhen`: a row of `stats` is shown only when this stat reads other than zero, `{stat}` standing for the row. The
  NPC's Other Speeds section is `"{stat}"` (a creature with no fly speed shows none) and its Saving Throws and Skills
  are `"{stat}:proficiency"`, which is how a printed stat block lists them. A section with nothing to show is not drawn.
- `printed`: `{ types, setter, label }` entries; for each held element of those types that carries the setter (matched
  ignoring case), a line with the label and the text **as written**. The NPC's Senses section prints the creature's
  `senses` beside the derived passive Perception, and a Defences and Languages section prints the rest, both
  spellings of each.
- `description`: a sentence under the label. The printed sections say the text is the creature's print, and the
  Saving Throws and Skills sections say that any other is the ability modifier.

`renderSheetSection` takes the character as a `SheetReader` (a stat's value and the held elements) as a third
argument. The text comes from the element the save embeds (ADR 0012), so it is there with no source enabled.

## What this does not do

- **Senses are not modelled.** Darkvision, blindsight, tremorsense and truesight are text; the passive Perception
  derived beside them follows the scores and the print does not, so a DM who raises Wisdom sees the two differ.
  Parsing "darkvision 60 ft." into a number is the guess ADR 0005 declines; content that states a sense as a rule is
  what would change it.
- **No editor for any of these.** The walking speed has one (ADR 0059's step); another speed, a proficiency or a save
  can be typed only by something that writes a base, which the builder offers nowhere yet. An NPC from nothing has no
  other speed and no proficiency. The stats start where a typed base would replace them, so an editor needs no change
  to the kind.
  *(Since [ADR 0063](./0063-a-character-may-carry-features-its-user-writes-which-add-to-a-stat-or-set-where-it-starts.md) a
  feature the DM writes can set another speed and add to a save or a skill, with its reason on the sheet. A proficiency
  still cannot be switched on, since `…:proficiency` is not a stat the sheet shows.)*
- **Hovering** ("fly 60 ft. (hover)") is in the print only, and the NPC's fly speed does not say it.
- **Rules nothing reads, reported**: `companion:<name>:misc` (one UA Wildfire Spirit's Nature, and three saves its
  Soul Bond trait adds), `companion:initiative` (1; the NPC's initiative is the system's Dexterity modifier), and the
  upstream typo `companion:stealths:proficiency` (1). The Wildfire Spirit's Nature is therefore one short of its print.
- **The 2 saves printed with no rule** (the 2025 Cat and Goat) and the 5 passive Perceptions where the print and the
  rules disagree are upstream's, read as the rules state them.
- **The printed `proficiency` setter** (45 creatures) is not read; the NPC's bonus is its challenge rating's.
- **The player character's sheet is unchanged**: it still lists skills and saves as the proficiency elements it holds.

## Alternatives considered

- **Publish the `companion:*` stats on the NPC's sheet as they are.** ADR 0057 declined the namespace for anything
  the sheet names, and content written for a character (`speed:fly` on an item) would land on a different stat.
- **A kind-level alias**, "read `companion:X` as `X`", in the engine. It would do what `startsFrom` already does for
  each stat, as a second mechanism, and could not say that a typed value replaces.
- **Contribute `companion:proficiency` in the `base` bucket**, content's usual bucket for it. Measured: it zeroes
  every proficiency of both Steel Defenders, because their own `-2` then removes the only bonus there is. It agrees
  with 6 more printed passive Perceptions, all class summons whose print omits the summoner's bonus.
- **Every skill and save on the sheet**, with no `showWhen`. Correct numbers, and not a stat block: eighteen skills on
  a Cat. A DM who needs an unlisted one has its ability modifier on the same sheet.
- **Parse the printed `senses`, `skills` and `saves`.** Content states skills and saves as rules, and the rules and the
  print agree almost everywhere; for senses there is nothing else, and a parser would be a guess about prose (ADR 0005).
- **Show the printed text through a `candidateNotes`-like list on the kind** rather than on a sheet section. Where the
  text appears is a sheet's business, and a sheet section already says what it lists.

## Evidence

- `tools/verify/src/npc-creatures.test.ts`, over every creature in the current corpus, found by type: every
  `companion:<name>` a creature states reads the same as the NPC's `<name>` wherever the kind declares a start for it,
  a stat nothing states reads 0, and a proficiency the creature writes against `companion:proficiency` is at least the
  NPC's bonus (fails with the contribution removed, with a `startsFrom` pointed elsewhere, or with a skill's
  derivation not reading its proficiency); the print compared (reported, "mostly agrees" asserted; fails with the
  contribution removed); each section shows exactly the rows the NPC holds and each printed line the setter's text,
  an NPC from nothing shows none of them, and a legendary creature shows an NPC's (fails with a `showWhen` removed,
  with `{stat}` not substituted, or with `printed` reading nothing); a typed speed replaces the creature's, a typed
  proficiency of 0 removes one from the sheet, and the save reopened with no source renders the same sheet (fails if a
  typed value adds). Each perturbation was run and fails.
- `packages/core/src/system.test.ts`: `showWhen` with `{stat}` and with a block placeholder, `printed` by type and
  ignoring case and never empty, and an empty section, each with the perturbation that fails it.
- The thirty sample saves' oracle table is identical before and after (`INCUDO_ORACLE_SNAPSHOT` on the base,
  `INCUDO_ORACLE_BASELINE` on the change): no player character derivation moved.
- Driven in the browser build (not the Tauri window, macOS or Linux): a Monster Manual Imp's sheet shows Fly 40,
  Deception 4, Insight 3, Persuasion 4, Stealth 5, passive Perception 11, its printed senses, resistances, immunities
  and languages; a Puppeteer Parasite's shows its Dexterity, Constitution and Wisdom saves (4, 6, 2). The Imp saved to
  the library and reopened with the content source switched off shows the same sheet.
