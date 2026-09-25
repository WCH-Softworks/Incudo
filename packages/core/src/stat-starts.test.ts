/**
 * A stat may start where another stat is — ADR 0059.
 *
 * The fixture has no game in it: a Beast's own rule states its "beast:guard", and the keeper's "guard"
 * starts there. Each test names the change to the engine that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter, type Character } from './character.ts';
import { MapElementIndex, type Element, type Rule, type Setter } from './model.ts';
import type { GameSystem, SetterStatDef, StatDef } from './system.ts';

function element(id: string, type: string, rules: Rule[] = [], setters: Record<string, string> = {}): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return { id, type, name: id, source: 'test', setters: out, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const stat = (name: string, value: number): Rule => ({
  kind: 'stat',
  key: `${name}:${value}`,
  name,
  value: { kind: 'number', value },
});

function system(stats: StatDef[], setterStats?: SetterStatDef[]): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Beast' }, { name: 'Charm' }],
    stats,
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

const ox = element('OX', 'Beast', [stat('beast:guard', 13)], { guard: '15' });
const charm = element('CHARM', 'Charm', [stat('guard', 2)]);
const index = new MapElementIndex();
for (const e of [ox, charm]) index.add(e);

const GUARD: StatDef[] = [{ name: 'guard', startsFrom: 'beast:guard' }];
const value = (derived: ReturnType<typeof deriveCharacter>, name: string): number | undefined =>
  derived.stats.get(name)?.value;

test('a stat starts where the named stat is, and content adds to it', () => {
  // Fails if the engine stops reading `startsFrom` (guard reads 2, or nothing).
  const derived = deriveCharacter(holding(['OX', 'CHARM']), system(GUARD), index);
  assert.equal(value(derived, 'guard'), 15);
  assert.deepEqual(derived.starts.get('guard'), { stat: 'guard', value: 13, from: 'beast:guard', replaced: false });
});

test('a base the user set replaces the start, and is not added to it', () => {
  // Fails if the start is applied whatever the base (reads 29 — the old `derive` on top of a base).
  const derived = deriveCharacter(holding(['OX', 'CHARM'], { guard: 14 }), system(GUARD), index);
  assert.equal(value(derived, 'guard'), 16);
  // Still published, so an editor can show what clearing the base goes back to.
  assert.equal(derived.starts.get('guard')?.value, 13);
  assert.equal(derived.starts.get('guard')?.replaced, true);
});

test('nothing contributing to the named stat supplies nothing, and the default stands', () => {
  // Fails if an absent named stat is read as a start of 0 (guard reads 0 rather than 10).
  const derived = deriveCharacter(holding(['CHARM']), system([{ name: 'guard', default: 10, startsFrom: 'beast:guard' }]), index);
  assert.equal(value(derived, 'guard'), 12);
  assert.equal(derived.starts.has('guard'), false);
});

test('it replaces a declared default rather than adding to it', () => {
  // Fails if the default is kept under the start (reads 25).
  const derived = deriveCharacter(holding(['OX', 'CHARM']), system([{ name: 'guard', default: 10, startsFrom: 'beast:guard' }]), index);
  assert.equal(value(derived, 'guard'), 15);
});

test('a printed setter is a more specific start and stays', () => {
  // Fails if `startsFrom` is applied over a setter start (reads 15 rather than 17).
  const derived = deriveCharacter(
    holding(['OX', 'CHARM']),
    system(GUARD, [{ types: ['Beast'], setter: 'guard', stat: 'guard' }]),
    index,
  );
  assert.equal(value(derived, 'guard'), 17);
  assert.deepEqual(derived.starts.get('guard'), { stat: 'guard', value: 15, from: 'OX', replaced: false });
});

test('a stat declaring none derives as before, and publishes no start', () => {
  const derived = deriveCharacter(holding(['OX', 'CHARM']), system([{ name: 'guard', default: 10 }]), index);
  assert.equal(value(derived, 'guard'), 12);
  assert.equal(derived.starts.size, 0);
});
