# mobile-v1.0.0-rc.1 (in progress)

The phone app's first release check (ADR 0132, decision 9): every user-visible feature walked on the Pixel 9 Pro
emulator, first in the development build and then in a release build, then on the maintainer's own phone. **In progress**:
no `mobile-v` tag yet, so the release build below is a local one signed with a throwaway key, not CI's.

| | |
| --- | --- |
| Builds | development build (`expo run:android` from a short-path clone of `main`, Metro serving the checkout); release build (`gradlew :app:assembleRelease :app:bundleRelease`, a throwaway key never committed) |
| Device | Pixel 9 Pro emulator, Android 16 (API 36), x86_64 |
| Content | AuroraLegacy/elements at `0be24c4`, added from the phone over the network |
| Real phone | not yet |

## The release build, measured (before the drive)

| | |
| --- | --- |
| Size | AAB 56.4 MB; universal APK 85.7 MB (native libraries 13.3–20.4 MB per ABI, dex 7.7 MB, JS bundle 2.8 MB); about 31 MB for one arm64 phone, estimated, bundletool not run |
| Start | Hermes bytecode, no launcher or dev menu, 1.57 s cold (`am start -W`) |
| A share while closed | a `.incu` shared from Files with the app force-stopped: added and readable, its sheet Aurora's readout (AC 13, HP 7, speed 30). ADR 0099's gap was the development launcher's |
| Permissions | asked for `SYSTEM_ALERT_WINDOW`, external storage and `VIBRATE` it never used; blocked since (`app.json`), to be read again from the next release build with `aapt dump permissions` |
| Backup | Expo's `allowBackup` with no rules took the converted sources; rules since (library and settings only) |

## The development build

| Feature | Driven | What was seen |
| --- | --- | --- |
| About (ADR 0132) | yes | Version 1.0.0, the source link, the SRD 5.2.1 notice word for word, the privacy sentence and policy link, Ko-fi only |
| Content: add the suggested source | yes | AuroraLegacy downloaded and converted in 41 s; 14,317 entries; "Refers to 1 thing none of your enabled sources contain" (the upstream typo) |
| Content: check for updates (ADR 0050) | yes | "Up to date: none of 800 files has changed", 13 s |
| Content: choose parts (ADR 0055) | yes | Monster Manual off: 737 of 740 files, 14,228 entries, "1 part switched off", the line then missing 2 things; everything on again |
| Content: an Aurora file (ADR 0056) | yes | a `.xml` from Downloads through the picker: "1 file added", "A copy of homebrew-legendary.xml", 8 entries |
| Content: notes after a switch (ADRs 0052, 0090) | yes | **bug, fixed**: switching a source made the notes disappear until a Build loaded; now a switch loads a loaded system again, and the screen loads on opening |
| Content: overlaps, move (ADR 0054) | tests only | no two loaded sources share an id here; `content-sources.test.ts` holds it |
| Library: add five packed samples | yes | each sheet's checksum equal to Node's (samples 02, 07, 08, 16, 19) |
| Library: a shared Aurora save (ADR 0101) | yes | offered, imported ("noted 2 things"), its sheet equal to the desktop import's |
| Sheet (ADR 0126 on the phone) | yes | the document's order and folds; findings below |
| Play (ADR 0084) | yes | hit points lost, two slots spent, Poisoned, a long rest restoring all but the condition, each written at once |
| Export: save to a folder, and again | yes | "Saved as …", then "… (1).incu"; the file read in Node to the same sheet |
| Build: start options (ADR 0123) | yes | the dialog first, feats and multiclassing on |
| Build: required first, optional folded, arrival (ADRs 0123, 0127, 0131) | yes | optional class features and starting equipment listed with the required; the rest under "Optional (N)" |
| Build: other printings (ADR 0125) | yes | Acid Splash taken from the High Elf's pool: both printings gone from the Wizard's (66 → 64) |
| Build: overlap notes (ADR 0091) | yes | "The character already has Weapon Proficiency (Shortbow)" on the 2024 Wizard row |
| Build: languages and skills held left out | yes | no Elvish for an Elf, no Arcana or History after Sage |
| Build: spell choices heading (ADR 0124), preparing (ADR 0046) | yes | "Spell choices (3)"; "5 of 4 prepared, 1 over", taken back to 4 |
| Build: starting equipment (ADR 0087) | yes | the Wizard's and the Sage's packages taken; the Wizard's crossbow line is AuroraLegacy's own text |
| Build: spell attacks (ADR 0111) | yes | **bug, fixed**: the die list read d10, d12, d4, d6, d8; Acid Splash "DC 13 Dexterity, 1d6 acid", Fire Bolt "+5, 1d10 fire" |
| Build: level up in another class (ADR 0036), per-level hit points | yes | Wizard 1 / Fighter 1, the level 2 card on a d10, average 6; HP 14, Defense |
| Build: buy and equip (ADR 0098), grouped list (ADR 0117) | yes | Leather bought for the purse's 10 gp and equipped: AC 15 |
| Build: an NPC on a creature (ADRs 0057–0062) | yes | a Wolf: CR 1/4, AC 13 (natural armor), HP 11 (2d8+2), speed 40, Perception +3, Stealth +4 |
| Save and read back | yes | every saved character read in Node with no source: the sheet the phone logged |
| Build: an NPC's addition, reference and written feature (ADRs 0063, 0064, 0068) | yes | a Giant Badger with Alert (initiative +5), the Draconic Spirit kept for reference, and "Swift Digger: burrow 10"; saved, read in Node with no source to the phone's checksum |
| The feature library (ADR 0106) | yes | the feature saved to the library (`incudo-features.json` read back), given to the Wolf, saved: **bug, fixed** (below) |
| Build: a legendary creature (ADR 0065) | yes | the homebrew file's Old Stone Drake: Rallying Roar taken beside the Tail Sweep it grants, 3 uses, its lair action and regional effect; the sheet equal to Node's with no source. **Bug, fixed**: no phone save recorded its sources (below) |
| Build: a 2014 Ranger with multiclassing off (ADRs 0088, 0116, 0129) | yes | "Multiclassing is switched off for this character…"; Deft Explorer taken, its Canny expertise offering Stealth once Stealth was taken; Chaotic Good and Mielikki "complete". Not saved: a development reload lost it (below) |
| Content: a UTF-16 file, overlaps, move, remove (ADRs 0054, 0056) | yes | **bug, fixed**: picked from Downloads it arrived as "msf:52" and was refused; added as "Homebrew Legendary Test.xml", 8 entries, both copies saying they define the same 8 things; moved up; removed, its note gone |
| Content: the metered prompt (ADR 0100) | yes | Wi-Fi off: "Refresh AuroraLegacy? … on a metered connection"; on Wi-Fi no question, "Refreshed: 800 downloaded." |
| Not yet | — | a soft requirement (a Warlock's invocations, ADR 0124) |

## Found, and fixed after the first pass

Each under a test that fails without it, and seen again on the emulator.

- The sheet printed every section's explanation in full; it is behind an "i" now, as on the desktop
  (`phone-sheet.test.ts`).
- "Damage not set: choose its dice on Build, under Spells" named the desktop's tab; both warnings name the heading both
  apps put the editor under, "Spell attacks" (`spell-attacks.test.ts`).
- A "Spells" tab heading sat right above the "Spells" section; a tab whose first section has its name is not headed
  again (`sheet-layout.test.ts`).
- An NPC's and a legendary creature's Creature pick was folded under "Optional"; 5e lists it with the required decisions
  (`listedWithRequired` on the step; `listed-with-required.test.ts`). The desktop changes with it.
- "Equipment: nothing to choose" after both starting packages were taken; a taken package makes its step "complete"
  (`starting-equipment.test.ts`).
- A challenge rating printed "0.25"; a unit fraction is written 1/4 on every sheet (`sheet.test.ts`).
- "opened at 1" on a Fighter level taken at character level 2 named the class's own level; the tag is "from level 2",
  the character's, as the list is ordered (`build-view.test.ts`).
- A speed written on a creature that its print does not name was shown nowhere: a stat block's Other Speeds went
  whenever the walking speed matched the print. The print covers the section now only when it names each speed shown
  ("burrow 10"); of the 141 creatures, the two Drake Companions now show the fly 40 their content gives
  (`sheet-stat-block.test.ts`). The desktop changes with it.
- A file picked from Android's Downloads arrived named "msf:52" and the Content screen refused it as "not an .xml file".
  A name with no extension is decided by what the file holds, and an elements file takes the name its own `<info>` gives
  (`source-parts.test.ts`).
- No character the phone saved recorded the sources it draws on (`"sources": []`), so "not in your sources" could never
  be said of one: the phone never told its library the profile. It does now (`keepLibraryProfile`,
  `content-sources.test.ts`, `phone-sheet.test.ts`); a re-saved drake records its file source.
- Before a class is chosen the level control said "Further levels can then go to other classes", false with multiclassing
  off; it says "Choose a class in Open decisions." in both apps (`phone-sheet.test.ts`).

## Found and not fixed (for the maintainer)

- **An unsaved character on the phone is kept nowhere.** The desktop keeps a draft (ADR 0066); the phone keeps the build
  in memory until Save, so Android ending the app in the background (or a development reload, which is how it was found,
  twice) loses it. Worth a decision before the listing.
- The additions' explanation on an NPC speaks of "the character's spellcasting classes".
- A level 1 decision is tagged "from level 1", which says nothing at the first level.

## The release build

Not yet driven feature by feature: only the measurements above.
