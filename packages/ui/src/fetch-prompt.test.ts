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

test('a refresh downloads everything when kept converted and what changed when kept as files', () => {
  // Fails if the kept form is not read (a converted refresh has no raw copy to answer "not modified" with), or if a
  // source recording no `keep` is not read as converted, the default.
  assert.deepEqual(fetchCost({ kind: 'refresh', source: source() }), { downloads: 'all', files: 740 });
  assert.deepEqual(fetchCost({ kind: 'refresh', source: source({ keep: 'converted' }) }), { downloads: 'all', files: 740 });
  assert.deepEqual(fetchCost({ kind: 'refresh', source: source({ keep: 'files' }) }), { downloads: 'changed', files: 740 });
});

test('switching to files downloads everything again; switching to converted, or to what it is, fetches nothing', () => {
  // Fails if the direction is not read: converted to files is the one that has no raw files to read.
  assert.deepEqual(fetchCost({ kind: 'keep', source: source(), keep: 'files' }), { downloads: 'all', files: 740 });
  assert.deepEqual(fetchCost({ kind: 'keep', source: source({ keep: 'files' }), keep: 'converted' }), { downloads: 'none' });
  assert.deepEqual(fetchCost({ kind: 'keep', source: source({ keep: 'files' }), keep: 'files' }), { downloads: 'none' });
});

test('nothing is asked on an unmetered connection, or one the platform cannot read', () => {
  // Fails if the prompt is shown whenever something downloads, or when `metered` is unknown.
  assert.equal(fetchPrompt({ kind: 'refresh', source: source() }, { metered: false }), undefined);
  assert.equal(fetchPrompt({ kind: 'refresh', source: source() }, {}), undefined);
});

test('nothing is asked for an action that fetches nothing, metered or not', () => {
  // Fails if a switch to converted, which reads the cache, is asked about.
  assert.equal(fetchPrompt({ kind: 'keep', source: source({ keep: 'files' }), keep: 'converted' }, metered), undefined);
});

test('on a metered connection the question says what will be downloaded', () => {
  // Fails if the two refreshes are worded alike, or the count from the last load is not used.
  assert.deepEqual(fetchPrompt({ kind: 'refresh', source: source() }, metered), {
    title: 'Refresh Core?',
    message: `Refreshing downloads all 740 of its files again, because it is kept converted.\n\n${METERED_NOTE}`,
    confirm: 'Refresh',
  });
  assert.equal(
    fetchPrompt({ kind: 'refresh', source: source({ keep: 'files' }) }, metered)?.message,
    `Refreshing asks for each of its files (740) and downloads the ones that changed.\n\n${METERED_NOTE}`,
  );
  assert.deepEqual(fetchPrompt({ kind: 'keep', source: source({ fileCount: undefined }), keep: 'files' }, metered), {
    title: 'Keep Core as files?',
    message: `Keeping it as files downloads all of its files again, because the converted form keeps none of them.\n\n${METERED_NOTE}`,
    confirm: 'Keep as files',
  });
});

test('adding a source says the connection is metered only when it is', () => {
  // Fails if the note is added on an unknown connection.
  assert.equal(addSourceNote({}), 'It is downloaded in full now.');
  assert.equal(addSourceNote({ metered: false }), 'It is downloaded in full now.');
  assert.equal(addSourceNote(metered), `It is downloaded in full now. ${METERED_NOTE}`);
});
