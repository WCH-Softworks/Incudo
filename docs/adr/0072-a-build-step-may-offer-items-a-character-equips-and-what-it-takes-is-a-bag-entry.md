# 0072 — A build step may offer items a character equips, and what it takes is a bag entry

**Status:** Accepted · 2026-09-29 · implemented the same day · **what it takes is a bag entry is superseded by [0129](./0129-optional-class-features-and-additional-features-are-options-a-character-chooses-not-items.md)** (2026-10-21: the features are options of their own type, taken as choices) (ROADMAP Phase 3; see the note at the end) · closes the gap [0071](./0071-an-element-s-own-requirements-hold-it-as-well-as-offer-it-and-a-granted-element-they-rule-out-is-withdrawn.md)
left ("the app cannot put an item in the bag") for Tasha's optional class features · builds on
[0006](./0006-derived-character-state.md), [0012](./0012-self-contained-saves.md), [0024](./0024-inventory-is-a-list-of-instances.md),
[0032](./0032-a-build-step-may-offer-a-set.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0049](./0049-a-character-records-which-publications-it-is-offered-and-it-narrows-offers-only.md),
[0064](./0064-a-character-may-carry-elements-its-user-adds-from-loaded-content-and-an-unmet-prerequisite-is-a-flag.md) ·
**format:** two optional keys in the system format (`formatVersion` stays 1): `equip` on a build step and `hiddenSetter` on
a kind's inventory. `character.json` and `.incu` are unchanged: what is taken is recorded in the bag ADR 0024 defined

## Context

Tasha's Cauldron of Everything's optional class features are items. A character equips one to "enable" it, in the
words of the item's own description, and it "remains hidden from the inventory on your character sheet". Six of them
replace a feature, and since ADR 0071 an equipped one does: the old feature's own requirements negate a marker the item
grants, and the engine withdraws it. Carried, the item does nothing.

The app has no way to put an item on a character. The bag (ADR 0024) is filled only by an Aurora import, and nothing on
Build writes it. So the replacement ADR 0071 built cannot be reached from the app, and neither can the thirty items that
only add a feature.

### What the corpus and the samples hold

Measured by `tools/verify/src/optional-features.test.ts` on AuroraLegacy/elements at `c28ce6c`, reported as `ℹ` lines
and asserting none of it (ADR 0042).

| | |
|---|---|
| elements of category "Optional Class Features" | **36**, all `Item`, all from Tasha's Cauldron of Everything, all `slot` `misc`, all `inventory-hidden` true |
| own requirements, support tags, rules other than grants | **0**, **0**, **0**: nothing on the item says which class it is for |
| grants | **42**: 36 gated on the class's level by a requirement written on the grant (`[level:ranger:1]`), none by a `level=` attribute; one (Primal Companion) gated on the Beast Master subclass instead; 6 unconditional, all of type `Grants`, the replacement markers |
| replacing a feature | **6**: Deft Explorer, Favored Foe, Primal Awareness, Nature's Veil and Primal Companion for the Ranger, Blessed Strikes for the Cleric |
| by the class a grant is gated on | Ranger 7, Cleric 4, Monk 4, Bard 3, Druid 3, Paladin 3, Sorcerer 3, Barbarian 2, Warlock 2, Wizard 2, Fighter 1, Rogue 1; the item's name leads with that class in all 36 |
| what offers, grants or selects them | **nothing**: no element grants one, the corpus has **0** `select`s of type `Item`, and three Beast Master companions name the Primal Companion item in their own requirements |
| a level 20 character of each class, 2014 and 2024 | the same items give something in both editions (the 2024 classes publish the same `level:<class>` stats); equipping all 36 withdraws four features from a 2014 Ranger (Favored Enemy, Natural Explorer, Primeval Awareness, Hide in Plain Sight) and nothing from anyone else |
| the thirty samples | **24** bag entries in 8 saves, **none** of this category or hidden |

So Aurora offers these the way it offers any item: from its equipment list, to every character, and the item is gated by
what its grants say. The save format records one as it records a sword, an `<item>` in `<equipment>`, which the importer
already turns into a bag entry.

The category is not the only one of its kind. `inventory-hidden` is on **91** items: these 36; **35** of category
"Additional Feature" (climb and swim speeds, Feat Unlocker, Lycanthropy, and the Companion and Familiar Selection items
ADR 0070 measured), 24 of which say they are equipped to enable them; **12** "Additional Ability Score Improvement" items
from an Unearthed Arcana document, all saying so; and **8** 2024 mounts, which are hidden and have no rules at all. So
"hidden" does not mean "a switch", and the category is what names a family.

## Decision

### 1. A build step may declare `equip`, and its answers are equipped bag entries

```jsonc
{
  "id": "optional-features",
  "label": "Optional class features",
  "types": ["Item"],
  "equip": { "setter": "category", "values": ["Optional Class Features"] }
}
```

A step with `equip` is a set, as ADR 0032's `multiple` is: zero or more of its candidates, never blocking, skippable,
published as an open decision while anything is left to take and as a settled pick for what is taken. It differs in two
things only:

- **What it offers**: the elements of its types, through the character's offered view (ADR 0049), whose own
  requirements hold, and whose setter `setter` reads one of `values` (ignoring case), less what the character holds.
- **What it records**: the bag, never `choices`. Taking an element equips a carried entry of it if the bag has one, and
  otherwise adds `{ instanceId, elementId, equipped: true }`. Taking one back removes an entry that records nothing else,
  and only unequips one that does (a quantity, a slot, attunement, an adornment, a name or notes), so nothing a user or an
  import wrote is thrown away. What the step has taken is read back from the bag: the equipped entries whose element
  passes the filter. An Aurora save that equips one therefore opens with it taken, and a character built in the app saves
  the same record an import would have made.

The setter and its values are the system's words. Core says neither `category` nor "optional class feature".

Validation refuses `equip` beside `required`, `pick`, `multiple`, `perLevel`, `budget` or `levelRoll`, and with no
`types`. `formatVersion` stays 1: a reader that does not know `equip` sees a step that is not required, not a set and not
a pick, which is a heading for the selects content opens of its types (ADR 0068) and offers nothing. It still derives the
bag, which it has read since ADR 0024. **`equip` is deliberately not `multiple` as well**: a reader that knew `multiple`
and not `equip` would offer every item in the corpus as a set and record it as choices.

### 2. Taking one back drops the answers it closed, and keeps the ones it opens

A taken item opens its feature's selects (Deft Explorer's Canny asks for an expertise and two languages). Taking it back
drops a recorded choice whose pool was open before and is not after, repeated until nothing more closes: the rule ADR
0064 gave removing an addition, for the same reason (a recorded choice seeds the derivation whether or not anything still
offers it). A replaced feature's answer is not dropped by this: its pool was closed while the item was taken (ADR 0071
decision 3) and opens again, so turning Deft Explorer off gives Natural Explorer back with the terrain chosen before.
Taking an item drops nothing.

### 3. Every character is offered every item of the family, and it is not narrowed by class

Nothing on an item says which class it is for. Its grants' gates do, and its name does. Narrowing by the gate would read
`level:<class>` as "this is a Ranger item", which is 5e's vocabulary in an app rule; narrowing by the name would parse
prose. And the gate does not separate the editions: a 2024 Ranger answers `[level:ranger:1]` as a 2014 one does and gets
Deft Explorer from the item, with nothing withdrawn (its features negate no marker). That is content as written, and
Aurora offers the items to every character the same way. The name leads with the class, so a search by class finds them.

### 4. A kind's inventory may name a setter that keeps an item off the sheet

`InventoryDef.hiddenSetter` (system format, optional): an element whose setter of that name reads `true` (ignoring case)
is not listed in a sheet section. 5e names `inventory-hidden`. The item is still held, derived and saved; only the list
leaves it out, as the item's own description says. `sheetListedElements` in core is the one reader, and the sheet pane
reads through it.

### 5. What is withdrawn is shown on Build

`BuilderState.withdrawn` names each element ADR 0071 withdrew and what granted it, and Build lists them under the open
decisions: taking Deft Explorer says Natural Explorer is not held, and why, rather than making it disappear. It is every
withdrawal, not only a replaced feature: an Artificer's firearms proficiency (no Firearms option) is listed too.

### 6. 5e declares one step, for this category only

After class levels, on the player character. The other categories that ask to be equipped ("Additional Feature",
"Additional Ability Score Improvement") could be offered by a declaration alone, and are not here: they mix speeds, feat
unlockers, a curse and the Companion and Familiar Selection items, whose creature ADR 0070 left unbuilt as something a
player character holds. Each wants a look of its own.

## Consequences

- A Ranger can take Deft Explorer in the app and lose Natural Explorer, and turn it off to get it back with its answer; a
  Cleric can take Blessed Strikes; the thirty additive items are taken the same way.
- The saved file is one an import would have made: a bag entry, embedded with everything it reaches, opening with zero
  sources (ADR 0012).
- No derivation of an existing character moves: nothing here changes the engine. The oracle is expected identical.
- A step's candidate list now includes items for every character with Tasha's loaded: 36 of them, most of which give a
  given character nothing. Saying which do is not decided here (below).

## What this does not do

- **A bag editor.** Nothing here lets a user carry a sword. Hidden items would still be left out of it (decision 4).
- **Say which items give this character something.** A note per candidate would read the grants' gates against the
  character; worth measuring once the list is used.
- **Offer the other hidden families** (decision 6).
- **Separate the editions.** Content does not, and neither does this.

## Alternatives considered

- **A bag editor first.** The honest general answer, and much more than this needs: slots and their capacity,
  attunement, adornments, quantities and splitting a stack, over 2,000 items. It would still have to present these 36
  apart from what a character carries, since they are hidden from the inventory, so it does not remove the need for this.
- **A `multiple` set step over `Item`, recorded as choices.** A chosen item seeds the derivation as an equipped one does,
  so the replacement would work. But an Aurora import records the same thing in the bag, so one fact would have two
  records and the step would not see an imported one as taken; and a reader that knew `multiple` would offer every item.
- **Adding the item through "Added to this character"** (ADR 0064). An added element seeds, so an added item would grant
  its marker. But additions are a list of their own, offered "whatever its prerequisites" over every element of a type,
  and items are not one of those types: the same two-records problem, over a list with every item in it.
- **Special-casing the category in the app**, or narrowing by the class the name or the gate names. A game noun in code,
  or a guess (decision 3).
- **Hiding by `inventory-hidden` alone, and offering every hidden item.** The 8 mounts are hidden and are not switches.

## Evidence (for the implementation)

What exists: the measurement file above, committed before this ADR.

What the implementation must show, each test naming the perturbation that fails it:

- In `packages/core`: the schema and validation accept `equip` and `hiddenSetter`, and refuse `equip` beside each of the
  six keys and with no types; `sheetListedElements` leaves out an element whose hidden setter reads true and nothing else;
  `setInventoryEntry` raises a character's format version and never lowers it.
- In `packages/ui`, over a fixture with no game in it: the step offers what the setter admits and nothing else, less what
  is held; taking writes an equipped entry, equips a carried one, and never a choice; taking back removes a bare entry,
  unequips one that records more, and drops the answers it closed while keeping one it opens; an equipped entry
  of the family reads back as taken; a book switched off offers nothing; `withdrawn` rows name what was withdrawn.
- Against the real corpus: a 2014 Ranger built through the builder takes Deft Explorer and loses Natural Explorer, takes it
  back and has Natural Explorer with its answer, and the saved file reopens with zero sources to the same derivation.
- The oracle: `INCUDO_ORACLE_SNAPSHOT` on the base and `INCUDO_ORACLE_BASELINE` on the change, same checkout, every moved
  row accounted for; `oracleViolations` empty.
- Driven in the browser build and in the Tauri window on Windows.

## Note, 2026-09-29 — built, and what it measured

Implemented as decided, in five commits after the measurement and this ADR: the format-version fix below, the system
format (`equip`, `hiddenSetter`, `sheetListedElements`, validation), the view-model (`packages/ui/src/equip-step.ts` and
the builder), the 5e declaration with its corpus test, and the two pane changes.

**Found on the way: `setInventoryEntry` lowered a character's format version.** It wrote 2 whatever the character was, so
a character with additions (5) or references (7) that took an item would have been written as 2 and refused by the
validator. Nothing in the app wrote a bag before this step, so nothing had hit it. It now raises to 2 and never lowers.

**The oracle is identical.** `INCUDO_ORACLE_SNAPSHOT` on the ADR's commit and `INCUDO_ORACLE_BASELINE` on the change, same
checkout (AuroraLegacy/elements at `c28ce6c`): no row moved on any of the thirty samples, no problem count, no compared
row, and `oracleViolations` stays empty. As expected: no sample carries one of these items and the engine is unchanged.
The full suite passes.

**On the real corpus** (`tools/verify/src/optional-feature-step.test.ts`): the step offers a 2014 Ranger all 36 items; a
Ranger built through the builder with Natural Explorer's Favored Terrain answered takes Deft Explorer, holds Deft Explorer
and Canny and not Natural Explorer or its answer, and `BuilderState.withdrawn` names Natural Explorer as given by the
Ranger; the record is one equipped bag entry and no choice; the sheet lists the feature and not the item; the file packs
and reopens with no source to the same `summarize()`, and reads the item as taken; taken back, Natural Explorer returns
with its answer and Canny's language answer is dropped. A character offered only the 2014 Player's Handbook is offered
none. Removing the step from 5e, or its `hiddenSetter`, fails that test.

Held in `packages/ui/src/equip-step.test.ts` (eight cases over a fixture with no game in it, and fourteen perturbations,
each failing the case that names it: the step left out of the set loop, the setter unread, its value compared by exact
case, own requirements unread, the offer read from everything loaded, `choose` recorded as a choice, the step heading
content selects, taken items read from choices, a carried entry never equipped, take-back always removing or always
unequipping, answers pruned after taking, not pruned after taking back, no withdrawn rows), `packages/core`'s
`system.test.ts` and `inventory.test.ts`, and `tools/verify/src/schemas.test.ts` (eight perturbations of the format and
the fix, each failing).

**Driven** in the browser build and in the Tauri window on Windows (DOM clicks over the debug port, a fresh WebView2
profile, a scratch library): a 2014 Human Ranger answered Favored Terrain with Forest, took Deft Explorer from the 36 on
offer, and Build listed Natural Explorer under "Not held" while the sheet showed Favored Enemy, Deft Explorer and Canny
and no item; Canny's language was answered; Remove brought Natural Explorer back with Forest and dropped the language; the
item was taken again and saved. In the browser build the source was then switched off and the file reopened from the
library to the same Build and Sheet, and taking the item back there, with no source, gave Natural Explorer back with
Forest. From the window, the saved file was read back from disk with `nodeZipCodec` and derived with no source: format 2,
valid, one equipped bag entry, Deft Explorer taken, Natural Explorer withdrawn. Not with real input, and not on macOS or
Linux.

**Seen while measuring, not part of this:** 87 setter values in the corpus keep a literal `&amp;` (an item category
"Mounts &amp; Vehicles", book authors "D&amp;D Beyond"): the importer decodes entities in text and attributes and not in
setters. Reported separately; nothing here compares a value with an `&` in it.

**Not done:** a note on a candidate saying whether it gives this character anything; the other hidden families (decision
6); a general bag editor.
