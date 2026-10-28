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

import { parseAuroraIndex } from '@incudo/aurora-import';
import { ContentLibrary } from '@incudo/content';

import { convertCorpus, corpusFetcher, type CorpusLocation } from './corpus.ts';
import { corpusProvenance, corpusSkip, requireCorpus } from './real-data.ts';

async function load(location: CorpusLocation, urls: string[]): Promise<ContentLibrary> {
  const library = new ContentLibrary();
  for (const url of urls) library.loadBundle(url, (await convertCorpus(location, { url })).bundle);
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
  library.diagnostics.filter((d) => d.message.startsWith('An addition targets')).length;

test('the corpus split into sources loads the same forwards, backwards and whole', { skip: corpusSkip }, async (t) => {
  const location = requireCorpus();
  const top = parseAuroraIndex((await corpusFetcher(location).fetchText(location.index)).text, location.index, { resolveByName: location.layout === 'aurora-folder' });
  const groups = top.files.filter((ref) => ref.isIndex).map((ref) => ref.url);
  assert.ok(groups.length > 1, 'the top index names more than one index to split it into');

  const whole = await load(location, [location.index]);
  const forwards = await load(location, groups);
  const backwards = await load(location, [...groups].reverse());

  // An id declared twice is settled by load order, "last one wins", and reversing the order is allowed to change which
  // file wins. Those ids, and only those, are left out of the backwards comparison. Loaded whole, every one is a
  // warning, since the corpus is one source; split, one declared in two groups is two sources, and is reported as an
  // overlap on each (ADR 0054) instead.
  const redefined = (library: ContentLibrary): string[] =>
    library.diagnostics.filter((d) => d.message.includes('is defined in more than one file')).map((d) => d.elementId!);
  const duplicated = new Set(redefined(whole));
  const overlapping = new Set(
    [...backwards.sourceOverlaps().values()].flat().flatMap((overlap) => overlap.differ),
  );
  t.diagnostic(corpusProvenance());
  t.diagnostic(
    `${groups.length} sources, ${whole.size} elements, ${duplicated.size} id(s) declared twice, ${overlapping.size} of them differently in two sources`,
  );

  for (const id of overlapping) assert.ok(duplicated.has(id), `${id} overlaps across sources and is a warning loaded whole`);
  for (const id of redefined(backwards)) assert.ok(!overlapping.has(id), `${id} is an overlap, not also a warning`);

  assert.equal(missed(whole), 0, 'the whole corpus has no append without a target');
  assert.equal(missed(forwards), 0, 'forwards, no append goes without its target');
  assert.equal(missed(backwards), 0, 'backwards, no append goes without its target');
  assert.deepEqual(shape(forwards, new Set()), shape(whole, new Set()));
  assert.deepEqual(shape(backwards, duplicated), shape(whole, duplicated));
});
