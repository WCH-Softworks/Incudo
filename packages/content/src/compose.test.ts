/**
 * ADR 0119: a source at an address is converted once and kept as a file, and loaded from the file afterwards.
 *
 * Each test names the perturbation that fails it. The converter here is the package's test one (`test-bundle.ts`);
 * Aurora's own is tested in `@incudo/aurora-import`, and the real corpus through it in `tools/verify`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, StorageSourceFiles, type FetchResult, type Fetcher } from '@incudo/core';

import {
  cachePrefix,
  checkSourceForUpdates,
  readSourceFile,
  refreshSource,
  sourceContent,
  sourceFileName,
  sourceParts,
  type ComposeOptions,
} from './compose.ts';
import { loadSources } from './load-sources.ts';
import { SourceProfile, type ConfiguredSource } from './profile.ts';
import { testBundle, testConverter, testElement } from './test-bundle.ts';

const URL = 'https://example.test/book.index';

const BOOK = JSON.stringify(
  testBundle(
    URL,
    [
      { url: 'https://example.test/one.xml', elements: [testElement('ID_ONE')] },
      { url: 'https://example.test/two.xml', elements: [testElement('ID_TWO')] },
    ],
    { name: 'Book', version: '1.0.0' },
  ),
);

class Net implements Fetcher {
  conditional = true;
  asked: Array<{ url: string; etag?: string }> = [];
  down = false;
  body = BOOK;
  async fetchText(url: string, options?: { etag?: string }): Promise<FetchResult> {
    this.asked.push({ url, ...(options?.etag ? { etag: options.etag } : {}) });
    if (this.down) throw new Error('offline');
    if (options?.etag === '"v1"' && this.body === BOOK) return { url, text: '', notModified: true };
    return { url, text: this.body, etag: '"v1"' };
  }
}

function setup(version = 1) {
  const storage = new MemoryStorage();
  const profile = new SourceProfile(storage);
  const source = profile.add(URL, { name: 'Book', mode: 'download' });
  const net = new Net();
  const options: ComposeOptions = { fetcher: net, storage, converter: testConverter(version) };
  return { storage, source, net, options };
}

test('the first load converts the source and keeps it as a file, and the next reads only the file', async () => {
  const { source, net, options } = setup();
  const first = await sourceContent(source, options);
  assert.deepEqual(first.elements.map((e) => e.id), ['ID_ONE', 'ID_TWO']);
  assert.ok(await readSourceFile(source, options), 'the file is written');
  net.asked = [];
  net.down = true;
  // Perturbation: converting on every load asks the network, which is down.
  const second = await sourceContent(source, options);
  assert.deepEqual(second, first);
  assert.deepEqual(net.asked, []);
});

test('a conversion another converter wrote is converted again, and kept when that cannot be done', async () => {
  const { source, net, options } = setup(1);
  await sourceContent(source, options);
  const newer: ComposeOptions = { ...options, converter: testConverter(2) };
  net.down = true;
  // Offline: the old conversion is still Incudo content, and loads.
  assert.equal((await sourceContent(source, newer)).source?.converted?.converter, 1);
  net.down = false;
  net.asked = [];
  // Perturbation: reading any conversion as current never converts again.
  assert.equal((await sourceContent(source, newer)).source?.converted?.converter, 2);
  assert.equal(net.asked.length, 1);
});

test('a source never converted, with no network, fails with the reason', async () => {
  const { source, net, options } = setup();
  net.down = true;
  await assert.rejects(sourceContent(source, options), /offline/);
});

test('what a build before 1.0 kept for the source is removed once its file is written', async () => {
  const { storage, source, options } = setup();
  await storage.write(`${cachePrefix(source.id)}${encodeURIComponent('https://example.test/one.xml')}`, '<elements/>');
  await storage.write(`${cachePrefix(source.id)}.converted/x`, '{}');
  await storage.write('content/another/kept', 'not this source');
  await sourceContent(source, options);
  // Perturbation: not clearing the prefix leaves both keys.
  assert.deepEqual(await storage.list(cachePrefix(source.id)), []);
  assert.equal(await storage.read('content/another/kept'), 'not this source');
});

test('a refresh converts again from the network, and with none changes nothing', async () => {
  const { source, net, options } = setup();
  await sourceContent(source, options);
  net.body = JSON.stringify(testBundle(URL, [{ url: 'https://example.test/one.xml', elements: [testElement('ID_ONE'), testElement('ID_THREE')] }], { name: 'Book', version: '1.1.0' }));
  const report = await refreshSource(source, options);
  assert.equal(report.version, '1.1.0');
  assert.equal(report.removed, 1, 'two.xml is no longer named');
  assert.deepEqual((await readSourceFile(source, options))!.elements.map((e) => e.id), ['ID_ONE', 'ID_THREE']);

  net.down = true;
  const before = await readSourceFile(source, options);
  const offline = await refreshSource(source, options);
  assert.equal(offline.kept.length, 1);
  assert.deepEqual(await readSourceFile(source, options), before);
});

test('an update check asks with each ETag the conversion recorded, and writes nothing', async () => {
  const { storage, source, net, options } = setup();
  await sourceContent(source, options);
  const keys = await storage.list('');
  net.asked = [];
  assert.deepEqual(await checkSourceForUpdates(source, options), { state: 'current', basis: 'files', checked: 1, unanswered: 0 });
  assert.deepEqual(net.asked, [{ url: URL, etag: '"v1"' }]);
  net.body = BOOK.replace('1.0.0', '1.1.0');
  assert.equal((await checkSourceForUpdates(source, options)).state, 'outdated');
  assert.deepEqual(await storage.list(''), keys, 'nothing is written');
});

test('without conditional requests an update check compares the version the source declares', async () => {
  const { source, net, options } = setup();
  await sourceContent(source, options);
  net.conditional = false;
  net.body = BOOK.replace('1.0.0', '1.1.0');
  assert.deepEqual(await checkSourceForUpdates(source, options), { state: 'outdated', basis: 'version', local: '1.0.0', remote: '1.1.0' });
});

test("a source's file name is plain, readable, stable and its own", () => {
  const a = sourceFileName({ id: URL, url: URL });
  assert.match(a, /^book-[0-9a-f]{8}\.json$/);
  assert.equal(sourceFileName({ id: URL, url: URL }), a);
  // Perturbation: naming by the address's last part alone gives two sources ending in book.index one file.
  assert.notEqual(sourceFileName({ id: 'https://other.test/book.index', url: 'https://other.test/book.index' }), a);
});

test('the parts tree is read from the file, and switching a part off loads without the network', async () => {
  const { storage, source, net, options } = setup();
  const parts = await sourceParts(source, options);
  assert.deepEqual(parts.children!.map((p) => p.url), ['https://example.test/one.xml', 'https://example.test/two.xml']);
  net.down = true;
  const off: ConfiguredSource = { ...source, excluded: ['https://example.test/two.xml'] };
  const loaded = await loadSources([off], { ...options, files: new StorageSourceFiles(storage) });
  assert.deepEqual([...loaded.elements.all()].map((e) => e.id), ['ID_ONE']);
  assert.deepEqual(loaded.errors, []);
});
