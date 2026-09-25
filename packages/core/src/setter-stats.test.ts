/**
 * A held element's setter may be where a stat starts — ADR 0057.
 *
 * The fixture has no game in it: "might" and "vigour" are its words the way "strength" is 5e's.
 * Each test names the change to the engine that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter, type Character } from './character.ts';
import { MapElementIndex, type Element, type Rule, type Setter } from './model.ts';
import type { GameSystem, SetterStatDef } from './system.ts';
import { readSetterNumber, setterStartingValues } from './setter-stats.ts';

function element(id: string, type: string, setters: Record<string, string> = {}, rules: Rule[] = []): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return { id, type, name: id, source: 'test', setters: out, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const STARTS: SetterStatDef[] = [
  { types: ['Beast'], setter: 'might', stat: 'vigour' },
  { types: ['Beast'], setter: 'rank', stat: 'grade' },
];

function system(setterStats: SetterStatDef[] | undefined): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Beast' }, { name: 'Charm' }],
    stats: [
      { name: 'vigour', default: 10 },
      { name: 'grade', default: 0 },
    ],
    characterKinds: [
      {
        id: 'keeper',
        name: 'Keeper',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Beast', 'Charm'],
        setterStats,
        buildSteps: [],
        sheet: { sections: [] },
      },
    ],
  };
}

function holding(ids: string[], baseStats?: Record<string, number>): Character {
  const character = createCharacter('test', 'keeper');
  character.choices = ids.map((id, n) => ({ ruleKey: `build/pick${n}`, elementIds: [id] }));
  if (baseStats) character.baseStats = baseStats;
  return character;
}

const ox = element('OX', 'Beast', { might: '16', rank: '1/4' });
const charm = element('CHARM', 'Charm', { might: '30' }, [
  { kind: 'stat', key: 'r0', name: 'vigour', value: { kind: 'number', value: 2 } },
]);
const index = indexOf(ox, charm);

const value = (derived: ReturnType<typeof deriveCharacter>, stat: string): number | undefined =>
  derived.stats.get(stat)?.value;

test('a printed setter is where the stat starts, in place of the declared default', () => {
  // Fails if the engine stops reading setterStats (vigour reads the default 10).
  const derived = deriveCharacter(holding(['OX']), system(STARTS), index);
  assert.equal(value(derived, 'vigour'), 16);
  assert.equal(value(derived, 'grade'), 0.25);
  assert.deepEqual(derived.stats.get('vigour')?.contributions, [{ value: 16, from: 'OX' }]);
});

test('a base the user set replaces the print, and does not add to it', () => {
  // Fails if the start lands after baseStats (reads 16) or is summed with it (reads 30).
  const derived = deriveCharacter(holding(['OX'], { vigour: 14 }), system(STARTS), index);
  assert.equal(value(derived, 'vigour'), 14);
});

test('a contribution adds to the print, as it adds to a default', () => {
  // Fails if the start replaces the whole stat after contributions (reads 16).
  const derived = deriveCharacter(holding(['OX', 'CHARM']), system(STARTS), index);
  assert.equal(value(derived, 'vigour'), 18);
  // And to a base the user set, over the print.
  const typed = deriveCharacter(holding(['OX', 'CHARM'], { vigour: 14 }), system(STARTS), index);
  assert.equal(value(typed, 'vigour'), 16);
});

test('only the declared types are read', () => {
  // The charm prints "might" too, and is not a Beast. Fails if types are ignored (reads 30 + 2).
  const derived = deriveCharacter(holding(['CHARM']), system(STARTS), index);
  assert.equal(value(derived, 'vigour'), 12);
});

test('a kind declaring none derives exactly as before', () => {
  const derived = deriveCharacter(holding(['OX']), system(undefined), index);
  assert.equal(value(derived, 'vigour'), 10);
  assert.deepEqual(derived.problems, []);
});

test('text that is not a number starts nothing, and the derivation says which element and setter', () => {
  // Fails if the reader takes the leading digits ("14 + PB" would read 14).
  const odd = element('ODD', 'Beast', { might: '14 + PB (hide)' });
  const derived = deriveCharacter(holding(['ODD']), system(STARTS), indexOf(odd));
  assert.equal(value(derived, 'vigour'), 10);
  const problem = derived.problems.find((p) => p.code === 'setter-not-a-number');
  assert.ok(problem, 'a warning names the unreadable setter');
  assert.equal(problem.elementId, 'ODD');
  assert.match(problem.message, /"might".*"14 \+ PB \(hide\)"/);
});

test('two held elements printing one stat: the first is used and a warning names both', () => {
  const calf = element('CALF', 'Beast', { might: '8' });
  const both = indexOf(ox, calf);
  const derived = deriveCharacter(holding(['OX', 'CALF']), system(STARTS), both);
  assert.equal(value(derived, 'vigour'), 16);
  const problem = derived.problems.find((p) => p.code === 'setter-stat-conflict');
  assert.ok(problem, 'a warning names the second supplier');
  assert.match(problem.message, /OX.*CALF/);
});

test('reading a printed number', () => {
  assert.equal(readSetterNumber('12'), 12);
  assert.equal(readSetterNumber(' 12 '), 12);
  assert.equal(readSetterNumber('1/8'), 0.125);
  assert.equal(readSetterNumber('13 (natural armor)'), 13);
  assert.equal(readSetterNumber('2 (1d4)'), 2);
  assert.equal(readSetterNumber('14 + PB (natural armor)'), undefined);
  assert.equal(readSetterNumber('40 ft., climb 30 ft.'), undefined);
  assert.equal(readSetterNumber('—'), undefined);
  assert.equal(readSetterNumber(''), undefined);
  assert.equal(readSetterNumber('1/0'), undefined);
  assert.equal(readSetterNumber('13 (a) (b)'), undefined);
  assert.equal(readSetterNumber(undefined), undefined);
});

test('the setter name is compared without case, and the stat key is lowercased', () => {
  const shouty = element('SHOUTY', 'Beast', { MIGHT: '9' });
  const starts = setterStartingValues([{ types: ['Beast'], setter: 'might', stat: 'Vigour' }], [shouty]);
  assert.deepEqual([...starts.values.keys()], ['vigour']);
  assert.equal(starts.values.get('vigour')?.value, 9);
});

function indexOf(...elements: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  for (const e of elements) index.add(e);
  return index;
}
