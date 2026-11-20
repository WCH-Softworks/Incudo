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
| Not yet | — | the legendary creature, additions, references, written features and the feature library, alignment and deity, Tasha's optional class features on a Ranger, a soft requirement (Warlock), multiclassing off, a refresh, Remove, the metered prompt, a UTF-16 file |

## Found and not fixed (for the maintainer)

- The sheet prints every section's explanation in full; the desktop puts it behind an "i".
- "Damage not set: choose its dice on Build, under Spells" names the desktop's Spells tab; the phone's heading is
  "Spell choices".
- A "Spells" tab heading sits right above the "Spells" section.
- An NPC's Creature pick is folded under "Optional" (ADR 0123's rule), though it is the main choice of an NPC. The desktop
  folds it too.
- "Equipment: nothing to choose" after both starting packages were taken.
- A challenge rating prints "0.25" on the sheet, where a book prints 1/4.
- "opened at 1" on a Fighter level taken at character level 2 is the class's own level (ADR 0015), and reads oddly.

## The release build

Not yet driven feature by feature: only the measurements above.
