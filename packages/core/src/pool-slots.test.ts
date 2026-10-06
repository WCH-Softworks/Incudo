/**
 * Which slot of a pool each recorded pick fills, and which picks count — ADR 0096.
 *
 * No game in the fixture. A Trickster's "Trick" pool has two rules opening together: one Charm-only rule of two slots,
 * declared first, and one rule of one slot taking any Trinket, as a subclass's school-restricted spells and its any-school
 * one are. Two Charms and two plain Trinkets to pick from. A Keeper's "Bump" pool grows by level and takes a repeatable
 * Bump. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { placePicks } from './pool-slots.ts';
import { deriveCharacter } from './engine.ts';
import { createCharacter, type Character } from './character.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import { parseSupports } from './supports.ts';
import type { GameSystem } from './system.ts';

// --- the matching on its own ----------------------------------------------------------------------------------------

test('a pick that fits two rules moves to make room for one that fits only the rule it took', () => {
  // Rules: ANY (1 slot), CHARM (1 slot). Picks: a Charm (fits both), then a plain one (fits ANY only). Fails if a placed
  // pick is never moved (first fit only): the Charm keeps ANY and the plain pick fits nowhere.
  const fits = [
    [0, 1],
    [0],
  ];
  const slots = placePicks([1, 1], 2, (rule, pick) => fits[pick]!.includes(rule));
  assert.deepEqual(slots.placed, [1, 0]);
  assert.deepEqual(slots.free, []);
});

test('a rule whose slot holds a pick that could move is still available to a further pick', () => {
  // Rules: ANY (1), CHARM (1). One Charm, placed in ANY. CHARM is free, and ANY is available because the Charm can move
  // there. Fails if only rules with a free slot are available: a plain pick would not be offered.
  const slots = placePicks([1, 1], 1, (rule) => rule === 0 || rule === 1);
  assert.deepEqual(slots.placed, [0]);
  assert.deepEqual(slots.free, [1]);
  assert.deepEqual(slots.available, [0, 1]);
});

test('a full rule holding a pick that can move nowhere is not available', () => {
  // Rules: ANY (1), CHARM (1). One plain pick in ANY. Only CHARM is available. Fails if every rule is offered.
  const slots = placePicks([1, 1], 1, (rule) => rule === 0);
  assert.deepEqual(slots.available, [1]);
});

test('the earlier pick keeps its slot when two want the only one', () => {
  const slots = placePicks([1], 2, () => true);
  assert.deepEqual(slots.placed, [0, undefined]);
  assert.equal(slots.capacity, 1);
});

// --- in the engine ---------------------------------------------------------------------------------------------------

function element(id: string, type: string, rules: Rule[] = [], supports: string[] = []): Element {
  return { id, type, name: id, source: 'test', setters: {}, rules, supports, origin: { sourceId: 'test', format: 'incudo' } };
}

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test System',
  version: '1.0.0',
  elementTypes: [{ name: 'Role' }, { name: 'Trinket' }],
  stats: [{ name: 'knack', default: 0 }],
  characterKinds: [
    {
      id: 'hero',
      name: 'Hero',
      default: true,
      progression: { kind: 'level', min: 1, max: 20 },
      elementTypes: ['Role', 'Trinket'],
      repeatableSetter: 'again',
      buildSteps: [],
      sheet: { sections: [] },
    },
  ],
};

const trick = (supports: string | undefined, number: number): Rule => ({
  kind: 'select',
  key: 'select:Trick',
  type: 'Trinket',
  name: 'Trick',
  number,
  level: 3,
  ...(supports ? { supports: parseSupports(supports) } : {}),
});
const bump = (level: number): Rule => ({ kind: 'select', key: 'select:Bump', type: 'Trinket', name: 'Bump', number: 1, level, supports: parseSupports('Bump') });
const bumpElement = element('BUMP', 'Trinket', [{ kind: 'stat', key: 'knack', name: 'knack', value: { kind: 'number', value: 1 } }], ['Bump']);
bumpElement.setters.again = { value: 'true' };

const index = new MapElementIndex();
index.addAll([
  element('TRICKSTER', 'Role', [trick('Charm', 2), trick(undefined, 1)]),
  element('KEEPER', 'Role', [bump(4), bump(8)]),
  element('CHARM_A', 'Trinket', [], ['Charm']),
  element('CHARM_B', 'Trinket', [], ['Charm']),
  element('PLAIN_A', 'Trinket'),
  element('PLAIN_B', 'Trinket'),
  bumpElement,
]);

function hero(level: number, role: string, key: string, picks: string[]): Character {
  const character = { ...createCharacter('test', 'hero'), progress: level };
  character.choices = [
    { ruleKey: 'build/role', elementIds: [role] },
    { ruleKey: `${role}/select:${key}`, elementIds: picks },
  ];
  return character;
}

test('taking the any-kind slot first leaves the restricted slots open, and offers only what they take', () => {
  // Fails under the old level-order fill: the plain pick lands in the Charm rule declared first, a plain Trinket is
  // still offered for the rest, and two plain picks are accepted in silence.
  const derived = deriveCharacter(hero(3, 'TRICKSTER', 'Trick', ['PLAIN_A']), system, index);
  const [open] = derived.pendingChoices;
  assert.equal(open?.remaining, 2);
  assert.deepEqual(open?.candidates.sort(), ['CHARM_A', 'CHARM_B']);
  assert.deepEqual(derived.problems, []);
});

test('the order picks were made in changes nothing derived', () => {
  // Fails if placement follows the record's order rather than a matching.
  const one = deriveCharacter(hero(3, 'TRICKSTER', 'Trick', ['PLAIN_A', 'CHARM_A']), system, index);
  const two = deriveCharacter(hero(3, 'TRICKSTER', 'Trick', ['CHARM_A', 'PLAIN_A']), system, index);
  assert.deepEqual(one.pendingChoices[0]?.candidates, ['CHARM_B']);
  assert.deepEqual(two.pendingChoices[0]?.candidates, ['CHARM_B']);
  assert.deepEqual(one.problems, []);
  assert.deepEqual(two.problems, []);
});

test('a pick no assignment can place is counted, held and flagged, never refused', () => {
  // Two plain picks and one Charm: only one plain pick fits a slot. Fails if the misfit is dropped, not held, or not
  // reported.
  const derived = deriveCharacter(hero(3, 'TRICKSTER', 'Trick', ['PLAIN_A', 'PLAIN_B', 'CHARM_A']), system, index);
  assert.ok(derived.elementIds.has('PLAIN_B'));
  assert.deepEqual(derived.uncounted, []);
  assert.deepEqual(derived.answeredChoices[0]?.unplaced, ['PLAIN_B']);
  assert.deepEqual(
    derived.problems.map((p) => [p.code, p.elementId, p.ruleKey]),
    [['choice-unplaced', 'PLAIN_B', 'TRICKSTER/select:Trick']],
  );
  assert.equal(
    derived.problems[0]?.message,
    'PLAIN_B is chosen for "Trick", and none of its slots would offer it to this character.',
  );
});

test('a level lowered below a slot leaves its pick recorded and not counted, and a repeat counts once', () => {
  // The Keeper took Bump at 4 and again at 8 (+2), then went back to 5. Fails if the second pick still seeds (knack 2),
  // or if it is dropped from the record.
  const at8 = deriveCharacter(hero(8, 'KEEPER', 'Bump', ['BUMP', 'BUMP']), system, index);
  assert.equal(at8.stats.get('knack')?.value, 2);
  const at5 = deriveCharacter(hero(5, 'KEEPER', 'Bump', ['BUMP', 'BUMP']), system, index);
  assert.equal(at5.stats.get('knack')?.value, 1);
  assert.deepEqual(
    at5.uncounted.map((p) => [p.elementId, p.position, p.reason]),
    [['BUMP', 1, 'over']],
  );
  assert.deepEqual(at5.character.choices[1]?.elementIds, ['BUMP', 'BUMP']);
  // Below 4 the pool is gone, and the first pick goes too.
  const at3 = deriveCharacter(hero(3, 'KEEPER', 'Bump', ['BUMP', 'BUMP']), system, index);
  assert.equal(at3.elementIds.has('BUMP'), false);
  assert.deepEqual(at3.uncounted.map((p) => p.reason), ['closed', 'closed']);
});

test('a record no content pool owns always counts', () => {
  // A build step's key and a key naming an element with no select of that name. Fails if any record whose pool is
  // not open is uncounted, rather than only one content declares.
  const character = { ...createCharacter('test', 'hero'), progress: 1 };
  character.choices = [
    { ruleKey: 'build/role', elementIds: ['KEEPER'] },
    { ruleKey: 'PLAIN_A/select:Class', elementIds: ['TRICKSTER'] },
  ];
  const derived = deriveCharacter(character, system, index);
  assert.ok(derived.elementIds.has('TRICKSTER'));
  assert.deepEqual(derived.uncounted, []);
});
