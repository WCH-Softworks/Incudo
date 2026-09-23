# 0036 — A level is spent on a class by writing two records, and the builder gates only what content declares

**Status:** Accepted · 2026-09-18 · builds on [0015](./0015-class-levels.md),
[0017](./0017-open-decisions-not-steps.md), [0019](./0019-recorded-rolls-are-readable.md) ·
**no system-format change** (`formatVersion` stays 1; the one edit to `systems/dnd5e/system.json`
is six declared stats)

## Context

The multiclass *model* has been finished since [ADR 0015](./0015-class-levels.md) and the slot
table since [ADR 0018](./0018-tables-and-track-stats.md), and an imported Aurora character carries
both. What was missing is any way to *write* one. `CharacterBuilder` has `setProgress`, which
changes a number, and nothing that says what a point of progression was spent on, so a multiclass
character could exist only by being imported. ROADMAP Phase 2's exit criterion — a level 8
Rogue/Wizard — was unreachable from the app for that reason and no other.

### What the imported multiclass character actually holds

The project's multiclass oracle (a level 20 Paladin 2 / Warlock 18) imports as **two** records
about the second class, not one:

| record | value |
|---|---|
| `advancement` | 20 entries: levels 1–2 → the Paladin, 3–20 → the Warlock |
| a choice, `ID_LEVEL_3/select:Multiclass (Level 3)` | the Warlock's **multiclass element**, `ID_WOTC_PHB_MULTICLASS_WARLOCK` |

Both are needed, and the second one was the surprise. Removing only the choice and keeping
`advancement` gives a different character: it loses `ID_INTERNAL_GRANT_MULTICLASS` and the two
slot-weighting markers behind it (caster level 1 → 0, slots 2/0/0 → 0/0/0), and it opens a
"Skill Proficiency (Warlock) ×2" pick that a second class never owes. The reason is in the class
element itself — every 2014 class writes its full proficiencies and its skill select as
`requirements="!ID_WOTC_PHB_MULTICLASS_<CLASS>"`, and the multiclass block is what grants the
reduced set and `ID_INTERNAL_GRANT_MULTICLASS`. **A builder that writes `advancement` alone builds a
wrong character with no error anywhere.**

### How the corpus expresses a prerequisite

Measured against the 740 files, not read from the format:

- **28 of 29 Class elements** carry a `<multiclass>` block. The one that does not is the Unearthed
  Arcana Mystic.
- Each block's `requirements` is an expression over ability scores — `[cha:13]`,
  `([str:13],[cha:13])`, `([str:13]||[dex:13])` — and 2014/2024 pairs carry a second clause,
  `!(ID_…_CLASS_X||ID_…_MULTICLASS_X)` for the *other* edition of the same class. Most end in
  `||ID_INTERNAL_GRANTS_MULTICLASS_UNLOCKER`, an item that bypasses the whole block.
- `ID_INTERNAL_OPTION_ALLOW_MULTICLASSING` and `ID_INTERNAL_GRANTS_MULTICLASSING_PREREQUISITE`
  — the two names ROADMAP pointed at — are referenced by **0 of the 740 files**. Only saves name
  them. Every save in a set of real saves has the option on, so there is no save that shows what switching
  it off does.
- Nothing in content states the Player's Handbook's other half: that the class you are *leaving*
  must also meet its own prerequisite. A block is written as the entry gate into its own class.

### A bug in the way, found by measuring the gate

Every one of those requirements read **false** for every character. Content spells the abilities
`str dex con int wis cha` — **72 reads** in requirements, 36 in `<multiclass>` blocks, 24 on Feat
prerequisites and 6 on rules — and the derivation publishes no stat under any of those names.
`[cha:13]` evaluated `stats.get('cha') ?? 0 >= 13`. Against a character with Charisma 20, **all 28
multiclass blocks read ineligible**, and Grappler, Actor and 22 other feats were never offered.
Aurora's app publishes the short names in application code, as it does the multiclass slot table.
`aurora verify` could not see it: it compares the elements a character *chose*, and came back
byte-identical on all nine saves before and after the fix.

> **Note, 2026-09-23 — re-derived from the thirty sample saves**, as a before/after over the commit that
> published the six short names (`c5e90cf^` against `c5e90cf`, one script at both, corpus at `c28ce6c`).
> **"`aurora verify` could not see it" reproduces:** elements, their order, pending choices, problems and every
> difference against Aurora are identical on all 30. The stats are not: the six names appear on every sample
> (`cha`, `con`, `dex`, `int`, `str`, `wis`), and **one existing stat moves**, the plate-wearing Fighter's
> `speed`, from **20 to 30**. Plate's speed penalty is gated on `[str:15]` and that Fighter has Strength 17,
> so the penalty was being applied because the name read 0. Aurora's screen shows 30 (the `manifest.json`
> readout), so the fix is right, and the same bug had been *introduced* one step earlier by ADR 0024's bag
> step (see the note in `docs/AURORA-SAVE-FORMAT.md`), which no count saw. **Two figures differ.** The option
> `ID_INTERNAL_OPTION_ALLOW_MULTICLASSING` is on in **9 of 30** samples (all 8 multiclass ones and one more),
> not "every save", so 21 samples do show it off, although none of them is multiclass and so none shows what
> the option changes. And "the oracle's own recorded rolls include a 10 at a level whose die is a d8" was
> not re-derived: every sample carries a 20-value `rndhp` list, most of it padding for levels never taken, and
> the values were not compared level by level with each class's die. The 72 / 36 / 24 / 6 reads and the 28
> blocks are corpus figures and were not re-run.

## Decision

### 1. Six declared stats, and nothing else about stats

`systems/dnd5e/system.json` declares `str`, `dex`, `con`, `int`, `wis` and `cha`, each a `ref` to
the full ability — the same construction as `initiative`. No engine change, no format change,
and the meaning stays in the system definition (ADR 0003): core still cannot spell "strength".

### 2. A level is spent by writing `advancement` **and** the multiclass element

`advancement` is present **only while a character has more than one class**, and when present it
covers every level from the first to `progress`. A single-class character keeps no advancement, as
an imported one never had — the array would say only what `progress` and the class choice say.
A class that is not the character's first gets its multiclass element recorded as a choice,
keyed exactly as the importer keys it: `ID_LEVEL_{n}/select:Multiclass (Level {n})`, where `n` is
the first level the class was taken at, and `ID_LEVEL_{n}` comes from the kind's own
`progression.elementIdPattern`.

That key is **Aurora-shaped on purpose.** It is what an import of the same character writes, so an
imported multiclass character and one built here have the same records and the builder can edit
either. The cost is a label string with a number in it, and an alternative such as
`build/multiclass:3` would have made two spellings of one fact. Records are *found* by what they
hold, not by their key — a choice whose elements are all multiclass elements is the builder's
to keep in step — so a save with any other key for the same fact is repaired on the next edit
rather than duplicated.

**The first class has no multiclass element**, and never gets one: it is the class the character
started as, and its multiclass block would *remove* its saving throw proficiencies.

### 3. What governs a level is what already says so: `levelRoll.classType`

`LevelRollDef.classType` has always been documented as "the element type that governs a level",
with `advancement` naming the element per level. The multiclass builder reads that and adds no
field: a `perLevel` step that declares a `levelRoll` publishes its class levels
(`BuilderStep.classLevels`). A system whose levels have no `levelRoll` gets no multiclass control
— a real limit, named here, that an additive `spendOn` field could lift later without moving any
saved character.

The *first class* is found from content, not from a key: the level 1 entry of `advancement` if
there is one, otherwise the first choice holding an element of `classType`. An imported save keeps
its class under `ID_LEVEL_1/select:Class`, not `build/class`, so a lookup by pick key would find
nothing on exactly the characters this exists for.

### 4. Gate on what content declares, and say what it does not

A class the character has no level in is offered only when its own `requirements` **and** its
multiclass block's `requirements` hold, evaluated by `requirementContextFor` — the engine's own
answer, so the builder cannot offer what the derivation then refuses. A class the character
already has needs no gate: another level in it is not a multiclass. A class with no block is
listed as unavailable with that reason rather than hidden, because "why isn't the Mystic here?" has
an answer. A class ruled out by something the character holds — the other edition of a class it
has, from `!(ID_…_CLASS_X||ID_…_MULTICLASS_X)` — says so (`unavailable: 'excluded'`, `excludedBy`),
found by walking the false expression for a negated `has` of a held element: a boolean cannot say
which term failed, and the first run of the app told a Dexterity 16 character that the 2024
Fighter "needs Dexterity 13".

Deliberately **not** gated, each for a stated reason:

- **The campaign option.** Content never reads it, so nothing derives a gate from it, and campaign
  options cannot be switched on yet ([ADR 0032](./0032-a-build-step-may-offer-a-set.md)) — gating
  on it would make the feature unreachable for every character built here. Aurora's own use of it
  is application code I cannot read.
- **The current class's prerequisite.** Content does not express it (above), and a system-level
  rule "you must also meet the class you are leaving" is a fact about the game that belongs in the
  system definition, not in this package. The builder is therefore *more permissive than the
  Player's Handbook* here, and never stricter than content.
- **When the score was met.** Requirements read the character as it stands now, as every
  requirement in the engine does. A Charisma minimum met at level 12 by a feat still admits a
  level 3 multiclass. The engine has no time axis and this does not add one.

### 5. Reassigning a level clears a roll made on a different die

A recorded hit point roll is a result of one die. Spending a level on a class with a different
`hd` makes that number a result of nothing, so it is cleared and the level's hit points reopen
in the ordinary list; a level moved between two d8 classes keeps its roll. ADR 0007's "a recorded
roll never silently disappears" is honoured by the decision reappearing, not by keeping a 10 on a
d6.

**Only when the previous class, and so its die, is known.** A first draft also cleared a leftover
roll that *exceeded* the new class's die when a level came into being (a level lowered away keeps
its roll, ADR 0007). Rebuilding the oracle showed why that is wrong: **the oracle's own recorded
rolls include a 10 at a level whose die is a d8.** Values above the die exist in real saves, and
deleting one on a plausibility guess is destroying data to tidy a number. A level that comes into
being keeps whatever roll is recorded for it, and `addLevel` is one write for the same reason —
growing into the previous class and then reassigning would pass through a die change that never
happened and clear a roll the level never held.

### 6. Progress and the first class keep it consistent

`setProgress` extends `advancement` with the class of the level before — new levels continue the
class you were playing, and can be reassigned — and trims entries past the new progress, so a
class whose only levels are gone leaves with its multiclass record. Choosing a different first
class re-homes every level the old one had. Gaps that an import left (levels it could not
attribute) are **not** filled: filling them would change a character on an unrelated edit. They
show as unassigned and are spent by choosing a class.

## Consequences

**Good**
- The Phase 2 exit criterion becomes reachable from the app, and decisions a level opens arrive in
  the same flat list they always did, tagged with the level in their own track.
- Ability prerequisites work for *everything*, not just multiclassing: 24 feats become offerable.
- One representation for imported and built multiclass characters.

**Bad / accepted**
- The multiclass gate is time-blind and one-sided (above). Both are content's silence, not a
  guess made here.
- **Levelling down, or moving a level off a class, leaves that class's own picks in `choices`**,
  where they still seed the derivation — the same as re-picking a race today. Not fixed here: the
  engine has no owner-removed pruning and adding one is a decision about every pick, not about
  levels.
- Aurora's `Multiclass (Level N)` wording is now part of a saved key.

## Alternatives considered

**Write `advancement` alone.** Smaller, and measured wrong above.

**Gate on the campaign option.** It is the obvious reading of the option's name and content does
not back it.

**Add a `spendOn` field to the build step.** Right eventually and unnecessary now: `classType`
already carries the meaning and a new field is a public-API change with one user.

**Compute character level on a decision** (`Warlock 4 · character level 6`). Wanted, and it needs
the engine to publish which track a `<select>`'s owner belongs to. Left for a change that touches
core on its own.
