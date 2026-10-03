# Incudo mobile

Expo (React Native), SDK 57, run in Expo Go. ROADMAP Phase 6; the choices and the numbers behind them are
[ADR 0083](../../docs/adr/0083-the-phone-app-is-expo-in-the-workspace-its-storage-is-sqlite-and-its-library-is-its-own-folder.md).

What it does today: a library of characters kept in the app's own folder, a file added to it through the system's
document picker, a character's sheet opened from the file alone with no content source (ADR 0012), playing it (ADR
0084), **Export** on the sheet, which saves the character's file to a folder the user picks or hands it to the share
sheet, and **building**: New character and Edit open the build (ADR 0086), which loads the content added under
**Content** (the game's suggested source, downloaded in full and kept converted or as files, ADR 0085) and saves with
Save.

## Running it

```bash
npm run mobile
```

starts the dev server; scan its QR code with Expo Go on a phone on the same network. With an Android emulator running
(or a phone connected by USB with debugging on), and `ANDROID_HOME` pointing at the Android SDK:

```bash
npm run mobile:android
```

opens it there, installing Expo Go the first time. To try a character, save it as a `.incu` on the desktop, put the file
somewhere the phone's file picker reaches (its Downloads, a cloud drive), and tap "Add a character file…".

## What lives where

- `src/platform.ts` is the only file that knows it runs in Expo: storage (one SQLite table, with a batched `apply`), the
  library folder, the file picker and the fetcher.
- `src/BuildScreen.tsx`, `BuildView.tsx`, `BuildParts.tsx` and `Picker.tsx` draw the build; `ContentScreen.tsx` the
  sources. They render `CharacterBuilder`, `ContentSources` and `build-view.ts` from `packages/ui` and compute nothing.
- `src/zip.ts` is DEFLATE for the `.incu` container (fflate); `tools/verify`'s `mobile-zip.test.ts` holds it to the
  desktop's zip under Node.
- Everything a screen shows comes from `packages/ui`: `CharacterLibrary`, `CharacterBuilder`, `sheetDocument`, and
  `htmlToBlocks` for content's text. The screens compute nothing.

## Not yet

- **No icon or splash image.** Expo's own stand in. The logo's tile is an open design decision (`brand/`); this is a
  marked gap, not an oversight, and no artwork is to be generated for it.
- Receiving a file shared to the app, download mode as the default on metered connections (ADR 0004): Phase 6's later
  items. On the build: an index URL of the user's own as a source, the class split editor, features of the user's own,
  additions and references (the desktop has them all).
- iOS has never been built or run; nothing here is Android-only by design, but nothing has been seen there.

## Exit criteria

The same `.incu` file opens identically on desktop and mobile, and `@incudo/core` still has zero platform-specific code.
