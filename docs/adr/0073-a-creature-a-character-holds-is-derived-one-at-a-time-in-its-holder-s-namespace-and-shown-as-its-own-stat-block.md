# 0073 — A creature a character holds is derived one at a time in its holder's namespace, and shown as its own stat block

**Status:** Accepted · 2026-09-29 · implemented the same day · answers the question [0070](./0070-a-player-character-keeps-text-for-reference-and-a-creature-it-holds-is-not-a-reference.md)
decision 3 left to the roadmap's "Companions and sidekicks", and splits that item · builds on
[0003](./0003-system-agnostic-content-model.md), [0006](./0006-derived-character-state.md),
[0012](./0012-self-contained-saves.md), [0022](./0022-kinds-contribute-systems-do-not-ship-content.md),
[0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0057](./0057-a-creature-s-printed-scores-are-where-an-npc-starts-and-the-dm-may-replace-them.md),
[0058](./0058-a-setter-may-name-elements-its-holder-has-and-the-kind-says-which.md),
[0062](./0062-an-npc-s-other-speeds-saves-and-skills-are-its-creature-s-rules-and-its-senses-are-what-it-prints.md) ·
**format:** one optional key on a character kind in the system format, `companions` (`formatVersion` stays 1).
`character.json` and `.incu` are unchanged: nothing new is recorded, and a save embeds a few more elements

## Context

A player character already **holds** a creature wherever content gives one: a familiar through Find Familiar, a
ranger's beast, a Steel Defender, a drake. ADR 0070 measured it (26 selects in a player character's own content, 5 of
the 30 samples holding an Owl) and found that **no sheet section of the player character shows it**: the Owl is held,
derived and saved, and shown nowhere. It decided a creature is not a reference, because a reference is never held and
29 creatures compute their numbers from whoever holds them, and left the question here: how a held creature is shown
with numbers derived from its holder.

The NPC already renders a creature as its own sheet (ADRs 0057 to 0062), from the same element: the six printed scores
as setters, armour class, hit points, speeds, saves and skills from the creature's own `companion:*` rules, and its
traits, actions and reactions named by setters. What was not known is what those rules already do when the creature is
not the character but something the character has.

### What content and the samples hold

Measured by `tools/verify/src/held-creatures.test.ts` on AuroraLegacy/elements at `c28ce6c`, reported as `ℹ` lines and
asserting none of it (ADR 0042). A creature is held the one way that offers every one, Aurora Legacy Essentials'
Companion Selection item equipped (found by shape: the player character's own element whose creature `select` has no
filter), on a fresh player character at level 5 with no class; the namespace is read off the NPC's `startsFrom`s.

**Content writes a creature's numbers in its holder's derivation, in one namespace.**

| | |
|---|---|
| stat rules in `companion:` on creatures | **881**, on all 141, of 29 stats |
| on the features a creature names (`traits`, `actions`, `reactions`) | **148**, on 7 of the 373 that resolve: the 2024 Primal Companion's bond (proficiency in every save and skill) and a soul bond |
| on the **holder's own** elements | **6**: the 2014 Ranger's Companion (its proficiency bonus to the beast's armour class, attack and damage, and "four times your ranger level" as a floor on its hit points) and Improved Defender (+2 armour class) |
| read in the namespace and contributed by nothing, so supplied by Aurora's app | `companion:constitution:modifier` (5 rules), and, for every creature but the 12 class summons that supply it themselves, `companion:proficiency` |
| written by creatures outside it | 3 intermediates, each read back into it (`homunculus:hp`, `iron defender:hp`, `alternative:hp:max`) |
| a creature's own rules | 901 `stat`, 12 `grant` (each also named by its setters, ADR 0058), **no `select`**; nothing a creature grants grants anything |

**Held by a player character, those rules already derive**, and are right where the holder is what they read.

| a player character holding each creature | |
|---|---|
| held | **141 of 141** |
| the six scores published anywhere | **0**: a creature prints them only as setters |
| `companion:proficiency` | none for **129**; for the 12 class summons, the holder's bonus less 2 (their own rules remove "the app's" 2 in a bucket of their own, ADR 0062) |
| `companion:ac`, `companion:hp:max`, `companion:speed` and the other speeds, against the NPC built on the same creature | speeds agree on all; armour class on 124 (17 differ: the summons that add the holder's proficiency bonus); hit points on 132 (8 differ: the Steel and Iron Defenders, the Dancing Items and others that read the holder's class level) |
| skill and save proficiencies | **none** agree with the NPC's: with no `companion:proficiency` a held Owl is proficient in nothing, and the named features that grant a Primal Companion its proficiencies are not held by a player character (ADR 0058 decision 3) |
| the 29 creatures reading their holder | read six class levels (`level:artificer`, `druid`, `bard`, `ranger`, `warlock`, `wizard`), `proficiency`, three ability modifiers and the three intermediates. A player character publishes a class level only for a class it has, so each creature is right on the holder its content gives it to and reads 0 elsewhere, as the book says |

**Two creatures held at once are one sum.** The same namespace takes both: two creatures read together as armour class
**28**, and **13** and **15** alone. Aurora's app holds one: Aurora Legacy Essentials' two selection items say so in
their text ("You can only have one Companion or Familiar per Character. This is a limitation of the app.") and exclude
each other, and Find Familiar's select is closed to a warlock with Pact of the Chain. Those are **4 of the 26** creature
selects; the other 22 do not exclude one another. A Battle Smith taking the Homunculus Servant infusion holds a Steel
Defender and a homunculus, and nothing in content says which one Improved Defender's +2 is for.

**Aurora records the companion it shows.** Every sample save carries a `<companion>` block (the six scores, six saves,
eighteen skills; no armour class, hit points or speed): 25 with no creature (all 10s, often still named "Owl"), and the 5
that hold one with the Owl's printed scores. The four holding the 2014 Owl record Perception and Stealth at +3, its
Wisdom and Dexterity modifier +1 plus **2**, which is that Owl's own proficiency bonus (challenge 0) and not the wizard's
(+3 and +4 at levels 7 to 9). The one holding the 2025 Owl records +1 for both, where its stat block prints +5 (it
writes proficiency twice, as expertise).

**No sidekick content exists.** The corpus's only element naming one is the Source for "Unearthed Arcana: Sidekicks",
with nothing in it.

## Decision

### 1. A kind may declare the creatures a character holds, and what seeing from one adds

```jsonc
"companions": {
  "types": ["Companion"],
  "label": "Companions",
  "description": "…",
  "stats": [ … ],          // declared as a kind's are, for the creature's names
  "setterStats": [ … ],     // where they start (ADR 0057)
  "contributions": [ … ],   // what the kind supplies to them (ADR 0022)
  "setterGrants": [ … ],    // what the creature holds of its own (ADR 0058)
  "sheet": [ … ]            // sheet sections, as a kind's (ADR 0062's fields included)
}
```

Replaced, not merged, along an `extends` chain, as `references` is. Core names no type, stat or setter, and the system
format is otherwise unchanged. A kind that declares none derives exactly as before, which is every kind but 5e's `pc`.

### 2. Each held creature is derived in its own scope: its holder, with the other creatures left out

For every element the character holds of a declared type, the engine derives the character again with **every other
held element of those types left out** (never added, so what only it gave is not reached either) and with the
declaration's stats, starts, contributions and setter grants **added to the kind's**. That scope is published as
`DerivedCharacter.companions` (`{ elementId, stats, starts, elements, problems, withdrawn }`, `problems` being what the
scope finds that the holder's derivation does not, and `withdrawn` what it withdrew by ADR 0071: the UA Ancient
Companion's three "(X Only)" features are withdrawn in its scope, as they are on an NPC).

This is content's own model, taken one creature at a time. Content writes a creature's numbers into its holder's
derivation because they read the holder (a ranger's level, an artificer's Intelligence) and because the holder's own
features add to them (Improved Defender); the scope keeps both. What it removes is the one thing content assumes and a
character can break: that there is only one creature. With one creature held the scope differs from the holder's
derivation only by what the declaration adds.

**The holder's own derivation is unchanged.** It still holds every creature and still sums their `companion:*` rules, as
Aurora's app would; nothing on the holder's sheet reads them, and changing them would move the oracle for no reader. The
creature's named features are held in its scope only: a ranger still does not get its beast's bite (ADR 0058 decision 3).

### 3. The 5e player character declares it

On `pc` in `systems/dnd5e/system.json`, a system definition change with no game noun in core:

- **The six scores start at the creature's print** (`companion:strength` … from its setters), with their modifiers.
- **`companion:proficiency` is 2, in the bucket `proficiency`**: the value the four 2014 Owl samples show Aurora
  supplying. The bucket is measured, not chosen for looks. Of the 12 creatures that supply their own bonus from their
  holder's, and whose stat blocks all say it is the holder's, 8 write it in `base` and take away "the app's" 2 in a
  bucket of their own, 3 Fizban's drakes write it in `proficiency`, and the Eberron homunculus writes it in `base` and
  takes nothing away. Unbucketed (the first version, and ADR 0062's reading for the NPC), the drakes and the homunculus
  read their holder's bonus **plus 2**: right for 8 of 12. In `proficiency` the drakes' own value replaces the 2 and
  the 8 still take it away: right for 11. In `base` the 8 read 2 less: right for 1. Found by running the app, not by a
  test: a Battle Smith's homunculus showed +5.
- **Saves, skills and passive Perception** are the NPC's formulas (ADR 0062) under the creature's names:
  `companion:<ability>:save`, `companion:<skill>`, `companion:perception:passive`, each reading the creature's own
  `…:proficiency` and `…:misc`.
- **Its traits, actions and reactions** are named by the same three setters the NPC reads, as the scope's setter grants.
- **Its sheet** is the NPC's stat block under those names: armour class, hit points, speed and proficiency bonus; the
  six scores; other speeds, saves and skills shown only where they apply; senses and defences as printed; traits,
  actions and reactions.

### 4. A save embeds what the creature names

`collectCharacterContent`, given the kind, follows the declaration's setter grants as it follows the kind's (ADR 0058),
so a save carries the Owl's Talons and a Steel Defender's Deflect Attack and shows them with no source (ADR 0012). A save
written before this does not; reopened with no source, its creature's stat block has its numbers and says which features
are not loaded, and saving it again with the source loaded carries them.

### 5. The Sheet shows each held creature after the character, with what gave it

`packages/ui/src/companions.ts` is the view-model: for each creature, its name, the held elements whose recorded choice
holds it ("From Find Familiar"), and its sections rendered by core's `renderSheetSection` against the scope, empty ones
left out, each row with its label and value. The Sheet pane renders it after the character's own sections and before
what it keeps for reference, and computes nothing.

## What this does not do

- **Show the Eberron homunculus's proficiency bonus right.** Its row reads its artificer's bonus plus 2, because its
  content supplies the bonus in `base` and takes nothing away (above). Its skills, saves and passive Perception read
  the artificer's bonus directly and are right. Upstream's to make consistent; the tests report it by name.
- **Revisit the NPC's reading of the same rule.** ADR 0062 contributes the NPC's own bonus unbucketed, which the
  measurement above says is right for 8 of the 12 class summons. Not measured on the NPC here, and not changed.

- **Say which creature a holder's feature is for.** Improved Defender's +2 and the Ranger's Companion's bonuses are
  written against "the companion", and with two held each scope has them. Content does not say, and guessing from which
  feature's select chose which creature is a guess about prose (ADR 0005).
- **Read a creature's challenge rating for its proficiency bonus.** The 2014 Triceratops (challenge 5) and Tyrannosaurus
  Rex (8) held by a player character read +2 where the book says +3; they are reachable only through the item that
  offers every creature. Reading it through `setterStats` warns on every class summon that prints "—", which is the
  common case, and the samples witness only 2. *Done 2026-10-12:* the scope reads `challenge` into
  `companion:challenge`, and the default bonus is 2 + max(0, ceil((rating − 4) / 4)) in the same bucket; a dash reads 0
  with no warning (ADR 0060's amendment). The two read +3.
- **Agree with Aurora on the 2025 Owl.** Its stat block prints Perception +5 and Incudo derives +5; Aurora recorded +1.
  Reported, not asserted.
- **Show a creature's attack bonus.** `companion:attack` and `companion:damage` are written (the Ranger's Companion) and
  read by nothing; an action's text states its own numbers.
- **Track a creature's hit points, conditions or death.** A play-time concern, with the character's own (Phase 6).
- **Sidekicks.** No content; the roadmap item is split and that half stays open until some exists.
- **A druid's Wild Shape forms**, which ADR 0070 found content ties to no creature. Unchanged.
- **Compare with Aurora's `<companion>` block in the oracle.** The saves are frozen and the corpus moves; the comparison
  is reported by `companions.test.ts`, and what is asserted is what holds against any corpus.

## Alternatives considered

- **A sheet section on the player character reading `companion:*` directly**, with the six scores as `setterStats` on
  the kind: a system definition change and nothing else. Right for one creature, and for two it shows 28 as an armour
  class and warns that two creatures print a Strength. The measurement says two is ordinary (a Battle Smith with a
  homunculus), so the one-creature model is content's limitation, not the character's.
- **Only one creature is shown, and holding two is a problem.** Aurora's answer ("a limitation of the app"). It would
  flag a legal Battle Smith, and content does not keep a character to one in 22 of its 26 selects.
- **Derive each creature as an NPC**, a sub-character of the `npc` kind. The NPC reads its creature's rules as its own
  numbers, but those rules read the holder's level and bonus, and the holder's own features (Improved Defender) add to
  them: an NPC has none of that, so every one of the 29 would be wrong, and a feature's bonus would need a way across.
- **Give the player character `setterGrants` for creatures**, so their features are held. ADR 0058 declined it: the
  ranger would hold its beast's bite.
- **Change the holder's own derivation** so that its `companion:*` reads one creature. Nothing on the holder reads it,
  and it is what Aurora's own numbers are; the scope is where one creature is meant.

## Evidence

Each test names the perturbation that fails it, and each perturbation was run.

- `packages/core/src/companions.test.ts`, over a fixture with no game in it: a held creature's scope has its print, its
  rules reading its holder, the declaration's contributions and derivations, and its holder's feature; what it names is
  held in its scope only, and the holder's own derivation is the same with or without the declaration; two creatures
  sum in the holder and each scope sees only its own, in the order held; a creature another element grants is left out
  of the other's scope; what only the other creature gives is left out and what something else gives is not; a scope
  reports what it finds and the holder does not; a save embeds what a creature names and derives the same scope from
  it alone. Perturbed: seeds not excluded; grants not excluded (found live: every fixture creature was chosen, so no
  test failed until one arrived by a grant); the collector not following the scope's setter grants; the scope's starts
  not added; the scope's problems dropped.
- `packages/ui/src/companions.test.ts`: nothing for a kind declaring none or a character holding none; a creature's
  name, source, what gave it (a choice or a grant), labelled rows, printed lines and named features, read from its
  scope; empty sections left out; two creatures each with their own numbers, and which rows show asked of each scope
  (a cat's swim does not make the ox swim); a missing named feature said without its id; the builder publishing it.
  Perturbed: labels not read; stats valued from the holder; rows shown by the holder's stats (found live: no case
  told them apart until the cat swam); empty sections kept; what gave it not read; problems not read; not published.
- `tools/verify/src/companions.test.ts`, against whatever the corpus holds: 5e's declaration validates, and one naming an
  undeclared type or reading a setter off a type that is not a creature is refused; every creature held by a player
  character has one scope, its six scores are its print, the numbers content's rules make are kept (5 that read their
  own Constitution modifier are right only in the scope, and are reported), everything it names is held there or
  withdrawn there and never by the holder, and every proficiency written against its bonus is at least 2; two
  creatures held together each read what they read alone; a 2014 Battle Smith built through the builder has a Steel
  Defender with 2 + Intelligence modifier + 5 × artificer level hit points and the artificer's bonus; every sample
  holding a creature has its scope, and saved and reopened with no source derives the same. Perturbed: `companions`
  removed from `pc`; its `setterStats`; its proficiency contribution; its setter grants (found live: the test read
  what a creature names off the declaration it was testing, and passed without it; it reads the NPC's now); other
  creatures not left out; the collector not following the scope's setter grants. Reported: against Aurora's recorded
  `<companion>` block, the four 2014 Owl samples agree on every score, save and skill, and the 2025 Owl reads
  Perception and Stealth +5 (its print) where Aurora recorded +1; 11 of the 12 bonus-supplying summons read their
  holder's bonus.
- `tools/verify/src/held-creatures.test.ts`: the measurement in the Context, report-only.
- The oracle's thirty-sample table is identical before and after (`INCUDO_ORACLE_SNAPSHOT` on the base commit,
  `INCUDO_ORACLE_BASELINE` on the change, same checkout, no `.env.local`), after the last system change; a baseline
  with one difference removed fails, so the comparison was live. No player character derivation moved, as decision 2
  says: the holder's own derivation is unchanged. `npm test` and `npm run typecheck` pass.
- **Driven in the browser build** (an origin-private folder standing in for the folder picker). A level 5 Human Battle
  Smith (Tasha's) with its Steel Defender and the Homunculus Servant infusion: the Sheet showed two stat blocks, the
  defender at armour class 15, 27 hit points, speed 40 and +3, with Vigilant, Force-Empowered Rend, Repair and Deflect
  Attack; the homunculus at 13, 6, 20 and fly 30, with Evasion, Force Strike and Channel Magic, each "From" the feature
  that gave it. Saved, the source switched off and the page reloaded, the file reopened to the same companions text,
  character for character. No console errors.
- **Driven in the Tauri window on Windows** (a fresh WebView2 profile, the library a scratch folder, DOM clicks over the
  debug port; no keystrokes, and not macOS or Linux). AuroraLegacy loaded through the host in about 60 s. The same
  character built and saved; the file, read back from disk with the repository's zip codec, is character format 2
  (unchanged), embeds all seven named features, holds none of them, and derived against only the save gives both
  scopes (27 and 6 hit points). With the source switched off and the window reloaded, it reopened to the same text.
