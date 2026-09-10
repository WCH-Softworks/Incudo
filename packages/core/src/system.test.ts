import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampProgress,
  defaultCharacterKindId,
  initialProgress,
  progressionStat,
  resolveCharacterKind,
  orderBuildSteps,
  buildStepCycles,
  type BuildStepDef,
  type GameSystem,
} from './system.ts';

/**
 * A fixture with no game in it. The point of ADR 0009 is that the engine cannot name a
 * kind, so the test does not name a real one either — "alpha" and "beta" would work just
 * as well as "pc" and "npc", which is the whole claim.
 */
function fixture(overrides: Partial<GameSystem> = {}): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Widget' }, { name: 'Gadget' }, { name: 'Doohickey' }],
    stats: [
      { name: 'vigour', default: 10 },
      { name: 'grit', default: 1 },
    ],
    characterKinds: [
      {
        id: 'alpha',
        name: 'Alpha',
        default: true,
        progression: { kind: 'level', min: 1, max: 5 },
        elementTypes: ['Widget', 'Gadget'],
        buildSteps: [{ id: 'one', label: 'One', types: ['Widget'] }],
        sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
      },
      {
        id: 'beta',
        name: 'Beta',
        progression: { kind: 'rating', stat: 'threat', min: 0, max: 30 },
        elementTypes: ['Gadget'],
        stats: [{ name: 'threat', default: 0 }, { name: 'grit', default: 99 }],
        buildSteps: [{ id: 'two', label: 'Two', types: ['Gadget'] }],
        sheet: { sections: [{ id: 't', label: 'T', stats: ['threat'] }] },
      },
      {
        id: 'gamma',
        name: 'Gamma',
        extends: 'beta',
        elementTypes: ['+Doohickey', '-Gadget'],
      },
    ],
    ...overrides,
  };
}

test('the default kind is the one marked default, then the first', () => {
  assert.equal(defaultCharacterKindId(fixture()), 'alpha');

  const unmarked = fixture();
  delete unmarked.characterKinds[0]!.default;
  assert.equal(defaultCharacterKindId(unmarked), 'alpha');
});

test('a kind inherits the system stats and may replace one by name', () => {
  const alpha = resolveCharacterKind(fixture(), 'alpha');
  assert.deepEqual(
    alpha.stats.map((s) => s.name),
    ['vigour', 'grit'],
  );

  // "grit" is declared by both. The kind's wins, and it does not appear twice — a kind
  // that could only append could never override an inherited derivation.
  const beta = resolveCharacterKind(fixture(), 'beta');
  assert.deepEqual(
    beta.stats.map((s) => s.name),
    ['vigour', 'grit', 'threat'],
  );
  assert.equal(beta.stats.find((s) => s.name === 'grit')?.default, 99);
});

test('extends is a delta, not a copy', () => {
  const gamma = resolveCharacterKind(fixture(), 'gamma');

  // Inherited wholesale from beta:
  assert.deepEqual(gamma.progression, { kind: 'rating', stat: 'threat', min: 0, max: 30 });
  assert.deepEqual(
    gamma.buildSteps.map((s) => s.id),
    ['two'],
  );
  assert.equal(gamma.stats.find((s) => s.name === 'threat')?.default, 0);

  // Patched: "+" adds, "-" removes, and the parent's list is the starting point.
  assert.deepEqual(gamma.elementTypes, ['Doohickey']);

  // Its own identity survives the merge.
  assert.equal(gamma.id, 'gamma');
  assert.equal(gamma.name, 'Gamma');
});

test('an element type list with no prefix replaces rather than patches', () => {
  const system = fixture();
  system.characterKinds[2]!.elementTypes = ['Widget'];
  assert.deepEqual(resolveCharacterKind(system, 'gamma').elementTypes, ['Widget']);
});

test('a broken extends chain is refused, not half-applied', () => {
  const missing = fixture();
  missing.characterKinds[2]!.extends = 'nope';
  assert.throws(() => resolveCharacterKind(missing, 'gamma'), /does not declare/);

  const cyclic = fixture();
  cyclic.characterKinds[1]!.extends = 'gamma';
  assert.throws(() => resolveCharacterKind(cyclic, 'gamma'), /extends itself/);

  assert.throws(() => resolveCharacterKind(fixture(), 'delta'), /no character kind "delta"/);
});

test('progression: level publishes "level" unless told otherwise', () => {
  assert.equal(progressionStat({ kind: 'level', min: 1, max: 20 }), 'level');
  assert.equal(progressionStat({ kind: 'level', min: 1, max: 20, stat: 'tier' }), 'tier');
  assert.equal(progressionStat({ kind: 'rating', stat: 'challenge' }), 'challenge');
  assert.equal(progressionStat({ kind: 'xp', stat: 'experience' }), 'experience');
  assert.equal(progressionStat({ kind: 'none' }), undefined);
});

test('progression bounds', () => {
  const level = { kind: 'level', min: 1, max: 20 } as const;
  assert.equal(initialProgress(level), 1);
  assert.equal(clampProgress(level, 0), 1);
  assert.equal(clampProgress(level, 99), 20);
  assert.equal(clampProgress(level, 7), 7);

  // An unbounded rating stays whatever it is told; fractional CRs are ordinary numbers.
  const rating = { kind: 'rating', stat: 'challenge' } as const;
  assert.equal(initialProgress(rating), 0);
  assert.equal(clampProgress(rating, 0.25), 0.25);

  // "none" has nowhere to move to, and says so rather than pretending to be level 1.
  assert.equal(initialProgress({ kind: 'none' }), 0);
  assert.equal(clampProgress({ kind: 'none' }, 12), 0);
});

// --- build step order (ADR 0017) --------------------------------------------

function steps(...defs: BuildStepDef[]): BuildStepDef[] {
  return defs;
}

function step(id: string, requires?: string[]): BuildStepDef {
  return { id, label: id, types: [], ...(requires ? { requires } : {}) };
}

test('a step that requires nothing sorts first, and declared order breaks ties', () => {
  const ordered = orderBuildSteps(
    steps(step('race'), step('class'), step('abilities'), step('spells', ['class'])),
  );
  assert.deepEqual(ordered.map((s) => s.id), ['race', 'class', 'abilities', 'spells']);
});

test('a dependency moves a step later however early it was declared', () => {
  const ordered = orderBuildSteps(steps(step('spells', ['class']), step('class')));
  assert.deepEqual(ordered.map((s) => s.id), ['class', 'spells']);
});

test('order is derived from dependencies, not from a number, so a chain resolves', () => {
  const ordered = orderBuildSteps(
    steps(step('c', ['b']), step('b', ['a']), step('a')),
  );
  assert.deepEqual(ordered.map((s) => s.id), ['a', 'b', 'c']);
});

test('a step in a cycle is placed last rather than dropped, and reported', () => {
  const defs = steps(step('a', ['b']), step('b', ['a']), step('free'));
  // Losing a screen silently is a worse failure than showing it in an odd place.
  assert.deepEqual(orderBuildSteps(defs).map((s) => s.id), ['free', 'a', 'b']);
  assert.deepEqual(buildStepCycles(defs), ['a', 'b']);
});

test('a requirement naming no step is ignored by the sort and left to validation', () => {
  const ordered = orderBuildSteps(steps(step('a', ['nonexistent']), step('b')));
  assert.deepEqual(ordered.map((s) => s.id), ['a', 'b']);
  assert.deepEqual(buildStepCycles(ordered), []);
});

test('a well-formed system has no cycles', () => {
  assert.deepEqual(buildStepCycles(steps(step('a'), step('b', ['a']))), []);
});
