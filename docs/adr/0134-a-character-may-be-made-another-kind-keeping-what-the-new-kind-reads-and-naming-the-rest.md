# 0134 — A character may be made another kind, keeping what the new kind reads and naming the rest

**Status:** Accepted · 2026-11-25 · the maintainer's calls on the four questions below · builds on
[0009](./0009-character-kinds.md), [0057](./0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md)–[0065](./0065-legendary-content-is-content-of-the-types-the-system-declares-and-a-dm-may-write-it-on-the-creature.md),
[0064](./0064-a-character-may-carry-elements-its-user-adds-from-loaded-content-and-an-unmet-prerequisite-is-a-flag.md),
[0096](./0096-a-pick-counts-while-its-slot-exists-and-a-pool-s-slots-are-filled-as-a-matching.md),
[0120](./0120-the-shell-knows-whether-the-character-on-screen-is-saved-and-asks-before-replacing-unsaved-changes.md),
[0130](./0130-only-1-0-s-formats-are-supported-its-numbers-are-the-baseline-and-a-newer-file-is-refused.md) ·
**format:** none (no system or character format change; nothing records that a character was converted)

## Context

Many characters imported from Aurora as player characters are really creatures: Aurora had no monster builder, so a DM
built a lich or a bandit captain with class levels, a background and a bag. Incudo has an NPC and a Legendary Creature
kind (ADRs 0057–0065), and rebuilding each imported character as one by hand is not reasonable.

Changing `Character.kind` alone is not honest. A record the new kind does not read would sit in the file doing nothing,
or keep acting: a recorded choice under a key no pool owns always counts (ADR 0096), so an NPC would go on holding its
class, its class features and every pick they opened, with nothing on Build able to change them. The user must see what
goes before anything changes.

**Measured first** (`tools/verify/src/kind-conversion.test.ts`, report-only), every sample converted to each other 5e
kind, against AuroraLegacy at the corpus head (2026-11-25):

- All 30 lose something to an NPC and to a Legendary Creature (the two lists are the same: the legendary kind adds only
  types). Every one loses its level (an NPC's challenge rating starts where its creature prints one) and its hit point
  rolls; 18 lose text fields (personality, backstory and the rest a player character declares), 13 a prepared list, 8 a
  bag.
- **699 picks** stop being read: the class, the background, the campaign options, and what those opened. **454 of them are
  of a type an NPC can be given** (213 spells, 111 proficiencies, 88 class features, 27 languages, 10 feats, 5 archetype
  features) through ADR 0064's additions.
- What the new sheet would read differently is armour class and hit points on all 30 (an NPC with no creature reads 0),
  an ability score on 11 (the improvements came with the class), speed on 3.
- Every conversion validates as its new kind and reopens with no source to the same sheet.

## Decision

1. **One pure function, `convertCharacterKind`** (`packages/ui/src/kind-conversion.ts`), returns the converted character
   and what it does, worded: `lost` (by heading, each line naming the record), `changed`, and two offers, `copies` and
   `additions`. It names no kind and no game. What survives is decided record by record against what the target kind
   declares:
   - **Progress** is kept only between progressions of the same kind and stat; otherwise it goes, absent where the
     target's progression can be printed (ADR 0060), else the target's start. **Advancement** only between level
     progressions on the same track type.
   - **A choice** is kept when every element it holds is of a type the target lists and, for a `build/<step>` key, the
     target has that step and its types fit. Then the result is derived as the new kind and **a pick whose pool closed**
     (`DerivedCharacter.uncounted`, `closed`, and not already uncounted before) is dropped, repeated until nothing more
     closes: the engine's rule, not a copy of it.
   - **Rolls** are kept where a target step reads them (a level roll's pattern, a budget's rolls, a wealth roll where the
     target has starting equipment); **typed values** (`baseStats`) where the target has a budget with that target;
     **a method** (`generation`) where the target's step offers it; **overrides** for stats the target declares.
   - **The bag and the purse** go where the target has no inventory; **starting equipment** where it has none;
     **prepared lists** where it has no preparation; **spell attack settings** where it has none.
   - **Freeform**: a key the old kind declared and the new one does not goes, named by its label. A key neither declares
     was never shown, and stays.
   - **Written features** go where the target carries none. One held as a type the target does not list is held as the
     target's default type, said under `changed`; a line naming a stat the target's features cannot name, or a mode the
     stat does not allow, goes.
   - **Additions** and **references** keep the types the target lists; an addition's block is dropped when the type is
     not cast or when the derivation says the block is gone (`addition-block-missing`), said under `changed`.
   - **Play**: what is spent on a tracker the target does not declare, and a condition it does not name, goes.
   - **Removed grants** go where the target has no holders (`setterGrants`).
   - The name, the id, the portrait, the sources, the publications and declined decisions are kept.
2. **A number the old kind worked out and the new one lets the user type is offered as a copy** (the maintainer: "Let the
   user tick each number"). For every target of the new kind's budgets whose number differs, the confirmation has a box,
   ticked by default. A ticked one is typed (`baseStats`) so the new sheet reads what the old one showed: what the new
   kind adds to a typed value is taken off it, found by deriving and correcting, and `changed` says when the typed value
   is not the number shown. It is a typed value like any other, worded as a copy, never as a derivation (ADR 0006).
3. **A dropped pick of a type the new kind can be given is offered as an addition** (ADR 0064), ticked by default, with
   what it was chosen under; a prepared list's spells are offered the same way where the new kind prepares nothing. An
   unticked one is lost and listed. An addition's prerequisites are a flag, never a refusal, so nothing offered here can
   be refused later.
4. **Every direction** (the maintainer: "Any kind to any kind"). The rule is kind-agnostic, so an NPC made a player
   character starts at level 1 with its class and background to choose, keeping its race, scores and what it was added.
5. **The command is on the library card** (the maintainer's choice): **Change kind…**, on a system with more than one kind.
   It opens the card's character as Open does (asking first when another character on screen has unsaved changes, ADR
   0120) and shows the confirmation over Build. The confirmation (`panes/ConvertKind.tsx`) renders `convertUnticking`
   and computes nothing: a kind chooser when there are several, what is not kept by heading, the two lists of boxes, what
   changes, and that the file does not change until Save. Cancel and Escape change nothing. Never `window.confirm`. The
   phone's Build screen has the same command and sheet (`ConvertKindView.tsx`), typechecked and not driven.
6. **The result is an unsaved edit of the same file.** The shell replaces the character on screen and keeps the library
   entry and the baseline, so the bar reads "Unsaved changes", Save writes the file (embedding only what the new kind
   reaches) and New character or Open asks first.
7. **Nothing is recorded about the conversion** and no format number moves for it: a converted character is an ordinary
   character of its kind, raised only as its records already require (3 for no progress, 5 for additions, 6 for a typed
   written feature).

## Consequences

- **The oracle cannot see this**: it imports player characters and compares them with Aurora; nothing in the import or
  the engine changed, and its table is identical by construction.
- The evidence is `packages/ui/src/kind-conversion.test.ts` (a fixture with no game, each case failing under its named
  perturbation) and `tools/verify/src/kind-conversion.test.ts`: every sample converted to every other kind, with every
  copy and addition and with none, validates, holds no record its kind does not read, adds no error, reads every copied
  number as the old sheet did and reopens with no source to the same sheet; converted back, keeps its name, typed scores
  and race.
- A converted creature does not pick a creature: the NPC has none until the DM picks one, and a typed armour class and
  hit points then replace its print. Unticking them gives the creature's numbers instead.
- **Driven in the Tauri window on Windows (2026-11-25)**, by DOM events over the debug port and not with real input: a
  Fighter 5 sample imported, Change kind… to Legendary Creature read, Cancel leaving the file and the bar unchanged, the
  conversion confirmed with one number and one pick unticked, saved, and reopened with every source off to the same Sheet
  and a byte-identical text export; New character then asked first. It found one crash, fixed since: the dialog stays
  mounted, so reopened after a conversion it still held the kind just converted to (`conversionTarget` now falls back to
  the first target).
- Not done: a stat block for what was lost (the old sheet is gone once saved; Save a copy first keeps it), and guessing a
  challenge rating from a level, which nothing in content states.
