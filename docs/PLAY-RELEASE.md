# Releasing the phone app on Google Play

How a tag becomes a build on Google Play, and what the maintainer sets up once. The decisions are
[ADR 0132](adr/0132-the-phone-app-is-released-on-google-play-built-and-signed-by-ci-with-an-upload-key-the-maintainer-keeps.md)
(the bundle, its version code and its upload key) and
[ADR 0135](adr/0135-ci-uploads-the-phone-s-bundle-to-google-play-after-the-maintainer-approves-the-run.md) (the upload).
The workflow is `.github/workflows/mobile-release.yml`.

## What happens on a tag

1. A tag `mobile-vX.Y.Z-rc.N` (a candidate) or `mobile-vX.Y.Z` (a release) starts the run. It stops at once when the
   tag's version is not the one in `apps/mobile/app.json` and `apps/mobile/package.json`, when the tagged commit is not on
   main, or when the tag's release notes are missing or too long.
2. The same checks as every push to main run on the tagged commit.
3. The `release` job waits for approval. GitHub shows **Review deployments** on the run's page in the Actions tab and
   emails the reviewer. Nothing has been built with the key yet, and nothing can reach Play before the approval.
4. Once approved, the job builds the bundle (about 12 minutes) and signs it with the upload key. It checks the
   permissions the build asks for, that the upload key signed it, and that it carries its debug symbols. It keeps the
   bundle as the run's artifact for 90 days, then uploads it with fastlane:
   - a candidate goes to **internal testing**;
   - a release goes to **closed testing** (Play's `alpha` track) until the app has production access.
5. The upload is a **draft** unless the repository variable `PLAY_RELEASE_STATUS` is `completed`. A draft waits in the
   Play Console under the track's releases, and **Review release › Start rollout** sends it to testers.

The version code comes from the tag, never from a run number: `MAJOR·1 000 000 + MINOR·10 000 + PATCH·100 + N`, where N
is the candidate's number and 99 the release (`apps/mobile/scripts/release-version.cjs`). Play holds 1 000 099 (1.0.0,
uploaded by hand), so the first tag CI can upload is `mobile-v1.0.1-rc.1`.

## Setting it up once

### The `play` environment

In the repository's **Settings › Environments**, create `play`:

- **Required reviewers**: the maintainer.
- **Deployment branches and tags**: add a tag rule `mobile-v*`, so no other ref can use the environment.
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
   **Release apps to testing tracks**. Leave production off until the app has production access.

### The release status

`PLAY_RELEASE_STATUS` is a repository **variable**, not a secret (**Settings › Secrets and variables › Actions ›
Variables**). Leave it unset while every upload should wait as a draft. Set it to `completed` once Play has reviewed the
app and an approved run should go straight to testers. Any other value stops the run before it builds.

## Making a release

1. Move the phone's version: `version` in `apps/mobile/app.json` and `apps/mobile/package.json` (and the workspace's
   entry in `package-lock.json`), and `android.versionCode` in `app.json` to that version's release code (N = 99). The
   test `tools/verify/src/mobile-release.test.ts` holds them together.
2. Write the release notes: `apps/mobile/play/metadata/en-US/changelogs/<version code>.txt`, at most 500 characters, for
   the tag you will push. `node apps/mobile/scripts/release-notes.cjs mobile-v1.0.1-rc.1` checks them. Each candidate
   has its own code, so each has its own file.
3. Merge that through a pull request, then tag the merge commit on main and push the tag:

   ```bash
   git tag mobile-v1.0.1-rc.1 <commit>
   git push origin mobile-v1.0.1-rc.1
   ```

4. Approve the run in the Actions tab when its checks are green.
5. For a draft, roll it out in the Play Console.

A tag is never reused. If a run fails after the upload, or the build is wrong, fix it through a pull request and tag the
next candidate. Play refuses a version code it has already been given, even for a draft that was discarded.

## When it fails

- **Before the approval**: the run names the problem (the tag, the release notes or a check). Nothing was built or
  uploaded. Fix it and push the next tag.
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
