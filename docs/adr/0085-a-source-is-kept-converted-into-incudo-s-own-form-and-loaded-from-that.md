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
| `tools/verify/src/converted-source.test.ts`, the corpus kept each way, in Node | kept as files 14.7 MB in 801 values; converted **19.9 MB in 2 values**; a later load 576 ms from the files, **291 ms** from the conversion; the converted load's elements, in order and in full, and its warnings and errors **identical** to the files' |

## Decisions

1. **A source is converted, by default.** After a load, what it read (every index and file, as `parseAuroraIndex` and
   `parseAuroraElements` returned them, each file with its `<append>`s and diagnostics) is written as one JSON value under
   the source's cache prefix (`content/<source>/.converted`), and the raw files it replaces are removed. The next load reads
   the conversion first; anything it does not hold (a part switched back on, a file a failed load missed) comes from the raw
   cache or the network, and the conversion is written again.

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
   version should move.

5. **A refresh converts again.** It falls back to the conversion, then the raw files, for what it cannot reach (ADR 0050),
   records everything it read and writes it as the new conversion, unless it reached nothing at all, in which case it
   changes nothing. ETags stay beside the conversion, so an update check still asks every file. A converted source has no
   raw copies to answer a "not modified" with, so **a refresh of a converted source downloads every file in full**; making
   it conditional against the conversion is left for when a refresh's time is measured to matter.

6. **Not `.incuset` yet.** ADR 0007 names a compiled content bundle; this is the app's own storage of one source as it was
   loaded, carrying Aurora's index structure, never a file a user picks or shares. Exporting a converted source as a file
   is Phase 7's (systems and content as a user surface), and will start from this shape.

## What was built

- `packages/content`: `load-sources.ts` (moved from `apps/desktop/src/content.ts`, `loadSources` now taking
  `ComposeOptions`), `converted-source.ts` (`ConvertedContentSource`, `RecordingContentSource`, `readConverted`,
  `writeConversion`, `convertedKey`, `CONVERTER_VERSION`), `composeForLoad` and the converted layers in `compose.ts`, the
  refresh's conversion, `keep` and `keepsConverted` in `profile.ts`.
- Tests: `packages/content/src/converted-source.test.ts` (each case naming the perturbation that fails it: the second load
  touches no network and loads the same; the raw copies go; an append is folded once; `files` writes none and removes an old
  one; another converter's is not read; a refresh converts again and keeps an unreachable file from the conversion), and
  `tools/verify/src/converted-source.test.ts` (the real corpus both ways, and the guard). The raw-cache tests of ADRs 0050
  and 0055 now say `keep: 'files'`, which is what they are about.

## Consequences

- A converted AuroraLegacy takes about 20 MB where its files took 15. A user who would rather spare the space keeps the
  files and pays a parse per load.
- Every existing desktop profile becomes converted on its next load, and its raw files are removed then.
- Converting a load costs one serialisation and one large write, once per change; a load answered wholly from the
  conversion writes nothing.
- The element's `origin` is stored for each of the 14,545 elements; it is the same within a file and could be left out
  and restored on read, if space is measured to matter.
