/**
 * Which of overlapping source loads may publish (`source-loads.ts`). Each case names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ConfiguredSource } from '@incudo/content';

import { SourceLoads, sourcesLoadKey } from './source-loads.ts';

test('a load publishes only when its sources are still the current ones', () => {
  // Perturbation: `publish: true` always is the bug this exists for: the slower, earlier load wins.
  const loads = new SourceLoads();
  const first = loads.begin('game');
  const second = loads.begin('game');
  assert.deepEqual(second(true), { publish: true, idle: true });
  assert.deepEqual(first(false), { publish: false, idle: true });
});

test('a load that will not publish leaves "loading" on while another of its system runs', () => {
  // Perturbation: `idle: true` always says nothing is loading while the current load still runs.
  const loads = new SourceLoads();
  const stale = loads.begin('game');
  const current = loads.begin('game');
  const other = loads.begin('other');
  assert.deepEqual(stale(false), { publish: false, idle: false });
  assert.deepEqual(other(true), { publish: true, idle: true }, "another system's load is its own");
  assert.deepEqual(current(true), { publish: true, idle: true });
});

test('the current load ends "loading" even with an earlier one still running', () => {
  // Perturbation: idle only when no load runs keeps the screen loading until the superseded load ends, for nothing.
  const loads = new SourceLoads();
  const stale = loads.begin('game');
  const current = loads.begin('game');
  assert.deepEqual(current(true), { publish: true, idle: true });
  assert.deepEqual(stale(false), { publish: false, idle: true });
  assert.throws(() => stale(false), /twice/);
});

test('a load key changes with the sources, their order, how they are kept and the parts switched off', () => {
  // Perturbation: a key of ids alone reads a reordered profile, or a part switched off, as the same load.
  const a = { id: 'a', url: 'a', name: 'A', enabled: true } as ConfiguredSource;
  const b = { id: 'b', url: 'b', name: 'B', enabled: true } as ConfiguredSource;
  const key = sourcesLoadKey([a, b]);
  assert.equal(sourcesLoadKey([{ ...a }, { ...b }]), key);
  assert.notEqual(sourcesLoadKey([b, a]), key);
  assert.notEqual(sourcesLoadKey([a]), key);
  assert.notEqual(sourcesLoadKey([{ ...a, keep: 'files' }, b]), key);
  assert.notEqual(sourcesLoadKey([{ ...a, excluded: ['x.xml'] }, b]), key);
});
