# 0106 — A user's features are kept in a file in the library folder, and given to a character as a copy that remembers where it came from

**Status:** Accepted · 2026-10-10 · answers ROADMAP Phase 8's "Reuse what a user writes across characters" · builds on
[0006](./0006-derived-character-state.md), [0012](./0012-self-contained-saves.md), [0027](./0027-a-library-is-a-folder.md),
[0063](./0063-a-character-may-carry-features-its-user-writes-which-add-to-a-stat-or-set-where-it-starts.md),
[0065](./0065-legendary-content-is-content-of-the-types-the-system-declares-and-a-dm-may-write-it-on-the-creature.md),
[0094](./0094-a-player-character-s-written-features-only-add-and-a-feature-line-may-mark-a-row.md) · **format:** a new user
file, `incudo-features.json` (`formatVersion` 1, `schemas/feature-library.schema.json`); an optional `library` on a
character's custom feature, character `formatVersion` **12** when present

## Context

A feature the user writes belongs to the one character it was written on (ADR 0063), and a DM who gives three NPCs
"Godspeed" writes it three times. Phase 8's exit criterion: a feature written once is offered to every character of its
system, and one already written on a character can be moved into the user's library without being typed again. ADR 0063
said the move would be a copy because "the shape is an element's on purpose".

**Measured first, and that sentence holds only in part.** A custom feature is a name, a description, a type and lines,
and a line does one of three things: **add** to a stat, which `customFeatureEffects` turns into an ordinary rule of the
element the feature is held as; **set** where a stat starts (ADR 0063); **mark** a row (ADR 0094). The last two are not
rules: they are starts the engine reads from the character, and no content element can say them. Godspeed, the example
the item was written for, is a set. A library of elements would lose it.

What a line may do depends on the kind, and the types a feature may be held as are the kind's. Against 5e's three kinds
(the shipped system, `customFeatureStats` and `customFeatureTypes` over each resolved kind):

| kind | stats a line may name | settable | markable rows | types |
|---|---|---|---|---|
| player character | 34 | 0 | 0 | Class Feature, Racial Trait, Feat, Background Feature |
| NPC | 34 | 7 | 24 | Companion Trait, Companion Action, Companion Reaction |
| legendary creature | 35 | 8 | 24 | the NPC's, and Legendary Action, Lair Action, Regional Effect |

The 34 are the same names on all three. The 7 a player character can only add to are `ac`, `hp`, `speed` and the four
other speeds, all of which it works out. No type is shared between a player character and an NPC. So "Godspeed: Speed
60" read on a player character is a line that changes nothing, which the editor already says (`add-only`), and the type
it is listed as has to be one the kind has.

The other way in, putting loaded content on a character (ADR 0064), takes Feat, Spell, Class Feature and the like and
never `Companion Trait`: an NPC's feature could not arrive that way without a system change.

And the library scan (ADR 0027) lists only `.incu` files and folders holding a `manifest.json`, in all four stores (the
Tauri window's, the browser's, the phone's and the Node test's), so another file in the folder is already invisible to it.

## Decision

### 1. The library is one file in the character library folder, `incudo-features.json`

The maintainer's choice: beside the characters, so it moves, syncs and is backed up with them. On the phone the
library folder is the app's own (ADR 0083), and the file is there. Plain JSON, `formatVersion` first (ADR 0007), its own
schema, `schemas/feature-library.schema.json`, and one checker, `checkFeatureLibrary`
(`packages/ui/src/feature-library.ts`), which the shells and the tests call:

```json
{
  "formatVersion": 1,
  "features": [
    { "id": "f-…", "system": "dnd5e", "revision": 2, "name": "Godspeed", "description": "…",
      "type": "Companion Trait", "stats": [{ "stat": "speed", "mode": "set", "value": 60 }] }
  ]
}
```

A feature is a custom feature's shape (ADR 0063, 0065, 0094) plus `system`, the system it names stats of, and
`revision`, a whole number raised by every change. The file holds every system's; a character is offered its own
system's. One file and not one per system because a user's folder is one list of characters of every system already
(ADR 0031), and a file per system would be a list of files to explain. It is a user's own file, so the format is a
public API, like the character's (ADR 0012).

A missing file is an empty library. A file that does not read or check is **not overwritten**: the library says it
cannot be read and why, and offers nothing, so a hand edit gone wrong costs the edit and not the library.

### 2. The folder port reads and writes one named file

`CharacterStore` gains two optional methods, `readFile(name)` (null when absent) and `writeFile(name, bytes)`, for a
plain file name inside the chosen folder: never a path, never `.incu`. Optional because a store with no folder has no
library, and each of the test fakes that does not need one stays as it is. Every write reads the file first and applies
the one change asked for to what it read, so a feature added from another device since is kept; nothing else guards
the file.

### 3. Giving a feature copies it onto the character, and the copy records where it came from

The maintainer's choice, "both": a copy, so a character always opens and derives without the library (ADR 0012), and a
link, so a change to the original can reach it. `CustomFeature.library` is `{ id, revision, edited? }`: the library
feature it was copied from, the revision copied, and whether it has been changed on the character since. Recording one
raises the character to **format 12**; the validator refuses it below. Nothing derives from it.

Giving copies the name, description and lines. The type is the library's when the kind lists it, else the kind's
default, and the user changes it as for any feature. A line the kind cannot use is kept and reads as it would had it
been written there (`unknown`, `add-only`, `not-markable`): the engine already reports it and changes nothing, and the
same feature on an NPC sets what it cannot set on a player character.

### 4. A newer original is offered, never applied

When the library's feature has a revision above the one a character's copy records, and its name, description or lines
differ from the copy's, the character's feature says so ("Godspeed has changed in your feature library") with **Update**, which
copies them again and records the new revision. Never on open, never on save: a character changes only when its user
says so, as a content refresh does (ADR 0082). The type is the character's and an update leaves it. When the copy has
been edited on the character, Update says it replaces those changes. A copy whose original is no longer in the library,
or whose library is not in this folder, keeps working and says nothing more than that it is not in the library.

Editing a copy marks it `edited` and offers nothing: a deliberate change on one NPC is not a fault to be nagged about.

### 5. A feature goes to the library from a character

**Save to your feature library** on a feature that came from nowhere adds it to the library, revision 1, under the character's system,
and links the copy to it. On a copy edited since it was given, it is **Save changes to your feature library**: the library's
feature takes the copy's name, description, lines and type, its revision rises, and the copy records it and is no longer
edited. Every other character holding that feature is then offered the update. That is the library's only editor: a
feature is edited where it is used and saved back.

**Remove from library** deletes the library's feature and touches no character.

## What this does not do

- **No library of elements.** A set or mark line is not an element rule, so the library holds features as features.
  Phase 8's element editor and its exported index are still to decide how a user's own content is written; when they
  are, a feature with only add lines can become content, and the move is a copy as ADR 0063 said.
- **No editor of the library itself**, no rename or reorder there: a feature is edited on a character.
- **No conflict resolution beyond the re-read.** Two devices changing one feature at once keep the later write.
- **No offer across systems.** A Cairn character is not shown 5e's features; Cairn's kind declares no custom features
  anyway.

## Alternatives considered

- **A link only, the character holding the library's feature.** It would need the library to derive, or to be embedded
  as content; the first breaks ADR 0012, the second is the content-source format Phase 8 has not designed.
- **A copy only.** What a DM fixes in Godspeed would have to be fixed on every NPC by hand, which is the problem the item
  exists for.
- **Following the library always**, every linked copy taking the original's text when opened. A character would change
  without its user doing anything, and an edit on one character would have to unlink it silently.
- **The app's own storage instead of the folder.** It survives choosing another folder, but does not travel with the
  characters it was written for. The maintainer chose the folder.
- **A file per system.** See decision 1.

## Evidence

- `packages/ui/src/feature-library.test.ts`, over a fixture with no game in it: a feature saved from one character is given
  to another as a linked copy, once, and derives with no library; a newer revision is offered only when it differs and
  Update keeps where the copy is listed; a copy changed on the character is marked and not nagged, and Update says it
  replaces the change; the library's type is used only where the kind lists it; the checker refuses an id twice and a
  broken file is unreadable, not empty; every write reads the file first, and an unreadable file is never written over.
  Each names its perturbation, and eleven were run: the link dropped on give, the offer on the revision alone, the
  revision not recorded on update, the library's type taken on update, a type copied that the kind does not list, the
  duplicate check removed, a broken file read as empty, a write from what was last loaded, a copy's edit not marked, a
  second copy given, and the offer not saying what is given.
- `tools/verify/src/schemas.test.ts`: format 12 with a link validates; a link at 11, and a revision of 0, are refused;
  13 is refused. Fails with the referential check removed, `setCustomFeature` not raising to 12, or the schema's field
  renamed.
- `tools/verify/src/feature-library.test.ts`, against 5e's own kinds with no content: "Godspeed: Speed 60" given to an
  NPC sets its speed and is listed as a Companion Trait; given to a player character it changes nothing, its line reads
  `add-only` and it is listed as a Class Feature; both validate at format 12 and reopen from a packed save with the link
  and the same speed. Fails with the type check in `givenFeature` loosened or the link dropped.
- **Driven in the browser build** (the folder picker stood in for by a private browser folder, the controls by DOM
  events): Godspeed written on one NPC and saved to the feature library, the file read back; a second NPC given it,
  its sheet reading Speed 60; the first changed to 80 and saved back as revision 2; the second offered "Godspeed has
  changed in your feature library.", updated to 80, saved, and after a reload reopened with nothing offered. The
  character's own Save was already labelled "Save to library", so the feature's buttons name the feature library. Not
  driven: the Tauri window, the phone.
