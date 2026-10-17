# 0120 — The shell knows whether the character on screen is saved, and asks before replacing unsaved changes

**Status:** Accepted · 2026-10-17 · answers a hands-on pass of the desktop app before 1.0 · amends
[0037](./0037-a-command-is-data-the-page-owns-the-keyboard.md) (New character's availability) and
[0066](./0066-the-draft-keeps-what-the-shell-held-beside-the-character.md) (what the draft keeps) · builds on
[0027](./0027-a-library-is-a-folder.md), [0038](./0038-a-copy-goes-through-a-save-port-and-changes-nothing-else.md),
[0086](./0086-a-phone-builds-and-edits-with-the-desktop-s-builder-its-content-loaded-when-a-build-opens.md) ·
**format:** none (the draft's own record in `Storage` gains a field; no character, system or `.incu` change)

## Context

A hands-on pass of the desktop app found the one finding it ranked "loses work": save a character, change something on
Build, go to Characters and click Open on the same card. The file was read again and the edits were gone, without a
word, under a bar still saying "Saved to …". Nothing in the shell knew whether the character on screen matched its file.

- The library is explicit-save (ADR 0027) and the draft (`character:current`, ADR 0066) is the autosave that keeps the
  character on screen across a reload. The draft holds **one** character: whatever replaces the one on screen (New
  character, an Open, a change of system, whose new `Shell` writes its own draft) replaces it there too. After that the
  only copy left is the library file.
- ADR 0037 kept New character to the Characters screen for exactly this reason ("New replaces the character being edited
  without asking, and nothing tracks unsaved work yet").
- The phone already had the comparison (`edit-session.ts`, ADR 0086: the character as last saved, compared on leaving).
- On a first launch the shell has a blank character only because the builder needs one, and the Build tab counted its
  open decisions (3 to 7) before the user had asked to build anything.

Import was looked at and is not one of these: it writes into the library and reports, and the character on screen does
not change.

## Decision

1. **The working state keeps a baseline**: `WorkingCharacter.baseline`, the character as it was last opened, saved or
   started with New character. It is kept beside the draft in the same record as the opened file's entry (ADR 0066), so
   a reload still knows it, and a record whose baseline is another character's is ignored whole, as before.
2. **`editState(working, current, system)`** (`packages/ui/src/unsaved.ts`) answers two things: `started` (there is a
   character to build) and `unsaved` (replacing it would lose what its file does not have). Unsaved is the builder's
   character compared with the baseline by its recorded inputs, keys in any order, ignoring `updatedAt`, which every
   edit moves: an edit undone is no change. A draft written before the baseline was kept is judged conservatively: in the
   library, or not a blank character of its kind, it is started and unsaved until the next save or open; blank, it is not
   started.
3. **Build's bar says "Unsaved changes"** beside the file it edits, and "Saved to …" is shown only while nothing has
   changed since. A character never saved still reads "Not saved to your library yet".
4. **Open on a card** (`openOutcome`): the character on screen with unsaved changes is *shown* (Build, no read of the
   file); another character with unsaved changes on screen *asks*; otherwise the file is *read*, the character on screen
   too, so a file changed on disk since is what is shown (the 2026-09-28 fix in `use-builder.ts` stands).
5. **New character, opening another character and Change system ask first** while there are unsaved changes:
   "Save first", "Discard changes", "Keep editing" (`replacePrompt`). Escape keeps editing. "Save first" saves to the file
   being edited, or a first file, and carries on only if the save succeeded; it is not offered with no library, nor for a
   character renamed since its last save, whose question about the file's name belongs to the bar's Save (ADR 0027).
6. **New character is live on every pane with a library** (amends ADR 0037), since it now asks.
7. **Before a character is started**, Build and the Sheet say "No character yet" with New character and Go to
   Characters, the Build tab counts nothing, and the commands that act on the character (`save-character`, `save-copy`,
   the sheet's exports and print, `review-content-updates`, `switch-build-tab`) are off: `CommandContext.started`. The
   app already opened on Characters; now nothing points past it.

## Consequences

- Held by `packages/ui/src/unsaved.test.ts` (the comparison, a character opened from a library reading clean in a real
  `CharacterBuilder` and unsaved after an edit, the not-started rule, legacy drafts, Open's three outcomes, the question's
  words, the draft round trip) and `commands.test.ts` (New character on every pane; nothing acts before a start), each
  case failing under its named perturbation.
- Driven in the browser build only: first launch with nothing started, a save, an edit, a reload keeping "Unsaved
  changes", Open on the same card keeping the edits, Ctrl+N from Build asking, Escape keeping, Save first then a new
  character, Discard then another character opened from its file, Change system asking with no Save offered for a
  renamed character. Not in the Tauri window.
- Not done: autosaving a character that is already in the library (the pass suggested it; the library stays
  explicit-save, ADR 0027), marking the on-screen character's card in the library, and the phone, which keeps its own
  `edit-session.ts`. The Build tab still counts optional decisions once a character is started (a separate finding).
