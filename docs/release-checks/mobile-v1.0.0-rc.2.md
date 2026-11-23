# mobile-v1.0.0-rc.2 (Expo SDK 58)

The phone app's release check walked again after the move to Expo SDK 58 (`4ae796a`: React Native 0.88.1, React 19.3.0,
react-native-screens 4.30.1, react-native-safe-area-context 5.11.1, AGP 9.2.1, Gradle 9.4.1). Every row of
[rc.1](mobile-v1.0.0-rc.1.md)'s two tables walked again on the Pixel 9 Pro emulator, first in the development build and
then in a release build, with what the upgrade moved looked at on purpose: headers, safe-area insets, the navigation
stack and Back, dark mode, a share while the app is closed, the metered prompt, the release manifest's permissions and
backup rules. **No `mobile-v` tag**: the release build below is a local one signed with a throwaway key, not CI's.

| | |
| --- | --- |
| Builds | development build (`expo run:android`'s APK from a short-path clone, Metro serving the worktree); release build (`expo prebuild --platform android --no-install`, then `gradlew :app:assembleRelease :app:bundleRelease` signed through `android.injected.signing.*` as `mobile-release.yml` does, a throwaway key never committed) |
| Java | Android Studio's bundled Java 25, no daemon JVM pin |
| Device | Pixel 9 Pro emulator, Android 16 (API 36), x86_64 |
| Content | AuroraLegacy/elements at `0be24c4` (unchanged since rc.1), added from the phone over the network; Node's checks read `.corpus/` at `c28ce6c` |
| Real phone | not yet |

## Building on Windows

- **The CMake path limit, as these builds met it.** From the short clone, React Native 0.88's safe-area-context codegen
  makes a 264-character directory under the app's `.cxx` (the checkout root is in it twice), and AGP's default CMake
  3.22.1 ships Ninja 1.10.2, which stops at 260 although Windows' long paths are on. Both builds here used a local,
  uncommitted `buildStagingDirectory` in the generated `android/app/build.gradle`.
- **Measured after the drive, and what replaces that.** With the staging line removed the failure reproduces in 19 s;
  with `android.cmakeVersion=4.2.1` (this machine's own CMake, winget's Ninja 1.13.2 on PATH) as a Gradle property the
  native build succeeds, and full debug and release APKs build from the worktree itself and run on the emulator. The
  property is set in the user's `%USERPROFILE%\.gradle\gradle.properties`, never in the repository: CI on Linux has no
  such limit and would fail on a CMake it lacks. No clone or staging folder is needed (CLAUDE.md, under ADR 0132).
- `expo prebuild` still says `userInterfaceStyle` needs `expo-system-ui`. Dark mode follows the system anyway (below).

## The development build

| Feature | Driven | What was seen |
| --- | --- | --- |
| Start, headers, insets | yes | the dev menu's first-run sheet once; every screen's header below the status bar, the last line of the longest sheet above the gesture bar; pickers and dialogs inside the safe area |
| About (ADR 0132) | yes | Version 1.0.0, the source link, the SRD 5.2.1 notice, the privacy sentence and policy link, Ko-fi only |
| Content: add the suggested source | yes | AuroraLegacy downloaded and converted in 47 s; 14,317 entries; "Refers to 1 thing none of your enabled sources contain", Show which naming the upstream typo |
| Content: check for updates (ADR 0050) | yes | "Up to date: none of 800 files has changed.", 12 s |
| Content: choose parts (ADR 0055) | yes | Monster Manual off: "737 of 740 files will load", 14,228 entries, "1 part switched off", the line then missing 2 things; Switch everything on brought back 14,317 |
| Content: notes after a switch (ADRs 0052, 0090) | yes | the source switched off and on: its notes back with the load, no Build visited |
| Content: an Aurora file (ADR 0056) | yes | picked from Downloads: "1 file added", 8 entries, named "Homebrew Legendary Test" from its `<info>` (the picker hands over a provider id); the UTF-16 copy of the same file "1 replaced with the newer copy" |
| Content: overlaps, move, remove (ADR 0054) | yes | a copy with its own `<info>` name: both lines "Also defines 8 things … defines, the same way."; Move up; Remove asked, the copy and both notes gone |
| Library: add five packed samples | yes | samples 02, 07, 08, 16, 19 through the picker, one at a time; each sheet's checksum equal to Node's |
| Library: a shared Aurora save (ADR 0101) | yes | shared from Files over an open sheet: "An Aurora save", Import, "Imported Sample 28. The import noted 2 things.", Open; its sheet's checksum equal to the desktop import's. Back from it went to Characters, and Back again to Files |
| Sheet (ADR 0126 on the phone) | yes | the document's order, the "i" opening a section's explanation, the sheet scrolled to its end |
| Play (ADR 0084) | yes | 7 hit points lost (42 of 49), two 1st-level slots spent (2 of 4), Poisoned, a long rest restoring all but the condition; each write logged at once |
| Export: save to a folder | yes | to `Documents/Incudo-out`, which held a file of that name: "Saved as \"sample-02 (1).incu\"."; read in Node, the same sheet, `play` kept |
| Build: start options (ADR 0123) | yes | the dialog first, feats and multiclassing on |
| Build: required first, optional folded (ADRs 0123, 0127, 0131) | yes | optional class features and starting equipment with the required; the rest under "Optional (N)", Show and Hide |
| Build: languages and skills held left out | yes | 41 languages for a High Elf Sage's pool, no Elvish or Common; a Wizard's skills without Arcana or History after Sage |
| Build: other printings (ADR 0125) | yes | Acid Splash taken from the High Elf's pool: the Wizard's cantrips 66 → 64, both printings gone |
| Build: overlap notes (ADR 0091) | yes | "The character already has Weapon Proficiency (Shortbow)" on the 2024 Wizard row |
| Build: spell choices heading (ADR 0124), preparing (ADR 0046) | yes | **bug, fixed** (below); "Spell choices (3)"; "5 of 4 prepared, 1 over", taken back to 4 |
| Build: starting equipment (ADR 0087) | yes | the Wizard's four choices and the Sage's package taken; 10 gp in the purse |
| Build: spell attacks (ADR 0111) | yes | the die list d4, d6, d8, d10, d12; Acid Splash "DC 13 Dexterity, 1d6 acid", Fire Bolt "+5, 1d10 fire" |
| Build: level up in another class (ADR 0036), per-level hit points | yes | Wizard 1 / Fighter 1, "Hit Points, level 2" on a d10, Average (6), Done; Defense |
| Build: buy and equip (ADR 0098), grouped list (ADR 0117) | yes | Armor (27) › Leather, 10 gp: bought, equipped, the purse 0 gp; AC 15 |
| Save and read back | yes | Save greyed once saved; the file read in Node with no source: AC 15, HP 14, both spell attacks, four prepared spells, AuroraLegacy recorded as its source; the phone's sheet checksum equal to Node's |
| Build: an NPC on a creature (ADRs 0057–0062) | yes | a Wolf: CR 1/4, AC 13 (natural armor), HP 11 (2d8+2), speed 40, Perception +3 (proficient), Stealth +4 (proficient) |
| Build: an NPC's addition, reference and written feature (ADRs 0063, 0064, 0068) | yes | Alert on the Wolf (initiative +7), the Draconic Spirit kept for reference, "Swift Digger: burrow 10"; saved, read in Node with no source to the phone's checksum |
| The feature library (ADR 0106) | yes | Swift Digger saved to the library (`incudo-features.json` read back with `run-as`), given to the next character as a linked copy |
| Build: a legendary creature (ADR 0065) | yes | the homebrew file's Old Stone Drake: Rallying Roar taken beside the Tail Sweep it grants, 3 uses, its lair action and regional effect; the library feature given; saved, the homebrew file recorded as its source, read in Node with no source to the phone's checksum |
| Build: a 2014 Ranger with multiclassing off (ADRs 0088, 0116, 0129) | yes | "Multiclassing is switched off for this character…"; Deft Explorer taken, its Canny expertise offering nothing until Stealth was taken and then Skill Expertise (Stealth); Chaotic Good and Mielikki "complete"; saved this time |
| Build: a soft requirement (ADR 0124) | yes | a Warlock 2's invocations: Agonizing Blast offered with "Needs Eldritch Blast, which this character does not have", and the same line on its settled card |
| Unsaved changes on Back (ADR 0120) | yes | Back from an edited or new character asks "Save this character?" with Keep editing, Discard and Save |
| Content: the metered prompt (ADR 0100) | yes | Wi-Fi off (the connection METERED): "Refresh AuroraLegacy? Refreshing downloads all 740 of its files again. This device is on a metered connection…"; Cancel; on Wi-Fi no question, "Refreshed: 800 downloaded." |
| Dark mode | yes | `cmd uimode night yes`: Content, the sheet, Build, a picker and the unsaved-changes dialog all in the dark palette, live, with no restart; `expo-system-ui` is not needed for that |
| A share while closed (ADR 0099) | yes | as recorded for the development build: the launcher starts, and the file arrives unreadable ("Permission Denial"). The release build is the one that matters (below) |

## Found, and fixed

Each under a test that fails without it, and seen again on the emulator.

- **A Wizard's Open decisions read "Nothing more has to be decided."** while its cantrips and spellbook were still owed
  under Spell choices, further down the same page: the desktop says so on Build and links to its Spells tab, the phone
  said nothing. It says "2 spell choices are waiting under Spell choices, below." in place of that line now
  (`spellsWaitingNote(…, 'below')`; `build-layout.test.ts`, `phone-sheet.test.ts`).
- **`package-lock.json` recorded `expo` as `^58.0.0`** where `apps/mobile/package.json` says `~58.0.26` since the upgrade;
  `npm install` rewrites it, and `npm ci` would refuse the pair. Synced.

## Found after the drive, and fixed

Fixed after the drive, each under a test that fails without the fix, and driven on the Pixel 9 Pro emulator in the SDK 58
development build (this branch's JavaScript served to it, a fresh install): a packed sample shared from Files with sample
28's save read "Added, with an Aurora save to import"; importing the save (AuroraLegacy added on the way) noted "The save
records an entry of type "Alignment" that names nothing, so it was left out." and the same for Deity; a new NPC on the
2025 Imp read Senses "Darkvision 120 ft. (unimpeded by magical Darkness); Passive Perception 11" and the creature's
spellcasting wording under Added to this character; Lose 7 on sample 07's Play hid the keyboard (`mInputShown` true, then
false) and the next tap spent a 1st-level slot; a new Elf's choices carried no "from level 1".

- **A creature's printed senses repeated their row's label**: the homebrew drake's Senses read "Passive Perception:
  tremorsense 60 ft., passive Perception 11" on the phone and in the text export. A print that names its own row is now
  written without the label (`rowLabel`); the desktop's stat block already left it off.
- **After Lose on Play the keyboard stayed up** over the trackers below it; taps meant for the spell slots landed on the
  keyboard. Lose, Regain and setting a temporary amount now put it away.
- **An import's notes quoted the save's markup**: Notes after importing sample 28 read `An <element type="Alignment">
  has neither id nor registered…`. The importer's notes that quoted tags, attributes or ids are worded for a player
  ("The save records an entry of type "Alignment" that names nothing, so it was left out."), shared with the desktop.
- **A share mixing a character and an Aurora save was titled "Some files were not added"** while nothing was refused. It
  reads "Added, with an Aurora save to import" now; a refusal among them still reads "Some files were not added".
- From rc.1: the additions' explanation on an NPC spoke of "the character's spellcasting classes" (it speaks of the
  creature's own spellcasting features now), and a decision opened at level 1 was tagged "from level 1" (no tag at 1).

## Found and not fixed (for the maintainer)

- **A written feature's line on an NPC sets where the stat starts**: Swift Digger's "burrow 10" made the drake's printed
  burrow 20 read 10 (ADR 0063's set, after a creature's print). As designed; the line was left on Sets, which is easy to
  miss.
- Android's own picker took only one of five long-pressed files in its multi-select (its behaviour, not the app's); each
  was added on its own.
- Still open from rc.1: an unsaved character on the phone is kept nowhere (after the listing, the maintainer's call).

## The release build

Built from `1ce5c18` (the fix above), `expo prebuild` run again first so the manifest is today's `app.json`'s, signed with
the throwaway key through Gradle's injected signing properties, installed fresh (the development build and its data
uninstalled: the signatures differ). Every row of the development build's table walked again; release files read by
Export › Save to a folder and `adb pull`.

| | |
| --- | --- |
| Build | 8 min 33 s; universal APK 84.7 MB (rc.1 85.7), AAB 56.0 MB (rc.1 56.4); `apksigner` and `jarsigner` verify the throwaway certificate |
| Permissions (`aapt dump permissions`) | Internet, network state, Wi-Fi state, and AndroidX's own `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`; nothing else, as rc.1 |
| Backup | `allowBackup`, `fullBackupContent` and `dataExtractionRules` in the manifest; both rule files include exactly `library/` and `SQLite/` (cloud backup and device transfer alike). A backup was not run |
| Debuggable | no (`run-as` refused) |
| Start | `am start -W` TotalTime 0.25–0.31 s cold, three runs (rc.1 measured 0.95–1.57 s the same way) |
| A share while closed | **readable**: with the app force-stopped, a `.incu` shared from Files was added ("Added Sample 07.") and an Aurora save shared with it offered for import, in one alert, "Some files were not added" over both |
| Import with no content | "Add AuroraLegacy? Importing needs content…", Add and import: downloaded, converted and imported in 43 s, "The import noted 2 things."; all 39 labelled rows of the desktop import's sheet on the phone's |
| About | Version 1.0.0, the notice, the privacy link, Ko-fi |
| Content | 14,317 entries; check for updates "none of 800 files has changed" (55 s the first time, the host cold); Monster Manual off 737 of 740 files, 14,228 entries, missing 2, and on again; switched off and on, notes back; the Aurora file, its UTF-16 copy replacing it, a second copy's overlap notes on both, Move up, Remove |
| The metered prompt | Wi-Fi off: the same question and sentence as the development build; Cancel |
| Library | samples 02, 08, 16, 19 added from Downloads (07 by the share); all labelled rows of Node's sheet on the phone's for 19 (38) and 02 (45) |
| Build, Save, Export | a High Elf Wizard 1 / Fighter 1 Sage: "3 spell choices are waiting under Spell choices, below.", Wizard cantrips 66 → 64 after Acid Splash, the die list in order, Acid Splash "DC 13 Dexterity, 1d6 acid" and Fire Bolt "+5, 1d10 fire", "5 of 4 prepared, 1 over" then 4, Hit Points level 2 Average (6), Defense, Leather bought and equipped. Exported and read in Node with no source: AC 15, HP 14, AuroraLegacy its source; every labelled row on the phone's sheet |
| Play | 5 hit points lost, a slot spent, Poisoned, a long rest; force-stopped and reopened, Poisoned still on |
| NPC and legendary | a Wolf with Alert (initiative +7), the Draconic Spirit for reference and Swift Digger (burrow 10) saved to the feature library; the Old Stone Drake with Rallying Roar beside Tail Sweep, 3 uses, its lair and regional entries, Swift Digger given as a linked copy. Both exported and read in Node with no source to the development build's sheets, each recording its source |
| Ranger, Warlock | multiclassing off and its note; Deft Explorer, Canny offering only Skill Expertise (Stealth), Chaotic Good and Mielikki "complete"; Agonizing Blast's "Needs Eldritch Blast…" on the row and the settled card |
| Unsaved changes, overlap notes, languages | Back asks Save, Discard or Keep editing; the 2024 Wizard row's shortbow note; 41 languages, no Elvish |
| Dark mode | the build page and the unsaved-changes dialog in the dark palette. A dialog already open when the system switched stays light until it closes |
| Not yet | the real phone; a Play Store upload; CI's signed build (no tag) |

### Left on the build machine

Nothing: the short-path clone and its staging folder were removed after the CMake measurement above, and the throwaway
keystore lived only in the session's scratch folder.
