/**
 * The bag — ADR 0024.
 *
 * Two properties are worth more than the rest of this file put together, and both were
 * measured against real saves rather than reasoned about. **An entry is an instance**, so two
 * copies of the same element can differ (one of the nine sample saves carries two greatswords
 * with different enchantments). And **the container embeds every entry, carried included**,
 * because a save whose bag cannot be read without sources is a broken save under ADR 0012.
 *
 * Step 3 of docs/INVENTORY-AND-AC-PLAN.md added a third, and it is the same asymmetry seen
 * from the engine rather than the container: **equipped derives, carried does not**. Measured
 * too — 26 of 26 equipped items across the nine sample saves are in Aurora's own `<sum>` and
 * 18 of 19 carried ones are not.
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
  equippedElementIds,
  setChoice,
  setInventoryEntry,
  type Character,
} from './character.ts';
import { collectCharacterContent } from './container.ts';
import { deriveCharacter } from './engine.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import type { GameSystem } from './system.ts';

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
  let character = createCharacter('test', 'pc', { name: 'Vesper', progress: 3 });
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

// --- the derivation (step 3) -----------------------------------------------

/** A system with one stat, so an item has something to move. */
const SYSTEM: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Widget' }],
  stats: [{ name: 'sharpness', default: 0 }],
  characterKinds: [
    {
      id: 'pc',
      name: 'PC',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Widget'],
      buildSteps: [{ id: 'b', label: 'B', types: ['Widget'] }],
      sheet: { sections: [{ id: 's', label: 'S', stats: ['sharpness'] }] },
    },
  ],
};

function sharp(id: string, value: number, rules: Rule[] = []): Element {
  return {
    ...element(id),
    rules: [{ kind: 'stat', key: 'stat-0', name: 'sharpness', value: { kind: 'number', value } }, ...rules],
  };
}

function armedIndex(): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll([
    sharp('GREATSWORD', 1, [{ kind: 'grant', key: 'grant-0', type: 'Widget', id: 'HEAVY' }]),
    sharp('FROST_BRAND', 10),
    sharp('VORPAL_SWORD', 100),
    element('HEAVY'),
  ]);
  return index;
}

test('an equipped entry and its adornment join the derivation; a carried one does not', () => {
  const derived = deriveCharacter(withBag(), SYSTEM, armedIndex());

  // withBag() equips one greatsword with a Frost Brand and carries another with a Vorpal
  // Sword. 1 + 10, and the 100 stays in the bag.
  assert.equal(derived.stats.get('sharpness')!.value, 11);
  assert.ok(derived.elementIds.has('FROST_BRAND'));
  assert.ok(!derived.elementIds.has('VORPAL_SWORD'), 'the carried enchantment contributes nothing');
  assert.deepEqual(derived.problems, []);
});

test('an equipped item expands like any other seed', () => {
  const derived = deriveCharacter(withBag(), SYSTEM, armedIndex());
  // The closure, not just the id in the bag: a suit of plate is one entry and a
  // stealth-disadvantage marker behind it.
  assert.ok(derived.elementIds.has('HEAVY'));
});

test('unequipping an item takes its contribution with it', () => {
  const stowed = setInventoryEntry(withBag(), {
    ...getInventoryEntry(withBag(), 'a')!,
    equipped: false,
  });
  const derived = deriveCharacter(stowed, SYSTEM, armedIndex());
  assert.equal(derived.stats.get('sharpness')!.value, 0);
  assert.ok(!derived.elementIds.has('HEAVY'));
});

test('a quantity is not a multiplier — ten arrows are one seed', () => {
  const character = setInventoryEntry(createCharacter('test', 'pc'), {
    instanceId: 'q',
    elementId: 'FROST_BRAND',
    equipped: true,
    quantity: 10,
  });
  const derived = deriveCharacter(character, SYSTEM, armedIndex());
  assert.equal(derived.stats.get('sharpness')!.value, 10);
});

test('the element ids the derivation seeds from are the equipped ones', () => {
  assert.deepEqual(equippedElementIds(withBag()), ['GREATSWORD', 'FROST_BRAND']);
  assert.deepEqual(equippedElementIds(createCharacter('test', 'pc')), []);
});

test('an equipped item the sources do not have is an error, the way a lost choice is', () => {
  const index = new MapElementIndex();
  index.addAll([sharp('GREATSWORD', 1)]);
  const derived = deriveCharacter(withBag(), SYSTEM, index);
  assert.deepEqual(
    derived.problems.map((p) => [p.level, p.code, p.elementId]),
    [['error', 'unresolved-element', 'FROST_BRAND']],
    'and the carried Vorpal Sword is silent, because it was never seeded',
  );
});
