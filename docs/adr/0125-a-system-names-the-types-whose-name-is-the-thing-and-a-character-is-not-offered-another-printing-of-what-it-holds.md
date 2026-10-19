# 0125 — A system names the types whose name is the thing, and a character is not offered another printing of what it holds

**Status:** Accepted · 2026-10-19 · answers the UX pass's B2 ("the same spell can be taken twice from two printings") and
B6 ("identical duplicate rows in a picker") · amends [0091](./0091-an-offer-that-would-give-what-the-character-already-has-is-marked-and-the-system-says-which-types.md)
(a candidate granting another printing of what is held is marked),
[0064](./0064-a-character-may-carry-elements-its-user-adds-from-loaded-content-and-an-unmet-prerequisite-is-a-flag.md)
(an addition that is another printing of what is held is marked) · builds on [0035](./0035-a-repeatable-element-counts-once-per-pick.md),
[0046](./0046-preparing-spells-is-a-recorded-list-per-casting-block-and-the-rest-is-derived.md),
[0049](./0049-a-character-records-which-publications-it-is-offered-and-it-narrows-offers-only.md),
[0096](./0096-a-pick-counts-while-its-slot-exists-and-a-pool-s-slots-are-filled-as-a-matching.md) · **format:** system
format `identifiedByName` on an element type (`formatVersion` stays 1); no character format change

## Context

AuroraLegacy carries the 2014 and 2024 printings of the same spells, feats, languages and more as different elements
with different ids. A UX pass took "Acid Splash — Player's Handbook" for a caster's first cantrip and then "Acid Splash —
Player's Handbook (2024)" for its second, and the Sheet listed Acid Splash twice. "A pool never offers what the character
already has" compared ids, and the two printings share none. Aurora's own builder has the same problem.

The maintainer's direction: an element keeps its real id and also has an identity shared across printings. Both
printings stay visible in a list, because a spell can differ between books, but once one is picked the other is no
longer offered, and a held one marks the other.

The same pass found the NPC's Traits list showing "Agile — Monster Manual (2025)" twice, identically.

**Measured first** (`tools/verify/src/printings.test.ts`, report lines, at `c28ce6c`):

- **2,625 names are declared by more than one element of a type** (6,780 elements). **2,238 of them across books**: 430
  spells, 372 magic items, 245 subclass features, 225 lists, 214 items, 154 racial traits, 82 feats, 78 class features,
  and the rest.
- **550 names are repeated within one book**, and they are not reprints: 203 internal grant markers, 102 subclass
  features, 36 racial traits, 24 class features, 19 creature traits (a deer's Agile and a rat's), and **4 feats**, each a
  feat content prints several times on purpose so it can be taken again (Elemental Adept five times in each Player's
  Handbook, Skilled nine times and Magic Initiate three in the 2024 one, the 2024 Ability Score Improvement eight). No
  spell, language or proficiency name repeats within a book.
- **How alike a cross-book pair's text is** (words shared over all words): of 452 spell pairs, 312 alike (≥ 0.6), 118
  revised, 22 rewritten; the rewritten ones are still the spell of that name (Blade Ward, True Strike, the Conjure
  spells, a UA spell revised three times before Tasha's printed it). Feats: 74 alike, 81 revised, 11 rewritten (the 2024
  Alert, Lucky, Keen Mind). Class features, racial traits, creature actions and feat features are mostly *not* alike:
  "Spellcasting", "Ability Score Improvement" and "Extra Attack" are a different feature in every class, and the samples
  hold two of them 20 times (every class's Ability Score Improvement; a Paladin/Sorcerer's two Spellcastings).
- **Content links printings itself, partly**: 386 requirements name an element of the element's own type and name,
  almost all as "not if the character has that one". 161 are feats (48 of the 82 feat names across books are linked,
  Telekinetic to its three other printings), 115 class features (the 2024 invocations against the 2014 ones), 11
  proficiencies (8 of 9 names), 2 languages (Draconic; 1 of 6 names), and **no spell**. A link is one direction as
  often as not. It is a filter on the offer, which already works where it is written; it is not enough to say what a
  spell is.
- **The samples hold two of one name 21 times**: 20 class features and one feat feature. None is a spell, feat,
  language or proficiency from two books, so nothing derived for them moves.
- **The NPC's Traits offer**: 146 traits, 55 rows reading exactly as another one does by name and book.

## Decision

1. **A system names the element types whose name is the thing: `identifiedByName: true` on an element type** (system
   format, optional, `formatVersion` stays 1). Two elements of such a type are **printings of one thing** when their
   names match (ignoring case and surrounding space) **and their books differ** (`source`, ignoring case). Within one
   book a repeated name is two things: that is how content prints a feat that may be taken again. 5e marks **Spell, Feat,
   Language and Proficiency**, the types whose name is what a player means and whose cross-book pairs read as one thing;
   not Class Feature, Racial Trait, Archetype Feature, a creature's traits or items, whose names are shared by different
   things. Core names no game: `printingTypes`, `printingKey`, `isOtherPrinting` and `HeldPrintings`
   (`packages/core/src/printings.ts`) are the only readers.

   Not name and type alone: that would make every class's Ability Score Improvement one feature, and the deer's Agile
   the rat's. Not content's own links alone: no spell has one. Not text similarity: a threshold is a guess, and the
   rewritten pairs are the same spell.

2. **A pool does not offer another printing of what the character holds.** `collectPendingChoices` widens "never offers
   what the character already has" from the id to the thing, for both an open pool and a full one. An element the kind
   lets be taken again (`repeatableSetter`, ADR 0035) is offered again, as before. A printing the pool's *own* pick holds
   is left out of the pool and published as `otherPrintings` on the pending or answered choice: **the slot holding the
   Player's Handbook's Acid Splash may change to the 2024 one**, a change of book, and no other slot is offered it.
   `SettledPick.printings` (`use-character-builder.ts`) says which candidates are printings of which thing, and
   `slotOptions` (`build-view.ts`) reads it, so both shells keep two slots from holding one thing.

3. **The offer to prepare does not include another printing of what the block prepares**: Bless is prepared once,
   whichever book. The filter is the builder's (`preparationOptions`), not the pool's: `preparationPool` stays the
   class's whole list, both printings on it, because Aurora lists both and the oracle holds Incudo's list to Aurora's
   (filtering the pool was tried first, and failed the oracle on six samples: 55 spells Aurora lists that Incudo
   "neither holds nor offers"). Preparing one is not refused (`planPrepare`): a list holding two is over nothing and
   derives as it did.

4. **A character holding two printings is warned, never changed.** `printing-twice` (a warning: "Acid Splash is held
   twice, from Player's Handbook and Player's Handbook (2024). It is one spell printed in more than one book.") once per
   thing; both stay held and derive as they did. A save made before this, or one that holds both by grants, opens
   exactly as it did. Not dropped: which one the user meant is not knowable, and ADR 0096's rule holds, only the user
   forgets a pick.

5. **A held printing marks the other where an offer is not a pool.** An addition (ADR 0064, anything whatever its
   prerequisites) still offers the other printing, marked "already has it from Player's Handbook"
   (`AdditionOption.heldFrom`, `additionOptionLabel`). A candidate that would grant another printing of something held is
   marked as ADR 0091 marks one granting the same id: "The character already has Perception".

6. **Two rows a picker would print the same are told apart by what gives them** (`candidateLabel` given the index,
   `candidateGiver`): when another element shares an element's type, name and book, the label names the first element
   whose grant or setter names it: "Agile (from Deer) — Monster Manual (2025)" and "Agile (from Rat) — …". Built once per
   index. An element nothing names keeps its plain label. The NPC's Traits offer goes from 55 duplicate rows to 0.

## Consequences

- **The derivation is unchanged for every character that holds no two printings.** The samples hold none, the oracle's
  tables are identical, and `summarize()` moves only for a character holding two, by the warning.
- A Wizard who takes Elemental Adept from the Player's Handbook is still offered its four other Player's Handbook copies
  (fire, then cold), and no longer the 2024 book's five.
- A list shows both printings until one is taken: the user still chooses which book's text they play by.
- Content's own "not if it has that one" links keep working as filters; for the marked types they are now also implied
  in the other direction.
- **Not done:** class features and other types whose names are shared by different things (the 2014 and 2024
  invocations are linked by content for the offer; a feature's two printings held by grants are not warned); the Sheet
  still lists both printings of a thing a character holds twice, beside the warning; Browse shows every printing, as it
  shows everything loaded.

## Evidence

- `packages/core/src/printings.test.ts`: the key, the pool (open, full, its own slot, held from elsewhere), a type not
  identified, the warning, repeatable elements, a system marking nothing. Each case fails under its named perturbation
  (the pool offering printings, the book ignored, no warning, every printing treated as held elsewhere).
- The oracle (`aurora-oracle.test.ts`) and the rebuild of every sample (`builder-rebuild.test.ts`) are unchanged by
  this; they are what refused a filtered `preparationPool`.
- `packages/ui/src/printings.test.ts`: the open decision and the settled slot, a second slot never offered a printing of
  the first's answer while a same-book copy is, an addition marked, a candidate's grant marked, the giver in a label.
  Each fails under its named perturbation.
- `tools/verify/src/printings.test.ts`: the measurement above, and against any corpus a 2014 Wizard's cantrips (Blade
  Ward from the Player's Handbook taken, the 2024 one gone from the decision and offered to its slot), a 2014 Cleric's
  prepared list, and every pool of the thirty samples offering no printing of what the sample holds (535 pools).
