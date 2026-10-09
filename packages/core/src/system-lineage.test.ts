/**
 * What a system answers to for what is kept beside it (ADR 0102 decision 5, ADR 0104 decision 4).
 *
 * Perturbations, each run and failing here: `copiedFrom` left out of the lineage (a copy of 5e loads no content); the
 * lineage not deduplicated (a copy naming itself answers to its id twice); `copiedFrom` placed before `extends`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { systemLineage } from './system.ts';

test('a system answers to its own id', () => {
  assert.deepEqual(systemLineage({ id: 'cairn' }), ['cairn']);
});

test('an overlay answers to its parent after itself', () => {
  assert.deepEqual(systemLineage({ id: 'ours', extends: 'dnd5e' }), ['ours', 'dnd5e']);
});

test('a copy answers to what it was copied from after itself', () => {
  assert.deepEqual(systemLineage({ id: 'my-5e', copiedFrom: 'dnd5e' }), ['my-5e', 'dnd5e']);
});

test('an overlay of a copy answers to the copy, then to what the copy was copied from', () => {
  // An overlay inherits its parent's copiedFrom when it is applied, so the applied system carries both.
  assert.deepEqual(systemLineage({ id: 'ours', extends: 'my-5e', copiedFrom: 'dnd5e' }), ['ours', 'my-5e', 'dnd5e']);
});

test('each id once', () => {
  assert.deepEqual(systemLineage({ id: 'my-5e', copiedFrom: 'my-5e' }), ['my-5e']);
  assert.deepEqual(systemLineage({ id: 'ours', extends: 'dnd5e', copiedFrom: 'dnd5e' }), ['ours', 'dnd5e']);
});
