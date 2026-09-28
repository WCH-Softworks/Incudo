# 0070 — A player character keeps text for reference, and a creature it holds is not a reference

**Status:** Accepted · 2026-09-28 · answers the question [0068](./0068-a-character-may-keep-content-beside-it-as-a-reference-shown-and-embedded-and-never-held.md)
decision 2 left open, and the card it lists as not done · builds on [0012](./0012-self-contained-saves.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0049](./0049-a-character-records-which-publications-it-is-offered-and-it-narrows-offers-only.md),
[0058](./0058-a-setter-may-name-elements-its-holder-has-and-the-kind-says-which.md),
[0064](./0064-a-character-may-carry-elements-its-user-adds-from-loaded-content-and-an-unmet-prerequisite-is-a-flag.md),
[0069](./0069-what-a-description-embeds-is-shown-in-place-and-a-save-carries-it-for-its-text.md) ·
**format:** none. 5e's `pc` declares `references`, which the system format has had since ADR 0068; a player character
that keeps one is character format 7, as an NPC is

## Context

ADR 0068 let an NPC keep elements beside it, shown on the Build pane and the Sheet, saved with it, and never held, and
left the player character keeping none: "a druid's beast or a summoned spirit is a plausible use and undecided". It
also left a library card saying nothing of what a character keeps. Four answers were on the table: no player character
references; the player character keeping `Information` as the NPC does; keeping structured creatures (`Companion`) too,
with a rendering of a creature's stat block that `core` does not name; and offering, beside a held spell or feature, the
stat blocks it embeds.

ADR 0069, the separate piece of work on `<div element>` embeds, was finished before this began (its last commit is the
base of this one), so nothing here overlaps it: it shows an embed in place and makes a save carry it, and this reads
the same marker with the same reader.

### What the corpus holds

Measured by `tools/verify/src/pc-references.test.ts` on AuroraLegacy/elements at `c28ce6c`, reported as `ℹ` lines and
asserting none of it (ADR 0042). A player character's own content is read off the kind, not named: every element of a
type its build steps or sheet sections name (Race, Class, Archetype, Background, Feat, Spell, Item, Magic Item, the
features, and so on). A stat block is recognised as ADR 0068 did, by the six abilities as bold table cells, and by a
looser shape that also counts plain cells.

| | |
|---|---|
| embeds in a player character's own elements' descriptions | **3,164**, mostly features (1,510 subclass, 393 class) and spells (505) |
| of them naming `Information`, the type an NPC keeps | **178**, of 113 elements, from 53 magic items, 44 spells, 27 class features, 20 racial traits, 16 items, 11 subclasses, 7 subclass features |
| `Information` elements reached by a player character's own text, nested | **113 of 116** |
| `Information` printing a stat block | **63** in ADR 0068's bold shape, **100** counting plain cells: the 2020 summons (Tasha's spirits, the Steel Defender, the Drake Companion) print their abilities without bold |
| what the other embedded `Information` is | a race's Creature Type (18), an artificer's Replicate Magic Item tables (24), Wild Magic Surge, Spirit Tales, the six abilities |
| Wild Shape (2014 and 2024), by name | **0** embeds, **0** selects: content ties no creature to it |
| `<select>`s of a creature type in a player character's own content | **26**: 15 on subclass features, 6 class features, 2 items, 2 spells, 1 feat (the familiar, the ranger's companion, the steel defender, the drake, the wildfire spirit, …) |
| creatures they can offer | **141 of 141**. Aurora Legacy Essentials' Companion Selection, an item a character equips, offers every one; equipped on a fresh player character in Incudo it opens a choice of 117 (the 24 whose own requirements name a class are left out, as for an NPC) |
| creatures granted by a player character's content | 0 |
| creatures with a description | **32 of 141**, and none prints a stat block: the stat block is the setters (every one has `ac`, `hp`, `speed`, the six abilities, size, type, alignment, `challenge`, languages; 113 senses; 139 actions, 109 traits by id) |
| creatures a rule of which reads a stat of whoever holds them | **29**, every one offered to a player character: `level:ranger`, `proficiency`, `intelligence:modifier`, … (a Steel Defender's hit points follow its artificer's level) |
| creatures whose `type` setter is Beast | 94: 48 from the 2014 Player's Handbook, 25 from the 2025 Monster Manual |

And over the thirty sample saves: **5 hold a creature** (5 Owls, through Find Familiar), and **no sheet section of the
player character lists a creature type**, so the Owl is held, derived, saved and shown nowhere. **2** samples' held
elements print an `Information` element (the Replicate Magic Item table, beside two artificers).

Three things follow. **A player character's own content already prints nearly every text an NPC keeps**, and ADR 0069
already shows it in place and saves it; what is missing is a place on the character where a player reads it at the
table, since the Sheet lists a held spell by name and never its text. **A player character already holds creatures**,
by content's own choices, and cannot yet see them. And **a creature is not a text**: most have none, and the numbers of
the ones a player character is given depend on that character.

## Decision

### 1. The player character keeps `Information`, as the NPC does

5e's `pc` declares `references: { types: ["Information"], label: "For reference", description }`, with a sentence of
its own ("the stat block of a creature your spell summons or a beast you can turn into"). Nothing in ADR 0068 changes:
a reference is shown on the Build pane and after the Sheet, embedded in the save, never held, and only a character that
keeps one is format 7. `core` names nothing new; the change is one block in the system definition.

### 2. What the character's own elements print is suggested first

The references section lists, above "Choose from your content", **what the character's held elements print of the
types its kind keeps**: each element a held element's description embeds, and what that embeds in turn as far as a
description is shown (`MAX_EMBED_DEPTH`), that the character is offered (ADR 0049's view) and does not keep, by name,
with the held elements that print it ("Bestial Spirit, in Summon Beast"; "Beast of the Sky, in Beast Master, Level 3:
Primal Companion"), and a Keep.

`referenceSuggestions` (`packages/ui/src/references.ts`) reads the marker with `core`'s `descriptionEmbeds`, the one
reader ADR 0069 made, and is derived on every read of the builder's state and **recorded nowhere**: nothing is kept
until the user keeps it. It is kind-agnostic, so an NPC whose elements print one is offered it too. Because a save
carries what its elements' descriptions embed (ADR 0069), the suggestions are the same with no source loaded, and one
can be kept from the save alone.

This is the fourth answer as an ordering of the second, not a mechanism of its own: a spell's stat block becomes a
reference the same way any text does.

### 3. A creature is not a player character's reference

`Companion` is not added to the player character's reference types, and no rendering of a structured creature is
written for references:

- **The player character already holds one** where the rules give one: 26 selects in its own content offer every
  creature, and a sixth of the samples hold one. A reference would be a second, unheld copy beside the one content
  already put on the character, and two Owls, one held and one kept, is a worse screen than one.
- **A reference is never held, so nothing derives from it**, and 29 creatures, every one of them offered to a player
  character, compute their numbers from whoever holds them. Printed beside the character as text, a Steel Defender
  would show its setters' prose or its unscaled base, never its hit points.
- **Most have no text.** 109 of 141 carry no description, so a kept creature would show "It has no text to show"
  unless references grew a second rendering, of setters and of the traits and actions they name, for one type.

The rendering belongs to the creature a player character **holds**, where its numbers can be derived: that is the
roadmap's "Companions and sidekicks", which this measurement now describes (below). An NPC built on a creature (ADR
0057) already renders one as its own sheet.

### 4. A library card says what a character keeps

A card adds a line, "For reference: Kraken, Rat, Bat and 1 more", under the kind's label, naming the first three and
counting the rest. For an NPC built by hand beside a stat block it is the only thing on the card that says what the NPC
is ("NPC / Monster · Challenge Rating 23" does not). The library entry carries each kept id with the name the save's own
embedded copy gives it, or the id where the save embeds none; `libraryEntryReferences` (`packages/ui/src/character-kinds.ts`)
writes the line, and the card computes nothing. What the file records is listed whatever the kind keeps now: the card
says what is in the file, and the character's panes say what is shown.

## What this does not do

- **Show a player character's held creature.** Measured and not built: a held Owl, Steel Defender or Primal Companion
  appears on no sheet section, and its stat block is setters and named elements, some reading the character's numbers.
  It is the "Companions and sidekicks" item, with its design question stated there.
- **Give a 2014 druid's Wild Shape forms a text.** The 2014 beasts are structured creatures only (48 from the Player's
  Handbook), so none can be kept under decision 3, and Wild Shape names none. A druid can keep a prose stat block of the
  2025 Monster Manual (the Rat, the Mastiff and the Lion are among its 45), or build an NPC on a structured beast. This is
  what decision 3 loses.
- **Recognise a stat block.** The suggestions are what content embeds, whatever it is: an artificer is offered the
  Replicate Magic Item table, which is right, and a character whose race prints Creature Type is offered that.
- **Show a held element's own text on the Sheet.** The Sheet lists held elements by name; the text a spell prints is
  reached by keeping it, or in a picker and Browse.

## Alternatives considered

- **No player character references.** The Sheet a player reads at the table stays without the creature their spell
  calls, while every one of those stat blocks is already in their content, printed by their own spell and carried by
  their save. Costs nothing and leaves the one use the corpus supports unserved.
- **Show every embedded `Information` automatically**, as a derived section with nothing recorded. Content decides
  then, not the player: every Human would carry Creature Type beside it, every Beast Master three beasts where the
  player summons one, and a list nobody chose cannot be shortened.
- **`Companion` as a reference, rendered from the kind's declaration** (labelled setters, and the traits and actions
  their setters name). Feasible without a game noun in `core`, and wrong for the 29 creatures that scale, which are the
  ones a player character is given. It would also show a creature the character already holds a second time.
- **A suggestion list in the picker**, ordered first among the 116. The picker's rows are names; the "in Summon Beast"
  that says why is the useful part, and a separate list shows it.
- **No card line**, and the name of the NPC as the only identifier. The DM names an NPC after its role in a story, not
  after the stat block, and the library is where they look for it.

## Evidence

Each test names the perturbation that fails it, and each perturbation was run.

- `packages/ui/src/references.test.ts`, over a fixture with no game in it: a held element's text, and text inside what
  it prints, is suggested by name with every held element printing it; a type the kind does not keep, an embed naming
  nothing, and text printed by an element nothing holds are not; a kept one leaves the list and comes back when
  dropped; a switched-off book suggests nothing; a kind keeping nothing suggests nothing; the walk goes exactly as deep as
  a description is shown. Perturbed: suggestions read from everything loaded; nested embeds not followed; the type not
  filtered; what is kept still suggested; the builder handing everything loaded instead of the offered view; one
  holder named; not by name; no depth limit (a circle runs out of stack); the limit one early. A circle check of its own
  changed nothing under the depth limit and was removed.
- `packages/ui/src/character-kinds.test.ts`: the card line uses the kind's label, inherited along `extends`, the
  default for a kind nothing declares, names three and counts the rest, and is absent for a character keeping nothing.
  Perturbed: the label not read; an unknown kind losing the line; the list not cut; an empty list given a line.
- `packages/ui/src/character-library.test.ts`: an entry names each kept element from the save's embedded copy, one the
  save does not embed by its id, and one keeping nothing carries no field. Perturbed: names read as ids; one not
  embedded dropped.
- `tools/verify/src/pc-references.test.ts`: the measurement above; and against whatever the corpus holds, a fresh player
  character is offered every `Information` element (116), keeps them all, derives exactly what it derived keeping none
  (`summarize`), and saved and reopened against only its save shows the same rows; and every sample is suggested exactly
  what its held elements print of those types, the same once saved and reopened with no source, and keeping them all
  moves nothing it derives. Perturbed: `pc`'s `references` removed; references seeded into the derivation; suggestions
  read from everything loaded; the collector not following embeds (the reopened suggestions are empty). Not following
  nested embeds changes no sample (every sample's suggestion is printed directly), and is held by the `ui` test.
- The oracle's thirty-sample table is identical before and after (`INCUDO_ORACLE_SNAPSHOT` on the base,
  `INCUDO_ORACLE_BASELINE` on the change, same checkout); a baseline with one difference removed fails, so the
  comparison was live. No player character derivation moved, as expected of a reference that is never held.
- **Driven in the browser build** (an origin-private folder standing in for the folder picker). A 2024 Human Ranger,
  level 3, Beast Master: "Printed in what this character has" listed Beast of the Land, Sea and Sky, each "In Beast
  Master, Level 3: Primal Companion"; Beast of the Land kept, its stat block shown in the first column and at the end of
  the Sheet. Choosing the Primal Companion's structured Beast of the Land, the character held 109 elements and the Sheet
  named that creature nowhere (decision 3's finding, seen). Saved, the card read "For reference: Beast of the Land";
  with the only source switched off and the page reloaded the card read the same, the file opened to the same text and
  suggestions, and Beast of the Sea was kept from the save alone and saved ("…Beast of the Land and Beast of the Sea").
  An NPC keeping four Monster Manual (2025) stat blocks read "For reference: Kraken, Rat, Bat and 1 more". No console
  errors.
- **Driven in the Tauri window on Windows** (a fresh WebView2 profile, the library a scratch folder named in the app's
  own store, DOM clicks over the debug port; no keystrokes, and not macOS or Linux). AuroraLegacy loaded through the host
  in 25.4 s. The same Beast Master, with Tasha's Summon Beast added: the suggestions listed the three beasts and
  "Bestial Spirit, In Summon Beast" (a stat block in the plain-cell shape ADR 0068 did not count); Bestial Spirit and
  Beast of the Sky kept and saved. The file, read back from disk with the repository's zip codec, is format 7, records
  the two references and the added spell, embeds both texts (1,774 and 1,772 characters), holds neither, and derived
  against only the save suggests the other two beasts. With the source switched off and the window reloaded, the card
  read "For reference: Bestial Spirit and Beast of the Sky" and the file opened to a Sheet identical to the one before,
  character for character.
