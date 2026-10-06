# 0097 — A 2024 half-caster's prepared count is its spell picks, and an added spell is cast through a block the user names

**Status:** Accepted · 2026-10-06 · amends [0046](./0046-preparing-spells-is-a-recorded-list-per-casting-block-and-the-rest-is-derived.md)
(decision 8: the Wizard's minimum, and what it said of the 2024 Paladin and Ranger) and
[0064](./0064-a-character-may-carry-elements-its-user-adds-from-loaded-content-and-an-unmet-prerequisite-is-a-flag.md)
(decision 6: an added spell belongs to no casting block) · builds on [0005](./0005-aurora-import.md),
[0006](./0006-derived-character-state.md), [0012](./0012-self-contained-saves.md), [0018](./0018-tables-and-track-stats.md),
[0020](./0020-stats-keyed-on-declared-blocks.md), [0022](./0022-kinds-contribute-systems-do-not-ship-content.md),
[0030](./0030-a-declared-block-answers-a-filter.md), [0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0060](./0060-a-character-may-leave-its-progression-to-what-it-chose-and-that-is-format-3.md),
[0079](./0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md) ·
**format:** an optional `minimum` on a kind's `preparation` and an optional `blocks` on a kind's `additions` in the system
format (`formatVersion` stays 1); an optional `additionBlocks` on a character, `formatVersion` **10** when present

Two open roadmap items, one at the end of Phase 3 and one at the end of Phase 4, both about casting blocks and the
prepared lists of ADR 0046. They are two decisions and are recorded apart: **A** is what a block may prepare, **B** is
which block an added spell belongs to. A was settled first, so B meets the corrected limits.

---

## A. The 2024 Paladin's and Ranger's prepared count is their spell picks, and every preparing block prepares at least one

### Context

ADR 0046 said the 2024 Paladin and Ranger prepare from a fixed table content does not carry, and left them out. The
maintainer corrected the first half: both classes print a **Prepared Spells** column, level by level, in the Features
table of their class description. The roadmap item that followed reasoned that, since the column is prose and not a
`…:spellcasting:prepare` stat, "both read a limit of 0 and anything prepared is over it", and expected a table in the
system definition. And the book gives a 2014 Wizard (and Cleric, Druid, Paladin, Artificer) "a minimum of one" prepared
spell, which content does not state.

### What was measured

`tools/verify/src/prepared-counts.test.ts`, against AuroraLegacy/elements at `c28ce6c`. The column is read from each
class's description **for the measurement only**, by the test, and compared with what content's rules say.

| 2024 class | `prepare` on its block | its Prepared Spells column | what content states |
|---|---|---|---|
| Wizard, Cleric, Druid | `true` | 4, 5, 6, 7, 9, … 22 (Wizard to 25) | a `<class>:spellcasting:prepare` table of `+N` rows; Incudo's limit equals the column at all 20 levels |
| **Paladin, Ranger** | none | 2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15 | a `Spell (Paladin)` / `Spell (Ranger)` select on the block, `number="2"` at level 1 and more at 2, 3, 4, 5, 7, 9 (2), 11, 13, 15, 17 (2), 19: **its allowance equals the column at all 20 levels** |
| Bard, Sorcerer, Warlock | none | (their own) | the same: the `Spell (…)` / `Spellcasting (Warlock)` select's allowance equals the column at all 20 levels |
| Eldritch Knight, Arcane Trickster | none | from level 3 | the same, from level 3 |

So **content does carry the count**, in the shape it uses for every 2024 caster that is not a Wizard, Cleric or Druid: a
spell select whose slots open level by level, attached to the block (`spellcasting="Paladin"`) with `allowReplace`.
What the book calls the prepared list is what those picks hold, and "replace one spell on your list after a Long Rest"
is changing a pick, which the builder has always allowed (ADR 0017's settled picks). Aurora's screen reads 0 prepared for
them for the same reason: there is no prepared list, there are picks.

And **Incudo already offers exactly that**, through the builder (the same test): a fresh 2024 Paladin is owed 2 spells at
level 1, 6 at 5, 9 at 9 and 14 at 17, and the Ranger the same, of their class's list and of a level they have slots for.
Neither has a `PreparedBlock`, so nothing reads a limit of 0 and nothing can be over it. The two samples holding them
(a 2024 Ranger 5; a 2024 Paladin 3 / Sorcerer 3) hold their picks and no prepared list, and Aurora's screen agrees.

The premise of the roadmap item was the premise of ADR 0046: that a prepared count must be a `prepare` stat. It need not.

**The minimum.** Every 2014 preparing class's limit is "ability modifier + class level (or half)", which reads 0 or less
for a low score at a low level (a level 1 Wizard with Intelligence 8 reads 0); the book says one. No sample reaches it
(every sample's limit is 3 or more), so the oracle cannot see it. The 2024 tables never read below 4.

### Decision

1. **No table in the system definition.** A second copy of a number content states, with a class's ids or names in
   system data, is the stale copy CLAUDE.md warns about twice and the guess ADR 0005 rules out; and it would have to
   reach the 2024 Bard, Sorcerer, Warlock, Eldritch Knight and Arcane Trickster too, all of which content shapes the same
   way. A 2024 Paladin's or Ranger's prepared spells are its picks through its block's spell select, counted by that
   select's slots. Nothing about them is added to `preparation`, and they are not made into preparing blocks.
2. **What the builder and the sheet show is unchanged and correct**: "Spell (Paladin)" owes the table's number, and the
   Sheet lists the picks under Spells by level. They are not marked "prepared" on the Sheet: content's shape is the 2014
   Sorcerer's, and telling the two apart would be reading the edition, which nothing in the format says.
3. **A kind's `preparation` may declare `minimum`** (a whole number), and a preparing block's limit is then never below
   it. 5e declares 1. It applies to every preparing block, since the book states it for every 2014 preparing class and the
   2024 tables never read below it. Core names no class: "at least N" is arithmetic on a number a system names. The
   validator refuses a negative or fractional one.
4. `prepared-counts.test.ts` holds both against any corpus that has the classes: the builder owes each 2024 class of this
   shape its column's count at every level (Paladin and Ranger asserted, the column typed from the book, the others
   reported), the 2024 Wizard's, Cleric's and Druid's limits equal their columns, and a 2014 Wizard with Intelligence 8
   prepares one.

### What it cannot verify

- The column read out of the description in the test is a reading of prose used to check, never at run time.
- No sample has a limit below 1, so the minimum has no referee, Aurora's or a person's.

---

## B. An added spell is cast through a block the user names, and is always prepared there

### Context

ADR 0064 lets a user add a spell to a character from loaded content, and left it in no casting block: no save DC, attack
bonus or slots of a block's, not preparable. The kind's description says so. A DM giving a player a boon spell, or a
Wizard a spell copied from a scroll, had no way to say what it is cast as.

What "belonging to a block" means in the engine, measured: a spell's block is read in exactly one place, the prepared
lists (ADR 0046's `attached` and `always`). A block's save DC, attack bonus and slots are stats of the block (ADR 0020),
shown once per block on the Sheet, and are the same for every spell of it. So casting an added spell through a block is
two things: it is on that block for preparation, and the sheet says which block it is cast as, beside the rows that
block's DC, attack and slots already have.

### Decision

1. **A character records which block each added element is cast through: `Character.additionBlocks`**, a map from an
   added element's id to the lowercased block name (the key `Character.prepared` uses, ADR 0046). An input with no
   formula. Absent when empty. A character that records one is `formatVersion` **10**, and only such a character
   (`raiseFormatVersion`): a reader of 9 would drop it and the spell would quietly stop being prepared, the reasoning of
   ADRs 0060–0094. Nothing downgrades. The validator refuses it below 10, and a key that is not among `additions`.
2. **The kind says which added types are cast through a block**: `additions.blocks: { types, label, with, none }`.
   `types` must be among `additions.types`; `label` heads the control on Build; `with` is the sheet's words for one cast
   through a block (`{name}` the block's name as content wrote it); `none` the words for one cast through none. Core names
   no type and no game: a block is ADR 0020's declared block. 5e's player character and NPC declare `Spell`, "Cast as",
   "cast as {name}" and "cast through no class".
3. **The user chooses, and the only block is chosen for them when there is one.** Adding an element of such a type to a
   character holding exactly one declared block records that block (`addElement`); with several, nothing is recorded and
   the row asks for one; with none, nothing. The user may change it to any block the character holds, or to none. It is
   recorded rather than derived "the only one" each time, so a class taken later never moves a spell already added.
   Removing the addition removes its record.
4. **The derivation attaches it as content attaches a granted spell with the `prepared` marker**: on a preparing block it
   is **always prepared** and counts against nothing. The user added it to be cast; preparing it as well would be a
   second step with no rule behind it, and the book's own gifts of spells (a feat's, a subclass's) are always prepared.
   On a block that does not prepare it is simply one of the block's spells. `DerivedCharacter.additionBlocks` publishes,
   per held addition with a block, the block's name as content wrote it, and it is in `summarize()`. A record naming a
   block no held element declares (a class taken off) is the warning `addition-block-missing` and attaches to nothing; one
   on an element of a type the kind does not cast through a block is `addition-block-not-allowed` and is ignored. Neither
   is a refusal, and neither record is pruned.
5. **The sheet says it**: a listed element that is an addition of a cast type carries `SheetListedElement.cast`, the
   kind's words, and `listedAside` writes it after the group and the mark: "Level 1, always prepared, cast as Wizard",
   "Level 2, cast through no class". The pane, the print, the Markdown export, the phone and the official form's spell
   lines all read `listedAside`, so all of them show it. The block's own DC, attack and slots are its rows, as before.
6. **Build**: each added row of a cast type has a choice of the blocks the character holds, and none
   (`AddedRow.block`, worded in `packages/ui/src/additions.ts`); the desktop's `Additions.tsx` and the phone's
   `BuildExtras.tsx` render it. `CharacterBuilder.setAdditionBlock(id, key | undefined)` writes it, refusing an element
   that is not an added one of a cast type and a block the character does not hold.
7. **A save opens with zero sources and says the same**: the block's name comes from the class element that declares it,
   which the save embeds already.

### Alternatives considered

- **Derive the only block, record nothing.** No format change. But adding a second class would silently move a spell
  out of the first's prepared list, and two classes would leave every added spell in none until something was recorded
  anyway.
- **Preparable, not always prepared.** On a Wizard it would join the book; on a Cleric it would fail the list filter
  unless it happened to be a Cleric spell, and be listed as not preparable. The user would add a spell and still not be
  able to cast it.
- **A grant on a custom feature (ADR 0063).** A written feature carries numbers, not grants; teaching it grants is a much
  larger change than a map.

### What it cannot verify

- Nothing in Aurora's format records an added spell, so there is no referee: the evidence is the unit tests, each failing
  under its named perturbation, and a drive in the browser build.
