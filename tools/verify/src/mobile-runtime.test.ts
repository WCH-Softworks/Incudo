/**
 * What a phone has to provide before the shared packages run on it — measured before ROADMAP Phase 6 chose anything.
 *
 * Report-only, ADR 0042 style: the numbers are printed as `ℹ` lines and nothing here pins one. Three questions:
 *
 * 1. **Which runtime features the shared packages reach for** (`core`, `content`, `aurora-import`, `ui`, tests left
 *    out), by a scan of their source. A phone's JavaScript engine is not a browser and not Node: a global the desktop
 *    never thinks about (`TextDecoder`, `CompressionStream`) may simply be absent there, and a regular expression
 *    feature may not parse. This says what to check on a device; the device says whether it is there.
 * 2. **How big a `.incu` is**, packed from every sample with `packCharacter`, and how long opening one with no source and
 *    building its sheet document takes here, as a scale for the phone.
 * 3. **What the content cache holds**: the bytes a full AuroraLegacy download keeps in `Storage`, the largest single
 *    value, and how long its keys are as the app writes them (`cacheKey(source URL, file URL)`), since a key that became
 *    a file name would meet a 255-byte limit.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { BundleElementIndex, readCharacterContainer, type Fetcher } from '@incudo/core';
import { cacheKey } from '@incudo/content';
import { CharacterBuilder, packCharacter, sheetDocument } from '@incudo/ui';

import { loadCorpus } from './corpus.ts';
import { repoRoot } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, requireCorpus, savesSkip } from './real-data.ts';
import { runOracle } from './aurora-oracle.ts';
import { readManifest, samplePath } from './sample-saves.ts';
import { nodeZipCodec } from './node-zip.ts';

const SHARED = ['core', 'content', 'aurora-import', 'ui'];

function sharedSources(): Map<string, string> {
  const out = new Map<string, string>();
  for (const pkg of SHARED) {
    const dir = join(repoRoot(), 'packages', pkg, 'src');
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      // Comments left out: sha256.ts explains why it does not use crypto.subtle or BigInt, which is not a use.
      const text = readFileSync(join(dir, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      out.set(`${pkg}/${name}`, text);
    }
  }
  return out;
}

/**
 * Each feature a JavaScript engine may lack, and how to spot it in source. Generous rather than exact: a match is a
 * place to look (comments are stripped first, string contents are not), which is why each line reports files.
 */
const FEATURES: [string, RegExp][] = [
  ['TextDecoder', /\bnew TextDecoder\b/g],
  ['TextEncoder', /\bnew TextEncoder\b/g],
  ['CompressionStream / DecompressionStream', /\bnew (?:De)?CompressionStream\b/g],
  ['crypto.subtle / getRandomValues / randomUUID / Math.random', /\bcrypto\.(?:subtle|getRandomValues|randomUUID)\b|\bMath\.random\(/g],
  ['structuredClone', /\bstructuredClone\(/g],
  ['Intl.*', /\bIntl\.\w+/g],
  ['String.prototype.localeCompare', /\.localeCompare\(/g],
  ['toLocale*String', /\.toLocale\w*String\(/g],
  ['Blob / Response / ReadableStream', /\bnew (?:Blob|Response|ReadableStream)\b/g],
  ['URL / URLSearchParams', /\bnew URL(?:SearchParams)?\(/g],
  ['fetch', /(?<![.\w])fetch\(/g],
  ['AbortController / AbortSignal', /\b(?:AbortController|AbortSignal)\b/g],
  ['setTimeout / queueMicrotask', /\b(?:setTimeout|queueMicrotask)\(/g],
  ['regex lookbehind', /\(\?<[=!]/g],
  ['regex named group', /\(\?<[A-Za-z]/g],
  ['regex Unicode property escape', /\\[pP]\{/g],
  ['regex flags with s, u, d or v', /\/[gimy]*[sudv][gimsuy]*(?=[.,);\s])/g],
  ['Array.prototype.at', /\.at\(-?\d/g],
  ['Array.prototype.findLast*', /\.findLast(?:Index)?\(/g],
  ['toSorted / toReversed / toSpliced / with', /\.(?:toSorted|toReversed|toSpliced)\(/g],
  ['Object.hasOwn', /\bObject\.hasOwn\(/g],
  ['Object.groupBy / Map.groupBy', /\b(?:Object|Map)\.groupBy\(/g],
  ['String.prototype.replaceAll', /\.replaceAll\(/g],
  ['String.prototype.matchAll', /\.matchAll\(/g],
  ['Array.prototype.flat / flatMap', /\.flat(?:Map)?\(/g],
  ['Promise.allSettled / any', /\bPromise\.(?:allSettled|any)\(/g],
  ['WeakRef / FinalizationRegistry', /\b(?:WeakRef|FinalizationRegistry)\b/g],
  ['BigInt', /\bBigInt\(|\b\d+n\b(?![.\w])/g],
  ['Symbol.asyncIterator / for await', /\bSymbol\.asyncIterator\b|\bfor await\b/g],
  ['process / Buffer / require (Node only)', /\b(?:process\.|Buffer\.|require\()/g],
  // `document.` alone would find every variable holding a sheet document.
  ['window / DOM document / navigator (browser only)', /\b(?:window|navigator)\.|\bdocument\.(?:create\w*|query\w*|body|getElement\w*)\b/g],
];

test('which runtime features the shared packages use', (t) => {
  const sources = sharedSources();
  t.diagnostic(`scanned ${sources.size} source files in packages/{${SHARED.join(',')}}/src, tests left out`);
  for (const [name, pattern] of FEATURES) {
    const files: string[] = [];
    let uses = 0;
    for (const [file, text] of sources) {
      const n = [...text.matchAll(pattern)].length;
      if (n) {
        files.push(`${file}×${n}`);
        uses += n;
      }
    }
    t.diagnostic(`${name}: ${uses ? `${uses} in ${files.length} file(s): ${files.join(' ')}` : 'none'}`);
  }
  assert.ok(sources.size > 0);
});

function quantiles(values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return `min ${sorted[0]}, median ${at(0.5)}, p90 ${at(0.9)}, max ${sorted[sorted.length - 1]}`;
}


test('the committed fixture container, the size of a character with no content to speak of', (t) => {
  const dir = join(repoRoot(), 'tools', 'verify', 'fixtures', 'aelin');
  let bytes = 0;
  for (const name of readdirSync(dir)) bytes += statSync(join(dir, name)).size;
  t.diagnostic(`tools/verify/fixtures/aelin (unpacked): ${bytes} bytes`);
  assert.ok(bytes > 0);
});

test('how big a packed .incu is, and how long opening one with no source takes here', { skip: corpusSkip || savesSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const zipped: number[] = [];
  const contentJson: number[] = [];
  const characterJson: number[] = [];
  const embedded: number[] = [];
  const openMs: number[] = [];
  const deflatedContent: number[] = [];
  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const state = new CharacterBuilder(run.imported.character, run.system, run.elements).getState();
    const packed = packCharacter(state.character, run.system, run.elements, { generator: 'measure', extraIds: run.imported.extraIds });
    const bytes = await nodeZipCodec.zip(packed.files);
    zipped.push(bytes.length);
    contentJson.push(packed.files.get('content.json')!.length);
    characterJson.push(packed.files.get('character.json')!.length);
    deflatedContent.push(deflateRawSync(packed.files.get('content.json')!).length);

    const started = performance.now();
    const files = await nodeZipCodec.unzip(bytes);
    const { container } = readCharacterContainer(files);
    embedded.push(container!.content.elements.length);
    const reopened = new CharacterBuilder(container!.character, run.system, new BundleElementIndex(container!.content.elements)).getState();
    sheetDocument(reopened);
    openMs.push(Math.round(performance.now() - started));
  }
  t.diagnostic(`samples packed: ${zipped.length}`);
  t.diagnostic(`.incu (zip) bytes: ${quantiles(zipped)}`);
  t.diagnostic(`content.json bytes: ${quantiles(contentJson)}; deflated: ${quantiles(deflatedContent)}`);
  t.diagnostic(`character.json bytes: ${quantiles(characterJson)}`);
  t.diagnostic(`embedded elements: ${quantiles(embedded)}`);
  t.diagnostic(`unzip + read + derive + sheet document, ms on this machine: ${quantiles(openMs)}`);
  assert.equal(zipped.length, readManifest().samples.length);
});

/** The URL the app adds AuroraLegacy by, and so the source id its cache keys start with (`apps/desktop/src/content.ts`). */
const AURORA_LEGACY_INDEX = 'https://raw.githubusercontent.com/AuroraLegacy/elements/master/core.index';

test('what a full AuroraLegacy download keeps in Storage', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const fetched = new Map<string, number>();
  const wrap = (inner: Fetcher): Fetcher => ({
    async fetchText(url, opts) {
      const result = await inner.fetchText(url, opts);
      fetched.set(url, new TextEncoder().encode(result.text).length);
      return result;
    },
  });
  const started = performance.now();
  await loadCorpus(requireCorpus(), { wrap });
  const elapsed = Math.round(performance.now() - started);
  const sizes = [...fetched.values()];
  const total = sizes.reduce((a, b) => a + b, 0);
  const keys = [...fetched.keys()].map((url) => cacheKey(AURORA_LEGACY_INDEX, url));
  const keyBytes = keys.map((k) => new TextEncoder().encode(k).length);
  const longest = keys[keyBytes.indexOf(Math.max(...keyBytes))]!;
  t.diagnostic(`files cached: ${sizes.length} (indexes and element files), total ${(total / 1024 / 1024).toFixed(2)} MB of UTF-8`);
  t.diagnostic(`value bytes per key: ${quantiles(sizes)}; over 1 MB: ${sizes.filter((n) => n > 1024 * 1024).length}; over 100 KB: ${sizes.filter((n) => n > 100 * 1024).length}`);
  t.diagnostic(`key bytes (cacheKey with the AuroraLegacy source URL): ${quantiles(keyBytes)}; over 255: ${keyBytes.filter((n) => n > 255).length}`);
  t.diagnostic(`the longest key: ${longest.length} characters`);
  t.diagnostic(`a load from disk here: ${elapsed} ms`);
  assert.ok(sizes.length > 0);
});
