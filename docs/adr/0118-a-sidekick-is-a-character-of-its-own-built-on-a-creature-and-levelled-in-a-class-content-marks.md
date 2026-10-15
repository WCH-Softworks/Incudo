# 0118 — A sidekick is a character of its own, built on a creature and levelled in a class content marks

**Status:** Proposed · 2026-10-15 · plans ROADMAP Phase 4's "Sidekicks" item · builds on
[0015](./0015-class-levels.md), [0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md), [0044](./0044-hit-points-follow-the-method-the-character-uses.md),
[0045](./0045-a-class-split-is-one-input-and-an-unmet-ability-score-minimum-is-a-flag.md),
[0056](./0056-an-aurora-file-the-user-adds-is-a-source-of-its-own-kept-as-a-copy.md),
[0057](./0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md),
[0059](./0059-a-stat-may-start-where-another-stat-is-and-a-typed-value-replaces-it.md),
[0060](./0060-a-character-may-leave-its-progression-to-what-it-chose-and-that-is-format-3.md),
[0073](./0073-a-creature-a-character-holds-is-derived-one-at-a-time-in-its-holder-s-namespace-and-shown-as-its-own-stat-block.md),
[0108](./0108-a-user-writes-elements-into-a-homebrew-source-of-their-own-kept-in-incudo-s-content-format.md) ·
**format (proposed):** system format `supports` on a build step and a die read off a held creature (`formatVersion` stays
1); no character format change

> **Proposed, not built.** This records the measurement and the plan the maintainer asked for after ruling (2026-10-15)
> that 1.0 does not ship without sidekicks. The decisions marked **open** below are the maintainer's.

## Context

A companion or familiar (ADR 0073) is a creature a character *holds*: derived inside its holder, in the holder's
`companion:` namespace, with no levels, rolls or choices of its own. A sidekick is the other thing the old roadmap item
named: a creature that *gains levels* in a sidekick class (three of them in the published rules: a martial one, a
skilled one and a caster), grows hit points per level, gets a proficiency bonus by level instead of by challenge rating,
features, ability score improvements, and choices (skills, a fighting style, a caster's spells).

### What content exists, measured

Measured on 2026-10-15 against AuroraLegacy/elements at its head, **still `c28ce6c`** (`git ls-remote` of the official
repository; `.corpus/` already at it):

- **No sidekick content.** Two files name the word: `unearthed-arcana/2018/20181217.xml` declares one `Source` element,
  "Unearthed Arcana: Sidekicks", and nothing else (no class, feature or select carries that source), and Tasha's
  `source.xml` mentions sidekicks in its book's prose description. No element of any type is a sidekick class, feature
  or option. This is what ADR 0073 and the roadmap's 2026-10-12 note found; it has not moved.
- **No convention elsewhere either.** A search for an Aurora sidekick file in the wild found none, so there is no
  existing shape to be compatible with beyond Aurora's own class format.
- **The creatures are there.** 164 `type="Companion"` tags in the files (141 elements once loaded; ADR 0057) print the
  six scores, `ac`, `hp`, `speed`, `size`, `type`, `challenge`, and name their traits and actions. **133 of the 164 `hp`
  setters print their dice** (`7 (2d4+2)`, `68 (8d10 + 24)`); the other 31 are class summons whose hit points are a
  formula over their holder ("5 + five times your ranger level (… [d10s] …)"), which are not sidekick candidates anyway.

So nothing in the official corpus can make a sidekick, and nothing can be read to check a design against. The sidekick
rules are in *Tasha's Cauldron of Everything* and the *Essentials Kit*, **not in SRD 5.1 or SRD 5.2.1**, so under ADR 0010
and `docs/LICENSING.md` Incudo cannot ship them, and the maintainer wants no non-SRD rule content in the app.

### What the engine already does, mapped

Every part of a sidekick but two is a thing an existing kind already does:

| a sidekick needs | what already does it |
|---|---|
| a creature's stat block as where it starts | the NPC kind's `setterStats` (six scores), `startsFrom` (`ac`, `hp`, speeds, saves, skills from `companion:*`), `setterGrants` (traits, actions, reactions) — ADR 0057, 0058, 0059, 0062 |
| a typed score replacing the print | the same: a base replaces a start (ADR 0059) |
| levels 1 to 20 in one class | a `level` progression with `trackType` and `trackStatPattern` (ADR 0015, 0044 decision 5): one class element is the implicit track, `level:<class>` is published, content's `level=` gates read it |
| one class only, never a second | the per-level step's `multiclassWhen` (ADR 0088): a character that records no options holds no "allow multiclassing", so no second class is offered |
| its own proficiency bonus by level | the system-level `proficiency` stat already derives `2 + floor((level − 1) / 4)`; the NPC kind redeclares it from `challenge`, so a sidekick kind simply does not |
| features at each level | the class's `<grant level=…>`s, gated on the track (ADR 0015) |
| ability score improvements | `improvement-options.ts` (ADR 0035) generates the options for **any** loaded class that writes Aurora's `Improvement Option,<class>,<level>` select, a third-party class included; the feat half stays gated on `ID_INTERNAL_OPTION_ALLOW_FEATS` |
| skill, tool and fighting style choices | content `select` pools (ADR 0096), offered less what is held |
| a caster's list, spells, slots, DC and attack | a `<spellcasting>` block with `<list>`, `blockStats`, `blockFilters`, `preparation` (ADR 0018, 0020, 0030, 0046), as the player character declares them |
| hit points per level, rolled or averaged | `levelRoll` and the `hp` formula (ADR 0019, 0044) |
| a sheet, play state, exports, phone | a kind's `sheet` and `play` (ADR 0074, 0084); the phone builds with the desktop's builder (ADR 0086) |

The two gaps:

1. **Telling a sidekick class from a player's class.** A build step offers by element *type* only (`BuildStepDef.types`;
   no filter). If sidekick classes are `Class` elements, the player character's Class and levels steps offer them too,
   and the sidekick's offers every player class.
2. **The hit die is the creature's, not the class's.** `levelRoll.dieSetter` and the average formula's
   `{ kind: "setter", name: "hd", as: "dieSides" }` read the setter off the *class* that governs a level, and `dieSides`
   reads only a bare `dN`. A sidekick's die is the one its creature prints inside `hp` (`7 (2d4+2)`).

Neither is a game noun in core.

### Why not a held creature

ADR 0073's scope is the holder's derivation with the other creatures left out; it reads the holder's `choices`, `rolls`,
`advancement` and `progress`. A sidekick's own picks would have to live in its leader's `choices` under keys that two
sidekicks of the same class would share (`<class feature>/select:<name>`), its level would be its leader's, and its
rolls would collide with the leader's `hp:level:{n}`. Every input a sidekick has is an input a *character* has, one per
character. So a sidekick is a character.

## Decision (proposed)

### 1. A `sidekick` kind in 5e's system definition, extending the NPC

`systems/dnd5e/system.json` gains a fourth kind, `sidekick`, `extends: "npc"`, so it inherits the creature start
(`setterStats` for the six scores only, `startsFrom`, `setterGrants`, the stat block's sheet sections) and declares:

- `progression`: `{ "kind": "level", "min": 1, "max": 20, "stat": "level", "elementIdPattern": "ID_LEVEL_{n}",
  "trackStatPattern": "level:{name}", "trackType": "Class" }`; no `challenge` setter (a sidekick keeps its creature's
  printed rating as prose, not as its progression);
- `proficiency` from `level` (the system's own formula), so the NPC's challenge formula is not inherited;
- build steps: Creature (a required `pick` here, unlike the NPC: a sidekick is its creature), Sidekick class (a required
  pick of `Class` **filtered to sidekick classes**, decision 2), levels (`perLevel`, the same filter, `levelRoll` with
  the creature's die, decision 3, `multiclassWhen` naming the multiclassing option the sidekick never records),
  ability scores (the NPC's override budget), traits and actions as the NPC's, equipment, spells;
- the player character's casting declarations (`blockStats`, `blockFilters`, `preparation`, `setterTags`), the `hp`
  formula and its `trackStats`, adapted so the first level is the creature's printed hit points (decision 3);
- the sheet: the NPC's stat block sections plus a Character section listing the class with `trackProgress`
  ("Sample Martial 3"), the spell slot and Spells sections, Attacks; `play` with hit points, hit dice and slots.

All of it is data. The only kind-agnostic additions are decisions 2 and 3.

### 2. A sidekick class is a `Class` content marks with a support tag the system names

A build step may declare **`supports`**, a filter in content's own `supports` language (ADR 0030, 0048), applied to its
offer after `types`. 5e declares `"supports": "Sidekick"` on the sidekick's class and levels steps and
`"supports": "!Sidekick"` on the player character's, so neither offers the other's. A `Class` that writes
`<supports>Sidekick</supports>` is a sidekick class; nothing else about it is special, and everything Aurora's class
format can say (grants by level, selects, a casting block, improvement selects) works because it is a class.

**Why a tag on `Class` and not a new element type (open, decision A below):** a new type (`Sidekick Class`) needs no
step filter and no engine change, and it is how the system would say it with nothing else to fit. But any sidekick file
that also works in Aurora's own app, and anything upstream ever adds, can only be `type="Class"` (Aurora's app ignores
types it does not know), and such a file would then leak sidekick classes into every player character's Class step.
A tag reads both: a user who writes Incudo-only content writes the same tag.

### 3. A level's die may be read off a held element of a named type, inside what it prints

`LevelRollDef` gains `dieFrom: { types, setter }`: the die is read off the held element of those types (5e: the
`Companion`, setter `hp`) rather than off the class governing the level, and the expression's `setter` reading gains the
same `from` for the average formula. The value is read by a new `as: "printedDie"`, which takes the first `NdM` inside a
printed value (`68 (8d10 + 24)` is 10) and reads nothing from anything else; `dieSides` is untouched, since every other
reader wants a bare `dN` and loosening it would change what a class's `hd` means. A creature with no printed die gives
none, and its level decisions say so rather than guessing a die from its size.

Hit points: the creature's printed hit points are where `hp` starts (`startsFrom: "companion:hp:max"`, as the NPC's), a
level after the first adds its rolled or average die and the Constitution modifier, and a typed value still replaces the
total (ADR 0059). How many hit dice the sidekick has for play (its print's count plus its levels, or its levels alone)
is **open**, decision D.

### 4. A sidekick is its own character in the library, and names no leader

A sidekick is a `.incu` of kind `sidekick` like any character: listed, opened, saved, copied, exported and printed by
everything that already does that. It records nothing new: `progress` (its level), `choices` (creature, class, picks),
`rolls`, `baseStats`, `generation`, `inventory`, `prepared`, `freeform`. **No character format change**; a save
embeds its creature and class and opens with no source (ADR 0012). It records no leader (open, decision B): the
published rules level a sidekick with its group, which is a table's decision, and a link would need a library that
resolves one character from another, which nothing does today.

### 5. Where sidekick classes come from, and what the app says without them

Incudo ships none and the system definition names none: the kind and its tag are structure, and the classes are
content the user adds.

- **A user's own Aurora file** (ADR 0056) is the way in for 1.0: dropped on the Sources pane or chosen with "Choose
  files…", kept as a copy. It writes three `Class` elements with the tag, their features, selects and a casting block
  for the caster, in Aurora's format.
- **A homebrew source** (ADR 0108) cannot yet: its editor writes no classes, selects or level gates. It becomes a way
  when Phase 8's next slice writes those.
- **Upstream AuroraLegacy**, if it ever adds them, is read the moment it does, provided the classes carry the tag; if
  upstream marks them another way, that is one line in the system definition, read then.

With no sidekick class loaded, New character still offers the Sidekick kind (its description says it needs sidekick
classes from a content source), and its Sidekick class step says that no loaded source has one and that one is added
on the Sources pane, instead of the generic "nothing matches". **Open**, decision C: whether to hide the kind instead.

### 6. Tests and the fixture

- `tools/verify/fixtures/sidekicks/homebrew-sidekicks.xml`: a generic Aurora-format file in the project's own words,
  **not the book's** (`fixtures/legendary/` is the model): one `Source`, three tagged classes with invented names and
  features ("Sample Martial", "Sample Skilled", "Sample Caster"), level-gated grants, a skill select, a fighting-style-like
  select over invented options, `Improvement Option` selects at 4, 8, 12, 16, 19, and for the caster a `<spellcasting>`
  block over a list tag and a slot table written as level-gated stats. No feature text, table or name is copied.
- `tools/verify/src/sidekicks.test.ts`, measurement first (report-only lines, then assertions that hold against any
  corpus): the corpus has no tagged class (a line, not a pin); with the fixture loaded, the player character offers none
  of the three and the sidekick offers only them; a sidekick on a corpus creature at levels 1, 4 and 20 derives its
  scores from the print, `level:<class>`, a proficiency bonus of 2/2/6, its features by level, the improvement options at
  4, the caster's slots, DC and attack; hit points from the print plus each level's die of the creature's printed
  dice, rolled and averaged; packed and reopened with no source to the same `summarize()` and the same sheet document.
- Core and ui unit tests for the step filter and `printedDie`, each failing under its named perturbation; the
  validator refusing a step `supports` that will not parse. The oracle must be identical before and after (no player
  character moves, and the `!Sidekick` filter removes nothing from the corpus today).
- Driven in the browser build and the Tauri window on Windows with the fixture as a dropped file, and on the phone
  emulator (the fixture added through the picker, a sidekick built, played and exported).

## Consequences

**Good**
- Two small kind-agnostic format additions and one kind of data; every other piece is an engine path already held by
  tests and the oracle.
- No character format change, no new port, no new pane: a sidekick is a character with a different kind.
- No rule content shipped; the same file works in Aurora's app if its author wants it to.

**Bad / accepted**
- **Nothing to read until a user adds a file.** Every number here has no referee: no Aurora save of a sidekick exists in
  the samples, and the fixture is the project's own. "Agrees with the fixture worked by hand" is all a test can say.
- The tag is a convention Incudo chooses. A file that marks sidekick classes another way shows them as player classes
  until it adds the tag.
- The NPC's and the player character's declarations are copied into the sidekick kind where it needs both (casting,
  hit points), as the legendary kind already copies the NPC's sheet; changes to either must be made in both.
- A creature the published rules would not allow as a sidekick is not refused: which creatures qualify is the rule
  content Incudo does not ship, and content may still write it as the class's requirements.

## Open decisions for the maintainer

- **A. Tag on `Class` (recommended) or a new `Sidekick Class` type.** The type needs no engine change and cannot reach
  Aurora-compatible files; the tag is one step filter.
- **B. A link to the leader.** Recommended none for 1.0; a library card could later show "led by …" from a recorded id.
- **C. The kind with no sidekick content.** Recommended: offered, and saying where classes come from; the alternative
  hides it until a source declares a tagged class.
- **D. Hit points and hit dice at level 1 and after**, against the maintainer's own copy of the rules: whether level 1
  is exactly the print, and whether the hit dice a sidekick spends are its print's plus one per level.
- **E. Feats.** The improvement options' feat half is gated on the "allow feats" option, which a sidekick never records,
  so a sidekick is offered only ability score increases. Whether a sidekick kind should have its own campaign options
  step.
- **F. Starting level.** A sidekick is created at level 1 and levelled; whether "Level up" should also accept a typed
  level for one joining a high-level group (the class split already does a jump of many levels).

## Alternatives considered

**A held creature with a class track** (ADR 0073's scope plus `advancement`). Rejected above: its picks, level and rolls
would be its leader's inputs, and two sidekicks would collide.

**An NPC with a class added through Additions** (ADR 0064). An addition never joins a track, so its level gates read the
challenge rating, and a class's selects would open beside a creature's with no level to gate them.

**Ship the three classes as Incudo's own SRD-like content.** Not SRD, and the maintainer has ruled out non-SRD rule
content; writing "similar" classes would be a design the project does not own.

**Wait for upstream.** Upstream has had the Source for "Unearthed Arcana: Sidekicks" since 2018 and nothing in it; 1.0
would wait indefinitely.

## Evidence

- `git ls-remote` of AuroraLegacy/elements on 2026-10-15: `c28ce6c`. A search of every `.xml` for "sidekick" (case
  ignored): two files, one `Source` element and one book description.
- The `Companion` setter census and the `hp` print census above (133 of 164 print `NdM`), by a script over the files.
- `systems/dnd5e/system.json`: `proficiency` derives from `level`; the NPC's redeclares it from `challenge`;
  `BuildStepDef` has no filter beyond `types`; `LevelRollDef` reads `dieSetter` off the governing class; `trackType`
  names the type a track is rooted on.
- `packages/aurora-import/src/improvement-options.ts` derives options for any class writing the improvement select.
