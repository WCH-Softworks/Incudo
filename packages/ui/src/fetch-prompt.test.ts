/**
 * What a source action downloads, and the question asked first on a metered connection — ADR 0100.
 *
 * Each test names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ConfiguredSource } from '@incudo/content';

import { METERED_NOTE, addSourceNote, fetchCost, fetchPrompt } from './fetch-prompt.ts';

function source(patch: Partial<ConfiguredSource> = {}): ConfiguredSource {
  return {
    id: 'https://example.test/core.index',
    url: 'https://example.test/core.index',
    name: 'Core',
    enabled: true,
    mode: 'download',
    addedAt: '2026-01-01T00:00:00.000Z',
    fileCount: 740,
    ...patch,
  };
}

const metered = { metered: true };

test('a refresh downloads every file again, and one with nothing upstream nothing', () => {
  // Fails if a refresh is read as asking for what changed (no other copy is kept to answer "not modified" with, ADR
  // 0119), or if a file or homebrew source is read as downloading anything.
  assert.deepEqual(fetchCost({ kind: 'refresh', source: source() }), { downloads: 'all', files: 740 });
  assert.deepEqual(fetchCost({ kind: 'refresh', source: source({ keep: 'files' }) }), { downloads: 'all', files: 740 });
  assert.deepEqual(fetchCost({ kind: 'refresh', source: source({ kind: 'file' }) }), { downloads: 'none' });
});

test('nothing is asked on an unmetered connection, or one the platform cannot read', () => {
  // Fails if the prompt is shown whenever something downloads, or when `metered` is unknown.
  assert.equal(fetchPrompt({ kind: 'refresh', source: source() }, { metered: false }), undefined);
  assert.equal(fetchPrompt({ kind: 'refresh', source: source() }, {}), undefined);
});

test('nothing is asked for an action that fetches nothing, metered or not', () => {
  assert.equal(fetchPrompt({ kind: 'refresh', source: source({ kind: 'homebrew' }) }, metered), undefined);
});

test('on a metered connection the question says what will be downloaded', () => {
  // Fails if the count from the last load is not used.
  assert.deepEqual(fetchPrompt({ kind: 'refresh', source: source() }, metered), {
    title: 'Refresh Core?',
    message: `Refreshing downloads all 740 of its files again.\n\n${METERED_NOTE}`,
    confirm: 'Refresh',
  });
  assert.match(fetchPrompt({ kind: 'refresh', source: source({ fileCount: undefined }) }, metered)!.message, /^Refreshing downloads all of its files again/);
});

test('adding a source says the connection is metered only when it is', () => {
  // Fails if the note is added on an unknown connection.
  assert.equal(addSourceNote({}), 'It is downloaded in full now.');
  assert.equal(addSourceNote({ metered: false }), 'It is downloaded in full now.');
  assert.equal(addSourceNote(metered), `It is downloaded in full now. ${METERED_NOTE}`);
});
