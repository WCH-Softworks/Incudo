/**
 * The add list's groups on the official corpus — ADR 0117.
 *
 * Measured first: a new 5e player character is offered 2,798 items to add, in one list. Their `category` setter names
 * 23 groups (Wondrous Items 900, Magic Weapons 254, Adventuring Gear 238, Treasure 236, …) and 3 items write none. By
 * type there would be four (Magic Item 1,841), and by `rarity` 1,129 have none, so `category` is what 5e names.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ALL_ITEMS_LABEL, CharacterBuilder, newCharacterOfKind } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

test('every item offered to add is in exactly one group, after one holding them all', { skip: corpusSkip }, async (t) => {
  // Fails if 5e names no group setter (no groups), or if a group loses or repeats an item.
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const offer = b.inventoryOptionsFor();
  const groups = b.inventoryGroupsFor();
  assert.equal(groups[0]!.label, ALL_ITEMS_LABEL);
  assert.deepEqual(groups[0]!.options, offer);
  const rest = groups.slice(1);
  t.diagnostic(`${offer.length} items in ${rest.length} groups: ${rest.map((g) => `${g.label} ${g.options.length}`).join(', ')}`);
  assert.ok(rest.length > 10, 'more than a handful of groups');
  const placed = rest.flatMap((g) => g.options);
  assert.equal(placed.length, offer.length, 'every item once');
  assert.deepEqual(new Set(placed), new Set(offer));
});
