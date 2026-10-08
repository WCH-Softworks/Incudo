# 0099 — A file shared to the phone is added as a picked one is, and receiving it needs the app's own build

**Status:** Accepted · 2026-10-08 · answers the rest of ROADMAP Phase 6's "Import/export via share sheet and file picker" ·
amends [0083](./0083-the-phone-app-is-expo-in-the-workspace-its-storage-is-sqlite-and-its-library-is-its-own-folder.md)
(decision 1: Expo Go only) · builds on [0012](./0012-self-contained-saves.md), [0027](./0027-a-library-is-a-folder.md),
[0008](./0008-aurora-compatibility-frozen.md) · **format:** none (no system or character format change)

## Context

ADR 0083 built the half of this item a phone can do on its own: a `.incu` comes in through the system's document picker
and is copied into the library unchanged (`CharacterLibrary.add`), and one goes out from the sheet's header, to a folder or
through the share sheet (`exportEntry`). What a phone user does more often than open a picker is the other way round: tap
an attachment in a mail, "Share" a file from a chat or a cloud drive, or "Open with" one in a file manager. None of those
reached Incudo.

### Measured first

On the Pixel 9 Pro emulator (Android 16), with Expo Go installed, by `adb`:

| question | answer |
|---|---|
| What type does Android give a `.incu` and a `.dnd5e`? | `application/octet-stream`, both (MediaStore, a file pushed to Downloads and scanned). Our own export sends that type on purpose (ADR 0083). Nothing on a phone knows either extension. |
| Is Expo Go offered for `ACTION_SEND` of `application/octet-stream`? | **No.** `cmd package query-activities` lists Gmail, Drive and Play services; Expo Go's manifest declares no `SEND` filter at all and `VIEW` filters only for URL schemes (`exp`, `http(s)`, a few payment ones). |
| For `ACTION_VIEW` of a `content://…/x.incu`? | No: Play services and the Google app. |
| What can receive one? | `expo-sharing` 57, already a dependency, gained "share into" (`getSharedPayloads`, `getResolvedSharedPayloadsAsync`, `clearSharedPayloads`, marked experimental). Its config plugin writes `SEND` / `SEND_MULTIPLE` intent filters by MIME type into the main activity and a scheme string it reopens the app with; it handles `SEND` only. An "Open with" is `ACTION_VIEW`, which React Native's own `Linking` hands to the app as the file's URI. Both are entries in the app's native manifest, which only a build of the app itself carries. |
| What does a build cost here? | JDK 21, the Android SDK (build tools 36, NDK 27.1) and Gradle are already on the machine (the desktop's Tauri work). `expo-dev-client` is 7 packages (the install went from 528 to 535). |
| How does a sample save begin? | All thirty `.dnd5e` samples: a UTF-8 byte order mark, `<?xml version="1.0" encoding="utf-8"?>`, then `<character version=…>`. |

So Expo Go cannot be offered a file by another app, by any route, and nothing in JavaScript can change that.

## Decisions

1. **The phone app gets a development build of its own, and Expo Go stays** (the maintainer's choice, asked before the
   run model changed). `expo-dev-client` is a dependency; `app.json` names the Android package `dev.incudo.mobile` (the
   desktop is `dev.incudo.desktop`), the scheme `incudo`, and `expo-sharing`'s plugin with Android enabled.
   `npm run mobile:build:android` (`expo run:android`) generates `apps/mobile/android`, which stays ignored (Continuous
   Native Generation: the config is the source, the folder is output), builds it and installs it, and `npm run
   mobile:build` serves it. Everything else still runs in Expo Go (`npm run mobile`), where receiving is simply absent:
   nothing is shown about it and nothing fails.
2. **What is received is filtered by type, and the type is `application/octet-stream` and `application/zip`.** That is
   what a `.incu` and a `.dnd5e` arrive as (the table above) and what a sender that knows a `.incu` is a zip would use.
   `*/*` was the other choice and would put Incudo in the share sheet of every photo and every link. The cost is that
   Incudo is offered for any unknown file; whatever is not a character is refused with a sentence and nothing is written.
   `SEND` and `SEND_MULTIPLE` (expo-sharing's plugin) and `VIEW` with the scheme `content` (an intent filter in
   `app.json`'s `android.intentFilters`) all carry the two types.
3. **A received file is added exactly as a picked one is, through one function.** `receiveFiles` (`packages/ui/src/
   received-files.ts`) takes files (a name, perhaps absent, and the bytes), and both the picker's "Add a character
   file…" and a share call it. It decides by **contents, not name**: a sender may give no name, or a name without the
   extension (a mail provider's attachment id, `msf:44` from Android's Recent files). Such a name is not quoted in a
   sentence ("The file is…"). Bytes that open as a zip holding a container that reads as a character
   go to `CharacterLibrary.add`, unchanged, as ADR 0083 wrote them; a name not ending in `.incu` is replaced by the
   character's own (`suggestedFileName`). The picker checked the extension before; it now gets the same answer for a
   `.incu` and a sentence for an Aurora save instead of "not an Incudo character file".
4. **Nothing is overwritten, and a name that was taken is said.** `add`'s free name (`aelin-2.incu`) is what decides; a
   received file is never written over a library one, case ignored. When the name written is not the one the file came
   with, the sentence says so: "Added Aelin as aelin-2.incu; the library already had a file called aelin.incu." The same
   file shared twice is two files: telling a copy from a different character with the same name is reading the manifest,
   which the user can do on the card. **The library is read in full before a received file is named**: a share can
   start the app, and before the first scan finishes the free name would be chosen against an empty list.
5. **An Aurora save shared to the phone is recognised and not imported, and says where to import it.** Recognised by its
   contents (an XML document whose root is `character`, a byte order mark and declaration allowed), the sentence is
   "… is an Aurora save. Import it in Incudo on a computer, then share the .incu it makes to this phone." Not imported
   because importing needs content loaded and the phone loads none until a Build screen asks (ADR 0086): a first load
   is 82 s from the network, and an import of a save that names content the phone does not have would write a character
   holding ids nothing resolves, which the desktop refuses for the same reason. The picker answers the same, so the two
   ways in stay one. Importing Aurora saves on the phone is its own roadmap line.
6. **The outcome is one view and the shell draws it.** `receivedView(outcomes)` gives a title, one line per file and,
   when exactly one character was added, that entry to open. The phone shows it as an alert from wherever the user is,
   with **Open** going to the sheet; nothing on screen is replaced under the user, so an unsaved build is never left by a
   share. `platform.ts` stays the only Expo-aware file: `MobileShareInbox` reads `expo-sharing`'s payloads and
   `Linking`'s URL, reads each file's bytes through `expo-file-system`, clears what it read, and hands `ReceivedFile[]`
   on. A share that arrives while the app is open comes through the same listener.

## Consequences

- `npm run mobile` is Expo Go as before, now said explicitly (`expo start --go`): with `expo-dev-client` installed, a
  plain `expo start` serves the development build instead and Expo Go loads nothing, found by running it. To try
  receiving, `npm run mobile:build:android` once (Gradle; 6 m 42 s the first time here), then `npm run mobile:build` serves
  the app's own build. The two apps keep separate data on the device: Expo Go's library is not the build's.
- `workspace.test.ts`'s check that no file names a home path walks the working tree, and the generated
  `apps/mobile/android` holds Gradle and CMake caches full of them; it skips that folder and `apps/mobile/ios` by path.
- iOS is not configured: a share extension needs an app group registered with an Apple team, and "Open in" needs a
  document type and an exported type identifier, none of which can be built or run here. Recorded as not done.
- `expo-sharing`'s receiving functions are marked experimental by Expo; they are behind one class in `platform.ts`.

## Driven

On the Pixel 9 Pro emulator (Android 16), the development build installed by `expo run:android`, by `adb` taps and
intents, not a person's hands. Three samples packed in Node with the desktop's code, pushed to Downloads, sent from the
system's Files app:

- **Share, app open:** the Files app's share sheet lists Incudo beside Quick Share, Drive and Gmail (and `cmd package
  query-activities` lists it for `SEND` and `VIEW` of `application/octet-stream`, not for `image/png`). Sample 01 shared:
  "Added Sample 01." with Open; Open logged the sheet as 7029 characters, sha256 `ca47e7d7…`, Node's exactly.
- **Open with:** tapping sample 02 offers "Open with" Incudo, Google and Wallet; Just once added it, and its sheet was
  9709 characters, `3f1ef986…`, Node's.
- **Three at once** (`SEND_MULTIPLE`): sample 01 again, sample 03 and an Aurora save. "Some files were not added": sample
  01 as `sample-01-artificer-5-2.incu` with the sentence naming the file it did not replace, sample 03 added (9616
  characters, `842cc9db…`, Node's), the save named as an Aurora save. The second sample 01, pulled back with `run-as`,
  holds exactly the files that were shared.
- **The picker**, now through the same function: Android's Recent files hand the picker a provider id as the name
  (`msf:44`), the case ADR 0083 listed as never run. The old extension check would have refused a `.incu` picked there; it
  is added now, named after its character, and an id is not quoted in a sentence ("The file is an Aurora save…").
- **Expo Go** (`npm run mobile`) runs the same code with its own library and no error; receiving is absent.

**Found by driving it, and changed:** `expo-sharing` copies each shared file into the cache and swallows a failed copy,
and resolving rejects as a whole when one file cannot be opened; the inbox falls back to the sender's own URI and then to
reading each raw payload, so the failure is a sentence naming the file rather than an unhandled rejection. A share that
starts the app is read from the payloads `expo-sharing` holds, not from the first URL, which in a development build is the
dev launcher's. **Not working in a development build, and why:** a share that *starts* the app goes through the dev
launcher, whose new activity does not hold the sender's read grant, so the files are named as unreadable. A build without
the launcher (a release build) receives the share in the activity it was granted to; that was not built or run.

## Not done

A real phone; iOS; a release build; importing an Aurora save on the phone; telling a re-shared copy of a character
already in the library from another character; the file's display name for a picked file (`expo-file-system` gives the
URI's last segment).
