# 0086 — A phone builds and edits with the desktop's builder, its content loaded when a build opens

**Status:** Accepted · 2026-10-03 · answers ROADMAP Phase 6's "Full build flow" · builds on
[0012](./0012-self-contained-saves.md), [0017](./0017-open-decisions-not-steps.md),
[0027](./0027-a-library-is-a-folder.md), [0028](./0028-sources-are-a-profile-characters-carry-an-allowlist.md),
[0031](./0031-a-system-is-chosen-and-it-scopes-everything.md), [0032](./0032-a-build-step-may-offer-a-set.md),
[0083](./0083-the-phone-app-is-expo-in-the-workspace-its-storage-is-sqlite-and-its-library-is-its-own-folder.md),
[0084](./0084-play-state-is-an-input-on-the-character-and-what-it-tracks-is-read-from-the-sheet.md),
[0085](./0085-a-source-is-kept-converted-into-incudo-s-own-form-and-loaded-from-that.md) · **format:** none

## Context

The phone reads a character's sheet and plays it (ADRs 0083, 0084), from the file alone. Building one is the desktop's
`CharacterBuilder` over loaded content, and the phone had no content. Three questions were open: how a phone gets
content, whether it builds new characters or edits existing ones, and how a build edit is saved, since play writes at
once by replacing `character.json` and a build edit changes what the file embeds.

### Measured first

`tools/verify/src/mobile-build.test.ts` (report-only), in Node on this machine, AuroraLegacy/elements at `c28ce6c`:

| question | answer |
|---|---|
| files not UTF-8 (Hermes has no UTF-16 `TextDecoder`, ADR 0083) | none: 804 UTF-8, 14 UTF-8 with a BOM |
| a full load | 740 files, 14,320 elements, about 51 MB of heap |
| a fresh character, by kind | 5e player character: 12 steps, 5 open (3 picks, a budget, a set), the longest list 139; NPC and legendary creature: longest list 204; Cairn: 3 open. One pick re-derives in 9–17 ms |
| the thirty samples | open decisions: 129 selects and 59 sets; every sample shows class levels, a budget, hit points, books, additions and references, 13 a prepared list, 6 something not held; the longest list a decision offers 139–308 |
| opening a sample's builder | 23–235 ms (median 67) |
| `packCharacter` and fflate's zip, per sample | 30–102 ms (median 43), 29–93 KB |

On the Pixel 9 Pro emulator (Expo Go, a probe run once and not committed): AuroraLegacy from the network 82 s and from
the raw cache 15 s, the JS heap 16 → 60 MB; a player character's builder made in 90–270 ms, one pick 80–85 ms.

## Decisions

1. **Content is the system's suggested source, added with one tap, downloaded in full, and loaded when a build opens**
   (the maintainer's choice). A Content screen lists each shipped game's `suggestedSources` (5e: AuroraLegacy) and the
   sources added; Add asks whether to keep it converted or as files (ADR 0085, which this question started: the maintainer's
   answer was that a source should be converted into Incudo's own form, with the files as the choice for a user sparing
   space). A source can be switched off and on, refreshed, kept the other way, and removed, **with what it kept on the
   device** (on a phone the space is the point). Content is asked for by the Build screen, never at the app's start: reading
   and playing need none. An index URL of the user's own, parts switched off and Aurora files added from the phone are
   left for later; the profile is the desktop's `SourceProfile`, so nothing about them is ruled out.

2. **New characters and existing ones, on one screen** (the maintainer's choice). New character offers every kind of
   every shipped game (`characterKindChoices`); a sheet's Edit opens the same Build screen on its file, the file's own
   content in front of the loaded sources as on the desktop (`LayeredElementIndex`), so nothing it carries is silently
   replaced.

3. **A build edit is saved with Save** (the maintainer's choice), as on the desktop: the whole file packed again by
   `CharacterLibrary.save`, refused when the file changed since it was read (ADR 0027). Leaving with something unsaved asks
   Save, Discard or Keep editing. A new character's first Save names its file after it; later Saves write to that file
   whatever it is renamed to. `edit-session.ts` (`beginEdit`, `hasUnsavedChanges`, `saveEdit`) holds what a Save needs
   between edits: the entry, the `updated` last read there, the file's assets, and the character as last saved.

4. **Every part of the build is on the phone** (the maintainer's call: "I don't see any option that it wouldn't have").
   Offered a list of what could wait, they kept books and the skipped and not-held lists in this release. In: the decisions
   list, a full-screen searchable picker with each option's own text a tap away, choices made (each slot changeable, a
   set's removable), ability scores by every method, hit points per level, class levels (adding a level in any class, and
   changing what a level went to), prepared lists, books, skipped decisions (Reconsider) and what is not held. **Left for a
   second pass** (the desktop has each): features of the user's own and what a creature gives (ADRs 0061, 0063, 0067),
   additions (ADR 0064), references (ADRs 0068, 0070), the class split editor (ADR 0045's other input; adding and changing
   levels covers multiclassing), the progress control's "use the creature's" link.

5. **One copy of every word and rule a build screen shows, in `packages/ui`.** The desktop's panes had kept a few to
   themselves; they moved to `build-view.ts` and both shells call them: what one slot of an answered decision may change to
   (two slots never agreeing unless the answer repeats, ADR 0035), which steps are settled, a decision's tags, a step's
   status, a class option's groups and reasons, a prepared item's line. `content-sources.ts` (`ContentSources`) is the
   phone's sources: a store with `subscribe`/`getState`, as `CharacterLibrary` is. The phone's screens compute nothing.

6. **The sheet reopens its file when it is shown again**, so a character saved from the Build screen reads as saved, and
   Edit waits for any play edit still being written (`useRecorder` returns the wait), so the Build screen opens the file
   as it is and its Save is not refused over the phone's own play.

## What was built

- `packages/content`: `loadSources`, moved from `apps/desktop/src/content.ts` (ADR 0085).
- `packages/ui`: `build-view.ts`, `content-sources.ts`, `edit-session.ts`, each with tests naming the perturbation that
  fails each case; the desktop's `BuilderPane`, `ClassLevels` and `PreparedSpells` call `build-view.ts`.
- `apps/mobile`: `context.ts` (the platform and the screens' names), `controls.tsx`, `Picker.tsx`, `BuildParts.tsx`
  (scores, hit points, class levels, prepared lists, books), `BuildView.tsx` (memoized), `BuildScreen.tsx`,
  `ContentScreen.tsx`, and in `App.tsx` New character, the library's Content button, the sheet's Edit and its reopening on
  focus, and a development log of each content load's time. `MobileStorage.apply` (ADR 0085).

## Driven

On the Pixel 9 Pro emulator in Expo Go, by `adb` taps (not a person's hands):

- **Content:** AuroraLegacy added as converted; switched to files and back; refreshed. A load with the Build screen open
  after a restart: 2.3 s and 2.4 s converted, 6.6 s and 6.8 s as files (ADR 0085 has the rest).
- **A new character:** Player Character; Race through the picker's search ("dwarf", the two Player's Handbooks told apart
  by book, one's text read through Details), the Dwarven Subrace it opened beside it, Class, a second level through
  Add level (the picker naming each class's unmet minimum, "needs Intelligence 13 (you have 10)", and the classes not
  available said below), the first level's hit points, Background, both language slots of Acolyte, a personality trait,
  a rename; Back with changes asked Save, Discard or Keep editing; Save wrote `sample-built.incu`; the library listed it at
  Level 2. Edited again from its sheet: the second level's hit points set to the average, scores by the standard array
  (Constitution 14 + 2 = 16, the pool naming which score holds which value), Save again with no conflict.
- **An existing character:** a sample opened from the library, Edit (Save greyed: opening changed nothing), its level
  raised to 6, Back, Save in the prompt; the sheet reopened at Barbarian 6 (6d12), 66 hit points.
- **The same file on both:** both files exported through the phone's folder picker and read in Node with the desktop's
  code and no content source: the sheet's SHA-256 equal to what the phone logged for each, byte for byte.

**Found by driving, not by a test:** the Build screen rendering itself in a loop until React stopped it, because
`ContentSources.restore` published a new list each time and the screen's effect restored and then depended on that list
(fixed in the view-model, held by a test); the Build screen taking 20 s for a 2.4 s load, drawn again for every progress
report (the build view is memoized, and progress is reported at most five times a second); and the two content findings
of ADR 0085.

**Not run:** a real phone, iOS, a development or release build; an NPC, a legendary creature or a Cairn adventurer built
on the phone (each opens, and its parts are the same renderers); a source refreshed or removed with the network off; a
Save refused as a conflict on a device (held by `edit-session.test.ts`).

## Consequences

- The phone builds what the desktop builds, with the same builder and the same content, and writes the same file: a
  character started on one can be finished on the other.
- Content is about 20 MB on the device for AuroraLegacy converted (15 as files), and a first download is a minute or
  more on a slow connection. "Download mode as the default on metered connections" is the next Phase 6 item to look at it.
- Each build edit re-derives the character, tens of milliseconds on the phone, and the name field writes a moment after
  typing stops for that reason.
