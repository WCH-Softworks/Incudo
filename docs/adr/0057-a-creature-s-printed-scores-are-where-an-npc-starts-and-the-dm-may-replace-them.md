# 0057 — A creature's printed scores are where an NPC starts, and the DM may replace them

**Status:** Accepted · 2026-09-25 · first use of [0009](./0009-character-kinds.md) beyond the PC ·
builds on [0003](./0003-system-agnostic-content-model.md), [0006](./0006-derived-character-state.md),
[0012](./0012-self-contained-saves.md), [0014](./0014-base-stats-are-inputs.md), [0017](./0017-open-decisions-not-steps.md),
[0022](./0022-kinds-contribute-systems-do-not-ship-content.md) · **format:** an optional `setterStats` on a character kind in the
system format (`formatVersion` stays 1)

## Context

ROADMAP Phase 4 opens with "an NPC / monster kind for 5e: stat block, challenge rating instead of level", and
`systems/dnd5e/system.json` has declared `npc` and `legendary` kinds since ADR 0009. Neither has ever been
built: the app creates only the default kind, and both kinds' required `abilities` step has `"types": []` and
no `budget`, the inert shape ADR 0017 named, so an NPC could not be given ability scores at all. The fix
CLAUDE.md named was one `budget` block per kind with `manual` as its only method.

Before writing it, the corpus was counted, and what it holds changes the fix.

### What the corpus holds for creatures

Measured on AuroraLegacy/elements at `c28ce6c` (2026-09-19), 740 files, loaded through the project's own loader.

| | |
|---|---|
| element types `Creature`, `Legendary Action`, `Lair Action`, `Regional Effect` | **0 each**. The four types the `npc` and `legendary` kinds were written around do not exist. |
| `Companion` elements | **141**, from 23 books: 48 Player's Handbook, 32 Monster Manual (2025), 8 Monster Manual, 6 Boo's Astral Menagerie, 3 Player's Handbook (2024), the rest one to six each |
| `Companion Trait` / `Companion Action` / `Companion Reaction` | 147 / 196 / 10 |
| what a `Companion` is | familiars (49 tagged `Familiar`, 25 `Variant Familiar`), beast companions, and class summons (drakes, steel defenders, wildfire spirits). 94 Beasts, 64 Tiny. |
| challenge ratings | 58 CR 0, 14 CR 1/8, 28 CR 1/4, 4 CR 1/2, 13 CR 1, one each of 2, 3, 5 and 8; **20 print `—`** (class summons whose numbers scale with the summoner) |
| printed ability scores | `<set name="strength">` … `charisma`: **141 of 141**, every one a whole number |
| printed AC / HP / speed / CR | setters too, as display text: `13 (natural armor)`, `2 (1d4)`, `40 ft., climb 30 ft.`, `1/4` |
| stat rules | 901 on the 141, all in a `companion:` namespace: `companion:ac` (159), `companion:hp:max` (283), `companion:speed` (141) and `companion:speed:<mode>` (93), skill and save proficiencies |
| traits and actions | named by the creature's `traits`, `actions` and `reactions` **setters**, comma-separated ids (376 named, 373 resolve; the 3 that do not are Boo's Astral Menagerie typos). Only 12 `<grant>`s exist on the 141. |

Does content's own `companion:*` rule agree with what the creature prints?

| | agree | differ | unreadable as a number |
|---|---|---|---|
| `companion:ac` against printed AC | **121** | 2 (the 2025 Baboon and Skeleton: rule 11 and 13, printed 12 and 14) | 18 (`14 + PB (natural armor)` and the like) |
| `companion:hp:max` against printed HP | **111** | 1 (the 2014 Pteranodon: rule 68, printed 13 — 68 is the Plesiosaurus's) | 29 (`5 + five times your ranger level`, …) |
| `companion:speed` against printed walking speed | **138** | 0 | — |

The 2025 Monster Manual is the roadmap's fourth item, and it is two different things: **32 `Companion`s**, all
familiar-type beasts of CR 1 or less, and **45 `Information` elements** that are stat blocks written as HTML
prose, from the Rat (CR 0) to the Tarrasque (CR 30). Seven of the 45 have a Legendary Actions heading (Animal
Lord, Blob of Annihilation, Colossus, Elemental Cataclysm, Empyrean, Kraken, Tarrasque) and two mention a lair.
**Nothing in the corpus states a legendary action, lair action or regional effect as an element**; they exist
only as text inside a description.

### What that means for the fix

A `manual` budget alone would have an NPC built on a Wolf ask the DM to type six numbers the Wolf already
prints. ADR 0006 says those are not the character's to store: they are content, and a derivation reads them.
But the DM still needs to type scores, for an NPC built from nothing and for the ogre who is stronger than the
book's. So a score has two sources, and they are not added together: a printed 12 and a DM's 14 is 14, not 26.

The engine had no way to say that. A creature states its scores only as setters (Aurora's app reads them in
application code), the `setter` expression reads a setter only inside a per-track value (ADR 0044), and every
existing keying of a stat — content, track, block, kind — *adds* to the base, which is what `baseStats` is.

## Decision

### 1. A kind may declare that a held element's setter is where a stat starts

```jsonc
"setterStats": [
  { "types": ["Companion"], "setter": "strength", "stat": "strength" },
  …
]
```

For every element the character holds whose type is listed, the setter's value, read as a number, is the
stat's **starting value**. It lands where a declared `default` lands, before `Character.baseStats`, so:

- a value the user set (`baseStats`, ADR 0014) **replaces** it, exactly as it replaces a default;
- everything content contributes **adds** to whichever of the two is in force;
- with no such element held, the declared default applies, as before.

Core names no setter, stat or type; the kind says all three. Replaced rather than merged along an `extends`
chain, like `setterTags`. A kind declaring none derives exactly as before, which is every PC.

**Reading a number.** A whole number or a fraction (`1/4`), optionally followed by one parenthesised note
(`13 (natural armor)`, `2 (1d4)`). Anything else — `14 + PB (natural armor)`, `40 ft., climb 30 ft.`, `—` —
supplies nothing, and the derivation says so with a warning naming the element and the setter, rather than
reading the leading digits and publishing a 14 that means "14 plus something". Two held elements supplying
the same stat: the first in derivation order is used and a warning names both, rather than one silently
winning.

One function, `setterStartingValues` in `packages/core`, answers the question for both the engine and the
builder, so the ability score editor shows the same starting value the derivation used.

### 2. The 5e `npc` and `legendary` kinds use it for the six ability scores

The six printed scores are the only printed numbers declared this way, because they are the only ones content
states nowhere else. Armour class, hit points and speed are the reverse: content already states them as the
creature's own rules, so the kinds read those, a system definition change with no engine one:

- `ac` = `companion:ac`, `hp` = `companion:hp:max`, `speed` = `companion:speed`, each declared on the kind with
  no `default` (a `derive` adds to whatever the stat holds, so the system's `ac` 10 and `speed` 30 would be
  counted twice — the reason the PC's `ac` has no default either).
- The `abilities` step gets a `budget` over the six scores with `manual` as its only method (a creature's
  scores are printed, not bought or rolled).
- The kinds redeclare the six scores capped at **30**. The system declares them with a player character's cap
  of 20 (plus what content raises it by), and that clipped the two creatures that print more: the 2014
  Triceratops (Strength 22) and Tyrannosaurus Rex (25). The Player's Handbook allows a creature up to 30. Found
  by the real-corpus test, not foreseen.

### 3. The builder counts a printed score as set

A budget row gains `printed`, the starting value an element supplies. A target with one is not `unassigned`,
so an NPC built on a creature has no open Ability Scores decision; an NPC built from nothing has six, and the
step is required, as the kind already declared. The row's `bonus` is measured from the printed value when
there is one, so a Wolf's printed 12 is not shown as "+2 from somewhere". Clearing a score the DM typed goes
back to the printed one.

### 4. Every kind a system declares can be started

The library's New character offers each of the system's kinds, the default first. What a card and the
progress control call the progression comes from the kind (`Challenge Rating`, not `challenge`). The kinds'
`traits` and `actions` steps become sets (`multiple: true`, ADR 0032): a DM gives an NPC any number of them,
where a `pick` held one. A set step shows its own `description` from the system where it has one: the hint
every set used to show was the campaign options sentence, and read wrong on an NPC's traits.

### 5. What a fresh NPC is offered

117 of the 141 creatures. The other 24 carry their own element requirements naming something only a player
character has — a Circle of Wildfire, a Drakewarden's ranger level, a Strixhaven initiate feat, the Primal
Companion option — and a candidate list already leaves out what a character does not qualify for. That is
content being right, not a filter this ADR adds.

## What this does not do

- **~~The creature's named traits and actions do not reach the NPC.~~** Done by
  [ADR 0058](./0058-a-setter-may-name-elements-its-holder-has-and-the-kind-says-which.md). As first written: They are named by setters, not granted, so
  a Wolf built this way has Bite and Pack Tactics only if the DM picks them. Reading those setters as grants is
  the next decision, and it is not a presentation one: whatever a character reaches must also be embedded in
  its save (ADR 0012), so it belongs in the walk `collectCharacterContent` shares with the derivation.
- **~~The challenge rating is still the DM's number~~**, done by
  [ADR 0060](./0060-a-character-may-leave-its-progression-to-what-it-chose-and-that-is-format-3.md). As first written: the `rating` progression ADR 0009 designed, starting at
  0. The printed CR is shown beside each creature in the picker, and is not read. Reading it needs a
  progression that can be unset, which is a character format question. Proficiency bonus is +2 from CR 0 to
  4, and 119 of the 121 creatures that print a CR print one in that range, so their proficiency bonus is right
  at the starting 0; the Triceratops (5) and Tyrannosaurus Rex (8) need the DM to set it. A fractional CR is
  typed as a decimal (0.25), and a card writes it back as 1/4.
- **~~An NPC built from nothing has no way to set armour class, hit points or speed.~~** Done by
  [ADR 0059](./0059-a-stat-may-start-where-another-stat-is-and-a-typed-value-replaces-it.md), with the starting-value model. As first written: They read the creature's
  rules, which it does not have, and publish 0. A `manual` budget over them would sum with a creature's rules
  the way a manual ability score would have summed with its setter; the answer is probably the same
  starting-value model, and it is left for the ADR that decides it.
- **The 2 AC and 1 HP disagreements are upstream's** and are read as content states them (the Pteranodon has
  68 hit points). Reported, not fixed.
- **The class summons that are not reserved are still offered.** 24 are left out by their own requirements
  (decision 5). The rest that print `—` for a challenge rating (the 2024 Primal Companions, the Tasha's Steel
  Defender, the Homunculus Servant) carry no requirement, so a fresh NPC is offered them; their printed AC and
  HP are formulas in prose and their rules read `companion:proficiency` and the summoner's level, which an NPC
  does not have. They derive what their rules say.
- **An older armour class test moved.** It asserted that an NPC keeps the system's default armour class of 10,
  on ADR 0026's reasoning that "a monster's armour class is printed". This is what reads the printed one: an
  NPC on a creature reads its rule, and one with no creature reads 0, which says "no stat block" where a 10
  would look like one.
- **~~Skills, saves, senses, damage immunities and speeds other than walking are not on the sheet.~~** Done by
  [ADR 0062](./0062-an-npc-s-other-speeds-saves-and-skills-are-its-creature-s-rules-and-its-senses-are-what-it-prints.md): the rules under the NPC's own names, and senses, defences and languages as
  the creature prints them. As first written: The rules
  for them exist (`companion:perception:proficiency`, `companion:speed:fly`) and nothing publishes them under
  an NPC's own names yet.

## The roadmap's framing, corrected

The measurement contradicts two Phase 4 items as written, and the roadmap is amended to say so rather than
build around it:

- **"Legendary creature kind: legendary actions, lair actions, regional effects."** The corpus has none of
  these as elements. A `legendary` kind whose three extra steps offer types nothing declares is a kind with
  three empty pickers. What it needs first is somewhere for that content to come from: a user's own file (ADR
  0056), or a format for it, and Aurora's has none. The kind stays declared (it extends `npc` and builds like
  one), and the item becomes "decide where legendary content comes from", before any UI for it. *(Decided by
  [ADR 0065](./0065-legendary-content-is-content-of-the-types-the-system-declares-and-a-dm-may-write-it-on-the-creature.md): a user's own file, or
  a feature the DM writes on the creature, held as the type it is. The steps were not empty pickers but offered
  nothing at all: an optional single pick is shown nowhere.)*
- **"Wire up the 2025 Monster Manual creature content already in the corpus."** 32 of its creatures are
  already usable through this ADR. The other 45, the ones a DM means by "monster", are prose. Wiring them up is
  either parsing HTML stat blocks into elements — a guess about content ADR 0005 has declined every time — or
  showing the prose as a reference beside an NPC the DM builds by hand. The second is honest and the item
  becomes that.

## Alternatives considered

- **A `manual` budget and nothing else**, the fix CLAUDE.md named. Rejected by the measurement: 141 creatures
  print their scores, and asking the DM to copy them makes the character store a number content already
  states (ADR 0006).
- **The builder copies the printed scores into `baseStats` when a creature is picked.** Precedent exists (a
  points method seeds every target at its cheapest value), but it stores content in the character: a creature
  corrected upstream would not correct the NPC, and picking a different creature would have to know which
  scores the DM had typed and which were copied. The derivation already knows the difference.
- **A kind `contribution` reading the setter.** Contributions add to the base, so a DM's 14 on a printed 12
  reads 26 — the exact failure this ADR is about.
- **Reading AC, HP and speed from the printed setters as well**, for one uniform model. Rejected for now:
  content's rules state them, agree with the print on 370 of 373 readable values, and handle what the prose
  cannot be parsed for. The day a DM needs to type an armour class, the starting-value model is there to use.
- **An NPC's stats in the `companion:` namespace**, so the creature's rules land where they are written. An
  NPC is not someone's companion; publishing `companion:strength` for a bandit would make every sheet section,
  requirement and future skill rule speak the wrong subject. The kind maps the few it needs.

## Evidence

Held by tests that each name the perturbation that fails them:

- `packages/core`: `setter-stats.test.ts` — a printed value is the start, a base replaces it, a contribution
  adds to either, a fraction and a parenthesised note read, anything else supplies nothing and warns, two
  suppliers warn, a kind declaring none is unchanged.
- `packages/ui`: `printed-scores.test.ts` — a printed target is not unassigned, its bonus is measured from the
  print, a step up goes from the print, and a typed score replaces it and clearing goes back; `character-kinds.test.ts` — every declared kind is offered, the default first, and the progression's
  label is the kind's.
- `tools/verify`: `npc-creatures.test.ts` — every `Companion` in the current corpus, built as an NPC through the
  builder, derives the six scores it prints, has no open Ability Scores decision, and survives a save and
  reopen with zero sources; a typed score replaces the print and clearing it restores it. AC, HP and speed are
  compared with the print and reported as `ℹ` lines, not asserted (a moving corpus fails only what must hold,
  ADR 0042).

Measured after it was built, against AuroraLegacy/elements at `c28ce6c`: every one of the 141 creatures derives
the six scores it prints; armour class agrees with the print on 121 (2 differ upstream, 18 print a formula), hit
points on 111 (1 differs, 29 print a formula), walking speed on 138 (3 print none as a plain number). No player
character derivation moves: the PC kind declares no `setterStats`, and `INCUDO_ORACLE_SNAPSHOT` on the base
commit's sources and `INCUDO_ORACLE_BASELINE` on this change, same checkout, give identical tables for all thirty
samples (a baseline with one difference removed fails, so the comparison was live).

**Driven in the browser build only**, not the Tauri window, macOS or Linux. The library's native folder
picker could not be driven, so the library was given an origin-private folder as test setup. In it: the
chooser offered all three kinds, an NPC started with Challenge Rating as its progress and six scores to enter,
the Triceratops closed that step at 22 / 9 / 17 / 2 / 11 / 5, a typed Strength of 24 replaced 22, a trait and
an action were added, the sheet read CR 5, AC 13, HP 95, speed 50 and proficiency +3, and the character was
saved, its card read "NPC / Monster · Challenge Rating 5", and it reopened after a reload with the same stat
block. Reopening with every source switched off was held by the tests and not driven.
