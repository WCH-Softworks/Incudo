/**
 * ADR 0056: an Aurora elements file the user adds is a source of its own, kept as a copy in the app's storage.
 *
 * Each test names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage } from '@incudo/core';
import { checkSourceForUpdates, composeSource, evictSourceCache, refreshSource } from './compose.ts';
import { addFileSource, fileSourceKey, removeSource } from './file-source.ts';
import { ContentLibrary } from './library.ts';
import { SourceProfile } from './profile.ts';
import type { ContentSource } from './source.ts';

const HOMEBREW = `<?xml version="1.0" encoding="utf-8"?>
<elements>
  <info>
    <name>Homebrew Blades</name>
    <update version="1.2.0" />
  </info>
  <element name="Sword of Tests" type="Magic Item" source="Homebrew" id="ID_HB_SWORD_OF_TESTS">
    <description>
      <p>A sword.</p>
      <p>Sharp on both edges.</p>
    </description>
  </element>
  <append id="ID_SOMEONE_ELSES">
    <supports>Homebrew</supports>
  </append>
</elements>
`;

const INDEX = `<?xml version="1.0" encoding="utf-8"?>
<index>
  <info><name>Somebody's pack</name></info>
  <files><file name="a.xml" url="https://example.com/a.xml" /></files>
</index>
`;

const noNetwork = { fetchText: async () => Promise.reject(new Error('no network in this test')) };

async function setup() {
  const storage = new MemoryStorage();
  const profile = new SourceProfile(storage);
  return { storage, profile };
}

async function load(source: ContentSource, url: string) {
  const library = new ContentLibrary();
  const report = await library.loadSource(source, url);
  return { library, report };
}

test('a file becomes a source that loads from its copy, with no network at all', async () => {
  const { storage, profile } = await setup();
  const added = await addFileSource(profile, storage, { name: 'blades.xml', text: HOMEBREW }, { systemId: 'dnd5e' });
  assert.equal(added.source.url, 'local:blades.xml');
  assert.equal(added.source.name, 'Homebrew Blades');
  assert.equal(added.source.version, '1.2.0');
  assert.equal(added.source.systemId, 'dnd5e');
  assert.equal(added.elements, 1);
  assert.equal(added.additions, 1);

  const { library, report } = await load(composeSource(added.source, { fetcher: noNetwork, storage }), added.source.url);
  // Perturbation: composing a file source like an index at a URL asks the network and fails.
  assert.equal(report.filesLoaded, 1);
  assert.equal(report.index.version, '1.2.0');
  const sword = library.elements.get('ID_HB_SWORD_OF_TESTS');
  assert.equal(sword?.origin.sourceId, 'local:blades.xml');
  // The waiting append is carried like any other source's (ADR 0052 reports it against this source).
  assert.deepEqual(library.missingContent().get('local:blades.xml')?.additions, ['ID_SOMEONE_ELSES']);
});

test('adding a file of the same name replaces the copy and keeps the line as the user left it', async () => {
  const { storage, profile } = await setup();
  profile.add('https://example.com/core.index', { systemId: 'dnd5e' });
  await addFileSource(profile, storage, { name: 'blades.xml', text: HOMEBREW }, { systemId: 'dnd5e' });
  profile.update('local:blades.xml', { name: 'My blades', enabled: false });
  profile.add('https://example.com/later.index', { systemId: 'dnd5e' });

  const newer = HOMEBREW.replace('1.2.0', '1.3.0').replace('Sword of Tests', 'Sword of Retests');
  const again = await addFileSource(profile, storage, { name: 'blades.xml', text: newer }, { systemId: 'dnd5e' });
  assert.equal(again.replaced, true);
  // Perturbation: `profile.add` for a replacement renames it back to the file's own name.
  assert.equal(again.source.name, 'My blades');
  assert.equal(again.source.enabled, false);
  assert.equal(again.source.version, '1.3.0');
  assert.deepEqual(
    profile.sources.map((source) => source.id),
    ['https://example.com/core.index', 'local:blades.xml', 'https://example.com/later.index'],
  );
  assert.match((await storage.read(fileSourceKey('local:blades.xml')))!, /Sword of Retests/);
});

test('an index, or a file with no elements, is refused and nothing is written', async () => {
  const { storage, profile } = await setup();
  await assert.rejects(
    addFileSource(profile, storage, { name: 'pack.xml', text: INDEX }, { systemId: 'dnd5e' }),
    /is an index.*by its address/,
  );
  await assert.rejects(
    addFileSource(profile, storage, { name: 'notes.xml', text: '<notes><p>hello</p></notes>' }, { systemId: 'dnd5e' }),
    /holds no Aurora elements/,
  );
  await assert.rejects(
    addFileSource(profile, storage, { name: 'blades.txt', text: HOMEBREW }, { systemId: 'dnd5e' }),
    /not an \.xml file/,
  );
  assert.equal(profile.sources.length, 0);
  assert.deepEqual(await storage.list('sources/'), []);
});

test('a name another system holds is refused, as a URL is', async () => {
  const { storage, profile } = await setup();
  await addFileSource(profile, storage, { name: 'blades.xml', text: HOMEBREW }, { systemId: 'cairn' });
  await assert.rejects(
    addFileSource(
      profile,
      storage,
      { name: 'blades.xml', text: HOMEBREW.replace('1.2.0', '9') },
      { systemId: 'dnd5e', nameOfSystem: (id) => (id === 'cairn' ? 'Cairn' : id) },
    ),
    /already added under Cairn/,
  );
  // The copy the other system uses is untouched.
  assert.match((await storage.read(fileSourceKey('local:blades.xml')))!, /1\.2\.0/);
});

test('the copy is out of reach of every cache operation, and removing the source removes it', async () => {
  const { storage, profile } = await setup();
  const { source } = await addFileSource(profile, storage, { name: 'blades.xml', text: HOMEBREW }, { systemId: 'dnd5e' });
  // Perturbation: keeping the copy under the source's `content/` cache prefix loses it to an eviction.
  await evictSourceCache(storage, source.id);
  assert.ok(await storage.read(fileSourceKey(source.id)));

  assert.equal(await removeSource(profile, storage, source.id), true);
  assert.equal(await storage.read(fileSourceKey(source.id)), null);
  assert.equal(profile.find(source.id), undefined);
});

test('a file source has nothing upstream to check or refresh, and says so', async () => {
  const { storage, profile } = await setup();
  const { source } = await addFileSource(profile, storage, { name: 'blades.xml', text: HOMEBREW }, { systemId: 'dnd5e' });
  const status = await checkSourceForUpdates(source, { fetcher: noNetwork, storage });
  assert.equal(status.state, 'unknown');
  await assert.rejects(refreshSource(source, { fetcher: noNetwork, storage }), /file you added/);
  assert.ok(await storage.read(fileSourceKey(source.id)));
});

test('a copy that has gone missing fails the load with a sentence, not a crash', async () => {
  const { storage, profile } = await setup();
  const { source } = await addFileSource(profile, storage, { name: 'blades.xml', text: HOMEBREW }, { systemId: 'dnd5e' });
  await storage.remove(fileSourceKey(source.id));
  await assert.rejects(load(composeSource(source, { fetcher: noNetwork, storage }), source.url), /copy of this file is gone/);
});

test('CRLF line endings in a dropped file are read the same as LF', async () => {
  const { storage, profile } = await setup();
  const a = await addFileSource(profile, storage, { name: 'lf.xml', text: HOMEBREW }, { systemId: 'dnd5e' });
  const b = await addFileSource(profile, storage, { name: 'crlf.xml', text: HOMEBREW.replace(/\n/g, '\r\n') }, { systemId: 'dnd5e' });
  const one = (await load(composeSource(a.source, { fetcher: noNetwork, storage }), a.source.url)).library;
  const two = (await load(composeSource(b.source, { fetcher: noNetwork, storage }), b.source.url)).library;
  const description = one.elements.get('ID_HB_SWORD_OF_TESTS')!.description!;
  assert.match(description, /A sword\.<\/p>\n\s*<p>Sharp/);
  assert.equal(two.elements.get('ID_HB_SWORD_OF_TESTS')!.description, description);
});
