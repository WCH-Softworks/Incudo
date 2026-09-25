/**
 * What a creature gives is listed, and each piece can be taken away and given back — ADR 0061, as the builder
 * shows it.
 *
 * No game in the fixture: an Ox names its "deeds", as a creature names its actions. Each test names the change
 * that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, type Element, type GameSystem, type Rule } from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string, setters: Record<string, string> = {}, rules: Rule[] = []): Element {
  const out: Element['setters'] = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return { id, type, name: id, source: 'test', setters: out, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Beast' }, { name: 'Deed' }, { name: 'Knack' }],
  stats: [],
  characterKinds: [
    {
      id: 'keeper',
      name: 'Keeper',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Beast', 'Deed', 'Knack'],
      setterGrants: [{ types: ['Beast'], setter: 'deeds' }],
      buildSteps: [
        { id: 'beast', label: 'Beast', types: ['Beast'], required: true },
        { id: 'deeds', label: 'Deeds', types: ['Deed'], multiple: true },
      ],
      sheet: { sections: [] },
    },
  ],
};

const index = new MapElementIndex();
index.addAll([
  element('OX', 'Beast', { deeds: 'BITE, CLAW, SNIFF' }),
  element('BEAR', 'Beast', { deeds: 'CLAW' }),
  element('BITE', 'Deed'),
  element('CLAW', 'Deed'),
  element('SNIFF', 'Knack'),
  element('STRAY', 'Deed'),
]);

function onOx(): CharacterBuilder {
  const b = new CharacterBuilder(createCharacter('test', 'keeper'), system, index);
  b.choose('build/beast', ['OX']);
  return b;
}

test('what the creature names is listed with its giver and the step whose types it is', () => {
  // Fails if the builder does not publish `holderGrants` (a shell would have nothing to offer removing).
  assert.deepEqual(onOx().getState().holderGrants, [
    { elementId: 'BITE', from: 'OX', stepId: 'deeds', removed: false, held: true },
    { elementId: 'CLAW', from: 'OX', stepId: 'deeds', removed: false, held: true },
    { elementId: 'SNIFF', from: 'OX', stepId: '', removed: false, held: true },
  ]);
});

test('removing one takes it off the character and keeps it listed to give back', () => {
  // Fails if `removeGranted` does not write `removedGrants`, or the list drops a removed one.
  const b = onOx();
  b.removeGranted('BITE');
  const state = b.getState();
  assert.deepEqual(state.character.removedGrants, ['BITE']);
  assert.equal(state.derived.elementIds.has('BITE'), false);
  assert.deepEqual(state.holderGrants[0], { elementId: 'BITE', from: 'OX', stepId: 'deeds', removed: true, held: false });
  // A set offers what the character does not hold, so the removed deed can also be picked by hand.
  const offered = state.decisions.find((d) => d.stepId === 'deeds')?.candidates ?? [];
  assert.ok(offered.includes('BITE'));
  b.restoreGranted('BITE');
  assert.equal(b.getState().character.removedGrants, undefined);
  assert.ok(b.getState().derived.elementIds.has('BITE'));
});

test('only what a held element names can be removed', () => {
  // Fails if `removeGranted` writes whatever it is given (a class feature is content's to give, not the user's).
  const b = onOx();
  b.removeGranted('STRAY');
  assert.equal(b.getState().character.removedGrants, undefined);
  assert.equal(b.getState().character.formatVersion, 2);
});

test('a removal nothing names any more is forgotten when the creature changes, and one still named is kept', () => {
  // Fails if `choose` leaves removals behind for a creature the character no longer holds (a record no screen
  // shows and nobody can give back).
  const b = onOx();
  b.removeGranted('BITE');
  b.removeGranted('CLAW');
  b.choose('build/beast', ['BEAR']);
  assert.deepEqual(b.getState().character.removedGrants, ['CLAW']);
  assert.equal(b.getState().derived.elementIds.has('CLAW'), false);
});
