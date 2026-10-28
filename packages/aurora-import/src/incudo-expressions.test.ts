/**
 * ADR 0119: what Aurora's app read into its expressions is written down by the converter as Incudo's own. Each test
 * names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateExpr, parseRequirements, parseStatValue, type Element } from '@incudo/core';

import { incudoElement, withLevels, withoutHalves } from './incudo-expressions.ts';

const ctx = (stats: Record<string, number>) => ({ statNumber: (s: string) => stats[s.toLowerCase()] ?? 0, statString: () => undefined });

test(':half and :half:up are written as the arithmetic they mean, and evaluate with no suffix read', () => {
  // Perturbation: rounding :half up, or leaving the reference as it was (the engine reads it as a stat nothing publishes, 0).
  const down = withoutHalves(parseStatValue('level:paladin:half'));
  const up = withoutHalves(parseStatValue('proficiency:half:up'));
  assert.deepEqual(down, {
    kind: 'call',
    fn: 'floor',
    args: [{ kind: 'binary', op: '/', left: { kind: 'ref', stat: 'level:paladin' }, right: { kind: 'number', value: 2 } }],
  });
  assert.equal(evaluateExpr(down, ctx({ 'level:paladin': 5 })), 2);
  assert.equal(evaluateExpr(up, ctx({ proficiency: 3 })), 2);
  assert.deepEqual(withoutHalves(parseStatValue('level')), { kind: 'ref', stat: 'level' }, 'a reference with no suffix is unchanged');
});

test('[character:N] is written as the level it means, wherever it sits in a requirement', () => {
  // Perturbation: leaving the stat as "character", which only 5e's old alias answered.
  assert.deepEqual(withLevels(parseRequirements('[character:5]')!), { kind: 'atLeast', stat: 'level', value: 5 });
  assert.deepEqual(withLevels(parseRequirements('!([character:3]||ID_X)')!), {
    kind: 'not',
    child: { kind: 'or', children: [{ kind: 'atLeast', stat: 'level', value: 3 }, { kind: 'has', id: 'ID_X' }] },
  });
});

test('a ritual is given the tag Aurora read its setter as, once, and anything else is unchanged', () => {
  const spell = (setters: Record<string, string>, supports: string[] = []): Element => ({
    id: 'ID_SPELL',
    type: 'Spell',
    name: 'Spell',
    source: '',
    setters: Object.fromEntries(Object.entries(setters).map(([k, value]) => [k, { value }])),
    rules: [],
    supports,
    origin: { sourceId: 's' },
  });
  // Perturbation: not reading the setter leaves a ritual out of every filter naming Ritual.
  assert.deepEqual(incudoElement(spell({ isRitual: 'true' })).supports, ['Ritual']);
  assert.deepEqual(incudoElement(spell({ isRitual: 'true' }, ['Ritual'])).supports, ['Ritual'], 'not twice');
  assert.deepEqual(incudoElement(spell({ isRitual: 'false' })).supports, []);
});

test('the rewrite reaches every rule, the element\'s own requirements and its multiclass block', () => {
  const element: Element = {
    id: 'ID_CLASS',
    type: 'Class',
    name: 'Class',
    source: '',
    setters: {},
    rules: [{ kind: 'stat', key: 's', name: 'x', value: parseStatValue('level:class:half'), requirements: parseRequirements('[character:2]') }],
    supports: [],
    requirements: parseRequirements('[character:4]'),
    multiclass: { id: 'ID_MC', setters: {}, rules: [], requirements: parseRequirements('[character:1]') },
    origin: { sourceId: 's' },
  };
  const out = incudoElement(element);
  assert.equal(JSON.stringify(out).includes('character'), false);
  assert.equal(JSON.stringify(out).includes(':half'), false);
});
