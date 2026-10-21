/**
 * ADR 0090: a source switched off is named as declaring what an enabled source is missing, from what it declared the
 * last time it was loaded.
 *
 * Each case names the perturbation that fails it. The real corpus, split into AuroraLegacy's indexes as sources, is
 * `tools/verify`'s `switched-off-sources.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, type FetchResult, type Fetcher } from '@incudo/core';

import { declaredKey, declaredSignatureKey, readDeclared, switchedOffSupply } from './declared.ts';
import { removeSource } from './file-source.ts';
import { loadSources, type LoadedSource } from './load-sources.ts';
import { SourceProfile, type ConfiguredSource } from './profile.ts';

const BASE = 'https://example.test/';
const element = (id: string, rules = ''): string =>
  `<element name="${id}" type="Widget" source="Test" id="${id}"><description><p>${id}</p></description><rules>${rules}</rules></element>`;
const grant = (id: string): string => `<grant type="Widget" id="${id}" />`;
const elements = (body: string): string => `<?xml version="1.0"?><elements>${body}</elements>`;
const index = (name: string, ...files: string[]): string =>
  `<?xml version="1.0"?><index><info><name>${name}</name><update version="1.0.0" /></info><files>${files
    .map((file) => `<file name="${file}" url="${BASE}${file}" />`)
    .join('')}</files></index>`;

/**
 * Core holds the skill and the language and lists the book's index, as AuroraLegacy's `core.index` lists the Player's
 * Handbook's. The book grants both and declares a race; the supplement grants the race, appends to a feat only Extras
 * declares, and grants a misspelt id nothing declares.
 */
const FILES: Record<string, string> = {
  'core.index': index('Core', 'core.xml', 'book.index'),
  'core.xml': elements(element('ID_SKILL') + element('ID_LANGUAGE')),
  'book.index': index('Book', 'book.xml'),
  'book.xml': elements(element('ID_RACE', grant('ID_SKILL') + grant('ID_LANGUAGE'))),
  'extras.index': index('Extras', 'extras.xml'),
  'extras.xml': elements(element('ID_LANGUAGE') + element('ID_FEAT')),
  'supplement.index': index('Supplement', 'supplement.xml'),
  'supplement.xml': elements(
    element('ID_SUBRACE', grant('ID_RACE') + grant('ID_MISPELT')) +
      `<append id="ID_FEAT"><rules>${grant('ID_SUBRACE')}</rules></append>`,
  ),
};

class Files implements Fetcher {
  async fetchText(url: string): Promise<FetchResult> {
    const text = FILES[url.slice(BASE.length)];
    if (text === undefined) throw new Error(`no such file: ${url}`);
    return { url, text };
  }
}

/** Counts writes, so an unchanged record can be seen not to be written again. */
class CountingStorage extends MemoryStorage {
  writes: string[] = [];
  override async write(key: string, value: string): Promise<void> {
    this.writes.push(key);
    return super.write(key, value);
  }
}

function profileOf(...names: string[]): { profile: SourceProfile; storage: CountingStorage; sources: Record<string, ConfiguredSource> } {
  const storage = new CountingStorage();
  const profile = new SourceProfile(storage);
  const sources: Record<string, ConfiguredSource> = {};
  for (const name of names) sources[name] = profile.add(`${BASE}${name}.index`, { name, mode: 'download' });
  return { profile, storage, sources };
}

/** Load the enabled ones, offering the switched-off ones as `switchedOff`, as the shells do. */
async function load(profile: SourceProfile, storage: MemoryStorage): Promise<Map<string, LoadedSource>> {
  const loaded = await loadSources(profile.enabled, { fetcher: new Files(), storage }, undefined, {
    switchedOff: profile.sources.filter((source) => !source.enabled),
  });
  return new Map(loaded.sources.map((source) => [source.name, source]));
}

test('a switched-off source that was loaded before is named for what it declares of what is missing', async () => {
  // Perturbation: not writing the record in loadSources leaves the book's line naming nothing.
  const { profile, storage, sources } = profileOf('core', 'book');
  sources.book!.enabled = false;
  await load(profile, storage);
  sources.core!.enabled = false;
  sources.book!.enabled = true;
  const book = (await load(profile, storage)).get('Book')!;
  const missing = ['ID_LANGUAGE', 'ID_SKILL'];
  assert.deepEqual(book.missing?.references, missing);
  assert.deepEqual(book.switchedOff, [{ sourceId: sources.core!.id, references: missing, additions: [] }]);
});

test('a source loaded after one that holds the same files still records what they declare', async () => {
  // Perturbation: making the record from what the load read (the library's "already loaded" check skips the book's
  // file, which Core loaded first) records nothing for the book.
  const { profile, storage, sources } = profileOf('core', 'book');
  const both = await load(profile, storage);
  assert.equal(both.get('Book')!.fileCount, 0, 'Core loaded the book first');
  assert.deepEqual((await readDeclared(storage, sources.book!))?.ids, ['ID_RACE']);
  assert.deepEqual((await readDeclared(storage, sources.core!))?.ids, ['ID_LANGUAGE', 'ID_RACE', 'ID_SKILL']);
});

test('an id two switched-off sources declare is named under both, in the profile order, and one declaring none is left out', async () => {
  // Perturbation: stopping at the first source that declares an id leaves Extras out of the language.
  const { profile, storage, sources } = profileOf('core', 'extras', 'supplement', 'book');
  sources.book!.enabled = false;
  await load(profile, storage);
  for (const name of ['core', 'extras', 'supplement']) sources[name]!.enabled = false;
  sources.book!.enabled = true;
  const book = (await load(profile, storage)).get('Book')!;
  assert.deepEqual(
    book.switchedOff?.map((supply) => [supply.sourceId, supply.references]),
    [
      [sources.core!.id, ['ID_LANGUAGE', 'ID_SKILL']],
      [sources.extras!.id, ['ID_LANGUAGE']],
    ],
  );
});

test('an addition waiting for its target names the switched-off source that declares it, and an id nothing declares names none', async () => {
  // Perturbation: leaving additions out of `switchedOffSupply` names Extras for nothing.
  const { profile, storage, sources } = profileOf('core', 'extras', 'supplement');
  await load(profile, storage);
  sources.extras!.enabled = false;
  sources.core!.enabled = false;
  const supplement = (await load(profile, storage)).get('Supplement')!;
  assert.deepEqual(supplement.missing, { references: ['ID_MISPELT', 'ID_RACE'], additions: ['ID_FEAT'] });
  assert.deepEqual(supplement.switchedOff, [
    { sourceId: sources.core!.id, references: ['ID_RACE'], additions: [] },
    { sourceId: sources.extras!.id, references: [], additions: ['ID_FEAT'] },
  ]);
  const named: string[] = (supplement.switchedOff ?? []).flatMap((supply) => supply.references);
  assert.ok(!named.includes('ID_MISPELT'), 'an id nothing declares is named under no source');
});

test('a source never loaded, or recorded with other parts switched off, is named for nothing', async () => {
  // Perturbation: reading a record whatever parts it was made with names Core for the book it no longer loads.
  const { profile, storage, sources } = profileOf('core', 'book');
  sources.core!.enabled = false;
  assert.equal((await load(profile, storage)).get('Book')!.switchedOff, undefined, 'Core was never loaded');

  sources.core!.enabled = true;
  sources.book!.enabled = false;
  await load(profile, storage);
  sources.core!.enabled = false;
  sources.core!.excluded = [`${BASE}core.xml`];
  sources.book!.enabled = true;
  assert.equal((await load(profile, storage)).get('Book')!.switchedOff, undefined);
  sources.core!.excluded = [];
  assert.ok((await load(profile, storage)).get('Book')!.switchedOff, 'the same parts again: named');
});

test('nothing is read or named when the caller offers no switched-off sources', async () => {
  // Perturbation: reading every record the storage holds would name Core here.
  const { profile, storage, sources } = profileOf('core', 'book');
  sources.book!.enabled = false;
  await load(profile, storage);
  sources.core!.enabled = false;
  sources.book!.enabled = true;
  const loaded = await loadSources(profile.enabled, { fetcher: new Files(), storage });
  assert.ok(loaded.sources[0]!.missing);
  assert.equal(loaded.sources[0]!.switchedOff, undefined);
});

test('a record is written when it changes, and not again when it does not', async () => {
  // Perturbation: dropping the signature check writes Core's record on every load.
  const { profile, storage, sources } = profileOf('core');
  await load(profile, storage);
  assert.equal(storage.writes.filter((key) => key === declaredKey(sources.core!.id)).length, 1);
  await load(profile, storage);
  assert.equal(storage.writes.filter((key) => key === declaredKey(sources.core!.id)).length, 1, 'unchanged: not written');
  sources.core!.excluded = [`${BASE}book.index`];
  await load(profile, storage);
  assert.equal(storage.writes.filter((key) => key === declaredKey(sources.core!.id)).length, 2, 'other parts: written');
  assert.deepEqual((await readDeclared(storage, sources.core!))?.ids, ['ID_LANGUAGE', 'ID_SKILL']);
});

test('removing a source removes its record', async () => {
  // Perturbation: leaving `removeDeclared` out of removeSource keeps both keys.
  const { profile, storage, sources } = profileOf('core');
  await load(profile, storage);
  await removeSource(profile, storage, sources.core!.id);
  assert.equal(await storage.read(declaredKey(sources.core!.id)), null);
  assert.equal(await storage.read(declaredSignatureKey(sources.core!.id)), null);
});

test('switchedOffSupply keeps the order of what is missing and lists an addition target once', () => {
  const supply = switchedOffSupply(
    { references: ['ID_A', 'ID_B', 'ID_C'], additions: ['ID_T', 'ID_T'] },
    [{ sourceId: 'x', record: { formatVersion: 1, excluded: [], ids: ['ID_C', 'ID_A', 'ID_T'] } }],
  );
  assert.deepEqual(supply, [{ sourceId: 'x', references: ['ID_A', 'ID_C'], additions: ['ID_T'] }]);
});
