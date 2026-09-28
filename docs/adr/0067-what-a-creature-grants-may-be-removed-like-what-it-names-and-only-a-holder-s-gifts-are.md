# 0067 — What a creature grants may be removed like what it names, and only a holder's gifts are

**Status:** Accepted · 2026-09-28 · amends [0061](./0061-what-a-creature-gives-may-be-removed-from-its-npc-as-a-recorded-input.md)
decision 1 · closes the gap [0065](./0065-legendary-content-is-content-of-the-types-the-system-declares-and-a-dm-may-write-it-on-the-creature.md)'s
evidence found · builds on [0012](./0012-self-contained-saves.md), [0058](./0058-a-setter-may-name-elements-its-holder-has-and-the-kind-says-which.md)
· **format:** none; `removedGrants` is ADR 0061's, format 3

## Context

ADR 0061 let a DM take away what a creature gives its NPC: what its declared setters name (ADR 0058), and a `<grant>`
of the same id, since twelve corpus creatures give some of their traits twice. A `<grant>` of an id no setter names
was out of reach: "what a kind's `setterGrants` does not name cannot be removed", written to keep a class feature
content's.

ADR 0065 then made a user's own file the way a creature gets legendary content, and a creature in that file gives it
its legendary action, lair action and regional effect by plain `<grant>`s, as the ADR's own example does. Running it
found that an NPC or Legendary Creature built on such a creature listed "From Old Stone Drake" with Remove on the trait
and action its setters name and nothing for the three it grants. A DM who wants the drake without its lair could
not say so, though the sheet shows the lair and the save carries it.

### What the corpus holds

Measured on AuroraLegacy/elements at `c28ce6c` with a throwaway test over the shipped system's kinds (not committed):

| kind | holders (elements of a type its `setterGrants` reads) | ids their setters name | their `<grant>`s | grants of an id no setter of the same holder names |
|---|---|---|---|---|
| `pc` | **0** | 0 | 0 | 0 |
| `npc`, `legendary` | 141 (every `Companion`) | 376 | 12 | **0** |

So in the official corpus the change moves nothing: every grant a creature carries is already removable through its
setter. What it reaches is a user's file, which is where ADR 0065 sends legendary content.

## Decision

### 1. A holder's own `<grant>`s may be removed, whatever their type

An element is a **holder** when its kind declares a `setterGrants` entry on its type (`isGrantHolder`). Everything a
holder gives is removable: the ids its declared setters name and the ids of its own `<grant>`s, each once
(`holderGivenIds`). A removal still cancels only what the holder gives (ADR 0061): the same element chosen, or granted
by anything that is not the holder, is still held.

Not "only those of types the kind lists". The kind's `elementTypes` are what it *offers*, and ADR 0065 decision 7 kept
the three legendary types out of the NPC's on purpose while showing them on its sheet: a filter by listed types would
leave exactly the case that was found, an NPC's granted Tail Sweep, without a Remove. The kind has already said which
elements are stat blocks a DM shapes when it declared their setters as grants; what such an element grants is part of
the same stat block.

### 2. Nothing that is not a holder gives anything removable

`withdrawnGrantIds` answers only for a holder. A class, a race, a feat or an item is never one in 5e (the `pc` kind
declares no `setterGrants`, and the NPC's are on `Companion` alone), so a class's grant of a class feature cannot be
removed through this, not by the builder, which refuses what `holderGrants` does not list, and not by a hand-edited
`removedGrants`, which the engine and `collectCharacterContent` ignore for anything that is not a holder. An NPC given
a class feature by ADR 0064's additions holds it as content says, and whatever that feature grants stays content's.

### 3. The list groups a gift under its step, else its sheet heading

`HolderGrant.group` is the label of the build step whose types include it, else of the sheet section that lists its
type, else empty ("Other" on screen). An NPC's granted legendary action has no step (the NPC offers none) and is listed
under "Legendary Actions", as its sheet heads it. `holderGrants` is ordered so a holder's groups follow its steps and
then its sheet sections; the pane renders the groups in that order and computes nothing else.

## What this does not do

- **Content still cannot cancel content.** ROADMAP Phase 2's "one grant cannot cancel another" is unchanged.
- **A holder's grant is listed whatever its level or requirements.** Removing one is a statement about the creature, not
  about this challenge rating; `held` says whether the character has it now. No corpus creature gates a grant.
- **What a granted element grants in turn is not removable** from the holder's list: its giver is not a holder. Remove
  the element that gives it, and it goes too.

## Alternatives considered

- **Only grants of types the kind lists** (its `elementTypes`). Decision 1: the NPC's legendary gifts would stay fixed.
- **Only grants of types the kind's sheet shows.** Every creature grant in the corpus and the homebrew file passes it,
  so it would change nothing today, and it would tie what a DM may remove to how a sheet is laid out.
- **Every grant of every held element.** A class's grants would become removable, which is `overrides`' job and the one
  thing ADR 0061 ruled out.
- **Give legendary content a setter instead, so ADR 0061 reaches it.** A setter nothing in the corpus writes, added to a
  frozen format (ADR 0008), for a removal the grant can carry itself.

## Evidence

Each test names the perturbation that fails it, and each perturbation was run.

- `packages/core/src/removed-grants.test.ts`: a holder's grant by a rule alone, removed, is not held, adds nothing, is not
  embedded, and the save derives the same (fails with `holderGivenIds` reading setters only); what a non-holder grants
  is held and embedded whatever `removedGrants` records (fails with `isGrantHolder` left out, which also fails ADR 0061's
  "granted by anything else" test).
- `packages/ui/src/holder-grants.test.ts`: a creature's grants are listed under their step, or their sheet heading when
  no step offers the type, and are removed and given back (fails with the list reading setters only, and with the sheet
  heading left out of `group`); a non-holder's grant is neither listed nor removable (fails without `isGrantHolder`).
- `tools/verify/src/legendary-content.test.ts`, the real system and the homebrew file, no corpus: on an NPC and a
  Legendary Creature, everything the creature gives is listed with it under a heading, all of it removed is neither held
  nor on the sheet nor saved, and a save opened with no source reads the same (fails with the list reading setters only).
- The oracle's thirty-sample table is identical before and after (`INCUDO_ORACLE_SNAPSHOT` on the base, taken after
  `git stash -u`; `INCUDO_ORACLE_BASELINE` on the change, same checkout; a baseline with one difference taken out fails,
  so the comparison was live). No player character derivation moved, as the `pc` row above says it cannot.
- **Driven in the browser build** (not the Tauri window, macOS or Linux), with an origin-private folder standing in for
  the native folder picker and the homebrew file added by a dispatched drop on the Sources pane. An NPC on Old Stone
  Drake listed Stone Skin under Traits, Bite under Actions, Tail Sweep under Legendary Actions and Falling Rock and
  Tremors under Lair Actions and Regional Effects, each with Remove. Tail Sweep and Tremors removed, the sheet lost its
  Legendary Actions section and Tremors; saved, the card read "4 elements embedded"; reopened with every source off, the
  sheet was the same. With the sources back on, Give back returned Tail Sweep to the sheet. A Legendary Creature on the
  same drake, Tail Sweep removed, was offered it again beside Rallying Roar in its Legendary Actions set. A Player
  Character with a class showed no "From …" list. Running it found that a save with two removals opened with no source
  printed "One more was removed…" twice; it is now one line, "2 more were removed…".
