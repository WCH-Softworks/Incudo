/**
 * A score in the build shows what the kind's sheet shows beside it, "14 (+4)", read off the derivation.
 *
 * No game in the fixture: "vigour" and its "edge" are what a score and its modifier are in 5e, and the formula is the
 * system's, never the view-model's. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, type GameSystem } from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';
import { budgetTotalText } from './budget.ts';

function system(beside: string | undefined): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [],
    stats: [
      { name: 'vigour', default: 10 },
      { name: 'grit', default: 10 },
      // Not half of anything, so a view-model working out 5e's formula itself would read +2 where this reads +4.
      {
        name: 'vigour:edge',
        signed: true,
        derive: { kind: 'binary', op: '-', left: { kind: 'ref', stat: 'vigour' }, right: { kind: 'number', value: 10 } },
      },
      { name: 'spare points', default: 0 },
    ],
    generationMethods: [{ id: 'manual', label: 'Manual', min: 1, max: 30 }],
    characterKinds: [
      {
        id: 'keeper',
        name: 'Keeper',
        default: true,
        progression: { kind: 'none' },
        elementTypes: [],
        buildSteps: [
          {
            id: 'scores',
            label: 'Scores',
            types: [],
            required: true,
            budget: { stat: 'spare points', targets: ['vigour', 'grit'], methods: ['manual'] },
          },
        ],
        sheet: {
          sections: [{ id: 'scores', label: 'Scores', stats: ['vigour', 'grit'], ...(beside ? { beside } : {}) }],
        },
      },
    ],
  };
}

const rows = (beside: string | undefined) => {
  const b = new CharacterBuilder(createCharacter('test', 'keeper'), system(beside), new MapElementIndex());
  b.setBudgetStat('scores', 'vigour', 14);
  b.setBudgetStat('scores', 'grit', 7);
  return b.getState().steps.find((s) => s.id === 'scores')!.budget!.rows;
};

test('a score shows what its sheet section shows beside it, signed as the stat is', () => {
  // Fails if the row reads no `beside`, if `{stat}` is not filled, or if the value is not written as the sheet writes it.
  const [vigour, grit] = rows('{stat}:edge');
  assert.equal(vigour!.beside, '+4');
  assert.equal(budgetTotalText(vigour!), '14 (+4)');
  // A stat the template names that nothing publishes shows nothing, rather than "—".
  assert.equal(grit!.beside, undefined);
  assert.equal(budgetTotalText(grit!), '7');
});

test('a kind whose sheet shows nothing beside its scores shows the total alone', () => {
  // Fails if the build adds a modifier of its own where the system declares none.
  const [vigour] = rows(undefined);
  assert.equal(vigour!.beside, undefined);
  assert.equal(budgetTotalText(vigour!), '14');
});
