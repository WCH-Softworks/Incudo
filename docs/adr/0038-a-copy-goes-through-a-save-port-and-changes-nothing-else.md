# 0038 — A copy is written through a save port, from the one packing function, and changes nothing else

**Status:** Accepted · 2026-09-20 · builds on [0012](./0012-self-contained-saves.md),
[0027](./0027-a-library-is-a-folder.md) and [0037](./0037-a-command-is-data-the-page-owns-the-keyboard.md)

## Context

Saving writes into the library folder and nowhere else. A player who wants a backup before a
level-up, a copy to email to a co-player, or a file on a USB stick had no way to make one short of
finding the file in a file manager. The roadmap's last open box in the desktop phase is "an explicit
export", and it needs a *write* counterpart to `FilePicker`.

Two things made it more than a button:

- **The mobile shell inherits the port.** Its way of getting a file out of the app is a share sheet,
  which is not a save dialog and reports different things. A port shaped around the desktop dialog
  is one the phone would implement badly.
- **A copy looks like "Save As" and is a different operation.** A Save As moves the document: the
  next Save goes to the new file. A copy leaves the file being edited alone, and getting that wrong
  is quiet — the next Save writes over a file the user did not mean, or reports a conflict with the
  file they just made.

## Decision

### 1. The port is `FileSaver`, a sibling of `FilePicker`

```ts
interface FileSaver {
  readonly available: boolean;
  readonly unavailableReason?: string;
  save(bytes: Uint8Array, options: FileSaveOptions): Promise<SavedFile | null>;
}
interface FileSaveOptions { suggestedName: string; title?; extensions?; label? }
interface SavedFile { name: string }
```

in `packages/core/src/platform.ts`, implemented in `apps/desktop/src/platform.ts`.

- **Not a method on `CharacterStore`**, whose every method means "inside the folder the user
  chose". This is the one write that deliberately goes somewhere else. **Not a method on
  `FilePicker`** either: `FilePicker` reads a file and forgets it, this hands bytes over and forgets
  them, and a platform that can do one need not do the other — a phone can share a file and cannot
  read one from a path.
- **It takes bytes, not a character.** What is inside a `.incu` is the packing function's business
  and a platform needs no opinion on it; bytes are also what a share sheet wants. The desktop's
  Tauri and browser implementations and the mobile one differ only in how a destination is chosen.
- **Choosing and writing are one call.** A `pickDestination()` returning a handle would leave a
  grant open between two calls. Here the destination exists only while the bytes go into it, which
  is the property `FilePicker` already has in the other direction.
- **Cancel returns `null`**, an answer and not a failure, matching `FilePicker.pick` (an empty list)
  and `CharacterStore.choose` (`null`). A platform that reports a cancel by throwing turns it into
  `null`: the browser's `AbortError` does. A write that fails throws, and the caller reports it.
- **The result is a name, never a path.** Like `PickedFile`. A share sheet cannot say where a file
  went and may only be able to return the name it offered; the type allows that.
- **Replacing a file is the platform dialog's question.** No implementation builds a path of its
  own. Observed in the Windows window: choosing a file that exists raises the system's own "Confirm
  Save As", and answering No left the file byte-identical.
- **Where it opens is the operating system's choice.** Only a suggested name is passed, so Windows
  reopened at the last folder used, which was the developer's library folder. That is not a fault
  — the replace prompt above is what stands between the dialog and a library file of the same name
  — and it is recorded because a reader would otherwise assume a copy starts somewhere neutral.

A single file only: the copy is the zip form. A folder-form character cannot be chosen in a save
dialog, and the zip is the form people send each other (ADR 0012).

### 2. What is written is what the library writes, from the character on screen

`packCharacter` in `packages/ui/src/character-library.ts` is the one packing function. It was the
inside of `CharacterLibrary.save`; it is now a function both call: element collection with the
kind's baseline, source provenance from the profile, and the container tree. `saveCopy` in
`packages/ui/src/character-copy.ts` packs, zips through the `ZipCodec` port, then offers the bytes to
the `FileSaver`. There is no second serializer and a rule added to `packCharacter` reaches both.

It is packed from the character **as it is now, unsaved edits included** (a copy of something you
are still working on is the point), and **before the dialog opens**: a character that cannot be packed
is reported without the user having chosen a place for a file that will never exist.

### 3. A copy is not a Save As, and that is structural

`saveCopy` takes **no `CharacterLibrary` and no `LibraryEntryRef`**, so it cannot write to the
library, run the library's conflict check or make a listing stale. Its result carries **no entry, no
timestamp and no character name**, so a caller has nothing to point the editing session at even by
mistake. The desktop shell's `copyToFile` has no `setWorking` in it: `working.entry`,
`working.readAt` and `working.savedName` are what the next Save writes to and compares against.
`character-copy.test.ts` holds this from both ends, with a store that records every call and an
assertion on the keys of the result.

### 4. The command: Ctrl+Shift+D, on Build, beside Save

`save-copy`, labelled **Save a copy…** (an ellipsis because it asks something first), in the File
menu directly below Save to library.

- **Shortcut Ctrl+Shift+D** (`⇧⌘D`), for "duplicate". **It was Ctrl+Shift+S, the Save As chord, and
  that does not work in the Windows window.** Pressed as real input, the page receives Control and Shift
  and then no key-down for S, only the key-up: WebView2 takes the chord first (Edge's web capture is on
  it). An injected DevTools key event had opened the dialog and hidden this, because injected events
  skip that layer. The same real-key test on eleven other Ctrl+Shift chords: **S, E, U, M, G and X are
  taken; K, O, D, H, B, Y and L arrive.** D is the mnemonic one. `commands.test.ts` now keeps the taken
  chords out of the list, and the comment beside the entry says how they were found. It clears ADR 0037's
  other rules (a primary modifier, no Alt, no editing key); Shift is compared for equality, so Ctrl+S and
  Ctrl+Shift+D are two commands and Ctrl+Shift+S is bound to nothing. The command is not Save As, and the
  confirmation says "Saved a copy as …". Chrome does not keep Ctrl+Shift+D from a page; Edge may take
  it as it does Ctrl+Shift+S, which was not tested in a browser tab.
- **Enabled on Build only**, the ADR 0037 principle: its confirmation, "Saved a copy as
  nyx.incu.", is printed in the pane bar beside Save's, and a copy that succeeded on the Sheet pane
  with nothing on screen is worse than a greyed item.
- **It does not need a library.** Where Save needs a folder chosen, a copy needs only a platform
  that can show a save dialog (`saverAvailable`, a `CommandContext` field), so it is live with no
  library chosen and where the library is unavailable. That is the reason for a second command.
- **A copy in flight blocks another copy and Save**, and a Save in flight blocks a copy. A second
  press while the first is still packing or writing would open a second dialog, and two "Saved …"
  notes would race for one line.
- **A disabled copy still claims its key**, as every command does. Cancelling shows nothing and
  leaves the previous note in place.
- The menu is click-only and the page owns the keyboard, unchanged from ADR 0037.

### 5. Tauri: one permission, no Rust

`capabilities/default.json` gains `dialog:allow-save`. `tauri-plugin-dialog`'s `save` command calls
`allow_file` on the fs scope for the path it returns, exactly as `open` does for an import (read in
the plugin's source under `~/.cargo/registry`, then confirmed by writing a new file through the real
dialog with no scope granted beforehand). The scope widens to the one file the user just named, and
`fs.writeFile` creates it. `allow_library_folder` is not involved.

The browser build uses `showSaveFilePicker`, with its own dialog id so it remembers where copies go
apart from where imports come from. It writes to a swap file and replaces the destination only when
the stream closes, so a failed write leaves an existing file as it was. Where the API is missing —
Firefox, Safari — `FileSaver.available` is false, the button is disabled with the reason as its
tooltip, and the command is off: the same posture as the other ports.

## Consequences

- **Found by measuring, and fixed in the change after this one:** the app's Save, and so a copy,
  packed an opened character **without its portrait**. `OpenedCharacter` carried no asset bytes, so a
  re-save kept the `assets.portrait` reference and dropped the file it points at, and the reader
  reported a placeholder. All nine real characters carry a portrait and all nine lost it, 18 of 18
  across the two routes. `OpenedCharacter.assets` now returns the container's asset files, the shell
  holds them as `working.assets`, and both Save and a copy pass them to `packCharacter`. Seen in the
  running app: an imported character with a 213,874-byte portrait, opened from a library folder,
  wrote the same bytes on Save and on a copy.
- **A copy, like any re-save, drops what only an import knew.** The Aurora import passes Aurora's own
  `<sum>` as `extraIds`; a re-save has nothing to pass. Across the nine that is one element,
  `ID_INTERNAL_MULTICLASS_LEVEL_3`, the marker no rule reaches and no derived number depends on, and
  the unresolved ids only that `<sum>` named (three, in the one save looked at). `save-copy.test.ts`
  asserts that anything a copy drops is unreached by the derivation.
- A copy is not linked to anything. It is a file; opening it later is the library's business, and the
  library lists any `.incu` in its folder.
- Phase 5's Markdown and PDF exports are different bytes through this same port.

## Evidence

> **Note (ADR 0039):** "opens in the CLI with zero sources" below records a check made with
> `incudo character show`, which no longer exists. The same property is asserted by
> `save-copy.test.ts`: each copy is read back with no source configured and must derive identically
> to the save it was made from. Nothing below is re-run or rewritten.

`character-copy.test.ts` (15 tests), `commands.test.ts` (6 new), and `tools/verify/src/save-copy.test.ts`
over the nine real saves, skipped where they are not installed and never committed. Each behaviour
was checked by breaking it (25 perturbations; one survived at first, in `packages/ui`, and is what
the portrait fix and its tests then closed):

| perturbation | caught by |
|---|---|
| copy live on every pane; copy needs a library; `saverAvailable` ignored | build-pane test; "needs no library"; "needs a save dialog" |
| a copy or a save in flight does not block the other three ways | "in flight" test, all three |
| copy on Ctrl+S; copy on Alt; copy moved away from Save; an ADR number in its label | shortcut, text-editing, menu and plain-label tests |
| copy ignores the profile; packing forgets the kind baseline or the profile | "byte for byte", "records the source versions", "derives exactly" |
| cancel reported as failure; cancel thrown | "cancelling is a result" |
| availability ignored; result carries an entry; no filter; suggested name ignores the character | one test each |
| the library's Save stops passing its profile / `extraIds` | "byte for byte"; the Aurora import test |
| the library's Save stops passing `assets` | survived at first; caught by the real-saves library test, and by the portrait tests added with the fix |
| `open` returns no assets; `saveCopy` or the library's Save ignores the ones it is given | the portrait tests in `character-library.test.ts` and `character-copy.test.ts`, and the real-saves test |

**What the tests cannot show, and what was and was not seen** (2026-09-20):

*Browser build* (`npm run desktop`, the pane's Chromium, key events injected and the dialog replaced
by a handle that records what is written): Ctrl+Shift+S (the first shortcut; see
above) opened the dialog with the character's name and the `.incu` filter and wrote a zip; cancelling wrote nothing and left the note;
a failing write printed "Could not save a copy. The disk is full."; the chord on the Sheet pane was
claimed and did nothing; behind the rename dialog it did nothing. **With a real library folder**
(an origin-private directory): a copy of a renamed, unsaved character offered the on-screen name,
left the library at one file and the pane bar at "Editing new-character.incu", and the next Ctrl+S
still raised the rename prompt naming the original file and still saved without a conflict — the
three fields a Save As would have moved were untouched. The bytes the browser wrote opened in the
CLI with zero sources. The console was clean. Not seen: the real browser save dialog (it is native)
and a Firefox or Safari tab.

*Tauri window, Windows, first session (screen locked)*: the menu lists Save a copy… under Save to
library, off on the Characters pane and on for Build. Sent as its own menu message, the command opened the real
Windows save dialog titled "Save a copy of this character", offering the on-screen character's name and
"Incudo character (*.incu)". A scratch path typed into the dialog and Save pressed wrote a 41 KB file;
it opened in the CLI with zero sources (148 elements embedded) and the page printed "Saved a copy as
tauri-copy.incu.". Choosing that file again raised "Confirm Save As"; No left it untouched; Cancel
closed the dialog; the button re-enabled and the note stayed; the developer's own library file was not
touched. No real keystroke could be sent, so the dialog was driven with window messages and the chord
as an injected DevTools key event. That is how Ctrl+Shift+S looked fine.

*Tauri window, Windows, second session (real input, screen unlocked)*: after the discovery above, the
menu reads `Ctrl+Shift+D`. Real Ctrl+2 moved to Build. **Real Ctrl+Shift+D opened the real save dialog;
a scratch path typed into it and Enter wrote a 41,754-byte file** that opens in the CLI with zero
sources, and the page printed "Saved a copy as tauri-real-keys.incu.". A second real chord followed by
a real Esc closed the dialog and left the note and the enabled buttons as they were. Nothing was sent
unless the window or dialog held the foreground; the developer's library file was untouched.
macOS and Linux were not seen.

## Alternatives considered

- **`CharacterStore.exportTo(...)`.** Breaks "every method means inside the chosen folder".
- **`FilePicker.save()`.** Two contracts in one interface for platforms that implement one.
- **A port that takes a `Character` and packs it.** A serializer per platform, and no share sheet.
- **`pickDestination()` then `write(handle, bytes)`.** A grant left open between two calls.
- **Save As.** Re-points the editing session and is the operation this is deliberately not. Making
  it one would want the rename question ADR 0027 asks, and the answer to "which file am I editing now"
  belongs to whoever chose to move it.
- **Enabled on every pane, or on Sheet as well.** No confirmation to see there.
- **Requiring a library.** Would tie a copy to the folder it exists to get away from.
- **Passing a starting folder.** The platform's own memory of where the user last saved is usually
  the right place, and the replace prompt covers the case where it is not.
