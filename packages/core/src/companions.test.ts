/**
 * A creature a character holds is derived in a scope of its own — ADR 0073.
 *
 * No game in the fixture: a keeper holds "Beast"s, which write their numbers as `pet:*` rules in the keeper's
 * derivation, some reading the keeper's `rank`, and a keeper's Charm adds to every beast's guard. A beast prints its
 * might as a setter and names its deeds. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter, type Character } from './character.ts';
import { BundleElementIndex, collectCharacterContent } from './container.ts';
import { MapElementIndex, type Element, type Rule, type Setter } from './model.ts';
import type { StatExpr } from './expression.ts';
import { companionScopeKind, resolveCharacterKind, type CompanionsDef, type GameSystem } from './system.ts';

function element(id: string, type: string, setters: Record<string, string> = {}, rules: Rule[] = []): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return { id, type, name: id, source: 'test', setters: out, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const num = (value: number): StatExpr => ({ kind: 'number', value });
const ref = (stat: string): StatExpr => ({ kind: 'ref', stat });
let key = 0;
const stat = (name: string, value: StatExpr, bonus?: string): Rule => ({ kind: 'stat', key: `r${key++}`, name, value, bonus });
const grant = (id: string): Rule => ({ kind: 'grant', id } as Rule);

const COMPANIONS: CompanionsDef = {
  types: ['Beast'],
  label: 'Beasts',
  stats: [
    { name: 'pet:might', default: 10 },
    { name: 'pet:strike', derive: { kind: 'binary', op: '+', left: ref('pet:might'), right: ref('pet:bond') } },
  ],
  setterStats: [{ types: ['Beast'], setter: 'might', stat: 'pet:might' }],
  contributions: [{ stat: 'pet:bond', value: num(1) }],
  setterGrants: [{ types: ['Beast'], setter: 'deeds' }],
  sheet: [{ id: 'block', label: 'Block', stats: ['pet:guard', 'pet:strike'] }],
};

function system(companions: CompanionsDef | null = COMPANIONS): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Beast' }, { name: 'Charm' }, { name: 'Deed' }, { name: 'Gift' }],
    stats: [{ name: 'rank', default: 3 }],
    characterKinds: [
      {
        id: 'keeper',
        name: 'Keeper',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Beast', 'Charm', 'Deed', 'Gift'],
        companions: companions ?? undefined,
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

const bite = element('BITE', 'Deed', {}, [stat('pet:guard', num(1))]);
const gift = element('GIFT', 'Gift');
// The ox's guard reads its keeper's rank; it grants a gift and names its bite.
const ox = element('OX', 'Beast', { might: '14', deeds: 'BITE' }, [stat('pet:guard', ref('rank')), grant('GIFT')]);
// The cat is guarded by 5 in the same bucket as nothing, and names a deed nothing declares.
const cat = element('CAT', 'Beast', { might: '6', deeds: 'PURR' }, [stat('pet:guard', num(5))]);
// The keeper's own feature adds to whatever beast it has.
const charm = element('CHARM', 'Charm', {}, [stat('pet:guard', num(2))]);

function indexOf(...elements: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  for (const e of elements) index.add(e);
  return index;
}
const index = indexOf(bite, gift, ox, cat, charm);

const scopeOf = (character: Character, id: string, sys = system()) =>
  deriveCharacter(character, sys, index).companions.find((c) => c.elementId === id);
const value = (stats: Map<string, { value: number }> | undefined, name: string) => stats?.get(name)?.value;

test('a held creature is derived in its scope: its print, its rules reading its holder, and its holder\'s features', () => {
  // Fails if no scope is derived, if the declaration's setterStats, stats or contributions are not added to it, or if
  // the holder's own feature is left out of it.
  const scope = scopeOf(holding('OX', 'CHARM'), 'OX');
  assert.ok(scope, 'the ox has a scope');
  assert.equal(value(scope.stats, 'pet:might'), 14, 'its print');
  assert.equal(value(scope.stats, 'pet:bond'), 1, 'what the declaration contributes');
  assert.equal(value(scope.stats, 'pet:strike'), 15, 'what it derives');
  assert.equal(value(scope.stats, 'pet:guard'), 3 + 1 + 2, 'its rule reading the keeper, its bite, and the keeper\'s charm');
  assert.equal(scope.starts.get('pet:might')?.from, 'OX');
});

test('what the creature names is held in its scope only, and the holder derives exactly as before', () => {
  // Fails if the scope's setter grants reach the holder's own derivation, or if the scope does not hold them.
  const character = holding('OX', 'CHARM');
  const derived = deriveCharacter(character, system(), index);
  const without = deriveCharacter(character, system(null), index);
  assert.equal(derived.elementIds.has('BITE'), false, 'the keeper does not bite');
  assert.ok(derived.companions[0]!.elements.some((e) => e.id === 'BITE'), 'the ox does');
  assert.deepEqual([...derived.elementIds].sort(), [...without.elementIds].sort());
  assert.deepEqual(
    [...derived.stats].map(([k, s]) => [k, s.value]),
    [...without.stats].map(([k, s]) => [k, s.value]),
    'the holder\'s stats are the same with or without the declaration',
  );
  assert.equal(value(derived.stats, 'pet:might'), undefined, 'a scope stat is not the holder\'s');
  assert.deepEqual(without.companions, []);
});

test('two creatures sum in the holder, and each scope sees only its own', () => {
  // Fails if the other creature is not left out of a scope: the guards would sum there too.
  const character = holding('OX', 'CAT', 'CHARM');
  const derived = deriveCharacter(character, system(), index);
  assert.equal(value(derived.stats, 'pet:guard'), 3 + 5 + 2, 'the holder sums, as content assumes one');
  assert.deepEqual(derived.companions.map((c) => c.elementId), ['OX', 'CAT'], 'in the order held');
  const [oxScope, catScope] = derived.companions;
  assert.equal(value(oxScope!.stats, 'pet:guard'), 3 + 1 + 2);
  assert.equal(value(catScope!.stats, 'pet:guard'), 5 + 2);
  assert.equal(value(catScope!.stats, 'pet:might'), 6, 'no second print to conflict with');
  assert.equal(derived.companions.every((c) => !c.problems.some((p) => p.code === 'setter-stat-conflict')), true);
});

test('a creature another element grants is left out of the other creature\'s scope too', () => {
  // Fails if exclusion reads only seeds: the whistle's cat would be in the ox's scope, its guard with it.
  const whistle = element('WHISTLE', 'Charm', {}, [grant('CAT')]);
  const derived = deriveCharacter(holding('OX', 'WHISTLE'), system(), indexOf(bite, gift, ox, cat, whistle));
  assert.deepEqual(derived.companions.map((c) => c.elementId), ['OX', 'CAT']);
  const oxScope = derived.companions[0]!;
  assert.equal(oxScope.elements.some((e) => e.id === 'CAT'), false);
  assert.equal(value(oxScope.stats, 'pet:guard'), 3 + 1);
});

test('what only the other creature gives is left out of a scope, and what something else gives is not', () => {
  // Fails if exclusion drops only the creature and not what it alone reaches, or drops a shared grant.
  const scopes = deriveCharacter(holding('OX', 'CAT'), system(), index).companions;
  const catScope = scopes.find((c) => c.elementId === 'CAT')!;
  assert.equal(catScope.elements.some((e) => e.id === 'OX' || e.id === 'GIFT' || e.id === 'BITE'), false);
  const giver = element('GIVER', 'Charm', {}, [grant('GIFT')]);
  const shared = deriveCharacter(holding('OX', 'CAT', 'GIVER'), system(), indexOf(bite, gift, ox, cat, giver)).companions;
  assert.ok(shared.find((c) => c.elementId === 'CAT')!.elements.some((e) => e.id === 'GIFT'), 'the keeper still gives the gift');
});

test('a scope reports what it finds and the holder does not', () => {
  // Fails if a scope's problems are dropped, or the holder's are repeated there.
  const derived = deriveCharacter(holding('CAT', 'MISSING'), system(), index);
  const problems = derived.companions[0]!.problems;
  assert.deepEqual(problems.map((p) => p.elementId), ['PURR'], 'the cat names a deed nothing declares');
  assert.ok(derived.problems.some((p) => p.elementId === 'MISSING'), 'the holder reports its own');
});

test('a save embeds what a held creature names, and derives the same scope from it alone', () => {
  // Fails if collectCharacterContent does not follow the declaration's setter grants: the bite is not embedded.
  const character = holding('OX', 'CHARM');
  const sys = system();
  const kind = resolveCharacterKind(sys, 'keeper');
  const subset = collectCharacterContent(character, index, { kind });
  assert.ok(subset.elements.some((e) => e.id === 'BITE'));
  const again = deriveCharacter(character, sys, new BundleElementIndex(subset.elements)).companions[0]!;
  const first = scopeOf(character, 'OX')!;
  assert.deepEqual([...again.stats].map(([k, s]) => [k, s.value]), [...first.stats].map(([k, s]) => [k, s.value]));
});

test('the scope kind adds the declaration to the kind, and derives no scope of its own', () => {
  const kind = resolveCharacterKind(system(), 'keeper');
  const scope = companionScopeKind(kind)!;
  assert.equal(scope.companions, undefined);
  assert.ok(scope.stats.some((s) => s.name === 'rank') && scope.stats.some((s) => s.name === 'pet:might'));
  assert.equal(companionScopeKind(resolveCharacterKind(system(null), 'keeper')), undefined);
});
