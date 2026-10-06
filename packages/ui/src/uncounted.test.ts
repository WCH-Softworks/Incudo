/**
 * Picks that no longer count, through the builder — ADR 0096.
 *
 * No game in the fixture. A levelled kind whose Role is a required pick. A Keeper's "Bump" pool takes one Trinket at
 * level 2 and one more at 4; a Seer's "Sign" pool takes one Trinket. Each test names the change that fails it, and each
 * was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, type Element, type GameSystem, type Rule } from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';
import { UNCOUNTED_HEADING, unplacedNote } from './uncounted.ts';

function element(id: string, type: string, rules: Rule[] = [], supports: string[] = []): Element {
  return { id, type, name: id, source: 'test', setters: {}, rules, supports, origin: { sourceId: 'test', format: 'incudo' } };
}

const select = (name: string, level: number): Rule => ({ kind: 'select', key: `select:${name}`, type: 'Trinket', name, number: 1, level });

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Role' }, { name: 'Trinket' }],
  stats: [{ name: 'vigour', default: 10 }],
  characterKinds: [
    {
      id: 'hero',
      name: 'Hero',
      default: true,
      progression: { kind: 'level', min: 1, max: 20 },
      elementTypes: ['Role', 'Trinket'],
      buildSteps: [
        { id: 'role', label: 'Role', types: ['Role'], required: true },
        { id: 'trinkets', label: 'Trinkets', types: ['Trinket'] },
      ],
      sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
    },
  ],
};

const index = new MapElementIndex();
index.addAll([
  element('KEEPER', 'Role', [select('Bump', 2), select('Bump', 4)]),
  element('SEER', 'Role', [select('Sign', 1)]),
  element('RING', 'Trinket'),
  element('CUP', 'Trinket'),
  element('KEY', 'Trinket'),
]);

function keeper(level: number): CharacterBuilder {
  const b = new CharacterBuilder({ ...createCharacter('test', 'hero'), progress: level }, system, index);
  b.choose('build/role', ['KEEPER']);
  return b;
}

const record = (b: CharacterBuilder, key: string) => b.getState().character.choices.find((c) => c.ruleKey === key)?.elementIds;

test('a level lowered away leaves the pick recorded, listed as not counting, and forgettable', () => {
  // Fails if lowering the level drops the pick from the record, if the builder does not list it, or if Forget does not
  // remove exactly it.
  const b = keeper(4);
  b.choose('KEEPER/select:Bump', ['RING', 'CUP']);
  b.setProgress(3);
  const state = b.getState();
  assert.deepEqual(record(b, 'KEEPER/select:Bump'), ['RING', 'CUP']);
  assert.equal(state.derived.elementIds.has('CUP'), false);
  assert.deepEqual(
    state.uncounted.map((row) => [row.label, row.reason, row.note, row.items.map((i) => i.name)]),
    [['Bump', 'over', 'Bump has room for 1 now; these are past it.', ['CUP']]],
  );
  assert.deepEqual(state.picks.find((p) => p.ruleKey === 'KEEPER/select:Bump')?.chosen, ['RING'], 'one slot, one answer');

  b.setProgress(4);
  assert.ok(b.getState().derived.elementIds.has('CUP'), 'counted again when the slot is back');
  b.setProgress(1);
  assert.deepEqual(b.getState().uncounted[0]?.note, 'KEEPER does not offer Bump at this point.');
  b.forgetUncounted('KEEPER/select:Bump', 1);
  assert.deepEqual(record(b, 'KEEPER/select:Bump'), ['RING']);
  b.forgetUncounted('KEEPER/select:Bump');
  assert.equal(record(b, 'KEEPER/select:Bump'), undefined, 'an empty record goes');
  assert.deepEqual(b.getState().uncounted, []);
  assert.equal(UNCOUNTED_HEADING, 'Not counting');
});

test('changing the answer to a pool keeps its picks waiting for a slot', () => {
  // Keeper 4 with two picks, lowered to 2: CUP waits. Changing the one slot to KEY must not drop CUP. Fails if `choose`
  // writes only what the screen passed.
  const b = keeper(4);
  b.choose('KEEPER/select:Bump', ['RING', 'CUP']);
  b.setProgress(2);
  b.choose('KEEPER/select:Bump', ['KEY']);
  assert.deepEqual(record(b, 'KEEPER/select:Bump'), ['KEY', 'CUP']);
  assert.deepEqual(b.getState().uncounted.flatMap((row) => row.items.map((i) => i.name)), ['CUP']);
  // And a screen that passes the waiting pick back itself does not record it twice.
  b.choose('KEEPER/select:Bump', ['CUP']);
  assert.deepEqual(record(b, 'KEEPER/select:Bump'), ['CUP']);
});

test('a role changed away leaves its picks listed as from something the character no longer has', () => {
  // Fails if the old role's answers still count, or the sentence does not say why.
  const b = keeper(4);
  b.choose('KEEPER/select:Bump', ['RING']);
  b.choose('build/role', ['SEER']);
  const [row] = b.getState().uncounted;
  assert.equal(row?.note, 'Nothing on this character offers this choice now.');
  assert.equal(b.getState().derived.elementIds.has('RING'), false);
});

test('the words beside a slot whose answer no slot offers', () => {
  assert.equal(unplacedNote('Ring'), 'Ring is not something this choice offers this character now.');
});
