# 0060 — A character may leave its progression to what it chose, and that is format 3

**Status:** Accepted · 2026-09-25 · closes [0057](./0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md)'s
second gap · amends [0009](./0009-character-kinds.md) (`progress` may be absent) · builds on
[0006](./0006-derived-character-state.md), [0012](./0012-self-contained-saves.md), [0014](./0014-base-stats-are-inputs.md),
[0024](./0024-inventory-is-a-list-of-instances.md) · **format:** `character.json` `formatVersion` **3**, and only for a
character that uses it; the system format is unchanged (`setterStats` may name the progression's stat)

## Context

ADR 0057 showed each creature's printed challenge rating in the picker and did not read it. An NPC's challenge
rating is `Character.progress` for the kind's `rating` progression, which is required, starts at 0 and cannot be
unset, so the rating was always the DM's number. Proficiency bonus is +2 from CR 0 to 4, so for most creatures
that was invisible; for the two above it, it was wrong.

The fix ADR 0057 left open is the one it made for ability scores: what the creature prints is where the rating
starts, and a rating the DM types replaces it. What made it a separate decision is that the rating is not a stat
the character stores a base for. It is `progress`, the one number every kind has, read by gates, by the elements a
progression grants, by recorded rolls, and by the save's embedded content. And it is required.

### What the corpus holds

Measured on AuroraLegacy/elements at `c28ce6c`, 141 `Companion` elements, with a throwaway script (not committed):

| | |
|---|---|
| `challenge` setter | on 141 of 141 |
| readable as a number | **121**: 58 CR 0, 14 CR 1/8, 28 CR 1/4, 4 CR 1/2, 13 CR 1, one each of 2, 3, 5 and 8 |
| not a number | **20**: 19 print `—` and one prints `-` (class summons that scale with the summoner) |
| proficiency bonus above +2 at the printed rating | **2**: the Triceratops (CR 5) and Tyrannosaurus Rex (CR 8), +3 each |
| creature rules gated by a level (`level=`) | **0** |
| creature rules reading `challenge` | **0** |
| elements anywhere that grant a `Companion` | **0**: a creature is only ever chosen |

## Decision

### 1. `progress` may be absent, and absent means "where the kind says it starts"

`Character.progress` becomes optional. When it is absent, a character is at:

1. what an element it **chose** prints for the progression's stat, when the kind's `setterStats` names that stat
   (the 5e NPC: a `Companion`'s `challenge`); otherwise
2. where the kind's progression starts, as a new character of that kind always was.

When it is present it is what the user set, and it replaces the print exactly as a typed score replaces a printed
one (ADR 0057). A print that is not a number (`—`) supplies nothing and the derivation warns, naming the creature,
as it does for a score; with a recorded rating the note is not reported, because the print no longer matters.

The print is read from what the character chose and from nothing it was granted. A grant can sit behind a gate that
reads this very number; reading only the choices settles it once, before the fixed point, with no loop. The corpus
costs nothing for this: no element grants a creature.

### 2. One reader, `characterProgress`, for the engine, the save and the builder

`characterProgress(character, kind, index)` in `packages/core` returns the value, whether it was recorded, what the
chosen element prints and the notes. The engine settles it first and every step of the derivation reads the
character with it filled in (`DerivedCharacter.progress`); `collectCharacterContent` embeds the progression's
elements at that value; the builder publishes it (`BuilderState.progress`) and `setProgress(undefined)` goes back to
the print. The print is also in `DerivedCharacter.starts`, beside every other start, with `replaced` when a rating
was typed. The progression's stat is left out of the ordinary setter pass so it is read once.

A new character of a kind whose `setterStats` names its progression's stat records none
(`createCharacter(…, { progress: null })`); every other kind records its start, as before. A library card for a
character that records none reads the rating from the elements it chose, which the library keeps on the entry for
that one purpose (`LibraryEntry.chosen`, `libraryEntryProgress`), because the library has no system definition.

### 3. Leaving it out is format 3, and nothing else is

A required field becoming optional is a breaking change for a reader, and ADR 0024 set the rule for a save: the
number moves when a reader that does not know the change would get the character wrong without saying so. A reader
of format 2 opening a character with no `progress` reads nothing where it expects a number — a challenge rating
and a proficiency bonus of `NaN`, gates that never open — and nothing tells it why.

So `formatVersion` **3** means "this character may leave out `progress`" (and, since ADR 0061, "may record
`removedGrants`"). It is not what a writer writes: a new character is still written at 2, and only a write that
needs 3 raises it (`setProgress(character, undefined)`, and `createCharacter` with `progress: null`). Nothing
downgrades one. Every player character, and every NPC whose rating the DM typed, is a file a reader of 2 reads
correctly, and stays one. The validator refuses a file below 3 that leaves `progress` out, which the schema alone
cannot say.

The difference from ADR 0024, which made `createCharacter` write the new number for everyone: there, every character
could gain an inventory at any moment and the number was being given meaning for the first time. Here, most
characters can never need it, and writing 3 into all of them would make the number say less.

## What this does not do

- **An NPC saved before this records a challenge rating of 0.** ADR 0057's builder wrote the progression's start into
  every new NPC. Such a character keeps its 0, as a rating the DM typed; the builder offers "Use the creature's" to go
  back to the print. Nothing migrates a file.
- **Twenty creatures print no rating as a number.** They start at 0 and say why. The class summons among them scale
  with a summoner an NPC does not have.
- **The rating a DM types is not checked against the creature.** A Wolf at CR 10 is a DM's decision.
- **A printed rating is read from choices only.** A kind whose rating came from a granted element would not see it;
  none exists in the corpus.
- **No reader of format 2 refuses a format 3 file.** `readCharacterContainer` never checked the number; the schema and
  the validator refuse it, and an older app has neither in its open path. That is how every version bump here has
  worked, and it is ADR 0024's accepted cost, not a new one.

## Alternatives considered

- **The builder copies the printed rating into `progress` when a creature is picked.** It stores content in the
  character (ADR 0006): a rating corrected upstream would not correct the NPC, and picking another creature would have
  to know whether the DM had typed the old one. ADR 0057 declined the same for scores.
- **A rating the DM types goes into `baseStats.challenge`**, and `progress` is ignored for a rating kind. Two fields
  would then hold one number, and every reader of `progress` (gates, rolls, the progression's elements) would have to
  learn which one wins.
- **Keep `progress` required and add a flag, "the DM set it".** A number with a flag saying whether to believe it is
  a sentinel, which ADR 0033 declined for skipped decisions; a reader of 2 would read the stale number and be quietly
  wrong, the failure the version exists to prevent, without the version moving.
- **Write format 3 for every new character**, as ADR 0024 wrote 2. Rejected above: the number would stop telling a
  reader anything about the file in front of it.
- **Read the print from every element held.** A rule gated on the rating could then decide what prints the rating. No
  such content exists, and the loop is not worth building for none.

## Evidence

- `packages/core`: `progress-start.test.ts` — with nothing recorded the rating is the chosen element's print and gates
  read it; a recorded rating replaces it and the print is still published; a fraction reads as one; a print that is not
  a number starts at the progression's start and warns, and a recorded rating silences it; a granted element does not
  set it; a kind declaring none is unchanged; each printed step's elements are derived and embedded at the printed
  step; clearing raises the character to format 3 and nothing downgrades it. Each checked by perturbation: ignoring the
  print, letting it win over a recorded value, reading it from everything, embedding at the recorded value, and not
  raising the version each fail at least one.
- `packages/ui`: `character-kinds.test.ts` — a printing kind's new character records nothing and is format 3, every
  other kind records its start at format 2; a card reads the creature's rating; the builder shows the print, a typed
  rating replaces it, clearing goes back, and a kind nothing prints for ignores a clear. `character-library.test.ts` —
  an entry that records no rating keeps what it chose, and one that records a level keeps nothing extra.
- `tools/verify`: `schemas.test.ts` — only format 3 may leave `progress` out. `npc-creatures.test.ts` — every creature's
  NPC records no rating and reads the one it prints, with the proficiency bonus the kind derives from it (2 of the 121
  above +2); every one that prints something else is reported; a typed rating replaces the print, clearing goes back,
  and the save is format 3, records none, and reopens with no source at the creature's rating.

Measured after it was built, against `c28ce6c`: 121 creatures start at their printed rating and 20 at 0 with a warning
each. Of every creature's NPC derivation, 63 change their challenge rating (the ones printing a non-zero number), 2
their proficiency bonus (the Triceratops and the Tyrannosaurus Rex, +2 to +3) and 20 gain the warning; no element
changes. All thirty sample saves derive identically, and the oracle's tables are unchanged by snapshot and baseline.

**Driven in the browser build only**, not the Tauri window, macOS or Linux, with an origin-private folder standing in for the native folder picker. A new NPC's Challenge Rating field was empty with 0 faded; choosing the Triceratops made it 5, faded, with the sheet reading proficiency +3; typing 9 gave +4 and offered "Use the creature's (5)", which went back. Saved, the library card read "NPC / Monster · Challenge Rating 5" after a reload, before any content had loaded, from what the save embeds; reopened with the content source switched off (0 elements loaded), the sheet read CR 5 and +3.
