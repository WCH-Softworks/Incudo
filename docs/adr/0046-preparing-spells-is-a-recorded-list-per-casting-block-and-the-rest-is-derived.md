# 0046 — Preparing spells is a recorded list per casting block, and everything else about it is derived

**Status:** Accepted · 2026-09-23 · builds on [0006](./0006-derived-character-state.md),
[0012](./0012-self-contained-saves.md), [0018](./0018-tables-and-track-stats.md),
[0020](./0020-stats-keyed-on-declared-blocks.md),
[0030](./0030-a-declared-block-answers-a-filter.md),
[0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md),
[0044](./0044-hit-points-follow-the-method-the-character-uses.md),
[0045](./0045-a-class-split-is-one-input-and-an-unmet-ability-score-minimum-is-a-flag.md) ·
touches [0008](./0008-aurora-compatibility-frozen.md) (one bugfix to the frozen importer) ·
**format:** an optional `prepared` on `character.json` (`formatVersion` stays 2) and an optional
`preparation` on a character kind in the system format (`formatVersion` stays 1)

## Context

ROADMAP Phase 2's exit criterion is "a level 8 multiclassed Rogue/Wizard with a subclass, feats and prepared
spells is buildable end to end and matches Aurora's output for the same choices". Every clause was met except
the last: **nothing in the builder or the engine modelled preparation**, and `compareWithAurora` does not read
the `prepared` flags a save records. A Wizard could hold a spellbook and could not say which spells were
prepared; a Cleric could hold nothing at all, because a whole-list preparer's prepared spells are recorded
**only** as flags and appear in no other part of a save.

Two things were not settled by what was in the repository, so this ADR measured them first: what a save records,
and what content states as against what Aurora's application code computes.

## What was measured

Against the 30 committed samples (`tools/verify/fixtures/saves/`) and the official corpus at `c28ce6c`.
Samples are described by what they hold. "Aurora's limit" is `manifest.json`'s `readout.prepared`: what Aurora's
own screen showed for the preparable-spell count of each class, typed in by the maintainer (a person's
transcription, the same referee armour class, speed and hit points have).

### What a save records

Every `<spellcasting>` block lists spells in `<cantrips>` and `<spells>`, and a spell may carry three flags:

| flag | what it means, as measured |
|---|---|
| `known="true"` | The character holds the spell: picked through a `select`, or granted. It is on **every** entry of a Wizard block and on a few of a whole-list preparer's; the only flag a known caster (Bard, Sorcerer, Warlock, Ranger, an Eldritch Knight, an Arcane Trickster) ever records. |
| `prepared="true"` | The spell is on the prepared list. Recorded by exactly the classes whose content says `prepare="true"`, and by no other block in any of the 30. |
| `always-prepared="true"` | On a whole-list preparer, a spell the character holds without preparing it, and always also `prepared`. **On a Wizard it is set on every spellbook entry, prepared or not**, so on a book it carries no information. |

**Where the two kinds of preparer differ.** A Wizard's `<spells>` is its spellbook, and every entry is `known`. A
Cleric, Druid, Paladin or Artificer's `<spells>` is the class's whole list up to its highest slot level, with the
flags on the few that are held or prepared (Cleric 20: 219 listed, 21 prepared; Druid 6: 122 listed, 9 prepared).
Those spells are **not in the save's `<sum>`**, so Incudo's derivation, which matches the `<sum>`, never holds
them, and the flags are the only record.

### Per block, across the 13 saves that record one (15 blocks)

Unique spell ids (one Wizard 4 / Artificer 3 save lists two spells twice in each block). "Always" is what content
makes always prepared, by a grant with `prepared="true"`; "chosen" is prepared spells less those.

| sample | block | listed | prepared | always | chosen | Aurora's limit | Incudo's limit *before* |
|---|---|---:|---:|---:|---:|---:|---:|
| 08 Wizard 1 | Wizard | 6 | 3 | book | 3 | 4 | 4 |
| 16 2024 Wizard 5 | Wizard | 17 | 9 | book | 9 | 9 | 9 |
| 06 Rogue 4 / Wizard 4 | Wizard | 12 | 6 | book | 6 | 6 | 6 |
| 05 Wizard 3 / Rogue 3 / Warlock 3 | Wizard | 10 | 6 | book | 6 | 6 | 6 |
| 04 Wizard 4 / Paladin 3 / Fighter 3 | Wizard | 12 | 8 | book | 8 | 8 | 8 |
| 04 | Paladin | 33 | 5 | 2 | 3 | 3 | **2** |
| 03 Wizard 4 / Artificer 3 | Wizard | 12 | 10 | book | **10** | 8 | 8 |
| 03 | Artificer | 34 | 7 | 2 | 5 | 5 | **4** |
| 01 Artificer 5 | Artificer | 77 | 10 | 4 | 6 | 6 | **4** |
| 02 Paladin 3 / Sorcerer 3 | Paladin | 33 | 5 | 2 | 3 | 3 | **2** |
| 18 Paladin 3 / Ranger 3 | Paladin | 16 | 5 | 2 | 3 | 3 | **2** |
| 07 Cleric 20 | Cleric | 219 | 21 | 10 | 11 | 25 | 25 |
| 24 2024 Cleric 3 | Cleric | 32 | 10 | 4 | 6 | 6 | 6 |
| 12 Druid 6 | Druid | 122 | 9 | 0 | 9 | 11 | 11 |
| 25 2024 Druid 3 | Druid | 43 | 9 | 3 | 6 | 6 | 6 |

The other 17 samples record no prepared flag and Aurora's screen reads 0 for each of their classes, including the
2024 Paladin and Ranger (samples 15 and 17), which content does not declare as preparers, so Incudo's answer is 0
as well.

What follows from it, each reading from the table and none from a formula:

1. **The limit is already in content.** Every preparing class ships `<class>:spellcasting:prepare` as level and
   ability stats: Wizard `intelligence:modifier` + `level:wizard`; Cleric and Druid `wisdom:modifier` + their level;
   Paladin `charisma:modifier` + `level:paladin:half`; Artificer `intelligence:modifier` + `level:artificer:half`;
   and the 2024 editions as a table of `+N` rows. **Incudo already derived the stat and agreed with Aurora's screen
   for 10 of the 15 blocks.** This is the third time the answer was "content says it and Incudo was not reading it".
2. **The 5 that disagreed are all one thing: `:half`.** Every one is a Paladin or an Artificer, and Incudo was short
   by exactly half the class level rounded down (Paladin 3: 1; Artificer 5: 2; Artificer 3: 1). A stat reference with
   a `:half` suffix was read as a stat *named* `level:paladin:half`, which nothing publishes, so it contributed 0.
   The corpus has **61 such references**: `proficiency:half` 43, `level:<class>:half` 12, `proficiency:half:up` 4,
   `intelligence:modifier:half:up` 1, `level:half` 1. The other 57 (all but the four spell limits) feed other stats
   at 0: Jack of All Trades' skill and initiative bonus, a Druid's wild shape hours, a Fighter's steady aim damage.
   The limit is the first time a *measured* number depends on it, and the rounds-down reading is confirmed by five
   separate blocks against Aurora's screen.
3. **A multiclass caster splits the limit per class, and Aurora shows it per class.** The readout for the Wizard 4 /
   Paladin 3 / Fighter 3 is `8/3/0`: each block has its own limit from its own class level and its own ability
   modifier, nothing is shared. The shared caster level plays no part.
4. **Always-prepared spells do not count against the limit.** With them set aside, 14 of the 15 blocks are at or under
   their limit, including the Artificer of sample 03, which records 7 prepared against a limit of 5 and is exactly at
   it once its two always-prepared spells (its specialist's, granted at level 3) are set aside.
5. **Aurora does not enforce the limit.** The one real over-limit case in the set is the Wizard of sample 03: 10
   prepared against a limit of 8. That is the reason the number must be a report and not a refusal (below).
6. **An always-prepared spell need not be on the block's own list.** An Artificer's specialist spells (Healing Word,
   Ray of Sickness, Flaming Sphere, Melf's Acid Arrow in sample 01) are Cleric and Wizard spells. They are on the
   list by a grant, not by the class's list, and **taking the marker away from the grant makes them unpreparable, not
   over the limit** (a perturbation below).
7. **Aurora marks a held spell always prepared in every block whose list has it.** Samples 18 and 24 flag one more
   always-prepared spell than content does: a Ranger's known spell that is also on the Paladin's list, and a spell a
   feat's own select picked that is also on the Cleric's. Content marks only what a grant says, so Incudo counts
   those two as chosen. The *set* of prepared spells agrees with the flags either way, and neither reading puts
   either block over its limit, so it is reported and not asserted.
8. **The pool.** For all 9 list blocks every spell Aurora lists is on Incudo's list or offered by it (0 missing). For
   all 6 book blocks what Incudo holds and offers is what Aurora lists, exactly. A list block offers *more* than
   Aurora's: content from sources and editions Aurora had switched off (a 2024 Druid lists 43; the 2014 and Unearthed
   Arcana spells of its level are offered too). Incudo has no way to know a save's switched-off sources, and offering
   more is where a per-character source allowlist would narrow it (ADR 0028), as it already does for every other pool.
9. **Aurora's own listing says which blocks are books.** A block whose `<spells>` holds only spells the character
   knows is a book, and every other block lists the class. That holds for all 15 and is the second witness for
   decision 4.

### What content states and what Aurora's code computes

| | stated by content | computed in Aurora's application code |
|---|---|---|
| that a class prepares | `<spellcasting prepare="true">` on Wizard, Cleric, Druid, Paladin 2014, Artificer, and the 2024 Wizard, Cleric, Druid; `prepare="false"` on Bard and the Eldritch Knight; nothing on the 2024 Paladin and Ranger | |
| how many | `<class>:spellcasting:prepare` stats (above) | `:half` (read as floor) |
| which spells are always prepared | `<grant type="Spell" spellcasting="X" prepared="true">`, 708 in the corpus, and four `<select … prepared="true">` | which held spells are *also* shown as always prepared (reading 7) |
| which spells are on a spellbook | `<select type="Spell" name="Spellbook (Wizard)" spellcasting="Wizard">`, 40 uses, both editions | |
| which spells a whole-list preparer chooses from | `<list>` on the block gives the class's tag, and `supports="$(spellcasting:list), $(spellcasting:slots)"` is the way every spell select already says "on this class's list and of a level I have slots for" (ADR 0030) | **the expansion of a whole list is Aurora's code** (`compareSpellcasting` already says so); which classes are lists and which are books is **not stated by content** |
| the Wizard's minimum of one | not stated | possibly; no sample tests it |

The last two rows are what decision 4 is about. Content does not say "a Wizard prepares from a book and a Cleric
from a list". It says a Wizard has a select named `Spellbook (…)` for its block, and that no other preparing class
does.

### Two things measured and left out of this decision

- **Rituals.** The roadmap asks whether the `Ritual` support filter (17 uses; a spell carries
  `<set name="isRitual">true</set>`) belongs here. **It does not.** A ritual is cast without being prepared, so no
  number in this ADR depends on it, and the filter it needs is a fourth operand in the `supports` language (ADR 0030)
  with a single witness at best: sample 06 records the Ritual Caster feat's two spells (Comprehend Languages, Alarm)
  as `<additional>` entries whose ids are known but whose *tag* is not. It stays the one named exception in
  `rogue-wizard-aurora.test.ts` and is its own change.
  *(Note, 2026-09-23: that change is [ADR 0047](./0047-a-filter-operand-may-name-a-true-setter-and-the-system-says-which.md).
  The second witness was in the samples after all: sample 30's Pact of the Tome picks two more rituals. The named
  exception is gone.)*
- **The 2024 Paladin and Ranger.** The player's book prepares from a fixed table; the corpus declares no `prepare`,
  and Aurora's screen reads 0 (the maintainer noted it). Incudo agrees with Aurora's screen and says so; it does not
  invent a table content does not carry (ADR 0005).

## Decision

### 1. `:half` and `:half:up` are read as arithmetic on the reference

A reference `X:half` is `floor(X / 2)` and `X:half:up` is `ceil(X / 2)`, where `X` is the reference without the
suffix. It is read **when a reference is evaluated** (`evaluateExpr` in `packages/core/src/expression.ts`), not
where a value is parsed, because a `.incu` embeds the *parsed* elements it uses (ADR 0012): a parse-time reading
would leave every character saved before it with a Paladin's limit of zero until it was saved again. The reference
stays a plain reference in the parsed form, so an old save and a fresh parse read the same.

No game noun enters core: "half" is arithmetic, and the reference it applies to is whatever content wrote. It is
general on purpose. Reading it only for the two classes that need it would leave the other 57 at zero for no reason
a reader could find. **A stat that really is published under the suffixed name wins by being non-zero**; none is:
0 of 14,320 elements and neither shipped system declares one. This is not a change to the frozen importer (ADR
0008): it produces the same `StatRule` and core reads it.

### 2. What a player chooses to prepare is one recorded input: `Character.prepared`

`prepared?: Record<string, ElementId[]>`, keyed by the **lowercased block name** (`"wizard"`, `"cleric"`, the same
key a block's stats are namespaced by, ADR 0020), each value the elements the player put on that block's list, in
the order they were added. It is an input in ADR 0006's sense: nothing produces which spells a Cleric prepared. It is
absent when empty, exactly as `advancement` is when there is one class.

- **It holds what the player marked, and content's always-prepared spells may appear in it and count for nothing.**
  The importer copies every `prepared="true"` flag it reads (decision 5), and Aurora's flags include the granted
  ones. Making the importer strip them would need the derivation, and the strip would be a derived value stored
  twice. So the derivation ignores an id it also finds always prepared, and the builder never writes one.
- **Only preparing blocks are read.** A list kept for a block that no longer prepares (a class taken off) stays in
  the character and is shown nowhere; nothing prunes it, as nothing prunes the picks of a class whose levels went
  away (ADR 0036).
- **`formatVersion` stays 2.** The field is additive and optional like `baseStats`, `advancement`, `generation` and
  `declinedDecisions`, none of which moved it, and unlike `inventory`, which did because a save written with one is
  *wrong* when read by a writer that drops it (ADR 0024). A reader that does not know `prepared` loses the list and
  nothing else derives differently. The JSON Schema gains the property.
- **The elements are embedded in the save** (ADR 0012): `collectCharacterContent` seeds from every id in `prepared`,
  so a Cleric's prepared spells, which no other part of the character names, still open with their names and
  descriptions and with zero sources. They **do not seed the derivation**: Aurora's `<sum>` does not hold them
  either, and adding them would make `element-extra` differences the oracle has never had.

### 3. What derives: the limit, what is always prepared, and what is over

A character kind may declare `preparation`, data a system authors, in the shape the ADR 0018/0022/0044 declarations
already use:

```json
"preparation": {
  "blockAttribute": "prepare",
  "limit": "{name}:spellcasting:prepare",
  "elementType": "Spell",
  "heldSelect": "Spellbook",
  "listFilter": "$(spellcasting:list), $(spellcasting:slots)",
  "heldFilter": "$(spellcasting:slots)"
}
```

Core says none of `spell`, `prepare` or `spellbook`. A declared block whose `blockAttribute` reads `true` prepares;
its limit is the named stat with `{name}` the block's name; `elementType` says what is prepared; `heldSelect`
(optional) is the prefix of a select whose picks form a book; `listFilter` and `heldFilter` are `supports`
expressions in the ADR 0030 language, so "of a level you have slots for" is the existing rule and not a new one.
`validateGameSystem` refuses a limit with no `{name}`, a filter that does not parse, and one that names an
expansion the kind never makes.

`deriveCharacter` publishes `preparation: PreparedBlock[]`, one entry per preparing block, computed after the fixed
point because the limit is a derived stat and what is always prepared depends on which tracks reached which level
(`packages/core/src/preparation.ts`, pure; the engine finds what each block holds and hands it over):

```
{ key, name, limit, mode: 'held' | 'list', always, held, chosen, unavailable, over }
```

- **`always`**: elements attached to the block by a grant or a recorded pick that carries the `prepared` marker,
  gated as every other rule is (a domain spell arrives at its level; a second class's rules gate on that class).
- **`mode`** is `held` when an active select attached to the block has a name starting with `heldSelect`, and `list`
  otherwise. **`held`** is then what the block holds (grants and picks) that passes `heldFilter`, less `always`.
- **`chosen`** is `prepared[key]` less duplicates, less `always`, and only what the block can prepare: for `held`,
  what is in `held`; for `list`, what passes `listFilter`.
- **`unavailable`** is the rest of the recorded list: counted for nothing, shown so it can be taken off.
- **`over`** is `max(0, chosen − limit)`, and a positive one is the **error** `over-prepared` in
  `derived.problems`, in `over-attuned`'s family. Never a refusal: a character is edited constantly, and the one real
  case in the set is over. An `unavailable` element is the warning `not-preparable`.

Offering is separate: `preparationPool(derived, index, key)` returns what a block could still have prepared. A whole
list is over two hundred spells for a level 20 Cleric, and a derivation that runs on every keystroke should not
scan for a list nobody is looking at. A list is *matched* against the ids that are recorded (one filter run per
recorded spell) and *built* only when asked for.

### 4. `heldSelect` is an assumption in system data, and Aurora's own listing is its witness

The only content signal that a Wizard prepares from a book is the name of its select. It holds in all 40 uses in
both editions, and a third-party class that names its book something else falls to the list mode, which is
permissive (it offers more, and never less). It is data a system author can change and not a rule core knows.
Reading it from the class's own rules by looking at whether any select's filter admits a level above 0 was rejected:
it is a walk of a `supports` tree to learn what a name already says. The measurement (reading 9) gives it a
witness: the oracle holds the mode to Aurora's own listing (a block that lists only known spells is a book) on all
15 blocks, so a class the assumption gets wrong fails there.

### 5. The importer copies what has no other home, and nothing else

A bugfix to the frozen importer (ADR 0008 allows it: today the flags are read into `AuroraSpellcasting` and dropped,
so a whole-list preparer's prepared list is lost on import, which is data loss on a real save). For each
`<spellcasting>` block whose entries carry `prepared="true"`, the ids are written to
`character.prepared[<lowercased block name>]`, duplicates dropped, in save order. Nothing is derived, resolved or
corrected there: `always-prepared` is not read (decision 2), the limit is not compared, an id not in the index is
written as it is and the derivation reports it. A save with no flag produces no `prepared`, byte for byte the
character it produced before.

### 6. The oracle holds preparation to Aurora, outside the frozen package

`compareWithAurora` is not touched. `tools/verify/src/aurora-oracle.ts` gains `preparationViolations`, run for all 30
samples in `aurora-oracle.test.ts`. For every block a save flags a spell prepared in: Incudo has a prepared list for
it; the spells on it (always and chosen) are the flagged ones, exactly; nothing recorded is one it cannot prepare;
it prepares from a book exactly when Aurora's own listing is one; and everything Aurora lists is held or offered
(exactly, for a book). Across the save, the limits Incudo derives are the ones Aurora's screen showed, compared as a
multiset of the non-zero numbers because the readout is per class in class order and a class that does not prepare
reads 0. The always-prepared *count* is reported (`MOVED`-style, per save) and not asserted (reading 7).

Every one of them holds on all 30, so they are held and not reported. `tools/verify/src/preparation.test.ts` is
what shows the check can fail, by breaking the rule in each way it can be broken and naming the samples that must
notice, found by what the saves hold and never by name or count: without the importer's copy (every sample that
records a flag); with a limit that names the wrong stat, and with one one too low (every sample whose screen showed
a count); with `:half` read as nothing (the samples with a preparing Paladin or Artificer); with no book (every book
block); with a list filter that offers only first-level spells (every list block that lists a higher one); and with
no grant marking anything always prepared (every list that would then be over its limit gets a new problem).
`builder-rebuild.test.ts` rebuilds every sample through the builder and requires each prepared spell to be
**offered** before it is prepared, and `rogue-wizard-aurora.test.ts` does the same for the Rogue 4 / Wizard 4, closing
the last clause of Phase 2's exit criterion.

### 7. The builder writes one recorded list, and the screen renders it

`CharacterBuilder` gains `prepare(key, id)`, `unprepare(key, id)`, `preparationOptionsFor(key)` and
`BuilderState.preparation`, a view-model in `packages/ui/src/preparation.ts` that computes everything (per block: the
limit, the count, the always list, the chosen list with names and the system's note, what is unavailable, and what is
over), as `multiclass.ts` does for classes. `apps/desktop/src/panes/PreparedSpells.tsx` renders it in the Build
pane and computes nothing. **`prepare` refuses what the pool does not contain and does not refuse going past the
limit**: the character is allowed to exist over it and the row says by how much, the stance ADR 0045 took about
ability scores, applied to a report. A multiclass caster gets one row per block, each with its own limit. What is
prepared is never offered by a screen until the character has it: a book offers what it holds, and a list offers what
its filter admits from the content loaded or embedded.

### 8. What is not modelled

- The Wizard's "minimum of one spell", which content does not state and no sample tests.
- The 2024 Paladin's and Ranger's fixed tables (above).
- Ritual casting (above).
- *When* a list may be changed (a long rest). A character has one list.
- Spell **slots** being spent, and any per-day state: the builder builds a character, it does not run one.
- A per-character source allowlist narrowing the list pool (reading 8).
- A prepared list on the **Sheet**; the Build pane shows it and the sheet does not yet.

## Consequences

- One engine-neutral concept, `preparation`, that a system with a different magic system can declare or omit. A kind
  that omits it publishes an empty list and nothing changes for it.
- Sample 03 gains one `over-prepared` problem in the oracle's `problems` count (its Wizard, 10 of 8), which is the
  point. **Every other oracle table is identical** against a snapshot taken on the base commit
  (`INCUDO_ORACLE_SNAPSHOT` on the base, `INCUDO_ORACLE_BASELINE` on this change): the only line that moved is
  `Sample 03  problems 0 -> 1`. The manifest's recorded table for it says 1.
- The 57 other stats that read a `:half` suffix now contribute (Jack of All Trades, initiative, wild shape hours, …).
  They are content the corpus has always stated. The oracle compares none of them, so it is neither evidence for nor
  against them; the unit tests are.
- The importer writes one more field. A re-save of an imported character now keeps its prepared list where it used to
  lose it, and `compareWithAurora`'s differences are unaffected.

## What this cannot verify

- Aurora's screen is a person's transcription (as for armour class, speed and hit points), and the flags are one
  save's record of one session.
- Aurora does not enforce the limit, so a recorded set over it says nothing about what the rules allow.
- The `held`/`list` choice is checked against 15 blocks and one naming convention.
- **In the running app** (the browser build, `npm run desktop`): a Fighter 12 / Wizard 5 taking a Cleric level was
  built, a book of 14 spells filled, five prepared, a sixth reported over and taken off, a Cleric list of 114 spells
  offered at the levels the shared slots allow, and the lists survived a reload. **Not driven:** saving to a library
  folder and reopening (both need a dialog no script can answer; the tests pack and reopen all 13 samples with a
  list, with zero sources), the Tauri window, and macOS and Linux. The browser pane would not render screenshots, so
  the screen was read from the page rather than looked at.
