# 0117 — The add-item list is grouped by a setter the system names

**Status:** Accepted · 2026-10-14 · answers the maintainer's report on the inventory editor · builds on
[0098](./0098-the-bag-and-the-purse-are-edited-in-place-and-what-an-item-gives-is-read-off-the-derivation.md) ·
**format:** system format `inventory.groupSetter` (`formatVersion` stays 1); no character format change

## Context

The maintainer found the "Add an item" list too big to use, and asked for categories that, when one is chosen, slide
left to show that category's items. Measured (`tools/verify/src/inventory-groups.test.ts`): a new 5e player character is
offered 2,798 items in one list. By type there are four groups (Magic Item 1,841, Item 833, Weapon 97, Armor 27); by
`rarity`, 1,129 items write none; by the items' `category` setter, 23 groups (Wondrous Items 900, Magic Weapons 254,
Adventuring Gear 238, Treasure 236, Magic Armor 163, Supernatural Gifts 154, Potions 99 …) and 3 items that write none.

## Decision

1. **The kind names the setter** (`inventory.groupSetter`, optional; 5e: `category`). No group name is in code.
2. **`inventoryOfferGroups`** (`packages/ui/src/inventory.ts`, the builder's `inventoryGroupsFor`): "All items" first, so
   a search that does not know where an item is still reaches every one, then one group per value, joined ignoring case
   and surrounding space and sorted by name, then "Other" for items that write none. A kind that names no setter is not
   grouped and the list is the flat one, as before. `offerGroupLine` words an entry: "Potions (99)".
3. **The desktop** shows the groups; choosing one slides the list left to that group's searchable picker, with "‹ All
   groups" back. The panel slid out of view is inert and takes no height; with reduced motion there is no slide. **The
   phone's** picker takes the same groups (`PickerRequest.groups`): a list of them first, then the group's options with a
   way back.

## Evidence

- `packages/ui/src/offer-groups.test.ts`: order, joining, Other, "All items" holding the whole offer, and no grouping
  where the kind names no setter; each fails under the change it names.
- `tools/verify/src/inventory-groups.test.ts`: on the corpus every offered item is in exactly one group.
- Driven in the browser build at 1280×860: 25 entries, Potions shows 99 and adds one to the bag, Rings 97, and back. The
  slide's end position was measured. In the Tauri window on Windows (2026-10-15, real mouse): captured 90 ms after the
  click the panel is half-way, finished at 500 ms; an item added from Potions, and back. Not driven on the phone.
- The keyboard follows the slide (2026-10-15): opening a group focuses its search box, going back focuses that group's
  entry. It used to be left on a control the slide had made inert. Driven with real keys in the Tauri window: a group
  opened, "rope" typed into its search, Shift+Tab to "‹ All groups", Enter back onto the same group, Tab and Enter into
  the next.
