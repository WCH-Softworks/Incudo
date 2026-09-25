/**
 * A held element's setter may name elements its holder has — ADR 0058.
 *
 * No game in the fixture: a "Beast" naming its "deeds" is what a creature naming its actions is in 5e.
 * Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter, type Character } from './character.ts';
import { BundleElementIndex, collectCharacterContent } from './container.ts';
import { MapElementIndex, type Element, type Rule, type Setter } from './model.ts';
import { resolveCharacterKind, type GameSystem, type SetterGrantDef } from './system.ts';
import { setterGrantIds } from './setter-grants.ts';

function element(id: string, type: string, setters: Record<string, string> = {}, rules: Rule[] = []): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return { id, type, name: id, source: 'test', setters: out, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const GRANTS: SetterGrantDef[] = [
  { types: ['Beast'], setter: 'deeds' },
  { types: ['Beast'], setter: 'tricks' },
];

function system(setterGrants: SetterGrantDef[] | undefined): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Beast' }, { name: 'Charm' }, { name: 'Deed' }, { name: 'Trick' }],
    stats: [{ name: 'fury', default: 0 }],
    characterKinds: [
      {
        id: 'keeper',
        name: 'Keeper',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Beast', 'Charm', 'Deed', 'Trick'],
        setterGrants,
        buildSteps: [],
        sheet: { sections: [] },
      },
    ],
  };
}

function holding(...ids: string[]): Character {
  const character = createCharacter('test', 'keeper');
  character.choices = ids.map((id, n) => ({ ruleKey: `build/pick${n}`, elementIds: [id] }));
  return character;
}

const bite = element('BITE', 'Deed');
const claw = element('CLAW', 'Deed', {}, [{ kind: 'stat', key: 'r0', name: 'fury', value: { kind: 'number', value: 2 } }]);
const horn = element('HORN', 'Trick');
const ox = element('OX', 'Beast', { deeds: 'BITE, CLAW', tricks: 'HORN' });
const charm = element('CHARM', 'Charm', { deeds: 'BITE' });

function indexOf(...elements: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  for (const e of elements) index.add(e);
  return index;
}
const index = indexOf(bite, claw, horn, ox, charm);

test('what a declared setter names is granted by its holder, whatever its own type', () => {
  // Fails if the engine stops reading setterGrants: the ox has no deeds.
  const derived = deriveCharacter(holding('OX'), system(GRANTS), index);
  for (const id of ['BITE', 'CLAW', 'HORN']) assert.ok(derived.elementIds.has(id), `${id} is held`);
  assert.deepEqual(derived.problems, []);
});

test('a named element applies its rules, as a granted one does', () => {
  const derived = deriveCharacter(holding('OX'), system(GRANTS), index);
  assert.equal(derived.stats.get('fury')?.value, 2);
});

test('and goes when its holder does', () => {
  const derived = deriveCharacter(holding(), system(GRANTS), index);
  assert.equal(derived.elementIds.has('BITE'), false);
});

test('only a holder of a declared type grants', () => {
  // The charm writes the same setter and is not a Beast. Fails if types are ignored.
  const derived = deriveCharacter(holding('CHARM'), system(GRANTS), index);
  assert.equal(derived.elementIds.has('BITE'), false);
});

test('a kind declaring none grants only what rules grant', () => {
  const derived = deriveCharacter(holding('OX'), system(undefined), index);
  assert.deepEqual([...derived.elementIds].sort(), ['OX']);
});

test('an id nothing declares is reported once, as a dangling grant is', () => {
  const lost = element('LOST', 'Beast', { deeds: 'GONE, BITE' });
  const twin = element('TWIN', 'Beast', { deeds: 'GONE' });
  const derived = deriveCharacter(holding('LOST', 'TWIN'), system(GRANTS), indexOf(bite, lost, twin));
  assert.ok(derived.elementIds.has('BITE'), 'the rest of the list still arrives');
  const unresolved = derived.problems.filter((p) => p.code === 'unresolved-element' && p.elementId === 'GONE');
  assert.equal(unresolved.length, 1);
});

test('a list is split on commas and trimmed, and nothing else: a stray > is part of the id', () => {
  const odd = element('ODD', 'Beast', { deeds: ' BITE ,CLAW>,, BITE', TRICKS: 'HORN' });
  assert.deepEqual(setterGrantIds(GRANTS, odd), ['BITE', 'CLAW>', 'HORN']);
});

test("a save embeds what its holder's setter names, and derives the same from it with no source", () => {
  // Fails if collectCharacterContent does not read setterGrants: the save would hold the ox and not its
  // deeds, and reopen without them (ADR 0012).
  const sys = system(GRANTS);
  const kind = resolveCharacterKind(sys, 'keeper');
  const character = holding('OX');
  const content = collectCharacterContent(character, index, { kind });
  assert.deepEqual(content.elements.map((e) => e.id), ['BITE', 'CLAW', 'HORN', 'OX']);
  const offline = deriveCharacter(character, sys, new BundleElementIndex(content.elements));
  const online = deriveCharacter(character, sys, index);
  assert.deepEqual([...offline.elementIds].sort(), [...online.elementIds].sort());
  assert.equal(offline.stats.get('fury')?.value, 2);
});
