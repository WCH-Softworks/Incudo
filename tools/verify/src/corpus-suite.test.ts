/**
 * The quick and full corpus suites (`INCUDO_CORPUS_SUITE`, real-data.ts). These read no corpus, so they run
 * everywhere: a manifest edit that leaves a quick sample matching nothing fails here, in the build job, rather than
 * on the next pull request's corpus run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { corpusSuiteOf } from './real-data.ts';
import { QUICK_SAMPLES, readManifest } from './sample-saves.ts';

test('the suite is full unless a run asks for quick, and anything else is refused', () => {
  assert.equal(corpusSuiteOf({}), 'full');
  assert.equal(corpusSuiteOf({ INCUDO_CORPUS_SUITE: '' }), 'full');
  assert.equal(corpusSuiteOf({ INCUDO_CORPUS_SUITE: 'full' }), 'full');
  assert.equal(corpusSuiteOf({ INCUDO_CORPUS_SUITE: 'quick' }), 'quick');
  assert.throws(() => corpusSuiteOf({ INCUDO_CORPUS_SUITE: 'Quick' }), /quick" or "full/);
  assert.throws(() => corpusSuiteOf({ INCUDO_CORPUS_SUITE: 'fast' }), /quick" or "full/);
});

test('every quick sample is a sample, each a different one, and they are a few of the whole set', () => {
  const all = readManifest('all').samples;
  const picked = QUICK_SAMPLES.map(({ why, is }) => {
    const match = all.find(is);
    assert.ok(match, `no sample is ${why}`);
    return match.file;
  });
  assert.equal(new Set(picked).size, picked.length, 'two quick predicates pick the same sample');
  assert.ok(picked.length < all.length / 2, 'the quick set is an abridgement, not the whole set');
  const editions = new Set(QUICK_SAMPLES.map(({ is }) => all.find(is)!.edition));
  assert.deepEqual([...editions].sort(), ['2014', '2024']);
  assert.ok(QUICK_SAMPLES.some(({ is }) => all.find(is)!.split.length > 1), 'a multiclass sample is swept');
});
