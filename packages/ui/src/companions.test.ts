/**
 * The creatures a character holds, as the Sheet shows them — ADR 0073.
 *
 * No game in the fixture: a keeper holds "Beast"s through a "Whistle" whose select offers them, and a beast writes its
 * guard in the keeper's derivation, prints its might and its senses, and names its deeds. Each test names the change
 * that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  deriveCharacter,
  MapElementIndex,
  resolveCharacterKind,
  type Character,
  type Element,
  type GameSystem,
  type Rule,
  type Setter,
} from '@incudo/core';

import { companionsView } from './companions.ts';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string, name: string, setters: Record<string, string> = {}, rules: Rule[] = []): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return { id, type, name, source: 'Test Book', setters: out, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}
const guard = (value: number): Rule => ({ kind: 'stat', key: `g${value}`, name: 'pet:guard', value: { kind: 'number', value } });

function system(withCompanions = true): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Beast' }, { name: 'Whistle' }, { name: 'Deed' }],
    stats: [],
    characterKinds: [
      {
        id: 'keeper',
        name: 'Keeper',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Beast', 'Whistle', 'Deed'],
        companions: withCompanions
          ? {
              types: ['Beast'],
              label: 'Beasts',
              description: 'What the keeper has.',
              stats: [
                { name: 'pet:guard', label: 'Guard' },
                { name: 'pet:might', label: 'Might', default: 10 },
                { name: 'pet:swim', label: 'Swim' },
              ],
              setterStats: [{ types: ['Beast'], setter: 'might', stat: 'pet:might' }],
              setterGrants: [{ types: ['Beast'], setter: 'deeds' }],
              sheet: [
                { id: 'block', label: 'Block', stats: ['pet:guard', 'pet:might'] },
                { id: 'moves', label: 'Moves', stats: ['pet:swim'], showWhen: '{stat}' },
                { id: 'senses', label: 'Senses', description: 'As printed.', printed: [{ types: ['Beast'], setter: 'senses', label: 'Senses' }] },
                { id: 'deeds', label: 'Deeds', types: ['Deed'] },
              ],
            }
          : undefined,
        buildSteps: [],
        sheet: { sections: [] },
      },
    ],
  };
}

const bite = element('BITE', 'Deed', 'Bite');
const ox = element('OX', 'Beast', 'Ox', { might: '14', deeds: 'BITE', senses: 'keen smell' }, [guard(3)]);
const swims: Rule = { kind: 'stat', key: 'swim', name: 'pet:swim', value: { kind: 'number', value: 20 } };
const cat = element('CAT', 'Beast', 'Cat', { might: '6', deeds: 'PURR' }, [guard(5), swims]);
const whistle = element('WHISTLE', 'Whistle', 'Silver Whistle', {}, [{ kind: 'select', key: 's0', type: 'Beast', name: 'Beast', number: 1 } as Rule]);
const horn = element('HORN', 'Whistle', 'Horn', {}, [{ kind: 'grant', id: 'CAT' } as Rule]);
const index = new MapElementIndex();
for (const e of [bite, ox, cat, whistle, horn]) index.add(e);

function keeper(...rest: Character['choices']): Character {
  const character = createCharacter('test', 'keeper');
  character.choices = [{ ruleKey: 'build/whistle', elementIds: ['WHISTLE'] }, ...rest];
  return character;
}
const withOx = keeper({ ruleKey: 'WHISTLE/select:Beast', elementIds: ['OX'] });

function view(character: Character, sys = system()) {
  const kind = resolveCharacterKind(sys, 'keeper');
  return companionsView(deriveCharacter(character, sys, index, { kind }), kind, index);
}

test('nothing is shown for a kind that declares no companions, or a character holding none', () => {
  assert.equal(view(withOx, system(false)), undefined);
  assert.equal(view(keeper()), undefined);
});

test('a held creature is its name, what gave it, and its sections read against its own scope', () => {
  // Fails if the labels are not read (a row reads "pet:guard"), if the scope's stats are not the ones read, or if what
  // gave the creature is not read from the choice holding it.
  const shown = view(withOx)!;
  assert.equal(shown.label, 'Beasts');
  assert.equal(shown.description, 'What the keeper has.');
  const [ox] = shown.creatures;
  assert.equal(ox!.name, 'Ox');
  assert.equal(ox!.source, 'Test Book');
  assert.deepEqual(ox!.heldBy, ['Silver Whistle']);
  const block = ox!.sections.find((s) => s.id === 'block')!;
  assert.deepEqual(block.rows, [
    { stat: 'pet:guard', label: 'Guard', value: '3' },
    { stat: 'pet:might', label: 'Might', value: '14' },
  ]);
  assert.deepEqual(ox!.sections.find((s) => s.id === 'senses')!.printed.map((l) => l.text), ['keen smell']);
  assert.equal(ox!.sections.find((s) => s.id === 'senses')!.description, 'As printed.');
  assert.deepEqual(ox!.sections.find((s) => s.id === 'deeds')!.elements, [{ elementId: 'BITE', name: 'Bite' }]);
  assert.deepEqual(ox!.notes, []);
});

test('a section with nothing to show is left out', () => {
  // Fails if empty sections are kept: the ox swims nowhere and "Moves" would be an empty heading.
  const ids = view(withOx)!.creatures[0]!.sections.map((s) => s.id);
  assert.deepEqual(ids, ['block', 'senses', 'deeds']);
});

test('two creatures are two stat blocks, each with its own numbers, in the order held', () => {
  // Fails if a creature's rows are read from the holder, where the two guards sum to 8.
  const both = view(keeper({ ruleKey: 'WHISTLE/select:Beast', elementIds: ['OX'] }, { ruleKey: 'build/horn', elementIds: ['HORN'] }))!;
  assert.deepEqual(both.creatures.map((c) => c.name), ['Ox', 'Cat']);
  const guardOf = (n: number) => both.creatures[n]!.sections.find((s) => s.id === 'block')!.rows[0]!.value;
  assert.equal(guardOf(0), '3');
  assert.equal(guardOf(1), '5');
  assert.deepEqual(both.creatures[1]!.heldBy, ['Horn'], 'a granted creature names what granted it');
  // Fails if which rows show is asked of the holder, where the cat's swim makes the ox swim too.
  assert.equal(both.creatures[0]!.sections.some((s) => s.id === 'moves'), false, 'the ox does not swim');
  assert.deepEqual(both.creatures[1]!.sections.find((s) => s.id === 'moves')?.rows.map((r) => r.value), ['20']);
});

test('a feature a creature names and nothing declares is said plainly, without its id', () => {
  // Fails if the scope's problems are not read, or are shown as the engine's message naming the id.
  const cat = view(keeper({ ruleKey: 'build/horn', elementIds: ['HORN'] }))!.creatures[0]!;
  assert.deepEqual(cat.notes, ['One feature this creature names is not in any loaded source.']);
});

test('the builder\'s state carries it', () => {
  // Fails if the builder does not publish the view.
  const state = new CharacterBuilder(withOx, system(), index).getState();
  assert.deepEqual(state.companions?.creatures.map((c) => c.name), ['Ox']);
});
