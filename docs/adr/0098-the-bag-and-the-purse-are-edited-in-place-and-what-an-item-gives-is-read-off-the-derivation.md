# 0098 — The bag and the purse are edited in place, and what an item gives is read off the derivation

**Status:** Accepted · 2026-10-08 · answers the second half of ROADMAP Phase 3's "Starting equipment, and an inventory the
player manages" · amends [0072](./0072-a-build-step-may-offer-items-a-character-equips-and-what-it-takes-is-a-bag-entry.md)
("say which items give this character something", left undone) and
[0087](./0087-starting-equipment-is-a-data-file-beside-the-system-and-money-is-counted-in-the-units-the-system-declares.md)
(decision 5: making change, which it gave to this ADR) · builds on [0005](./0005-aurora-import.md),
[0006](./0006-derived-character-state.md), [0008](./0008-aurora-compatibility-frozen.md),
[0012](./0012-self-contained-saves.md), [0023](./0023-attunement-gates-and-reports.md), [0024](./0024-inventory-is-a-list-of-instances.md),
[0025](./0025-slots-publish-tags.md), [0042](./0042-the-tests-read-the-current-official-corpus-and-a-moving-corpus-fails-only-what-must-hold-against-any-corpus.md),
[0049](./0049-a-character-records-which-publications-it-is-offered-and-it-narrows-offers-only.md),
[0075](./0075-a-text-export-is-the-sheet-document-written-as-markdown-that-reads-as-plain-text.md),
[0074](./0074-a-kind-s-sheet-shows-its-printed-page-and-every-row-says-what-it-is.md),
[0076](./0076-content-s-sheet-hints-are-read-every-description-kept-chosen-by-the-level-the-element-gates-at.md),
[0079](./0079-a-pdf-sheet-is-the-print-layout-written-to-a-file-and-the-official-form-is-the-user-s-own-copy-filled-from-the-document.md),
[0089](./0089-the-other-hidden-item-families-are-two-more-equip-steps-and-a-player-character-s-sheet-shows-its-other-speeds.md),
[0093](./0093-an-attack-is-a-weapon-in-the-bag-and-the-kind-declares-what-it-adds-up.md),
[0095](./0095-a-row-names-what-moved-it-that-the-sheet-lists-nowhere.md) ·
**format:** optional `types` and `adornSetter` on a kind's `inventory` and an optional `bag` on a sheet section in the
system format (`formatVersion` stays 1); a parsed element gains an optional `contents` (the `<extract>` block, a bugfix to
the frozen importer); the character format is unchanged (11)

## Context

The bag is modelled, imported, derived and saved (ADRs 0024 to 0026), a character built here takes a starting package or
its gold (ADR 0087), and nothing after that lets a player buy a rope, put on a ring or count the coins they spend. The
model and the engine are there: `setInventoryEntry`, `removeInventoryEntry`, `setMoney`, `resolveEquipment`. What is
missing is the view-model and a screen in each shell. ADR 0087 left this ADR four questions: how editing meets a package
that can be taken back, whether a pack opens into its contents, how buying is priced, and whether money reaches the Sheet,
the Markdown export and the official form. ADR 0072 left a fifth: say which items give the character anything.

**Measured** by `tools/verify/src/inventory-editor.test.ts` (report-only, AuroraLegacy/elements at `c28ce6c`, the thirty
samples):

- **2,881 items** of the four types 5e's Equipment step names (1,841 Magic Item, 916 Item, 97 Weapon, 27 Armor). 83 are
  the three equip steps' families (36 optional class features, 35 additional features, 12 ability score adjustments). 91
  are hidden; **8 of those are not an equip step's, all "Mounts & Vehicles", none with a rule, all priced** (ADR 0089).
  That leaves 2,798 an editor offers.
- **Prices**: 2,157 in gp, 52 in sp, 43 in cp; 517 have no `cost`; 29 have one with no unit, and those 29, with 3 in gp,
  write "—" (no number). Of the numbers, 1,347 are whole and **902 are 0**, almost all magic items, which Aurora writes as
  "no price" (a Mithral Armor costs "0 gp"). **No price is a fraction.**
- **Slots**: 1,809 of the 2,798 name none; every other but one names a slot the kind declares (one Magic Item names
  "armor", which is no slot). 968 magic items require attunement. 682 items carry `stackable` true.
- **A magic item made from another item is an adorner, and content says which.** 442 magic items carry a `type` setter
  naming an item type (278 Weapon, 164 Armor); 415 of them carry a filter setter named after that type, lowercased
  (`armor`, `weapon`), in content's supports language, and 175 a `name-format` reading `{{parent}}` ("Mithral {{parent}}").
  **Read as a pick's filter is read (tags, the id, setter values), 214 of the 415 admit no host at all**: they name hosts
  by name ("Plate", "Longsword", "Scale Mail"), which no tag carries. **With the host's name as an operand, every one
  admits at least one** (269 admit one to nine, 108 ten to 49, 38 fifty or more). The 27 with no filter setter take any
  host of the type. 301 of the 442 require attunement.
- **`<extract>`**: 44 blocks, 265 `<item>` children (67 with `amount`), all naming an id, 264 declared and 1 not (the
  Guard's light crossbow of ADR 0087), and one `<description>` child, prose beside the list.
- **The samples' bags**: 24 entries, 22 equipped, 7 attuned, 2 adorned, 2 carried; no name, no notes, no quantity, no slot
  override, no equip step's item. Of the 24, 16 move a stat, 2 of those also grant an element, 7 are an attack and nothing
  else (5 equipped, 2 carried), and 1 equipped item gives nothing. **Every stat an item moves is one with no label**
  (`ac:armored:armor`, `ac:shield`, …: 42 of 42): what a player reads, Armor Class, is reached only through the kind's
  formulas. **No item the samples hold is outside the bag** (0), so a sheet listing the bag loses nothing.

## Decision

1. **The editor is a view-model in `packages/ui` and a screen in each shell that computes nothing**
   (`packages/ui/src/inventory.ts`; desktop `panes/InventoryEditor.tsx`, phone `InventoryView.tsx`). It works on the
   character in place, through the builder, at any time: no step owns it, it never blocks, and a write that changes
   nothing derived keeps the derivation as a play edit does where it can (a name, notes). Every write is an input of ADR
   0006's: entries (ADR 0024's fields, none new) and `money` (ADR 0087). **The character format does not move**: nothing
   is recorded that a reader of format 11 would drop.

2. **What it offers is every item of the types the kind's `inventory` names** (`inventory.types`, system format, optional;
   5e's `pc`: Item, Weapon, Armor, Magic Item), **through the offered view** (ADR 0049), by name, **less the families an
   equip step offers** (ADR 0089 decision 3: those are taken on Build, where their gates are read). **Hidden is not a
   reason to leave one out**: the 2024 mounts are goods. A kind without `types` offers nothing to add and still edits
   what it carries. Each candidate says its price, whether it requires attunement and what it is made from.

3. **The writes**, each a pure function returning a character or a sentence saying why not:
   - **Add** puts a new carried entry at the end of the bag, quantity 1. Every add is a new entry: `stackable` is not read
     (two rows of arrows are two rows; merging them is the user's).
   - **Buy** is Add and paying the item's price from the purse. **A price is the `cost` setter's number in the unit its
     `currency` attribute names, when that unit is one the system declares and the number is above 0**: "—", no unit and
     0 are no price (Aurora's 0 on a magic item means "not for sale", not "free"), and such an item is added, never bought.
     Buying takes the coins **of that unit** and is refused, with a sentence, when the purse holds fewer of it, even when
     other coins are worth more: **change is made only when the player asks** (ADR 0087 decision 5), by Exchange.
   - **Remove**, **set the quantity** (a whole number from 1), **rename** (blank clears), **notes** (blank clears).
   - **Equip and unequip**. Where it went is `resolveEquipment`'s: an equipped entry shows the slot it occupies, or the
     engine's own `slot-full` or `slot-unknown` sentence, or that it is worn where the kind counts nothing (a ring). The
     `slot` override (ADR 0024) is kept as written and not offered.
   - **Attune and unattune**, offered on an entry whose element or adornment requires attunement (the kind's
     `attunement` setter). **The limit is shown and never refused**: "Attuned to 4 of 3", and the engine's `over-attuned`
     problem, as ADR 0023 designed. Attuning a carried entry is allowed and counts nothing until it is equipped (ADR 0023's
     count is of equipped entries); the row says so.
   - **Attach** a magic item to a host, and **detach** it. **An adorner is an item whose `inventory.adornSetter` (5e:
     `type`) names a type of the host's**, and the host is admitted by the adorner's setter named after that type,
     lowercased, read as a pick's filter with **the host's own name as one more operand**, because content names hosts by
     name; an absent filter admits any host of the type. The operand is read here only, for this question: `matchesSupports`
     is unchanged, so no select's offer moves. A host holds one adornment (the measured maximum, ADR 0024); attaching to a
     host that has one is refused until it is detached. An adorner already carried in the bag as a bare entry of one is
     moved onto the host; otherwise it is taken from content. Detaching puts nothing back in the bag: the adornment was
     never an instance (ADR 0024 decision 3). The row's name is the adorner's `name-format` with `{{parent}}` filled
     (ADR 0093 reads the same setter for an attack), else "Host (Adorner)".
   - **Open** a pack: one of the entry is replaced by what its element's `contents` lists, each a new carried entry with
     its amount, in the order content lists them; an id nothing loaded declares is left out and named. Offered only on an
     entry whose element has contents.

4. **A pack's contents are read from `<extract>` by the frozen importer**, as `Element.contents` (`{ id, quantity? }[]`,
   in file order; a `<description>` child is prose and skipped). It is a construct content writes and the parser dropped,
   the same kind of bugfix as the `<sheet>` descriptions (ADR 0076) and `<currency>` (ADR 0087), not new support. The
   converted cache's `CONVERTER_VERSION` moves, so a source kept converted is read again; a save written before this
   embeds its pack without contents, and its row offers no Open until the character is refreshed (ADR 0082) or the item
   added again.

5. **Money is edited unit by unit**: a count typed for a unit, or an amount of a unit spent or received (spending more of
   a unit than the purse holds is refused, as buying is). **Exchange** turns a number of coins of one unit into another,
   only when the worths (`currencyWorths`, core) make it whole ("10 sp into 1 gp", "1 pp into 10 gp"); one that would leave
   a fraction is refused, naming the remainder. Nothing is ever reckoned into one total and nothing makes change on its own.

6. **A package's entries and coins say what editing them does.** ADR 0087 lets a package be taken back while
   `packageUntouched` holds: every entry it added is still there with its quantity and no adornment, and the purse covers
   its coins. That rule is kept as it is, and the editor says it where it applies: an entry a package added names the
   class or background, and that removing it, changing how many or attaching an item to it means the package can no
   longer be taken back; the purse says the same of spending below its coins. Equipping, attuning, renaming and notes do
   not count as using it, so Take back removes a renamed or equipped entry; its Build line already says what it will
   remove. Opening a pack a package added is removing it.

7. **What an item gives is read off the derivation, never worked out again** (ADR 0072's open item). For each entry, from
   its element and its adornment:
   - the **sheet rows it moves**: the rows of the character's own sheet (ADR 0074) whose stat the item contributes to
     non-zero, directly or through a stat the kind's formulas read, followed by name as ADR 0095 follows them (core's
     `statReferences`) and never evaluated. "Moves Armor Class, Stealth".
   - the **elements it grants that the character holds**, named as the sheet names them, when a sheet section lists their
     type; one the sheet lists nowhere is counted as "something the sheet does not list".
   - whether it is **an attack** (ADR 0093: every weapon in the bag, carried too).
   - and otherwise why it gives nothing: carried ("gives nothing until equipped", said only of an item with rules),
     suppressed for want of attunement ("gives nothing until attuned"), or equipped and giving nothing.

   An equip step's items (ADR 0072, ADR 0089) are listed apart, "Taken on Build", with their line and no controls: their
   step takes and returns them. That is where the line matters most: an optional class feature the character's level does
   not reach yet says it gives nothing.

8. **The Sheet lists the bag and the purse.** A sheet section may declare `bag: true` (system format, optional; refused on
   a kind with no `inventory`). It then carries the bag, entry by entry in bag order, each with its name (as the row's),
   its quantity, and whether it is equipped and attuned, and the purse (the units held, most worth first); the section's
   `types` still list a held element of them that no entry names (0 in the samples). 5e's `pc` Inventory section declares
   it. The **Markdown** writes the entries as the section's list ("Arrows ×20", "Chain Mail (equipped)",
   "Ring of Protection (equipped, attuned)") and a "Money: 15 gp, 3 sp" line; the **print** and the **phone** render the
   same document; the **official 2014 form** fills Equipment from the bag and **CP, SP, EP, GP, PP** from the purse, by a
   new form map rule `{ field, money: unit }` and a flow reading `bag` where it read `list`. Before this the Sheet listed
   only equipped items (held elements), so every export of a character carrying something changes.

## What this does not do

- **Selling** at a price the book sets (half, for most gear), and buying at a discount: Remove and Receive are the way.
- **Weight and encumbrance**: content prices items by weight too (`<set name="cost" lb=…>`), and nothing reads it.
- **Containers**: a bag of holding holds nothing; every entry is in the one bag.
- **A slot chosen by the player** (a versatile weapon in two hands): the override is kept, not offered.
- **Merging a stack**, and splitting one.
- **A creature's or an NPC's inventory**: a kind with no `inventory` has no editor.

## Alternatives considered

- **Reading the host's name inside `matchesSupports`.** It would widen every select whose filter happens to name
  something by name, and no select was measured to want it. The question here is one: which hosts an adorner admits.
- **Making change automatically when buying** (break a platinum for a 15 gp sword). ADR 0087 decision 5 rules it out, and
  which coins come back is a choice the player makes at a table, not one a rule can make for them.
- **Leaving packs closed** and listing their contents as text. The 2014 packages give a pack as one item, and a player who
  burns a torch cannot record it. The parser already reads the element; the block is two dozen lines of XML.
- **A "price" of 0 as free.** 902 items, nearly all magic, would be bought for nothing.
- **A new field to mark an entry from a package** (ADR 0087 first drafted `origin`). `Character.startingEquipment` already
  records the entries a package added; the editor reads it.

## Consequences

- A character built from nothing can take a package or its gold, then buy, equip and attune; its armour class and
  attunement follow, through the engine as an import's always did.
- The Sheet, its export, its print and the form name what a character carries and its coins. Every export of a character
  with a bag changes.
- The converted cache is read again once, on the first load after this.
- The oracle is unchanged: the editor writes inputs the importer already writes, and the parser's new field is read by
  nothing the engine derives.
