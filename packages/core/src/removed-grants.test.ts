/**
 * The user may take away what a held element gives — ADR 0061, and ADR 0067 for what it grants by a rule alone.
 *
 * No game in the fixture: an Ox names its "deeds", and a keeper may not have one of them, as a DM's Triceratops
 * may not have Stomp. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter, setChoice, setGrantRemoved, type Character } from './character.ts';
import { BundleElementIndex, collectCharacterContent } from './container.ts';
import { MapElementIndex, type Element, type Rule, type Setter } from './model.ts';
import { resolveCharacterKind, type GameSystem } from './system.ts';

function element(id: string, type: string, setters: Record<string, string> = {}, rules: Rule[] = []): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return { id, type, name: id, source: 'test', setters: out, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test System',
  version: '1.0.0',
  elementTypes: [{ name: 'Beast' }, { name: 'Charm' }, { name: 'Deed' }],
  stats: [{ name: 'fury', default: 0 }],
  characterKinds: [
    {
      id: 'keeper',
      name: 'Keeper',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Beast', 'Charm', 'Deed'],
      setterGrants: [{ types: ['Beast'], setter: 'deeds' }],
      buildSteps: [],
      sheet: { sections: [] },
    },
  ],
};
const kind = resolveCharacterKind(system, 'keeper');

const grant = (id: string): Rule => ({ kind: 'grant', key: `g:${id}`, type: 'Deed', id });
const bite = element('BITE', 'Deed');
const claw = element('CLAW', 'Deed', {}, [{ kind: 'stat', key: 'r0', name: 'fury', value: { kind: 'number', value: 2 } }]);
// The ox names both deeds, and also grants the claw by a rule of its own, as twelve creatures in the corpus do.
const ox = element('OX', 'Beast', { deeds: 'BITE, CLAW' }, [grant('CLAW')]);
// A charm grants the bite by a rule: something else giving it, which a removal from the ox does not touch.
const charm = element('CHARM', 'Charm', {}, [grant('BITE')]);
// A drake names nothing and grants a roar by a rule alone, as a user's file gives a creature its legendary actions.
const roar = element('ROAR', 'Deed', {}, [{ kind: 'stat', key: 'r1', name: 'fury', value: { kind: 'number', value: 5 } }]);
const drake = element('DRAKE', 'Beast', {}, [grant('ROAR')]);
const index = new MapElementIndex();
index.addAll([bite, claw, ox, charm, roar, drake]);

function keeper(chosen: string[], removed: string[] = []): Character {
  let character = createCharacter('test', 'keeper');
  for (const [n, id] of chosen.entries()) character = setChoice(character, `build/pick${n}`, [id]);
  for (const id of removed) character = setGrantRemoved(character, id, true);
  return character;
}

test('a removed element the holder names is not held, and its rules do not apply', () => {
  // Fails if the engine ignores `removedGrants` for a setter's names (BITE is held).
  const derived = deriveCharacter(keeper(['OX'], ['BITE']), system, index);
  assert.equal(derived.elementIds.has('BITE'), false);
  assert.ok(derived.elementIds.has('CLAW'));
});

test("a removal also cancels the holder's own grant of the same element", () => {
  // Fails if only the setter is skipped (CLAW comes back through the ox's own rule, and fury reads 2).
  const derived = deriveCharacter(keeper(['OX'], ['CLAW']), system, index);
  assert.equal(derived.elementIds.has('CLAW'), false);
  assert.equal(derived.stats.get('fury')?.value, 0);
});

test('a removal cancels only what the holder gives: chosen, or granted by anything else, it is held', () => {
  // Fails if a removal is read as "never hold this" (the charm's bite, or a chosen bite, disappears).
  assert.ok(deriveCharacter(keeper(['OX', 'CHARM'], ['BITE']), system, index).elementIds.has('BITE'));
  assert.ok(deriveCharacter(keeper(['OX', 'BITE'], ['BITE']), system, index).elementIds.has('BITE'));
});

test('a removed element is not embedded on the holder’s account, and the save derives the same', () => {
  // Fails if `collectCharacterContent` still follows the holder's names and grants of a removed id (BITE and
  // CLAW are in the save).
  const character = keeper(['OX'], ['BITE', 'CLAW']);
  const content = collectCharacterContent(character, index, { kind });
  assert.deepEqual(content.elements.map((e) => e.id), ['OX']);
  const reopened = deriveCharacter(character, system, new BundleElementIndex(content.elements));
  assert.deepEqual([...reopened.elementIds], ['OX']);
  assert.deepEqual(reopened.problems, []);
});

test('recording a removal is format 3, and giving the last one back leaves no field and the version as it is', () => {
  // Fails if `setGrantRemoved` does not raise the version (a reader of 2 would give the trait back unannounced).
  const removed = keeper(['OX'], ['BITE']);
  assert.equal(removed.formatVersion, 3);
  assert.deepEqual(removed.removedGrants, ['BITE']);
  assert.deepEqual(setGrantRemoved(removed, 'BITE', true).removedGrants, ['BITE'], 'once');
  const restored = setGrantRemoved(removed, 'BITE', false);
  assert.equal('removedGrants' in restored, false);
  assert.equal(restored.formatVersion, 3);
  assert.ok(deriveCharacter(restored, system, index).elementIds.has('BITE'));
  assert.equal(keeper(['OX']).formatVersion, 2, 'a character that removes nothing is not raised');
});

test("a holder's grant by a rule alone may be removed too, and the save leaves it out", () => {
  // ADR 0067. Fails if a holder withdraws only what its setter names (`holderGivenIds` without the holder's own
  // grants): ROAR is held, fury reads 5, and the save embeds it.
  const character = keeper(['DRAKE'], ['ROAR']);
  const derived = deriveCharacter(character, system, index);
  assert.equal(derived.elementIds.has('ROAR'), false);
  assert.equal(derived.stats.get('fury')?.value, 0);
  const content = collectCharacterContent(character, index, { kind });
  assert.deepEqual(content.elements.map((e) => e.id), ['DRAKE']);
  const reopened = deriveCharacter(character, system, new BundleElementIndex(content.elements));
  assert.deepEqual([...reopened.elementIds], [...derived.elementIds]);
  assert.ok(deriveCharacter(keeper(['DRAKE']), system, index).elementIds.has('ROAR'), 'not removed, it is held');
});

test('what an element the kind does not make a holder grants cannot be removed, whatever the character records', () => {
  // ADR 0067: a class granting a class feature is the case this guards. Fails if every element withdraws its own
  // grants of a removed id (`holderGivenIds` without `isGrantHolder`): the charm's bite, and a saved one, disappear.
  const character = keeper(['CHARM'], ['BITE']);
  assert.ok(deriveCharacter(character, system, index).elementIds.has('BITE'));
  const content = collectCharacterContent(character, index, { kind });
  assert.deepEqual(content.elements.map((e) => e.id), ['BITE', 'CHARM']);
});
