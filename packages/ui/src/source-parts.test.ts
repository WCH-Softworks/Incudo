/**
 * ADR 0055's chooser and ADR 0056's file adding, as the Sources pane reads them.
 *
 * The chooser's total must be what a load of the same source reports, so it is compared with a real `ContentLibrary`
 * load through `partsFilter`, including the case where the only place a part is listed is under a part that is off.
 * Each test names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ContentLibrary, partsFilter, readIndexTree, SourceProfile, type ContentIndex, type ContentSource, type ElementFile, type FileRef } from '@incudo/content';
import { MemoryStorage } from '@incudo/core';

import { addContentFiles, decodeText, describeContentFiles } from './content-files.ts';
import { excludedWithin, partsView, togglePart, type PartView } from './source-parts.ts';

function memory(indexes: Record<string, string[]>): ContentSource {
  const ref = (url: string): FileRef => ({ name: url.split('/').pop()!, url, isIndex: url.endsWith('.index') });
  return {
    id: 'test',
    loadIndex: async (url: string): Promise<ContentIndex> => {
      const files = indexes[url];
      if (!files) throw new Error('HTTP 404');
      return { url, name: `The ${url.split('/').pop()!.replace('.index', '')} book`, files: files.map(ref), format: 'incudo' };
    },
    loadFile: async (fileRef: FileRef): Promise<ElementFile> => ({
      url: fileRef.url,
      elements: [
        {
          id: fileRef.url,
          type: 'Widget',
          name: fileRef.url,
          source: 't',
          setters: {},
          rules: [],
          supports: [],
          origin: { sourceId: 'test', format: 'incudo', fileUrl: fileRef.url },
        },
      ],
      diagnostics: [],
    }),
    checkForUpdates: async () => ({ state: 'unknown', reason: 'test' }),
  };
}

const CORPUS: Record<string, string[]> = {
  'm://top.index': ['m://core.index', 'm://sup.index'],
  'm://core.index': ['m://core/phb.index', 'm://core/ale.xml'],
  'm://core/phb.index': ['m://core/phb/a.xml', 'm://core/phb/b.xml'],
  'm://sup.index': ['m://sup/tasha.index', 'm://sup/c.xml'],
  'm://sup/tasha.index': ['m://sup/tasha/d.xml', 'm://core/phb/a.xml'],
};

async function loadCount(indexes: Record<string, string[]>, excluded: string[]): Promise<number> {
  const report = await new ContentLibrary().loadSource(memory(indexes), 'm://top.index', {
    include: partsFilter({ excluded }),
  });
  return report.filesLoaded;
}

function find(parts: PartView[], url: string): PartView {
  for (const part of parts) {
    if (part.url === url && !part.repeated) return part;
    const found = part.children.length ? findOrNull(part.children, url) : null;
    if (found) return found;
  }
  throw new Error(`no ${url}`);
}
function findOrNull(parts: PartView[], url: string): PartView | null {
  try {
    return find(parts, url);
  } catch {
    return null;
  }
}

test('the total that will load is what a load reports, for every single part switched off', async () => {
  const tree = await readIndexTree(memory(CORPUS), 'm://top.index');
  const urls = [...new Set(Object.values(CORPUS).flat())];
  assert.equal(partsView(tree, []).filesLoading, await loadCount(CORPUS, []));
  for (const url of urls) {
    // Includes switching off Core, under which `a.xml` is listed first: the load then meets it under Tasha's, and loads it.
    // Perturbation: counting a repeated mention as never loading undercounts that case by one.
    assert.equal(partsView(tree, [url]).filesLoading, await loadCount(CORPUS, [url]), `with ${url} off`);
  }
});

test('a part under a switched-off part is unreachable and loads nothing, whatever its own switch says', async () => {
  const tree = await readIndexTree(memory(CORPUS), 'm://top.index');
  const view = partsView(tree, ['m://core.index']);
  const core = find(view.parts, 'm://core.index');
  const phb = find(view.parts, 'm://core/phb.index');
  assert.equal(core.on, false);
  assert.equal(phb.on, true);
  // Perturbation: not passing reachability down reports the Handbook as loading.
  assert.equal(phb.reachable, false);
  assert.equal(phb.filesLoading, 0);
  assert.equal(core.files, 3);
  assert.equal(core.filesLoading, 0);
  assert.equal(view.files, 5);
});

test('an index that was read is called what it calls itself, and keeps the name its parent lists it by', async () => {
  const tree = await readIndexTree(memory(CORPUS), 'm://top.index');
  const phb = find(partsView(tree, []).parts, 'm://core/phb.index');
  assert.equal(phb.label, 'The phb book');
  assert.equal(phb.listedAs, 'phb.index');
  assert.equal(find(partsView(tree, []).parts, 'm://core/ale.xml').label, 'ale.xml');
});

test('toggling adds and removes one part, and saving keeps only what the tree still names', async () => {
  const tree = await readIndexTree(memory(CORPUS), 'm://top.index');
  let excluded = togglePart([], 'm://sup.index');
  excluded = togglePart(excluded, 'm://core/ale.xml');
  assert.deepEqual(excluded, ['m://sup.index', 'm://core/ale.xml']);
  assert.deepEqual(togglePart(excluded, 'm://sup.index'), ['m://core/ale.xml']);
  // In tree order, and a part upstream stopped listing is dropped.
  assert.deepEqual(excludedWithin(tree, [...excluded, 'm://gone.index']), ['m://core/ale.xml', 'm://sup.index']);
  assert.deepEqual(partsView(tree, [...excluded, 'm://gone.index']).excluded, ['m://core/ale.xml', 'm://sup.index']);
});

const HOMEBREW = '<elements><element name="Blade" type="Magic Item" source="Homebrew" id="ID_HB_BLADE" /></elements>';

test('several files are added one source each, and one refused file does not stop the rest', async () => {
  const storage = new MemoryStorage();
  const profile = new SourceProfile(storage);
  const encode = (text: string) => new TextEncoder().encode(text);
  const results = await addContentFiles(
    [
      { name: 'blades.xml', bytes: encode(HOMEBREW) },
      { name: 'notes.xml', bytes: encode('<notes />') },
      { name: 'more.xml', bytes: encode(HOMEBREW.replace('ID_HB_BLADE', 'ID_HB_OTHER')) },
    ],
    profile,
    storage,
    { systemId: 'dnd5e' },
  );
  assert.deepEqual(
    results.map((result) => [result.name, !!result.added, !!result.failed]),
    [
      ['blades.xml', true, false],
      ['notes.xml', false, true],
      ['more.xml', true, false],
    ],
  );
  assert.deepEqual(
    profile.sources.map((source) => source.id),
    ['local:blades.xml', 'local:more.xml'],
  );
  assert.equal(describeContentFiles(results), '2 files added, 1 not added.');

  const again = await addContentFiles([{ name: 'blades.xml', bytes: encode(HOMEBREW) }], profile, storage, {
    systemId: 'dnd5e',
  });
  assert.equal(describeContentFiles(again), '1 replaced with the newer copy.');
});

test('a byte order mark is dropped, and UTF-16 from a Windows editor is read', () => {
  const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('<elements/>')]);
  assert.equal(decodeText(utf8), '<elements/>');
  const text = '<elements/>';
  const utf16 = new Uint8Array(2 + text.length * 2);
  utf16[0] = 0xff;
  utf16[1] = 0xfe;
  for (let i = 0; i < text.length; i++) utf16[2 + i * 2] = text.charCodeAt(i);
  assert.equal(decodeText(utf16), '<elements/>');
});
