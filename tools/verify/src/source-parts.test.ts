/**
 * ADR 0055 and ADR 0056 on the real corpus.
 *
 * `packages/content/src/parts.test.ts` and `file-source.test.ts` hold the rules on content written for them. This holds
 * them where a mismatch would cost something: sixty indexes, 740 files and three indexes that list files beside nested
 * ones. The tree a user chooses from must be exactly what a load reads, request for request; switching a book off must
 * drop that book's files and nothing else; and a file of the corpus added on its own must load to what the corpus load
 * made of it. No count is pinned: the corpus moves (ADR 0042), and each figure is printed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ContentLibrary,
  addFileSource,
  composeSource,
  readIndexTree,
  SourceProfile,
  type IndexTreeNode,
} from '@incudo/content';
import { MemoryStorage, type Fetcher } from '@incudo/core';

import { corpusSource, loadCorpus } from './corpus.ts';
import { corpusProvenance, corpusSkip, requireCorpus } from './real-data.ts';

function flatten(node: IndexTreeNode, out: IndexTreeNode[] = []): IndexTreeNode[] {
  for (const child of node.children ?? []) {
    out.push(child);
    flatten(child, out);
  }
  return out;
}

/** A fetcher that records every URL asked of it. */
function recording(asked: string[]): (fetcher: Fetcher) => Fetcher {
  return (fetcher) => ({
    conditional: fetcher.conditional,
    fetchText: (url, options) => (asked.push(url), fetcher.fetchText(url, options)),
  });
}

test('the tree of parts is exactly what a load of the corpus reads', { skip: corpusSkip }, async (t) => {
  const location = requireCorpus();
  t.diagnostic(corpusProvenance());
  const started = Date.now();
  const tree = await readIndexTree(corpusSource(location), location.index);
  const elapsed = Date.now() - started;

  const asked: string[] = [];
  const full = await loadCorpus(location, { wrap: recording(asked) });

  const parts = flatten(tree).filter((node) => !node.repeated);
  const listed = [location.index, ...parts.map((node) => node.url)].sort();
  // Perturbation: listing a ref the load skips (a non-element file) or skipping one it reads fails this.
  assert.deepEqual(listed, [...new Set(asked)].sort());
  const files = parts.filter((node) => !node.isIndex).length;
  assert.equal(files, full.filesLoaded);
  assert.ok(parts.every((node) => !node.failed && !node.tooDeep));
  t.diagnostic(
    `tree: ${parts.filter((node) => node.isIndex).length} nested indexes, ${files} element files, ` +
      `${flatten(tree).filter((node) => node.repeated).length} named twice, read in ${elapsed} ms`,
  );
});

test('switching a book off drops exactly its files from the load', { skip: corpusSkip }, async (t) => {
  const location = requireCorpus();
  const tree = await readIndexTree(corpusSource(location), location.index);
  // The group with the most books, and its first book: found by shape, never by name.
  const group = [...(tree.children ?? [])]
    .filter((node) => node.isIndex)
    .sort((a, b) => (b.children?.filter((c) => c.isIndex).length ?? 0) - (a.children?.filter((c) => c.isIndex).length ?? 0))[0]!;
  const book = group.children!.find((node) => node.isIndex && node.children?.length)!;
  const bookFiles = new Set(flatten(book).filter((node) => !node.isIndex).map((node) => node.url));

  const full = await loadCorpus(location);
  const without = await loadCorpus(location, { excluded: [book.url] });
  assert.equal(without.filesLoaded, full.filesLoaded - bookFiles.size);

  const fromFiles = (corpus: typeof full): Set<string> =>
    new Set([...corpus.library.elements.all()].map((element) => element.origin.fileUrl ?? ''));
  const before = fromFiles(full);
  const after = fromFiles(without);
  // Perturbation: an exclusion that only skipped the index itself, not what it names, leaves every file in.
  for (const url of bookFiles) assert.ok(!after.has(url), `${url} is still loaded`);
  for (const url of before) if (!bookFiles.has(url)) assert.ok(after.has(url), `${url} went missing`);
  t.diagnostic(`switched off ${book.title ?? book.name} (${bookFiles.size} files): ${full.filesLoaded} files became ${without.filesLoaded}`);
});

test('a corpus file added on its own loads to what the corpus load made of it', { skip: corpusSkip }, async (t) => {
  const location = requireCorpus();
  let disk: Fetcher | undefined;
  const tree = await readIndexTree(
    corpusSource(location, (fetcher) => (disk = fetcher)),
    location.index,
  );
  const full = await loadCorpus(location);

  // A file with CRLF endings in upstream's own bytes when there is one (ADR 0056's files come from anywhere), and
  // otherwise the file with the most elements. Chosen by what it holds, never by name.
  const fileUrls = flatten(tree).filter((node) => !node.isIndex && !node.repeated).map((node) => node.url);
  const byFile = new Map<string, number>();
  for (const element of full.library.elements.all()) {
    const file = element.origin.fileUrl ?? '';
    byFile.set(file, (byFile.get(file) ?? 0) + 1);
  }
  const texts = new Map<string, string>();
  for (const url of fileUrls) texts.set(url, (await disk!.fetchText(url)).text);
  const withAppendsOnly = (url: string): boolean => !byFile.get(url);
  const crlf = fileUrls.filter((url) => texts.get(url)!.includes('\r\n') && !withAppendsOnly(url));
  const pick = (crlf.length ? crlf : fileUrls).reduce((best, url) =>
    (byFile.get(url) ?? 0) > (byFile.get(best) ?? 0) ? url : best,
  );
  const name = pick.split('/').pop()!;

  const storage = new MemoryStorage();
  const profile = new SourceProfile(storage);
  const added = await addFileSource(profile, storage, { name, text: texts.get(pick)! }, { systemId: 'dnd5e' });
  const library = new ContentLibrary();
  await library.loadSource(composeSource(added.source, { fetcher: disk!, storage }), added.source.url);

  const shape = (element: { id: string; name: string; type: string; description?: string; rules: unknown[]; supports: string[] }) =>
    JSON.stringify([element.id, element.name, element.type, element.description ?? '', element.rules.length, element.supports]);
  const own = [...library.elements.all()].filter((element) => element.origin.sourceId === added.source.id);
  const fromCorpus = [...full.library.elements.all()].filter((element) => element.origin.fileUrl === pick);
  // Appends from other files may have added rules to the corpus copy, so compare what the file itself declares: the
  // corpus copies with no append folded in, and every id.
  assert.deepEqual(own.map((element) => element.id).sort(), fromCorpus.map((element) => element.id).sort());
  const corpusById = new Map(fromCorpus.map((element) => [element.id, element]));
  let compared = 0;
  for (const element of own) {
    const other = corpusById.get(element.id)!;
    assert.equal(element.description ?? '', other.description ?? '', element.id);
    assert.ok(!(element.description ?? '').includes('\r'), element.id);
    if (other.rules.length === element.rules.length) {
      assert.equal(shape(element), shape(other));
      compared++;
    }
  }
  t.diagnostic(
    `added one corpus file on its own (${crlf.length ? 'CRLF' : 'LF'}, ${own.length} elements): ` +
      `every id and description the corpus load has, ${compared} elements identical in rules and tags`,
  );
});
