# 0091 — An offer that would give what the character already has is marked, and the system says which types

**Status:** Accepted · 2026-10-05 · answers the maintainer's request at the end of ROADMAP Phase 3 · builds on
[0003](./0003-system-agnostic-content-model.md), [0017](./0017-open-decisions-not-steps.md),
[0032](./0032-a-build-step-may-offer-a-set.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md)
and [0071](./0071-an-element-s-own-requirements-hold-it-as-well-as-offer-it-and-a-granted-element-they-rule-out-is-withdrawn.md)
· **format:** one optional field on a character kind in the system definition (`formatVersion` stays 1); none for characters

## Context

A pool never offers what the character holds: the engine leaves a held element out of every candidate list. What it
cannot leave out is a candidate that would *grant* something held. An Elf holds Perception from Keen Senses; a Sailor
background grants Perception too, and nothing on screen said so until the background was taken and the sheet showed one
Perception, not two. The maintainer asked for the picker to mark such a candidate before it is chosen.

Whether the 2014 rule then lets the player pick a replacement proficiency is a separate question and not answered here.

### Measured

`tools/verify/src/candidate-overlaps.test.ts`, AuroraLegacy/elements at `c28ce6c`, over every decision of the thirty
samples: each open select or pick against the character as it stands, and each settled slot as it would be changed,
against the character with that slot's answer taken out (1,064 decisions). Counting every type, what an offered
candidate would give again:

| type | times |
|---|---|
| Proficiency | 3,548 |
| Size | 1,060 |
| Grants (internal markers) | 232 |
| Language | 209 |
| Spell | 119 |
| Class Feature | 93 |
| Vision | 65 |
| Ability Score Improvement, Feat, Racial Trait, Feat Feature | 40 together |

The candidates giving them are races (1,459), backgrounds (1,240), classes (366), feats (74), subclasses (46) and a few
items and features. With the types below declared, 109 of the 1,064 decisions have a marked candidate, 2,197 candidates
in all; most named: Perception (360), Insight (291), Light Armor (220), Persuasion (184), Survival (173).

A fresh 2014 Elf is offered 118 backgrounds and 13 are marked: 11 with Perception, 2 with Elvish.

Reading a grant's requirements matters: 203 overlaps (178 proficiencies, 23 languages) exist only if they are not read,
almost all a race's skill under Tasha's customised origin (`!ID_WOTC_TCOE_OPTION_CUSTOMIZED_PROFICIENCY`).

What it costs: the open background list above in about 1 ms; the race list opened from a settled race, which needs one
derivation without the race, about 25 ms.

## Decision

1. **A character kind may declare `candidateOverlaps: { types }`**, the element types a picker names when an offered
   candidate would give one already held. Optional, replaced along `extends`, refused by the validator when it names a
   type the system does not declare. A kind declaring none marks nothing. Core reads none of it; it carries the field.
2. **5e's player character declares `Proficiency` and `Language`.** Not `Size` (a race replacing a race), not internal
   `Grants` or `Class Feature`, which nobody chooses or reads on their own; not `Spell`, which belongs to a casting block
   and is often a use of its own a second time; not `Vision`, whose range is a stat on the trait, so a second Darkvision
   can be a longer one. The NPC declares none: a creature's grants are what it is, not an option beside another.
3. **The walk is content's, not a derivation per candidate** (`candidateOverlaps`, `packages/ui/src/candidate-overlaps.ts`).
   From the candidate it follows `<grant>`s, and the grants of what they grant, plus what a kind's setters give; it stops
   at an element held (what that gives is held too). A grant gated above the level the candidate would be taken at is not
   followed (the chooser's track level from `gateLevels`, else the character's progression), and one whose requirements
   are false against the character as it stands is not either. A requirement naming something only the candidate brings
   reads false there, which can only leave a mark out, never add a wrong one. A derivation per candidate was the
   alternative: exact, and a derivation for each of a race list's 139 rows on every opening.
4. **A settled slot is judged without its own answer** (`CharacterBuilder.overlapsFor(ruleKey, slot)`), or everything the
   answer gives would read as redundant: with a Sailor, changing the Elf marks the Elf itself with Perception, because the
   Sailor has it too. An open decision is judged against the character as it stands.
5. **Asked for when a picker opens, not carried in the state**, as `additionOptionsFor` is: a settled slot costs a
   derivation. `overlapNotesFor` words it: "The character already has Perception", up to three names and then "and N
   more". The desktop's `CandidatePicker` and the phone's `Picker` show the line under the candidate's name and compute
   nothing; it is not part of the label, so a search does not match it.
6. **Display only.** Nothing is refused, reordered or derived from a mark.

## Consequences

- A player sees before choosing that a background, race, class or feat would give a skill, tool, armour, weapon or
  language again. The mark names the held element as content names it ("Tool Proficiency (Thieves' tools)").
- A mark is a statement about content's grants, read without deriving: a grant that only some later choice would switch
  on is not followed, and a candidate whose *select* would offer the held element is not marked (the select already
  leaves it out).
- Additions, references, prepared spells and the class levels control do not mark: their lists are not build decisions.
- The format change is additive: a system written before this validates and marks nothing.

## Evidence

- `packages/ui/src/candidate-overlaps.test.ts`, no game: a direct grant and one through a granted element are marked, a
  held element of an undeclared type is not, a level-gated and a condition-gated grant are followed only when they hold,
  a settled slot is judged without its answer, a kind declaring nothing marks nothing, and the note's wording. Each case
  fails under its named perturbation (only direct grants; held set unread; level ignored; requirements ignored; types
  unfiltered; settled slot judged with its answer), and each was run.
- `tools/verify/src/schemas.test.ts`: an undeclared type is refused, and the shipped declaration validates.
- `tools/verify/src/candidate-overlaps.test.ts`: the measurement above (report-only), and, against any corpus, a fresh
  2014 Elf's background list marks only what the Elf holds, of declared types, Perception among them, and no background
  granting Perception outright is unmarked.
- Driven in the browser build: a 2014 Elf's Background list marked 13 rows as above; with Sailor taken, changing the race
  marked 17 races (Perception, Athletics, a Minotaur's two Sailor tools, Locathah's "Athletics and Perception"), the Elf
  among them. Not driven on the phone, in the Tauri window, or on macOS and Linux.
