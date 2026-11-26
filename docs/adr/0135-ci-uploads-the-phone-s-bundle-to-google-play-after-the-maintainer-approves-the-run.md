# 0135 — CI uploads the phone's bundle to Google Play after the maintainer approves the run

**Status:** Accepted · 2026-11-26 · the maintainer merged it as proposed; their answers to the plan's questions are recorded below · amends
[0132](./0132-the-phone-app-is-released-on-google-play-built-and-signed-by-ci-with-an-upload-key-the-maintainer-keeps.md)
decision 2 ("CI holds no Play credentials and publishes nothing") · **format:** none

## Context

ADR 0132 builds and signs the phone's Android App Bundle on a `mobile-vX.Y.Z[-rc.N]` tag and leaves it as the run's
artifact. The maintainer downloads it and uploads it in the Play Console. That was right for the first listing: the Play
API cannot create an app's first release, and nobody had set up a Play service account. The first bundle is now on
internal testing, uploaded by hand, so the API can take every later one.

### Read: how DaltonPick does it

DaltonPick is a native Gradle app in the same organisation, released on the same Play developer account. Its
`.github/workflows/release.yml` is started by hand (workflow_dispatch). It takes four inputs: upload or not, the track
(internal or alpha), the status (draft or completed) and whether to upload the store text. It builds and signs the AAB
with an upload key from secrets, keeps the AAB and its R8 mapping for 90 days, and uploads with the
[Gradle Play Publisher](https://github.com/Triple-T/gradle-play-publisher) plugin, authenticated by a service-account
JSON. The job runs in a GitHub environment, `play`, which holds every secret and can require a reviewer. The store
listing text and per-track release notes are in the repository and checked in CI. Its version code is 100 plus the run
number. Every push also builds an unsigned release and checks the merged manifest's permissions.

### Measured: what differs here

- **Incudo's `android/` folder is generated.** `expo prebuild` writes it on every build, and it is gitignored (ADR 0099).
  Gradle Play Publisher is applied in a committed `build.gradle`. Here it would need a config plugin that writes it into
  the generated file, and that plugin would have to be checked again on every Expo or Android Gradle Plugin upgrade.
- **The version code is the tag's** (ADR 0132 decision 3), held by `mobile-release.test.ts`. DaltonPick's run-number
  code fits a workflow started by hand. Incudo's fits a tag that is never reused.
- **The four upload-key secrets are repository secrets**, so any workflow on any branch could read them.
- **Nothing builds Android on a pull request.** Gradle runs only on a release tag; a local release build took 8 min 33 s
  (`docs/release-checks/mobile-v1.0.0-rc.2.md`).
- **The workflow keeps the AAB for 30 days and no debug symbols**, though ADR 0132 decision 2 says it keeps them.
- **The Play developer account is personal** while its D-U-N-S number is pending. Google requires a personal account
  created after November 2023 to run a closed test with at least 12 testers for 14 days before it can apply for
  production access. An organisation account does not have that requirement.

## Decision

1. **The tag still starts a release, and CI now uploads what it builds.** A `-rc.N` tag goes to **internal testing**.
   A release tag goes to **closed testing** until the app has production access. After that it goes to **production as
   a staged rollout**, and that is one change to the workflow. The version code stays ADR 0132's.
2. **fastlane's `supply` uploads** (`upload_to_play_store`), run on the Linux runner against the signed AAB (the
   maintainer's choice, 2026-11-26). It needs no Gradle plugin, so it does not care that `prebuild` writes `android/`
   again. It uploads to a track as a draft or completed, adds release notes per version, uploads the listing text and
   images, and promotes a build already on Play from one track to another. fastlane is MIT-licensed and needs no
   account. Its version is pinned in the repository.
3. **A `play` environment, with the maintainer as its only required reviewer** (the maintainer's choice). The four
   upload-key secrets move into it as environment secrets, under the same names, with `PLAY_SERVICE_ACCOUNT_JSON`
   beside them. The build runs on the tag. The upload job uses the environment and waits for the maintainer's approval
   in the Actions tab, so a pushed tag alone never reaches a tester.
4. **A service account of Incudo's own**, `incudo-play-publisher`, invited in the Play Console with permission to
   release to testing tracks (and later production) on Incudo only. DaltonPick's account is not reused: a service
   account's email address cannot be renamed, and a leaked key would then reach one app, not two.
5. **Drafts first.** An upload is a draft until Play has reviewed the app once, then `completed` on internal and closed
   testing. A production release is staged, and the maintainer moves it to 100%.
6. **Promotion is a workflow of its own**, started by hand with a version code and the track to move it to. It never
   rebuilds and runs in the `play` environment.
7. **As much as fastlane can upload lives in the repository** (the maintainer's choice: as few visits to the Console as
   possible). That is the store listing text, release notes per version, and the store images once a person has made
   them. A CI check holds the text to Play's length limits. The data safety form, the content rating and the other App
   content declarations can only be filled in the Console, and are filled there once.
8. **The release build is hardened before any credential is added:** concurrency of one release at a time; native debug
   symbols in the AAB; the artifact kept 90 days; the built bundle's permissions checked against ADR 0132 decision 4's
   list.
9. **Android is checked on pull requests.** A Metro bundle (`expo export --platform android`) runs on every pull
   request. The unsigned Gradle build runs only on one that touches `apps/mobile`, a native dependency or the lockfile.
10. **The first CI upload's version code must be higher than the hand-uploaded bundle's.** The committed `app.json`
    says 1 000 099 (1.0.0). If Play shows that code, the first tag is `mobile-v1.0.1-rc.1`.
11. **A setup guide for the maintainer**, `docs/PLAY-RELEASE.md`, modelled on DaltonPick's `docs/RELEASE.md`. It covers
    the environment, the service account, the secrets, making a release and promoting one.

## Consequences

- CI now holds Play credentials, but only an approved run can use them. A leaked service-account key can release
  to Incudo's testing tracks, not to DaltonPick and not to production until that permission is granted.
- The maintainer's steps, each asked for when it comes: create the `play` environment and its reviewer, move the four
  secrets into it, create the service account and invite it, read the version code Play holds, and approve each run.
- The phone's release no longer needs the browser for an upload. It still needs it for review answers, the App content
  forms and, while the account is personal, the closed test's testers.
- Ruby is installed on the upload job's runner. Nothing ships it.

## Built

- **Decisions 8 and 9, 2026-11-26.** `mobile-release.yml` runs one release at a time and is never cancelled halfway,
  reads the built release manifests with `apps/mobile/scripts/check-permissions.cjs` (exactly ADR 0132's three, plus
  AndroidX's own receiver permission), checks that the bundle carries `BUNDLE-METADATA/com.android.tools.build.debugsymbols/`,
  and keeps the bundle 90 days. The symbols are written by `apps/mobile/plugins/debug-symbols.cjs`
  (`ndk.debugSymbolLevel 'SYMBOL_TABLE'` in the generated `app/build.gradle`). `.github/workflows/mobile-check.yml` runs
  Metro (`expo export --platform android`, about 20 s locally) on every pull request, and the release build without
  the upload key on one touching `apps/mobile`, the root `package.json`, the lockfile or a phone workflow.
  `mobile-release.test.ts` holds all of it. Not a required check. Decisions 1 to 7, 10 and 11 are not built yet.

## Evidence

DaltonPick's `.github/workflows/release.yml`, `ci.yml`, `docs/RELEASE.md` and `app/build.gradle.kts`, read on
2026-11-25. Incudo's `.github/workflows/mobile-release.yml` and `apps/mobile/app.json` at the commit this ADR lands on.
Nothing is built yet: the steps are planned as separate pull requests (hardening, upload, promotion and listing).
