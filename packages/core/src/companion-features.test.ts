/**
 * Which held creature a holder's feature is about — ADR 0109. No game in the fixture: a keeper holds "Beast"s that write
 * their numbers as `pet:*` rules in the keeper's derivation, as `companions.test.ts`'s do. Each test names the change
 * that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter, type Character } from './character.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import type { StatExpr } from './expression.ts';
import { resolveCharacterKind, type CompanionsDef, type GameSystem } from './system.ts';
import { scopeStatNames } from './companion-features.ts';

function element(id: string, type: string, rules: Rule[] = []): Element {
  return { id, type, name: id, source: 'test', setters: {}, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const num = (value: number): StatExpr => ({ kind: 'number', value });
const ref = (stat: string): StatExpr => ({ kind: 'ref', stat });
let key = 0;
const stat = (name: string, value: StatExpr): Rule => ({ kind: 'stat', key: `r${key++}`, name, value });
const grant = (id: string): Rule => ({ kind: 'grant', id } as Rule);
const select = (name: string, type: string): Rule => ({ kind: 'select', key: `s${key++}`, name, type, number: 1 } as Rule);

const COMPANIONS: CompanionsDef = {
  types: ['Beast'],
  label: 'Beasts',
  stats: [{ name: 'pet:strike', derive: { kind: 'binary', op: '+', left: ref('pet:guard:misc'), right: ref('rank') } }],
  sheet: [{ id: 'block', label: 'Block', stats: ['pet:guard', 'pet:strike'] }],
};

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test System',
  version: '1.0.0',
  elementTypes: [{ name: 'Beast' }, { name: 'Path' }, { name: 'Feature' }, { name: 'Trait' }],
  stats: [{ name: 'rank', default: 3 }],
  characterKinds: [
    {
      id: 'keeper',
      name: 'Keeper',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Beast', 'Path', 'Feature', 'Trait'],
      companions: COMPANIONS,
      buildSteps: [],
      sheet: { sections: [] },
    },
  ],
};

// A path grants a feature that offers the ox and a feature that guards "your ox" (Battle Smith, Steel Defender,
// Improved Defender). A charm offers the cat and guards nothing. A feature granted by nothing guards every beast.
const ox = element('OX', 'Beast', [stat('pet:guard', num(10)), grant('OX_TRAIT')]);
const cat = element('CAT', 'Beast', [stat('pet:guard', num(12))]);
const oxTrait = element('OX_TRAIT', 'Trait', [stat('pet:guard:misc', num(1))]);
const path = element('PATH', 'Path', [grant('OX_FEATURE'), grant('IMPROVED')]);
const oxFeature = element('OX_FEATURE', 'Feature', [select('Ox', 'Beast')]);
const improved = element('IMPROVED', 'Feature', [stat('pet:guard', num(2)), stat('rank', num(1))]);
const charm = element('CHARM', 'Feature', [select('Cat', 'Beast')]);
const blessing = element('BLESSING', 'Feature', [stat('pet:guard', num(5))]);
// A feature that is itself the ox's chooser and guards it (the 2014 Ranger's Companion).
const companion = element('COMPANION', 'Feature', [select('Beast', 'Beast'), stat('pet:guard', num(3))]);

const index = new MapElementIndex();
index.addAll([ox, cat, oxTrait, path, oxFeature, improved, charm, blessing, companion]);

function keeper(picks: string[], choices: Character['choices'] = []): Character {
  const character = createCharacter('test', 'keeper');
  character.choices = [...picks.map((id, n) => ({ ruleKey: `build/pick${n}`, elementIds: [id] })), ...choices];
  return character;
}
const guardOf = (character: Character, id: string): number | undefined =>
  deriveCharacter(character, system, index).companions.find((c) => c.elementId === id)?.stats.get('pet:guard')?.value;

const withPath = keeper(['PATH', 'CHARM'], [
  { ruleKey: 'OX_FEATURE/select:Ox', elementIds: ['OX'] },
  { ruleKey: 'CHARM/select:Cat', elementIds: ['CAT'] },
]);

test('a feature given by what reached a creature changes that creature and not the other', () => {
  // Fails if scopes are not told which features are about another creature: the cat reads 12 + 2.
  assert.equal(guardOf(withPath, 'OX'), 10 + 2);
  assert.equal(guardOf(withPath, 'CAT'), 12);
});

test('the holder still sums, and the feature\'s other rules apply in every scope', () => {
  // Fails if the feature is dropped from a scope whole, rather than only its rules on the scope's stats.
  const derived = deriveCharacter(withPath, system, index);
  assert.equal(derived.stats.get('pet:guard')?.value, 10 + 12 + 2, 'the holder is unchanged');
  for (const scope of derived.companions) assert.equal(scope.stats.get('rank')?.value, 4, `${scope.elementId}: rank`);
});

test('a feature that chose the creature is about it', () => {
  // Fails if a creature's reach does not include the element whose choice holds it.
  const character = keeper(['COMPANION', 'CHARM'], [
    { ruleKey: 'COMPANION/select:Beast', elementIds: ['OX'] },
    { ruleKey: 'CHARM/select:Cat', elementIds: ['CAT'] },
  ]);
  assert.equal(guardOf(character, 'OX'), 10 + 3);
  assert.equal(guardOf(character, 'CAT'), 12);
});

test('a feature about no held creature applies to every one', () => {
  // Fails if a feature tied to no creature is dropped everywhere (decision 3).
  const character = keeper(['PATH', 'CHARM', 'BLESSING'], withPath.choices.filter((c) => !c.ruleKey.startsWith('build/')));
  assert.equal(guardOf(character, 'OX'), 10 + 2 + 5);
  assert.equal(guardOf(character, 'CAT'), 12 + 5);
});

test('with one creature held nothing changes', () => {
  // Fails if a lone creature loses a feature that is about nothing else.
  const character = keeper(['PATH'], [{ ruleKey: 'OX_FEATURE/select:Ox', elementIds: ['OX'] }]);
  assert.equal(guardOf(character, 'OX'), 10 + 2);
});

test('the scope\'s stats are what the declaration names and their formulas read, less the holder\'s', () => {
  // Fails if a formula's reads are not followed (`pet:guard:misc` would be missed), or the holder's own stat is taken.
  const names = scopeStatNames(resolveCharacterKind(system, 'keeper'));
  assert.deepEqual([...names].sort(), ['pet:guard', 'pet:guard:misc', 'pet:strike']);
});
