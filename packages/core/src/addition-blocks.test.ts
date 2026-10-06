/**
 * The block an added element is cast through — ADR 0097.
 *
 * The fixture has no game in it: a hero whose kind lets Knacks and Charms be added and casts an added Charm through a
 * declared block. Orange is a block that prepares Charms (one, from the Orange list); Purple declares a block that does
 * not prepare. Each test names the change that fails it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { collectCharacterContent } from './container.ts';
import { createCharacter, setAdded, setAdditionBlock, type Character } from './character.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import { resolveCharacterKind, type GameSystem } from './system.ts';

function element(id: string, type: string, rules: Rule[] = [], extra: Partial<Element> = {}): Element {
  return { id, type, name: id, source: 'test', setters: {}, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' }, ...extra };
}

const stat = (name: string, value: number): Rule => ({ kind: 'stat', key: `stat:${name}`, name, value: { kind: 'number', value } });

function system(withBlocks = true): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Knack' }, { name: 'Charm' }, { name: 'Calling' }],
    stats: [{ name: 'level', default: 0 }],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'level', min: 1, max: 20 },
        elementTypes: ['Knack', 'Charm', 'Calling'],
        blockFilters: [{ key: 'charm:list', tags: ['{name}'] }],
        preparation: {
          blockAttribute: 'prepare',
          limit: '{name}:charm:allow',
          elementType: 'Charm',
          listFilter: '$(charm:list)',
          heldFilter: '$(charm:list)',
        },
        additions: {
          types: ['Knack', 'Charm'],
          ...(withBlocks ? { blocks: { types: ['Charm'], label: 'Cast as', with: 'cast as {name}', none: 'cast through no calling' } } : {}),
        },
        buildSteps: [],
        sheet: { sections: [] },
      },
    ],
  };
}

const index = new MapElementIndex();
index.addAll([
  element('ORANGE', 'Calling', [stat('orange:charm:allow', 1)], { spellcasting: [{ name: 'Orange', prepare: 'true' }] }),
  element('PURPLE', 'Calling', [], { spellcasting: [{ name: 'Purple' }] }),
  element('ON_LIST', 'Charm', [], { supports: ['Orange'] }),
  element('OFF_LIST', 'Charm'),
  element('KNACK', 'Knack'),
]);

function hero(callings: string[], added: string[], blocks: Record<string, string> = {}, prepared?: Record<string, string[]>): Character {
  let character = createCharacter('test', 'hero', { progress: 1 });
  character.choices = [{ ruleKey: 'build/calling', elementIds: callings }];
  for (const id of added) character = setAdded(character, id, true);
  for (const [id, block] of Object.entries(blocks)) character = setAdditionBlock(character, id, block);
  if (prepared) character.prepared = prepared;
  return character;
}

const codes = (derived: ReturnType<typeof deriveCharacter>) => derived.problems.map((p) => p.code);

test('an addition cast through a preparing block is always prepared there and counts against nothing', () => {
  // Fails if the derivation does not attach additions to their block (OFF_LIST is on no list, and with ON_LIST
  // prepared the block reads 1 chosen of 1 either way, so the `always` list is what shows it).
  const derived = deriveCharacter(hero(['ORANGE'], ['OFF_LIST'], { OFF_LIST: 'Orange' }, { orange: ['ON_LIST'] }), system(), index);
  assert.deepEqual(derived.additionBlocks, [{ elementId: 'OFF_LIST', block: 'Orange' }]);
  const orange = derived.preparation.find((b) => b.key === 'orange');
  assert.deepEqual(orange?.always, ['OFF_LIST']);
  assert.deepEqual(orange?.chosen, ['ON_LIST']);
  assert.equal(orange?.over, 0);
  assert.deepEqual(codes(derived), []);
});

test('with no block recorded an addition is on no list, as before', () => {
  // Fails if an addition is attached to the only block without a record (the derivation must not guess).
  const derived = deriveCharacter(hero(['ORANGE'], ['OFF_LIST']), system(), index);
  assert.deepEqual(derived.additionBlocks, []);
  assert.deepEqual(derived.preparation[0]?.always, []);
});

test('an addition cast through a block that does not prepare is published and on no list', () => {
  // Fails if a block's name is published only when the block prepares.
  const derived = deriveCharacter(hero(['ORANGE', 'PURPLE'], ['OFF_LIST'], { OFF_LIST: 'purple' }), system(), index);
  assert.deepEqual(derived.additionBlocks, [{ elementId: 'OFF_LIST', block: 'Purple' }]);
  assert.deepEqual(derived.preparation.find((b) => b.key === 'orange')?.always, []);
});

test('a block nothing the character holds declares is a warning, and the addition is cast through none', () => {
  // Fails if a record naming a missing block is published, or is silent.
  const derived = deriveCharacter(hero(['PURPLE'], ['OFF_LIST'], { OFF_LIST: 'orange' }), system(), index);
  assert.deepEqual(derived.additionBlocks, []);
  assert.deepEqual(codes(derived), ['addition-block-missing']);
  assert.equal(
    derived.problems[0]?.message,
    'OFF_LIST was added to be cast as orange, and the character no longer has it. It is cast through no calling until another is chosen.',
  );
});

test('a record on a type the kind does not cast through a block is a warning and ignored', () => {
  // Fails if `additions.blocks.types` is not read (KNACK would be published as cast through Orange).
  const derived = deriveCharacter(hero(['ORANGE'], ['KNACK'], { KNACK: 'orange' }), system(), index);
  assert.deepEqual(derived.additionBlocks, []);
  assert.deepEqual(codes(derived), ['addition-block-not-allowed']);
  const none = deriveCharacter(hero(['ORANGE'], ['OFF_LIST'], { OFF_LIST: 'orange' }), system(false), index);
  assert.deepEqual(codes(none), ['addition-block-not-allowed'], 'a kind with no blocks declaration casts nothing through one');
});

test('recording a block raises the character to format 10, and taking the addition off takes the block with it', () => {
  // Fails if `setAdditionBlock` does not raise the version or leaves an empty map, or if `setAdded` keeps the record.
  const added = setAdded(createCharacter('test', 'hero', { progress: 1 }), 'OFF_LIST', true);
  assert.equal(added.formatVersion, 5);
  const ten = setAdditionBlock(added, 'OFF_LIST', ' Orange ');
  assert.equal(ten.formatVersion, 10);
  assert.deepEqual(ten.additionBlocks, { OFF_LIST: 'orange' });
  assert.equal(setAdditionBlock(ten, 'OFF_LIST', 'orange'), ten, 'the same block again changes nothing');
  const forgotten = setAdditionBlock(ten, 'OFF_LIST', undefined);
  assert.equal('additionBlocks' in forgotten, false);
  assert.equal(forgotten.formatVersion, 10);
  const removed = setAdded(ten, 'OFF_LIST', false);
  assert.equal('additionBlocks' in removed, false);
});

test('a save derives the same block with no source', () => {
  // Fails if the block's name were read from anything a save does not carry (the declaring element is embedded).
  const s = system();
  const character = hero(['ORANGE'], ['OFF_LIST'], { OFF_LIST: 'orange' });
  const embedded = collectCharacterContent(character, index, { kind: resolveCharacterKind(s, 'hero') });
  const alone = new MapElementIndex();
  alone.addAll(embedded.elements);
  const withNone = deriveCharacter(character, s, alone);
  assert.deepEqual(withNone.additionBlocks, deriveCharacter(character, s, index).additionBlocks);
  assert.deepEqual(withNone.preparation[0]?.always, ['OFF_LIST']);
});
