/**
 * ADR 0056, and ADR 0119: an elements file the user adds is a source of its own, converted when it is added and kept
 * only as its conversion.
 *
 * Each test names the perturbation that fails it. What Aurora's converter refuses, and that it reads CRLF as LF, is
 * `@incudo/aurora-import`'s `convert-source.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage } from '@incudo/core';
import { checkSourceForUpdates, evictSourceCache, readSourceFile, refreshSource, sourceContent, type ComposeOptions } from './compose.ts';
import { addFileSource, fileSourceKey, removeSource } from './file-source.ts';
import { ContentLibrary } from './library.ts';
import { SourceProfile } from './profile.ts';
import { testConverter } from './test-bundle.ts';

const noNetwork = { fetchText: async () => Promise.reject(new Error('no network in this test')) };

function setup() {
  const storage = new MemoryStorage();
  const profile = new SourceProfile(storage);
  const platform: ComposeOptions = { fetcher: noNetwork, storage, converter: testConverter() };
  return { storage, profile, platform };
}

const BLADES = JSON.stringify(['ID_HB_SWORD', 'ID_HB_AXE']);

test('a file becomes a source that loads from its conversion, with no network at all', async () => {
  const { profile, platform } = setup();
  const added = await addFileSource(profile, platform, { name: 'blades.xml', text: BLADES }, { systemId: 'dnd5e' });
  assert.equal(added.source.url, 'local:blades.xml');
  assert.equal(added.source.name, 'blades');
  assert.equal(added.elements, 2);
  const library = new ContentLibrary();
  library.loadBundle(added.source.id, await sourceContent(added.source, platform));
  assert.equal(library.elements.get('ID_HB_SWORD')?.origin.sourceId, 'local:blades.xml');
});

test('adding a file of the same name replaces the conversion and keeps the line as the user left it', async () => {
  const { profile, platform } = setup();
  profile.add('https://example.com/core.index', { systemId: 'dnd5e' });
  await addFileSource(profile, platform, { name: 'blades.xml', text: BLADES }, { systemId: 'dnd5e' });
  profile.update('local:blades.xml', { name: 'My blades', enabled: false });
  profile.add('https://example.com/later.index', { systemId: 'dnd5e' });

  const again = await addFileSource(profile, platform, { name: 'blades.xml', text: JSON.stringify(['ID_HB_SPEAR']) }, { systemId: 'dnd5e' });
  assert.equal(again.replaced, true);
  // Perturbation: `profile.add` for a replacement renames it back to the file's own name.
  assert.equal(again.source.name, 'My blades');
  assert.equal(again.source.enabled, false);
  assert.deepEqual(profile.sources.map((source) => source.id), ['https://example.com/core.index', 'local:blades.xml', 'https://example.com/later.index']);
  assert.deepEqual((await readSourceFile(again.source, platform))!.elements.map((e) => e.id), ['ID_HB_SPEAR']);
});

test('what the converter refuses, or a name that is not .xml, adds nothing and writes nothing', async () => {
  const { storage, profile, platform } = setup();
  await assert.rejects(addFileSource(profile, platform, { name: 'empty.xml', text: '[]' }, { systemId: 'dnd5e' }), /holds no elements/);
  await assert.rejects(addFileSource(profile, platform, { name: 'blades.txt', text: BLADES }, { systemId: 'dnd5e' }), /not an \.xml file/);
  assert.equal(profile.sources.length, 0);
  assert.deepEqual(await storage.list(''), []);
});

test('a name another system holds is refused, and its conversion is untouched', async () => {
  const { profile, platform } = setup();
  const { source } = await addFileSource(profile, platform, { name: 'blades.xml', text: BLADES }, { systemId: 'cairn' });
  await assert.rejects(
    addFileSource(profile, platform, { name: 'blades.xml', text: '["ID_OTHER"]' }, { systemId: 'dnd5e', nameOfSystem: (id) => (id === 'cairn' ? 'Cairn' : id) }),
    /already added under Cairn/,
  );
  assert.deepEqual((await readSourceFile(source, platform))!.elements.map((e) => e.id), ['ID_HB_SWORD', 'ID_HB_AXE']);
});

test('the conversion is out of reach of an eviction, and removing the source removes it', async () => {
  const { storage, profile, platform } = setup();
  const { source } = await addFileSource(profile, platform, { name: 'blades.xml', text: BLADES }, { systemId: 'dnd5e' });
  await evictSourceCache(storage, source.id);
  assert.ok(await readSourceFile(source, platform));
  // Perturbation: removing only the profile line leaves the conversion behind.
  assert.equal(await removeSource(profile, platform, source.id), true);
  assert.equal(await readSourceFile(source, platform), undefined);
  assert.equal(profile.find(source.id), undefined);
});

test('a file source has nothing upstream to check or refresh, and says so', async () => {
  const { profile, platform } = setup();
  const { source } = await addFileSource(profile, platform, { name: 'blades.xml', text: BLADES }, { systemId: 'dnd5e' });
  assert.equal((await checkSourceForUpdates(source, platform)).state, 'unknown');
  await assert.rejects(refreshSource(source, platform), /file you added/);
});

test("a file a build before 1.0 added is converted from the text it kept, once, and the text removed", async () => {
  const { storage, profile, platform } = setup();
  const source = profile.add('local:old.xml', { kind: 'file', name: 'Old', systemId: 'dnd5e', mode: 'download' });
  await storage.write(fileSourceKey(source.id), BLADES);
  // Perturbation: reading only a conversion fails this source's load with "gone".
  assert.deepEqual((await sourceContent(source, platform)).elements.map((e) => e.id), ['ID_HB_SWORD', 'ID_HB_AXE']);
  assert.equal(await storage.read(fileSourceKey(source.id)), null);
  assert.ok(await readSourceFile(source, platform));
});

test('a conversion that has gone missing fails the load with a sentence, not a crash', async () => {
  const { profile, platform } = setup();
  const source = profile.add('local:gone.xml', { kind: 'file', name: 'Gone', systemId: 'dnd5e', mode: 'download' });
  await assert.rejects(sourceContent(source, platform), /copy of this file is gone/);
});
