# 0084 — Play state is an input on the character, and what it tracks is read from the sheet

**Status:** Accepted · 2026-10-02 · answers the "play" half of ROADMAP Phase 6's "Character sheet — read and play first" ·
builds on [0006](./0006-derived-character-state.md), [0007](./0007-native-formats.md),
[0012](./0012-self-contained-saves.md), [0027](./0027-a-library-is-a-folder.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0074](./0074-a-kind-s-sheet-shows-its-printed-page-and-every-row-says-what-it-is.md),
[0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md),
[0076](./0076-content-s-sheet-hints-are-read-every-description-kept-chosen-by-the-level-the-element-gates-at.md),
[0079](./0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md),
[0083](./0083-the-phone-app-is-expo-in-the-workspace-its-storage-is-sqlite-and-its-library-is-its-own-folder.md) ·
**format:** character format **8** (`play`, only when recorded); system format gains an optional `play` on a character
kind (`formatVersion` stays 1)

## Context

The phone shows a character's sheet (ADR 0083). Playing one is keeping, during a session, what no formula produces: hit
points lost and temporary ones, spell slots spent, limited uses of features spent, and what a rest gives back. ADR 0006
stores choices and never derived numbers; its exceptions are inputs with no formula (`rolls`, `baseStats`, `inventory`).
How much damage a character took is the same kind of thing.

### What was measured first

`tools/verify/src/play-state.test.ts`, report-only on the base commit, against AuroraLegacy/elements at `c28ce6c` and the
thirty samples:

| question | answer |
|---|---|
| what an Aurora save records of play | **nothing.** The samples hold 87 distinct element names; none is a current or temporary hit point, a spent slot, a death save, an exhaustion level or a condition (`<conditional>` is an empty defences block in every save). `<slots>` carries `s1`..`s9`, the **totals** (the oracle already compares them). So the frozen importer (ADR 0008) drops no play state, because there is none to drop. |
| what content's `usage` hints say | 968 usages. **632 are a count per rest or per day**: `N/Long Rest` 259, `{{stat}}/Long Rest` 251, `N/Short Rest` 87, `{{stat}}/Short Rest` 15, `N/Day` 13, `N/Short or Long Rest` 3, and a few spellings (`N/Long Rest.`). 244 are a resource's name with no count (`Channel Divinity` 71, `Channel Arcana` 26, `Superiority Die` 20, `Ki` 15, `Sorcery Point` 9, …): spending from a pool another element states. 92 are something else (`N/Turn` 42, `N/Round` 9, `NdN Long Rests`, `Recharge 5–6`, dice per rest). |
| what the samples would track | on the Features & Traits section: 25 listed elements whose filled usage is `N/Long Rest`, 14 `N/Short Rest`, 10 `N/Turn`; 27 with a resource's name or prose. 21 samples have slots (shared pool, per block, and pact magic beside a pool). |
| pools content publishes as a stat and no usage | Ki points (`ki:points`), 2024 Focus Points (`monks focus:points`), Sorcery Points under two names (`sorcery-points`, `sorcery points:amount`), superiority dice (`superiority dice:amount`), psi points. Their features write the number into sheet **text**, never a usage. |
| how pact magic differs from other slots | content's Warlock grants `ID_INTERNAL_GRANT_MULTICLASS_SPELLCASTING_SLOTS_SOLO`, which 5e's system turns into `{name}:spellcasting:solo` = 1 on that block (ADR 0041). Nothing else does. |

## Decisions

1. **Play state is `Character.play`, an input in ADR 0006's sense, in `character.json`** (the maintainer's choice, over a
   separate file in the container and over device-only storage). `{ spent?, temporary?, conditions? }`: per tracker key,
   how much is spent (or counted) and a temporary amount; and the conditions set. Absent when nothing is recorded; zeros
   are never written. **Character format 8**, raised only by a write that records play (`setPlayState`), never lowered;
   the validator refuses `play` below 8, and the schema refuses a zero or a fraction. It travels with the file, so the
   same `.incu` opens to the same play on the desktop and the phone. It is **not** a derivation seed, not embedded
   content, and not in `summarize()`: nothing it records moves a derived number, and a play edit does not re-derive.

2. **A kind declares what is played** (`play` on a character kind, system format, optional, replaced along `extends`):
   `rests` (id, label, `includes`, and `usage` templates such as `"{count}/Long Rest"`), `trackers`, and `conditions`
   (names only). A tracker names exactly one source of its maximum:
   - `stat`: a stat the character publishes above zero (hit points, Ki Points);
   - `rows`: every row a sheet section shows above zero, per block for a `perBlock` section (spell slots);
   - `dice`: the dice a sheet section writes beside each track (`trackDie`, ADR 0079: hit dice per class);
   - `uses`: the listed elements of some sheet sections whose usage, as the sheet writes it with its placeholders filled
     (ADR 0076), reads whole as one of a rest's `usage` templates. That rest gives it back;
   - `max`: a fixed number (death saves, exhaustion, inspiration).
   A tracker may `count` (recording how many, shown as is) rather than spend, may name a `temporary` amount spent before
   it, and says what each rest gives back: all of it, an `amount`, or a `fraction` of its group's total maximum, at
   least a `minimum`. A `rows` tracker over a per-block section may give a block publishing a stat (`{name}` the block)
   different restores (`restoresWhen`): pact magic comes back on a short rest. The validator refuses a rest or section
   nothing declares, a tracker with no or two sources, a `dice` section with no `trackDie`, and a restore naming no rest.

3. **Every maximum is read from the sheet, never worked out again.** `playView` (`packages/ui/src/play.ts`) reads the
   kind's `play` against `SheetView` and the derivation's stats: a slot row's maximum is the number on that row, a use's
   is the count in its usage. So play cannot disagree with the sheet, and nothing in `core` or `packages/ui` names a rest,
   a resource, a condition or a game: 5e's names live in `systems/dnd5e/system.json`. A usage that is not a count per
   rest ("1/Turn", "Channel Divinity", a dice pool) is shown on the sheet as before and not tracked. **A recorded key the
   view does not show is kept**: a character who loses a level and gets it back finds what it had spent.

4. **Edits are pure functions of the character and the view** (`adjustPlay`, `setPlaySpent`, `setPlayTemporary`,
   `setPlayCondition`, `restPlay`), and the builder's methods of the same names call them. Spending takes from the
   temporary amount first and stops at the maximum; giving back leaves the temporary amount alone; setting a temporary
   amount replaces it. A rest gives back what it and every rest it includes give back; giving back all of a tracker also
   clears its temporary amount; a fraction is shared over its group in the order shown. A rest leaves conditions alone.
   A play edit in the builder keeps the derivation (the same object) and makes only the play view again, so a tap on a
   phone does not re-derive the character.

5. **5e's declaration.** Rests: Short Rest (`{count}/Short Rest`, `/Short or Long Rest`, `/Long or Short Rest`) and Long
   Rest, which includes it (`{count}/Long Rest`, `/Long Rest.`, `/Day`: content's per-day uses come back after a long
   rest, which is the system author's reading of "at dawn"). The player character tracks hit points with Temporary Hit
   Points (back on a long rest), hit dice (half the total, at least one, on a long rest), the shared slot pool and each
   block's slots (long; a block with `{name}:spellcasting:solo` short), limited uses in Features & Traits, Ki and Focus
   Points (short), Sorcery Points under both names and Psi Points (long), Superiority Dice (short), Inspiration (a count
   of one, given back by nothing), death save successes and failures (counts of three, cleared by a short rest or by
   hand; regaining hit points clearing them is not modelled), exhaustion (a count of six, one fewer per long rest), and
   the fourteen conditions. The NPC tracks hit points, its traits', actions', reactions' and features' uses, exhaustion and
   conditions; the legendary creature adds Legendary Actions, given back by a rest of its own, "Start of Its Turn".

6. **The phone writes a play edit back to the library file at once** (the maintainer's choice, over an explicit Save),
   half a second after the last tap and when the screen is left. `CharacterLibrary.record` replaces `character.json` and
   the manifest's name, `updated` and checksum, and nothing else: `content.json` and every asset keep their bytes
   (`replaceContainerCharacter` in `core`). It is refused, as a save is (ADR 0027), when the file's `updated` is not
   what was read; the phone then says so and stops writing. Only that entry is read again, not the whole folder.

7. **The desktop shows and edits it too** (the maintainer's choice). The Sheet pane has a Play section drawn from the same
   `PlayView`; an edit goes through the same builder methods, and reaches the file on Save, as every other edit does
   there, the draft keeping it meanwhile (ADR 0066).

8. **The sheet document is unchanged.** Play is not in `sheetDocument`, so the text export, the print and the PDF are
   what they were, and the sheet a phone reads stays byte-identical to the desktop's for the same file. A printed sheet is
   the table's, with its boxes for what is spent left as the rules print them.

## What was built

- `core`: `Character.play` and `PlayState`, `setPlayState` (drops zeros, raises to 8), format 8 in the schema and
  `LATEST_CHARACTER_FORMAT_VERSION`, the validator's format check; `PlayDef`, `RestDef`, `TrackerDef`, `RestoreDef`,
  `ConditionsDef` on a kind, resolved along `extends`, with `checkPlay`'s referential checks; `replaceContainerCharacter`.
  No game noun.
- `packages/ui`: `play.ts` (`playView`, `readUsage`, the five edits, and the wording every screen shares: `playValue`,
  `playTemporaryText`, `playRestNote`, `restEffects`); `BuilderState.play` and the builder's `adjustPlay`,
  `setPlaySpent`, `setPlayTemporary`, `setPlayCondition` and `rest`, which keep the derivation; `CharacterLibrary.record`.
- `systems/dnd5e/system.json`: decision 5's declarations for `pc`, `npc` and `legendary`.
- `apps/mobile`: Sheet and Play tabs on a character, `PlayPanel.tsx`, and the writer (`useRecorder` in `App.tsx`).
- `apps/desktop`: `PlayPanel.tsx` on the Sheet pane, hidden in print.
- Tests: `packages/ui/src/play.test.ts` (each case naming the perturbation that fails it; six were run and fail as
  named), `character-library.test.ts` (`record` keeps every other byte and honours the conflict check),
  `tools/verify/src/schemas.test.ts` (format 8; every `checkPlay` refusal), and `tools/verify/src/play-state.test.ts`:
  the report above, and, against any corpus, every sample's hit points, slot rows and uses equal to its sheet's, a play
  edit deriving nothing, and the play view equal after a pack and a reopen with no source (30 samples, 284 trackers;
  removing 5e's block-slot or uses tracker fails it). The oracle and every sheet test are unchanged.

## Driven

- **Phone**, the Pixel 9 Pro emulator in Expo Go, by `adb` taps: three samples packed in Node were added through
  Android's picker. A Wizard 3 / Rogue 3 / Warlock 3: 5 temporary hit points, 12 lost (53 to 46, the temporary ones
  first), a pool slot and a pact slot spent, Prone set; a short rest asked "Gives back: Spell Slots — Warlock" and gave
  back only that; each edit was written within a second (the app's dev log). Left and reopened: the same play.
  Exported to a folder and read in Node: `content.json` byte-identical to the file added, `character.json` format 8 with
  the play, no container problem, and the same sheet checksum the phone logged. A Barbarian 5: Rage spent, one
  exhaustion, a long rest gave both back and the file recorded no play.
- **Desktop**, the browser build with an origin-private folder as the library: that exported file opened to the same
  play on the Sheet; 10 more lost, saved to the library, opened again from it at 36 of 53; a long rest asked about hit
  points and slots, gave them back, and left Prone.
- Driven in the Tauri window on Windows (2026-10-20; a fresh WebView2 profile and a scratch library folder, DOM events over the debug port, real keys and mouse where marked): a sample opened with no source lost 12 hit points and spent two slots, a short rest gave back neither, and
  a real Ctrl+S wrote `play` at format 8, read back from disk; a legendary creature's actions were spent and given back
  by the start of its turn and its hit points by a long rest (each rest asks first, then acts).
- **Not driven:** a real phone, iOS, and the conflict refusal on a device (held by the library test).

## Consequences

- A character saved with any play recorded is format 8; an older Incudo refuses it rather than dropping the play without
  a word. A character with nothing spent stays at whatever version it was.
- Every tap on a phone rewrites `character.json` in the file. A library in a sync folder sees the file change during a
  session; ADR 0027's conflict check is what stops a phone and a desktop silently overwriting each other.
- What content writes as a resource's name ("Channel Divinity", "Ki") is not linked to its pool: spending a Channel
  Divinity option does not spend Channel Divinity. Linking by name is the guess ADR 0005 rules out; the pool is tracked
  on its own element, and the player spends it there.
- `N/Turn` and `N/Round` are not tracked: no rest gives them back, and a turn tracker on a character sheet is a
  combat tracker, which this is not.

## Alternatives considered

- **Play beside `character.json` in the container** (`play.json`). Keeps the character's file untouched by play, but is a
  container format change, a second file to keep consistent, and a second reader in every app. Declined by the
  maintainer.
- **On the device only.** Nothing changes in the format, but the file stops being the character: an export carries no
  play, and the desktop and the phone disagree about the same file. Declined by the maintainer.
- **Hardcoding hit points, slots and rests in `packages/ui`.** Simpler, and exactly what the layering forbids: Cairn has no
  spell slots, and a user's system has its own rests.
- **Parsing every usage with a fixed pattern** ("N/<anything>"). Would track "1/Turn" as a use given back by nothing, and
  would tie `packages/ui` to the corpus's English. The rests' own templates say which usages are counts.
- **Recording what is left instead of what is spent.** A maximum that rises (a level, a feat) would leave the character
  short; recording what is spent keeps the right number when the maximum moves.
