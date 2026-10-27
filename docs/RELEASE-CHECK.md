# Checking a release candidate

Every release candidate is checked against this list before its draft is published, by a person with the installer
from the draft and by a drive of the installed app, step for step. Two checks of one build can then be compared, and
so can the checks of two builds. ROADMAP Phase 9 is where this was asked for.

**What it covers.** 1.0 is the desktop release, and the Windows installer is the one this list checks. The release
workflow also builds macOS and Linux installers; nobody drives those, and their record says "built, not run". The phone
app follows 1.0 and is not in this list.

**Who checks what.** Each step says who can check it:

- **Drive and person**: the drive (`tools/verify/src/release-check.test.ts`) does it and reads every number below off the
  installed app, and the person does it too.
- **Person only**: what no drive can see: SmartScreen's wording, the installer's own screens, real keys and a real mouse,
  how the window looks and reads, and uninstalling.

A step passes when the app shows what the step says: a number, or a sentence on screen, as written here. "Looks right"
is not a result. When a step fails, write what the screen showed instead.

**When a number here changes on purpose** (the Sheet is reworded, the corpus moves upstream), change it here. The drive
reads the readings table below from this file, so this file and the drive cannot disagree.

## Running the drive

The drive starts the installed `incudo-desktop.exe` on a scratch WebView2 profile and a scratch library folder, both in a
new folder under the system's temporary folder, with the debug port open. It never touches your own profile or library.
It drives the page over the debug port and the native file dialogs by window messages, so it needs no keyboard or
mouse and can run with the window behind others. It needs the network (it downloads the suggested source) and takes
about three minutes.

1. Install the candidate from its draft release.
2. Put the installed executable's path in `.env.local` at the repository root (never in a committed file):
   `INCUDO_INSTALLED_APP="<the folder Incudo installed into>\incudo-desktop.exe"`. The per-user installer puts it under
   your local application data folder, in `Incudo`.
3. Run it alone (it also runs in `npm test` while the variable is set):

   ```bash
   node --env-file-if-exists=.env.local --test --experimental-strip-types tools/verify/src/release-check.test.ts
   ```

With the variable unset the test skips and says how to run it. Set to a path that is not there, it fails. It never runs
in CI: a runner has no installed build and no screen.

It prints where its run folder is. The folder holds `report.md` (every step below with what the drive saw), the text and
PDF exports, the scratch library and the profile. If `pdftotext` is on the path the report also says whether every word
of the text export is in the PDF.

## Recording a check

A candidate's check is recorded as a file per tag, `docs/release-checks/<tag>.md`, committed with the tag's other notes:
which build, on which platform, each step below with its result, and who checked it (a person or the drive). Copy the
drive's `report.md` into it, then add the person's results beside it. The draft's release notes may link to it.

## The steps

### 1. Install

**Person only.** Run the `-setup.exe` from the draft.

- SmartScreen says "Windows protected your PC" and names an unknown publisher: the build is unsigned, as the draft's
  notes say. "More info", then "Run anyway", starts the installer.
- The installer's screens name Incudo and its version, X.Y.Z of the tag, and it installs without an error.
- A Start menu entry named Incudo opens the app.

### 2. First launch on a fresh profile

**Drive and person.** Start the installed app with no profile of its own (the drive uses a scratch one; a person may use
a fresh Windows account, or remove the app's WebView2 folder first).

- The window opens on "Choose a system", listing "Dungeons & Dragons 5th Edition" and "Cairn".
- Settings reads "Version X.Y.Z", the version of the tag (the drive compares it with `tauri.conf.json`).
- *Person:* the window opens at its full size, with the icon in the title bar and the taskbar, and no white flash.

### 3. Choose a system and a library folder

**Drive and person.** Choose Dungeons & Dragons 5th Edition, then a library folder.

- The header reads "Dungeons & Dragons 5th Edition · no sources for this system".
- The Characters screen names the folder and offers "New character" and "Import from Aurora…".
- *Person:* the folder dialog opens, and choosing an empty folder shows it with no characters. (The drive writes the folder
  into the profile instead of driving this dialog.)

### 4. Add the suggested source

**Drive and person.** On Sources, press Add on the suggested AuroraLegacy, then at once go to Characters and press New
character.

- While it loads, Build and Browse show "Loading content" with a count of files that rises, never an empty build.
- When it ends, the campaign options open by themselves, every option named (no `ID_…` on screen), with "Start
  building" and "Cancel". Press Start building.
- The source's line on Sources reads "· N entries from F files", "Refers to U thing(s) none of your enabled sources
  contain" and "W warning(s)", within the corpus budget (`RECORDED_BUDGET` in `tools/verify/src/corpus.ts`, held to
  `ci.yml`): F at least 740, N at least 14,316, U at most 1, W at most 57. On 2026-10-27 it read 14,320 entries from 740
  files, 1 thing, 57 warnings.

### 5. Build a named character through every kind of decision

**Drive and person.** A Hill Dwarf Wizard 3, so that every kind of decision is answered once:

- **Ability Scores** (a budget): Enter manually, 8, 14, 15, 15, 12, 10 in order, then Done.
- **Race, Dwarven Subrace, Class, Background** (picks): Dwarf (Player's Handbook), Hill Dwarf, Wizard (Player's
  Handbook), Sage (Player's Handbook).
- **Selects from content**: Dwarven Tool Proficiency (the first offered), Language (Sage) twice, Personality Trait twice,
  Ideal, Bond, Flaw (the first offered each time), Skill Proficiency (Wizard): Investigation and Insight.
- **Starting equipment** (alternatives, then Take): from Wizard, Quarterstaff, Component Pouch, Scholar's Pack and Light
  Crossbow, Crossbow Bolt ×20; from Sage, Take.
- **Spells tab**: cantrips Fire Bolt, Mage Hand, Prestidigitation; spellbook Find Familiar, Mage Armor, Magic Missile,
  Shield, Sleep, Detect Magic (all Player's Handbook).
- **Build tab**: Find Familiar's creature, Owl (Player's Handbook); "Level up to 2", "Level up to 3"; Arcane Tradition,
  School of Evocation; Hit Points, level 2 and level 3, Average (4) and Done.
- **Spells tab**: spellbook Burning Hands, Thunderwave, Misty Step, Scorching Ray; prepare Mage Armor, Magic Missile,
  Shield, Burning Hands, Misty Step: the count reads "5 of 5 prepared".
- **Name** (a text field): Release Check.
- Optional decisions (Alignment, Deity, Optional class features, Variant Feature, Specialty) are left as they are, and
  Build lists no required decision once all of this is done.

The readings table below is what its Sheet must read.

### 6. Save

**Drive and person.** On Build, "Save to library".

- The library folder holds `release-check.incu`, and the Characters screen has a card "Release Check", "Player Character ·
  Level 3".

### 7. Export as text and as PDF

**Drive and person.** On the Sheet, "Export sheet as text…" and save; then "Export sheet as PDF…", Export… on its step,
and save.

- The text file holds every reading in the table below, as `- Label: value`.
- The PDF has one page or more (7 on 2026-10-27), and every word of the text export is in it.
- *Person:* the PDF opens in a reader, two columns of sections, nothing cut off at an edge.

### 8. Print through its step

**Drive and person.** On the Sheet, "Print sheet…", then Print… on the step.

- WebView2's print preview opens, counting its sheets (7 on 2026-10-27), and offers no headers-and-footers option.
  Cancel closes it and the app answers again.
- *Person:* press Ctrl+P on the Sheet with real keys: the step opens. On Build, Ctrl+P opens nothing.

### 9. Reopen with every source off

**Drive and person.** On Sources, switch AuroraLegacy off; on Characters, Open "Release Check".

- The Sheet is identical, character for character, to the Sheet before (16,795 characters on 2026-10-27).

### 10. Import a named sample

**Drive and person.** Switch AuroraLegacy on again and wait for it to load. On Characters, "Import from Aurora…" and
choose the sample save that is a 2014 Fighter 5 in plate and shield (`sample-09-fighter-5-plate-shield.dnd5e` in
`tools/verify/fixtures/saves/`, "Sample 09" in its manifest).

- Characters reads "1 of 1 imported", and a card "Sample 09", "Player Character · Level 5", with no "Not in your
  sources" line.
- Its Sheet reads Armor Class, Hit Points and Speed as `manifest.json`'s readout for it, the numbers the maintainer read
  off Aurora's screen: 21, 44 and 30. The drive exports its sheet as text and reads them there.

### 11. Browse

**Drive and person.** On Browse, type "fireball".

- The first result is named "Fireball".

### 12. The menus

**Drive and person.** The native menu bar.

- File, View and Help hold, in order, the labels of `MENUS` in `packages/ui/src/commands.ts`, each followed by its
  shortcut (the drive compares the labels).
- View → Browse opens Browse (the drive sends the item's click by a window message).
- *Person:* each menu opens with the mouse, a greyed item does nothing, and Ctrl+1 to Ctrl+5 with real keys move between
  Characters, Build, Sheet, Sources and Browse.

### 13. Switching system

**Drive and person.** Press the system's name in the header, then Cairn.

- The header reads "Cairn · no sources for this system", and Characters says the folder's 2 Dungeons & Dragons 5th
  Edition characters belong to another system.

### 14. How the window looks

**Person only.** Over steps 2 to 13.

- Text is readable at the window's size, nothing overlaps, light and dark follow Windows' setting, and the title bar
  names Incudo.

### 15. Uninstall

**Person only.** Settings → Apps → Incudo → Uninstall.

- The uninstaller runs and Incudo leaves the Start menu and the apps list. The library folder and its `.incu` files are
  still there.

## Readings

What the Sheet of step 5's character must read, as its text export writes each row (`- Label: value`). Step 10's sample
is held to `manifest.json`, not to this table.

| Character | Reading | Passes when it reads |
| --- | --- | --- |
| Release Check | Armor Class | 12 |
| Release Check | Hit Points | 26 (including Dwarven Toughness) |
| Release Check | Speed | 25 |
| Release Check | Spell Save DC | 12 |
| Release Check | Spell Attack Bonus | +4 |
| Release Check | 1st-level Spell Slots | 4 |
| Release Check | 2nd-level Spell Slots | 2 |
| Release Check | Passive Perception | 11 |
| Release Check | Unarmed Strike | +1, 0 bludgeoning (range 5 ft) |
| Release Check | Fire Bolt | +4, — (range 120 feet). Damage not set: choose its dice on Build, under Spells. |
