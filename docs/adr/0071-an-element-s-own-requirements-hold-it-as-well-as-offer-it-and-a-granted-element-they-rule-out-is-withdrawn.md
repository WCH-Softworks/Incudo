# 0071 — An element's own requirements hold it as well as offer it, and a granted element they rule out is withdrawn

**Status:** Proposed · 2026-09-28 · not yet implemented (ROADMAP Phase 2) · amends the reading of `Element.requirements`
that ADR [0005](./0005-aurora-import.md) left ("filters candidate lists; it does not make an element the character
already has disappear") · builds on [0006](./0006-derived-character-state.md), [0025](./0025-slots-publish-tags.md),
[0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md), [0040](./0040-a-chosen-element-follows-the-track-of-the-element-that-offered-it.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0045](./0045-a-class-split-is-one-input-and-an-unmet-ability-score-minimum-is-a-flag.md),
[0064](./0064-a-character-may-carry-elements-its-user-adds-from-loaded-content-and-an-unmet-prerequisite-is-a-flag.md) ·
**format:** an optional key on a character kind in the system format (`formatVersion` stays 1); 5e declares one stat and
that key. `character.json` and `.incu` are unchanged: nothing is recorded, everything here is derived

## Context

Tasha's Cauldron of Everything's optional class features come as 36 hidden items a character equips (category
"Optional Class Features"). Thirty add a feature. Six replace one: a 2014 Ranger's Natural Explorer, Favored Enemy,
Primeval Awareness, Hide in Plain Sight and Beast Master's Ranger's Companion, and a Cleric's Divine Strike or Potent
Spellcasting. The item grants the new feature and an internal marker (`ID_INTERNAL_FEATURE_REPLACEMENT_…`), and the old
feature carries, **on itself**, `<requirements>!marker</requirements>`. The class's `<grant>` of it carries nothing.

Incudo reads an element's own requirements in two places: when it offers the element as a candidate, and (ADR 0064) as
a warning on something the user added. An element reached by a `<grant>` is held whatever they say. So a 2014 Ranger
who equips Deft Explorer holds Natural Explorer **and** Deft Explorer, and nothing reports it.

Nothing in the app can reach that case yet (it has no way to put an item in the bag; only an Aurora import can bring one
in, and none of the thirty samples does). But the question it raises reaches much further than six items.

### What the corpus and the samples hold

Measured by `tools/verify/src/replaced-features.test.ts` on AuroraLegacy/elements at `c28ce6c`, reported as `ℹ` lines
and asserting none of it (ADR 0042).

| | |
|---|---|
| elements carrying their own requirements | **1,928**: 773 class features, 626 subclass features, 249 feats, 66 racial traits, 47 spells, … |
| of them reached by a `<grant>` | **997** |
| negating an id ("unless the character has …") | 1,228 elements, 1,204 distinct ids, 408 of them `ID_INTERNAL_FEATURE_REPLACEMENT_…` markers guarding nearly every 2014 class and subclass feature (872 conditions in 81 files) |
| negated ids something grants | **45**; of the replacement markers, 6, all granted by Tasha's optional feature items. The rest are hooks for a user's own content |
| granted elements something else can switch off this way | 49: Divine Strike and Potent Spellcasting on every Cleric domain, the five Ranger features, Darkvision, Tough, the 2024 Druid's Wild Shape, Animal Speaker and Nature Speaker, the firearm proficiencies |
| `[character:N]` in requirements | **64**, parsed as a stat named `character` that nothing publishes, so false everywhere |
| `[type:X]` in requirements | **8** (`[type:spell]` on Elemental Adept's "can cast a spell", `[type:class]` on something every character with a class is granted), parsed as a stat named `type` that nothing publishes, so false everywhere |
| a level 4 2024 Fighter's feat choice | offers **0 of the 50** 2024 General feats, the Ability Score Improvement feat included; 43 of them require `[character:N]` |

Over the thirty samples, every held element whose own requirements are false in the finished derivation, the element
itself counted as not held (as ADR 0064 asks them), against Aurora's own `<sum>`:

| | held, own requirements false | Aurora has it | Aurora lacks it (an `element-extra`) |
|---|---|---|---|
| read as today | 58 (56 granted, 2 chosen) | 32 | 26 |
| with `[character:N]` read as the character's level and `[type:X]` as holding an element of that type | **26, all granted** | **0** | **26** |

The 32 Aurora has are false only because of the two unread terms: `Ability Score Maximum Over 20` (`[type:class]`) on
all thirty, and the 2024 Ability Score Improvement feat (`[character:4]`) chosen by two. The 26 Aurora lacks are two
families of `element-extra` this project has carried unexplained: the Artificers' firearm proficiencies (20, on the two
Artificer samples; their own requirement is the Firearms campaign option, which neither save has) and the Thieves'
Tools expertise pair (8, on four samples; CLAUDE.md recorded Aurora's omission of them as "unconfirmed" stale content).

So Aurora does this: **a granted element whose own requirements are false is not held.** With both terms read, that
rule accounts for every case in the samples, in both directions, and the six Tasha's replacements are the same rule.

## Decision

### 1. Aurora's `[character:N]` and `[type:X]` are read, and the system says how

Both are Aurora's vocabulary, so `core` names neither; the system definition answers them through what the requirement
language already reads.

- **`character` is a stat 5e declares**, a reference to `level`, as ADR 0036 declared the six ability abbreviations.
  `[character:4]` is then "level at least 4". No format change.
- **A character kind may declare `heldTypesStat`** (system format, optional, `formatVersion` stays 1): the name of a stat
  that publishes, as tags, the type of every element the character holds, lowercased. `[type:class]` is then membership,
  through the `statTags` branch of `equals` that ADR 0025 made for equipment slots. 5e's kinds declare `"type"`. A kind
  that declares none reads `[type:X]` as today.

This changes offers as well as holdings: the 2024 General feats become offered at level 4, and Elemental Adept to a
character that holds a spell. It is the first half because the second is wrong without it: withdrawal with the terms
unread would take `Ability Score Maximum Over 20` from every character, which Aurora holds on all thirty.

### 2. A granted element whose own requirements are false is withdrawn

An element held **only** because something grants it (a `<grant>`, or a setter a kind reads as one, ADR 0058) is not
held when its own requirements are false. Its rules apply to nothing, its grants reach nothing, and it is not in the
derivation's elements. The requirements are evaluated as a rule's already are: against the previous pass of the fixed
point, with the element itself counted as not held. A content cycle that never settles is reported by the existing
"did not settle" problem.

**Seeds are never withdrawn**: a recorded choice, an addition (ADR 0064), an equipped item, a custom feature, the
kind's baseline and the advancement. A choice was offered only when it qualified, and a user's input is not taken away
by a derivation; an element both granted and chosen is held. Whether a seed whose own requirements have since become
false should be flagged, as an addition is (ADR 0064) and an ability score minimum is (ADR 0045), is not decided here:
with both terms read, no sample has one.

### 3. What a withdrawn element's selects were answered with is not held

A recorded choice under a select of a withdrawn element (`<element>/select:…`) is not seeded while the element is
withdrawn: the pool it answers is closed. The record stays in `choices`, because a derivation writes nothing, and it
counts again the moment the element does, so unequipping Deft Explorer brings back Natural Explorer with its favoured
terrain as chosen. This is narrower than the gap CLAUDE.md records ("nothing prunes the picks of a class whose levels
went away"), which stays open.

### 4. A withdrawal is published, not reported as a problem

`DerivedCharacter.withdrawn` lists each withdrawn element, with what granted it. It is not a `Problem`: an element ruled
out by its own requirements is content working as written ("unless the character has Deft Explorer", "only with
firearms in the campaign"), not something to fix, and a warning on the Artificers for a campaign option they did not
choose would be noise. `summarize()` includes it, since it depends on the character and not on what is loaded.

## Consequences

- The six Tasha's replacements work as the book says once the item is equipped, and so does any user file (ADR 0056)
  that grants one of the other 402 markers.
- The oracle's `element-extra` falls by 26 (the firearm proficiencies and the Thieves' Tools pair), and no row moves
  the other way on the samples. Whatever `[character:N]` and `[type:X]` change beyond that (rule-level uses among the
  72, offers) is measured by the implementation, before and after, and recorded here as a note.
- Two unexplained oracle rows get their explanation. The two firearm extras beyond the 20, and the 42 internal
  multiclass grants on single-class samples, are not explained by this.

## What this does not do

- **Let a user take an optional class feature in the app.** The app has no way to put an item in the bag, and Tasha's
  features are items. A separate roadmap item: a bag editor, or a skippable set step (ADR 0032) offering the 36.
- **Add a replacing feature through "Added to this character".** An addition adds; it grants no marker, so Natural
  Explorer stays. That is right for an addition and is not changed.
- **Flag a seed whose own requirements are false** (decision 2).
- **Prune stale choices generally** (decision 3).

## Alternatives considered

- **Keep every granted element, and flag one whose own requirements fail.** Keeps ADR 0005's reading, and leaves a
  Ranger with both explorers, listed and summed, with a warning beside it. The corpus's 1,228 negations are how content
  says "instead", and Aurora, the only witness, does not hold them (26 of 26).
- **Move the condition onto the grant at import.** The frozen importer (ADR 0008), a rewrite of what content wrote, and
  wrong for an element granted by two things, where the condition belongs to the element and not to either grant.
- **Withdraw chosen elements too.** A pick was legal when offered; taking it away as the character changes is the
  behaviour ADR 0045 declined for ability score minimums. No sample needs it.
- **Read the terms in `core`** (`character` as "the progression", `type` as "an element type"). Both are Aurora's words,
  and `[type:X]` in another system's content could mean anything. The system says which stat answers them.
- **Replacement as a mechanism of its own**, a list of "A replaces B" pairs. Content already states it, as a
  requirement, the same way it states the firearms option and the Thieves' Tools case; one rule covers all three.

## Evidence (for the implementation)

What exists: the measurement file above, committed before this ADR, with the simulation that decision 2 rests on.

What the implementation must show, each test naming the perturbation that fails it:

- In `packages/core`, over a fixture with no game in it: a granted element whose own requirement negates an id another
  grant supplies is withdrawn, published in `withdrawn` with its granter, and its rules and grants reach nothing; the
  same element chosen is held; a recorded answer under its select is not held while it is withdrawn and is held again
  when it is not; a cycle reports "did not settle"; `heldTypesStat` publishes lowercased types and `[type:x]` reads them.
- Against the real corpus: the 2014 Ranger with the Deft Explorer item holds Deft Explorer and not Natural Explorer, and
  with the item carried rather than equipped, the reverse; a level 4 2024 Fighter is offered the 2024 Ability Score
  Improvement feat.
- The oracle: `INCUDO_ORACLE_SNAPSHOT` on the base and `INCUDO_ORACLE_BASELINE` on the change, with every moved row
  accounted for, and the 26 among them; `oracleViolations` still empty. The samples' saves reopen identically with no
  source.
- Driven in the browser build and in the Tauri window on Windows, as far as the app can reach it (a 2024 character at
  level 4 taking the Ability Score Improvement feat; the replacement itself needs the bag, above).
