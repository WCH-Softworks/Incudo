/**
 * ADR 0051: a nested index is fetched as soon as the index naming it is read, and applied when the queue reaches it.
 *
 * The timing behind it (sixty indexes one at a time, about 13 s of a cold first load) is in the ADR and cannot be a
 * unit test. What can be is the two things the change must hold at once: the result is exactly what a load that waits
 * for nothing ahead of the queue produces, and the waiting is gone. The first is a comparison of two loads of the same
 * content, because a load that silently drops or reorders something keeps every count the same. Each test names the
 * perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ElementAppend } from '@incudo/aurora-import';
import type { Element } from '@incudo/core';
import { ContentLibrary, type LoadOptions } from './library.ts';
import type { ContentIndex, ContentSource, ElementFile, FileRef } from './source.ts';

function element(id: string, fileUrl: string, name = id): Element {
  return {
    id,
    type: 'Widget',
    name,
    source: 'test',
    setters: {},
    rules: [],
    supports: [],
    origin: { sourceId: 'test', format: 'incudo', fileUrl },
  };
}

const ref = (url: string): FileRef => ({ name: url, url, isIndex: url.endsWith('.index') });

/** Indexes by URL, each naming its files; element files by URL, each declaring its elements and appends. */
interface Tree {
  indexes: Record<string, string[]>;
  files: Record<string, { ids: string[]; appends?: ElementAppend[] }>;
  failing?: string[];
}

interface Log {
  started: string[];
  inFlight: number;
  maxInFlight: number;
  maxIndexesInFlight: number;
  indexesInFlight: number;
}

/**
 * A source over a tree, answering after `delay(url)` milliseconds. It records the order requests started in and how
 * many were in flight at once, indexes and all.
 */
function source(tree: Tree, delay: (url: string) => number = () => 0): { source: ContentSource; log: Log } {
  const log: Log = { started: [], inFlight: 0, maxInFlight: 0, maxIndexesInFlight: 0, indexesInFlight: 0 };
  const failing = new Set(tree.failing ?? []);
  const request = async <T>(url: string, answer: () => T): Promise<T> => {
    const isIndex = url.endsWith('.index');
    log.started.push(url);
    log.inFlight++;
    log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
    if (isIndex) {
      log.indexesInFlight++;
      log.maxIndexesInFlight = Math.max(log.maxIndexesInFlight, log.indexesInFlight);
    }
    try {
      const ms = delay(url);
      await (ms ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
      if (failing.has(url)) throw new Error('HTTP 404');
      return answer();
    } finally {
      log.inFlight--;
      if (isIndex) log.indexesInFlight--;
    }
  };
  return {
    log,
    source: {
      id: 'memory://tree',
      loadIndex: (url: string) =>
        request(url, (): ContentIndex => {
          const files = tree.indexes[url];
          if (!files) throw new Error(`No index at ${url}`);
          return { url, name: url, files: files.map(ref), format: 'incudo' };
        }),
      loadFile: (fileRef: FileRef) =>
        request(fileRef.url, (): ElementFile => {
          const file = tree.files[fileRef.url]!;
          return {
            url: fileRef.url,
            elements: file.ids.map((id) => element(id, fileRef.url)),
            appends: file.appends,
            diagnostics: [],
          };
        }),
      checkForUpdates: async () => ({ state: 'unknown', reason: 'test' }),
    },
  };
}

/** Everything a load produces that a caller can see, in the order it produced it. */
async function load(tree: Tree, delay?: (url: string) => number, options: LoadOptions = {}) {
  const { source: s, log } = source(tree, delay);
  const library = new ContentLibrary();
  const report = await library.loadSource(s, 'root.index', options);
  return {
    log,
    seen: {
      indexes: library.indexes.map((index) => index.url),
      elements: [...library.elements.all()].map((e) => [e.id, e.origin.fileUrl, e.rules.length]),
      diagnostics: library.diagnostics.map((d) => `${d.level}: ${d.message}`),
      filesLoaded: report.filesLoaded,
      fetched: [...new Set(log.started)].sort(),
    },
  };
}

/**
 * Three levels, the shape of AuroraLegacy's (a root naming books, books naming files), with the things whose order a
 * load decides: an id declared in two files, an append reaching into another book, an index named twice, one that
 * fails, and one past the depth limit.
 */
const TREE: Tree = {
  indexes: {
    'root.index': ['core.index', 'supplements.index', 'extra.index', 'root-a.xml'],
    'core.index': ['phb.index', 'dmg.index', 'core-a.xml'],
    'supplements.index': ['xge.index', 'phb.index', 'broken.index', 'supp-a.xml'],
    'extra.index': ['deep-1.index'],
    'deep-1.index': ['deep-2.index', 'deep-1.xml'],
    'deep-2.index': ['deep-3.index', 'deep-2.xml'],
    'deep-3.index': ['deep-3.xml'],
    'phb.index': ['phb-races.xml', 'phb-classes.xml'],
    'dmg.index': ['dmg-items.xml'],
    'xge.index': ['xge-races.xml', 'xge-appends.xml'],
  },
  files: {
    'root-a.xml': { ids: ['ID_ROOT'] },
    'core-a.xml': { ids: ['ID_CORE', 'ID_TWICE'] },
    'supp-a.xml': { ids: ['ID_SUPP'] },
    'deep-1.xml': { ids: ['ID_DEEP_1'] },
    'deep-2.xml': { ids: ['ID_DEEP_2'] },
    'deep-3.xml': { ids: ['ID_DEEP_3'] },
    'phb-races.xml': { ids: ['ID_ELF', 'ID_DWARF'] },
    'phb-classes.xml': { ids: ['ID_WIZARD'] },
    'dmg-items.xml': { ids: ['ID_SWORD', 'ID_TWICE'] },
    'xge-races.xml': { ids: ['ID_GOBLIN', 'ID_TWICE'] },
    'xge-appends.xml': {
      ids: [],
      appends: [
        {
          id: 'ID_WIZARD',
          rules: [{ kind: 'grant', type: 'Widget', id: 'ID_SWORD' }],
          supports: ['Extended'],
          fileUrl: 'xge-appends.xml',
        } as ElementAppend,
      ],
    },
  },
  failing: ['broken.index'],
};

/** Later-named things answer first, so completion order is the reverse of the queue's wherever it can be. */
const reversing = (url: string): number => 40 - (Object.keys(TREE.indexes).indexOf(url) + 1) * 3 - url.length % 5;

test('fetching indexes ahead of the queue changes nothing a load produces', async () => {
  // The reference waits for nothing ahead of the queue that it could not have: one request at a time, answered at
  // once. Perturbation: applying an index's children when its fetch finishes rather than when the queue reaches it
  // (pushing to `indexes` or the queue inside `prefetch`) reorders `indexes`, the elements and the duplicate warning.
  const reference = await load(TREE, undefined, { concurrency: 1, maxDepth: 3 });
  const ahead = await load(TREE, reversing, { maxDepth: 3 });

  assert.deepEqual(ahead.seen, reference.seen);

  // And the reference is the load the ADR describes, not an accident of both being wrong the same way.
  assert.deepEqual(reference.seen.indexes, [
    'root.index', 'core.index', 'supplements.index', 'extra.index', 'phb.index', 'dmg.index', 'xge.index', 'deep-1.index', 'deep-2.index',
  ]);
  assert.ok(reference.seen.diagnostics.some((d) => d.startsWith('error: Could not load broken.index')));
  assert.ok(reference.seen.diagnostics.some((d) => d.includes('Stopped at nesting depth 3: deep-3.index')));
  // `ID_TWICE` is settled by load order: the last file the queue applies wins, whichever answered last.
  const twice = ahead.seen.elements.find(([id]) => id === 'ID_TWICE');
  assert.equal(twice?.[1], 'xge-races.xml');
  // The append reached across books.
  assert.equal(ahead.seen.elements.find(([id]) => id === 'ID_WIZARD')?.[2], 1);
});

test('a load asks for exactly the files and indexes it would have, each once', async () => {
  // Perturbation: dropping the depth check from `prefetch` fetches deep-3.index, which the walk never loads; dropping
  // the map of fetches in flight asks for phb.index twice.
  const { log, seen } = await load(TREE, reversing, { maxDepth: 3 });
  assert.equal(log.started.length, new Set(log.started).size, 'nothing is fetched twice');
  assert.ok(!seen.fetched.includes('deep-3.index'), 'nothing past the depth limit is fetched');
  assert.ok(!seen.fetched.includes('deep-3.xml'));

  // `include` is honoured ahead of the queue too. Perturbation: dropping it from `prefetch`.
  const narrowed = await load(TREE, reversing, { include: (r) => r.url !== 'supplements.index' });
  assert.ok(!narrowed.log.started.includes('supplements.index'));
  assert.ok(!narrowed.log.started.includes('xge.index'));
});

test('indexes named by the same parent are asked for together, not one after another', async () => {
  // Perturbation: removing `prefetch` (the walk as it was) leaves one index in flight at a time.
  const wide: Tree = {
    indexes: {
      'root.index': ['a.index', 'b.index', 'c.index', 'd.index', 'e.index'],
      'a.index': ['a.xml'],
      'b.index': ['b.xml'],
      'c.index': ['c.xml'],
      'd.index': ['d.xml'],
      'e.index': ['e.xml'],
    },
    files: { 'a.xml': { ids: ['A'] }, 'b.xml': { ids: ['B'] }, 'c.xml': { ids: ['C'] }, 'd.xml': { ids: ['D'] }, 'e.xml': { ids: ['E'] } },
  };
  const { log } = await load(wide, () => 5);
  assert.equal(log.maxIndexesInFlight, 5);
});

test('an index is asked for before the files already waiting, and the limit holds for both together', async () => {
  // A book's index named after a run of files, and a nested index behind it: both are fetched before the files queued
  // ahead of them. Perturbation: making index fetches not urgent puts sub.index behind f1.xml; routing them around
  // the limiter lets more than `concurrency` requests out at once.
  const tree: Tree = {
    indexes: {
      'root.index': ['f1.xml', 'f2.xml', 'f3.xml', 'book.index'],
      'book.index': ['sub.index'],
      'sub.index': ['f4.xml'],
    },
    files: { 'f1.xml': { ids: ['F1'] }, 'f2.xml': { ids: ['F2'] }, 'f3.xml': { ids: ['F3'] }, 'f4.xml': { ids: ['F4'] } },
  };
  const { log } = await load(tree, () => 2, { concurrency: 1 });
  assert.deepEqual(log.started.slice(0, 4), ['root.index', 'book.index', 'sub.index', 'f1.xml']);
  assert.equal(log.maxInFlight, 1);

  const busy = await load(TREE, reversing, { concurrency: 3, maxDepth: 3 });
  assert.equal(busy.log.maxInFlight, 3);
});

test('an index that fails ahead of the queue is reported when the queue reaches it, and nothing else fails', async () => {
  // It fails long before the walk gets there. Perturbation: dropping the rejection handler in `prefetch` makes Node
  // report an unhandled rejection and fail this file.
  const tree: Tree = {
    indexes: { 'root.index': ['slow.xml', 'gone.index', 'fine.index'], 'fine.index': ['fine.xml'] },
    files: { 'slow.xml': { ids: ['SLOW'] }, 'fine.xml': { ids: ['FINE'] } },
    failing: ['gone.index'],
  };
  const { seen } = await load(tree, (url) => (url === 'slow.xml' ? 30 : 0));
  assert.deepEqual(seen.diagnostics, ['error: Could not load gone.index: HTTP 404']);
  assert.deepEqual(seen.elements.map(([id]) => id), ['SLOW', 'FINE']);
});
