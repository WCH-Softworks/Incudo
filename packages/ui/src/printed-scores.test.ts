/**
 * A score an element prints is set, and a typed one replaces it — ADR 0057, as the builder shows it.
 *
 * No game in the fixture: a "Beast" printing "might" is what a creature printing Strength is in 5e.
 * Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, type Element, type GameSystem, type Setter } from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';

function beast(id: string, printed: Record<string, string>): Element {
  const setters: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(printed)) setters[key] = { value };
  return { id, type: 'Beast', name: id, source: 'test', setters, rules: [], supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Beast' }],
  stats: [
    { name: 'vigour', default: 10 },
    { name: 'grit', default: 10 },
    { name: 'spare points', default: 0 },
  ],
  generationMethods: [{ id: 'manual', label: 'Manual', min: 1, max: 30 }],
  characterKinds: [
    {
      id: 'keeper',
      name: 'Keeper',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Beast'],
      setterStats: [
        { types: ['Beast'], setter: 'might', stat: 'vigour' },
        { types: ['Beast'], setter: 'nerve', stat: 'grit' },
      ],
      buildSteps: [
        { id: 'beast', label: 'Beast', types: ['Beast'], required: true },
        {
          id: 'scores',
          label: 'Scores',
          types: [],
          required: true,
          budget: { stat: 'spare points', targets: ['vigour', 'grit'], methods: ['manual'] },
        },
      ],
      sheet: { sections: [] },
    },
  ],
};

function build(...elements: Element[]): CharacterBuilder {
  const index = new MapElementIndex();
  index.addAll(elements);
  return new CharacterBuilder(createCharacter('test', 'keeper'), system, index);
}

const scores = (b: CharacterBuilder) => b.getState().steps.find((s) => s.id === 'scores')!.budget!;
const row = (b: CharacterBuilder, stat: string) => scores(b).rows.find((r) => r.stat === stat)!;
const budgetOpen = (b: CharacterBuilder) => b.getState().decisions.some((d) => d.kind === 'budget');

test('with nothing printed, every score is still to enter and the step is open', () => {
  const b = build(beast('OX', { might: '16', nerve: '7' }));
  assert.deepEqual(scores(b).unassigned, ['vigour', 'grit']);
  assert.equal(budgetOpen(b), true);
  assert.equal(row(b, 'vigour').printed, undefined);
});

test('a held element that prints the scores sets them, and the step closes', () => {
  // Fails if `unassigned` ignores what is printed (the step stays open with two to enter).
  const b = build(beast('OX', { might: '16', nerve: '7' }));
  b.choose('build/beast', ['OX']);
  assert.deepEqual(scores(b).unassigned, []);
  assert.equal(budgetOpen(b), false);
  const vigour = row(b, 'vigour');
  assert.equal(vigour.printed, 16);
  assert.equal(vigour.base, undefined);
  assert.equal(vigour.total, 16);
  // Fails if the bonus is measured from the declared default (reads +6, "from somewhere").
  assert.equal(vigour.bonus, 0);
});

test('a typed score replaces the print, and clearing it goes back', () => {
  const b = build(beast('OX', { might: '16', nerve: '7' }));
  b.choose('build/beast', ['OX']);
  b.setBudgetStat('scores', 'vigour', 18);
  assert.equal(row(b, 'vigour').total, 18);
  assert.equal(row(b, 'vigour').base, 18);
  b.setBudgetStat('scores', 'vigour', undefined);
  assert.equal(row(b, 'vigour').total, 16);
  assert.equal(b.getState().character.baseStats?.['vigour'], undefined, 'nothing printed is stored');
});

test('a step up or down goes from the print, not from the lowest value the method allows', () => {
  // Fails if the stepper ignores the print (one up from a printed 16 would be 1).
  const b = build(beast('OX', { might: '16', nerve: '7' }));
  b.choose('build/beast', ['OX']);
  b.setGenerationMethod('scores', 'manual');
  assert.equal(row(b, 'vigour').increase?.value, 17);
  assert.equal(row(b, 'vigour').decrease?.value, 15);
});

test('a score the element does not print is still to enter', () => {
  const b = build(beast('HALF', { might: '12' }));
  b.choose('build/beast', ['HALF']);
  assert.deepEqual(scores(b).unassigned, ['grit']);
  assert.equal(budgetOpen(b), true);
});

test("a stat that starts from content's own rule counts as set, and a typed value replaces it — ADR 0059", () => {
  // Fails if the row reads its print from setters alone rather than from the derivation's starts (the
  // guard row is unassigned and the step stays open), or if the only method's bounds are not applied (a
  // typed 697 is refused by the 1-30 of ability scores: here the method has no maximum).
  const guarded: GameSystem = {
    ...system,
    stats: [{ name: 'guard', default: 0, startsFrom: 'beast:guard' }, { name: 'spare points', default: 0 }],
    generationMethods: [{ id: 'entry', label: 'Entry', min: 0 }],
    characterKinds: [
      {
        ...system.characterKinds[0]!,
        setterStats: [],
        buildSteps: [
          { id: 'beast', label: 'Beast', types: ['Beast'], required: true },
          { id: 'scores', label: 'Guard', types: [], required: true, budget: { stat: 'spare points', targets: ['guard'], methods: ['entry'] } },
        ],
      },
    ],
  };
  const ox: Element = {
    ...beast('OX', {}),
    rules: [{ kind: 'stat', key: 'g', name: 'beast:guard', value: { kind: 'number', value: 13 } }],
  };
  const index = new MapElementIndex();
  index.addAll([ox]);
  const b = new CharacterBuilder(createCharacter('test', 'keeper'), guarded, index);
  assert.deepEqual(scores(b).unassigned, ['guard']);
  b.choose('build/beast', ['OX']);
  assert.deepEqual(scores(b).unassigned, []);
  assert.equal(row(b, 'guard').printed, 13);
  assert.equal(row(b, 'guard').total, 13);
  b.setBudgetStat('scores', 'guard', 697);
  assert.equal(row(b, 'guard').total, 697);
  assert.equal(row(b, 'guard').printed, 13);
  b.setBudgetStat('scores', 'guard', -4);
  assert.equal(row(b, 'guard').base, 0, "the method's floor applies unrecorded");
});
