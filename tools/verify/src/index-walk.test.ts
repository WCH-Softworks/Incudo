/**
 * ADR 0051 on the real corpus: fetching indexes ahead of the queue loads exactly what walking them one at a time does.
 *
 * `packages/content/src/index-walk.test.ts` holds the rule on a tree written for it. This holds it where a mistake would
 * cost something: sixty indexes, 740 files, 171 appends reaching across files and one id declared twice. Two loads of
 * the same checkout, one with a single request in flight and every answer immediate, one at the default with every
 * answer delayed by an amount that has nothing to do with the order it was asked in. A count would not see a load
 * that applied one file's elements before another's; this compares every element, in order, and every diagnostic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Fetcher } from '@incudo/core';

import { loadCorpus, type LoadedCorpus } from './corpus.ts';
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

function seen(corpus: LoadedCorpus) {
  const { library } = corpus;
  return {
    indexes: library.indexes.map((index) => index.url),
    elements: [...library.elements.all()].map(
      (e) => `${e.id} ${e.origin.fileUrl ?? ''} ${e.rules.length} ${e.supports.join(',')}`,
    ),
    diagnostics: library.diagnostics.map((d) => `${d.level} ${d.message}`),
    filesLoaded: corpus.filesLoaded,
    generated: library.generatedElements,
  };
}

test('the corpus loads the same with its indexes fetched ahead as walked one at a time', { skip: corpusSkip }, async () => {
  const location = requireCorpus();
  const oneAtATime = await loadCorpus(location, { concurrency: 1 });
  const asked: string[] = [];
  const ahead = await loadCorpus(location, {
    wrap: (fetcher) => {
      const slow = delayed(fetcher);
      return { conditional: slow.conditional, fetchText: (url, options) => (asked.push(url), slow.fetchText(url, options)) };
    },
  });

  const reference = seen(oneAtATime);
  const subject = seen(ahead);
  console.log(`ℹ ${corpusProvenance()}`);
  console.log(`ℹ ${reference.indexes.length} indexes, ${reference.filesLoaded} files, ${reference.elements.length} elements`);

  assert.ok(reference.indexes.length > 1 && reference.filesLoaded > 0, 'the corpus loaded something');
  assert.equal(asked.length, new Set(asked).size, 'nothing is fetched twice');
  assert.equal(asked.length, reference.indexes.length + reference.filesLoaded, 'every index and file is fetched once');
  assert.deepEqual(subject.indexes, reference.indexes);
  assert.deepEqual(subject.diagnostics, reference.diagnostics);
  assert.equal(subject.generated, reference.generated);
  assert.equal(subject.filesLoaded, reference.filesLoaded);
  assert.deepEqual(subject.elements, reference.elements);
});
