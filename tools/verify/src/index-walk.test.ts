/**
 * ADR 0051 on the real corpus: fetching indexes ahead of the queue converts exactly what walking them one at a time does.
 *
 * `packages/aurora-import/src/convert-source.test.ts` holds the rule on a tree written for it. This holds it where a mistake would
 * cost something: sixty indexes, 740 files, 171 appends reaching across files and one id declared twice. Two loads of
 * the same checkout converted, one with a single request in flight and every answer immediate, one at the default with every
 * answer delayed by an amount that has nothing to do with the order it was asked in. A count would not see a conversion
 * that applied one file's elements before another's; this compares the whole converted source.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Fetcher } from '@incudo/core';

import { convertCorpus } from './corpus.ts';
import { corpusProvenance, corpusSkip, requireCorpus } from './real-data.ts';

/** A few milliseconds, fixed per URL and unrelated to the order it was asked in. */
function jitter(url: string): number {
  let hash = 0;
  for (let i = 0; i < url.length; i++) hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
  return hash % 5;
}

function delayed(fetcher: Fetcher): Fetcher {
  return {
    conditional: fetcher.conditional,
    async fetchText(url, options) {
      await new Promise((resolve) => setTimeout(resolve, jitter(url)));
      return fetcher.fetchText(url, options);
    },
  };
}

test('the corpus converts the same with its indexes fetched ahead as walked one at a time', { skip: corpusSkip }, async (t) => {
  const location = requireCorpus();
  const oneAtATime = await convertCorpus(location, { concurrency: 1 });
  const asked: string[] = [];
  const ahead = await convertCorpus(location, {
    wrap: (fetcher) => {
      const slow = delayed(fetcher);
      return { conditional: slow.conditional, fetchText: (url, options) => (asked.push(url), slow.fetchText(url, options)) };
    },
  });
  const files = oneAtATime.bundle.source!.files!.filter((file) => !file.generated).length;
  t.diagnostic(corpusProvenance());
  t.diagnostic(`${asked.length} addresses asked for, ${files} files, ${oneAtATime.bundle.elements.length} elements`);

  assert.ok(files > 0, 'the corpus converted something');
  assert.equal(asked.length, new Set(asked).size, 'nothing is fetched twice');
  assert.equal(oneAtATime.report.fetched, asked.length);
  // Perturbation: applying what arrives in the order it arrives reorders elements, files or the parts tree.
  assert.deepEqual(ahead.bundle, oneAtATime.bundle);
});
