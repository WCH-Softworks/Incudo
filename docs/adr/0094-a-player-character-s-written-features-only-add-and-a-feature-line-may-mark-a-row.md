# 0094 — A player character's written features only add, and a feature line may mark a row

**Status:** Accepted · 2026-10-06 · answers ROADMAP Phase 4's "Written features for a player character, and an NPC's
proficiency switched on" · amends [0063](./0063-a-character-may-carry-features-its-user-writes-which-add-to-a-stat-or-set-where-it-starts.md)
and [0062](./0062-an-npc-s-other-speeds-saves-and-skills-are-its-creature-s-rules-and-its-senses-are-what-it-prints.md) ·
builds on [0005](./0005-aurora-import.md), [0059](./0059-a-stat-may-start-where-another-stat-is-and-a-typed-value-replaces-it.md),
[0060](./0060-a-character-may-leave-its-progression-to-what-it-chose-and-that-is-format-3.md),
[0065](./0065-legendary-content-is-content-of-the-types-the-system-declares-and-a-dm-may-write-it-on-the-creature.md),
[0071](./0071-an-element-s-own-requirements-hold-it-as-well-as-offer-it-and-a-granted-element-they-rule-out-is-withdrawn.md),
[0079](./0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md) ·
**format:** `mark` as a third mode of a custom feature line, character `formatVersion` **9** when one is recorded; an
optional `none` on a sheet section's `mark` in the system format (`formatVersion` stays 1)

## Context

Two gaps ADR 0063 left open.

**A player character carries no written features.** ADR 0063 gave the NPC "Godspeed: Speed 60" and declared nothing on
`pc`, because what a feature may name is what the kind's sheet shows, and a player character's armour class, hit points
and speed are worked out (armour, hit dice, content), so every line on one could only add. Whether add-only features are
what a player character wants, and the type they are held as, were left to the maintainer.

**A DM cannot make an NPC proficient in a save or skill its creature does not print.** Since ADR 0062 an NPC's
`<skill>:proficiency` and `<ability>:save:proficiency` start where its creature's own rule puts them, and a DM may type
one (ADR 0059). A feature may add to the save or the skill, but `…:proficiency` is not a stat the sheet shows, so no
feature may name it, and typing one writes a number: the proficiency bonus at today's challenge rating, wrong the moment
the rating moves.

Measured first:

- **What a player character's feature could name** (`customFeatureStats` over 5e's `pc`, with the kind's sections and
  the ability scores, worn slots and spell slots left out): 34 stats in Combat, Other Speeds, Saving Throws, Skills and
  Senses. **Every one derives**, so under ADR 0063 decision 3 none may be set.
- **A PC's save and skill marks** (ADR 0079) read `{stat}:proficiency`, which content supplies (`bonus="base"`, expertise
  in `double`) and the `pc` kind does not declare. A start there would be added to content's: a proficient character
  marked proficient again would read twice the bonus.
- **An NPC's marks**: of the 300 saves and skills the 141 creatures show (`showWhen` keeps only the proficient ones), all
  300 hold a whole number of the NPC's proficiency bonus, 32 of them two (expertise), 0 anything else. A class summon
  carries its summoner's bonus through `companion:proficiency` and still comes out whole. So a mark on an NPC's row reads
  true of today's content, and the mark's rounding down never hides anything.
- **`[type:feat]`** appears nowhere in the corpus (only `[type:spell]` 7 times and `[type:class]` once), so a feature a
  user writes held as a Feat changes no requirement through ADR 0071's held-types stat.

## Decision

### 1. A player character carries written features, and they only add (the maintainer's choice)

5e's `pc` declares `customFeatures`: held as a **Class Feature** by default, or a Racial Trait, Feat or Background
Feature, every one a type its Features & Traits section lists, so "Lucky Charm: +1 Armor Class" is listed with the
character's other features wherever it is filed. It may name the Combat, Other Speeds, Saving Throws, Skills and Senses
sections, not the ability scores (ADR 0063's amendment), the worn slots or the spell slots. One block in `system.json`,
no code: every stat offered derives, so the editor's "sets it to" is greyed and every line adds, exactly as ADR 0063
decision 3 already says of a derived stat.

### 2. A feature line may mark a row: `mode: "mark"`, its value a count

A custom feature line `{ stat, mode: "mark", value }` names a sheet **row** (`athletics`, as the sheet shows it) and a
count: 0, 1, 2, … It applies only where the row's section declares a `mark` (ADR 0079) **and the mark's stat, the row
template filled, is a stat the kind declares, with no `derive` and a numeric default**. Then the line sets where that
stat starts, after a creature's print and before a typed value (ADR 0063 decision 4's order), to **`value` × the mark's
`per`**, read from the derivation's previous pass as any rule's value is. So an NPC marked proficient in Athletics holds
one proficiency bonus there; at challenge rating 9 it is +4, at 1/4 +2, with nothing written again. A mark of 0 replaces
the creature's print and takes a proficiency away; 2 is expertise.

- **Why the declared-stat condition.** It is what separates the two kinds without naming either. An NPC's
  `athletics:proficiency` is declared (`default: 0`, `startsFrom` the creature's rule), so a start replaces the creature's.
  A player character's is content's, undeclared, and a start would be added to what content writes. The condition is
  core's and generic; no kind opts in by name.
- **Why the row and not the mark stat.** The user chooses "Athletics: proficient", and the sheet section is what knows
  how to turn that into a stat and a multiple. The mark stat is never offered as a number to type.
- **What the counts are called** is the mark's `labels`, and 0 is the mark's new optional **`none`** (5e: "not
  proficient"), else "none". `none` is never shown beside a row; only a choice offers it.
- **A count the mark has no name for** (past its labels, negative, fractional), or a mark on a row that may not be marked,
  is reported (`custom-feature-stat`) and changes nothing, not guessed at (ADR 0005). Two features marking one row: the
  first is used and the second reported, as two sets are (`custom-feature-conflict`, worded "marks").
- **A typed value** for the mark stat still replaces it and says so (`custom-feature-replaced`), as ADR 0063 decision 5;
  the editor has no control that types one, but a character written by hand may.

### 3. Only format 9 records a mark line

`CustomStatLine.mode` gains `"mark"`. A reader of 8 refuses the mode outright (its schema lists `add` and `set`), so the
character is raised to **9** by `setCustomFeature` when any line marks, and the validator refuses a mark below 9 with a
sentence that says so. A feature with no mark line is written at 4 or 6 as before. `LATEST_CHARACTER_FORMAT_VERSION`
is 9.

### 4. 5e's NPC and legendary creature declare their marks, so the sheet shows them

The NPC's and legendary creature's Saving Throws and Skills sections declare the same `mark` as the player character's
(`{stat}:proficiency` in multiples of `proficiency`, "proficient" and, for skills, "expertise"), with `none: "not
proficient"`. The mark is what the feature line reads, and declaring it also writes it beside each row the sheet shows:
"Perception +5 (proficient)", "Stealth +7 (expertise)", as on a player character's page. The maintainer saw no reason
against it. What it costs: every row a stat block shows is proficient by `showWhen`, so "(proficient)" repeats on each,
and every NPC's sheet and text export reads differently; what it gives is expertise, which a printed "+7" never said. A
held creature's stat block (ADR 0073) is not changed: its scope's mark stats are content's, and nothing there writes one.

### 5. The editor says what a line can do on this kind

The line's "How" choice is `CUSTOM_LINE_MODES` filtered by what the stat allows (`customLineModes`,
`customLineModeAllowed`): "marked" only on a markable row, "sets it to" greyed where it derives. A marked line's value is
a list of the mark's names (`customMarkChoices`), not a number. Switching to marked starts at the first mark past none;
back to adding starts at 0 (a count is no number to add); a marked line moved to a row that cannot be marked becomes an
add of 0. The section's first sentence is `customFeaturesHint(stats)`, worded from what the kind's lines can do: a player
character's says only that a line adds, since the fixed sentence promised a "sets it" the PC never enables. The desktop
(`CustomFeatures.tsx`) and the phone (`BuildExtras.tsx`, a "Marked" button and a picker of the names) render it.

## What this does not do

- **A player character's proficiency is not switched on by a feature.** Its marks are content's; making a PC proficient
  is an addition (ADR 0064: a Proficiency element from loaded content), which already exists.
- **No mark is offered on a held creature**, and its sheet shows none (decision 4).
- **A PC's feature cannot set anything**, by the existing rule and not by a new one: were 5e to declare a PC stat that does
  not derive in those sections, a feature could set it.
- **Reuse across characters** is still Phase 8's.

## Alternatives considered

- **A mark editor on Build** (a tick per save and skill, no feature). Quicker for a DM copying a stat block, and it would
  need a new character input to record a count that follows the rating, with no name for the reason. The feature line
  already has a name, a description and a place on the sheet, and the maintainer chose it.
- **A set line on `…:proficiency` with a number.** Stale when the challenge rating moves, which is the problem.
- **A set line whose value is any expression.** General, and an expression editor; a count of a declared mark is all a DM
  asks for, and the mark already names what each count means.
- **Leave the NPC's marks off the sheet**, declaring them somewhere only the editor reads. A second declaration of the
  same fact, and expertise would stay invisible.
- **No features for a player character.** The maintainer chose add-only features.

## Evidence

- `packages/core/src/custom-feature-marks.test.ts`, a fixture with no game in it: a row is markable only when its section
  declares a mark and the kind declares the mark stat, `none` first; a mark is `value × per` and follows `per` when the
  progression moves it; a mark of 0 replaces a creature's rule; out-of-range, negative and fractional counts and an
  unmarkable row are reported and change nothing; the first of two marks is used and the second reported "marks"; a mark
  line raises the character to 9. Perturbed, each failing: the start as the count itself, the mark stat not required to
  be declared, `startsFrom` applied over the feature's start, no range check, `none` dropped, the format not raised, the
  conflict worded "sets".
- `packages/ui/src/custom-feature-marks.test.ts`: which modes a row offers, the mark's names, switching and moving a line,
  each line's status (applied, overruled by an earlier mark, a count with no name), the hint's three wordings. Perturbed:
  marking offered everywhere, a mark keeping its number, an add keeping a count, a mark carried to an unmarkable row, the
  status read from the row's own start, the count unchecked.
- `tools/verify/src/npc-creatures.test.ts`, over every creature in the current corpus (141 at `c28ce6c`): the
  measurement above (300 rows, 32 expertise, 0 not whole), every shown row marked; a feature marking a save the creature
  lacks and taking away a skill it has, on 135 creatures: the save holds the bonus, the skill is gone, no problem, the
  sheet marks the save, the save reopened with no source derives the same, and challenge rating 20 carries the save with
  the bonus. Fails with the skills' `mark` removed and with the mark read as a fixed number.
- `tools/verify/src/pc-custom-features.test.ts`: the player character's 34 offered stats, none settable, none markable,
  no ability score; every type it may be held as is one Features & Traits lists. A Human Fighter built through the
  builder from loaded content takes +1 armour class and +2 Perception (passive Perception follows), is listed under
  Features & Traits as a Class Feature and as a Feat (format 4, then 6), and reopens with no source to the same numbers.
  Fails with `pc`'s declaration removed or the ability scores let in.
- `tools/verify/src/schemas.test.ts`: a mark line validates at 9 and is refused at 8; a feature without one stays at 4.
- **No player character derivation moved**: the oracle's thirty-sample table is identical before and after
  (`INCUDO_ORACLE_SNAPSHOT` on the base, `INCUDO_ORACLE_BASELINE` on the change, one checkout). The full suite passes.
- **Driven in the browser build** (not the Tauri window, the phone, macOS or Linux; selects set through the DOM, since the
  pane was not drawing for pointer input): a Wolf NPC given "Pack Hunter", Athletics marked proficient (the How list read
  adds, sets it to greyed, marked; the mark list not proficient, proficient, expertise) and Stealth marked not proficient.
  The Sheet read Athletics +3 (proficient), Perception +3 (proficient), no Stealth, Pack Hunter among the traits; at
  challenge rating 9 the bonus read +4 and Athletics +5. A Human Fighter given "Lucky Charm" +1 Armor Class read 10 then
  11, listed under Features & Traits, offered as Class Features, Racial Traits, Feats or Background Features, "sets it
  to" greyed, no "marked", and the hint saying only that a line adds. No console errors. Not saved to a library folder
  in the drive (the tests pack and reopen both).
