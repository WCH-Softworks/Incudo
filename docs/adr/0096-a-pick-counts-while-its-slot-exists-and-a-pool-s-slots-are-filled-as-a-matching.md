# 0096 — A pick counts while its slot exists, and a pool's slots are filled as a matching

**Status:** Accepted · 2026-10-06 · amends [0064](./0064-a-character-may-carry-elements-its-user-adds-from-loaded-content-and-an-unmet-prerequisite-is-a-flag.md)
(decision 4: a pick's own requirements are asked too) and [0071](./0071-an-element-s-own-requirements-hold-it-as-well-as-offer-it-and-a-granted-element-they-rule-out-is-withdrawn.md)
(decision 3: its closed pool is one case of this one) · closes the gap [0015](./0015-class-levels.md) and
[0036](./0036-a-level-is-spent-on-a-class-by-writing-two-records.md) carried · builds on [0005](./0005-aurora-import.md),
[0006](./0006-derived-character-state.md), [0012](./0012-self-contained-saves.md),
[0017](./0017-open-decisions-not-steps.md), [0035](./0035-a-repeatable-element-counts-once-per-pick.md),
[0040](./0040-a-chosen-element-follows-the-track-of-the-element-that-offered-it.md), [0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0069](./0069-what-a-description-embeds-is-shown-in-place-and-a-save-carries-it-for-its-text.md),
[0088](./0088-a-per-level-step-may-name-the-option-that-allows-another-class.md) · **format:** none

## Context

Two open items at the end of Phase 3 ask one question: does a recorded pick still fit a slot the character actually has?

**Choices that no longer apply.** A pick is a seed of the derivation (`character.choices`), and nothing ever asked whether
the select it answered is still there. A Fighter 5 / Wizard 3 whose Wizard levels are moved to the Fighter loses the
Wizard and its multiclass record (ADR 0036, ADR 0088 decision 3 keeps the levels the user set, and moving them is the
user's act), and kept the Wizard's cantrips and spellbook: held, on the sheet, with nothing saying so. A Wizard 5 lowered
to 3 kept its level 4 improvement and the +2 it gave. ADR 0015 carried this as a known gap ("nothing prunes a pick whose
chooser has gone"), ADR 0036 again for levels, and ADR 0071 closed one case of it, the pool of a withdrawn element
(`openSeeds`), and said stale choices in general were not handled. A pick whose own requirements had since become false
was not flagged either: ADR 0064 asked that only of additions.

**Slot order and legality.** Aurora writes a growing allowance as several same-named `<select>` rules, and a pool is
keyed on (element, name) (docs/AURORA-FORMAT.md). The engine filled its rules in level order, ties in declaration order:
pick *n* went to the rule whose slots reached *n*, whatever it was. The 2014 Arcane Trickster declares its any-school
1st-level spell before its two enchantment-or-illusion ones, all at Rogue 3, so the first pick took the any-school slot:
a player who took Charm Person first was then offered only enchantment and illusion. And a pick recorded against a rule
that would not have offered it was accepted in silence, an import's included.

### Measured first

`tools/verify/src/pool-slots.test.ts`, report-only lines, against AuroraLegacy/elements at `c28ce6c` and the thirty
samples:

- **The corpus: 2,703 select pools, 89 with more than one rule**: 18 differ in `supports`, 32 in `requirements`, 7 in
  `type`, 41 in `number`. (docs/AURORA-FORMAT.md's 2,553 predates the generated improvement options.)
- **The samples: 533 records, 826 picks.** 678 picks answer a pool content declares; **148 answer a key no pool owns**:
  Aurora's own `ID_LEVEL_1/select:Race`, `…/select:Class` and `…/select:Background` (30 each), its multiclass records
  `ID_LEVEL_N/select:Multiclass (Level N)` (10), and `build/options` (27). `ID_LEVEL_N` carries no rules. Those records
  are answers Aurora's screen asked for, and must never read as stale.
- **No sample pick is stale, over its pool, or out of every slot**: 0 not opened, 0 over, 0 that no assignment places,
  and 0 that the old level-order fill put in a rule it does not fit. 9 pools hold picks that fit some of their rules and
  not others. **No held pick's own requirements are false** (the 8 multiclass samples included).
- **Reversing every pool's record**, the old fill would have put **19** picks in rules they do not fit. A matching places
  them all, and nothing derived moves.

So an Aurora import is untouched, which is what the oracle says (below): both items are about characters edited after
they were made, which only the builder can do.

## Decision

1. **A pick counts while its slot exists.** A record keyed `<element>/select:<name>`, where that element carries a
   `select` of that name, answers a *pool content declares*. Its picks count only while the character holds that element
   and the element's rules for that pool are active (level, requirements, equipped, as every rule is read), and only as
   many as the pool has slots. One that does not count is **uncounted**: `closed` when nothing held opens the pool, `over`
   when the pool is open with fewer slots than picks. Any other record (a build step's, Aurora's `ID_LEVEL_N` keys, an
   element nothing loaded declares) is an answer no pool owns and always counts. That is the line that keeps the 148.
   Core reads only the `/select:` convention `openSeeds` already read; it names no game.

2. **An uncounted pick is kept, not seeded, and not a problem.** It stays in `character.choices` exactly as recorded,
   seeds nothing, counts toward no repeat (ADR 0035: a +1 past its pool's end is no second bump), and counts again the
   moment its slot is back: Rogue 3 lowered to 2 and raised to 3 is the same character. Dropping it would destroy an input
   the user made on an edit that did not name it (ADR 0006); seeding it is the bug; flagging it as an error would call a
   character the user is in the middle of reshaping broken. It is published as `DerivedCharacter.uncounted`
   (`{ ruleKey, elementId, position, reason, from }`) and in `summarize()`, and is not a `Problem`, as a withdrawal is not
   (ADR 0071). This replaces ADR 0071's `openSeeds`: a withdrawn element is not held, so its pool is closed by this rule.
   The error `over-selected` is gone; what it reported is `over`.

   It is computed inside the fixed point, from what each pass holds: the first pass seeds every pick, as it always did,
   and each pass's holdings decide which picks seed the next, so a stale pick's own pools close a pass later (an
   improvement option, then the scores it raised). A change in what is uncounted keeps the fixed point going.

3. **Build lists them, and only the user forgets one.** `BuilderState.uncounted` (`uncountedRows`,
   `packages/ui/src/uncounted.ts`) groups them by pool under "Not counting", with one sentence each: nothing on the
   character offers the choice now; the element that offers it does not at this point; or the choice has room for *n*
   now. Each pick has Forget (`forgetUncounted`); nothing else removes one. A pool's decision shows only the picks that
   count (`countedPicks`), and answering it keeps the uncounted ones at the end of the record (`withUncounted`), so an
   edit of the pool never drops a pick it did not show. Both shells render it and compute nothing.

4. **A pool's slots are filled as a matching.** A pick fits a rule when the rule would have offered it: its type and its
   filter, as `candidatesFor` reads them, but not its own requirements (whether an element may be held is decision 6).
   Picks are placed in record order, each by an augmenting path (`placePicks`, `packages/core/src/pool-slots.ts`, Kuhn's
   algorithm), so a placed pick may move to another rule it fits and is never displaced for good: an earlier pick keeps a
   slot. What an open pool offers is the union of the candidates of every rule a further pick could go into: a rule with a
   free slot, or one whose slot holds a pick that could move to such a rule. So taking Charm Person first leaves the
   any-school slot open, and once Magic Missile takes it only enchantment and illusion are offered. The level a pending
   pool reports (ADR 0017) is that of the first rule with a free slot. A pick nothing loaded declares, and a rule whose
   filter has a term nothing resolves (ADR 0030), fit: the engine cannot tell, and a flag it cannot stand behind is a guess
   (ADR 0005).

5. **A pick no assignment can place is counted, held and flagged, never refused.** While the pool has room it takes a
   slot and is a `choice-unplaced` warning naming the pick and the choice; past the pool's end it is `over`. The builder
   marks it on its slot (`SettledPick.unplaced`, `unplacedNote`). An import that holds one keeps it: the frozen importer
   writes what Aurora wrote.

6. **A pick that counts and whose own requirements are now false is a `requirement-unmet` warning**, asked as an
   addition's is (ADR 0064 decision 4, amended): against the finished derivation, the element counted as not held, once
   per element. It still counts. Picks were offered only while their requirements held, so a later edit moved them.

7. **A save embeds the element whose pool a record names, for its selects only** (ADR 0069's text frontier): usually
   reached anyway, but not once what offered it is gone, and a save opened with no source would then read the record as
   one no pool owns and count it. Followed in full it would carry everything a gone class grants.

## Consequences

**Good**
- Moving a class's levels away, lowering a level, or changing a race or class takes the old picks off the character and
  says so, and putting it back restores them. Nothing is lost on a toggle.
- The order picks are made in no longer decides which slots are left, and a pick no slot offers is visible.
- No sample moves: the oracle's table is identical before and after (`INCUDO_ORACLE_SNAPSHOT` on the base commit,
  `INCUDO_ORACLE_BASELINE` on this change).

**Bad / accepted**
- Two stale picks that each open the other's pool keep each other counted: the fixed point starts from every pick. None
  is known in content; finding one would want a least fixed point, which costs a pass per link of every chain.
- A derivation runs one pass more per link of a stale chain (pick, then what only it opened).
- `poolSlots` and the uncounted check run `selectPools` again for elements that own a recorded pool, once per pass.
- What `over` drops is the latest picks no slot takes, not "the slot the level opened": a record does not say which slot
  a pick was made under (Aurora's does, and the importer keeps only the order).

## Alternatives considered

**Drop a stale pick when the edit that orphaned it is made** (as `dropClosedAnswers` does when the user removes an
addition or takes back an equipped feature). Those are removals the user aimed at the thing; moving a level or lowering
one is not, and the user may undo it a second later. Data loss on a toggle, as ADR 0088 refused for the option.

**Keep seeding a stale pick and flag it.** The character would keep what it no longer has, with a warning beside it.
The roadmap item's title is that they stop counting.

**Record the slot a pick was made under.** Aurora does (`requiredLevel`, `number`). It would let `over` drop the pick of
the level that went, and would be a character format change for a question the matching already answers: which picks
the remaining slots can take.

**Refuse a pick no slot offers at `setChoice`.** An import or an older save already holds what it holds, and a refusal
hides the record rather than showing it.

## Evidence

`packages/core/src/pool-slots.test.ts` (the matching on its own; the any-kind slot taken first; the order of picks; a
pick no slot takes, held and flagged; a lowered level leaving a repeat counted once; a record no pool owns),
`packages/core/src/engine.test.ts` (a pick past the pool's end; a chooser gone and what only it opened, back when it is
back), `packages/core/src/additions.test.ts` (a chosen element's prerequisites), `packages/ui/src/uncounted.test.ts` (listed,
worded, forgotten, kept through an edit of the pool) and `tools/verify/src/pool-slots.test.ts` (the measurements above,
every sample's records reversed changing nothing, a 2014 Arcane Trickster through the builder, a Wizard 5 lowered to 3,
a Fighter 5 / Wizard 3 whose Wizard levels go to the Fighter, saved and reopened with no source). Each fails under its
named perturbation, and each was run: a placed pick never moved, only rules with a free slot offered, a pick's fit ignored
(the old level-order fill), every pick seeded, repeats counted from every pick, every unowned record closed,
`choice-unplaced` not reported, the pool's element not embedded, `withUncounted` dropping what waits, the builder listing
nothing.

Driven in the browser build: a 2014 Human Rogue 3 took Arcane Trickster and Charm Person first and was still offered Magic
Missile, then only enchantment and illusion; lowered to 2 its archetype and both spells were listed under "Not counting"
and came back at 3; a Wizard level added, three cantrips and two spellbook spells taken, and the level moved to Rogue
listed all five, Forget removed one, and moving it back counted the rest with one cantrip slot open; the Rogue 4
improvement and its two +1s, lowered to 3, listed. DOM clicks, no screenshots (the pane did not paint). Not driven on the
phone or in the Tauri window.
