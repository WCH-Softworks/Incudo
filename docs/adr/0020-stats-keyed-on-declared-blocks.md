# 0020 — An element's declared blocks may publish stats

**Status:** Accepted · 2026-09-10 · builds on [0015](./0015-class-levels.md), [0018](./0018-tables-and-track-stats.md)

## Context

The spell save DC and the spell attack bonus are the last of ROADMAP Phase 2's three
"remaining numbers". The roadmap describes them as nearly done — `aurora verify` already
rebuilds both, reports 0 mismatches across all nine saves, and only the *publishing* is
missing.

The first half of that was wrong, and it is the part worth writing down.

### The check was marking its own homework

`DEFAULT_STATS` in `packages/aurora-import/src/verify-character.ts` carried its own
`saveDcBase: 8`, computed `8 + proficiency + <ability>:modifier`, and compared the result
against Aurora's `8 + proficiency + <ability>:modifier`. The two agreed on all nine saves.

That agreement was worth something real, and less than it looked. It confirms the ability
modifier and the proficiency bonus are right — `<magic>` is the only place in the entire save
format where Aurora records a *derived* ability score, so it is the only way to catch a
character whose Intelligence came out one too low. It did **not** confirm that Incudo could
show a spell save DC, because Incudo did not have one. No stat held it. Nothing derived it. A
sheet had nothing to render, and the check could not have noticed.

So the work is not "publish a number that already exists". It is: make the DC and the attack
bonus stats the **system definition** declares, then point the verifier at Incudo's published
number instead of at a formula it wrote itself.

### What the corpus already says, for the fourth time running

The same shape as the ability score maximum ([ADR 0016](./0016-stat-bounds-are-expressions.md)),
the slot table ([ADR 0018](./0018-tables-and-track-stats.md)) and hit points
([ADR 0019](./0019-recorded-rolls-are-readable.md)): **content contributes only deltas, never
a base.**

```
spellcasting:attack           x31       global bonuses — a robe of the archmagi's +2
spellcasting:dc                x5
<block>:spellcasting:dc       ~3 each   item bonuses — a rod of the pact keeper
<block>:spellcasting:attack   ~3 each
```

No `8`, no base, nowhere in the 740 files. Aurora hardcodes it, as usual. The stat *names* are
already settled by content, though, and that matters: `bard:spellcasting:dc` is a key content
writes to, so whatever Incudo publishes has to land in the same bucket for a magic item's +1
to apply at all.

### Why neither existing keying reaches it

The casting ability is not in a stat. It is an attribute on the element's `<spellcasting>`
block:

```xml
<spellcasting name="Paladin" ability="Charisma" prepare="true">
```

That block is modelled already — `Element.spellcasting: SpellcastingBlock[]`, with `name` and
`ability` — and nothing has ever read `ability`.

And the block's `name` is the stat namespace, and it is **not the class's name**. Twelve
distinct block names appear in the corpus, and two of them are *archetypes*:

```
Arcane Trickster   Artificer   Bard   Cleric   Druid   Eldritch Knight
Mystic   Paladin   Ranger   Sorcerer   Warlock   Wizard
```

An Eldritch Knight's stats are under `eldritch knight:` while its ADR 0015 track is `fighter`.
A commented-out line in `supplements/sword-coast-adventurers-guide/race-duergar.xml` confirms
the convention is deliberate rather than accidental:

```xml
<!-- <stat name="duergar magic:spellcasting:ability" value="Intelligence" /> -->
```

So ADR 0018's `trackStats` cannot do this job: its `{name}` substitutes the *track element's*
name, which is `fighter`. This is the identical wall ADR 0018's "Bad / accepted" section named
when it could not aggregate per-class slot tables into one displayed pool. What is needed is a
third keying — stats keyed on a **block**, the way `trackStats` keys on a track.

## Decision

### 1. Core sees an element's blocks as *a name plus attributes*

```ts
export interface DeclaredBlock {
  name: string;
  attributes: Record<string, string>;
}

export function declaredBlocks(element: Element): DeclaredBlock[];
```

One function, and it is the only place core translates the Aurora-shaped field into the
neutral shape. Nameless blocks are skipped: `<spellcasting all="true" extend="true">` with no
name is 91 of the corpus's 118 blocks, and it extends a list rather than declaring a namespace.

`collectDeclaredBlocks` then merges by name, first declaration winning per attribute. That is
not tidiness. A block name is a stat *namespace*, so contributing once per declaration would
double a Bard's save DC the day a character holds both the 2014 and the 2024 Bard — and those
91 `extend="true"` continuations exist precisely to be the same block as the one that declares
the ability.

### 2. A character kind may declare `blockStats`

```jsonc
"blockStats": [
  { "stat": "{name}:spellcasting:dc",
    "value": 8 + proficiency + {ability}:modifier + spellcasting:dc }
]
```

Read as: **for every distinct block name the character's elements declare, evaluate `value`
and contribute it to `stat`.** Two placeholders, and both work in `stat` and inside a `ref`'s
stat name:

- `{name}` — the block's lowercased name. `"{name}:spellcasting:dc"` publishes
  `bard:spellcasting:dc`, which is the key content already contributes item bonuses to.
- `{anything else}` — that attribute off the block, lowercased. `"{ability}:modifier"`
  resolves to `charisma:modifier` for the Bard and `intelligence:modifier` for the Wizard.

Contributions land with content's and with `trackStats`', before derivations read them, which
is what lets a rod of the pact keeper's `warlock:spellcasting:dc` sit in the same stat and sum.

**An entry whose placeholders do not all resolve contributes nothing and reports itself**
(`unresolved-interpolation`, a problem code that had been declared and never emitted since the
engine was written). A block declaring no ability gives the engine nothing to build a DC from,
and a `ref` to `{ability}:modifier` left unsubstituted would read a stat nothing declares and
quietly publish a DC eight points low. Guessing an ability would be exactly the invention
[ADR 0005](./0005-aurora-import.md)'s "report it, do not guess" rules out.

The whole of 5e's rule is then one line each in `systems/dnd5e/system.json`:

```
dc      = 8 + proficiency + {ability}:modifier + spellcasting:dc
attack  =     proficiency + {ability}:modifier + spellcasting:attack
```

The `8` now lives where the rest of 5e's arithmetic lives, and `saveDcBase` is gone from the
verifier.

### 3. A sheet section may be `perBlock`

```jsonc
{ "id": "spellcasting", "label": "Spellcasting", "perBlock": true,
  "stats": ["{name}:spellcasting:dc", "{name}:spellcasting:attack"] }
```

Without this the numbers exist and nothing can name them. There is no `bard:spellcasting:dc`
in any system definition and there never can be — the key comes from content, and enumerating
the corpus's twelve block names would be wrong the day a source ships a thirteenth.

The flag is also what makes `{name}` mean something in a sheet. Everywhere else in a system
definition `{name}` names the subject of an iteration — a track in `trackStats`, a block in
`blockStats` — and a sheet section iterates nothing until it says what it iterates. A bare
`{name}` in a section, with no flag, would be ambiguous between a track and a block on the
first day someone wanted `level:{name}`.

`renderSheetSection` in core does the expansion, so the CLI sheet, the desktop sheet and the
mobile sheet cannot disagree about what a section shows. A section whose stats do not all
resolve for a block is skipped for that block rather than shown half-empty, and element lists
are *not* repeated per block: a block names a stat namespace, not a filter over the
character's elements, and showing the same spell list under every casting source would be a
confident lie about where each spell came from.

`checkSystemReferences` gains the matching rule: a `perBlock` section's stats are checked
against the kind's `blockStats` patterns rather than against declared stat names. A section
showing `{name}:spellcasting:dc` with no matching `blockStats` entry renders a row of blanks,
and that is the mistake an author actually makes.

### 4. `formatVersion` stays at 1

`blockStats` and `perBlock` are both optional and additive. Every existing system definition
stays valid, and a kind with no `blockStats` behaves exactly as before.
`schemas/system.schema.json` is a public API ([ADR 0011](./0011-user-systems.md)) and this is
the fourth additive change to it in a row. The next breaking one costs a version.

## What the oracle proves

Strong, and it covers the case that breaks the naive approach. Across 7 of the 9 saves Aurora
recorded 8 `dc` rows and 8 `attack` rows on 6 distinct block names — Bard (Charisma), Cleric
(Wisdom), Eldritch Knight (Intelligence), Paladin (Charisma), Warlock (Charisma) ×2, Wizard
(Intelligence) ×2.

**Seven of each are now compared against Incudo's published stat and agree.** The eighth pair
belongs to a wizard carrying a Tome of Clear Thought, worth +2 Intelligence and therefore +1
to both numbers; Aurora folds the bag in and Incudo has nowhere to put it yet, so both are
reported as `not-modelled` and the item is named. That resolves when inventory lands, not here.

Two things worth pinning, because a passing check is easy to over-read:

- **The block name, not the track name, is the namespace: proved.** The Eldritch Knight save
  publishes `eldritch knight:spellcasting:dc` as 16 and `eldritch knight:spellcasting:attack`
  as 8, matching Aurora exactly. A solution keyed on tracks would have written
  `fighter:spellcasting:dc` and matched nothing. That is the one save in the corpus that fails
  loudly under the wrong reading, and it is why it was worth checking for one.
- **The comparison is live, not vacuous.** Both halves were checked by perturbation: changing
  the published `8` to a `9` produces exactly 7 DC mismatches, and swapping `proficiency` for
  `level` in the attack expression produces exactly 7 attack mismatches. A silent "no such
  stat, not compared" would have produced neither. Recorded here because the entire reason
  this ADR exists is that the previous check *looked* like it was proving something.

No other count moved: 1 `element-missing`, 0 `spell-missing`, 0 `stat-mismatch`,
53 `element-extra`, 51 `not-modelled`, 13 `content-missing`, unchanged across all nine saves.

## Consequences

**Good**
- The spell save DC and the attack bonus are stats a sheet can show, per casting source, and
  the arithmetic is in `systems/dnd5e/system.json` rather than in a verifier's defaults.
- `aurora verify` stops grading its own formula. What it compares is now what a user would see.
- Content's existing item bonuses work with no further code: a rod of the pact keeper's
  `warlock:spellcasting:dc` lands in the same stat the kind publishes to, and sums.
- The third keying is the one ADR 0018 said it needed and could not have. Anything a system
  wants to publish per *named source* rather than per class or per character now has a home:
  an attuned relic's resonance threshold, a mech frame's heat ceiling, a patron's own DC.
- `unresolved-interpolation` stops being a problem code nothing ever emits.

**Bad / accepted**
- `Element.spellcasting` keeps its Aurora-shaped name, so core still contains a field called
  `spellcasting`. That wart is pre-existing and this does not widen it — the *system format*
  gained no spellcasting noun, and `declaredBlocks` is the one adapter. Renaming the field is
  a `.incu` content-format change; see below.
- A kind now has three things that produce stats besides `stats` itself: content contributions,
  `trackStats`, and `blockStats`. The ordering is stated in code and in the schema — block
  contributions land with track contributions, before derivations.
- `{name}` now means two different things in two contexts, disambiguated by where it appears.
  `perBlock` exists to stop that becoming three.
- A character deriving an element that declares a block it does not really cast from will
  publish a DC for it. Harmless on the sheet and invisible to the oracle, but it is a statement
  about what content declares rather than about what the character can do.

## Alternatives considered

**Rename `Element.spellcasting` to `Element.blocks`.** The honest fix for the wart, and the one
this ADR would prefer in a vacuum. Rejected on cost: `content.json` inside a `.incu` serializes
an `Element` verbatim, so the field name is part of a format users already have files in
([ADR 0012](./0012-self-contained-saves.md)). Moving it would burn a `formatVersion` on a
change with no behaviour attached to it. The neutral view (`DeclaredBlock`) buys the same thing
at the layer that matters, which is the one the system format sees.

**Name the mechanism after spellcasting** — a `spellcastingStats` on the kind, or a
`castingAbility` field on the progression. Smaller and narrower, and it puts a spellcasting
noun into a vocabulary whose only members are `stat`, `track` and now `block`. ADR 0018
rejected the same shape for the caster level, for the same reason, and it solves exactly one
problem: the next system that publishes per-named-source numbers needs the next such field.

**Put the arithmetic in `packages/aurora-import`'s overlay**, as stat rules on the elements it
already supplies. The smallest change of all — no format change whatsoever. Rejected on the
overlay's own doctrine, exactly as ADR 0018 rejected it for the caster level: marker elements
carry identity and no rules, and a second copy of 5e's arithmetic beside the system
definition's is the copy that goes stale. It would also put a game rule in the package that is
frozen to bugfixes.

**Have the verifier read `Element.spellcasting` and keep computing the DC itself**, now with
the real ability rather than the one the save records. It would be a genuine improvement to the
check, and it would leave the actual deliverable undone: the sheet would still have nothing to
show, and the check would still be grading a formula it owns.

**Let `blockStats` iterate every block declaration rather than every distinct name.** Simpler
code and wrong: 91 of 118 blocks in the corpus are `extend="true"` continuations of a block
declared elsewhere, and a character holding two declarations of one name would get double the
DC. Merging by name is what makes the name a namespace.

**Substitute placeholders only in `stat`, not inside expressions.** Enough for the stat key and
useless for the value, which is where the casting ability is actually needed. The system would
have had to name six ability modifiers and pick between them, which the expression language
cannot do and should not learn to.
