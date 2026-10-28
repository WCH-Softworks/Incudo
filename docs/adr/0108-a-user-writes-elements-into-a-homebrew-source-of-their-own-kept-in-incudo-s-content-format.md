# 0108 — A user writes elements into a homebrew source of their own, kept in Incudo's content format

**Status:** Accepted · 2026-10-11 · answers the first slice of ROADMAP Phase 8's "In-app element editor" · builds on
[0003](./0003-system-agnostic-content-model.md), [0007](./0007-native-formats.md), [0012](./0012-self-contained-saves.md),
[0028](./0028-sources-are-a-profile-characters-carry-an-allowlist.md), [0031](./0031-a-system-is-chosen-and-it-scopes-everything.md),
[0049](./0049-a-character-records-which-publications-it-is-offered-and-it-narrows-offers-only.md),
[0056](./0056-an-aurora-file-the-user-adds-is-a-source-of-its-own-kept-as-a-copy.md),
[0064](./0064-a-character-may-carry-elements-its-user-adds-from-loaded-content-and-an-unmet-prerequisite-is-a-flag.md),
[0082](./0082-a-refresh-compares-what-a-character-carries-with-what-its-sources-load-and-shows-the-sheet-it-would-make.md),
[0085](./0085-a-source-is-kept-converted-into-incudo-s-own-form-and-loaded-from-that.md),
[0106](./0106-a-user-s-features-are-kept-in-a-file-in-the-library-folder-and-given-to-a-character-as-a-copy-that-remembers-where-it-came-from.md)
· **format:** none for characters or systems; the source profile's `kind` gains `homebrew`; a homebrew source's body is
a `ContentBundle`, the shape a save's `content.json` already is

## Context

Phase 8's first item: homebrew without hand-writing JSON. Today a user's own content reaches the app three ways, and
none of them is an element written in the app:

- **an Aurora `.xml` added as a source** (ADR 0056), written by hand in another tool, in a frozen format (ADR 0008);
- **a feature written on a character** (ADR 0063, 0094), which lives in `character.json` and is held as `custom:<id>`;
- **the feature library** (ADR 0106), which keeps those features to give again. It found that only a line that *adds*
  is an element rule; a set or a mark is a start the engine reads from the character, so the library keeps features as
  features, and left "how a user's own content is written" to this item.

Putting loaded content on a character whatever it is (ADR 0064) is the fourth path, and the one this item can use: an
element of a type a kind lists in `additions.types` reaches the character with no build step, no class track and no
character format change.

### What the engine needs

An element is `Element` (`packages/core/src/model.ts`): an id, a type, a name, a `source` (the book it names, ADR
0049), setters (a name and a text value, with optional attributes), rules (`grant`, `select`, `stat`; support tags are
`Element.supports`, not rules), an element-level `requirements`, a description, sheet hints, blocks, and an `origin`
saying which source and format it came from. `ElementOrigin.format` has had `'incudo'` since Phase 0 and nothing
produced it: the only place elements exist in Incudo's own form is a save's `content.json`, a `ContentBundle`
(`{ formatVersion: 1, elements }`), and a source kept converted (ADR 0085), which is the app's cache and not a format.
ADR 0007 names `.incuset` for a content bundle and `packContentBundle` writes one; nothing reads one as a source.

### What a homebrew author writes, measured

`tools/verify/src/homebrew-elements.test.ts`, over the official corpus at `c28ce6c`, for each type the shipped system's
kinds let a user add (read off the system, never spelled), counting how many elements a slice of **name, description,
setters, support tags, lines adding a whole number to a stat, and plain grants** could have written, and the first thing
that stops each of the rest:

| type | elements | writable | stopped first by |
|---|---|---|---|
| Condition | 23 | 100% | — |
| Language | 83 | 98% | a prerequisite 2 |
| Spell | 1,079 | 95% | a prerequisite 47, a choice 2 |
| Background Feature | 179 | 68% | a prerequisite 23, a choice 20, a block 15 |
| Proficiency | 201 | 67% | a prerequisite 42, an expression 24 |
| Racial Trait | 998 | 59% | a choice 164, an expression 102, a gate 66, a prerequisite 56 |
| Archetype Feature | 1,916 | 41% | a prerequisite 563, an expression 174, a choice 166, a gate 152 |
| Class Feature | 1,161 | 22% | a prerequisite 535, a choice 336 |
| Feat | 320 | 9% | a choice 200, a prerequisite 84 |

A spell is the clearest case: every one carries setters (1,079 a level and a school) and 1,078 carry support tags,
which are what a class's spell list and a slot-level select read, and nothing else. Over the whole corpus, of 15,115
rules, 6,995 are grants, 5,079 stat lines (978 of them an ungated, unbucketed number; most numbers are gated on a level)
and 3,041 selects. A feat is mostly a choice; a class feature mostly a prerequisite or a level gate.

## Decision

### 1. A user's elements are a source of their own, kept in the app's storage

A **homebrew source** is a line in the sources profile (`ConfiguredSource.kind: 'homebrew'`), tagged with the system it
was made under (ADR 0031), enabled, ordered with the rest and loaded through the same library. Its id and URL are
`homebrew:<slug of its name>`, unique in the profile. Its body is kept under `sources/homebrew/<id>`, outside the
`content/` cache prefix, for ADR 0056's reason: eviction and the refresh prune remove what is under a cache prefix, and
this is the only copy. Removing the source removes it. It has no update check and no refresh.

So everything a source gets, it gets for nothing: Browse finds its elements, the builder offers them wherever their
type and tags fit, its line says what it refers to that nothing enabled has (ADR 0052), what it shares with another
source (ADR 0054), and it can be switched off or moved.

**Not the library folder**, where ADR 0106 put features. A feature belongs to characters and travels with them; content
belongs to a system's sources, is loaded per app with no folder chosen (Browse and the builder work without one), and is
offered to every character of the system. The cost: a homebrew source does not move with the folder. Moving it is
Phase 8's "Export a homebrew source" item.

### 2. Its body is Incudo's own content format: a `ContentBundle`

The first content Incudo writes in its own format is the shape it already writes into every save: `{ formatVersion: 1,
elements }`, each element as `content.json` carries it, less `origin`, which the load supplies (`format: 'incudo'`).
A homebrew source is therefore the same thing a save embeds, and a character holding one of its elements copies it into
its own `content.json` unchanged. `checkHomebrewBundle` (`packages/content/src/homebrew-source.ts`) is the one checker:
a body that does not read or check fails that source's load with a sentence and is never written over, as ADR 0106's
library is not. No JSON Schema yet: the body lives in the app's storage, not in a user's file, and the format becomes a
user's file when the export item writes one.

### 3. The types are the ones a kind lets a user add

`homebrewTypes(system)`: every type any kind lists in `additions.types`, in the order the system declares types (5e:
Feat, Racial Trait, Class Feature, Archetype Feature, Background Feature, Proficiency, Language, Condition, Spell). An
element of one reaches any character of the system through Additions whatever it holds, and a spell with a class's tag
and a level is also offered by that class's spell selects. Races, classes, subclasses, backgrounds and items are not
offered: the first four need the choices and level gates this slice does not write, and items need the inventory's
setters to mean what the editor cannot check.

### 4. An element says what the slice can say, and nothing it cannot

A name; a description (plain text, kept as paragraphs of escaped HTML, since `Element.description` is HTML); setters, a
name and a text value each, the names offered from what loaded elements of the type carry (a spell's `level`,
`school`, …), never a system's list; support tags, offered the same way; and lines, each one of:

- **adds** a whole number to a stat: the stats a written feature's lines may name on any of the system's kinds
  (`customFeatureStats`, ADR 0063), because ADR 0106 found that an add line *is* an element rule, and the same list keeps
  a homebrew feat and a written feature saying the same things;
- **gives** another element, picked from what is loaded: a `grant` of its id and type.

Not written: choices (`select`), prerequisites, level or equipment gates, expressions, bonus buckets, sheet hints,
blocks. An element in a homebrew body with anything the editor does not write (a hand edit) is listed and not opened
for editing, with a sentence; it still loads. The editor never edits another source's elements.

### 5. An element's id is minted once and never changes

`ID_HOMEBREW_<TYPE>_<NAME>` in Aurora's style, letters and digits only, with `_2`, `_3`… when the id is taken in loaded
content or the source, ignoring case. Renaming keeps the id: a character records ids (ADR 0006), and a rename that moved
the id would orphan every character holding the element. Its `source` is the homebrew source's name, which names no
publication, so ADR 0049's book filter always offers it.

### 6. A character embeds it like any element, and an edit is a refresh

Nothing in the character or its save changes: `collectCharacterContent` copies what a character holds and follows its
grants, so a save holding a homebrew element opens with zero sources (ADR 0012). Changing an element in the source later
makes the copy a character carries differ from what its sources load, which is exactly what ADR 0082's refresh offers;
removing one leaves every character's copy alone.

### 7. The desktop's Sources pane holds the editor

Under "Write your own", **Make a homebrew source** makes one from a name. Its line has **Edit elements**, which opens the
editor under it: the elements by name and type with what their lines do, **New element**, and per element **Edit** and
**Remove** (asked by a second click, `ArmedButton`). Removing the source itself asks too, since its body is the only copy
of what was written. Saving an element writes the body and reloads the sources. Everything shown is worked out in
`packages/ui/src/homebrew.ts`; the pane computes nothing. The phone loads a homebrew source in its own profile like any
other and has no editor yet.

## What this does not do

- **Choices, prerequisites and level gates.** They stop most feats and class features (the table above); each needs an
  editor of content's expression languages, which is the next slice.
- **Races, classes, subclasses, backgrounds, items.** See decision 3.
- **Turning a library feature into content**, which ADR 0106 left open. An add-only feature now has a home; the move is
  not built.
- **Export and validation** are Phase 8's other two items.

## Alternatives considered

- **Keep elements in the library folder, beside `incudo-features.json`.** See decision 1: content is loaded per system
  with no folder, and a folder-scoped source would vanish from Browse when another folder is picked.
- **Write Aurora XML.** A frozen import format (ADR 0008), and the one the app would then have to write as well as read.
- **A simpler authored shape, compiled to elements on load.** A second format to version beside the one every save
  already carries, and a homebrew element would no longer be byte-for-byte what a character embeds.
- **Ids from a random value.** Unreadable in a save and in Browse, and two devices writing the same feat would make two
  elements; a readable id taken from the name, fixed once, is Aurora's convention and the corpus's.
- **Every declared type.** An editor that offers Race but cannot write a choice or a level gate makes a race that grants
  nothing a character can pick at level 3.

## Evidence

- **Measured first**: `tools/verify/src/homebrew-elements.test.ts` (the table above, report-only, plus one assertion that
  needs no corpus: every addable type is declared and listed by more than one kind).
- **`packages/content/src/homebrew-source.test.ts`**, each test naming its perturbation, each run: the source loads from
  storage with no network as Incudo content (fails composed as an index at a URL); every load reads the body afresh (fails
  with the parsed body kept on the source); two sources of one name are two (fails without the suffix); the body survives
  evicting the cache and goes with the source (fails with `removeSource` not removing it); nothing upstream to check or
  refresh; the checker refuses an id twice ignoring case and an element missing a field (fails with either check
  removed); a body that does not read fails the load with a sentence and is never written over (fails with
  `writeHomebrew` not reading first).
- **`packages/ui/src/homebrew.test.ts`**, over a fixture with no game in it, each perturbation run: the types are the
  kinds' addable ones in the system's order (fails reading `elementTypes`); the stats are every kind's once (fails without
  the dedupe); an id is minted once from type and name and never reuses one loaded or in the source (fails without the
  index check); a rename keeps the id (fails minting on every save); a draft writes the element the engine reads and a
  hero given it derives Speed 40 and holds what it gives (fails with the stat's case kept, or the tags dropped); every
  refusal; an element saying more than the editor writes is locked (fails with the rule check removed, or the
  description check loosened); the description round trip; the list's words; setter and tag suggestions read per type
  (fails with a fixed list).
- **`tools/verify/src/homebrew-source.test.ts`**, against 5e's own system: a homebrew feat adding 10 to Speed and giving a
  homebrew language, written through the view-model and loaded by `loadSources` with no network, is added to a player
  character (Speed +10, the language held); its save holds both as Incudo content and reopens with no source to the same
  Speed and the language; changing the feat in the source afterwards is the one change ADR 0082's refresh offers. With
  the corpus at `c28ce6c`: a homebrew spell written with the setters and tags of the Player's Handbook's Magic Missile
  (read off it) is offered by a level 1 Wizard's spellbook choice beside it. Fails with the homebrew branch removed from
  `composeForLoad`, the file ref not ending `.json` (the load reads no file: an index's refs are elements files only by
  their extension, found by running the content test first), the origin written as Aurora's, or the tags dropped.
- **The oracle and every other test are unchanged**: no import path, engine or character format moved. `npm test`: 1,716
  pass, 1 skipped.
- **Driven in the browser build** (2026-10-11; a fresh browser profile, clicks first and then DOM events, since the
  window was not drawing for screenshots): a homebrew source made from a name; a Language written and saved; a Feat
  written with "Adds 10 to Speed" and "Gives Hill Cant (Language)" found by searching loaded content, its line in the list
  reading so; an empty draft refused with "Give it a name."; the feat found in Browse under its source's name; a new
  player character given it through "Add from your content", its Sheet reading Speed 10 (no race loaded) and listing the
  feat and the language; the feat opened again with every field as written, changed to 15 and saved, the Sheet reading 15;
  a reload keeping the source, its two elements and the character. Then AuroraLegacy added beside it (14,320 elements):
  a new Spell offered the corpus's setter names (duration, level, range, school, …) and its tags (Wizard, Sorcerer, …),
  two tags taken by a click, `level` 1 written and the spell saved. The source's Remove armed ("Remove it and everything
  written in it") and disarmed after four seconds with nothing removed. No console errors.
- **Not driven**: the phone, which has no editor.
- Driven in the Tauri window on Windows (2026-10-20; a fresh WebView2 profile and a scratch library folder, DOM events over the debug port, real keys and mouse where marked): a homebrew source made from a typed name; a Feat written with its name typed (real keys), "Adds 10 to Speed" and
  "Gives Draconic (Language)", saved with a real Enter; found in Browse under the source's name; added to a Wizard,
  whose Sheet read Speed 40 and listed Draconic; saved, and reopened with every source off to a Sheet identical to Node's.

> **Note, 2026-10-28 ([ADR 0119](./0119-aurora-content-is-converted-into-incudo-content-and-nothing-past-the-conversion-knows-aurora.md), built):** Incudo's content format is the one format: a converted source, a homebrew body and a save's `content.json` are all `schemas/content.schema.json`, read through `checkContentBundle`.
