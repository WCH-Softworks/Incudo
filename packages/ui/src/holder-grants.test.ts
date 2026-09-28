/**
 * What a creature gives is listed, and each piece can be taken away and given back — ADR 0061, as the builder
 * shows it, and ADR 0067 for what a creature grants by a rule alone.
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
  elementTypes: [{ name: 'Beast' }, { name: 'Deed' }, { name: 'Knack' }, { name: 'Cry' }, { name: 'Charm' }],
  stats: [],
  characterKinds: [
    {
      id: 'keeper',
      name: 'Keeper',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Beast', 'Deed', 'Knack', 'Charm'],
      setterGrants: [{ types: ['Beast'], setter: 'deeds' }],
      buildSteps: [
        { id: 'beast', label: 'Beast', types: ['Beast'], required: true },
        { id: 'deeds', label: 'Deeds', types: ['Deed'], multiple: true },
        { id: 'charms', label: 'Charms', types: ['Charm'], multiple: true },
      ],
      // A type no step offers and the sheet lists, as an NPC lists the legendary actions its creature grants.
      sheet: { sections: [{ id: 'cries', label: 'Cries', types: ['Cry'] }] },
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
  // A drake names nothing, and grants by rules alone: a cry the sheet lists, then a deed a step offers.
  element('DRAKE', 'Beast', {}, [grant('HOWL', 'Cry'), grant('ROAR', 'Deed')]),
  element('HOWL', 'Cry'),
  element('ROAR', 'Deed'),
  // A charm is no holder, and grants a deed as a class grants a class feature.
  element('CHARM', 'Charm', {}, [grant('STRAY', 'Deed')]),
]);

function grant(id: string, type: string): Rule {
  return { kind: 'grant', key: `g:${id}`, type, id };
}

function onOx(): CharacterBuilder {
  const b = new CharacterBuilder(createCharacter('test', 'keeper'), system, index);
  b.choose('build/beast', ['OX']);
  return b;
}

test('what the creature names is listed with its giver and the step whose types it is', () => {
  // Fails if the builder does not publish `holderGrants` (a shell would have nothing to offer removing).
  assert.deepEqual(onOx().getState().holderGrants, [
    { elementId: 'BITE', from: 'OX', stepId: 'deeds', group: 'Deeds', removed: false, held: true },
    { elementId: 'CLAW', from: 'OX', stepId: 'deeds', group: 'Deeds', removed: false, held: true },
    { elementId: 'SNIFF', from: 'OX', stepId: '', group: '', removed: false, held: true },
  ]);
});

test('removing one takes it off the character and keeps it listed to give back', () => {
  // Fails if `removeGranted` does not write `removedGrants`, or the list drops a removed one.
  const b = onOx();
  b.removeGranted('BITE');
  const state = b.getState();
  assert.deepEqual(state.character.removedGrants, ['BITE']);
  assert.equal(state.derived.elementIds.has('BITE'), false);
  assert.deepEqual(state.holderGrants[0], {
    elementId: 'BITE',
    from: 'OX',
    stepId: 'deeds',
    group: 'Deeds',
    removed: true,
    held: false,
  });
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

test("what a creature grants by a rule alone is listed under its step or its sheet heading, and can be removed", () => {
  // ADR 0067. Fails if the list reads only the setters (`setterGrantIds` for `holderGivenIds`: nothing is listed and
  // Remove is refused), or if a type no step offers is grouped under nothing rather than its sheet section.
  const b = new CharacterBuilder(createCharacter('test', 'keeper'), system, index);
  b.choose('build/beast', ['DRAKE']);
  assert.deepEqual(b.getState().holderGrants, [
    { elementId: 'ROAR', from: 'DRAKE', stepId: 'deeds', group: 'Deeds', removed: false, held: true },
    { elementId: 'HOWL', from: 'DRAKE', stepId: '', group: 'Cries', removed: false, held: true },
  ]);
  b.removeGranted('HOWL');
  const state = b.getState();
  assert.deepEqual(state.character.removedGrants, ['HOWL']);
  assert.equal(state.derived.elementIds.has('HOWL'), false);
  assert.equal(state.holderGrants.find((g) => g.elementId === 'HOWL')?.removed, true);
  b.restoreGranted('HOWL');
  assert.ok(b.getState().derived.elementIds.has('HOWL'));
});

test('what an element that is no holder grants is not listed, and cannot be removed', () => {
  // ADR 0067: a class's feature is the case this guards. Fails if every held element's grants are listed (`holderGivenIds`
  // without `isGrantHolder`): the charm's deed is listed and removed.
  const b = new CharacterBuilder(createCharacter('test', 'keeper'), system, index);
  b.choose('build/charms', ['CHARM']);
  assert.deepEqual(b.getState().holderGrants, []);
  b.removeGranted('STRAY');
  assert.equal(b.getState().character.removedGrants, undefined);
  assert.ok(b.getState().derived.elementIds.has('STRAY'));
});
