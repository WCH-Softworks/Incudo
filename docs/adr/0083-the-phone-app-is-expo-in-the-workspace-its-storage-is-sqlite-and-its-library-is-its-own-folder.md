# 0083 — The phone app is Expo in the workspace, its storage is SQLite, and its library is its own folder

**Status:** Accepted · 2026-10-02 · built the same day · answers ROADMAP Phase 6's "Expo shell, navigation, storage" and
the read half of "Character sheet" · builds on [0004](./0004-live-vs-downloaded-content.md),
[0011](./0011-user-systems.md), [0012](./0012-self-contained-saves.md), [0027](./0027-a-library-is-a-folder.md),
[0029](./0029-a-cache-is-keyed-by-source-and-evicted-by-version.md),
[0050](./0050-an-update-check-asks-every-cached-file-and-a-refresh-keeps-what-it-cannot-reach.md),
[0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md) · **format:** none

## Context

Phase 6's exit criterion is that the same `.incu` opens identically on desktop and mobile, with `@incudo/core` still free
of platform code. `apps/mobile` held a `package.json` that had never been installed (Expo 51, React 18), a `platform.ts`
whose `MobileStorage` threw on purpose, and a guard (`workspace.test.ts`) keeping it out of the npm workspaces.

### What was measured, before anything was chosen

`tools/verify/src/mobile-runtime.test.ts` (report-only) and the install itself:

| question | answer |
|---|---|
| runtime features the shared packages use (comments left out) | `TextDecoder` 8 (one is UTF-16, adding a dropped Aurora file), `TextEncoder` 3, `localeCompare` 29 (11 files, three on the sheet's path: spell order, kept references, groups), one `\p{L}\p{N}` regex, one `new URL`, `Array.at`, `Object.hasOwn`, `replaceAll`, `matchAll`, `flat`/`flatMap`; `Math.random` once (a new character's id). **No** `crypto`, `structuredClone`, `Intl`, `CompressionStream`, `Blob`/`Response`, Node or DOM global. DEFLATE is a port (`ZipCompressor`) and SHA-256 is already sixty lines of arithmetic in `core`. |
| a packed `.incu`, the thirty samples | 29–92 KB (median 39 KB); `content.json` 285–765 KB before deflate; 124–381 embedded elements; unzip, read, derive and build the sheet document 10–48 ms in Node on this machine |
| a full AuroraLegacy download in `Storage` | 800 values, 14.75 MB of text, the largest 585 KB (a spell list), 20 over 100 KB; keys as the app writes them 185–272 bytes, **20 over 255** |
| `npm install` from clean, before and after mobile joined the workspaces (one Windows machine) | 45 packages, 6 s, 99 MB of `node_modules` → **519 packages, 69 s, 467 MB**. The "~700 MB" the guard quoted was a guess made before anything was installed. |
| current Expo | SDK 57 (latest): React Native 0.86.3, React 19.2.3. The desktop is on React 19.3.0. |
| this machine | Android Studio, SDK platforms 35 and 36, build tools 34–36, NDK 27, a Pixel 9 Pro emulator image (API 36, x86_64), JDK 21; nothing on PATH and no `ANDROID_HOME`. iOS cannot be built here. |

Measured on the emulator afterwards (Expo Go, Hermes), with a probe that was run once and not committed:
`TextDecoder` (UTF-8), `TextEncoder`, the `\p{…}` regex, `URL`, `Array.at`, `Object.hasOwn` and `structuredClone` are
there; `localeCompare` sorts `b, A, a, Tasha's, Tasha` exactly as Node does; `CompressionStream` is absent;
**`new TextDecoder('utf-16le')` throws** ("Unknown encoding").

## Decisions

1. **Expo, SDK 57, managed, run in Expo Go for now** (the maintainer's choice). Every module this phase needs
   (`expo-file-system`, `expo-sqlite`, the navigation libraries) is in Expo Go, so nothing native is built and nothing
   is downloaded beyond the Expo Go app. A development build (`expo run:android`, Gradle) comes when a native module or
   a release needs one; `apps/mobile/android` and `ios` stay ignored. Versions are the ones SDK 57 bundles, pinned as it
   pins them; the desktop keeps its newer React, and Metro is told to resolve `react` to the app's own copy
   (`metro.config.cjs`), so which copy npm hoists cannot put two Reacts in the bundle.

2. **`apps/mobile` is a workspace**, so its imports of `@incudo/*` are the same symlinked TypeScript sources the desktop
   uses, typechecked by `npm run typecheck` (it is in the root `tsconfig.json`'s references). Every contributor pays the
   install above, whether or not they open the phone app; that is the trade. `workspace.test.ts` now asserts it is in,
   with the numbers.

3. **Navigation is React Navigation's native stack**: two screens (Characters, then a character's sheet), with Android's
   back gesture and button doing what a phone user expects. Not `expo-router`, whose file-based routes are more
   convention than two screens need; it is built on the same stack and can replace it later without a format change.

4. **`Storage` is one SQLite table** (`expo-sqlite`, `kv(key PRIMARY KEY, value)`), and `list(prefix)` is a range scan as
   the desktop's IndexedDB does it. A file per key would need a hashed name (twenty keys are over 255 bytes) and a second
   lookup to list; AsyncStorage on Android is SQLite with a default cap of 6 MB, under half a download. Measured on the
   emulator at the download's scale (800 values, 16.9 MB, twenty of 300 KB): written in 14.5 s one statement at a time,
   listed in 32 ms, read back in 2.1 s and equal, removed in 9.2 s; a key with `%` and `_` lists exactly. Writing in
   batches is left until a download needs it.

5. **The library is the app's own folder** (`library/` in its documents; the maintainer's choice, for now). It is always
   there and needs no permission. A file comes in through the system's document picker and is copied in by a new
   `CharacterLibrary.add`, **unchanged, never repacked**, named after its file, refused with a sentence if it is not a
   character. A file goes out through an export that saves it where the user says or shares it, which is Phase 6's
   import/export item. A folder the user picks (Android's Storage Access Framework, which `expo-file-system` reaches) is
   ADR 0027's library more literally, and is left for later rather than ruled out.

6. **DEFLATE on the phone is fflate**, a dependency-free JavaScript implementation, in the shell
   (`apps/mobile/src/zip.ts`), never in `core`. The size a zip claims is not used to allocate (a file someone sent could
   claim four gigabytes); `core` checks the result against it and the CRC as it always did.
   `tools/verify/src/mobile-zip.test.ts` holds it to the desktop's zip in both directions.

7. **The sheet is the sheet document, drawn natively.** ADR 0075 made `sheetDocument` the one thing every renderer reads;
   the phone is another renderer, wording every row and listed element with the document's own helpers. Content's HTML
   cannot be shown as markup and has no DOM to be sanitized in, so **`htmlToBlocks`** (`packages/ui`) reads it into
   paragraphs, headings, lists, tables and rules of bold, italic and link runs, from the same tolerant reader the text
   export uses (moved to `html-tree.ts` so both share it). `tools/verify/src/html-blocks.test.ts` holds the two readers
   to the same words over every description and sheet line in the corpus: 15,671 texts, none differing.

8. **`core` gained nothing.** The only platform-shaped needs were already ports (`ZipCodec`, `Storage`,
   `CharacterStore`, `FilePicker`). `packages/ui` gained a renderer-agnostic reader and a library method; neither imports
   React or anything of a platform.

## What was built

- `apps/mobile`: `index.ts`, `app.json` (name, slug, light and dark), `metro.config.cjs`, `tsconfig.json`;
  `src/platform.ts` (`MobileFetcher`, now conditional as ADR 0050 allows a fetcher with no CORS; `MobileStorage`;
  `MobileCharacterStore`; `MobileFilePicker` through `File.pickFileAsync`), `src/zip.ts`, `src/boot.ts` (the shipped
  systems through `validateGameSystem`), `src/App.tsx` (the two screens), `src/SheetView.tsx`, `src/RichText.tsx`,
  `src/theme.ts`. The package is an ES module, so Node and `tsc` read `zip.ts` as one; Metro's config is `.cjs`.
- `packages/ui`: `html-tree.ts`, `html-blocks.ts`, `CharacterLibrary.add`.
- `npm run mobile` starts the dev server; `npm run mobile:android` opens it on a running emulator or a connected phone.
- **No icon and no splash image**: Expo's own stand in. The logo's tile is an open design decision (`brand/`), and a
  phone icon is a composition of it, so it is left as a marked gap.

## Driven

On the Pixel 9 Pro emulator (Android 16) in Expo Go, by `adb` taps, not a person's hands: five sample characters packed
by the desktop's code in Node were put in the emulator's Downloads, added one at a time through Android's own document
picker, listed with the desktop's card wording ("Player Character · Level 10"), and opened with **no content source of
any kind**. For each, the app logged the SHA-256 of `sheetMarkdown(sheetDocument(…))` and Node computed the same for the
same file: **all five identical**, byte for byte (6,245 to 10,864 characters; a three-class caster holding a creature, a
Wizard 4 / Rogue 4, a 2024 Paladin / Sorcerer). That is the exit criterion measured, for these five, with the spells'
`localeCompare` order included. The library survived the app being force-stopped and reopened; dark mode follows the
system.

**Not run:** the maintainer's own phone (asked for, not yet done); iOS at all; a development or release build; adding a
folder-form container (a phone writes and adds only `.incu` files); a file whose name Android's picker reports
differently from its display name (the emulator's Downloads gave the real name).

## Consequences

- A contributor's `npm install` is about ten times what it was. Nothing under `node --test` needs Expo.
- `TextDecoder('utf-16le')` is absent on the phone, so adding a UTF-16 Aurora file as a source (ADR 0056) will fail
  there until `content-files.ts`'s decoding goes through a port or a small decoder; it is not reachable yet.
- Building on a phone, downloading content, sharing a file out and download mode as the default are Phase 6's later
  items, and each starts from these ports.
