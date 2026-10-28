# 0085 — A source is kept converted into Incudo's own form, and loaded from that

**Status:** Accepted · 2026-10-03 · amends [0029](./0029-a-cache-is-keyed-by-source-and-evicted-by-version.md) (what the
cache keeps) · builds on [0004](./0004-live-vs-downloaded-content.md), [0007](./0007-native-formats.md),
[0012](./0012-self-contained-saves.md), [0050](./0050-an-update-check-asks-every-cached-file-and-a-refresh-keeps-what-it-cannot-reach.md),
[0051](./0051-lazy-loading-is-declined-and-the-index-walk-stops-waiting-on-itself.md),
[0055](./0055-a-source-records-the-parts-switched-off-and-the-load-skips-them.md),
[0083](./0083-the-phone-app-is-expo-in-the-workspace-its-storage-is-sqlite-and-its-library-is-its-own-folder.md) ·
**format:** none for characters or systems; the source profile gains an optional `keep`

## Context

Building a character on a phone (ROADMAP Phase 6, "Full build flow") needs loaded content, which reading and playing one
never did (ADR 0012). The phone's ports already load it: `MobileFetcher` and `MobileStorage` (ADR 0083), through the same
`loadSources` the desktop uses, moved from `apps/desktop` into `packages/content` for that.

ADR 0029's cache keeps each file's XML as it came, so every load parses every file again. The maintainer asked whether
the phone was "creating an Incudo format source when importing from Aurora". It was not, and neither was the desktop: the
only place elements exist in Incudo's own parsed form is a save's `content.json`. Their answer: a source should be
converted, and this should have been the choice from the start; a user conservative with space may keep the files instead.

### Measured

| | |
|---|---|
| a full AuroraLegacy load on the Pixel 9 Pro emulator, Expo Go, through `loadSources` with the phone's ports (a probe run once, not committed) | cold, from the network: **82 s**, 740 files, 14,545 elements, 0 errors; again from the SQLite cache: **15 s**; the JS heap 16 → 60 MB; the process about 310 MB PSS; a fresh player character's builder 90–270 ms, one pick 80–85 ms |
| `TextDecoder('utf-16le')`, which Hermes lacks (ADR 0083) | not reached: the network path decodes in the fetcher, and no corpus file is UTF-16 (`mobile-build.test.ts`: 804 UTF-8, 14 UTF-8 with a BOM) |
| the loaded index as JSON, in Node | 19.9 MB, `JSON.parse` 120 ms, against 0.8–3.7 s for the XML load |
| `tools/verify/src/converted-source.test.ts`, the corpus kept each way, in Node | kept as files 14.7 MB in 801 values; converted **19.8 MB in 801 values**; a later load 1.5 s from the files, **0.6 s** from the conversion; the converted load's elements, in order and in full, and its warnings and errors **identical** to the files' |
| the first version on the phone: the whole conversion as **one** 21 MB value | `expo-sqlite` read it back in **20 s** (the parse took 0.75 s more); writing a conversion one value at a time spent 65 s in 1,600 statements, about 40 ms each, one commit apiece |

## Decisions

1. **A source is converted, by default.** After a load, what it read (every index and file, as `parseAuroraIndex` and
   `parseAuroraElements` returned them, each file with its `<append>`s and diagnostics) is written as JSON under the
   source's cache prefix, **one value per index or file** (`content/<source>/.converted/<url>`), and the raw file each
   replaces is removed. The next load reads the conversion first; anything it does not hold (a part switched back on, a
   file a failed load missed) comes from the raw cache or the network, and only that is converted and written. One value
   for the whole source was built first and measured on the phone (above): reading it back took longer than parsing the
   files. All of a conversion's writes and removals go to `Storage.apply` where the platform has it (an optional method
   on the port, decision 7).

2. **Files, not a flat list of elements.** `ContentLibrary` folds appends across sources (ADR 0051), reports what a source
   refers to and nothing declares (ADR 0052) and what two sources both define (ADR 0054), all by the files each source
   handed it. A conversion hands it the same files, so a load from it *is* the same load; nothing downstream knows which it
   was. Each answer is copied when it is given, before the library folds an append into it: otherwise an append would land
   twice on the next load.

3. **`ConfiguredSource.keep`: `converted` (the default, and what an absent value means) or `files`.** The user's choice of
   space against speed, per source. Kept as files, a source is ADR 0029's cache exactly, and a conversion left from before is
   removed on its next load. A file the user added (ADR 0056) is its own copy and is kept as given. The profile's
   `formatVersion` does not move: the field is optional and an older reader ignores it.

4. **Stable as a save's content is, and versioned against the parser.** The parsed form is what every `.incu` already
   embeds, so it is no newer a promise: what changes meaning is read where it is evaluated, never where it is parsed (ADR
   0046). What can make a conversion wrong is the importer parsing the same XML differently (ADR 0076 read descriptions it had
   dropped). So a conversion records `CONVERTER_VERSION`, one written by another is not read, and the source is converted
   again from the network. A guard test hashes the importer's parsing files and fails when they change, asking whether the
   version should move. Each value records the version, so a bump reconverts file by file.

5. **A refresh converts again.** It falls back to the conversion, then the raw files, for what it cannot reach (ADR 0050),
   records everything it read and writes it as the new conversion, unless it reached nothing at all, in which case it
   changes nothing. ETags stay beside the conversion, so an update check still asks every file. A converted source has no
   raw copies to answer a "not modified" with, so **a refresh of a converted source downloads every file in full**; making
   it conditional against the conversion is left for when a refresh's time is measured to matter.

6. **Not `.incuset` yet.** ADR 0007 names a compiled content bundle; this is the app's own storage of one source as it was
   loaded, carrying Aurora's index structure, never a file a user picks or shares. Exporting a converted source as a file
   is Phase 7's (systems and content as a user surface), and will start from this shape.

7. **`Storage` gains an optional `apply(changes)`**, several writes and removals in one commit, and `applyChanges` in
   `core` uses it where it is there and writes one at a time where it is not. The phone's `MobileStorage` implements it
   as one SQLite transaction. The desktop's IndexedDB and Node's storage do not yet: nothing measured there needs it.

## What was built

- `packages/content`: `load-sources.ts` (moved from `apps/desktop/src/content.ts`, `loadSources` now taking
  `ComposeOptions`), `converted-source.ts` (`ConvertedContentSource`, `ConvertingContentSource`, `readConverted`,
  `removeConversion`, `convertedPrefix`, `convertedKey`, `CONVERTER_VERSION`); `Storage.apply` and `applyChanges` in `core`, `composeForLoad` and the converted layers in `compose.ts`, the
  refresh's conversion, `keep` and `keepsConverted` in `profile.ts`.
- Tests: `packages/content/src/converted-source.test.ts` (each case naming the perturbation that fails it: the second load
  touches no network and loads the same; the raw copies go; an append is folded once; `files` writes none and removes an old
  one; another converter's is not read; a refresh converts again and keeps an unreachable file from the conversion), and
  `tools/verify/src/converted-source.test.ts` (the real corpus both ways, and the guard). The raw-cache tests of ADRs 0050
  and 0055 now say `keep: 'files'`, which is what they are about.

## Consequences

- A converted AuroraLegacy takes about 20 MB where its files took 15, in the same number of values. A user who would rather spare the space keeps the
  files and pays a parse per load.
- Every existing desktop profile becomes converted on its next load, and its raw files are removed then.
- Converting a load costs one serialisation and one large write, once per change; a load answered wholly from the
  conversion writes nothing.
- The element's `origin` is stored for each of the 14,545 elements; it is the same within a file and could be left out
  and restored on read, if space is measured to matter.

## Driven

In the browser build on Windows (the dev server, IndexedDB as `Storage`): AuroraLegacy added from the suggestion with
"Converted", 28.8 s cold, 14,545 elements from 740 files; a page reload ready in **2.0 s**. Switched to "Files" on its
line (fetched again, since its files had gone with the conversion): a reload **5.0 s**. Back to "Converted": converted
on that load from the files, a reload **1.7 s**. No console errors. The desktop's add row and each source's line carry
the choice ("Converted" / "Files") with one sentence saying what each costs.

On the Pixel 9 Pro emulator in Expo Go (Android 16, 3 GB, another app's memory swapped beside it), AuroraLegacy through
the phone's Content screen and Build screen (ADR 0086), times from the app's own development log:

| | kept as files | converted |
|---|---|---|
| downloaded in full from the network | 82–83 s | 40 s (a refresh: the download, then one batched conversion) |
| made from the other form on the device | — | 15.5 s from the files kept |
| a later load, the Build screen open, after a restart | 6.6 s, 6.8 s | **2.3 s, 2.4 s** |

The process took about 330–350 MB (PSS) with the content loaded. Two things the phone found that Node did not: the
single-value conversion's 20 s read, and the Build screen drawing itself again for each progress report of a load (20 s
for the same converted load before the build view was memoized).

> **Note, 2026-10-28 ([ADR 0119](./0119-aurora-content-is-converted-into-incudo-content-and-nothing-past-the-conversion-knows-aurora.md), built):** superseded in what conversion means. A source is converted once into one file in Incudo's content format, kept where the user can open it (Show file); `keep: files`, the raw cache and the per-file converted values are gone, and a refresh converts again from the network. `CONVERTER_VERSION` is 9.
