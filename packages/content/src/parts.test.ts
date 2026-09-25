/**
 * ADR 0055: a source records the parts switched off, the load skips them, and the tree the user chooses from lists
 * exactly what a load would consider.
 *
 * The tree and the load are two walks of the same indexes, and the one property that matters is that they agree: a
 * chooser that shows a part the load never reads, or hides one it does, is a list of lies. So most of these compare the
 * tree with what a real `ContentLibrary` load of the same source read. Each names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Element } from '@incudo/core';
import { ContentLibrary } from './library.ts';
import { partsFilter, readIndexTree, type IndexTreeNode } from './parts.ts';
import type { ContentIndex, ContentSource, ElementFile, FileRef } from './source.ts';

function element(id: string, fileUrl: string): Element {
  return {
    id,
    type: 'Widget',
    name: id,
    source: 'test',
    setters: {},
    rules: [],
    supports: [],
    origin: { sourceId: 'test', format: 'incudo', fileUrl },
  };
}

/** Indexes by URL, each naming its parts in order. Every `.xml` declares one element named after its URL. */
function source(
  indexes: Record<string, string[]>,
  options: { failing?: string[]; delay?: (url: string) => number } = {},
): { source: ContentSource; read: string[] } {
  const read: string[] = [];
  const failing = new Set(options.failing ?? []);
  const wait = async (url: string): Promise<void> => {
    const ms = options.delay?.(url) ?? 0;
    if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
    if (failing.has(url)) throw new Error('HTTP 404');
  };
  const ref = (url: string): FileRef => ({ name: url.split('/').pop()!, url, isIndex: url.endsWith('.index') });
  return {
    read,
    source: {
      id: 'test',
      loadIndex: async (url: string): Promise<ContentIndex> => {
        read.push(url);
        await wait(url);
        const files = indexes[url];
        if (!files) throw new Error('HTTP 404');
        return { url, name: url.split('/').pop()!, files: files.map(ref), format: 'incudo' };
      },
      loadFile: async (fileRef: FileRef): Promise<ElementFile> => {
        read.push(fileRef.url);
        await wait(fileRef.url);
        return { url: fileRef.url, elements: [element(fileRef.url, fileRef.url)], diagnostics: [] };
      },
      checkForUpdates: async () => ({ state: 'unknown', reason: 'test' }),
    },
  };
}

/** The shape of AuroraLegacy's top: groups, books under them, and files listed beside nested indexes. */
const CORPUS: Record<string, string[]> = {
  'm://top.index': ['m://core.index', 'm://supplements.index', 'm://ua.index'],
  'm://core.index': ['m://core/phb.index', 'm://core/dmg.index', 'm://core/ale.xml', 'm://core/internal.xml'],
  'm://core/phb.index': ['m://core/phb/races.xml', 'm://core/phb/classes.xml', 'm://core/phb/portrait.png'],
  'm://core/dmg.index': ['m://core/dmg/items.xml'],
  'm://supplements.index': ['m://sup/tasha.index', 'm://sup/favored.xml'],
  'm://sup/tasha.index': ['m://sup/tasha/spells.xml', 'm://sup/tasha/feats.xml'],
  'm://ua.index': ['m://ua/2015.xml', 'm://ua/2016.xml', 'm://ua/old.index'],
  'm://ua/old.index': ['m://ua/old/a.xml'],
};

function flatten(node: IndexTreeNode, out: IndexTreeNode[] = []): IndexTreeNode[] {
  for (const child of node.children ?? []) {
    out.push(child);
    flatten(child, out);
  }
  return out;
}

/** The element files a real load of `url` reads, with the given parts switched off. */
async function loaded(indexes: Record<string, string[]>, url: string, excluded?: string[]): Promise<string[]> {
  const { source: s } = source(indexes);
  const library = new ContentLibrary();
  await library.loadSource(s, url, { include: partsFilter({ excluded }) });
  return [...library.elements.all()].map((element) => element.origin.fileUrl ?? '').sort();
}

test('the tree lists every index and element file a load reads, and nothing it does not', async () => {
  const tree = await readIndexTree(source(CORPUS).source, 'm://top.index');
  const files = flatten(tree).filter((node) => !node.isIndex).map((node) => node.url).sort();
  // Perturbation: dropping the load's element-file test lists the portrait, which no load reads.
  assert.deepEqual(files, await loaded(CORPUS, 'm://top.index'));
  assert.equal(flatten(tree).filter((node) => node.isIndex).length, 7);
});

test('a part two books both name is first where the load meets it first, however the reads finish', async () => {
  // The Player's Handbook (under Core) and Tasha's (under Supplements) both name one file. The load's queue reaches Core's
  // books before Supplements' books, so the Handbook's mention is the one it loads.
  const shared = {
    ...CORPUS,
    'm://core/phb.index': [...CORPUS['m://core/phb.index']!, 'm://shared.xml'],
    'm://sup/tasha.index': [...CORPUS['m://sup/tasha.index']!, 'm://shared.xml'],
  };
  // The later a URL sorts, the sooner it answers, so Tasha's is read long before the Handbook.
  const urls = Object.keys(shared).sort();
  const slow = source(shared, { delay: (url) => (urls.length - urls.indexOf(url)) * 3 }).source;
  const tree = await readIndexTree(slow, 'm://top.index', { concurrency: 8 });
  const first = flatten(tree).filter((node) => node.url === 'm://shared.xml').map((node) => !node.repeated);
  // Perturbation: expanding a level in the order its reads finished makes Tasha's mention the first.
  assert.deepEqual(first, [true, false]);
  const phb = flatten(tree).find((node) => node.url === 'm://core/phb.index')!;
  assert.ok(phb.children!.some((node) => node.url === 'm://shared.xml' && !node.repeated));
  // And the shape is the one a read one at a time gives.
  assert.deepEqual(
    flatten(tree).map((node) => [node.url, !!node.repeated]),
    flatten(await readIndexTree(source(shared).source, 'm://top.index', { concurrency: 1 })).map((node) => [
      node.url,
      !!node.repeated,
    ]),
  );
});

test('switching off an index skips it and everything under it, and nothing else', async () => {
  const all = await loaded(CORPUS, 'm://top.index');
  const withoutCore = await loaded(CORPUS, 'm://top.index', ['m://core.index']);
  const tree = await readIndexTree(source(CORPUS).source, 'm://top.index');
  const core = tree.children!.find((node) => node.url === 'm://core.index')!;
  const underCore = flatten(core).filter((node) => !node.isIndex).map((node) => node.url);
  // Perturbation: a filter that only skipped element files, never an index, loads all of it.
  assert.deepEqual(withoutCore, all.filter((url) => !underCore.includes(url)));
  assert.equal(underCore.length, 5);
});

test('switching off a single file skips only that file', async () => {
  const all = await loaded(CORPUS, 'm://top.index');
  const without = await loaded(CORPUS, 'm://top.index', ['m://ua/2015.xml']);
  assert.deepEqual(without, all.filter((url) => url !== 'm://ua/2015.xml'));
});

test('no parts switched off is no filter at all', () => {
  assert.equal(partsFilter({}), undefined);
  assert.equal(partsFilter({ excluded: [] }), undefined);
});

test('a switched-off index is not even read by the load', async () => {
  const { source: s, read } = source(CORPUS);
  await new ContentLibrary().loadSource(s, 'm://top.index', { include: partsFilter({ excluded: ['m://ua.index'] }) });
  // Perturbation: prefetching nested indexes past the filter reads it (ADR 0051's prefetch honours `include`).
  assert.ok(!read.includes('m://ua.index'));
  assert.ok(!read.includes('m://ua/old.index'));
});

test('a part named twice is listed once and marked where it repeats, as the load reads it once', async () => {
  const twice = { ...CORPUS, 'm://sup/tasha.index': [...CORPUS['m://sup/tasha.index']!, 'm://core/ale.xml'] };
  const tree = await readIndexTree(source(twice).source, 'm://top.index');
  const mentions = flatten(tree).filter((node) => node.url === 'm://core/ale.xml');
  assert.equal(mentions.length, 2);
  assert.deepEqual(
    mentions.map((node) => !!node.repeated),
    [false, true],
  );
  // A cycle is the same thing: the index naming its ancestor is marked, not walked forever.
  const cyclic = { ...CORPUS, 'm://ua/old.index': ['m://top.index'] };
  const cycle = await readIndexTree(source(cyclic).source, 'm://top.index');
  assert.ok(flatten(cycle).some((node) => node.url === 'm://top.index' && node.repeated));
});

test('an index that cannot be read is listed with the reason, and the rest of the tree is not lost', async () => {
  const tree = await readIndexTree(source(CORPUS, { failing: ['m://core/dmg.index'] }).source, 'm://top.index');
  const dmg = flatten(tree).find((node) => node.url === 'm://core/dmg.index')!;
  assert.equal(dmg.failed, 'HTTP 404');
  assert.equal(dmg.children, undefined);
  assert.ok(flatten(tree).some((node) => node.url === 'm://sup/tasha/spells.xml'));
  await assert.rejects(readIndexTree(source(CORPUS).source, 'm://nothing.index'), /HTTP 404/);
});

test('an index below the depth a load follows is marked and not read', async () => {
  const tree = await readIndexTree(source(CORPUS).source, 'm://top.index', { maxDepth: 1 });
  const phb = flatten(tree).find((node) => node.url === 'm://core/phb.index')!;
  assert.equal(phb.tooDeep, true);
  assert.equal(phb.children, undefined);
  // Perturbation: an off-by-one against the load's `depth >= maxDepth` lists files a load with the same limit skips.
  const library = new ContentLibrary();
  await library.loadSource(source(CORPUS).source, 'm://top.index', { maxDepth: 1 });
  const read = [...library.elements.all()].map((element) => element.origin.fileUrl).sort();
  assert.deepEqual(flatten(tree).filter((node) => !node.isIndex && !node.repeated).map((node) => node.url).sort(), read);
});

test('a refresh fetches only the parts in use, and prunes the cached copies of the rest', async () => {
  const { MemoryStorage } = await import('@incudo/core');
  const { composeSource, refreshSource } = await import('./compose.ts');
  const { cacheKey } = await import('./http-source.ts');
  const index = (name: string, files: string[]): string =>
    `<index><info><name>${name}</name></info><files>${files
      .map((url) => `<file name="${url.split('/').pop()}" url="${url}" />`)
      .join('')}</files></index>`;
  const elements = (id: string): string => `<elements><element name="${id}" type="Widget" source="t" id="${id}" /></elements>`;
  const served: Record<string, string> = {
    'https://h/top.index': index('Top', ['https://h/core.index', 'https://h/ua.index']),
    'https://h/core.index': index('Core', ['https://h/core/a.xml']),
    'https://h/ua.index': index('UA', ['https://h/ua/b.xml']),
    'https://h/core/a.xml': elements('ID_A'),
    'https://h/ua/b.xml': elements('ID_B'),
  };
  const asked: string[] = [];
  const fetcher = {
    fetchText: async (url: string) => {
      asked.push(url);
      const text = served[url];
      if (text === undefined) throw new Error('HTTP 404');
      return { url, text };
    },
  };
  const storage = new MemoryStorage();
  const configured = { id: 'https://h/top.index', url: 'https://h/top.index', name: 'Top', enabled: true, mode: 'download' as const, addedAt: '' };

  // Everything cached first, as a source loaded before any part was switched off.
  await new ContentLibrary().loadSource(composeSource(configured, { fetcher, storage }), configured.url);
  assert.ok(await storage.read(cacheKey(configured.id, 'https://h/ua/b.xml')));

  asked.length = 0;
  await refreshSource({ ...configured, excluded: ['https://h/ua.index'] }, { fetcher, storage });
  // Perturbation: a refresh without the parts filter fetches the switched-off index and its file, and keeps them.
  assert.ok(!asked.includes('https://h/ua.index'));
  assert.ok(!asked.includes('https://h/ua/b.xml'));
  assert.equal(await storage.read(cacheKey(configured.id, 'https://h/ua/b.xml')), null);
  assert.ok(await storage.read(cacheKey(configured.id, 'https://h/core/a.xml')));
});
