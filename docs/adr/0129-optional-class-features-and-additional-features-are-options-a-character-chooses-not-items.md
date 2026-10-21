# 0129 — Optional class features and additional features are options a character chooses, not items

**Status:** Accepted · 2026-10-21, with the maintainer's answers (below) · builds ADR
[0119](./0119-aurora-content-is-converted-into-incudo-content-and-nothing-past-the-conversion-knows-aurora.md)'s decision 3
(last bullet) and decision 7 (optional features taken as choices) · supersedes
[0072](./0072-a-build-step-may-offer-items-a-character-equips-and-what-it-takes-is-a-bag-entry.md)'s "what it takes is an
equipped bag entry" and [0089](./0089-the-other-hidden-item-families-are-two-more-equip-steps-and-a-player-character-s-sheet-shows-its-other-speeds.md)'s
equip steps · amends [0081](./0081-an-equip-step-may-offer-only-what-is-gated-on-what-the-character-has.md) (`gatedOnHeld`
moves onto the step), [0098](./0098-the-bag-and-the-purse-are-edited-in-place-and-what-an-item-gives-is-read-off-the-derivation.md)
(no "Taken on Build" group) · **format:** the converter writes three element types of its own; system format `equip` and
`inventory.hiddenSetter` removed, `gatedOnHeld` on a build step; no character format change

## Context

Aurora's app has no way to let a user switch a rule on for one character, so its content does it with items: an item the
user equips "to enable it", hidden from the inventory (`inventory-hidden`). Tasha's optional class features are 36 of
them, and Aurora's internal content adds 35 "Additional Feature" items (speeds, senses, feat and multiclass unlockers,
weapon mastery, Lycanthropy, the Companion and Familiar Selection) and 12 "Additional Ability Score Improvement" items
(+1 or −1 to one score). ADRs 0072 and 0089 offered all 83 on Build through three `equip` steps whose answers were
equipped bag entries, because that is the record an Aurora import makes, and the inventory editor listed them under
"Taken on Build". The maintainer saw them there: "We shouldn't be following Aurora's workarounds. Those aren't items."
ADR 0119 had already named the case.

### What was measured (AuroraLegacy at `c28ce6c`)

- The three steps offer exactly these 83 elements, found by `category`: 36 "Optional Class Features", 35 "Additional
  Feature", 12 "Additional Ability Score Improvement". All carry `inventory-hidden` and `slot` `misc`, and all but the
  optional class features' description opens with Aurora's "You can equip this item to enable it" paragraph (they do too).
- **Nothing in content names any of them**: no grant, select, requirement or embed reaches one, and no requirement reads
  `[type:item]`. Changing their type moves nothing another element reads.
- **None of the thirty samples holds one**, so the oracle cannot see this change, and `aurora-oracle.test.ts` is identical
  before and after by construction. The evidence is the tests below.
- The 8 hidden 2024 mounts are priced goods with no rules; they stay items.
- Three more elements were the converter's own (`generated-elements.ts`): Aurora's app materializes
  `ID_PHB_INTERNAL_ITEM_LANGUAGE_PROXY_LANGUAGE_GNOMISH`, `…_ORC` and `ID_PHB_INTERNAL_ITEM_PROXY_ASI_INTELLIGENCE` in a
  save's bag when a character was given a language or a score, with no category, so no step offered them and they showed
  in the add-item list's "Other" group. Content itself says the Intelligence one is the same as
  `ID_INTERNAL_ITEM_ASI_INTELLIGENCE_INCREASE_1` ("a duplicate of the same element … created in order to avoid issue of
  original (proxy) elements disappearing").

## Decision

1. **The converter gives the 83 elements a type of their own**, in Incudo's words, keeping their ids and names (ADR 0119
   decision 2): `Optional Class Feature`, `Additional Feature`, `Ability Score Adjustment`, by their `category`. It drops
   the `slot` and `inventory-hidden` setters and the "equip this item to enable it" paragraph, which describe Aurora's
   workaround and nothing about the option. Converted sources are written again (`CONVERTER_VERSION` 4).
2. **The three steps are ordinary sets** (`multiple`, ADR 0032), one type each, recorded as choices under
   `build/<stepId>`, keeping `listedWithRequired` (0127) and `offeredWhen` (0123). `gatedOnHeld` (0081) moves from the
   gone `equip` block onto the build step, valid only on a `multiple` step. Taking one back keeps the equip step's
   behaviour, now for every set answered on Build (not one `askedAtStart`): what leaves the set is taken back first and
   the answers to the selects that closes are dropped, as a removed addition's are (ADR 0064); what joins is recorded
   second and drops nothing, so a feature it replaces keeps its answer for when it is taken back.
3. **`BuildStepDef.equip`, `EquipStepDef`, `takenOnBuild` and `InventoryDef.hiddenSetter` are removed.** Nothing else
   read them: the mounts are listed in the bag like any item (the bag never read `hiddenSetter`), and a section that lists
   item types lists a mount a character equips, which is what it is.
4. **The sheet lists additional features and score adjustments under Features & Traits**; an optional class feature is
   not listed itself, because what it grants is a class feature that section already lists (the maintainer's call). A
   vision option's `<sheet display="false">` keeps it off that section and names it beside the row it moves (ADR 0095).
5. **The `.dnd5e` import records them as choices.** An equipped bag entry whose element is of one of the three types is
   written as a choice under that type's step key (`build/optional-features`, `build/additional-features`,
   `build/ability-adjustments`, as the campaign options are written under `build/options`); a carried one did nothing in
   Aurora and is dropped with a note. With no content loaded the importer cannot tell, and keeps the entry.
6. **The three proxies leave the overlay, which goes from 84 elements to 81.** The maintainer's rule: what
   an Aurora save adds through the item workaround is added through Incudo's proper equivalent. The Intelligence proxy is
   imported as `ID_INTERNAL_ITEM_ASI_INTELLIGENCE_INCREASE_1` taken as an ability score adjustment; a language proxy as
   the language itself, added to the character (`additions`, ADR 0064). `compareWithAurora` counts a proxy as present
   when what replaced it is held.
7. **A save from the betas holding one as a bag entry is not upgraded** (the maintainer's call: "We're not covering pre
   v1 builds. It'll stay broken"). It opens, its embedded copy is still an `Item`, its entry still seeds the derivation,
   and the entry shows in the bag.

## The maintainer's answers (2026-10-21)

- **Three types**, one per step.
- **Beta saves**: not covered.
- **The proxies**: "if an aurora save is adding features through the item workaround, we'll add them through our proper
  'additional feature' or appropriate equivalent."
- **The sheet**: list only what an optional class feature grants.

## Consequences

- No element of these families appears in the inventory editor, the add-item list or the bag; the "Taken on Build" group
  is gone.
- A Ranger who takes Deft Explorer records `build/optional-features: [ID_WOTC_TCOE_ITEM_OCF_RANGER_DEFT_EXPLORER]`; the
  withdrawal of Natural Explorer (ADR 0071) is unchanged.
- The overlay holds 81 elements; the generated total on the corpus is 227.
- Evidence: `tools/verify/src/optional-features.test.ts` (the converter's types), `optional-feature-step.test.ts` (a 2014
  Ranger through the builder, packed and reopened with no source), `optional-feature-offer.test.ts` and
  `hidden-items.test.ts` (the offers, held through the builder against any corpus), `packages/aurora-import`'s
  `item-features.test.ts` and `import-character.test.ts`, each failing under its named perturbation.
