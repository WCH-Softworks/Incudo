# Releasing the phone app on Google Play

How a tag becomes a build on Google Play, and what the maintainer sets up once. The decisions are
[ADR 0132](adr/0132-the-phone-app-is-released-on-google-play-built-and-signed-by-ci-with-an-upload-key-the-maintainer-keeps.md)
(the bundle, its version code and its upload key) and
[ADR 0135](adr/0135-ci-uploads-the-phone-s-bundle-to-google-play-after-the-maintainer-approves-the-run.md) (the upload).
The workflows are `.github/workflows/mobile-release.yml` (build and upload), `mobile-tag.yml` (make the tag from the
Actions tab) and `mobile-promote.yml` (move a build to the next track).

## What happens on a tag

1. A tag `mobile-vX.Y.Z` (a release, the usual one) or `mobile-vX.Y.Z-rc.N` (a candidate) starts the run, whether it
   was pushed or made by **Phone tag** in the Actions tab. It stops at once when the tag's version is not the one in
   `apps/mobile/app.json` and `apps/mobile/package.json`, when the tagged commit is not on main, or when the tag's
   release notes are missing or too long.
2. The same checks as a pull request's run on the tagged commit, in full, unless a full run already passed on the same
   files against today's Aurora content (the desktop's tag on the same commit, or the daily run): then they are skipped.
3. The `release` job waits for approval. GitHub shows **Review deployments** on the run's page in the Actions tab and
   emails the reviewer. Nothing has been built with the key yet, and nothing can reach Play before the approval.
4. Once approved, the job builds the bundle (about 12 minutes) and signs it with the upload key. It checks the
   permissions the build asks for, that the upload key signed it, and that it carries its debug symbols. It keeps the
   bundle as the run's artifact for 90 days, then uploads it with fastlane to **internal testing**, whatever the tag.
   **Phone promote** moves it on to closed testing (Play's `alpha` track) and later production (below).
5. The upload is a **draft** unless the repository variable `PLAY_RELEASE_STATUS` is `completed`. A draft waits in the
   Play Console under the track's releases, and **Review release › Start rollout** sends it to testers.

The version code comes from the tag, never from a run number: `MAJOR·1 000 000 + MINOR·10 000 + PATCH·100 + N`, where N
is the candidate's number and 99 the release (`apps/mobile/scripts/release-version.cjs`). Play holds 1 000 099 (1.0.0,
uploaded by hand) and 1 000 101 (`mobile-v1.0.1-rc.1`, the first CI upload), so the next tag is `mobile-v1.0.1`
(1 000 199).

**A release is tagged `mobile-vX.Y.Z` directly, and a tag is never reused** (the maintainer's call, 2026-11-26, the same
rule as the desktop's). Internal testing is where a build is tried before anyone else gets it, so a candidate tag adds
nothing there. `-rc.N` stays accepted for when others should try a build before the release; it is not the default.

## Setting it up once

### The `play` environment

In the repository's **Settings › Environments**, create `play`:

- **Required reviewers**: the maintainer.
- **Deployment branches and tags**: choose **Selected branches and tags**, then add a tag rule `mobile-v*` (the release)
  and a branch rule `main` (a promotion), so no other ref can use the environment.
- **Environment secrets**, all text:

  | Secret | What it holds |
  |---|---|
  | `ANDROID_UPLOAD_KEYSTORE` | The upload keystore file, as base64 on one line |
  | `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | The keystore's password |
  | `ANDROID_UPLOAD_KEY_ALIAS` | The key's alias in the keystore |
  | `ANDROID_UPLOAD_KEY_PASSWORD` | The key's password |
  | `PLAY_SERVICE_ACCOUNT_JSON` | The whole content of the service account's JSON key |

  To get the keystore as base64 on Windows, run this in PowerShell, then paste the clipboard:

  ```powershell
  [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\upload.jks")) | Set-Clipboard
  ```

  On macOS or Linux, run `base64 -w0 upload.jks` (macOS: `base64 -i upload.jks`).

If the same four `ANDROID_UPLOAD_*` names are still repository secrets, delete them there. Any workflow on any branch
can read a repository secret, and the environment's copies are the ones the release reads.

### The service account

The service account is Incudo's own, `incudo-play-publisher`. No other app's account is reused, so a leaked key reaches
this app only.

1. In [Google Cloud Console](https://console.cloud.google.com), signed in with the account that owns the Play developer
   account, pick or create a project.
2. In **APIs & Services › Library**, enable the **Google Play Android Developer API**.
3. In **IAM & Admin › Service Accounts**, create `incudo-play-publisher` with no roles.
4. Open it, then **Keys › Add key › Create new key › JSON**. Paste the downloaded file's content into
   `PLAY_SERVICE_ACCOUNT_JSON`, then delete the file.
5. In the Play Console, open **Users and permissions › Invite new users** and enter the service account's email
   (`incudo-play-publisher@<project>.iam.gserviceaccount.com`). Under **App permissions**, add Incudo only and tick
   **Release apps to testing tracks**. Leave production off until the app has production access; a promotion to
   production needs **Release to production, exclude devices, and use Play App Signing** too.

### The release status

`PLAY_RELEASE_STATUS` is a repository **variable**, not a secret (**Settings › Secrets and variables › Actions ›
Variables**). Leave it unset while every upload should wait as a draft. Set it to `completed` once Play has reviewed the
app and an approved run should go straight to testers. Any other value stops the run before it builds.

## Making a release

1. Move the phone's version: `version` in `apps/mobile/app.json` and `apps/mobile/package.json` (and the workspace's
   entry in `package-lock.json`), and `android.versionCode` in `app.json` to that version's release code (N = 99). The
   test `tools/verify/src/mobile-release.test.ts` holds them together.
2. Write the release notes: `apps/mobile/play/metadata/en-US/changelogs/<version code>.txt`, at most 500 characters, for
   the tag you will make. `node apps/mobile/scripts/release-notes.cjs mobile-v1.0.1` checks them. A candidate has a code
   of its own, so it needs a file of its own.
3. Merge that through a pull request. That is the release: **Tag on merge** sees the new version in `app.json` and starts
   **Phone tag** on main, ticking **listing** when the pull request changed the listing's text. Nothing else to run.
   Phone tag can still be run by hand: **Actions › Phone tag › Run workflow**, on `main`, leaving the candidate empty for the release (a number only for a candidate). It refuses
   a tag that exists or whose release notes are missing, creates it, and starts **Phone release** on it. Tick
   **listing** to send the store listing's text with the bundle. Or tag the merge commit and push it yourself, which
   never sends the listing:

   ```bash
   git tag mobile-v1.0.1 <commit>
   git push origin mobile-v1.0.1
   ```

4. Approve the run in the Actions tab when its checks are green.
5. For a draft, roll it out to internal testers in the Play Console, and try it.
6. When it is good, promote it to closed testing, and later to production (below).

A tag is never reused, and never deleted and pushed again. If the build or the testing fails, the fix goes through a
pull request **that also moves the phone to the next patch** (step 1, and its release notes), and that version is
tagged. Play refuses a version code it has already been given, even for a draft that was discarded.

## Promoting a build

A build on internal testing moves to closed testing, and one on closed testing to production, without building again:
**Actions › Phone promote › Run workflow**, on `main`.

- **version**: the version code Play shows for it (`1000199`) or the tag that built it (`mobile-v1.0.1`).
- **from** and **to**: the track it is on and the one to move it to. A build only moves forward, and production is
  never the default: it is reached only when you choose it.
- **rollout**: for production only, when `PLAY_RELEASE_STATUS` is `completed`: the fraction of users who get it first
  (`0.1` is 10%). Move it to 100% in the Play Console under the production release.
- **listing**: tick it to send the store listing's text with the promotion.

The run checks all of it, then waits for approval as a release does. It moves the release with the notes it was uploaded
with. With `PLAY_RELEASE_STATUS` unset the moved release is a draft, and the Console's **Review release › Start rollout**
sends it. A promotion of a tag made before `mobile-promote.yml` existed works the same: it runs from main.

## The store listing

The listing's text is in the repository: `apps/mobile/play/metadata/en-US/title.txt` (at most 30 characters),
`short_description.txt` (80) and `full_description.txt` (4000). `node apps/mobile/scripts/release-notes.cjs --listing`
checks the limits, and so does `mobile-release.test.ts`. Change it through a pull request.

It reaches Play only when a run is asked to: the **listing** input of **Phone tag** (which passes it to the release) or
of **Phone promote**. A pushed tag never sends it. A run that sends it replaces the Console's text with the repository's,
so an edit made in the Console is lost unless it is copied here first. The icon, the feature graphic and the
screenshots are never uploaded by these workflows; they are a person's work and are added in the Console.

## When it fails

- **Before the approval**: the run names the problem (the tag, the release notes, the listing or a check). Nothing was
  built or uploaded. Fix it through a pull request and run Phone tag again: the tag was never made if the run stopped
  in Phone tag, and a pushed tag that stopped is not reused (move to the next patch).
- **"Phone tag" says the tag exists**: a tag is never reused. Move the phone to the next patch, with its release notes.
- **A promotion says the track "doesn't have any releases"**: no release on **from** holds that version code. Check the
  code in the Console's track page.
- **"is not signed with the upload key"**: the keystore secret or its alias names a different key than the one Play
  expects. Check the alias, and compare the key's SHA-256 with **Setup › App signing › Upload key certificate** in the
  Play Console.
- **The upload is refused with a 401 or 403**: the service account is not invited, or it lacks **Release apps to
  testing tracks** for Incudo. Invitations take effect at once.
- **"Changes cannot be sent for review automatically"**: Play wants the change sent from the Console. Open the draft
  there and send it for review.
- **The upload fails after the bundle was kept**: the bundle is the run's artifact. It can be uploaded by hand in the
  Console while the cause is fixed.

## What the Console is still needed for

The data safety form, the content rating and the other App content declarations, Play's review questions, and, while
the developer account is personal, the closed test's testers. A personal account created after November 2023 must run
a closed test with at least 12 testers for 14 days before it can apply for production access.
