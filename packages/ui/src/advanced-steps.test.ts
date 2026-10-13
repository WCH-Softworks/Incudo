/**
 * A step the system marks advanced is offered only when the user asks for advanced options — ADR 0115.
 *
 * No game in the fixture: "Extra" is what 5e's additional features are, and the builder cannot tell. Each test names the
 * change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, type Element, type GameSystem } from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string): Element {
  return { id, type, name: id, source: 'test', setters: {}, rules: [], supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Option' }, { name: 'Extra' }],
  stats: [],
  characterKinds: [
    {
      id: 'pc',
      name: 'PC',
      default: true,
      progression: { kind: 'level', min: 1, max: 20, stat: 'level' },
      elementTypes: ['Option', 'Extra'],
      buildSteps: [
        { id: 'options', label: 'Table rules', types: ['Option'], multiple: true },
        { id: 'extras', label: 'Extras', types: ['Extra'], multiple: true, advanced: true },
      ],
      sheet: { sections: [] },
    },
  ],
};

function builder(showAdvanced?: boolean): CharacterBuilder {
  const index = new MapElementIndex();
  index.addAll([element('OPT', 'Option'), element('EXTRA_A', 'Extra'), element('EXTRA_B', 'Extra')]);
  return new CharacterBuilder(createCharacter('test', 'pc', { progress: 1 }), system, index, showAdvanced === undefined ? {} : { showAdvanced });
}

const offered = (b: CharacterBuilder, stepId: string) => b.getState().decisions.some((d) => d.stepId === stepId);
const listed = (b: CharacterBuilder, stepId: string) => b.getState().steps.some((s) => s.id === stepId);

test('an advanced step is not offered by default, and has no line among the parts', () => {
  // Fails if the builder ignores `advanced` (the step is offered and listed), or hides a step that is not advanced.
  const b = builder();
  assert.deepEqual(b.getState().advanced, { steps: ['Extras'], shown: false });
  assert.equal(offered(b, 'extras'), false);
  assert.equal(listed(b, 'extras'), false);
  assert.equal(offered(b, 'options'), true);
  assert.deepEqual(b.getState().declined, [], 'hiding is not declining: nothing is recorded');
  assert.equal(b.getState().character.declinedDecisions, undefined);
});

test('asking for advanced options offers it, and the switch records nothing on the character', () => {
  // Fails if `setShowAdvanced` changes nothing, or if it writes to the character.
  const b = builder();
  const before = b.getState().character;
  b.setShowAdvanced(true);
  assert.equal(offered(b, 'extras'), true);
  assert.equal(listed(b, 'extras'), true);
  assert.equal(b.getState().character, before);
  assert.equal(builder(true).getState().advanced.shown, true, 'the shell may hand the preference in');
});

test('what was taken through an advanced step still shows, changeable, once the switch is off', () => {
  // Fails if hiding drops the settled pick or the step's line along with the offer.
  const b = builder(true);
  b.choose('build/extras', ['EXTRA_A']);
  b.setShowAdvanced(false);
  const state = b.getState();
  assert.equal(offered(b, 'extras'), false, 'nothing more is offered');
  assert.deepEqual(state.picks.find((p) => p.stepId === 'extras')?.chosen, ['EXTRA_A']);
  assert.ok(state.picks.find((p) => p.stepId === 'extras')?.candidates.includes('EXTRA_B'), 'and it can still be changed');
  assert.equal(listed(b, 'extras'), true);
});
