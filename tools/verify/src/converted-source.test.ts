/**
 * ADR 0119 against the real corpus: a source is converted once into the file it is kept as, and loaded from the file.
 *
 * Asserted, against any corpus: the file read back is Incudo content by the schema, the second load reads nothing from
 * the disk, and it loads every element in the same order with the same content, and the same warnings and errors, as the
 * conversion it was written from. Reported (ADR 0042): the time of the conversion and of a load from the file, and the
 * file's size.
 *
 * And the converter's guard: the files whose change can change what a conversion produces, hashed. A change to them asks
 * whether `CONVERTER_VERSION` should move, since every source a user has was converted by the converter before.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CONVERTER_VERSION, auroraConverter } from '@incudo/aurora-import';
import { MemoryStorage, checkContentBundle, sha256Hex, type FetchResult, type Fetcher, type JsonSchema } from '@incudo/core';
import { loadSources, readSourceFile, type ConfiguredSource } from '@incudo/content';

import { corpusFetcher } from './corpus.ts';
import { repoRoot, schemasDirectory } from './node-system.ts';
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

test('a source loads from the file its conversion was kept as what the conversion made, reading nothing', { skip: corpusSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const location = requireCorpus();
  const fetcher = new CountingFetcher(corpusFetcher(location));
  const resolveByName = location.layout === 'aurora-folder';
  const source: ConfiguredSource = { id: location.index, url: location.index, name: 'Corpus', enabled: true, mode: 'download', addedAt: '2026-01-01T00:00:00.000Z' };
  const storage = new MemoryStorage();
  const platform = { fetcher, storage, resolveByName, converter: auroraConverter };

  let started = performance.now();
  const first = await loadSources([source], platform);
  const converting = performance.now() - started;
  const asked = fetcher.asked;
  assert.ok(asked > 0 && first.elementCount > 0, 'the first load converts the corpus');

  const kept = await readSourceFile(source, platform);
  assert.ok(kept);
  const schema = JSON.parse(await readFile(join(schemasDirectory(), 'content.schema.json'), 'utf8')) as JsonSchema;
  assert.deepEqual(checkContentBundle(kept, { schema }).problems, [], 'the kept file is Incudo content, by the schema');

  started = performance.now();
  const second = await loadSources([source], platform);
  const loading = performance.now() - started;
  // Perturbation: converting on every load reads the corpus again.
  assert.equal(fetcher.asked, asked, 'the second load reads nothing');
  // As JSON: the conversion's own objects carry fields set to undefined that its file, written as JSON, does not.
  const same = JSON.stringify([...second.elements.all()]) === JSON.stringify([...first.elements.all()]);
  assert.ok(same, 'the same elements, in the same order, with the same content');
  assert.deepEqual(second.warnings, first.warnings);
  assert.deepEqual(second.errors, first.errors);
  const size = JSON.stringify(kept).length;
  t.diagnostic(`converted in ${Math.round(converting)} ms (${asked} addresses), loaded from the file in ${Math.round(loading)} ms; the file is ${(size / 1024 / 1024).toFixed(1)} MB`);
});

/**
 * What a change to the converter's parsing or writing must answer: does the same Aurora file now convert into something
 * different? If so, `CONVERTER_VERSION` moves and every source is converted again. Recorded with the version they were
 * last read under.
 */
const CONVERTER_FILES = [
  'aurora-import/src/xml.ts',
  'aurora-import/src/parse-index.ts',
  'aurora-import/src/parse-elements.ts',
  'aurora-import/src/book.ts',
  'aurora-import/src/item-features.ts',
  'aurora-import/src/generated-elements.ts',
  'aurora-import/src/improvement-options.ts',
  'aurora-import/src/convert-source.ts',
  // The grammars the converter parses Aurora's attributes with, which are core's.
  'core/src/requirements.ts',
  'core/src/supports.ts',
  'core/src/expression.ts',
];
const RECORDED = { version: 7, sha256: 'faa70e509fd4af7a96251907cf83232e523f74e33c52c2c8f92fbd39cd642ce2' };

test('the converter files are the ones the recorded version was decided for', async (t: Diagnostic) => {
  const dir = join(repoRoot(), 'packages');
  // Line endings and the version's own line are left out: a checkout's endings, or the bump itself, change nothing.
  const texts = await Promise.all(
    CONVERTER_FILES.map(async (name) =>
      (await readFile(join(dir, name), 'utf8')).replace(/\r\n/g, '\n').replace(/^export const CONVERTER_VERSION = \d+;$/m, ''),
    ),
  );
  const hash = sha256Hex(new TextEncoder().encode(texts.join('\n\u0000\n')));
  t.diagnostic(`converter files sha256 ${hash}`);
  assert.equal(CONVERTER_VERSION, RECORDED.version, 'the version moved: record the hash below with it');
  assert.equal(
    hash,
    RECORDED.sha256,
    'A converter file changed. Does the same Aurora file now convert into something different? If so, bump CONVERTER_VERSION. Either way, record this hash and the version in RECORDED.',
  );
});
