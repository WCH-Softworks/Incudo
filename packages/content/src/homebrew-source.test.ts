/**
 * ADR 0108: elements the user writes are a source of their own, kept in the app's storage in Incudo's content format.
 *
 * Each test names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage } from '@incudo/core';
import { checkSourceForUpdates, composeSource, evictSourceCache, refreshSource } from './compose.ts';
import { removeSource } from './file-source.ts';
import {
  checkHomebrewBundle,
  createHomebrewSource,
  homebrewFileUrl,
  homebrewKey,
  readHomebrew,
  writeHomebrew,
  type HomebrewElement,
} from './homebrew-source.ts';
import { ContentLibrary } from './library.ts';
import { SourceProfile, keepsConverted } from './profile.ts';

const noNetwork = { fetchText: async () => Promise.reject(new Error('no network in this test')) };

function element(id: string, name = id): HomebrewElement {
  return {
    id,
    type: 'Feat',
    name,
    source: 'My table',
    setters: {},
    rules: [{ kind: 'stat', key: 'line-0', name: 'speed', value: { kind: 'number', value: 10 } }],
    supports: [],
  };
}

async function made(name = 'My table') {
  const storage = new MemoryStorage();
  const profile = new SourceProfile(storage);
  const source = await createHomebrewSource(profile, storage, { name, systemId: 'game' });
  return { storage, profile, source };
}

// Perturbation: compose a homebrew source as an index at a URL (the HTTP branch) — the load asks the network and fails.
test('a homebrew source loads its elements from storage, with no network, as Incudo content', async () => {
  const { storage, source } = await made();
  assert.equal(source.id, 'homebrew:my-table');
  assert.equal(source.kind, 'homebrew');
  assert.equal(source.systemId, 'game');
  await writeHomebrew(storage, source.id, { formatVersion: 1, elements: [element('ID_HOMEBREW_FEAT_FAST', 'Fast')] });

  const library = new ContentLibrary();
  const report = await library.loadSource(composeSource(source, { fetcher: noNetwork, storage }), source.url);
  assert.equal(report.diagnostics.filter((d) => d.level === 'error').length, 0);
  const loaded = library.elements.get('ID_HOMEBREW_FEAT_FAST');
  assert.equal(loaded?.name, 'Fast');
  assert.deepEqual(loaded?.origin, { sourceId: source.id, fileUrl: homebrewFileUrl(source.url), format: 'incudo' });
});

// Perturbation: keep the parsed body on the source between loads — the second load sees the first load's elements,
// changed after it, and not the edit saved since.
test('every load reads the body afresh', async () => {
  const { storage, source } = await made();
  await writeHomebrew(storage, source.id, { formatVersion: 1, elements: [element('ID_A')] });
  const composed = composeSource(source, { fetcher: noNetwork, storage });
  const one = new ContentLibrary();
  await one.loadSource(composed, source.url);
  one.elements.get('ID_A')!.supports.push('changed');
  await writeHomebrew(storage, source.id, { formatVersion: 1, elements: [element('ID_A', 'Renamed')] });
  const two = new ContentLibrary();
  await two.loadSource(composed, source.url);
  assert.deepEqual(two.elements.get('ID_A')!.supports, []);
  assert.equal(two.elements.get('ID_A')!.name, 'Renamed');
});

// Perturbation: drop the -2 suffix loop in homebrewSourceId — the second source replaces the first in the profile.
test('two homebrew sources of one name are two sources', async () => {
  const { storage, profile } = await made('Table');
  const second = await createHomebrewSource(profile, storage, { name: 'Table', systemId: 'game' });
  assert.equal(second.id, 'homebrew:table-2');
  assert.equal(profile.sources.length, 2);
  await assert.rejects(createHomebrewSource(profile, storage, { name: '  ', systemId: 'game' }), /needs a name/);
});

// Perturbation: keep the body under the source's `content/` prefix — eviction removes it.
test('the body survives evicting the cache, and goes with the source', async () => {
  const { storage, profile, source } = await made();
  await writeHomebrew(storage, source.id, { formatVersion: 1, elements: [element('ID_A')] });
  await evictSourceCache(storage, source.id);
  assert.notEqual(await storage.read(homebrewKey(source.id)), null);
  assert.equal(keepsConverted(source), false);
  await removeSource(profile, storage, source.id);
  assert.equal(await storage.read(homebrewKey(source.id)), null);
  assert.equal(profile.sources.length, 0);
});

// Perturbation: let checkSourceForUpdates or refreshSource fall through to the HTTP path — they ask the network.
test('there is nothing upstream to check or refresh', async () => {
  const { storage, source } = await made();
  const status = await checkSourceForUpdates(source, { fetcher: noNetwork, storage });
  assert.equal(status.state, 'unknown');
  await assert.rejects(refreshSource(source, { fetcher: noNetwork, storage }), /content you wrote/);
});

// Perturbation: remove the duplicate-id check, or the per-element field checks — a broken body is read.
test('the checker refuses what the engine could not read, and an id twice ignoring case', () => {
  assert.equal(checkHomebrewBundle({ formatVersion: 1, elements: [element('ID_A')] }).problems.length, 0);
  assert.match(checkHomebrewBundle({ formatVersion: 2, elements: [] }).problems.join(' '), /formatVersion/);
  assert.match(checkHomebrewBundle({ formatVersion: 1 }).problems.join(' '), /no list of elements/);
  assert.match(checkHomebrewBundle({ formatVersion: 1, elements: [element('ID_A'), element('id_a')] }).problems.join(' '), /used by another/);
  const noName = { ...element('ID_A'), name: '' };
  assert.match(checkHomebrewBundle({ formatVersion: 1, elements: [noName] }).problems.join(' '), /no name/);
});

// Perturbation: read a broken body as empty, or let writeHomebrew skip its read — the hand edit is written over.
test('a body that does not read fails the load with a sentence and is never written over', async () => {
  const { storage, source } = await made();
  await storage.write(homebrewKey(source.id), '{ not json');
  const read = await readHomebrew(storage, source.id);
  assert.equal(read.status, 'unreadable');
  await assert.rejects(writeHomebrew(storage, source.id, { formatVersion: 1, elements: [] }), /not valid JSON/);
  assert.equal(await storage.read(homebrewKey(source.id)), '{ not json');
  const library = new ContentLibrary();
  const report = await library.loadSource(composeSource(source, { fetcher: noNetwork, storage }), source.url);
  const errors = report.diagnostics.filter((d) => d.level === 'error').map((d) => d.message);
  assert.ok(errors.some((e) => /not valid JSON/.test(e)), errors.join('\n'));
});
