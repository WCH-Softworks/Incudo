# 0064 — A character may carry elements its user adds from loaded content, and an unmet prerequisite is a flag

**Status:** Accepted · 2026-09-26 · builds on [0005](./0005-aurora-import.md), [0006](./0006-derived-character-state.md),
[0012](./0012-self-contained-saves.md), [0032](./0032-a-build-step-may-offer-a-set.md),
[0045](./0045-a-class-split-is-one-input-and-an-unmet-ability-score-minimum-is-a-flag.md),
[0049](./0049-a-character-records-which-publications-it-is-offered-and-it-narrows-offers-only.md),
[0063](./0063-a-character-may-carry-features-its-user-writes-which-add-to-a-stat-or-set-where-it-starts.md) ·
**format:** an optional `additions` on a character, `formatVersion` **5** when present; an optional `additions` on a
character kind in the system format (`formatVersion` stays 1)

## Context

A DM puts things on a character that no build step offers: a guard resistant to fire, a villain given the Alert
feat, a player character who learned Draconic from a quest reward, a spell granted by a boon. Aurora
Builder had no place for this either; its users wrapped each one in a homemade item, its "additional features",
which then had to be carried, equipped and sometimes attuned, and was listed with the character's gear.

ADR 0063 is the sibling of this: a feature the user *writes*. This is an element that *exists*, declared by a
loaded source, put on one character.

Most of the machinery is there. A set step (ADR 0032) records elements under `build/<stepId>`; a recorded
element seeds the derivation, is embedded in the save, and opens the selects it carries (a feat such as Skilled
opens its own three choices). Three things stop a set step from being the answer, measured on AuroraLegacy/elements
at `c28ce6c`:

- **A set step offers only what the character qualifies for.** It filters by the element's own `requirements`,
  as a top-level pick does. 249 of 320 feats carry requirements, and so do 773 of 1,161 class features, 626 of
  1,916 subclass features, 42 of 201 proficiencies and 47 of 1,079 spells. A DM deliberately giving an NPC a
  feat is not offered most feats; being offered only what the rules allow is right for a build step and wrong for
  a DM's hand.
- **A set step's decision is open while anything is left to add.** Offering every feat, spell and condition as a
  set would put a decision in every character's Open decisions until skipped.
- **A set is a recorded choice, and choices are read by what they hold.** `pickAnswerOf` answers a race, class or
  background from any record holding an element of the step's types (an imported save keeps its race under
  Aurora's key), `replacePickAnswer` drops a record made entirely of those types, and `firstClassOf` finds the
  first class the same way. Any record holding the wrong type is claimed, and every new reader of `choices` has
  to know to leave this one alone.

And the engine declares a `requirement-unmet` problem it has never emitted, so an element held whose own
prerequisites fail is silent.

## Decision

### 1. A character records the elements its user added, and only format 5 does

`Character.additions` is a list of element ids, in the order added, absent when empty. An input with no formula,
in the family of `inventory` and `customFeatures` (ADR 0006): nothing derives that the DM made this guard
resistant to fire. It is **not a choice**, so nothing that reads `choices` (a top-level pick, the first class, a
multiclass record, a set step's own key) can find or claim it.

A character that records one is `formatVersion` **5** (`raiseFormatVersion`), and only such a character: a
reader of 4 would drop the field, and the NPC it reopened would lose its resistance, without a word (ADR 0060's
reasoning, and 0063's). Removing the last leaves the version where it is: nothing downgrades. The validator
refuses the field below 5, and an id recorded twice.

### 2. A kind says which types may be added

A character kind may declare `additions: { "types": [...] }`, replaced rather than merged along `extends`. A kind
that declares none carries none. Core names no type; 5e's player character and NPC both declare **Feat, Racial
Trait, Class Feature, Subclass Feature (`Archetype Feature`), Background Feature, Proficiency, Language, Condition
and Spell**, and the legendary creature inherits the NPC's.

Left out, on purpose: what a character *is* or builds through a step of its own (race, class, subclass,
background, creature, campaign option), because several readers find those by type and an added one would be a
second race nothing chose; items, which are the bag's (ADR 0024); and the small types no sheet shows (`Vision`,
`Feat Feature`). Adding one later is one line in `system.json`.

The NPC's sheet gains two sections, **Feats and Features** and **Proficiencies and Conditions**, because an NPC's
sheet listed only a creature's traits, actions, reactions and spells, and an added feat would have been on the
character and on no sheet. The player character's sheet already lists all nine types.

### 3. The derivation holds an addition, and flags one whose prerequisites fail

An added element is a **seed**, like a choice, and is expanded at once: it belongs to no class, so it is on no
track, and a level gate on it reads the character's own progression. What it grants, and what its selects are
answered with, follow as they would for anything held.

After the fixed point, each held addition's **own requirements** are evaluated against the finished derivation,
counting the element itself as not held (a requirement is a question asked before taking it, and "does not
already have this" must not fail because it now does). A false one is reported as `requirement-unmet`, a warning:
"Alert was added to this character, and its prerequisites are not met." That is the code the engine declared and
never used. **Never a refusal**, which is ADR 0045's rule: the element is held, its rules apply, and the flag
clears when the prerequisite comes to hold.

Only additions are checked. A picked element was offered only when its requirements held, and a granted one is
content's statement; checking every held element is a different question, and would add problems to derivations
this change otherwise leaves alone.

An added element of a type the kind does not list (a system updated since, or a hand-edited file) is reported
(`addition-not-allowed`) and **not held**, the way ADR 0063 treats a feature on a kind that carries none: the kind
is the authority on what may be added, and holding it anyway is a guess. An added id nothing loaded declares is
`unresolved-element`, an error, exactly as a vanished choice is.

### 4. A save embeds what was added

`collectCharacterContent` seeds from `additions`, so the elements and everything they reach are copied into
`content.json` and a save opens and derives the same with no source (ADR 0012).

### 5. The Build pane adds and removes; it is not an open decision

A section of its own in the settled column, **Added to this character**, shown for a kind that declares
additions. It lists what was added, each with its type, a Remove control, and, when its prerequisites are not
met, the flag. What the prerequisite *is* content states only in prose, inside the description (475 elements write
"Prerequisite: …" there, and none as a field of its own), so it is read where any description is, by resting on the
row, and never parsed out. Below, a type filter and the
searchable picker every other list uses, over **every element of the declared types, whatever its own
requirements say**, less what the character already holds. Each option says whether its prerequisites are met, so
a DM sees it before adding.

It reads the offered view (ADR 0049): a book switched off for this character is not offered here either. What
was added from it stays and is listed.

**Removing takes the element off the character, and the answers its selects were given with it.** Otherwise a
removed Skilled would leave its three skills recorded, still seeding the derivation. The rule is exact rather than
by name: a recorded choice is dropped when its pool existed before the removal and no longer exists after it,
repeated until nothing more closes. A pool something else still opens keeps its answers.

The view-model is `packages/ui/src/additions.ts`, under `node --test`; `Additions.tsx` computes nothing.

### 6. A spell added this way belongs to no casting block

It is listed with the character's spells on the sheet, and it has no save DC, attack bonus or slots of a block's,
cannot be prepared, and is in no block's list. The pane says so. Inventing a block for it is the guess ADR 0005
declines; giving an added spell a way to cast is its own question.

## Alternatives considered

- **A `multiple` build step with no requirement filter.** Most of the machinery is there, and it is what ADR 0032
  is for. Declined for the three reasons in Context: it would be an open decision on every character until skipped,
  a set is a choice that type-finding readers can claim (and each new such reader would need telling), and a set
  step has no way to say an element was put there regardless of its prerequisites, so it could not flag one. A
  set step that stopped filtering would also stop filtering where it should: an NPC's traits and actions.
- **A choice record under a reserved key** (`added`, say). No format change, and a reader of 4 would still derive
  it. But every reader of `choices` that finds a record by what it holds would need the key excluded, the engine
  would have to know a magic key to flag it, and a reader of 4 opening it in a builder would offer it as the answer
  to the first pick whose type it holds. A field of its own is out of all of those by construction.
- **Aurora's way, items.** An item is carried and equipped, can need attunement, embeds a made-up item, and is
  listed with the gear. It is the workaround this replaces.
- **Filter the offer by requirements and allow an override.** A DM adding a feat to an NPC is not asking for
  permission; the flag says what the rules would have said.

## What this does not do

- **No casting for an added spell**, above.
- **No reuse across characters.** Adding Alert to three NPCs is three adds. The user's own reusable library is
  ROADMAP Phase 8.
- **No removal of what content grants.** Taking away a creature's own trait is ADR 0061's, for a creature's
  setters; taking away what a class grants is not offered.
- **No "added since" or duration.** A condition is on the character until removed; nothing ends it.

## Evidence

- `packages/core/src/additions.test.ts`, over a fixture with no game in it: an addition is held and its rules
  apply, its grants reach and its select opens, its level gate reads the character's progression on a
  multiclassed character; an unmet requirement is flagged and still held, and clears when it comes to hold; a
  requirement that the element not be held does not flag it; a type the kind does not list and a kind with no
  declaration hold nothing and report it; the save embeds it and derives the same with no source; the format is
  raised to 5 and never lowered. Each names the perturbation that fails it, and each was run.
- `packages/ui/src/additions.test.ts`: the builder offers every element of the declared types whatever its
  requirements, less what is held, and narrows by publication; adds and refuses (undeclared type, held,
  unknown); rows carry the flag; removal drops the answers of the selects it closed and
  keeps those another element still opens; an addition of a pick step's type is not taken as that step's answer.
- `tools/verify/src/schemas.test.ts`: format 5 with additions validates; additions at 4 and a repeated id are
  refused; 6 is refused.
- `tools/verify/src/additions.test.ts`, over every element of every declared type in the current corpus, for the
  player character and the NPC: each is offered, held once added, flagged exactly when its own requirements fail,
  and a character holding every element of a type saves and reopens with no source to the same derivation. How
  many there are and how many carry prerequisites move with the corpus and are reported, not asserted (ADR 0042).
- The oracle's thirty-sample table is identical before and after (`INCUDO_ORACLE_SNAPSHOT` on the base,
  `INCUDO_ORACLE_BASELINE` on the change): no player character derivation moved.
- Driven in the browser build (not the Tauri window, macOS or Linux): a Black Bear NPC given Elven Accuracy (flagged,
  and reported under Problems) and Resistance to Fire Damage, both listed on its sheet under the two new sections; a
  player character given Heavy Armor Master (flagged), Skilled and Fireball, with Race, Class and Background still
  open and Skilled's own skill choice opened. Answering that choice and then removing Skilled took the answer off the
  character. Fireball is listed with the spells. Both saved to the library and reopened with the content source
  switched off: the same rows, flags, problems and sheet.
- **What running it found.** The corpus's 23 `Condition` elements are damage resistances and immunities; there is no
  Blinded or Charmed element to add, so a condition in the rules' sense is still text. And "Background Feature" had
  no plural label, so the type filter read oddly beside "Feats" and "Spells"; `system.json` now gives it one.
