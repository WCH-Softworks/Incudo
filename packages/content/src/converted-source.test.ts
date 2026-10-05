/**
 * ADR 0085: a source kept converted is parsed once, loaded from its conversion afterwards, and loads the same.
 *
 * Each case names the perturbation that fails it. The real corpus, loaded both ways, is `tools/verify`'s
 * `converted-source.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, type FetchResult, type Fetcher, type Storage } from '@incudo/core';

import { cacheKey } from './http-source.ts';
import { cachePrefix, refreshSource } from './compose.ts';
import { CONVERTER_VERSION, convertedKey, convertedPrefix, readConverted } from './converted-source.ts';
import { loadSources } from './load-sources.ts';
import { SourceProfile, type ConfiguredSource, type SourceKeep } from './profile.ts';

const INDEX_URL = 'https://example.test/core.index';

/** Two files, one appending a rule to an element the other declares, and a count of every request. */
class ContentFetcher implements Fetcher {
  readonly requested: string[] = [];
  offline = false;
  /** URLs that fail even when online. */
  readonly failing = new Set<string>();

  async fetchText(url: string): Promise<FetchResult> {
    if (this.offline || this.failing.has(url)) throw new Error(`offline: refused ${url}`);
    this.requested.push(url);
    if (url.endsWith('.index')) {
      return {
        url,
        text: `<?xml version="1.0"?><index><info><name>Core</name><update version="1.0.0" /></info><files>
          <file name="Widgets" url="widgets.xml" /><file name="Extras" url="extras.xml" /></files></index>`,
      };
    }
    if (url.endsWith('widgets.xml')) {
      return {
        url,
        text: `<?xml version="1.0"?><elements>
          <element name="Widget" type="Widget" source="Core" id="ID_WIDGET"><description><p>A widget.</p></description>
            <rules><stat name="speed" value="1" /></rules></element></elements>`,
      };
    }
    return {
      url,
      text: `<?xml version="1.0"?><elements>
        <element name="Gadget" type="Widget" source="Core" id="ID_GADGET"><description><p>A gadget.</p></description></element>
        <append id="ID_WIDGET"><rules><stat name="speed" value="2" /></rules></append></elements>`,
    };
  }
}

function configured(keep?: SourceKeep): ConfiguredSource {
  return new SourceProfile(new MemoryStorage()).add(INDEX_URL, { mode: 'download', ...(keep ? { keep } : {}) });
}

/** What a load gives, as data: every element in order, and the warnings and errors. */
async function load(source: ConfiguredSource, storage: MemoryStorage, fetcher: Fetcher) {
  const loaded = await loadSources([source], { fetcher, storage });
  return { elements: JSON.stringify(loaded.elements.all()), warnings: loaded.warnings, errors: loaded.errors };
}

test('a converted source loads from its conversion the second time, and loads the same', async () => {
  // Perturbation: dropping `finish` from loadSources writes no conversion, so the second load fetches again.
  const storage = new MemoryStorage();
  const fetcher = new ContentFetcher();
  const source = configured();
  const first = await load(source, storage, fetcher);
  assert.equal(fetcher.requested.length, 3);
  assert.ok(await readConverted(storage, source.id), 'a conversion was written');
  fetcher.offline = true;
  const second = await load(source, storage, fetcher);
  assert.deepEqual(second, first);
});

test('the conversion replaces the raw files it was made from', async () => {
  // Perturbation: not removing the raw copies in `finish` keeps every file twice.
  const storage = new MemoryStorage();
  const source = configured();
  await load(source, storage, new ContentFetcher());
  const keys = await storage.list(cachePrefix(source.id));
  assert.equal(keys.filter((key) => key.startsWith(convertedPrefix(source.id))).length, 3, 'the index and both files');
  assert.equal(keys.filter((key) => key.startsWith(cacheKey(source.id, ''))).filter((key) => !key.includes('/.')).length, 0);
});

test('an append is folded once, not again from the conversion', async () => {
  // Perturbation: recording a file after the library has folded appends into it (no JSON copy at answer time) makes
  // the converted Widget carry the appended rule twice.
  const storage = new MemoryStorage();
  const fetcher = new ContentFetcher();
  const source = configured();
  await load(source, storage, fetcher);
  const converted = await readConverted(storage, source.id);
  const widget = Object.values(converted!.files).flatMap((file) => file.elements).find((e) => e.id === 'ID_WIDGET')!;
  assert.equal(widget.rules.length, 1, 'stored as parsed, before the append');
  const again = await loadSources([source], { fetcher, storage });
  assert.equal(again.elements.get('ID_WIDGET')!.rules.length, 2, 'the append lands once on load');
});

test('a source kept as files writes no conversion, and drops one left from before', async () => {
  // Perturbation: `finish` for a files-kept source doing nothing leaves the old conversion answering first if the user
  // switches back.
  const storage = new MemoryStorage();
  const fetcher = new ContentFetcher();
  await load(configured(), storage, fetcher);
  const files = configured('files');
  await load(files, storage, fetcher);
  assert.deepEqual(await storage.list(convertedPrefix(files.id)), []);
  fetcher.offline = true;
  assert.equal((await loadSources([files], { fetcher, storage })).errors.length, 0, 'the raw files are back');
});

test('a conversion written by another converter is not read', async () => {
  // Perturbation: `readEntry` not comparing `converter` would answer from the old one, fetching nothing.
  const storage = new MemoryStorage();
  const fetcher = new ContentFetcher();
  const source = configured();
  await load(source, storage, fetcher);
  const key = convertedKey(source.id, 'https://example.test/widgets.xml');
  const stored = JSON.parse((await storage.read(key))!);
  await storage.write(key, JSON.stringify({ ...stored, converter: CONVERTER_VERSION + 1 }));
  fetcher.requested.length = 0;
  await load(source, storage, fetcher);
  assert.deepEqual(fetcher.requested, ['https://example.test/widgets.xml'], 'that file converted again from the network, and only it');
  assert.equal(JSON.parse((await storage.read(key))!).converter, CONVERTER_VERSION);
});

test('a refresh converts again, and a file it cannot reach is kept from the conversion', async () => {
  // Perturbation: the refresh's fallback without the conversion layer cannot keep extras.xml (its raw copy is gone) and
  // the refresh fails on it; and leaving the conversion untouched would keep answering with what was there before.
  const storage = new MemoryStorage();
  const fetcher = new ContentFetcher();
  const source = configured();
  const before = await load(source, storage, fetcher);
  fetcher.failing.add('https://example.test/extras.xml');
  const report = await refreshSource(source, { fetcher, storage });
  assert.deepEqual(report.kept.map((kept) => kept.url), ['https://example.test/extras.xml']);
  const converted = await readConverted(storage, source.id);
  assert.deepEqual(Object.keys(converted!.files).sort(), ['https://example.test/extras.xml', 'https://example.test/widgets.xml']);
  fetcher.offline = true;
  assert.deepEqual(await load(source, storage, fetcher), before);
});

test('a load that fetched one file converts that file and writes nothing else', async () => {
  // Perturbation: `finish` writing every answer, converted or not, rewrites the whole source on every load.
  const storage = new MemoryStorage();
  const fetcher = new ContentFetcher();
  const source = configured();
  await load(source, storage, fetcher);
  const writes: string[] = [];
  const write = storage.write.bind(storage);
  storage.write = async (key, value) => {
    writes.push(key);
    return write(key, value);
  };
  await load(source, storage, fetcher);
  assert.deepEqual(writes.filter((key) => key.includes('/.converted/')), []);
});

test('a conversion is written as one batch where the storage takes one', async () => {
  // Perturbation: `finish` writing one value at a time ignores `apply`, which on the phone is 1,600 commits (ADR 0085).
  const storage = new MemoryStorage();
  const batches: number[] = [];
  (storage as Storage).apply = async (changes) => {
    // The conversion's batches only: the record of what the source declared is a batch of its own (ADR 0090).
    if (changes.some(([key]) => key.startsWith(cachePrefix(INDEX_URL)))) batches.push(changes.length);
    for (const [key, value] of changes) {
      if (value === null) await storage.remove(key);
      else await storage.write(key, value);
    }
  };
  await load(configured(), storage, new ContentFetcher());
  assert.deepEqual(batches, [6], 'three values written and three raw copies removed, together');
});
