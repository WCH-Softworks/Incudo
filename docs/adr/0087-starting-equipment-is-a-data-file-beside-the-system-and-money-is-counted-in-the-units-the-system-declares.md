# 0087 — Starting equipment is a data file beside the system, and money is counted in the units the system declares

**Status:** Accepted · 2026-10-05 · built 2026-10-07 (see the note below) · answers the first half of ROADMAP Phase 3's "Starting equipment, and
an inventory the player manages" and the money its second half spends · builds on
[0005](./0005-aurora-import.md), [0006](./0006-derived-character-state.md),
[0007](./0007-native-formats.md), [0008](./0008-aurora-compatibility-frozen.md),
[0012](./0012-self-contained-saves.md), [0019](./0019-recorded-rolls-are-readable.md),
[0024](./0024-inventory-is-a-list-of-instances.md), [0072](./0072-a-build-step-may-offer-items-a-character-equips-and-what-it-takes-is-a-bag-entry.md),
[0079](./0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md)
· **format:** a new file beside the system with its own schema (not the system format); system, one optional top-level field,
`currency` (`formatVersion` stays 1); character, `money`, **format 9** only when recorded

> **Note, 2026-10-06:** character formats 9 and 10 have since been taken by [ADR 0094](./0094-a-player-character-s-written-features-only-add-and-a-feature-line-may-mark-a-row.md)
> (a feature line that marks a row) and [ADR 0097](./0097-a-2024-half-caster-s-prepared-count-is-its-spell-picks-and-an-added-spell-is-cast-through-a-block-the-user-names.md) (`additionBlocks`). When money is built it takes the next free
> version, not 9.

> **Note, 2026-10-07 — built, and what building it changed.** Measured first (`tools/verify/src/starting-equipment-content.test.ts`,
> report-only, AuroraLegacy/elements at `c28ce6c`): the counts above hold, with one correction: 11 of the 2024 book's 12
> classes write "Choose A or B" and only the Fighter "Choose A, B or C"; the last option is gold alone in all 12. And one
> finding this ADR did not have: **content writes what a pack holds in an `<extract>` block** (44 of them: the 2014 and 2024
> equipment packs and 29 2024 "Class/Background Equipment Pack (…)" items listing a package's contents less its armour and
> coins), which the parser does not read. The importer still does not; `starting-equipment.test.ts` reads the XML and holds
> every 2024 package to its pack item (129 items agree; one, the Guard's light crossbow, names an id nothing declares
> upstream). Opening a pack into its contents is the inventory editor's.
>
> - **Money and the record are character format 11**, the next free version (above). `validateCharacter` takes the system
>   when the caller has it, and only then refuses a unit it does not declare: the character alone cannot say.
> - **The answer is not recorded under `build/equipment/…` as a choice** (decision 4). A recorded choice outside a select pool
>   is a seed of the derivation (ADR 0096), and a package's items are carried, not held. It is `Character.startingEquipment`
>   instead, one record per class or background: the option, **the instance ids of the entries it added** with their
>   quantities, and the coins. That also replaces the `origin` on each entry this ADR described: one field, not two, and
>   "untouched" is every recorded entry still there with its quantity and no adornment, and the purse covering the coins.
> - **Which steps give a package, which step offers them and which item types are equipped are the file's** (`kind`, `step`,
>   `from`, `equip`), so the system format gained only `currency`. "Only the first class" is the class pick's answer, which is
>   the first class (ADR 0036); a background step's answer is the background. Equipping is in the order the package writes
>   its items, each taken when the kind's slots have room (`resolveEquipment` on the trial bag), the rest carried; within a
>   bundle fixed items come before picks, so "a martial weapon and a shield" equips the shield first.
> - **A pick names its books** (`publications`): the weapon category tags are shared by the 2014 and 2024 weapons, so "a
>   martial weapon" for a 2014 class would otherwise offer both editions' (it offers the Player's Handbook's 23).
> - **What a book lists that no element is** ("5 sticks of incense", "a pet mouse") is an option's `unlisted`, shown and
>   written nowhere. The 2024 spellbook is a Book, as the 2024 book's own Wizard pack writes it.
> - **A wealth roll is recorded once and read again**: taking the option back keeps the roll, and taking it again uses it, so
>   toggling cannot reroll for more gold.
> - **The file covers the Player's Handbooks**: 24 classes and 29 backgrounds (13 + 16). The test reports the 5 classes and
>   89 backgrounds it does not cover, by book; each says so in a sentence on Build and offers nothing.

## Context

The bag is modelled, imported, derived and saved (ADRs 0024 to 0026), armour class and attunement read it, and nothing
in either app puts an item in it. 5e's `equipment` build step declares item types and nothing to choose, so it heads no
decision and always reads complete. A character built in Incudo starts with an empty bag and keeps it.

The maintainer asked for a full step in which a character takes its class's starting items or the gold they are worth,
and for an inventory the player manages at any point after. This ADR is the first: where starting equipment comes from,
how the gold alternative is reckoned, and how money is recorded. The inventory editor is the roadmap item's second part
and gets its own ADR when it is built.

**Measured** (AuroraLegacy/elements, `.corpus/` at the time of writing):

- **Content states starting equipment only as prose.** All 29 `Class` elements and all 118 `Background` elements
  describe it in their description, and no `<select>`, `<grant>` or setter carries any of it. The 2014 Player's
  Handbook's classes write "You start with the following equipment" as lines of *(a)* / *(b)* alternatives ("(a) a
  martial weapon and a shield or (b) two martial weapons"), and none offers gold. The 2024 book's 12 write a "Starting
  Equipment" table row, "Choose A, B or C", where the last is gold alone (the Fighter's (C) 155 GP). A 2014 background
  lists its items and a pouch of coins ("a belt pouch containing 15 gp"); a 2024 one is a package or 50 GP.
- **The 2014 gold alternative is a book rule content does not carry.** The Player's Handbook gives each class a starting
  wealth roll (a number of d4s, most of them multiplied by 10, in gold) in its equipment chapter, not in the class. That
  table is in no corpus file. Classes introduced later in other books follow the same approach: the book that adds the
  class states its starting equipment and its wealth.
- **Items carry what they are and what they cost.** A weapon's category is a support tag
  (`ID_INTERNAL_WEAPON_CATEGORY_MARTIAL_MELEE`), so "a martial weapon" is a filter the engine already reads; 2,264 of
  the 2,889 item elements carry `<set name="cost" currency="gp|sp|cp">`; an equipment pack is an element of its own
  (`ID_WOTC_ITEM_DUNGEONEERS_PACK`).
- **A character records no money.** Aurora's saves write `<currency>` with five counts (copper, silver, electrum, gold,
  platinum), and the importer drops them. All thirty sample saves record 0 in every one, so no save referees a reading.

## Decision

1. **Starting equipment is a data file beside the system**, `systems/<id>/starting-equipment.json`, with its own schema
   (`schemas/starting-equipment.schema.json`) and one checker, as the official form's field map is (ADR 0079): not the
   system format, and no public API promised for it yet. It is part of the system and not of Incudo's code: the packages
   and the wealth rule are the book's, so they live with the rest of what the system says about the game, and core and
   `packages/ui` name no class, item or coin. Prose is still never parsed (ADR 0005): the file is written by a person from
   the book and checked against the corpus by a test.

2. **The file is keyed by element id**, one entry per class or background it covers (`"for": "ID_WOTC_PHB_CLASS_FIGHTER"`),
   so the 2014 and 2024 Fighters are two entries, as they are two classes. An entry is a list of **options, of which the
   character takes exactly one**:
   - **a package**: lines, in the order the book prints them. A line is a list of items (an element id and a quantity),
     **or** a choice between such lists (the 2014 *(a)* / *(b)*), **or** a pick of *n* items matching a filter written in
     the engine's own `supports` language over the item types ("a martial weapon": the martial category tags), offered
     through the character's offered view (ADR 0049). A package may also carry coins ("15 gp").
   - **coins**: a fixed amount in the system's units (the 2024 "(C) 155 GP"; a 2024 background's 50 GP).
   - **wealth**: a roll, the dice in the system's notation and a multiplier and a unit (the 2014 Fighter's 5d4 × 10 gp;
     the Monk's 5d4 with no multiplier). **This is where the book's per-class gold rule goes**: it is per class, so it sits
     in that class's entry beside its package, and a later book's class gets an entry with its own. A roll is made by
     `packages/ui`'s dice (ADR 0019: core never rolls) and **recorded in `Character.rolls`** (ADR 0007) under the step's
     key, so no redraw rerolls it and the sheet can say what was rolled.

   A 2014 class is therefore two options, its package (each *(a)* / *(b)* line answered) and its wealth roll; a 2024 class
   is three, A, B and C. Which a book offers is the file's to say; the step offers what the entry lists and nothing else.

3. **5e's `equipment` step becomes the starting equipment step**: one decision for the first class and one for the
   background, each offering its entry's options. Only the **first** class has one: the Player's Handbook gives a character
   who multiclasses no starting equipment from a later class. A class or background the file has no entry for (a user's
   own content, a book not yet written in) says so in a sentence and offers nothing; it does not block, and the inventory
   editor is the way in. The step is skippable, as a set is (ADR 0033), for a table that hands out equipment itself.

4. **Taking an option writes inputs, never derivations.** The bag and money are inputs (ADR 0006); what a package gives is
   written into them once, the way the equip step writes a bag entry (ADR 0072), and the answer is recorded under
   `build/equipment/…` so the step reads settled and a sheet or card can say what was taken:
   - each item becomes a bag entry; one that fits a free slot of the kind's inventory is **equipped**, in the order the
     package lists it (armour, then a shield, then weapons into hands), and the rest are carried. The user changes either
     afterwards.
   - each entry it adds records where it came from (`origin: "build/equipment"`), and coins are added to `money`.
   - **Taking it back** (or taking another option) removes the entries still marked with that origin and subtracts the
     coins it added, **only while the bag still holds every entry it added and the money still covers its coins**. Once
     the player has sold, dropped or spent part of it, the step says the package has been used and leaves the bag alone:
     guessing which purchase replaced which starting item is the guess ADR 0005 rules out.

5. **Money is counted in units the system declares, and the system says what each is worth in the others.** The
   system definition gains an optional top-level `currency` (the maintainer's shape): each unit by its id, with a label
   and an `exchangeRate` naming how many of another unit it is worth, as the book states it ("1 gp = 10 sp"). 5e:

   ```json
   "currency": {
     "cp": { "label": "Copper" },
     "sp": { "label": "Silver",   "exchangeRate": { "cp": 10 } },
     "ep": { "label": "Electrum", "exchangeRate": { "sp": 5 } },
     "gp": { "label": "Gold",     "exchangeRate": { "sp": 10, "ep": 2 } },
     "pp": { "label": "Platinum", "exchangeRate": { "gp": 10 } }
   }
   ```

   - **The ids are the ones content prices items in** (`<set name="cost" currency="gp">`), so an item's cost and a
     character's purse name the same units and buying needs no table of its own.
   - **A unit may state several rates**, as the book does ("an electrum piece is worth five silver, or half a gold"), and
     **the validator holds them to each other**: every rate a positive number, every unit reachable from every other
     through the rates, and any two paths between two units giving the same value (gp → sp → cp is 100, and so must any
     other route be). A system whose rates disagree is refused when it loads, with the two paths named. A unit with no
     rate is allowed only when it is the one every other reaches.
   - **Values are worked out from the rates, never written twice.** `packages/ui` (and nothing in core but the
     validator's arithmetic) reckons each unit's worth in whichever unit everything reaches, for comparing a price with a
     purse and for making change when the player asks; nothing stores that table.
   - It is the system's, not a kind's: one game has one coinage. A kind whose `inventory` exists records money; a kind
     with none (5e's NPC) does not.

   `Character.money` is a map from unit id to a whole, non-negative count, an input in the same family as `inventory`;
   it is written only when some unit is non-zero, and only then is the character **format 9** (the validator refuses
   `money` below 9, a unit the system does not declare, and a count that is not a whole non-negative number). Counts are
   kept per unit as the player holds them, never folded into one total: change is made only when the player asks the
   inventory editor to (its ADR).

6. **An Aurora import reads `<currency>`.** The five counts go to the five units by a fixed table in
   `packages/aurora-import`, written only when one is non-zero. It is a dropped construct being read, the same kind of
   bugfix to the frozen importer as the `<sheet>` descriptions (ADR 0076) and the multiclass dice (ADR 0044), and not new
   support: the save already says it. No sample records a coin, so a generic fixture holds it.

7. **A save embeds what its packages gave**, as it embeds everything in its bag (ADR 0012), and records which option it
   took; it never embeds `starting-equipment.json`, which is the system's, as `system.json` is. A save opened with no
   source reads the same bag and money; the step's offer needs the file and the content, a library card does not.

## What this does not do

- **The inventory editor**: adding, removing, buying, selling, attuning, making change. Phase 3's item's second part.
- **A user's own packages.** A user-added system is a `system.json` and nothing beside it (ADR 0031); a user's content
  file cannot carry a package. Both wait for the system-as-surface and homebrew phases (7 and 8).
- **Point-buy-style "assemble a package worth 50 GP"** with prices checked: a 2024 background's option is coins, and
  spending them is the editor's.
- **Trinkets** and other rolled-for items a background or the book offers: a line may name a specific item; a random table
  is not modelled here.

## Alternatives considered

- **Packages in `system.json`.** The system format is a public API users author (ADR 0011), and a field naming hundreds of
  corpus ids would make every user's system carry, or be refused for lacking, data about one content set. A separate file
  keeps the format small and lets the packages be redrafted without a format decision, as the form map was.
- **Parsing the prose.** 29 classes in two shapes and 118 backgrounds in more. Ruled out by ADR 0005 as everywhere else:
  a parse that reads "a martial weapon" one way in one file and another in the next fails silently.
- **Packages as content (`.incuset` or an Aurora file of grants).** A grant is permanent and derived; starting equipment
  is a one-time write into an input the player then owns. And the wealth rule is a rule of the book, not an element.
- **A single gold total.** The book and Aurora both count coins per unit, items are priced in gp, sp and cp, and electrum
  exists to be awkward. A total would lose what the player is actually carrying.
- **Each unit's value in the smallest unit** (cp 1, sp 10, ep 50, gp 100, pp 1,000), as first drafted. It cannot
  disagree with itself, but it is not how a book writes its coinage, and it forces a smallest unit on a system that may
  not have one worth naming. Rates between units read as the book does; the validator buys back the consistency.
- **Currency on a kind's `inventory`**, as first drafted. Every kind of one game uses the same coins.
- **Deriving the starting bag from the recorded choice** (so a changed choice rewrites it). The bag is something the player
  edits from the first session on; a derived starting bag would either overwrite their edits or need a second, edited
  copy beside it. Writing once and refusing to undo once used is the honest version.

## Consequences

- The 5e system gains a file a person writes from the books, entry by entry, starting with the Player's Handbooks' 24
  classes and the core backgrounds; a test in `tools/verify` holds every id in it to the corpus, reports each class and
  background in the corpus it does not cover, and checks each wealth roll and coin amount names a unit the system's `currency` declares.
- A character built in Incudo can start with a bag and a purse, so its armour class and attunement mean something from
  level 1 without an import.
- Character format 9 is written only by a character that holds money.
