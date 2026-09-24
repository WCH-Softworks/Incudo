/**
 * The real corpus, split into the sources a user could add one by one, loads the same in either order.
 *
 * AuroraLegacy's top index names four groups (core, supplements, Unearthed Arcana, collaborations), and each can be
 * added as a source of its own. The app loads enabled sources into one library in the order they were added, and an
 * `<append>` used to be applied only within its own source's load: Tasha's added before core lost 51 support tags. Here
 * the groups are loaded as separate sources forwards and backwards and compared, element by element, with the whole
 * index loaded as one. `packages/content/src/appends.test.ts` holds each rule; this holds the 171 appends upstream has.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';

import { ContentLibrary, HttpContentSource } from '@incudo/content';
import type { Fetcher } from '@incudo/core';

import type { CorpusLocation } from './corpus.ts';
import { LocalMirrorFetcher, OfflineFetcher } from './node-platform.ts';
import { corpusProvenance, corpusSkip, requireCorpus } from './real-data.ts';

function fetcherFor(location: CorpusLocation): Fetcher {
  return location.layout === 'repository'
    ? new LocalMirrorFetcher(location.root ?? dirname(location.index), new OfflineFetcher())
    : new OfflineFetcher();
}

async function load(location: CorpusLocation, urls: string[]): Promise<ContentLibrary> {
  const fetcher = fetcherFor(location);
  const library = new ContentLibrary();
  for (const url of urls) {
    await library.loadSource(
      new HttpContentSource({ id: url, fetcher, resolveByName: location.layout === 'aurora-folder' }),
      url,
    );
  }
  return library;
}

/** Each element's tags and rules, sorted: which of two appends to one element folds first is the load order's to say. */
function shape(library: ContentLibrary, skip: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of library.elements.all()) {
    if (skip.has(e.id)) continue;
    const rules = e.rules.map((r) => JSON.stringify(r)).sort();
    out.set(e.id, `${e.origin.fileUrl ?? ''}\n${[...e.supports].sort().join(',')}\n${rules.join('\n')}`);
  }
  return out;
}

const missed = (library: ContentLibrary): number =>
  library.diagnostics.filter((d) => d.message.startsWith('An <append> targets')).length;

test('the corpus split into sources loads the same forwards, backwards and whole', { skip: corpusSkip }, async () => {
  const location = requireCorpus();
  const fetcher = fetcherFor(location);
  const top = await new HttpContentSource({ id: location.index, fetcher, resolveByName: location.layout === 'aurora-folder' }).loadIndex(location.index);
  const groups = top.files.filter((ref) => ref.isIndex).map((ref) => ref.url);
  assert.ok(groups.length > 1, 'the top index names more than one index to split it into');

  const whole = await load(location, [location.index]);
  const forwards = await load(location, groups);
  const backwards = await load(location, [...groups].reverse());

  // An id declared twice is settled by load order, "last one wins", and reversing the order is allowed to change which
  // file wins. Those ids, and only those, are left out of the backwards comparison.
  const duplicated = new Set(
    [...whole.diagnostics, ...backwards.diagnostics]
      .filter((d) => d.message.includes('is defined in more than one file'))
      .map((d) => d.elementId!),
  );
  console.log(`ℹ ${corpusProvenance()}`);
  console.log(`ℹ ${groups.length} sources, ${whole.size} elements, ${duplicated.size} id(s) declared twice`);

  assert.equal(missed(whole), 0, 'the whole corpus has no append without a target');
  assert.equal(missed(forwards), 0, 'forwards, no append goes without its target');
  assert.equal(missed(backwards), 0, 'backwards, no append goes without its target');
  assert.deepEqual(shape(forwards, new Set()), shape(whole, new Set()));
  assert.deepEqual(shape(backwards, duplicated), shape(whole, duplicated));
});
