# 0118 — A sidekick is a character of its own, built on a creature and levelled in a sidekick class

**Status:** Accepted · 2026-10-15 · answers ROADMAP Phase 4's "Sidekicks" item · builds on
[0015](./0015-class-levels.md), [0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md),
[0044](./0044-hit-points-follow-the-method-the-character-uses.md),
[0045](./0045-a-class-split-is-one-input-and-an-unmet-ability-score-minimum-is-a-flag.md),
[0056](./0056-an-aurora-file-the-user-adds-is-a-source-of-its-own-kept-as-a-copy.md),
[0057](./0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md),
[0059](./0059-a-stat-may-start-where-another-stat-is-and-a-typed-value-replaces-it.md),
[0073](./0073-a-creature-a-character-holds-is-derived-one-at-a-time-in-its-holder-s-namespace-and-shown-as-its-own-stat-block.md),
[0108](./0108-a-user-writes-elements-into-a-homebrew-source-of-their-own-kept-in-incudo-s-content-format.md) ·
**format:** system format: a `Sidekick Class` element type, `setterStats.read`, `levelRoll.dieStat` and `from`, a sheet
section's `trackDice`, a kind's `available` (`formatVersion` stays 1); no character format change

> Proposed on 2026-10-15 with six open decisions, and accepted the same day with the maintainer's answers (below,
> "Decided with the maintainer"), and built the same day. Decisions 2 to 4 and 7 say what was built; where it differs
> from the plan: the die is a stat the kind reads off the print (not a `dieFrom` on the roll), and a sidekick has no
> attacks.

## Context

A companion or familiar (ADR 0073) is a creature a character *holds*: derived inside its holder, in the holder's
`companion:` namespace, with no levels, rolls or choices of its own. A sidekick is a creature that *gains levels* in one
of the published sidekick classes (a martial one, a skilled one and a caster): hit points per level, a proficiency bonus
by level instead of by challenge rating, class features, ability score improvements, and choices (skills, a fighting
style, a caster's spells). **Incudo builds its character sheet**, like every other kind's; it does not run play.

### What content exists, measured

Measured on 2026-10-15 against AuroraLegacy/elements at its head, **still `c28ce6c`** (`git ls-remote` of the official
repository; `.corpus/` already at it):

- **No sidekick content.** Two files name the word: `unearthed-arcana/2018/20181217.xml` declares one `Source` element,
  "Unearthed Arcana: Sidekicks", and nothing else (no class, feature or select carries that source), and Tasha's
  `source.xml` mentions sidekicks in its book's prose description. No element of any type is a sidekick class, feature
  or option. This is what ADR 0073 and the roadmap's 2026-10-12 note found; it has not moved.
- **No convention elsewhere either.** A search for an Aurora sidekick file in the wild found none.
- **The creatures are there.** 141 `Companion` elements once loaded (164 tags in the files; ADR 0057) print the
  six scores, `ac`, `hp`, `speed`, `size`, `type`, `challenge`, and name their traits and actions. **110 of the 141 print
  their dice in `hp`** (133 of the 164 tags) (`7 (2d4+2)`, `68 (8d10 + 24)`); the rest are class summons whose hit points are a
  formula over their holder ("5 + five times your ranger level (… [d10s] …)"), which are not sidekicks.

So nothing in the official corpus can make a sidekick. The sidekick rules are in *Tasha's Cauldron of Everything* and the
*Essentials Kit*, **not in SRD 5.1 or SRD 5.2.1**, so under ADR 0010 and `docs/LICENSING.md` Incudo cannot ship them,
and the maintainer wants no non-SRD rule content in the app.

### What the engine already does, mapped

| a sidekick needs | what already does it |
|---|---|
| a creature's stat block as where it starts | the NPC kind's `setterStats` (six scores), `startsFrom` (`ac`, `hp`, speeds, saves, skills from `companion:*`), `setterGrants` (traits, actions, reactions) — ADR 0057, 0058, 0059, 0062 |
| a typed score replacing the print | the same: a base replaces a start (ADR 0059) |
| levels 1 to 20 in one class | a `level` progression with `trackType` and `trackStatPattern` (ADR 0015, 0044 decision 5): one class element is the implicit track, `level:<class>` is published, content's `level=` gates read it. Nothing in core or `packages/ui` spells `Class`: the type is `trackType` and `levelRoll.classType` |
| a level set directly, not only one at a time | the class split (ADR 0045) writes a jump of many levels; with one class it is "set the level" |
| its own proficiency bonus by level | the system-level `proficiency` stat already derives `2 + floor((level − 1) / 4)`; the NPC kind redeclares it from `challenge`, so a sidekick kind simply does not |
| features at each level | the class's `<grant level=…>`s, gated on the track (ADR 0015) |
| ability score improvements, and feats where the table allows them | `improvement-options.ts` (ADR 0035) generates the options for **any** loaded element writing the `Improvement Option,<class>,<level>` select, whatever its type; the feat half is gated on `ID_INTERNAL_OPTION_ALLOW_FEATS`, a campaign option (ADR 0032, 0080) |
| skill, tool and fighting style choices | content `select` pools (ADR 0096), offered less what is held |
| a caster's list, spells, slots, DC and attack | a `<spellcasting>` block with `<list>`, `blockStats`, `blockFilters`, `preparation` (ADR 0018, 0020, 0030, 0046), as the player character declares them |
| hit points per level, rolled or averaged | `levelRoll` and the `hp` formula (ADR 0019, 0044) |
| a sheet, exports, print, the official form, the phone | a kind's `sheet` (ADR 0074 to 0079); the phone builds with the desktop's builder (ADR 0086) |

Two things are missing, and neither is a game noun in core:

1. **The hit die is the creature's, not the class's.** `levelRoll.dieSetter`, the average formula's
   `{ kind: "setter", name: "hd", as: "dieSides" }` and the sheet's `trackDie` all read a setter off the *class* that
   governs a level, and `dieSides` reads only a bare `dN`. A sidekick's die, and the dice it starts with, are what its
   creature prints inside `hp` (`7 (2d4+2)`).
2. **A kind that cannot be made with what is loaded.** With no sidekick class loaded there is nothing a sidekick can be
   that an NPC is not (decision C below), and nothing says so.

### Why not a held creature

ADR 0073's scope is the holder's derivation with the other creatures left out; it reads the holder's `choices`, `rolls`,
`advancement` and `progress`. A sidekick's own picks would have to live in its leader's `choices` under keys that two
sidekicks of the same class would share (`<class feature>/select:<name>`), its level would be its leader's, and its
rolls would collide with the leader's `hp:level:{n}`. Every input a sidekick has is an input a *character* has, one per
character. So a sidekick is a character.

## Decision

### 1. A sidekick class is an element of its own type, `Sidekick Class`

5e's system definition declares an element type **`Sidekick Class`** (selectable, browsable, plural "Sidekick Classes",
children Class Feature). A sidekick class is an element of that type, written as a class is: level-gated grants,
selects, `Improvement Option` selects, a `<spellcasting>` block for the caster, an `hd`-free setter list.

The explicit type is the better practice (the maintainer's call: Aurora compatibility is not a goal). The type says
what the element is; the player character's Class and levels steps offer only `Class` and never see one; Browse lists
them under their own heading; a requirement can ask `[type:sidekick class]`; and no step needs a filter, no tag is a
convention to remember, no player character step changes. The alternative, a `Class` with a support tag, needed a
filter on every class step, so that a file that forgot the tag put sidekick classes in every player's class list.

### 2. A `sidekick` kind in 5e's system definition, extending the NPC

`systems/dnd5e/system.json` gains a fourth kind, `sidekick`, `extends: "npc"`, so it inherits the creature start
(`startsFrom` for armour class, hit points, speeds, saves and skills, `setterGrants` for traits, actions and reactions),
its written features, additions, references, freeform text and play declaration, and declares:

- `progression`: `{ "kind": "level", "min": 1, "max": 20, "stat": "level", "elementIdPattern": "ID_LEVEL_{n}",
  "trackStatPattern": "level:{name}", "trackType": "Sidekick Class" }`;
- `setterStats` for the six scores and, from the creature's printed `hp`, `hit die` (`read: "dieSides"`) and
  `hit dice:printed` (`read: "diceCount"`); not `challenge`, which stays on the stat block as prose;
- stats: `level`, `proficiency` from `level` (the system's own formula, so the NPC's challenge formula is not
  inherited), `hit die`, `hit dice:printed`, `hit dice` (printed count + level − 1), and `hp` (decision 3);
- the NPC's contribution (its proficiency for the creature's own rules) and the player character's average hit points
  option;
- build steps: **Creature**, required (a sidekick is its creature); **Campaign options**, the player character's, with its
  `initial` (feats and multiclassing on); **Sidekick class**, a required pick of `Sidekick Class`; **Levels** (`perLevel`,
  `levelRoll` reading the die from `hit die`, from level 2, `classType: "Sidekick Class"`, `multiclassWhen` as the
  player character's); the NPC's ability score and armour class, hit points and speed overrides; traits, actions,
  proficiencies, languages, equipment and spells;
- the player character's casting declarations (`blockStats`, `blockFilters`, `preparation`, `setterTags`), copied;
- the sheet: the NPC's stat block sections with `level` in place of `challenge`, a Sidekick Class section listing the
  class with its level and hit dice ("Sample Martial 4 (5d8)"), and the player character's Spellcasting, Spell Slots
  (per block) and Spells sections.

No attacks and no bag: the NPC declares neither, and a sidekick's actions are its creature's printed ones. No play
declaration of its own: it inherits the NPC's (hit points, limited uses, exhaustion, conditions), and nothing was added.

### 3. A level's die and a character's hit dice may be read off a held creature's print

Three optional system-format fields, none naming a game:

- **`read` on a `setterStats` entry**: `number` (the default, as ADR 0057), or `dieSides` and `diceCount`, which read the
  first `NdM` a setter prints (`readPrintedDice`, `packages/core/src/setter-stats.ts`): `68 (8d10 + 24)` gives 10 and 8.
  A text with none starts nothing and the derivation's `setter-not-a-number` warning says it "prints no dice". `dieSides`
  in `expression.ts` is untouched: every other reader wants a bare `dN`.
- **`levelRoll.dieStat`** (exactly one of it and `dieSetter`; the schema says `oneOf`): the die is that stat's value
  rather than the governing class's setter. **`levelRoll.from`**: the first level that owes a value; levels below it are
  neither offered nor read, and none is then taken at the die's maximum (`computeHitPointState`). Moving a level
  between classes clears no roll when the die is not the class's.
- **`trackDice: { count, sides }` on a sheet section**: a listed track root's dice read from two stats instead of
  `trackDie`'s setter; nothing is written while either is 0. The validator refuses it beside `trackDie`, without
  `trackProgress`, and on a creature's stat block; a play tracker may read dice from a section declaring either.

So the sidekick's numbers are standard for whichever creature is chosen (decision D): its printed hit points are its
hit points at level 1 (`startsFrom: "companion:hp:max"`), each level after the first adds one of the creature's dice,
rolled or averaged as the campaign option says, plus the Constitution modifier, and its hit dice are the print's count
plus one per level after the first. A hit point total the user types replaces the printed start, and the later levels
still add to it (the step's description says so). The engine adds a stat's `derive` to whatever start is in force.

### 4. A kind may say what must be loaded before it can be made

A kind may declare **`available: { types, note }`** (system format, optional, not inherited along `extends`; the
validator refuses a type the system does not declare). `kindUnavailable(kind, loaded)` (`packages/ui/src/character-kinds.ts`)
gives the note while no loaded element is of one of `types`; `characterKindChoices(system, loaded?)` sets
`KindChoice.unavailable` when given what is loaded, and `BuilderState.unavailable` is the same for the character on
Build. The desktop's chooser lists the kind as "Sidekick (needs content)", shows the note under it and greys New character
(and the command makes nothing); with no source enabled it judges against nothing loaded, and while a load runs it judges
nothing. Build shows the note above the decisions on the desktop and the phone. The phone's New character screen loads
no content (ADR 0086), so it offers the kind and its Build screen says why nothing can be chosen. A sidekick already in
the library still opens, derives and shows with no source (ADR 0012).

### 5. A sidekick is its own character in the library, and records no leader

A sidekick is a `.incu` of kind `sidekick` like any character: listed, opened, saved, copied, exported and printed by
everything that already does that. It records nothing new: `progress` (its level), `choices` (creature, class, options,
picks), `rolls`, `baseStats`, `generation`, `prepared`, `freeform`. **No character format change**; a save embeds its
creature and class and opens with no source. It records no leader: nothing on a character sheet reads one (decision B).

### 6. Where sidekick classes come from

Incudo ships none and the system definition names none: the type and the kind are structure, the classes are content
the user adds.

- **A user's own content file** (ADR 0056) is the way in for 1.0: an Aurora-format `.xml` dropped on the Sources pane
  or chosen with "Choose files…", kept as a copy, declaring `Sidekick Class` elements with their features, selects and
  the caster's block, written as a class is. Incudo's parser reads any type a file writes; Aurora's own app will not
  offer these, which is accepted.
- **A homebrew source** (ADR 0108) cannot yet: its editor writes no classes, selects or level gates. It becomes a way
  when Phase 8's next slice writes those.
- **Upstream AuroraLegacy** has had the "Unearthed Arcana: Sidekicks" `Source` since 2018 and nothing in it. Should it
  ever add sidekick classes as `Class` elements, that is a measurement for then.

### 7. Tests and the fixture

- `tools/verify/fixtures/sidekicks/homebrew-sidekicks.xml`: a generic file in the project's own words, **not the
  book's** (`fixtures/legendary/` is the model): one `Source`, a creature ("Lantern Bearer", `11 (2d8 + 2)`), three
  `Sidekick Class` elements with invented names and features ("Sample Martial", "Sample Skilled", "Sample Caster"),
  level-gated grants, a skill select, a select over two invented styles, `Improvement Option` selects, and for the
  caster a `<spellcasting>` block over the corpus's Wizard list and a slot table written as level-gated stats. It names
  the corpus's proficiency and skill ids, so it is loaded beside the corpus.
- `tools/verify/src/sidekicks.test.ts`: reports how many sidekick classes the corpus declares (0 at `c28ce6c`) and how
  many creatures print their dice (110 of 141); asserts the kind is unavailable with the corpus alone and available with
  the file; no player character decision offers one of the three, and the sidekick's class step offers exactly them; on
  the file's creature, level 1 is the print (scores, 11 hit points, d8, 2 dice), `level:<class>` 1, proficiency +2, the
  class's grants gated by its level, and no hit point roll owed; at 4, rolls owed for levels 2 to 4 on the creature's die,
  an improvement option offering a feat while the campaign option is on and none once it is off, hit points the print plus
  each later level's roll or average plus Constitution, hit dice 2 + 3; proficiency +6 at 20; the sheet lists the class
  with its level and dice; packed and reopened with no source to the same `summarize()` and sheet document. A caster
  sidekick's DC, attack and slots are its own, its spell selects offer only what a slot reaches, and its slot rows are
  labelled.
- `packages/core/src/setter-stats.test.ts` (the dice readings and their warning) and
  `packages/ui/src/kind-from-creature.test.ts` (an invented system: `available`, `dieStat` and `from`, `trackDice`),
  each case failing under its named perturbation; `schemas.test.ts` refuses an undeclared `available` type and
  `trackDice` beside `trackDie`. Three existing tests now count a fourth 5e kind. The full suite is green and no player
  character file changed, so the oracle's inputs are untouched.
- **Driven in the browser build only**: with no source the chooser reads "Sidekick (needs content)" with the note and
  New character greyed; with the file dropped on the Sources pane (a dispatched drop event, corpus not loaded), a
  sidekick was built on the Lantern Bearer as Sample Martial and levelled 1 to 4 with the buttons; the other two classes
  read "cannot be taken as an additional class"; hit points owed d8 for levels 2 to 4, average 5; the Sheet read
  "Sample Martial 4 (5d8)", hit points 29, proficiency +2. **Not driven:** the Tauri window, the phone, save and reopen
  in the app (the tests cover it), print, the official form (a sidekick is not a player character, so no form is
  offered).

## Decided with the maintainer (2026-10-15)

- **A. An element type, not a tag.** Aurora compatibility is not a goal; the explicit type is the better practice
  (decision 1).
- **B. No leader recorded.** Asked what it would be for: nothing a character sheet shows reads it. Levelling a sidekick
  with its group is the table's, done by levelling it.
- **C. A sidekick always has a sidekick class**: in the published rules, becoming a sidekick is taking one of the three.
  Without one it is an NPC, which is already a kind, so the kind is offered only when one is loaded (decision 4).
- **D. Hit points and hit dice follow the creature chosen**, not a choice (decision 3).
- **E. Feats as for a player character.** The 2014 rules make feats an optional rule that stands in for a class's
  Ability Score Improvement; whether a table uses it is the DM's. A sidekick class's improvement is the same feature,
  so the sidekick has the campaign options step, feats on by default as on a new player character, which the DM may
  switch off. Whether Tasha's sidekick chapter says anything more specific was not checked against the book here; the
  option covers either reading.
- **F. A level may be set directly**: the class split already writes a jump of many levels, and a user can always level
  up one at a time, so nothing is gained by refusing it.

## Consequences

**Good**
- One element type, one kind and four small kind-agnostic format additions; every other piece is an engine path already held
  by tests and the oracle. No player character step or derivation changes.
- No character format change, no new port, no new pane: a sidekick is a character with a different kind.
- No rule content shipped.

**Bad / accepted**
- **Nothing to read until a user adds a file.** No Aurora save of a sidekick exists in the samples, and the fixture is
  the project's own, so "agrees with the fixture worked by hand" is all a test can say.
- A sidekick file written for Aurora's app (as a `Class`) is offered as a player class in Incudo and not as a sidekick
  class; its author changes the type.
- The NPC's and the player character's declarations are copied into the sidekick kind where it needs both (casting,
  hit points, options), as the legendary kind already copies the NPC's sheet; a change to either must be made in both.
- A creature the published rules would not allow as a sidekick is not refused: which creatures qualify is rule content
  Incudo does not ship, and content may still write it as a class's requirements.
- The multiclassing option is on by default, as for a player character. A class with no `<multiclass>` block cannot be
  a second class (ADR 0036), so a sidekick class written as the fixture's is never offered as one ("cannot be taken as
  an additional class"); a file that writes such a block makes a second sidekick class possible, and Incudo does not
  refuse it.
- The Build pane's level panel still says "Further levels can then go to other classes" for a sidekick; true only of a
  file that writes a multiclass block. Not reworded.

## Alternatives considered

**A `Class` with a support tag and a step filter.** The first proposal, for files that also work in Aurora's app. Not a
goal, and it needed a filter on every class step and a convention a file could forget.

**A held creature with a class track** (ADR 0073's scope plus `advancement`). Its picks, level and rolls would be its
leader's inputs, and two sidekicks would collide.

**An NPC with a class added through Additions** (ADR 0064). An addition never joins a track, so its level gates read the
challenge rating, and a class's selects would open with no level to gate them.

**Ship the three classes as Incudo's own content.** Not SRD, and the maintainer has ruled out non-SRD rule content.

**Wait for upstream.** Upstream has held an empty sidekick `Source` since 2018; 1.0 would wait indefinitely.

## Evidence

- `git ls-remote` of AuroraLegacy/elements on 2026-10-15: `c28ce6c`. A search of every `.xml` for "sidekick" (case
  ignored): two files, one `Source` element and one book description.
- The `Companion` setter census above, by a script over the files, and the `hp` print census, by `sidekicks.test.ts`
  over the loaded corpus (110 of 141 print `NdM`).
- `systems/dnd5e/system.json`: `proficiency` derives from `level`; the NPC's redeclares it from `challenge`;
  `LevelRollDef` reads `dieSetter` off the governing class; `trackType` names the type a track is rooted on.
- No core or ui source outside tests names `"Class"`: the class type is read from the system everywhere.
- `packages/aurora-import/src/improvement-options.ts` derives options from the select, whatever declares it.
