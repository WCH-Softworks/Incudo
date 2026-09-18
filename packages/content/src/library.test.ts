/**
 * What `ContentLibrary` adds to an Aurora source on top of its files — the elements Aurora's app
 * generates at runtime. The generation itself is tested in `@incudo/aurora-import`; this is only
 * about *when* it runs, which is the part a library can get wrong: once per load, after every
 * file and every `<append>`, and never for a source that is not Aurora's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { auroraGeneratedElements } from '@incudo/aurora-import';
import { parseSupports, type Element } from '@incudo/core';
import { ContentLibrary } from './library.ts';
import type { ContentIndex, ContentSource, ElementFile, FileRef } from './source.ts';

function element(id: string, extra: Partial<Element> = {}): Element {
  return {
    id,
    type: 'Class Feature',
    name: id,
    source: 'test',
    setters: {},
    rules: [],
    supports: [],
    origin: { sourceId: 'test', format: 'aurora', fileUrl: 'memory://file' },
    ...extra,
  };
}

function improvementFeature(level: number): Element {
  return element(`ID_FEATURE_ASI_${level}`, {
    rules: [
      {
        kind: 'select',
        key: `select:Improvement Option (Fighter ${level})`,
        type: 'Class Feature',
        name: `Improvement Option (Fighter ${level})`,
        supports: parseSupports(`Improvement Option,Fighter,${level}`),
        number: 1,
      },
    ],
  });
}

let sources = 0;

function source(format: 'aurora' | 'incudo', ...files: Element[][]): ContentSource {
  // A distinct address per source: the library skips a file URL it has already loaded.
  const n = ++sources;
  const refs: FileRef[] = files.map((_, i) => ({
    name: `file-${i}.xml`,
    url: `memory://${format}/${n}/file-${i}.xml`,
    isIndex: false,
  }));
  const index: ContentIndex = { url: `memory://${format}/${n}/index`, name: 'Memory', files: refs, format };
  return {
    id: index.url,
    loadIndex: async () => index,
    loadFile: async (ref: FileRef): Promise<ElementFile> => ({
      url: ref.url,
      elements: files[refs.findIndex((r) => r.url === ref.url)]!,
      diagnostics: [],
    }),
    checkForUpdates: async () => ({ state: 'unknown', reason: 'test' }),
  };
}

const OVERLAY = auroraGeneratedElements().length;

test('an Aurora source gets the improvement options its content asks for, counted as generated', async () => {
  const library = new ContentLibrary();
  await library.loadSource(source('aurora', [improvementFeature(4)]), 'memory://aurora/index');

  assert.ok(library.elements.get('ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER'));
  assert.ok(library.elements.get('ID_INTERNAL_CLASS_FEATURE_FEAT_4_FIGHTER'));
  assert.equal(library.generatedElements, OVERLAY + 2);
});

test('options are generated across every file, not per file', async () => {
  const library = new ContentLibrary();
  await library.loadSource(
    source('aurora', [improvementFeature(4)], [improvementFeature(8)]),
    'memory://aurora/index',
  );
  assert.equal(library.generatedElements, OVERLAY + 4);
});

test('loading a second source neither duplicates nor drops what the first asked for', async () => {
  const library = new ContentLibrary();
  await library.loadSource(source('aurora', [improvementFeature(4)]), 'memory://aurora/one');
  await library.loadSource(
    source('aurora', [improvementFeature(4), improvementFeature(6)]),
    'memory://aurora/two',
  );
  // Level 4 once, level 6 added by the second: two pairs, four elements, not six.
  assert.equal(library.generatedElements, OVERLAY + 4);
  assert.ok(library.elements.get('ID_INTERNAL_CLASS_FEATURE_ASI_6_FIGHTER'));
});

test('a pair a loaded element already declares is not generated', async () => {
  const library = new ContentLibrary();
  const declared = element('ID_DECLARED', { supports: ['Improvement Option', 'Fighter', '4'] });
  await library.loadSource(source('aurora', [improvementFeature(4), declared]), 'memory://aurora/index');
  assert.equal(library.elements.get('ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER'), undefined);
  assert.equal(library.generatedElements, OVERLAY);
});

test('withoutGeneratedElements loads the corpus exactly as it is on disk', async () => {
  const library = new ContentLibrary();
  await library.loadSource(source('aurora', [improvementFeature(4)]), 'memory://aurora/index', {
    withoutGeneratedElements: true,
  });
  assert.equal(library.elements.get('ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER'), undefined);
  assert.equal(library.generatedElements, 0);
});

test('a source that is not Aurora\'s gets nothing generated', async () => {
  const library = new ContentLibrary();
  await library.loadSource(source('incudo', [improvementFeature(4)]), 'memory://incudo/index');
  assert.equal(library.elements.get('ID_INTERNAL_CLASS_FEATURE_ASI_4_FIGHTER'), undefined);
  assert.equal(library.generatedElements, 0);
});
