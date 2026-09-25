# 0056 — An Aurora file the user adds is a source of its own, kept as a copy

**Status:** Accepted · 2026-09-25 · builds on [0012](./0012-self-contained-saves.md) (a save embeds what it uses),
[0028](./0028-sources-are-a-profile-characters-carry-an-allowlist.md) (sources are a profile),
[0031](./0031-a-system-is-chosen-and-it-scopes-everything.md) (a source belongs to a system),
[0052](./0052-a-source-that-refers-to-content-no-enabled-source-has-is-reported-and-never-blocked.md) and
[0054](./0054-when-two-sources-define-the-same-id-the-later-one-in-the-list-is-used-and-the-list-says-so.md)

## Context

ROADMAP Phase 3's last item: "Import a raw Aurora `.xml` the user drops in". Homebrew for Aurora is mostly single
elements files passed around by hand, never published behind an index: a subclass, a race, a table of magic items.
Aurora itself takes one by copying it into its `custom` folder. Incudo reads content only through an index at a URL, so
such a file has no way in.

Three questions decide it: what the file becomes, where its bytes live, and how it is updated.

## Decision

### 1. A file is a source of its own

Each file the user adds is one entry in the sources profile (`ConfiguredSource.kind: 'file'`), tagged with the system it
was added under (ADR 0031), enabled, ordered with the rest (ADR 0054: added last, so its definitions are the ones used),
and loaded through the same library as every other source. Everything a source already gets, it gets: its line in the
Sources pane, what it refers to that nothing enabled contains (ADR 0052), what it shares with other sources (ADR 0054),
and a place in what a character records it was built against (ADR 0028).

Several files picked or dropped together are several sources. A pack of files could be one source, but that needs a
name and a membership nobody wrote down, and one file per line says per file what each lacks.

### 2. Its bytes are copied into the app's own storage when it is added

The picker hands back bytes and no path, and is "read once and forgotten" (`FilePicker`, ADR 0027's import). The copy
is kept in the injected `Storage` under `sources/files/<id>`, outside the `content/` cache prefix, so nothing that
evicts, prunes or refreshes a cache can touch it: it is the only copy the app has. Removing the source removes the copy.
A character built from it embeds what it uses (ADR 0012), so removing it costs no character.

### 3. The file's name is its identity, and adding it again replaces the copy

The id and URL are `local:<file name>`. Adding a file whose name a file source already has replaces that copy in place,
keeping its name, position and enabled state: the same rule `SourceProfile.add` already applies to an index URL added
twice, and the way to bring in a newer version of the file. A name held by a source of another system is refused, as a
URL is. Two different files that share a name need one renamed first. A random id would have avoided that and made the
same file added on two machines two different sources to every character that records it.

### 4. It is checked when it is added, and refused with a sentence

The text must parse as an Aurora elements file with at least one element or `<append>`. An index is refused with its
own sentence ("add it by its address"), because an index names files at URLs and a copy of it alone loads nothing. Any
other file is refused as holding no Aurora elements. Parse diagnostics for a file that is accepted are reported the way
every load's are.

### 5. It has no update check and no refresh

There is nothing upstream to ask. The Sources pane shows no mode, no "Check for updates" and no "Refresh" on its line,
and `checkSourceForUpdates` and `refreshSource` say so if called. Its version is the one its `<info><update>` declares,
when it declares one, so a character built against an older copy reads as "moved" once a newer one replaces it
(ADR 0028).

### 6. Picked or dropped

"Add a file…" opens the platform's picker (`FilePicker`, `.xml`, several at once). A file dropped on the window while
the Sources pane is open is added the same way: a new port, `FileDrop`, because the page never sees a dropped file in
the Tauri window (the webview hands drops to the host, and `tauri-plugin-fs` grants each dropped path in its scope),
while a browser hands the page the file itself.

## What was measured after it was built

- **A corpus file added on its own loads to what the corpus load made of it.** `tools/verify/src/source-parts.test.ts`
  takes the element file of AuroraLegacy at `c28ce6c` with the most elements among those whose own bytes use CRLF line
  endings (51 files in the repository have them), adds it as a file source and loads it with no network: the same 285
  ids, every description identical and free of carriage returns (the XML reader's line-ending fix of the same day), and
  all 285 identical in rules and tags. (The test compares rules only where no other file appended to the element.)
- **`packages/content/src/file-source.test.ts`**, with a perturbation named in each test: a file source loads from its
  copy with no network (composing it as an index at a URL asks the network); adding a file of the same name replaces the
  copy and keeps the user's name, place and enabled state; an index, a file with no elements and a file that is not
  `.xml` are refused with a sentence and nothing is written; a name another system holds is refused; the copy survives
  evicting the source's cache, and removing the source removes it; there is no update check or refresh; a missing copy
  fails the load with a sentence. `packages/ui/src/source-parts.test.ts`: several files are one source each and one
  refusal does not stop the rest; a UTF-8 byte order mark is dropped and UTF-16 is read.
- **Driven in the browser build on Windows** by a drop event carrying two files (a real drag from the desktop cannot be
  made by the tools that drove it): the homebrew file became a source with its version, the other was refused as holding
  no Aurora elements, the homebrew element showed in Browse with its source and file, a second drop of the same name
  replaced it (1.0.0 to 1.1.0), and both survived a reload. Removing it removed the copy from storage. **Not driven:**
  the file picker (a native dialog), the Tauri window's drop (`TauriFileDrop`, written against the plugin's source and
  never run), macOS and Linux.

## What this does not do

- **A folder, or a zip of files.** One file per source; a pack wants a name and a manifest, which is Incudo's own content
  format's job (ADR 0052 decision 3).
- **Watch the original file.** Nothing retains its path; a changed file is added again.
- **An Aurora `.index` from disk.** Its files are URLs; adding it by its address is the way in.

## Alternatives considered

- **Keep the path and read the file each launch.** The picker returns no path by design, a browser has none to give,
  and a moved file would silently take its content with it.
- **Put the text in the content cache under the source's id.** The cache is disposable by contract: eviction and the
  refresh prune (ADR 0050) remove whatever a load did not touch, and a copy of a user's only file must not be that.
- **Merge dropped files into one "local content" source.** One line would hide which file lacks what, and the order
  between two homebrew files that define the same id could not be changed.
