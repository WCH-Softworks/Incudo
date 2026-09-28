# 0066 — The draft keeps what the shell held beside the character

**Status:** Accepted · 2026-09-28 · builds on [0012](./0012-self-contained-saves.md),
[0027](./0027-a-library-is-a-folder.md) and [0038](./0038-a-copy-goes-through-a-save-port-and-changes-nothing-else.md) ·
**stored format:** a new record in the app's own `Storage`, `character:current:origin`, `formatVersion` 1. Neither the
`.incu` format nor `character.json` changes.

## Context

The shell autosaves the character being edited to `Storage` as a draft, `character:current` (ADR 0027): the character
alone, as `character.json`. A character opened from the library is more than that. The shell holds four other things
about it, and the draft kept none of them:

- **the save's embedded content**, which the builder resolves elements through in front of the loaded sources, and which
  is what lets a save open with zero sources (ADR 0012);
- **its asset files**, which the next Save and any copy write back out (ADR 0038: a character records only where its
  portrait is);
- **the library entry** it came from, which Save writes back to;
- **what the manifest said when it was read** and **the name it was saved under**, which the conflict check and the
  rename prompt compare against.

Found by running the browser build, not by a test. An NPC built on a creature from a user's file source, saved, every
source switched off and the file opened again: the sheet read *NPC / Monster · 6 elements*, challenge rating 10, armour
class 18, hit points 150. A reload of the page: *0 elements*, challenge rating 0, armour class 0, and the Build pane
said *Not saved to your library yet*. Save then wrote a **second file**, `new-character-2.incu`, embedding **0
elements** at challenge rating 0, beside the original. So a reload did not only hide the creature until the file was
opened again: the next Save wrote a save that had lost it, which is the ADR 0012 failure.

## Options

1. **Remember only the library entry, and reopen the file on boot** for its content and assets. Small, and the file is
   the one copy of the content. But a boot then depends on the library being reachable, and in the browser build a
   picked folder's permission has to be asked again after a reload and needs a click: the draft would come back
   without its content exactly where the folder is not granted yet. And the file may have changed on disk since it was
   opened; its content would be the newer one while the conflict check compares against the older time.
2. **Store the draft as a whole `.incu`**, packed from the character on every change. It would also keep what the
   character took from a source after it was opened. But it is a collection and a pack on every keystroke, which is
   what ADR 0027 refused for the library, and it makes a reload *differ* from the session before it: with a source off,
   the live session shows no element from that source, and a draft that embedded one would show it after a reload.
3. **Keep the rest of the working state beside the draft**, under its own key, written when it changes. *Chosen.*

## Decision

1. **The draft is the whole working state.** `character:current` stays the character, unchanged. Beside it,
   `character:current:origin` keeps the rest of what the shell holds: the embedded content as the elements of the
   save's `content.json`, the asset files as base64 (`Storage` holds text), the library entry, the time the file was
   read and the name it was saved under. On boot the shell starts from both. `packages/ui/src/draft.ts` is the whole of
   it (`WorkingCharacter`, `writeDraftOrigin`, `readDraftOrigin`); `boot.ts`'s `loadDraft` reads it and `App.tsx` has one
   effect that writes it.
2. **What it keeps is what the session held, not what the character reaches.** An element taken from a source after the
   file was opened is not kept: the session before the reload did not have it with that source off either. The claim is
   that a reload changes nothing, and the tests hold that and no more.
3. **Written when the working state changes, never on a keystroke.** That is an open, a new character or a save. A real
   save's content is hundreds of elements and a portrait can be megabytes; the character itself is still written on
   every change, as before.
4. **Tied to the draft by the character's id.** Two keys cannot be written together, so the record says which character
   it belongs to, and a record for any other character keeps nothing. That covers a draft replaced while the record was
   not, and the fresh character a boot starts when the draft is another system's.
5. **All of it or none.** A record that does not read (another format, an element that could not be indexed, an asset
   outside `assets/` or not base64, an entry of an unknown form or without the name it was saved under) keeps nothing,
   and never throws, as a corrupt draft never did. Half a working state is worse than none: an entry kept without the
   content it was opened with is the second file above, written over the first.
6. **A new character keeps no record, and removes the one before it.**
7. **The time the file was read is kept as it was.** A reload does not refresh it, so a file changed on disk since it was
   opened is still a conflict at the next Save rather than written over.

## Consequences

- **Evidence.** `packages/ui/src/draft.test.ts`: a character opened from a library and read back through the draft with
  no source derives as it did when opened; Save after that goes to the same file and embeds what it did; the conflict
  check still fires; every asset byte comes back; a record for another character, or one broken in each of ten ways,
  keeps nothing. The control in the first two is the bug itself (nothing kept: a guard of 0, and a second file with 0
  elements). Each test was checked by breaking what it names: not keeping the elements, the entry or the read time, not
  checking the id, and accepting a base64 decode that skipped characters each fail at least one.
- **Driven in the browser build** (not the Tauri window): the reproduction above, then the same NPC opened, the page
  reloaded with every source off, and the sheet read *6 elements* with its creature; the Build pane said *Editing
  new-character.incu*, and Save wrote that file, still embedding 6, with no new file. New character removed the record.
- **The draft is larger.** By the size of the opened file's content and assets, once, in the app's own storage.
- **A draft written before this has no record**, and comes back as it did: without its file's content until the file is
  opened again. Nothing migrates it; there is nothing to migrate it from.
- **Not changed:** what the library, the `.incu` format or `character.json` hold, and the draft of a character that was
  never opened from a file.
