/**
 * A written feature's line that marks a row — ADR 0094.
 *
 * The fixture has no game in it. A keeper's "edge" grows with its rank; each of its two feats, climb and swim, reads
 * its own "…:skill", which starts where an Ox's rule puts it, and the Feats section marks a row by how many edges its
 * skill holds ("trained", "master"). A ward kind shows the same rows with a mark whose stat content supplies and the
 * kind does not declare, so it may not be marked. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { createCharacter, setCustomFeature, type Character, type CustomFeature } from './character.ts';
import { customFeatureStats } from './custom-features.ts';
import type { StatExpr as Expr } from './expression.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import { resolveCharacterKind, type GameSystem, type SheetSectionDef, type StatDef } from './system.ts';

const ref = (stat: string): Expr => ({ kind: 'ref', stat });
const plus = (left: Expr, right: Expr): Expr => ({ kind: 'binary', op: '+', left, right });

const STATS: StatDef[] = [
  { name: 'rank', label: 'Rank', default: 0 },
  { name: 'edge', label: 'Edge', derive: plus({ kind: 'number', value: 2 }, ref('rank')) },
  { name: 'climb:skill', default: 0, startsFrom: 'beast:climb:skill' },
  { name: 'swim:skill', default: 0, startsFrom: 'beast:swim:skill' },
  { name: 'climb', label: 'Climb', derive: ref('climb:skill') },
  { name: 'swim', label: 'Swim', derive: ref('swim:skill') },
];

const FEATS: SheetSectionDef = {
  id: 'feats',
  label: 'Feats',
  stats: ['climb', 'swim'],
  mark: { stat: '{stat}:skill', per: 'edge', labels: ['trained', 'master'], none: 'untrained' },
};

function system(feats: SheetSectionDef = FEATS): GameSystem {
  const kind = (id: string, stats: StatDef[]) => ({
    id,
    name: id,
    progression: { kind: 'rating' as const, stat: 'rank', min: 0, max: 10 },
    elementTypes: ['Beast', 'Knack'],
    stats,
    customFeatures: { type: 'Knack' },
    buildSteps: [],
    sheet: { sections: [{ id: 'numbers', label: 'Numbers', stats: ['rank', 'edge'] }, feats] },
  });
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Beast' }, { name: 'Knack' }],
    stats: [STATS[0]!, STATS[1]!],
    characterKinds: [
      { ...kind('keeper', STATS.slice(2)), default: true },
      // Its skills are content's: nothing declares them, so a start there would add to what content writes.
      kind('ward', [STATS[4]!, STATS[5]!]),
    ],
  };
}

// The Ox is trained in swimming: its rule puts one edge (2 at rank 0) in its swim skill.
const ox: Element = {
  id: 'OX',
  type: 'Beast',
  name: 'Ox',
  source: 'test',
  setters: {},
  rules: [{ kind: 'stat', key: 's', name: 'beast:swim:skill', value: ref('edge') } satisfies Rule],
  supports: [],
  origin: { sourceId: 'test', format: 'incudo' },
};
const index = new MapElementIndex();
index.add(ox);

function keeper(features: CustomFeature[], rank = 0): Character {
  let character = createCharacter('test', 'keeper', { progress: rank });
  character.choices = [{ ruleKey: 'build/beast', elementIds: ['OX'] }];
  for (const feature of features) character = setCustomFeature(character, feature);
  return character;
}

const marking = (id: string, name: string, stat: string, value: number): CustomFeature => ({
  id,
  name,
  stats: [{ stat, mode: 'mark', value }],
});
const value = (derived: ReturnType<typeof deriveCharacter>, name: string) => derived.stats.get(name)?.value;
const codes = (derived: ReturnType<typeof deriveCharacter>) => derived.problems.map((p) => p.code);

test('a row may be marked when its section declares a mark and the kind declares the mark stat, none first', () => {
  // Fails if `markOf` stops asking that the mark stat be the kind's own (the ward offers one), or drops `none`.
  const keeperStats = customFeatureStats(resolveCharacterKind(system(), 'keeper'));
  assert.deepEqual(keeperStats.find((s) => s.stat === 'climb')?.mark, {
    stat: 'climb:skill',
    per: 'edge',
    choices: ['untrained', 'trained', 'master'],
  });
  assert.equal(keeperStats.find((s) => s.stat === 'edge')?.mark, undefined, 'a section with no mark marks nothing');
  const wardStats = customFeatureStats(resolveCharacterKind(system(), 'ward'));
  assert.equal(wardStats.find((s) => s.stat === 'climb')?.mark, undefined, "a mark stat content supplies is not the kind's");
  // With no `none`, the system has not named it, and the word is a plain one.
  const plain = customFeatureStats(resolveCharacterKind(system({ ...FEATS, mark: { ...FEATS.mark!, none: undefined } }), 'keeper'));
  assert.equal(plain.find((s) => s.stat === 'climb')?.mark?.choices[0], 'none');
});

test("a mark sets where the row's mark stat starts as that many times `per`, and follows `per` when it moves", () => {
  // Fails if the start is the count itself (climb reads 1, not 2), if it is not re-read as rank moves `edge` (climb
  // stays 2 at rank 3), or if the start does not name the feature.
  const features = [marking('a', 'Grip', 'climb', 1), marking('b', 'Gills', 'swim', 2)];
  const low = deriveCharacter(keeper(features), system(), index);
  assert.equal(value(low, 'climb'), 2);
  assert.equal(value(low, 'swim'), 4, 'two edges, where the Ox gave one');
  assert.equal(low.starts.get('climb:skill')?.feature, 'Grip');
  assert.deepEqual(codes(low), []);
  const high = deriveCharacter(keeper(features, 3), system(), index);
  assert.equal(value(high, 'edge'), 5);
  assert.equal(value(high, 'climb'), 5);
  assert.equal(value(high, 'swim'), 10);
});

test("a mark of none replaces what the creature's rule states", () => {
  // Fails if `startsFrom` is applied over a feature's start (swim reads the Ox's 2).
  const derived = deriveCharacter(keeper([marking('a', 'Sinks', 'swim', 0)]), system(), index);
  assert.equal(value(derived, 'swim'), 0);
  assert.equal(value(deriveCharacter(keeper([]), system(), index), 'swim'), 2, 'the Ox swims without it');
});

test('a mark the row has no name for, or on a row that may not be marked, does nothing and is reported', () => {
  // Fails if the count is not checked against the choices (climb reads 6 or 3), or if the ward's row is marked.
  for (const count of [3, -1, 0.5]) {
    const derived = deriveCharacter(keeper([marking('a', 'Grip', 'climb', count)]), system(), index);
    assert.equal(value(derived, 'climb'), 0, `a count of ${count}`);
    assert.deepEqual(codes(derived), ['custom-feature-stat']);
    assert.match(derived.problems[0]!.message, /Grip marks Climb in a way a keeper has no name for/);
  }
  const ward = { ...keeper([marking('a', 'Grip', 'climb', 1)]), kind: 'ward' };
  const derived = deriveCharacter(ward, system(), index);
  assert.equal(value(derived, 'climb'), 0);
  assert.deepEqual(codes(derived), ['custom-feature-stat']);
});

test('two features marking one row: the first is used and the second reported', () => {
  // Fails if the later mark wins (climb reads 4) or the conflict is silent.
  const derived = deriveCharacter(keeper([marking('a', 'Grip', 'climb', 1), marking('b', 'Talons', 'climb', 2)]), system(), index);
  assert.equal(value(derived, 'climb'), 2);
  assert.deepEqual(codes(derived), ['custom-feature-conflict']);
  assert.match(derived.problems[0]!.message, /Talons marks Climb, and so does Grip/);
});

test('a feature with a line that marks a row raises the character to format 9, and one without does not', () => {
  // Fails if `setCustomFeature` stops reading the lines' modes.
  assert.equal(keeper([marking('a', 'Grip', 'climb', 1)]).formatVersion, 9);
  assert.equal(keeper([{ id: 'a', name: 'Grip', stats: [{ stat: 'climb', mode: 'add', value: 1 }] }]).formatVersion, 4);
});
