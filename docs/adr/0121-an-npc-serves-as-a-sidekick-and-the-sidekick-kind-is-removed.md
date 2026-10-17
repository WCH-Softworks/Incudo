# 0121 — An NPC serves as a sidekick, and the sidekick kind is removed

**Status:** Accepted · 2026-10-17 · the maintainer's call · supersedes
[0118](./0118-a-sidekick-is-a-character-of-its-own-built-on-a-creature-and-levelled-in-a-sidekick-class.md) · builds on
[0057](./0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md),
[0059](./0059-a-stat-may-start-where-another-stat-is-and-a-typed-value-replaces-it.md),
[0060](./0060-a-character-may-leave-its-progression-to-what-it-chose-and-that-is-format-3.md),
[0063](./0063-a-character-may-carry-features-its-user-writes-which-add-to-a-stat-or-set-where-it-starts.md),
[0064](./0064-a-character-may-carry-elements-its-user-adds-from-loaded-content-and-an-unmet-prerequisite-is-a-flag.md) ·
**format:** system format: the `Sidekick Class` element type, `setterStats[].read`, `levelRoll.dieStat` and
`levelRoll.from`, a sheet section's `trackDice` and a kind's `available` are removed, and `levelRoll.dieSetter` is
required again (`formatVersion` stays 1); no character format change

## Context

ADR 0118 added a 5e `sidekick` kind: a character built on a creature (a `Companion` element) and levelled 1 to 20 in one
element of a new `Sidekick Class` type, with four kind-agnostic system-format additions to carry it: a `setterStats`
entry reading a printed die or dice count, a level roll whose die is a stat and which starts after level 1, a sheet
section whose dice are two stats, and a kind's `available` gate ("Sidekick (needs content)" until a sidekick class is
loaded).

The kind had nothing to level in:

- **No sidekick class content exists anywhere a user has it.** AuroraLegacy has none (one empty "Unearthed Arcana:
  Sidekicks" `Source`), and the sidekick rules are not in the SRD, so Incudo cannot ship them either. The kind worked only
  for a user who wrote their own content file of sidekick classes, and the only such file was the project's test
  fixture. The `available` gate existed to say so on every 5e library screen.
- **An NPC already covers what a table uses a sidekick for**:
  - its creature's printed stat block is where it starts (ADR 0057, 0059), and the DM may build one with no creature;
  - any feature, feat, proficiency, language or spell from loaded content can be put on it through Additions, whatever
    its prerequisites, with an unmet one flagged (ADR 0064);
  - the DM writes features of its own that add to or set its numbers (ADR 0063);
  - hit points and armour class are typed and replace the print (ADR 0059);
  - its proficiency bonus follows the challenge rating the DM types (ADR 0060): 0 to 4 gives +2, 5 to 8 +3, 9 to 12 +4,
    and so on, which is the bonus a sidekick of the matching level has.
- The system format is a public API (ADR 0011), and removing four fields is cheapest before 1.0, while nothing outside
  this repository can have used them. Nothing in the code read them but the sidekick kind.

## Decision

1. **5e has no sidekick kind.** The `sidekick` kind and the `Sidekick Class` element type are removed from
   `systems/dnd5e/system.json`; 5e declares three kinds again (player character, NPC, legendary creature). A sidekick is
   built as an NPC.
2. **ADR 0118's four system-format additions are removed**: `setterStats[].read` (and `readPrintedDice`),
   `levelRoll.dieStat` and `levelRoll.from` (`dieSetter` is required again), a sheet section's `trackDice`, and a kind's
   `available` (`kindUnavailable`, `KindChoice.unavailable`, `BuilderState.unavailable`, the chooser's "(needs
   content)", the greyed New character and Build's note). Their schema entries, validator checks and tests go with them.
   `formatVersion` stays 1: nothing shipped declared them.
3. **The level panel's one-class wording goes too** (`ClassLevelState.secondClassPossible`, `firstClassHint`,
   `LevelControlView.choosesClass`, `splitWording`): it was written so a sidekick's panel would not offer a second class,
   and every remaining kind's classes can be taken second.
4. **The test fixture of sample sidekick classes and its tests are removed.** No character format changed under ADR
   0118, so no saved character needs anything: a file of the removed kind would no longer open as one, and none exists
   outside a drive of the fixture.

## Consequences

- An NPC is the sidekick. What it does not do that ADR 0118's kind did: grow hit points by its creature's dice per level
  (the DM types the total), list a sidekick class with its hit dice, and offer a class's features level by level (the DM
  adds them). All three need sidekick class content that nobody has.
- Building an NPC on a race as well as a creature, which a sidekick made from a humanoid needs, is a separate item.
- If sidekick class content ever appears in a source users have, ADR 0118 records how the kind was built and what the
  Tauri window and phone drives found; that would be a new decision, written against that content.
- The oracle is unaffected: no sample is an NPC or a sidekick.
