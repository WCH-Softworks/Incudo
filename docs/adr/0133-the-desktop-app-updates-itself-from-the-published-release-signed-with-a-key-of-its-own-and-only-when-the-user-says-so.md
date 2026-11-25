# 0133 — The desktop app updates itself from the published release, signed with a key of its own, and only when the user says so

**Status:** Proposed · 2026-11-24 · built on a branch for the first release after 1.0.0; the open questions below are the
maintainer's · ROADMAP Beyond 1.0, "1.x — The desktop app updates itself" · builds on
[0037](./0037-a-command-is-data-the-page-owns-the-keyboard.md),
[0079](./0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md)
(a port a shell may lack, and a command left out where it does),
[0132](./0132-the-phone-app-is-released-on-google-play-built-and-signed-by-ci-with-an-upload-key-the-maintainer-keeps.md)
(a signing key the maintainer keeps, in CI secrets) ·
**format:** none

## Context

Desktop 1.0.0 shipped on 2026-11-19 as unsigned installers on a GitHub Release, which `.github/workflows/release.yml`
builds into a **draft** for the maintainer to publish. Each user installed it by hand, and each later version would have
to be found and installed by hand too. The next release, the first incremental one after 1.0, will carry patch notes.

What was there, read before anything was written:

- `tauri.conf.json`: `bundle.targets: "all"` (Windows NSIS and MSI, macOS `.app` and `.dmg`, Linux AppImage, `.deb`,
  `.rpm`), no `plugins.updater`. macOS is signed ad hoc (`signingIdentity: "-"`), Windows not at all.
- `Cargo.toml`: the dialog, fs and opener plugins, on a locked Tauri 2.11.5.
- `capabilities/default.json`: narrow on purpose; the opener may open exactly the About links.
- `docs/PRIVACY.md`: every request the app makes, which was only the content sources the user adds.

What Tauri 2's updater is (its documentation and `tauri-plugin-updater`):

- **It has a signing key of its own**, a minisign key pair made by `npx tauri signer generate`. The build signs each
  update artifact with the private key (from `TAURI_SIGNING_PRIVATE_KEY` and `…_PASSWORD` in the environment), and the
  app refuses to install anything whose signature does not match the public key compiled into it. **This is not code
  signing**: Windows Authenticode and Apple's Developer ID are separate, cost money, and are not needed for the updater.
  The installers stay unsigned, and SmartScreen and Gatekeeper say what they say today.
- **A static `latest.json`** can name the newest version and, per platform, a download address and its signature. The
  app asks one or more fixed addresses for it.
- `bundle.createUpdaterArtifacts: true` makes `tauri build` write a `.sig` beside each installer it can update from
  (in Tauri 2 the installers themselves: NSIS `.exe`, `.msi`, the AppImage, and an `.app.tar.gz` on macOS). With it on,
  **`tauri build` fails without the private key**.
- On Windows "the application is automatically exited when the install step is executed"; elsewhere the app must be
  started again (`relaunch` in `tauri-plugin-process`).

What `tauri-apps/tauri-action` does with `latest.json` (its `upload-version-json.ts`, read on its `dev` branch):

- `includeUpdaterJson` defaults to true. **Each build job** lists the release's assets, downloads any `latest.json`
  there, keeps its `platforms`, adds its own, **deletes the asset and uploads the new one**. Nothing stops two of the
  four parallel jobs reading the same copy: the last to upload wins and the other's platform is gone, with every job
  green.
- Its download addresses are `api.github.com/repos/<owner>/<repo>/releases/assets/<id>`, not the release's own
  `releases/download/<tag>/<file>`. Those stay valid when a draft is published (no `untagged-…` address is written),
  but a person cannot read them, and they depend on the API's anonymous rate limit.

What GitHub serves at `releases/latest/download/<file>`: the file from the repository's **latest release**, which is
never a draft and never a pre-release. That address is what keeps an unpublished build away from users.

## Decision

1. **Tauri's updater, with Incudo's own minisign key, separate from code signing.** `tauri-plugin-updater` (and
   `tauri-plugin-process` for `relaunch`), held to the minors the locked Tauri 2.11 takes (updater 2.10, process 2.3,
   the npm packages on the same minors, which the Tauri CLI requires; the newest updater moves Tauri to 2.12, which
   wants rustc 1.90, and moving Tauri is its own change). `bundle.createUpdaterArtifacts: true`. The installers stay
   unsigned and the release notes keep saying so.
2. **One address: `https://github.com/WCH-Softworks/Incudo/releases/latest/download/latest.json`.** A draft or an rc
   is never offered, because GitHub never serves either there. Publishing the release is what offers it.
   `windows.installMode` is `passive`: the installer shows its progress and asks nothing.
3. **`latest.json` is written once, by the workflow, after every installer is built** (`apps/desktop/scripts/
   updater-manifest.cjs`, the release's last job `updater`), and tauri-action's own is off (`includeUpdaterJson: false`).
   It reads the release's asset names and `.sig` files and writes, per platform, the release's own address
   (`releases/download/<tag>/<file>`, which answers once the draft is published) and the signature text: the plain key
   (`windows-x86_64` is the NSIS installer, `darwin-<chip>` the `.app.tar.gz`, `linux-x86_64` the AppImage) and the
   installer-specific ones (`windows-x86_64-msi`, `-nsis`, `darwin-<chip>-app`, `linux-x86_64-appimage`, and `-deb` /
   `-rpm` if those are ever signed), so an app installed from the MSI updates from the MSI. **It refuses, naming it, a
   release missing any of the four platforms built** (`windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`,
   `linux-x86_64`), a file whose processor its name does not say, and two files for one platform. Its `notes` is a
   sentence linking the release page.
4. **The release refuses the placeholder key.** `plugins.updater.pubkey` is committed as
   `REPLACE-WITH-THE-UPDATE-PUBLIC-KEY` until the maintainer generates the pair. The release's first job runs
   `updater-manifest.cjs --check-config`, which fails while the key is the placeholder or is not a minisign public key,
   while `createUpdaterArtifacts` is off, or while the endpoint is anything else. `npm test` does **not** fail on it (it
   says so in an `ℹ` line): the place it must not get past is a release, and a red suite for a key nobody has yet would
   teach everyone to ignore red.
5. **The private key and its password are two repository secrets, `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, passed to tauri-action in each build job, and never in the repository.** Kept
   as ADR 0132 keeps the Android upload key: the maintainer's password manager (the key file's text and the password),
   one offline copy, and the Actions secrets. **Unlike the upload key there is no reset**: an app checks updates against
   the public key it was built with, so a lost private key means no installed copy can be updated again and each must be
   replaced by hand with a build carrying a new key. A leaked key lets whoever holds it sign an update every copy would
   accept, if they could also put it at the address (which needs the repository).
6. **The app asks; it never downloads or installs unasked.** A check reads `latest.json` and nothing else. When it finds
   a newer version the dialog says which, links its release notes ("What is new in 1.1.0", the release page), and offers
   **Download and install** or **Not now**. Not now changes nothing and asks again at the next start. Installing shows
   the download's progress; Incudo then closes, installs and opens again. The dialog says a character not saved to the
   library is kept: the draft is written on every change (ADR 0066) and is there when Incudo opens again.
7. **When it checks: at start, and when asked.** A check at start, which Settings can turn off ("Check for updates when
   Incudo starts", on by default, remembered under `app/updates` in `Storage`, never in a character), and the command
   **Help › Check for updates…** (ADR 0037; no shortcut) plus a "Check now" button beside the setting. A start check says
   nothing unless there is a newer version: no connection, a server that does not answer within 30 seconds and being up
   to date are silent (a log line), so nobody offline is nagged. A check someone asked for says each answer: checking, up
   to date, or why it failed, with Try again.
8. **The words and the states are `packages/ui/src/app-update.ts`'s, behind a port.** `AppUpdater` in
   `core/platform.ts` (`available`, `check`, `install`); the Tauri window's is the two plugins, the browser build's is
   unavailable. Where it is unavailable the command is left out of the menu (`absentCommands`, as for the PDF export),
   the Settings section is not drawn, and nothing is checked. `apps/desktop/src/use-updates.ts` holds the status and
   `panes/UpdateDialog.tsx` draws it; neither words anything. No ADR number on screen.
9. **Narrow permissions.** `updater:allow-check`, `updater:allow-download-and-install`, `process:allow-restart`; not
   `updater:default` or `process:default` (which adds `exit`). The opener may also open `…/Incudo/releases/tag/*`, the
   release notes, and nothing else new.
10. **`docs/PRIVACY.md` lists the check**: one request to GitHub for `latest.json`, carrying nothing about the user or
    their characters (GitHub sees the network address, as any server does); the installer only when the user agrees;
    not on Android, which Play updates.
11. **1.0.0 has no updater.** Everyone on 1.0.0 installs the first updating release by hand, once; the release notes say
    so. From then on each copy finds the next.

> **Note, 2026-11-24, after v1.1.0-rc.1 — the release's file list, and what the rc settled.** The rc's draft held 17
> files where 1.0.0's held 9: the same installers, seven `.sig` files and `latest.json`. By the maintainer's call:
> the `updater` job now **deletes every `.sig` from the release after uploading `latest.json`** (the signatures are inside
> it, and nothing else reads them; before the upload, a failed run would lose them); **Windows ships the setup program
> only** (`bundle.targets` lists `nsis`, `app`, `dmg`, `appimage`, `deb`, `rpm`: no `msi`), whose installer finds an
> MSI install of the same product and publisher and offers to remove it first (read in the Tauri CLI's NSIS template);
> the `.rpm` stays, so no Linux family is left out; and the notes open with a table naming the one file for each kind of
> computer, linked. A release now lists 9 files: six installers, two `.app.tar.gz` the Mac updates download, and
> `latest.json`. The rc also settled three things decision 3 and "Not verified" left open: tauri-action names the
> files as `archOf` reads them (`Incudo_aarch64.app.tar.gz`, `Incudo_x64.app.tar.gz` and the rest), `gh` finds the
> draft by its tag, and the `.deb` and `.rpm` **are** signed (412 and 416 characters), so their keys are written. The
> Windows installer's signature was checked against the committed public key with Node's own Ed25519 and BLAKE2b, and
> a copy with one byte changed fails. The Apple silicon build waited twice for a runner GitHub never gave it
> ("capacity constraints"); a re-run of the failed jobs is the answer.
>
> **Note, 2026-11-25, after v1.1.0-rc.2 — both Macs build in one job.** rc.2 met the same wait: across the two
> candidates the Apple silicon job was left without a runner in five of seven tries, the Intel one, on the same
> `macos-latest` label, in none. The matrix now has one macOS entry that builds Apple silicon and then Intel (`then`,
> a second tauri-action step), so a tag waits for one Mac runner, not two. The files and their names are unchanged;
> the Mac half takes about twice as long. Held by `release-workflow.test.ts`.
>
> **Note, 2026-11-25, after v1.1.0-rc.3 — two things the rc found.** The one Mac job got a runner at once, built
> Apple silicon, and failed at the Intel `.dmg` (`bundle_dmg.sh`, with no output of its own). The image the first build
> mounted is the likely cause and is not confirmed: a step now detaches anything mounted under the app's name between the
> two, and the Intel build runs with `--verbose`. And the rc showed that **tauri-action has no input called
> `uploadUpdaterJson`**: its log warns about an unexpected input, and with the `updater` job skipped the release held the
> action's own `latest.json`. The input is `includeUpdaterJson`. Through rc.1 and rc.2 the action wrote its own file and
> the `updater` job overwrote it, so what was published was right, with the race decision 3 avoids still underneath.

## Open questions for the maintainer

- **"Skip this version."** Not built: Not now asks again at the next start, which is mild with one check per start. If
  that proves nagging, a skipped version can be remembered beside `checkOnStart`.
- **The `.deb` and `.rpm`.** They are signed and named in `latest.json` (the note above). Whether the updater installs
  one in place has not been run; the maintainer keeps all three Linux formats.
- **A pre-release channel.** An rc is never offered (decision 2). Testers who want candidates install them by hand. A
  second address for a beta channel is possible later.
- **An rc's app reads as the final version** (the app's version carries no `-rc`, as before), so a tester on 1.1.0-rc.2
  is not offered 1.1.0. Acceptable while testers are few.
- **Code signing.** Still not done, and still separate; SmartScreen and Gatekeeper warnings on the first install stand.

## Consequences

- A release cannot be built until the maintainer has made the key pair, pasted the public key into `tauri.conf.json` (a
  commit through a PR) and added the two secrets. A local `tauri build` needs the key in the environment too; `npm run
  desktop:app` (`tauri dev`) does not.
- The workflow gains a fifth job; `latest.json` appears on every release, rc included (harmless: an rc is never
  "latest"). If a build fails, the `updater` job does not run; run the failed build again, then the job.
- The draft stays a draft until the maintainer publishes it, and **publishing is now what ships an update** to every
  updating copy. Publishing an older patch after a newer one would make it "latest" on GitHub; mark the right one latest.
- Every start of the desktop app makes one request to github.com unless Settings turns it off.

## Not verified

- **No update has been installed end to end.** That needs a release signed with the real key and published; none exists
  yet. The first published updating release is installed by hand, and the one after it is the first that can be tested
  as an update. Until then the check, the download, the signature, the install and the relaunch are unrun on every
  platform; the release check for that second release must drive them on Windows at least.
- **tauri-action's asset names** (`Incudo_aarch64.app.tar.gz`, `Incudo_x64.app.tar.gz` and the rest) are as recorded
  from its source and its examples, not from a run with `createUpdaterArtifacts` on. If they differ, the manifest
  refuses with a sentence rather than writes a wrong file, and `archOf` is the place to fix.
- **`gh release view` and `gh release download` finding a draft by its tag** was not run here. gh looks a draft up by
  tag when the tag lookup misses; if that does not hold, the job fails and says so before uploading anything.
- `cargo check` passed on Windows with the plugins; no `tauri build` was run (it needs the key). macOS and Linux were
  not built.

## Evidence

`packages/ui/src/app-update.test.ts` (each dialog state, the silent start check, the preference),
`packages/ui/src/commands.test.ts` (the command, its menu place, its absence where there is no updater),
`tools/verify/src/desktop-updater.test.ts` (the config and the placeholder guard, the permissions, the Rust and npm
minors, the workflow's secrets and jobs, and `latest.json` from a release's assets, refusing a missing platform),
`tools/verify/src/support-links.test.ts` (the opener's addresses). Each names the perturbation that fails it.
