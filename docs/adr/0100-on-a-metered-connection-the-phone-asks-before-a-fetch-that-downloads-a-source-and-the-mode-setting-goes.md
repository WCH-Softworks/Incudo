# 0100 — On a metered connection the phone asks before a fetch that downloads a source, and the mode setting goes

**Status:** Accepted · 2026-10-08 · answers ROADMAP Phase 6's "Download mode as the default on metered connections", by
replacing it with what the measurement found · amends [0004](./0004-live-vs-downloaded-content.md) (the per-source
*stream* or *download* setting and its defaults) · builds on [0029](./0029-a-cache-is-keyed-by-source-and-evicted-by-version.md),
[0050](./0050-an-update-check-asks-every-cached-file-and-a-refresh-keeps-what-it-cannot-reach.md),
[0051](./0051-lazy-loading-is-declined-and-the-index-walk-stops-waiting-on-itself.md),
[0085](./0085-a-source-is-kept-converted-into-incudo-s-own-form-and-loaded-from-that.md),
[0086](./0086-a-phone-builds-and-edits-with-the-desktop-s-builder-its-content-loaded-when-a-build-opens.md) ·
**format:** none (`ConfiguredSource.mode` and `SourceRef.mode` are still read and written)

## Context

ADR 0004 made a source's setting *stream* or *download*, desktop streaming and the phone downloading by default. Stream
then meant reading the repository on demand, file by file, so on a metered connection it would spend data every session;
the roadmap's "download mode as the default on metered connections" follows from that.

### Measured first

| question | answer |
|---|---|
| What does `mode` change? | **Nothing.** No load, refresh or check reads it (`grep` over `packages` and both apps: it is written by `SourceProfile.add` and copied into `SourceRef`s, and read nowhere else). ADR 0029 already said the two differ only in *when*, and ADR 0051 declined the lazy loading that would have made the difference. |
| When is a source fetched? | When it is added, in both shells and in either mode: the desktop's Add reloads every enabled source at once, the phone's adds in download mode and loads. After that every load reads the cache; nothing re-fetches on its own, and no update check runs unasked. |
| What does a phone fetch that costs data? | All of AuroraLegacy is about 15 MB in 800 requests (ADR 0083's measurement). It is fetched by **adding** a source (the phone asks first, saying it is downloaded in full, and says nothing of the network), by **Refresh** (no question asked; a source kept converted downloads every file again, since it keeps no raw copy to answer "not modified" with, and one kept as files asks each file conditionally and downloads what changed, ADR 0050), and by switching a source from **converted to files** (no question asked; the conversion removed the raw files, so they are all downloaded again, ADR 0085). Switching from files to converted reads the cache and fetches nothing. |
| Can the phone tell a metered connection? | `@react-native-community/netinfo` (12.0.1, the version SDK 57 pins, in Expo Go) reports `details.isConnectionExpensive`: Android's metered flag for the active network, iOS's expensive one. With no connection there are no details. |

So no default for the mode can save data: both modes fetch the same files once. What can is the user knowing, before a
fetch of a whole source starts on a metered connection, that it is about to happen.

## Decisions

1. **The mode setting goes from the desktop's Sources pane** (the maintainer's choice). The select beside each source and
   in the add form, and the paragraph explaining two settings that do the same thing, are removed; a new source is
   written as `download`. **The field stays** in `ConfiguredSource` and `SourceRef`, read and written as before: profiles and
   saves carry it, and a format change for a value nothing reads would cost every reader and buy nothing. ADR 0004's
   defaults (desktop streams, mobile downloads) are retired with it.
2. **What a source action will fetch is one function**, `fetchCost` (`packages/ui/src/fetch-prompt.ts`): adding
   downloads everything the source lists; a refresh downloads everything again when the source is kept converted and
   only what changed when it is kept as files; a switch from converted to files downloads everything again; a switch the
   other way fetches nothing. The file count is the source's own from its last load (`fileCount`), when it has one.
3. **On a metered connection the phone asks before any of them, and says what it will cost** (`fetchPrompt`). Not on an
   unmetered one, or one it cannot read (no connection, no details): the fetch then runs as it does today, and fails as
   it does today when there is no network. Adding a source already asks on every connection, so on a metered one its
   question gains the sentence (`addSourceNote`). The words are `packages/ui`'s; the phone's Content screen shows them and
   computes nothing, and `platform.ts` reads the connection (`MobileConnection`).
4. **The desktop does not ask.** Windows can say a connection is metered only through WinRT from the Tauri side, and a
   browser page not at all; a desktop on a metered connection is the rarer case. Left for when someone needs it.

## Consequences

- The phone's Content screen says, on a metered connection, what Add, Refresh and a switch of how a source is kept will
  download, before they do. Nothing changes on Wi-Fi.
- NetInfo is a native module: the development build (ADR 0099) is built again to carry it; Expo Go already has it.
- A Build screen's load reads the cache and fetches only a file the cache lacks (a download that failed half way): that
  is not asked about.

## Driven

On the Pixel 9 Pro emulator (Android 16), with Wi-Fi switched off and on by `adb shell svc wifi`: Android reports the
emulator's Wi-Fi `IS_UNMETERED` and its LTE connection metered, and NetInfo agreed. In Expo Go, with AuroraLegacy kept
converted: on LTE, Refresh asked "Refreshing downloads all 740 of its files again, because it is kept converted" and Keep as
files asked that it downloads all 740 again, each cancelled with nothing fetched; on Wi-Fi Refresh started at once and
finished (about a minute, then a 2.4 s load of 14,545 elements). In the development build, rebuilt for NetInfo, on a fresh
library: Add on LTE said the connection is metered, and on Wi-Fi it did not. On the desktop, in the browser build, the
Sources pane has no Stream or Download select and its source loads as before.

The count is the source's element files from its last load; a refresh also asks for its indexes (sixty more for
AuroraLegacy), which the sentence does not count.

## Not done

The desktop; a real phone; iOS; the size in megabytes before a source is first added (an index lists files, not sizes).
