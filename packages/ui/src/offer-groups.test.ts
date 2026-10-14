/**
 * The add list in groups — ADR 0117. No game in the fixture: "shelf" is what 5e's `category` is. Each test names the
 * change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapElementIndex, type Element, type ResolvedCharacterKind } from '@incudo/core';
import { ALL_ITEMS_LABEL, inventoryOfferGroups, offerGroupLine, OTHER_ITEMS_LABEL } from './inventory.ts';

function item(id: string, shelf?: string): Element {
  return {
    id,
    type: 'Thing',
    name: id,
    source: 'test',
    setters: shelf === undefined ? {} : { shelf: { value: shelf } },
    rules: [],
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

const index = new MapElementIndex();
index.addAll([item('ROPE', 'Gear'), item('LAMP', ' gear '), item('SWORD', 'Blades'), item('ODD'), item('BLANK', '')]);
const kind = (groupSetter?: string) => ({ inventory: { slots: [], ...(groupSetter ? { groupSetter } : {}) } }) as unknown as ResolvedCharacterKind;
const offer = ['ROPE', 'LAMP', 'SWORD', 'ODD', 'BLANK'];

test('the offer is grouped by the setter the kind names: everything first, then by name, Other last', () => {
  // Fails if the groups are not sorted, if a value is not joined ignoring case and space, if an item with no value is
  // dropped rather than put under Other, or if "All items" does not hold the whole offer in its order.
  const groups = inventoryOfferGroups(kind('shelf'), offer, index);
  assert.deepEqual(
    groups.map((g) => [g.label, g.options]),
    [
      [ALL_ITEMS_LABEL, offer],
      ['Blades', ['SWORD']],
      ['Gear', ['ROPE', 'LAMP']],
      [OTHER_ITEMS_LABEL, ['ODD', 'BLANK']],
    ],
  );
  assert.equal(offerGroupLine(groups[2]!), 'Gear (2)');
});

test('a kind that names no setter is not grouped', () => {
  // Fails if a list is grouped by a guess (by type, say) where the system said nothing.
  assert.deepEqual(inventoryOfferGroups(kind(), offer, index), []);
});
