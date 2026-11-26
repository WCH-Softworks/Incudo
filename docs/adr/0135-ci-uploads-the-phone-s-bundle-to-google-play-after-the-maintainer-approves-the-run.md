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
  `mobile-release.test.ts` holds all of it. Not a required check.
- **Decisions 1 to 3, 5, 7 (release notes), 10 and 11, 2026-11-26.** The bundle job became `release`, in the `play`
  environment. **One change from decision 3:** the build waits for the approval as well as the upload. The upload key's
  secrets moved into the environment, and a job can read an environment's secrets only by running in it, so signing
  needs the approval. Splitting the signing and the upload into two jobs in the environment would ask for two approvals,
  twelve minutes apart. So the approval comes before the build, and what runs before it reads no secret: the tag, the
  release notes, the track and the status are checked, and ci.yml runs. fastlane 2.241.2 is pinned in
  `apps/mobile/play/Gemfile` and its lock. It runs `supply` with the bundle and the release notes only, and leaves the
  listing, images and screenshots alone until the listing is in the repository. A candidate goes to `internal`, a
  release to `alpha`, as a draft unless the repository variable `PLAY_RELEASE_STATUS` is `completed`. The release notes
  are `apps/mobile/play/metadata/en-US/changelogs/<code>.txt`, checked by `apps/mobile/scripts/release-notes.cjs`
  before the build, because fastlane uploads an empty text when the file is missing. The signing check also compares
  the bundle's signer with the upload key, since `jarsigner -verify` passes the template's debug key too. The phone
  moved to 1.0.1 (code 1 000 199): Play holds 1 000 099, so the first tag is `mobile-v1.0.1-rc.1`.
  `docs/PLAY-RELEASE.md` is the guide. Not run against Play yet: the first approved tag is the test. Decisions 4 (the
  service account) and 10 (reading Play's code) were the maintainer's and are done. Decision 6 (promotion) and the rest
  of 7 (the listing) are the next pull request.
- **Decision 6 and the rest of 7 (the listing text), and a tag made from the Actions tab, 2026-11-26.**
  `.github/workflows/mobile-promote.yml` is started by hand on main with a version code or the tag that built it, the
  track it is on (`internal` or `alpha`) and the track to move it to (`alpha` or `production`; forward only, and
  production only when chosen). Its `check` job reads no secret and refuses before the approval: a ref other than main,
  a code that is not one, a move backwards, a status other than draft or completed, a production rollout fraction
  outside 0 to 1. The `promote` job runs in the `play` environment and runs the pinned fastlane's `supply` with
  `SUPPLY_TRACK`, `SUPPLY_TRACK_PROMOTE_TO`, `SUPPLY_VERSION_CODE` and `SUPPLY_TRACK_PROMOTE_RELEASE_STATUS`, every
  upload skipped (bundle, APK, release notes, images, screenshots): read in fastlane 2.241.2's `uploader.rb`, a run that
  uploads no binary promotes the release holding that code. The status is `PLAY_RELEASE_STATUS`, draft when unset; a
  completed production release is staged at the `rollout` input, passed as `--rollout` because supply's rollout has no
  environment variable, and the maintainer takes it to 100% in the Console. **Why main and not the tag:** the build's
  tag rule alone would make each promotion need the workflow file at that tag, and `mobile-v1.0.1-rc.1` was tagged
  before it existed; so the `play` environment's deployment rules add main, and every run still waits for the approval.
  The listing is `apps/mobile/play/metadata/en-US/title.txt`, `short_description.txt` and `full_description.txt`, in
  plain words from the README and `about.ts` (free, MIT, open source, reads Aurora content, works offline, ships no
  rulebook text; no support link, which Play's policy ADR 0132 decision 8 names would put at risk).
  `release-notes.cjs --listing` holds it to Play's 30, 80 and 4000 characters, none empty. It is uploaded only when a
  run's `listing` input is ticked (promote, or a release started from `mobile-tag.yml`), checked before the approval;
  a pushed tag never uploads it. Images and screenshots stay unuploaded: none are in the repository, and none are made
  here. `.github/workflows/mobile-tag.yml` is started on main with a candidate number (empty for the release): it
  reads the version from `app.json`, runs `release-version.cjs` and `release-notes.cjs` on the tag it would make,
  refuses one that exists, creates it at the run's commit through the API, and starts `mobile-release.yml` on it with
  `gh workflow run --ref <tag>`. **Why a dispatch:** a tag created with `GITHUB_TOKEN` starts no workflow, and a
  `workflow_dispatch` is the one event that token may start, so no personal token or app key is added to the
  repository. `mobile-release.yml` gained `workflow_dispatch` (with `listing`) and refuses a dispatch whose ref is not a
  tag; its other checks are unchanged. `mobile-release.test.ts` holds both workflows, the release's dispatch and the
  listing's limits, each assertion failing under its named perturbation (21, run 2026-11-26). Not run against Play or
  on Actions: the first promotion and the first tag made from the Actions tab are the test.

## Evidence

DaltonPick's `.github/workflows/release.yml`, `ci.yml`, `docs/RELEASE.md` and `app/build.gradle.kts`, read on
2026-11-25. Incudo's `.github/workflows/mobile-release.yml` and `apps/mobile/app.json` at the commit this ADR lands on.
Nothing is built yet: the steps are planned as separate pull requests (hardening, upload, promotion and listing).
