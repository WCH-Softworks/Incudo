import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter } from './character.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import type { GameSystem } from './system.ts';

// A fixture with no game in it — see the note in system.test.ts.

function element(id: string, type: string, rules: Rule[] = []): Element {
  return {
    id,
    type,
    name: id,
    source: 'test',
    setters: {},
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

function system(): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Widget' }, { name: 'Gadget' }],
    stats: [
      { name: 'vigour', default: 10 },
      {
        name: 'vigour:modifier',
        derive: {
          kind: 'binary',
          op: '-',
          left: { kind: 'ref', stat: 'vigour' },
          right: { kind: 'number', value: 10 },
        },
      },
    ],
    characterKinds: [
      {
        id: 'levelled',
        name: 'Levelled',
        default: true,
        progression: { kind: 'level', min: 1, max: 20 },
        elementTypes: ['Widget', 'Gadget'],
        buildSteps: [],
        sheet: { sections: [] },
      },
      {
        id: 'rated',
        name: 'Rated',
        progression: { kind: 'rating', stat: 'threat', min: 0, max: 30 },
        elementTypes: ['Widget'],
        stats: [{ name: 'threat', default: 0 }],
        buildSteps: [],
        sheet: { sections: [] },
      },
      {
        id: 'flat',
        name: 'Flat',
        progression: { kind: 'none' },
        elementTypes: ['Widget'],
        buildSteps: [],
        sheet: { sections: [] },
      },
    ],
  };
}

function indexWith(...elements: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll(elements);
  return index;
}

test('the progression number is published as the stat the kind names', () => {
  const index = indexWith(element('W', 'Widget'));

  const levelled = { ...createCharacter('test', 'levelled'), progress: 7 };
  levelled.choices = [{ ruleKey: 'seed', elementIds: ['W'] }];
  const a = deriveCharacter(levelled, system(), index);
  assert.equal(a.stats.get('level')?.value, 7);
  assert.equal(a.stats.get('threat'), undefined);

  const rated = { ...createCharacter('test', 'rated'), progress: 12 };
  rated.choices = [{ ruleKey: 'seed', elementIds: ['W'] }];
  const b = deriveCharacter(rated, system(), index);
  assert.equal(b.stats.get('threat')?.value, 12);
  // "level" is not a thing this kind has. Nothing in the engine says otherwise.
  assert.equal(b.stats.get('level'), undefined);
});

test('a level gate compares against progress, whatever progress counts', () => {
  const index = indexWith(
    element('W', 'Widget', [
      { kind: 'stat', key: 'early', name: 'vigour', value: { kind: 'number', value: 1 } },
      {
        kind: 'stat',
        key: 'late',
        name: 'vigour',
        value: { kind: 'number', value: 100 },
        level: 5,
      },
    ]),
  );

  const low = { ...createCharacter('test', 'levelled'), progress: 1 };
  low.choices = [{ ruleKey: 'seed', elementIds: ['W'] }];
  assert.equal(deriveCharacter(low, system(), index).stats.get('vigour')?.value, 11);

  const high = { ...low, progress: 5 };
  assert.equal(deriveCharacter(high, system(), index).stats.get('vigour')?.value, 111);

  // The same gate on a rating: CR 5 is past a level="5" gate, because the engine only
  // ever compares two numbers and never asks what they mean.
  const rated = { ...createCharacter('test', 'rated'), progress: 5 };
  rated.choices = [{ ruleKey: 'seed', elementIds: ['W'] }];
  assert.equal(deriveCharacter(rated, system(), index).stats.get('vigour')?.value, 111);
});

test('a kind with no progression ignores level gates rather than failing them', () => {
  const index = indexWith(
    element('W', 'Widget', [
      { kind: 'stat', key: 'late', name: 'vigour', value: { kind: 'number', value: 5 }, level: 3 },
    ]),
  );
  const flat = createCharacter('test', 'flat');
  flat.choices = [{ ruleKey: 'seed', elementIds: ['W'] }];

  const derived = deriveCharacter(flat, system(), index);
  assert.equal(derived.character.progress, 0);
  // 15, not 10: a level-less system cannot express "at level 3", so dropping the rule
  // would be a reading the content never asked for.
  assert.equal(derived.stats.get('vigour')?.value, 15);
});

test('grants expand to a fixed point, and derived stats see the result', () => {
  const index = indexWith(
    element('A', 'Widget', [{ kind: 'grant', key: 'g', type: 'Widget', id: 'B' }]),
    element('B', 'Widget', [
      { kind: 'grant', key: 'g', type: 'Widget', id: 'C' },
      { kind: 'stat', key: 's', name: 'vigour', value: { kind: 'number', value: 2 } },
    ]),
    element('C', 'Widget', [
      { kind: 'stat', key: 's', name: 'vigour', value: { kind: 'number', value: 4 } },
    ]),
  );
  const character = createCharacter('test', 'levelled');
  character.progress = 1;
  character.choices = [{ ruleKey: 'seed', elementIds: ['A'] }];

  const derived = deriveCharacter(character, system(), index);
  assert.deepEqual([...derived.elementIds].sort(), ['A', 'B', 'C']);
  assert.equal(derived.stats.get('vigour')?.value, 16);
  assert.equal(derived.stats.get('vigour:modifier')?.value, 6);
  assert.deepEqual(derived.problems, []);
});

test('bonuses sharing a bucket do not stack; the largest wins', () => {
  const index = indexWith(
    element('A', 'Widget', [
      { kind: 'stat', key: 'a', name: 'vigour', value: { kind: 'number', value: 2 }, bonus: 'ring' },
      { kind: 'stat', key: 'b', name: 'vigour', value: { kind: 'number', value: 5 }, bonus: 'ring' },
      { kind: 'stat', key: 'c', name: 'vigour', value: { kind: 'number', value: 1 } },
    ]),
  );
  const character = createCharacter('test', 'levelled');
  character.progress = 1;
  character.choices = [{ ruleKey: 'seed', elementIds: ['A'] }];

  assert.equal(deriveCharacter(character, system(), index).stats.get('vigour')?.value, 16);
});

test('the resolved kind travels with the derivation', () => {
  const character = createCharacter('test', 'rated');
  const derived = deriveCharacter(character, system(), indexWith());
  assert.equal(derived.kind.id, 'rated');
  assert.deepEqual(derived.kind.elementTypes, ['Widget']);
});
