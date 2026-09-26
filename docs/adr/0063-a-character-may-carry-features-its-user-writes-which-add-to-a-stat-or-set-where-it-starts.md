# 0063 — A character may carry features its user writes, which add to a stat or set where it starts

**Status:** Accepted · 2026-09-26 · builds on [0006](./0006-derived-character-state.md), [0012](./0012-self-contained-saves.md),
[0014](./0014-base-stats-are-inputs.md), [0022](./0022-kinds-contribute-systems-do-not-ship-content.md),
[0057](./0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md),
[0059](./0059-a-stat-may-start-where-another-stat-is-and-a-typed-value-replaces-it.md),
[0060](./0060-a-character-may-leave-its-progression-to-what-it-chose-and-that-is-format-3.md) · **format:** an optional
`customFeatures` on a character, `formatVersion` **4** when present; an optional `customFeatures` on a character kind in the
system format (`formatVersion` stays 1)

## Context

Since ADR 0059 a DM who wants an NPC faster than its creature types a number: Speed 60 replaces the Wolf's 40. The
number is right, and it carries no reason. The sheet says 60, the save says 60, and nothing says why, which is the
thing a DM reading the NPC back a month later needs. The request that led here: give the NPC a feature of its own,
call it "Godspeed", pick the stat it changes, and set the value.

A creature's features are content: elements a source declares, which a save embeds (ADR 0012). A feature the DM
writes for one NPC is not in any source. ROADMAP Phase 8 is the in-app element editor, for homebrew that belongs in a
source and is reused; this is smaller, and is the character's own.

Two things a feature can mean for a stat, and a DM needs both: **add** ("+10 to walking speed", as any content adds)
and **set** ("its walking speed is 60", whatever the creature prints). The engine already has the second's shape: a
stat *starts* at a declared default, at another stat content contributes to (ADR 0059), at what a held element
prints (ADR 0057), or at a value the user typed (ADR 0014), and everything contributed adds to whichever start is in
force.

## Decision

### 1. A character records the features its user wrote, and only format 4 does

`Character.customFeatures` is a list of `{ id, name, description?, stats: [{ stat, mode, value }] }`, `mode` being
`add` or `set` and `value` a number. It is an input with no formula, in the family of `baseStats` and `inventory`
(ADR 0006): nothing derives that a DM wrote Godspeed. Absent when empty. A character that records one is
`formatVersion` 4 (`raiseFormatVersion`), and only such a character: a reader of 3 would drop the feature, and the
NPC it reopened would be slower without a word, which is the failure the number exists to prevent (ADR 0060's
reasoning). The validator refuses the field below 4.

It lives in `character.json`, not `content.json`. Content is what sources declare and a save copies so it opens
without them; a feature the user wrote is not a copy of anything, and a refresh against newer content must never
touch it. The save is exactly as self-contained as before, because the character carries it.

### 2. A kind says whether its characters may carry one, and as what type

A character kind may declare `customFeatures: { "type": "…" }`, replaced rather than merged along `extends`. A kind
that declares none carries none: a feature on such a character is reported and does nothing. The type is what the
feature is held as: 5e's `npc` says `Companion Trait`, so Godspeed is listed on the sheet among the creature's own
traits, and `legendary` inherits it. The player character declares none (below).

### 3. A feature may name what the kind's sheet shows

`customFeatureStats(kind)` (`packages/core/src/custom-features.ts`): the stats the kind's **sheet** shows, in its
order, grouped by its sections, once each; not the progression's own stat (a challenge rating is set where ADR 0060
says), not a stat whose value is text, and not a section rendered per block. What a DM means by "this creature is
faster" is a number the stat block shows. A stat that `derive`s may be added to and **not set**: the engine adds a
derivation on top of any start, so "Perception is 7" would read 7 plus the Wisdom modifier. A line naming a stat
outside the list, or setting one that derives, is reported (`custom-feature-stat`) and contributes nothing, rather
than guessed at (ADR 0005). Two stats sharing a label (an ability and its saving throw, both "Strength") are named
with their section wherever a sentence names one alone ("Strength (Saving Throws)"), and the picker groups them
under the sections. Core names no stat; the list is whatever the system's sheet declares.

*First written as "every stat the kind declares with a label". Running it offered an NPC 55 stats, among them Armor,
Shield, Primary Hand, Caster Level and nine rows of spell slots (the system declares them for every kind), and
"Strength" twice. The sheet is the kind's own statement of what matters to a reader, and gives 39, all of them the
stat block's.*

**Amended the same day: never the ability scores.** A kind may declare `customFeatures.sections`, the sheet sections by
id whose stats a feature may name (absent means every section; a name that is no section of the sheet is refused when
the system loads). 5e's NPC names the stat block, other speeds, saving throws, skills and senses, and not Ability
Scores, and so would any kind 5e gives features to: the scores are the character's own inputs with an editor of their
own, and a feature is for the rest of the stat block. A line on a score the kind leaves out is reported and does
nothing, like any stat off the list.

### 4. Add is a rule on the feature; set is where the stat starts

The feature is held as an element of the kind's type, id `custom:<id>`, and the derivation seeds it as it seeds a
choice. Its **add** lines are its rules: unbucketed stat contributions, applied like any content's. Its **set** lines
are starts, and the order of starts, most general first, becomes:

`default` → `startsFrom` (ADR 0059) → a held element's printed setter (ADR 0057) → **a custom feature's set** → the
user's typed base (ADR 0014)

A set replaces what the creature states; content the character holds still adds to it (boots that add 10 feet add to
Godspeed's 60), as content adds to every other start. Two features setting one stat: the first in the character's
list is used and the rest are reported (`custom-feature-conflict`). A set is published in
`DerivedCharacter.starts` like any other start, with the feature's name, so the entry step's faded value is
Godspeed's 60 and says whose it is.

### 5. A typed value still wins, and says what it replaced

Typing stays: it is how a DM copies a printed stat block quickly, and a feature is for when there is a reason worth
naming. A typed base replaces a set exactly as it replaces a creature's print, and because the DM wrote both, the
derivation says so: `custom-feature-replaced`, "Godspeed sets Speed to 60, and the 40 entered for Speed replaces it."
The builder shows the same on the feature's line, and clearing the typed value brings the feature's back.

## What this does not do

- **A feature is one character's.** Reusing Godspeed on another NPC means writing it again. A library of the user's
  own features is ROADMAP Phase 8, and the shape here is an element's on purpose, so moving one there is a copy.
- **The player character carries none.** First written because a set on a player character's ability scores would
  always be replaced by the typed base; the scores are out of reach now for every kind (decision 3's amendment), and
  what is left is smaller: a player character's armour class, hit points and speed are worked out (each `derive`s from
  armour, hit dice and content), so under decision 3 every line on one could only add. Whether add-only features are
  what a player character wants, and the type they are held as, are the open questions; one line in `system.json` once
  they are decided.
- **No conditions, grants or choices.** A line is a number added or set, always in force. "Only while raging", a
  granted spell or a feature that opens a choice is content, and content is Phase 8's.
- **No text stats.** A stat whose value is text (a creature's size) cannot be named.
- **The description is not on the sheet.** The sheet lists a trait by name, the creature's and the DM's alike.

## Alternatives considered

- **`overrides`.** Wins over everything, including what content adds, and is ADR 0006's repair tool for broken
  content. A DM's Godspeed is not a repair, and boots of speed should still add to it.
- **Add only.** No new start, and the DM works out +20 from the creature's 40, which is wrong the moment the creature
  changes. A set says what the DM meant.
- **Store the feature in `content.json` as an element.** It would be embedded content the character chose, and
  embedded content is a copy of a source's: refreshing against newer content, or a collection that walks from the
  choices, could drop or replace it. It is the user's input and belongs with the other inputs.
- **Remove typing for the three stats of ADR 0059's step and go through features only.** Consistent, and slow for
  the common case of copying a printed stat block; the conflict is reported instead.
- **A homebrew source now.** Reusable, and most of Phase 8's editor, validation and export; this is the part a DM
  needs while building one NPC.

## Evidence

- `packages/core/src/custom-features.test.ts`, over a fixture with no game in it: a feature is held as the kind's
  type and its adds add; a set replaces a `startsFrom` start and a printed setter and content adds to it; a typed base
  replaces a set and is reported; the first of two sets is used and the second reported; a stat off the sheet, a text
  stat, the progression's stat and a set on a derived stat do nothing and are reported; a kind without the
  declaration holds none; the character is raised to 4; a description is escaped; two stats sharing a label are told
  apart. Each names the perturbation that fails it, and each was run: sets not applied, `startsFrom` over a set, the
  start not naming its feature, the replacement unreported, features not seeded, a derived stat settable, the later
  set winning, the progression's stat offered, the description passed as markup, the kind ignored, the format not
  raised, the bare label, the sheet not the source.
- `packages/ui/src/custom-features.test.ts`: the builder writes, renames in place and removes features; each line's
  status and sentence (applied, replaced, overruled, add-only); the entry step's row names the feature and says when a
  typed value replaces it; a new line starts at the stat's current number; a kind without the declaration refuses; the
  feature is not embedded content and derives the same with no source. Perturbed: the line statuses, the row's note,
  the builder's refusal.
- `tools/verify/src/schemas.test.ts`: format 4 with features validates; features at 3, two with one id, and a line
  with an unknown mode are refused; 5 is refused.
- `tools/verify/src/npc-creatures.test.ts`, over every creature in the current corpus (141 at `c28ce6c`): a feature
  sets the walking speed to 60 and adds 10 to each of the creature's other speeds (93); each reads as written, the
  feature is held as a `Companion Trait`, no problem is reported, the save reopened with no source derives the same,
  and a typed 45 replaces the set with the problem and the line's status. Fails with the 5e declaration removed.
- The oracle's thirty-sample table is identical before and after (`INCUDO_ORACLE_SNAPSHOT` on the base,
  `INCUDO_ORACLE_BASELINE` on the change): no player character derivation moved, as expected with `pc` declaring none.
- Driven in the browser build (not the Tauri window, macOS or Linux): a Wolf NPC given "Godspeed", which sets Speed;
  choosing Speed offered the Wolf's 40, and 60 was typed. The sheet read Speed 60 with Godspeed among its traits; the
  entry step said "Godspeed sets this to 60"; typing 45 there made the step, the feature's line and Problems each say
  what replaced what, and clearing it gave 60 back. Saved to the library and reopened with the content source switched
  off, the sheet and the editor were the same. Running it is what found the stat list of decision 3.
