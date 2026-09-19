/**
 * A top-level pick — race, class, background — is answered by what a character holds, not by the
 * key it happens to be recorded under.
 *
 * An imported Aurora save records its race under `ID_LEVEL_1/select:Race` and the importer is
 * frozen, so a builder that only looked under `build/<stepId>` reported all three picks open and
 * blocking on a character that had them, and choosing a race added a second Race beside the
 * imported one. Measured on the level 20 Paladin 2 / Warlock 18 oracle; the real save is checked
 * in `tools/incudo/src/multiclass.test.ts`, and this file holds the shape with no game in it.
 *
 * Each test was written to fail if the behaviour it names is removed, and was checked by removing
 * it — the perturbation is named beside the assertion that catches it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  MapElementIndex,
  type Character,
  type Element,
  type GameSystem,
  type Rule,
} from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';

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

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Origin' }, { name: 'Widget' }, { name: 'Gadget' }],
  stats: [{ name: 'vigour', default: 10 }],
  characterKinds: [
    {
      id: 'pc',
      name: 'PC',
      default: true,
      progression: { kind: 'level', min: 1, max: 20, stat: 'level' },
      elementTypes: ['Origin', 'Widget', 'Gadget'],
      buildSteps: [
        { id: 'origin', label: 'Origin', types: ['Origin'], required: true },
        { id: 'kit', label: 'Kit', types: ['Widget'], required: true },
        { id: 'extras', label: 'Extras', types: ['Gadget'] },
      ],
      sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
    },
  ],
};

function corpus(...extra: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll([
    element('O1', 'Origin'),
    element('O2', 'Origin'),
    element('W1', 'Widget'),
    element('W2', 'Widget'),
    element('G1', 'Gadget'),
    ...extra,
  ]);
  return index;
}

/** A character shaped as an import writes it: Aurora's keys, and nothing under `build/`. */
function imported(): Character {
  return {
    ...createCharacter('test', 'pc', { progress: 1 }),
    choices: [
      { ruleKey: 'LVL_1/select:Origin', elementIds: ['O1'] },
      { ruleKey: 'LVL_1/select:Kit', elementIds: ['W1'] },
    ],
  };
}

const open = (b: CharacterBuilder) => b.getState().decisions.filter((d) => d.kind === 'pick');
const holding = (b: CharacterBuilder, id: string) =>
  b.getState().character.choices.filter((c) => c.elementIds.includes(id));

test('a pick an import answered under its own key is not open', () => {
  // Perturbation: look the answer up by `build/<stepId>` only and both picks come back open.
  const b = new CharacterBuilder(imported(), system, corpus());

  assert.deepEqual(open(b), [], 'nothing blocks on a race the character already has');
  const picks = b.getState().picks;
  assert.deepEqual(
    picks.map((p) => [p.stepId, p.chosen]),
    [
      ['origin', ['O1']],
      ['kit', ['W1']],
    ],
  );
  assert.deepEqual(picks[0]!.candidates.sort(), ['O1', 'O2'], 'and it can still be changed');
});

test('the settled pick carries the key the answer is recorded under', () => {
  const b = new CharacterBuilder(imported(), system, corpus());
  assert.deepEqual(
    b.getState().picks.map((p) => p.ruleKey),
    ['LVL_1/select:Origin', 'LVL_1/select:Kit'],
  );
});

test('changing an imported pick replaces its record instead of adding a second', () => {
  // Perturbation: make `replacePickAnswer` plain `setChoice` on `build/<stepId>` and the
  // character ends up holding both O1 and O2, each seeding the derivation.
  const b = new CharacterBuilder(imported(), system, corpus());
  const pick = b.getState().picks.find((p) => p.stepId === 'origin')!;
  b.choose(pick.ruleKey, ['O2']);

  const state = b.getState();
  assert.deepEqual(holding(b, 'O2').map((c) => c.ruleKey), ['LVL_1/select:Origin']);
  assert.deepEqual(holding(b, 'O1'), []);
  assert.ok(state.derived.elementIds.has('O2'));
  assert.ok(!state.derived.elementIds.has('O1'), 'the imported race stops seeding the derivation');
  assert.equal(state.character.choices.some((c) => c.ruleKey.startsWith('build/')), false);
  assert.deepEqual(open(b), []);
});

test('answering under the builder\'s own key replaces the imported record too', () => {
  // The other route to the same bug: a caller that only knows `build/<stepId>`.
  // Perturbation: drop the superseded-record filter and both records survive.
  const b = new CharacterBuilder(imported(), system, corpus());
  b.choose('build/origin', ['O2']);

  assert.deepEqual(holding(b, 'O2').map((c) => c.ruleKey), ['build/origin']);
  assert.deepEqual(holding(b, 'O1'), [], 'the imported record is gone, not shadowed');
  assert.deepEqual(
    b.getState().picks.filter((p) => p.stepId === 'origin').map((p) => p.chosen),
    [['O2']],
    'and there is one pick for the step, not two',
  );
});

test('a character an earlier build left holding both is repaired by its first change', () => {
  const character: Character = {
    ...imported(),
    choices: [...imported().choices, { ruleKey: 'build/origin', elementIds: ['O2'] }],
  };
  const b = new CharacterBuilder(character, system, corpus());

  assert.equal(b.getState().picks.filter((p) => p.stepId === 'origin').length, 1);
  b.choose('build/origin', ['O1']);
  assert.deepEqual(holding(b, 'O2'), []);
  assert.deepEqual(holding(b, 'O1').map((c) => c.ruleKey), ['build/origin']);
});

test('a step no record answers stays open, whatever else the character holds', () => {
  // Perturbation: match any recorded choice at all, not one of the step's types, and the
  // Gadget below answers both picks.
  const character: Character = {
    ...createCharacter('test', 'pc', { progress: 1 }),
    choices: [{ ruleKey: 'LVL_1/select:Trinket', elementIds: ['G1'] }],
  };
  const b = new CharacterBuilder(character, system, corpus());
  assert.deepEqual(open(b).map((d) => d.stepId).sort(), ['kit', 'origin']);
  assert.deepEqual(b.getState().picks, []);
});

test('one record answers one step, by its own type', () => {
  const character: Character = {
    ...createCharacter('test', 'pc', { progress: 1 }),
    choices: [{ ruleKey: 'LVL_1/select:Origin', elementIds: ['O1'] }],
  };
  const b = new CharacterBuilder(character, system, corpus());
  assert.deepEqual(open(b).map((d) => d.stepId), ['kit']);
  assert.deepEqual(b.getState().picks.map((p) => p.stepId), ['origin']);
});

test('the builder\'s own record is read exactly as before', () => {
  const b = new CharacterBuilder(createCharacter('test', 'pc', { progress: 1 }), system, corpus());
  assert.equal(open(b).length, 2);
  b.choose('build/origin', ['O1']);
  b.choose('build/kit', ['W1']);
  assert.deepEqual(open(b), []);
  assert.deepEqual(
    b.getState().picks.map((p) => p.ruleKey),
    ['build/origin', 'build/kit'],
  );
});

test('taking an imported answer back reopens the pick', () => {
  const b = new CharacterBuilder(imported(), system, corpus());
  b.choose('LVL_1/select:Origin', []);
  assert.deepEqual(open(b).map((d) => d.stepId), ['origin']);
  assert.deepEqual(holding(b, 'O1'), []);
});

test('a content select pool is its own pick, and is not also counted as the step\'s answer', () => {
  // A system whose content lets a select choose a Widget: the pool's record is the pool's, and
  // the `kit` pick stays open beside it. Perturbation: drop `reserved` and the pool's record
  // answers `kit` as well, so the same key is published as two picks.
  const chooser = element('CHOOSER', 'Gadget', [
    { kind: 'select', key: 'select:Pet', type: 'Widget', name: 'Pet', number: 1 },
  ]);
  const character: Character = {
    ...createCharacter('test', 'pc', { progress: 1 }),
    choices: [
      { ruleKey: 'seed', elementIds: ['CHOOSER'] },
      { ruleKey: 'CHOOSER/select:Pet', elementIds: ['W1'] },
    ],
  };
  const b = new CharacterBuilder(character, system, corpus(chooser));

  const pets = b.getState().picks.filter((p) => p.ruleKey === 'CHOOSER/select:Pet');
  assert.equal(pets.length, 1, 'published once, as the pool it is');
  assert.deepEqual(open(b).map((d) => d.stepId).sort(), ['kit', 'origin']);

  b.choose('build/kit', ['W2']);
  assert.deepEqual(
    b.getState().character.choices.find((c) => c.ruleKey === 'CHOOSER/select:Pet')?.elementIds,
    ['W1'],
    'answering the step does not sweep the pool\'s record away',
  );
});
