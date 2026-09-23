# 0027 — A character library is a folder the user chooses, and the folder is the list

**Status:** Accepted · 2026-09-11
**Builds on:** [ADR 0012](./0012-self-contained-saves.md), [ADR 0007](./0007-native-formats.md)
**Amended by:** [ADR 0031](./0031-a-system-is-chosen-and-it-scopes-everything.md) — a launcher
now asks which game system before the library, and the library shows only that system's
characters. The argument below is against a *content* gate and it still stands in full: picking
a system leads straight to the library, and every save still opens with nothing configured.

## Context

The app opens on **Sources**, with an index URL in a text box, and does nothing at all until 244
files have come down over the network. That is the wrong first screen. Aurora opens on your
characters; adding content is something you go and do.

[ADR 0012](./0012-self-contained-saves.md) is what makes a character-first screen possible. A
`.incu` embeds the content its character uses, so listing and opening characters needs **no
sources, no network and no content load**. If opening a character from the library ever comes to
require a loaded source, this decision and ADR 0012 are both broken.

What was missing was where the characters *are*. `DesktopStorage` was a localStorage placeholder
holding exactly one draft under `character:current`, which is not a library and was never meant
to be one.

## Decision

**A library is one folder on disk that the user picks, and the folder is the list.**

### The layout

Flat, and not recursive:

```
<library>/
├── aelin.incu          a character, zip form
├── second-character.incu
└── borin/              a character, unpacked form — it has a manifest.json
    ├── manifest.json
    ├── character.json
    ├── content.json
    └── assets/portrait.png
```

- Every `*.incu` file directly in the folder is a character.
- Every immediate subfolder containing a `manifest.json` is a character in the unpacked form
  ADR 0012 already specifies.
- Everything else is ignored and left alone — a README, a `notes.txt`, a folder of maps.
- **No index file, no database, no dotfile.** The scan reads the folder every time it runs.

The recursion stops at one level on purpose: it is what makes "an unpacked character" and "a
folder of characters" tell each other apart. A library inside a library is a feature nobody asked
for and a scan with no bound.

**Users will depend on this layout.** It is a public surface in the same sense the save format
is, and changing it later is a migration, not a refactor.

### Which form gets written

New characters are written as a **zip**, because one file is what people email. A character that
is already an unpacked folder is written back as an unpacked folder. The app never silently
converts between the two — the same instinct as never silently changing someone's character.

### Filenames

A new character's filename is its name, slugified, with a numeric suffix if that is taken.
**After that the filename is the character's identity in the library and the app never renames
it.** Renaming a character to something else does not move `aelin.incu`.

That looks like a wart and it is the deliberate half of the decision: this is a folder the user
chose, very possibly one they keep in git or in a sync folder, and an app that quietly moves
their files is an app they stop trusting with them. The grid shows the character's name from the
manifest; renaming the *file* is an explicit action, and one this ADR does not require the first
version to ship.

### Identity, and copies

Within a container, the character's `id` is the identity. Within a library, the **path** is.
Two files holding the same character id — a copy, a backup, a version a friend sent back — are
two entries, both listed, neither merged and neither hidden. Files are files
(ROADMAP non-goal: no cloud sync).

### The folder changes behind the app's back

It will. That is the normal case for a folder in git or in Dropbox, not an edge case.

- **Reading:** the app holds no lock and caches no listing across a rescan. It scans on open and
  on an explicit refresh. A character whose file vanished between the scan and the open is
  reported as gone — never recreated from the stale scan.
- **Writing:** before overwriting an entry, the app re-reads that container's manifest and
  compares its `updated` against what the app last read. If they differ, the write is **refused
  and reported** rather than landing on top of someone else's edit.
- A container that half-reads is shown as an entry with its problems attached, not hidden.
  `readCharacterContainer` reports rather than throwing ([ADR 0005](./0005-aurora-import.md)'s
  "report it, don't guess"), and a library that silently omits a character the user can see in
  their own file manager is worse than one that says what is wrong with it.

### The library is explicit-save

The working character keeps autosaving to `Storage` as a draft, exactly as it does today. Writing
a `.incu` into the library is an action the user takes. A builder that wrote a zip to disk on
every keystroke would be both slow and a poor neighbour to a folder under version control.

### Portraits

An entry shows `assets/portrait.png` when the container has one. When it does not, it shows a
**marked gap** — CSS and type saying there is no portrait. Never a generated silhouette, avatar,
icon or texture. That is a standing project commitment, not a preference (see the README), and a
grid of faces is exactly where it would be most tempting to break it.

### The browser has a library too

`npm run desktop` is where the UI work happens, so it cannot be the build where the library does
not exist. The port has two implementations and neither is a fake:

- Tauri: the `dialog` and `fs` plugins, with the fs scope widened at runtime to **the folder the
  user picked** and nothing else.
- A browser: the File System Access API — a real directory handle, with real bytes, persisted in
  IndexedDB so the library survives a reload.

Where neither exists the library reports itself **unavailable, with the reason**, and offers
nothing. A library backed by localStorage would be a different product wearing this one's UI.

## Consequences

**Good**

- The app opens on your characters. Adding a source is a thing you go and do.
- Listing and opening work with zero sources configured and no network, which is ADR 0012 finally
  being *used* rather than merely proved in a test.
- No database to corrupt, no index to go stale, nothing to migrate when the user moves the folder.
  Copying a `.incu` in from a friend makes it appear; deleting it makes it vanish.
- The unpacked form means a library can be a git repository, reviewable in a diff.

**Bad / accepted**

- **Scanning reads every container.** There is no manifest-only fast path: the zip codec here
  inflates the whole archive, so a library of 200 characters reads 200 archives on open. Measured
  on a set of real saves it is not noticeable; the mitigation when it becomes one is a thumbnail
  and summary cache keyed by path and mtime, and it is deliberately not built yet.

  > **Note, 2026-09-23:** "Measured on a set of real saves it is not noticeable" and "Aurora's portraits are
  > real photographs" cannot be re-derived from the samples. They carry no portrait by construction and are
  > 19 to 66 KB each, so a scan of the 30 says nothing about a library of large containers. The 30-save
  > library test reads them all but was not timed for this note.
- **Portrait bytes are held in memory for the grid.** Aurora's portraits are real photographs;
  a hundred of them is real memory. Same mitigation, same reason for not pre-building it.
- Two store implementations to keep honest instead of one.
- No search, no tags, no folders-within-folders. A library is a folder.

## Alternatives considered

- **A database (SQLite, IndexedDB) as the library, with files exported.** Faster listing, real
  search, and it ends "a character is a file you can email, diff and put in git" — which ADR 0007
  already refused for the same reason.
- **An index file in the folder.** A second source of truth about a folder the user edits
  directly. It would be stale the first time someone copies a file in, and the app would have to
  decide which to believe.
- **Several libraries at once.** Attractive, and it multiplies every question in this document by
  N for a use case nobody has yet. Picking a different folder switches libraries; that is the
  whole of it.
- **Renaming the file when the character is renamed.** Tidier grid, and a surprise in the user's
  own folder. Rejected above.
