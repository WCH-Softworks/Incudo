/**
 * ADR 0050: an update check asks every cached file, and a refresh keeps what it cannot reach.
 *
 * The host measurement behind it (a strong ETag, a 304 with no body, a refused preflight) is in the ADR and
 * cannot be a unit test. What can be is the behaviour: which requests carry an ETag, what a 304 costs, what a
 * check writes, and what a refresh keeps, replaces and removes. Each test names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, type FetchOptions, type FetchResult, type Fetcher } from '@incudo/core';

import { cachePrefix, checkSourceForUpdates, composeSource, refreshSource, writeVersionStamp } from './compose.ts';
import { etagKey, etagPrefix } from './http-source.ts';
import { ContentLibrary } from './library.ts';
import { SourceProfile, type ConfiguredSource } from './profile.ts';

const INDEX_URL = 'https://example.test/core.index';
const url = (name: string): string => new URL(name, INDEX_URL).href;

function elements(id: string, name: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<elements>',
    `  <element name="${name}" type="Widget" source="Core" id="${id}"><rules /></element>`,
    '</elements>',
  ].join('\n');
}

/**
 * A host with files, ETags and 304s, like raw.githubusercontent.com measured in the ADR. The ETag is the text
 * itself with a revision number, so a changed file gets a new one. It counts full downloads, 304s and every
 * ETag it was sent, and can be told to fail some URLs or all of them.
 */
class Host implements Fetcher {
  readonly conditional: boolean;
  readonly files = new Map<string, string>();
  readonly downloads: string[] = [];
  readonly notModified: string[] = [];
  readonly sentEtags: string[] = [];
  offline = false;
  readonly failing = new Set<string>();

  constructor(conditional: boolean) {
    this.conditional = conditional;
    this.setIndex(['widgets.xml', 'gadgets.xml']);
    this.files.set(url('widgets.xml'), elements('ID_WIDGET', 'Widget'));
    this.files.set(url('gadgets.xml'), elements('ID_GADGET', 'Gadget'));
  }

  setIndex(files: string[]): void {
    this.files.set(
      INDEX_URL,
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<index>',
        '  <info><name>Core</name><update version="0.0.1" /></info>',
        '  <files>',
        ...files.map((f) => `    <file name="${f}" url="${f}" />`),
        '  </files>',
        '</index>',
      ].join('\n'),
    );
  }

  etagOf(text: string): string {
    let hash = 0;
    for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return `"${hash}"`;
  }

  async fetchText(requested: string, opts?: FetchOptions): Promise<FetchResult> {
    if (this.offline || this.failing.has(requested)) throw new Error(`unreachable: ${requested}`);
    const text = this.files.get(requested);
    if (text === undefined) throw new Error(`HTTP 404 for ${requested}`);
    if (opts?.etag !== undefined) this.sentEtags.push(requested);
    const etag = this.etagOf(text);
    if (this.conditional && opts?.etag === etag) {
      this.notModified.push(requested);
      return { url: requested, text: '', notModified: true };
    }
    this.downloads.push(requested);
    return { url: requested, text, etag: this.conditional ? etag : undefined };
  }
}

function configured(): ConfiguredSource {
  return new SourceProfile(new MemoryStorage()).add(INDEX_URL, { mode: 'stream' });
}

async function load(source: ConfiguredSource, host: Host, storage: MemoryStorage): Promise<ContentLibrary> {
  const library = new ContentLibrary();
  await library.loadSource(composeSource(source, { fetcher: host, storage }), INDEX_URL);
  await writeVersionStamp(storage, source.id, '0.0.1');
  return library;
}

async function snapshot(storage: MemoryStorage): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const key of (await storage.list('')).sort()) out[key] = await storage.read(key);
  return out;
}

test('a conditional fetcher leaves an ETag beside every cached file, and any other leaves none', async () => {
  const source = configured();
  const conditional = new MemoryStorage();
  await load(source, new Host(true), conditional);
  // Perturbation: not writing the ETag through leaves nothing for a check or a refresh to ask with.
  assert.equal((await conditional.list(etagPrefix(source.id))).length, 3, 'the index and both files');

  const plain = new MemoryStorage();
  await load(source, new Host(false), plain);
  assert.deepEqual(await plain.list(etagPrefix(source.id)), []);
});

test('an update check asks every cached file, counts what changed, and writes nothing', async () => {
  const source = configured();
  const host = new Host(true);
  const storage = new MemoryStorage();
  await load(source, host, storage);
  const before = await snapshot(storage);

  // The index version never moves here, as AuroraLegacy's has not since 2023: the version check says current.
  assert.deepEqual(await checkSourceForUpdates(source, { fetcher: host, storage }), {
    state: 'current',
    basis: 'files',
    checked: 3,
    unanswered: 0,
  });

  host.files.set(url('gadgets.xml'), elements('ID_GADGET', 'Better Gadget'));
  // Perturbation: comparing only the index version reports this as current.
  assert.deepEqual(await checkSourceForUpdates(source, { fetcher: host, storage }), {
    state: 'outdated',
    basis: 'files',
    checked: 3,
    changed: 1,
    unanswered: 0,
  });
  // Perturbation: a check that wrote through would have replaced the gadget's text and ETag.
  assert.deepEqual(await snapshot(storage), before);
});

test('a check that reaches some files says how many it could not, and one that reaches none cannot tell', async () => {
  const source = configured();
  const host = new Host(true);
  const storage = new MemoryStorage();
  await load(source, host, storage);

  host.failing.add(url('gadgets.xml'));
  const partial = await checkSourceForUpdates(source, { fetcher: host, storage });
  assert.equal(partial.state, 'current');
  assert.equal((partial as { unanswered?: number }).unanswered, 1);

  host.offline = true;
  const none = await checkSourceForUpdates(source, { fetcher: host, storage });
  assert.equal(none.state, 'unknown');
});

test('a fetcher that cannot make a conditional request is never handed an ETag', async () => {
  // The browser build: sending If-None-Match there needs a preflight the host refuses (ADR 0050).
  const source = configured();
  const storage = new MemoryStorage();
  await load(source, new Host(true), storage); // ETags cached, as a Tauri session would leave them
  const browser = new Host(false);
  await refreshSource(source, { fetcher: browser, storage });
  const status = await checkSourceForUpdates(source, { fetcher: browser, storage });
  // Perturbation: sending the cached ETag regardless puts every URL in `sentEtags`.
  assert.deepEqual(browser.sentEtags, []);
  assert.equal(status.state !== 'unknown' && status.basis, 'version');
});

test('a refresh downloads only what changed and keeps the rest without downloading it', async () => {
  const source = configured();
  const host = new Host(true);
  const storage = new MemoryStorage();
  await load(source, host, storage);
  host.downloads.length = 0;

  host.files.set(url('gadgets.xml'), elements('ID_GADGET', 'Better Gadget'));
  const report = await refreshSource(source, { fetcher: host, storage });
  // Perturbation: ADR 0029's evict-then-reload downloads all three.
  assert.deepEqual(host.downloads, [url('gadgets.xml')]);
  assert.equal(report.fetched, 1);
  assert.equal(report.unchanged, 2);
  assert.deepEqual(report.kept, []);

  const reloaded = await load(source, host, storage);
  assert.equal(reloaded.elements.get('ID_GADGET')?.name, 'Better Gadget');
});

test('a refresh with no network keeps every cached file and changes nothing', async () => {
  const source = configured();
  const host = new Host(true);
  const storage = new MemoryStorage();
  await load(source, host, storage);
  const before = await snapshot(storage);

  host.offline = true;
  const report = await refreshSource(source, { fetcher: host, storage });
  // Perturbation: evicting first, as ADR 0029 did, leaves nothing to load and throws.
  assert.equal(report.kept.length, 3);
  assert.match(report.kept[0]!.reason, /unreachable/);
  assert.equal(report.removed, 0);
  assert.deepEqual(await snapshot(storage), before);
  assert.equal((await load(source, host, storage)).elements.get('ID_WIDGET')?.name, 'Widget');
});

test('a refresh removes a cached file the index no longer names, and nothing when the index is unreachable', async () => {
  const source = configured();
  const host = new Host(true);
  const storage = new MemoryStorage();
  await load(source, host, storage);

  host.setIndex(['widgets.xml']);
  const report = await refreshSource(source, { fetcher: host, storage });
  // Perturbation: skipping the prune leaves gadgets.xml cached forever.
  assert.equal(report.removed, 1);
  const keys = await storage.list(cachePrefix(source.id));
  assert.equal(keys.some((key) => key.includes(encodeURIComponent(url('gadgets.xml')))), false);
  assert.equal(await storage.read(etagKey(source.id, url('gadgets.xml'))), null);

  // With neither the network nor a cached index there is nothing to go on, and nothing is removed.
  const empty = new MemoryStorage();
  await empty.write(`${cachePrefix(source.id)}stray`, 'kept');
  host.offline = true;
  await assert.rejects(refreshSource(source, { fetcher: host, storage: empty }));
  assert.equal(await empty.read(`${cachePrefix(source.id)}stray`), 'kept');
});
