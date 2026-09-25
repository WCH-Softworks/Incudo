/**
 * A set step does not offer what the character already has — ADR 0058.
 *
 * A creature's own deeds are granted through its setter; the Deeds set must not offer them again. Fails if
 * the set's candidates exclude only what the step itself chose.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, type Element, type GameSystem, type Setter } from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string, setters: Record<string, string> = {}): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return { id, type, name: id, source: 'test', setters: out, rules: [], supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Beast' }, { name: 'Deed' }],
  stats: [],
  characterKinds: [
    {
      id: 'keeper',
      name: 'Keeper',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Beast', 'Deed'],
      setterGrants: [{ types: ['Beast'], setter: 'deeds' }],
      buildSteps: [
        { id: 'beast', label: 'Beast', types: ['Beast'], required: true },
        { id: 'deeds', label: 'Deeds', types: ['Deed'], multiple: true },
      ],
      sheet: { sections: [] },
    },
  ],
};

function build(): CharacterBuilder {
  const index = new MapElementIndex();
  index.addAll([element('OX', 'Beast', { deeds: 'BITE' }), element('BITE', 'Deed'), element('KICK', 'Deed')]);
  return new CharacterBuilder(createCharacter('test', 'keeper'), system, index);
}

const deeds = (b: CharacterBuilder) => b.getState().decisions.find((d) => d.stepId === 'deeds');

test('a set offers everything of its types while the character holds none of it', () => {
  assert.deepEqual(deeds(build())?.candidates.sort(), ['BITE', 'KICK']);
});

test('what the character already holds is not offered again, and the rest still is', () => {
  const b = build();
  b.choose('build/beast', ['OX']);
  assert.ok(b.getState().derived.elementIds.has('BITE'), 'the beast grants its bite');
  assert.deepEqual(deeds(b)?.candidates, ['KICK']);
  b.choose('build/deeds', ['KICK']);
  assert.equal(deeds(b), undefined, 'nothing left to add');
});
