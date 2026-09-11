/**
 * The bag — ADR 0024.
 *
 * Two properties are worth more than the rest of this file put together, and both were
 * measured against real saves rather than reasoned about. **An entry is an instance**, so two
 * copies of the same element can differ (one of the nine sample saves carries two greatswords
 * with different enchantments). And **the container embeds every entry, carried included**,
 * because a save whose bag cannot be read without sources is a broken save under ADR 0012.
 *
 * Nothing here derives anything. Seeding the derivation from equipped items is step 3 of
 * docs/INVENTORY-AND-AC-PLAN.md, and this step deliberately moves no derived number.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHARACTER_FORMAT_VERSION,
  createCharacter,
  getInventoryEntry,
  inventoryElementIds,
  newInstanceId,
  removeInventoryEntry,
  setChoice,
  setInventoryEntry,
  type Character,
} from './character.ts';
import { collectCharacterContent } from './container.ts';
import { MapElementIndex, type Element } from './model.ts';

function element(id: string): Element {
  return {
    id,
    type: 'Widget',
    name: id,
    source: 'test',
    setters: {},
    rules: [],
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

function withBag(): Character {
  let character = createCharacter('test', 'pc', { name: 'Vigaro', progress: 3 });
  character = setInventoryEntry(character, {
    instanceId: 'a',
    elementId: 'GREATSWORD',
    equipped: true,
    adorners: [{ elementId: 'FROST_BRAND' }],
  });
  character = setInventoryEntry(character, {
    instanceId: 'b',
    elementId: 'GREATSWORD',
    adorners: [{ elementId: 'VORPAL_SWORD' }],
    name: 'Swiftpursuit',
  });
  return character;
}

test('two copies of one element are two entries, and they can differ', () => {
  const character = withBag();
  assert.equal(character.inventory?.length, 2);

  const [equipped, carried] = character.inventory!;
  assert.equal(equipped!.elementId, carried!.elementId);
  assert.equal(equipped!.equipped, true);
  assert.equal(carried!.equipped, undefined);
  assert.deepEqual(equipped!.adorners, [{ elementId: 'FROST_BRAND' }]);
  assert.deepEqual(carried!.adorners, [{ elementId: 'VORPAL_SWORD' }]);
  assert.equal(carried!.name, 'Swiftpursuit');
});

test('an entry is addressed by its instance id, and replacing one keeps its place', () => {
  const character = withBag();
  assert.equal(getInventoryEntry(character, 'b')?.name, 'Swiftpursuit');
  assert.equal(getInventoryEntry(character, 'nothing'), undefined);

  // Equipping the second greatsword must not send it to the bottom of the bag.
  const updated = setInventoryEntry(character, {
    ...getInventoryEntry(character, 'a')!,
    equipped: false,
  });
  assert.deepEqual(
    updated.inventory?.map((e) => e.instanceId),
    ['a', 'b'],
  );
  assert.equal(getInventoryEntry(updated, 'a')?.equipped, false);
  assert.equal(updated.inventory?.length, 2);
});

test('an emptied bag is absent, not an empty array', () => {
  let character = withBag();
  character = removeInventoryEntry(character, 'a');
  character = removeInventoryEntry(character, 'b');
  assert.equal(character.inventory, undefined);

  // Removing something that was never there changes nothing but the timestamp.
  assert.equal(removeInventoryEntry(character, 'a').inventory, undefined);
});

test('minted instance ids are distinct', () => {
  const ids = new Set(Array.from({ length: 100 }, () => newInstanceId()));
  assert.equal(ids.size, 100);
});

test('the element ids a bag names include adornments, equipped or not', () => {
  assert.deepEqual(inventoryElementIds(withBag()), [
    'GREATSWORD',
    'FROST_BRAND',
    'VORPAL_SWORD',
  ]);
  assert.deepEqual(inventoryElementIds(createCharacter('test', 'pc')), []);
});

test('adding to a character written before inventories existed moves its format version', () => {
  const old: Character = { ...createCharacter('test', 'pc'), formatVersion: 1 };
  assert.equal(setInventoryEntry(old, { instanceId: 'a', elementId: 'X' }).formatVersion, 2);
  assert.equal(CHARACTER_FORMAT_VERSION, 2);

  // Emptying the bag does not put the file back: the reader still has to understand it.
  const emptied = removeInventoryEntry(setInventoryEntry(old, { instanceId: 'a', elementId: 'X' }), 'a');
  assert.equal(emptied.formatVersion, 2);
});

/**
 * The ADR 0012 half, and the trap `kind.grants` set first: the container walks the character,
 * so anything referenced *without being chosen* has to be seeded deliberately.
 */
test('the container embeds every entry and every adornment, carried included', () => {
  const index = new MapElementIndex();
  index.addAll([
    element('CHOSEN'),
    element('GREATSWORD'),
    element('FROST_BRAND'),
    element('VORPAL_SWORD'),
    element('UNTOUCHED'),
  ]);

  const character = setChoice(withBag(), 'build/seed', ['CHOSEN']);
  const content = collectCharacterContent(character, index);
  const ids = content.elements.map((e) => e.id);

  assert.deepEqual(ids, ['CHOSEN', 'FROST_BRAND', 'GREATSWORD', 'VORPAL_SWORD']);
  // Still a subset: a bag is not a reason to embed the corpus.
  assert.ok(!ids.includes('UNTOUCHED'));
});

test('an item the sources do not have is recorded unresolved, not dropped', () => {
  const index = new MapElementIndex();
  index.addAll([element('GREATSWORD')]);
  const content = collectCharacterContent(withBag(), index);
  assert.deepEqual(content.unresolved, ['FROST_BRAND', 'VORPAL_SWORD']);
});
