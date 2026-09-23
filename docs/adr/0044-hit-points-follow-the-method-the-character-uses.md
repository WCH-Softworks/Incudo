# 0044 — Hit points follow the method the character uses, and each class keeps its own dice

**Status:** Accepted · 2026-09-23 · builds on [0007](./0007-native-formats.md), [0015](./0015-class-levels.md),
[0016](./0016-stat-bounds-are-expressions.md), [0018](./0018-tables-and-track-stats.md),
[0019](./0019-recorded-rolls-are-readable.md), [0022](./0022-kinds-contribute-systems-do-not-ship-content.md),
[0032](./0032-a-build-step-may-offer-a-set.md), [0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md) ·
amends [0019](./0019-recorded-rolls-are-readable.md) (decision 2) and, for one bug, the freeze of
[0008](./0008-aurora-compatibility-frozen.md) · **additive system-format change, `formatVersion` stays 1**

## Context

`hp` sums every die a save records, adds the Constitution modifier once per level, and adds what content
contributes ([ADR 0019](./0019-recorded-rolls-are-readable.md)). The maintainer read hit points off Aurora's
screen for the 30 sample saves (`manifest.json`, `readout`); the derivation disagrees on 18. ROADMAP Phase 2
named three suspects. This ADR is what measuring them found: three suspects, and a fourth thing nobody had
named.

**The method.** For each sample I rebuilt the number by hand from three parts (dice, Constitution modifier ×
level, and what Incudo's own derivation already gets from content) and compared it with the readout. The
dice part was taken from the rule each save's options and class split imply, never from the derivation
under test.

### What Aurora does, as measured

1. **The campaign option `ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP` decides where the dice come from, for the
   whole character.** It is on in 15 of 30 samples. With it on, the dice in `rndhp` are stale (one sample
   records `8,8,8` for levels the screen counts as 8, 5, 5) and every level is the die's average,
   `floor(sides / 2) + 1`, except the very first level of the character, which is the die's maximum. With it
   off, the recorded dice are the applied values (10 samples are single-class; the maintainer set the
   average by hand in some and rolled in one).
2. **A class carries its own list of dice, and the list is indexed by the class's level, not the
   character's.** `rndhp` sits on the `<element type="Level">` where a class began (`starting="true"` and
   `class=…` on every class after the first), one list per class: every multiclass sample has exactly as many
   lists as classes. A Rogue 4 / Wizard 4 built one level at a time has the Rogue's list on level 1 and the
   Wizard's on level 2, and the Wizard's fourth level (character level 8) reads the *fourth* entry of the
   Wizard's list. The importer keeps only the first list and files it under character levels
   (`hp:level:1..20`), so a second class's dice are **dropped** and the first class's entries are read for
   levels they never belonged to. The first level of a class that is not the character's first is not the
   maximum: it is whatever that class's list says, and with the option on, the average.
3. **An item can set an ability score.** The Amulet of Health writes
   `<stat name="constitution:score:set" value="19" bonus="base" />`; 35 such rules exist (27 for Strength).
   Nothing in the system definition reads that stat, so a Constitution 14 wearer stays at 14. Two samples
   (a Rogue 5 with it, and its attunement-limit variant) read exactly 10 hit points low: 5 levels times the
   difference between a modifier of +4 and +2.
4. **A subclass's per-class-level hit points are lost for every single-class character.** Draconic
   Resilience writes `<stat name="hp" value="level:sorcerer" />`, and `level:sorcerer` is a track count
   ([ADR 0015](./0015-class-levels.md)). `advancement` exists only while there is more than one class
   ([ADR 0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md)), so a single-class character has
   no track and the stat is never published: the sample Sorcerer 3 with that subclass reads 3 low. This is not
   a hit point problem in itself: 79 rules read `level:ranger`, 66 `level:bard`, and so on, and they all read
   0 for a single-class character. Hit points are only where a sample first showed it: no
   other stat that reads it has a referee on screen.

### The model against the samples

With dice chosen by method and per-class lists (decisions 1 to 3), the rebuilt number agrees with the readout
on **27 of 30**. The other three are exactly the gaps items 3 and 4 name (the two Amulet of Health samples and
the 2024 Sorcerer), and with decisions 4 and 5 the model agrees on **30 of 30**:

| group | samples | result |
|---|---|---|
| option off, single class, recorded dice | 10 | agree, except the two Amulet of Health samples: off by exactly 10 (item 3) |
| option off, multiclass | 5 (samples 02 to 06) | agree only with per-class lists; with today's import the roadmap measured −6 to +18 off (item 2) |
| option on, single class | 12 | agree with average dice, except the 2024 Sorcerer: off by 3 (item 4) |
| option on, multiclass | 3 | agree with average dice, the first level of the second class averaged, not maximised |

The Fighter 20 whose dice the maintainer rolled agrees on the recorded dice. Everything above is from the
committed samples and the current official corpus, and can be re-run. I did not write code for this ADR:
the rebuild was a throwaway script that read the same public import and derivation the tests use.

## Decision

### 1. The option is an input that chooses where a character's dice come from; it does not replace them

The character records the option as any campaign option is recorded ([ADR 0032](./0032-a-build-step-may-offer-a-set.md)).
The derivation reads it. **With it on, hit point dice are calculated from each level's class die; with it
off, they are the recorded rolls.** `rolls` keeps everything it holds either way, so turning the option off
again returns the dice the user had ([ADR 0007](./0007-native-formats.md): a recorded result never
silently disappears). Nothing is copied: a recorded die is only read when it is the thing that has no
formula.

This amends [ADR 0019](./0019-recorded-rolls-are-readable.md) decision 2 and its rejected alternative
"take the average where no roll is recorded". That was rejected because it made one number half input and
half formula, so the sheet would change the moment a roll arrived. This is not that: the option is one
switch, per character, saying which of the two sources the whole set of levels uses, and no level mixes
them. A character with the option off and a level unrolled still has no dice for that level, visibly, as
before.

### 2. How the format says it

Additive, and every existing definition stays valid:

- **A kind `contribution` publishes a flag stat while the option is in the character's elements**
  (`requirements: "ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP"`, [ADR 0022](./0022-kinds-contribute-systems-do-not-ship-content.md)).
  The requirement is a membership test on a content id, which the format already has.
- **`trackStats` gains two readings** ([ADR 0018](./0018-tables-and-track-stats.md)): a track's own
  `track:first` (1 when the track holds the character's first level, else 0) beside `track:progress`, and an
  expression `{ "kind": "setter", "name": "hd", "as": "dieSides" }` that reads a setter off the *track's
  root element* and takes the face count of a `dN` value. It is meaningful only inside `trackStats`; elsewhere
  it reads 0 and reports a warning (ADR 0005: an unreadable die is visible, not a wrong total). `hd` is named
  in `system.json`, so core learns no game noun; `dieSides` is the one parsing rule, `d` followed by digits.
- **`hp` for the player character** becomes `flag × (track sum) + (1 − flag) × rolls + Constitution modifier ×
  level`, where the track sum per class is `progress × (floor(sides / 2) + 1) + first × (sides − (floor(sides /
  2) + 1))`: every level the average and the first level of the first class the maximum.

### 3. Rolls stay keyed by character level; the importer stops dropping a class's own dice

`hp:level:{n}` keeps meaning "the die of the level the character took at n" ([ADR 0019](./0019-recorded-rolls-are-readable.md)),
which is what the builder already writes, so **there is no format change on the character side**. The
importer's `toRolls` is the bug: it reads only the first list, and files its entries under levels by
position. It is changed to map each class's list onto the levels that class was taken at, from the
`advancement` the importer already builds:

> for each class C with a list, the k-th level given to C, at character level *n*, records
> `hp:level:n = list[k]`.

This is a **bugfix to the frozen importer** ([ADR 0008](./0008-aurora-compatibility-frozen.md): bugfix
only; no export, no speculative support). It is data loss of a recorded result, and nothing in the change
adds support for anything Aurora did not already write. A single-class save is unchanged, including the
unused tail of the 20-entry list, which is kept so that levelling up later does not reroll it. In a
multiclass save the entries past a class's last level belong to no character level yet, so they are not
copied; the consequence is that levelling further into that class rolls a fresh die. Named, not hidden.

`compareWithAurora` is untouched: it compares elements and stats Aurora records, never hit points.

### 4. An item that sets an ability score is a lower bound on it

Each ability's stat gains `"min": { "ref": "<ability>:score:set" }` in `systems/dnd5e/system.json`. The
bound exists since [ADR 0016](./0016-stat-bounds-are-expressions.md) and clamps upward; `:score:set` is
already contributed by content in a `base` bucket, so the largest of several items wins, and an item that
sets a score the character already exceeds does nothing, which is the rule the item states. This fixes
armour class, saves, attack rolls and every other reader of the score as well as hit points.
**To check while doing it, not decided here:** the 2024 giant-strength belts write `strength:score:set` in a
second, differently named bucket (`might of giants`), and buckets sum. Two belts in different buckets
must not read as the sum of both.
**Done (step 1), and the bound needed one more half than the sketch above.** A set score may exceed the usual
20 (the 2014 Belt of Hill Giant Strength sets 21, and nothing raises `strength:max`), so a `min` alone would have
been clamped back to 20 by the `max`. The maximum is now `max(20 + <ability>:max, <ability>:score:set)`. The
2024 giant-strength belts write small deltas in a `might of giants` bucket beside a base value, and buckets
sum by design, so no change was needed for them; that check is closed. Evidence: the two Amulet of Health
samples leave the hit point disagreement list (18 disagreeing samples became 16), every other sample and
every oracle table is byte-identical to before (snapshot/baseline run), and
`tools/verify/src/ability-score-set.test.ts` fails 3 of its 4 cases with the bounds removed.

**Done (step 2), and its proof.** `progression.trackType` (5e: `Class`) names the type; the single element of it a
character with no advancement holds is an implicit track that publishes `level:<name>` and takes part in
track stats, and is not handed to the gates. Oracle tables are identical to the pre-change snapshot over all
30 samples. `single-class-track.test.ts` holds it on the 22 single-class samples and fails without the declared
type; `engine.test.ts` has the perturbation and the two refusals (two candidates, and a recorded advancement).
The 2024 Sorcerer's hit points now include the +3 and read 26 against the 23 shown, until step 4 replaces the
stale dice with averages.

**Done (step 3), and its proof.** `parse-save` keeps each Level's own list; `toRolls` files each class's list
under the character levels that class was taken at, found from the advancement the importer already builds
(the list sits on the level the class began at, so that level's advancement entry names the class). A
save with no resolvable advancement keeps the old by-position behaviour. Samples 02 to 06, the five multiclass
samples without the option, now read what Aurora showed (were 1 to 18 off), held by
`multiclass-hit-dice.test.ts`, which fails on the old importer, and by a hand-written interleaved save in
`import-character.test.ts` that gets the old numbers back when the two source files are reverted. Oracle
tables unchanged.

### 5. A single class gets a track that is published and does not gate

The engine gives a character with no `advancement` an implicit track: the single element of the kind's
declared `progression.trackType` (5e: `Class`) that its choices and seeds reached, with count equal to
`progress`. It publishes `level:<name>`, `track:progress` and `track:first` and takes part in `trackStats`;
it **does not** gate, defer or re-order anything. An untracked character already reads "the whole
progression" for every gate ([ADR 0015](./0015-class-levels.md)), which is right for one class; only the
*published counts* were missing.

Why in the engine and not in the data: [ADR 0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md)
chose that a single-class character carries no `advancement`, and every save written so far, imported or
built, agrees. A rule in the derivation fixes every existing save the day it ships; a rule that writes
`advancement` for a single class would fix only the ones saved afterwards, and would change
the ADR 0036 record for no reason but this.

### 6. The builder stops asking for what the option makes irrelevant

`levelRoll` on a build step gains an optional `fixedWhen` element id (5e: the same option). While that
element is in the character, `computeHitPointState` publishes each level's average as its value and opens no
hit points decision. The rolls a user already recorded stay recorded and unread. With the option off,
the builder is unchanged, and it already keys a roll by character level, so a second class's first level
is offered as a roll, not as the maximum: `isFirst` is the progression's first level only.

**Done (step 4), and its proof.** Built as decided, with two amendments. (1) The first level is the die's
maximum in the builder's published value too, not "each level's average" as decision 6 was worded:
`HitPointLevel.fixedValue` is the maximum at the progression's first level and the average after, because that is
what the derivation sums and the two must agree. (2) The kind contribution and the per-class sum are stats
(`hp:average`, `hp:average:dice`) in `systems/dnd5e/system.json`; core gained a `setter` expression, the reserved
`track:first`, and a `setter-outside-track` warning for a `setter` outside `trackStats`. The 11 samples that still
differed (14, 15, 16, 18, 19, 22, 23, 24, 25, 27, 29) now agree, so **all 30 do**. Perturbation: ignoring the option
fails exactly those 11; dropping the `track:first` term or the `track:progress` term fails 15; reading the option as
always on fails samples 04, 10 and 20, whose recorded dice are not the averages; dropping the rolls branch fails the 15
option-off samples. Oracle tables are identical to the snapshot taken before the change.
`engine.test.ts`, `use-character-builder.test.ts` and `schemas.test.ts` carry corpus-free tests of the expression,
`track:first`, the flag, `fixedWhen` and the schema.

**Done (step 5).** `aurora-oracle.test.ts` holds hit points to the readout, as it holds armour class and speed.

## Consequences

**Good**
- Hit points agree with Aurora's screen on all 30 samples, including the hand-set averages and the one
  rolled character, and the oracle test can hold them the way it holds armour class and speed.
- A character built or imported with the option on has hit points with no rolls at all.
- The ability-score fix and the single-class track fix are worth having without hit points: they move armour
  class for anyone with a belt or an amulet, and every `level:<class>` read for anyone with one class.
- No character-side format change, so no migration and no reader has to change.

**Bad / accepted**
- **The frozen importer changes**, for one bug, and it changes what a multiclass save imports (its rolls).
  No comparison against Aurora moves: the oracle compares elements and stats, not hit points, and the
  snapshot/baseline run ([ADR 0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md))
  is how that is shown, not assumed.
- **A single-class character's derivation changes shape** (decision 5): more stats exist and every read of
  `level:<class>` that read 0 now reads the level. That is the point, and it is also a behaviour change for
  every class feature that scales with it. It is measured with the same snapshot run, and any element or
  stat that moves is looked at, not accepted in bulk.
- **Two unused entries in a multiclass save's lists are not kept** (decision 3).
- **`hp` still has no oracle in the save file.** The referee is a person reading a screen, and the oracle
  test's readout comparison is the only check. That the maintainer's readings are right is taken from them.

**Order of work, each step provable alone**
1. Ability score minimum (decision 4). Proof: the two samples move by exactly 10, no other sample's armour class
   or oracle table moves.
2. The single-class track (decision 5). Proof: the 2024 Sorcerer moves by 3; snapshot/baseline over all 30.
3. The importer mapping (decision 3). Proof: the five option-off multiclass samples; rebuilding a
   multiclass sample through the builder (`builder-rebuild`) gives the same rolls as importing it.
4. The option and `hp` (decisions 1 and 2), then the builder (decision 6). Proof: the 15 option-on samples;
   perturbation by removing each term, and by flipping the option, must fail specific samples.
5. Hold `hp` to the readout in `aurora-oracle.test.ts` only when it agrees on all 30.

## Alternatives considered

**The builder records the averages as rolls, and the derivation stays as it is.** The obvious small change,
and it fails on what already exists: every imported save with the option on carries stale dice and no one
opens the builder to overwrite them, so the sheet would keep disagreeing with Aurora's until someone did. It
also turns off "turn the option off again and get your dice back", and it makes the number depend on which
tool last touched the character.

**Compute averages in the importer.** Copies a cheap calculation into a file at import time, which the
roadmap's principle rejects, and it needs a class's die inside a frozen package.

**Read the second class's list by position, as today.** Measured: it is wrong for every multiclass save and
right for none, by an amount that depends on how the classes interleave.

**Write `advancement` for a single class.** See decision 5.

**A hit point special case in the engine** (a `hitPoints` block on the kind that knows dice). Faster to write
and it puts a game noun in core. Everything above is expressible with a per-track contribution, a flag and one
reading of a setter, which any system with a per-class quantity can reuse.

**Ask the user which method a save used.** Aurora records it (the option element); asking would be
re-asking something the file already answers.
