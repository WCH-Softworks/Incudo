/**
 * ADR 0085 against the real corpus: a source kept converted loads the same as one kept as files, and what each costs.
 *
 * Asserted, against any corpus: the converted load gives every element in the same order with the same content, and
 * the same warnings and errors, as a load that parses the files; and the second load reads nothing from the disk.
 * Reported (ADR 0042): the time of the first load, of a load from the files kept, and of a load from the conversion, and
 * the space each way of keeping takes.
 *
 * And the converter's guard: the files whose change can change what parsing produces, hashed. A change to them asks
 * whether `CONVERTER_VERSION` should move, since every conversion a user has was written by the parser before.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { MemoryStorage, sha256Hex, type FetchResult, type Fetcher } from '@incudo/core';
import { CONVERTER_VERSION, cachePrefix, convertedPrefix, loadSources, type ConfiguredSource, type SourceKeep } from '@incudo/content';

import { LocalMirrorFetcher, OfflineFetcher } from './node-platform.ts';
import { repoRoot } from './node-system.ts';
import { corpusProvenance, corpusSkip, requireCorpus } from './real-data.ts';

type Diagnostic = { diagnostic: (s: string) => void };

/** The corpus from disk, counting what it is asked for. */
class CountingFetcher implements Fetcher {
  readonly inner: Fetcher;
  asked = 0;
  constructor(inner: Fetcher) {
    this.inner = inner;
  }
  fetchText(url: string): Promise<FetchResult> {
    this.asked++;
    return this.inner.fetchText(url);
  }
}

const mb = (chars: number): string => `${(chars / 1024 / 1024).toFixed(1)} MB`;

async function storedSize(storage: MemoryStorage, prefix: string): Promise<number> {
  let total = 0;
  for (const key of await storage.list(prefix)) total += (await storage.read(key))!.length;
  return total;
}

test('a converted source loads what the files load, and the second time reads nothing', { skip: corpusSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const location = requireCorpus();
  // As `corpusSource` reads it: a checkout by URL path, an Aurora folder by name (docs/AURORA-FORMAT.md).
  const fetcher = new CountingFetcher(
    location.layout === 'repository'
      ? new LocalMirrorFetcher(location.root ?? dirname(location.index), new OfflineFetcher())
      : new OfflineFetcher(),
  );
  const resolveByName = location.layout === 'aurora-folder';
  const source = (keep: SourceKeep): ConfiguredSource => ({
    id: location.index,
    url: location.index,
    name: 'corpus',
    enabled: true,
    mode: 'download',
    keep,
    addedAt: '',
  });
  const run = async (keep: SourceKeep, storage: MemoryStorage) => {
    const started = performance.now();
    const loaded = await loadSources([source(keep)], { fetcher, storage, resolveByName });
    return {
      ms: Math.round(performance.now() - started),
      elements: JSON.stringify(loaded.elements.all()),
      count: loaded.elementCount,
      warnings: loaded.warnings,
      errors: loaded.errors,
    };
  };

  const files = new MemoryStorage();
  const fromDisk = await run('files', files);
  const fromFiles = await run('files', files);
  const converted = new MemoryStorage();
  const converting = await run('converted', converted);
  fetcher.asked = 0;
  const fromConversion = await run('converted', converted);

  assert.ok(fromDisk.count > 0, 'the corpus loaded');
  assert.equal(fetcher.asked, 0, 'a load from the conversion reads nothing from the disk');
  assert.equal(fromConversion.elements, fromDisk.elements, 'the same elements, in the same order, the same throughout');
  assert.deepEqual(fromConversion.warnings, fromDisk.warnings);
  assert.deepEqual(fromConversion.errors, fromDisk.errors);
  assert.equal(fromFiles.elements, fromDisk.elements);

  const prefix = cachePrefix(location.index);
  const conversion = await storedSize(converted, convertedPrefix(location.index));
  t.diagnostic(`${fromDisk.count} elements; first load from disk ${fromDisk.ms} ms, converting ${converting.ms} ms`);
  t.diagnostic(`a later load: from the files kept ${fromFiles.ms} ms, from the conversion ${fromConversion.ms} ms`);
  t.diagnostic(
    `kept as files ${mb(await storedSize(files, prefix))} in ${(await files.list(prefix)).length} values; ` +
      `converted ${mb(await storedSize(converted, prefix))} in ${(await converted.list(prefix)).length} values (the conversion ${mb(conversion)})`,
  );
});

/**
 * What parsing reads, and what it wrote when `CONVERTER_VERSION` last moved. When this fails: if the change makes the
 * same XML parse to something different, raise `CONVERTER_VERSION` in `packages/content/src/converted-source.ts`; either
 * way, record the new hash here.
 */
const PARSING_FILES = ['parse-elements.ts', 'parse-index.ts', 'xml.ts', 'book.ts', 'item-features.ts'];
const PARSED_BY = { converter: 4, sha256: '768ec64a3412d0e98f755cacbff30936c598b6bf9dc86439bf53e1e3afc63844' };

test("the converter's version is asked about whenever parsing changes", async () => {
  const root = join(repoRoot(), 'packages', 'aurora-import', 'src');
  const texts = await Promise.all(PARSING_FILES.map((name) => readFile(join(root, name), 'utf8')));
  // Line endings as git stores them, so a checkout with CRLF hashes the same.
  const hash = sha256Hex(new TextEncoder().encode(texts.map((text) => text.replace(/\r\n/g, '\n')).join('\0')));
  assert.equal(CONVERTER_VERSION, PARSED_BY.converter, 'CONVERTER_VERSION moved: record the hash below with it');
  assert.equal(
    hash,
    PARSED_BY.sha256,
    `@incudo/aurora-import's parsing changed (${PARSING_FILES.join(', ')}). If the same XML now parses differently, ` +
      'raise CONVERTER_VERSION; then record this hash in PARSED_BY.',
  );
});
