# 0104 — A new system starts from a file the app writes, and a copy keeps what it was copied from

**Status:** Accepted · 2026-10-09 · answers ROADMAP Phase 7's "Fork an official system into user space" and "Scaffold a
working system from the app's system flow" · amends [0011](./0011-user-systems.md) (fork and scaffold) and
[0102](./0102-an-overlay-is-a-patch-applied-to-its-parent-on-every-load-and-validated-as-the-system-it-makes.md)
(decision 5, lineage) · builds on [0031](./0031-a-system-is-chosen-and-it-scopes-everything.md),
[0038](./0038-a-copy-goes-through-a-save-port-and-changes-nothing-else.md),
[0039](./0039-the-cli-is-removed-and-what-it-measured-becomes-tests.md),
[0103](./0103-a-system-error-says-where-in-the-file-by-line-and-by-the-ids-written-there.md) ·
**format:** additive (an optional root `copiedFrom`, `formatVersion` stays 1)

## Context

ADR 0011 promises three ways to get a system of your own: fork an official one, overlay it, or start from a scaffold,
"not from scratch": nobody should face an empty file. Overlays are ADR 0102. The other two were `incudo system new`, which
went with the CLI (ADR 0039), and nothing replaced them. The only way in is *Add a system…* with a file the user wrote.

### Measured first

- **A user system lives in the app's storage**, as the text of the file that was added (`UserSystemStore`). There is no
  way to get the file back out, and no way to edit it in place: editing means changing the file on disk and adding it
  again, which replaces the stored one by its id. So whatever the app makes has to be written somewhere the user can open.
- **A full copy of 5e under its own id validates** (175,061 characters, 6,879 lines written with two-space indents), and
  is useless. Its lineage is its own id, so it loads **no content**: AuroraLegacy is tagged with 5e, a source has one tag
  (ADR 0031 decision 4), and adding it to the copy is refused. It is offered no starting equipment and no official form
  either, both of which follow lineage since ADR 0102. That is the capability gap ADR 0011 calls a bug.
- **An overlay that changes nothing is refused**: `version` is required in an overlay's shell. A starting overlay has to
  write one.
- **The smallest complete system** needs a version, at least one element type, its stats and a kind. One shaped like
  Cairn's kind (scores entered through a budget step, no content needed) builds a character with **no content at all**:
  three scores entered, a derived stat on the sheet, nothing left open.
- **A shipped system as validated is its file**: `validateGameSystem`'s value is deep-equal to `systems/<id>/system.json`
  for both shipped systems, so a copy can be written from what the app already holds.
- `UserSystemStore.add` **replaces** a system of the same id without asking (that is how an edited file comes back). A
  new file given an id the user already has would silently replace that system.

## Decision

### 1. One "New system…" flow, with three starts

The launcher offers **New system…** beside *Add a system…*. The user gives a name and chooses where to start:

- **A small starter system**, Incudo's own (decision 3);
- **changes to** a shipped system: an overlay (ADR 0102), which keeps receiving that system's fixes. Offered first for
  each shipped system, since ADR 0011 calls it the preferred path;
- **a copy of** a shipped system: the whole definition under a new id, which does not.

Forking is offered for shipped systems only. A user's own complete system is already a file they have; an overlay of one
is still possible by writing `extends` by hand.

### 2. The file is saved where the user chooses, then added

The app writes the file through the save port (`FileSaver`, ADR 0038), suggesting `<id>.json`, and then adds exactly those
bytes through `UserSystemStore.add`, the same validation as any added file. A cancelled save adds nothing. The launcher
then says where it was saved and that editing means changing that file and adding it again. The file is not kept only in
the app: that would leave the user a system they cannot open in an editor.

The **id** is made from the name: lowercased, every run of other characters a hyphen, at most 64 characters, the
schema's pattern. When the shipped systems, the user's systems or a definition that failed to load already use it, `-2`,
`-3`… is added, so a new system never replaces one. A name with no letter or digit is refused with a sentence.

Every start writes `version` `"0.1.0"`, since it is the user's system from now on, and a description saying what it
started from. Nothing else is invented.

### 3. The starter is a small, generic system written for the purpose

Not Cairn: its words are another game's, and a starting file should carry only names the author will replace. It declares
two element types (Trait, Item), three scores entered by hand (1 to 20), a level from 1 to 10, a Health stat derived from
a score and the level (so a formula is there to copy), one kind with a required scores step and two optional element
steps, notes about the character, and a sheet. It builds a character with no content. It lives in `packages/ui` as data,
built by a function that takes the id and name, and is never shipped as a system.

### 4. A copy records what it was copied from, and that is part of its lineage

The system format gains an optional root **`copiedFrom`**: the id of the system a definition was copied from. It does
nothing but join the lineage: `systemLineage(system)` is the system's own id, then its `extends`, then its `copiedFrom`,
each once. So a copy of 5e loads 5e's sources, is offered 5e's starting equipment and its official form, as an overlay
is (ADR 0102 decision 5), with the same checks: a file for a kind or step the copy no longer has offers nothing. It does
**not** receive 5e's later changes to the definition; that is what makes it a copy.

`copiedFrom` names an id, and nothing checks the id exists: a copy whose origin is gone loads what is tagged with its own
id, as any system does. It is in `$defs/overlay` too, as every root field is (the guard test of ADR 0102), and an overlay
of a copy inherits it, so the overlay reaches the original's content as well.

A copy's launcher card says what it is a copy of and that it uses that system's content.

## Consequences

**Good**
- Nobody starts from an empty file, and every start is a file the app has already validated and can locate errors in
  (ADR 0103).
- A copy has every capability its original has, and ADR 0011's bug is closed for forks.
- No engine change; the Aurora oracle cannot move.

**Bad / accepted**
- **Editing is outside the app**, in whatever editor the user has, and coming back is *Add a system…* again. An in-app
  editor, or watching the saved file, is not attempted.
- **`copiedFrom` is a claim by the file**, like `official` on a suggested source: a hand-written file can name 5e and get
  5e's sources. That is harmless; the user chose both.
- **A copy's source switch is its original's.** One URL still has one tag (ADR 0102 decision 5), so switching AuroraLegacy
  off in the copy switches it off in 5e, and the Sources pane says so.
- **The copy is written with two-space indents**, not the shipped file's layout, which keeps long expressions on one line.
  The text is the same JSON.
- **No `$schema` line in the files written.** The schema's `$id` does not yet serve the schema; that is the open item on
  publishing it.
- The phone still has no user systems, so none of this is on the phone.
