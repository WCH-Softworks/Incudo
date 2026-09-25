/**
 * ADR 0052 on the real corpus: what each source is reported as missing, taken together, is what the whole load is
 * missing, and nothing else.
 *
 * `analyseCorpus` has counted grants to ids nothing declares since Phase 1, over the whole library at once; the
 * Sources pane now reports them per source. Two computations of one thing, compared for loads a user could make: the
 * whole index, one book on its own, and the index split into its groups as separate sources. Holds whatever upstream
 * does (ADR 0042): it asserts a relation, never a count.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';

import { ContentLibrary, HttpContentSource } from '@incudo/content';
import type { Fetcher } from '@incudo/core';

import { analyseCorpus, type CorpusLocation } from './corpus.ts';
import { LocalMirrorFetcher, OfflineFetcher } from './node-platform.ts';
import { corpusProvenance, corpusSkip, requireCorpus } from './real-data.ts';

function fetcherFor(location: CorpusLocation): Fetcher {
  return location.layout === 'repository'
    ? new LocalMirrorFetcher(location.root ?? dirname(location.index), new OfflineFetcher())
    : new OfflineFetcher();
}

function sourceFor(location: CorpusLocation, url: string): HttpContentSource {
  return new HttpContentSource({ id: url, fetcher: fetcherFor(location), resolveByName: location.layout === 'aurora-folder' });
}

async function load(location: CorpusLocation, urls: string[]): Promise<ContentLibrary> {
  const library = new ContentLibrary();
  for (const url of urls) await library.loadSource(sourceFor(location, url), url);
  return library;
}

function compare(library: ContentLibrary, sources: string[], label: string): { references: number; additions: number } {
  const report = library.missingContent();
  for (const sourceId of report.keys()) assert.ok(sources.includes(sourceId), `${label}: reported only against a source that was loaded (${sourceId})`);

  const reported = new Set([...report.values()].flatMap((m) => m.references));
  const whole = analyseCorpus({ location: { index: '', layout: 'repository' }, library, filesLoaded: 0, elementsLoaded: 0, elapsedMs: 0 });
  assert.deepEqual([...reported].sort(), whole.unresolved, `${label}: per source, together, is what the whole load is missing`);

  const additions = [...report.values()].reduce((n, m) => n + m.additions.length, 0);
  const warned = library.diagnostics.filter((d) => d.message.startsWith('An <append> targets')).length;
  assert.equal(additions, warned, `${label}: every addition still waiting is reported, and one per warning`);
  return { references: reported.size, additions };
}

test('what each source is reported as missing is, together, what the load is missing', { skip: corpusSkip }, async () => {
  const location = requireCorpus();
  const top = await sourceFor(location, location.index).loadIndex(location.index);
  const groups = top.files.filter((ref) => ref.isIndex).map((ref) => ref.url);
  console.log(`ℹ ${corpusProvenance()}`);

  const whole = compare(await load(location, [location.index]), [location.index], 'the whole index');
  const split = compare(await load(location, [...groups].reverse()), groups, 'its groups as sources, backwards');
  // One group on its own: whichever group the top index names last, which in AuroraLegacy leans on core.
  const alone = groups.at(-2) ?? groups[0]!;
  const one = compare(await load(location, [alone]), [alone], 'one group alone');
  console.log(`ℹ whole: ${whole.references} missing, ${whole.additions} waiting; split: ${split.references}, ${split.additions}; one group alone: ${one.references}, ${one.additions}`);
});
