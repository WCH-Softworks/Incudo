# 0132 — The phone app is released on Google Play, built and signed by CI with an upload key the maintainer keeps

**Status:** Accepted · 2026-11-19 · the maintainer accepted decisions 1 to 3 as proposed · ROADMAP Beyond 1.0, "1.0.x — The phone app on Google Play" · builds on
[0083](./0083-the-phone-app-is-expo-in-the-workspace-its-storage-is-sqlite-and-its-library-is-its-own-folder.md),
[0099](./0099-a-file-shared-to-the-phone-is-added-as-a-picked-one-is-and-receiving-needs-the-app-s-own-build.md) ·
**format:** none

## Context

The desktop 1.0 shipped on 2026-11-19. The phone app (`apps/mobile`, Expo SDK 57, React Native 0.86) had only ever run
as a development build and in Expo Go on the Pixel 9 Pro emulator. Nothing had been released, and it had never run on a
real phone. Before deciding anything, a release build was made and the code was read for what it sends and stores.

### Measured: a release build (2026-11-19, this machine, a throwaway key that was never committed)

`expo prebuild`, then `gradlew :app:assembleRelease :app:bundleRelease`, signed through
`-Pandroid.injected.signing.*` with a key made for the measurement and deleted after it.

| | |
|---|---|
| Build | 11 min 31 s cold, 649 tasks |
| AAB | 56.4 MB |
| Universal APK | 85.7 MB: native libraries 13.3 (armeabi-v7a) to 20.4 MB (x86) per ABI, dex 7.7 MB packed, the JS bundle 2.8 MB |
| One phone's install from the AAB | about 31 MB for arm64-v8a, *estimated* from the APK's arm64 parts (bundletool not run) |
| JS | Hermes bytecode (the bundle opens with `c6 1f bc 03`) |
| Starts | straight into the Characters screen, no launcher and no dev menu; 1.57 s cold on the emulator (`am start -W`) |
| `expo-dev-client` | its classes are in the release dex and are inert there |
| SDK | min 24, target 36, compile 36 |
| versionName / versionCode | 0.0.1 / 1 |

- **A file shared while the app is closed arrives readable.** A `.incu` shared to Incudo from the Files app with the
  app force-stopped was added ("Added Sample 08") and opened to a sheet whose armour class, hit points and speed are
  Aurora's readout (13, 7, 30). ADR 0099's gap was the development build's launcher, as that ADR guessed. A release
  build has no launcher.
- **This checkout's path cannot build it on Windows.** Under `.claude/worktrees/<name>` the native build fails on a
  CMake object path over 260 characters (`react-native-safe-area-context`'s codegen). A `subst` drive gets the native part
  through, but Metro then cannot resolve modules across the mapped drive. A clone at a short path (`C:\ib`) builds. CI on
  Linux has no such limit.
- **The release manifest asks for what the app never uses**: `SYSTEM_ALERT_WINDOW` (the dev menu's) and
  `READ`/`WRITE_EXTERNAL_STORAGE` up to API 32 (files come and go through the system's picker and share sheet). It also
  asks for `INTERNET`, `ACCESS_NETWORK_STATE` and `ACCESS_WIFI_STATE` (NetInfo, ADR 0100), and `VIBRATE`.
- **`allowBackup="true"`** is Expo's default: Android's Auto Backup would take the whole app folder, the converted
  sources (about 20 MB for AuroraLegacy, ADR 0085) included, against a 25 MB quota, past which nothing is backed up.
- `userInterfaceStyle: "automatic"` does nothing natively without `expo-system-ui` (prebuild says so).

### Read: what the app sends and stores

- **One kind of request**: `MobileFetcher.fetchText` (`apps/mobile/src/platform.ts`), a GET of a content source's index
  and files, at the URLs of the sources the user adds. The one source the app suggests is AuroraLegacy on
  raw.githubusercontent.com. Nothing else in `apps/mobile/src`, `packages/ui`, `packages/content` or `packages/core`
  calls `fetch`. No analytics, crash reporting, accounts or ads.
- **NetInfo** (12.0.1) can ping `clients3.google.com` to judge reachability. On Android it takes the answer from the
  operating system (`useNativeReachability`, the native module reports a boolean) and makes no request. That is the
  library's default, not something Incudo says.
- **Every `[incudo]` log is behind `__DEV__`**; a release build prints none, sheet checksums included.
- **Stored on the phone only**: `incudo.db` (one SQLite table: the source profile, preferences, content metadata),
  `library/` (the characters and `incudo-features.json`), `sources/` (converted content), and `cache/share/` (the last
  file handed to the share sheet). What leaves the phone is only what the user shares or saves through the system.
- **The phone has no About screen**, so the 5e licence attribution that `docs/LICENSING.md` says is shown never is on
  the phone.

### What the phone lacks, and the maintainer's choice of what the first listing needs

From every "not on the phone" and "typechecked, not driven" note. The maintainer chose (2026-11-19) the three marked ✔.
The rest are 1.x.

| | Missing on the phone | First listing |
|---|---|---|
| About | The shipped systems' licence notices, the version, the source link | ✔ with Ko-fi only (decision 8) |
| Sources screen notes | What a source refers to that no enabled source has, which switched-off source had it, what two sources share (ADRs 0052, 0054, 0090) | ✔ |
| Source parts and files | Switching a source's parts off (0055), checking for updates (0050), an Aurora `.xml` as a source of its own (0056) | ✔ |
| Pending items card | Resolving a starting-equipment line no item matched (0119) | 1.x |
| Refresh a character | Its embedded copies against what its sources load now (0082) | 1.x |
| Sheet as text | The Markdown export (0075) | 1.x |
| Homebrew editor | Writing elements into a homebrew source (0108) | 1.x |
| Also not on the phone | What a choice asks for, under a description (Browse's `elementChoices`); the grouped add-item list (0117); reference suggestions (0070); the stat block laid out (0126); a written text's chosen stand-ins (0116) | 1.x |

Cairn is not on the list: it has not shipped since 2026-10-27, so no phone can have a Cairn character. User systems on
the phone were put aside earlier (ADR 0107).

Not missing, but never driven on the phone: ADRs 0123 (required first, the start options, the arrival mark), 0124 (spell
choices on their own heading, the soft-requirement warning), 0125 (other printings), 0126 (the sheet's order, folds and
answers), 0127 and 0131 (optional choices listed with the required), 0128 (spell levels as groups), 0129 (optional class
features as a set), 0093/0110/0111 (attack rows, the spell attack editor), 0098 (the bag and the purse), 0116 (alignment
and deity), 0088 (multiclassing off). They are the drive's (decision 9).

## Decision

1. **Play App Signing, with an upload key the maintainer makes and keeps.** Google holds the key that signs what
   phones install; the maintainer holds only the upload key, so a lost upload key is replaced through the Play Console's
   upload key reset and does not lose the app. The maintainer makes it with `keytool` (RSA 4096, 25 years) on their own
   machine. It is never in the repository. It lives in three places: the maintainer's password manager (the keystore
   file as an attachment, and both passwords), one offline copy, and the repository's Actions secrets
   (`ANDROID_UPLOAD_KEYSTORE` base64, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`, `ANDROID_UPLOAD_KEY_ALIAS`,
   `ANDROID_UPLOAD_KEY_PASSWORD`). A machine lost loses none of them.
2. **Built by CI, uploaded by hand.** `.github/workflows/mobile-release.yml` starts on a tag `mobile-vX.Y.Z-rc.N` or
   `mobile-vX.Y.Z` on a commit main has (the desktop's `v*` never matches it). It checks the tag against the phone's
   version (decision 3), runs `ci.yml` on the commit, prebuilds and builds the AAB on Linux, signs it with the upload key
   from the secrets, and keeps the AAB and its native debug symbols as the run's artifact. The maintainer
   downloads it and uploads it in the Play Console, to internal testing first. CI holds no Play credentials and publishes
   nothing. A local build is for drives: a throwaway key, never committed, built from a short path on Windows.
3. **The phone has a version of its own, and its version code only rises.** `app.json`'s `version` and
   `apps/mobile/package.json`'s are the phone's, and start at **1.0.0** for the first listing: the desktop's number says
   what the desktop shipped, and the two release on their own. `android.versionCode` is
   `MAJOR·1 000 000 + MINOR·10 000 + PATCH·100 + N`, where N is a candidate's number (1 to 98) and 99 the release itself,
   so 1.0.0-rc.1 is 1 000 001, 1.0.0 is 1 000 099 and 1.0.1-rc.1 is 1 000 101. As with the desktop, the app's version
   carries no `-rc`; the tag says what is a candidate, and the workflow writes N into `versionCode` from it. A test holds
   the two version fields equal and refuses a committed `versionCode` that is not this formula with N = 99.
4. **The release manifest asks only for what the app uses.** `android.blockedPermissions` removes `SYSTEM_ALERT_WINDOW`
   and both external storage permissions. A test reads `app.json`. A release build's permissions are listed in the
   release check, read with `aapt dump permissions`.
5. **Backup: the library and the settings, never the sources.** A config plugin in `apps/mobile` writes Android's backup
   rules (`dataExtractionRules` for API 31 and up, `fullBackupContent` below): `library/` and `incudo.db` are included;
   `sources/` and the cache are not (a source is fetched again). The user's own Google backup holds them; Incudo never
   sees it.
6. **NetInfo is told never to ping**: `reachabilityShouldRun: () => false` in `platform.ts`, so "the app requests only
   the sources you add" holds on every platform by construction, not by a library default. ADR 0100 reads only
   `isConnectionExpensive`, which this does not touch.
7. **What the listing says.**
   - **Privacy policy**: `docs/PRIVACY.md`, linked by its GitHub address. It says what this ADR's Context reads: no
     account, no analytics, no ads; the app requests only the content sources the user adds (and the suggested one only
     when the user adds it); characters, settings and content stay on the device and in the user's own Android backup;
     files leave the phone only when the user shares or saves them. A test holds the policy's list of permissions to
     `app.json`'s.
   - **Data safety**: no data collected, no data shared. Requests to a content source carry no user data (a GET of a
     URL the user chose). Data is encrypted in transit: Android refuses cleartext at this target SDK, so a source must be
     https. The user cannot ask Incudo to delete data, because Incudo holds none; uninstalling deletes it.
   - **Content rating**: the IARC questionnaire answered as a reference tool that ships no game content. The app shows
     whatever content the user adds, which the questionnaire's "user-generated or user-supplied content" questions cover.
   - **Category** Books & Reference. The description says that no rulebook content is included and that the user adds
     sources, as the desktop's release notes do, and names AuroraLegacy as a community project Incudo does not maintain.
   - **Store graphics, the icon and the splash are a person's work** and are left as marked gaps (CLAUDE.md, "Never
     generate artwork"). Screenshots of the app may be taken from the emulator.
8. **About on the phone** shows the version, the source link, every shipped system's notice word for word
   (`systemAttributions`, as the desktop's) and **Ko-fi only, no Patreon**: the maintainer's call. Known risk, recorded so
   it is not rediscovered: Play's Payments policy allows donation links only for organisations it validates as
   tax-exempt, and reviewers have objected to an open-source app's donation link on that ground. The link opens in the
   browser, and if review objects it is removed: one entry in `packages/ui/src/about.ts`'s phone list.
9. **Driven on the emulator, then on the maintainer's phone.** Every user-visible feature, Phase 9's drive applied to
   the phone: first in the development build on the Pixel 9 Pro emulator, then in a release build on the same emulator,
   each bug fixed under a test that fails without the fix. Then the maintainer's own Android phone, with the CI-built AAB
   installed through Play's internal testing track, which also proves the signing chain. Recorded in
   `docs/release-checks/mobile-v1.0.0-rc.N.md`, modelled on `docs/RELEASE-CHECK.md`. The listing waits for the real
   phone.
10. **Not iOS** (ROADMAP "1.x — macOS, Linux and iOS"). Minifying and resource shrinking stay off for the first listing;
    a size pass comes after it, measured.

## Consequences

- Phone and desktop numbers diverge: a desktop 1.1 and a phone 1.0.3 can coexist. Each release's notes say which.
- Every phone upload needs a tag and a CI run (about the desktop's cost), and a commit that main has.
- The maintainer's outward steps, each asked for when it comes: the Play developer account, making the upload key and
  storing it, the four secrets, the app in the Play Console with Play App Signing, the listing's text and graphics, the
  data safety form, the content rating, the internal test track, and the upload.
- Development builds keep the dev launcher and its cold-share gap (ADR 0099). A release build is the one to drive for
  receiving.

## Evidence

The measurements above; `tools/verify/src/mobile-release.test.ts` (versions, permissions, backup rules, the privacy
policy's list). The drive's own record is the release check.
