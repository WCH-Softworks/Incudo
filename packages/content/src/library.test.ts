/**
 * What `ContentLibrary.loadBundle` does with a source's file: which of its files it adds, and what it does with what a
 * conversion generated. Converting is `@incudo/aurora-import`'s and tested there; this is the loading, which reads
 * Incudo content and nothing else (ADR 0119). Each test names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ContentPart, Element } from '@incudo/core';
import { ContentLibrary, excludedAddresses } from './library.ts';
import { testBundle } from './test-bundle.ts';

function element(id: string, extra: Partial<Element> = {}): Element {
  return { id, type: 'Widget', name: id, source: 'test', setters: {}, rules: [], supports: [], origin: { sourceId: 'x' }, ...extra };
}

const URL = 'memory://book/index';
const PARTS: ContentPart = {
  name: 'Book',
  url: URL,
  isIndex: true,
  children: [
    { name: 'one.xml', url: 'memory://book/one.xml', isIndex: false },
    {
      name: 'extra.index',
      url: 'memory://book/extra.index',
      isIndex: true,
      children: [{ name: 'two.xml', url: 'memory://book/two.xml', isIndex: false }],
    },
  ],
};

function book() {
  return testBundle(
    URL,
    [
      { url: 'incudo:aurora/app-elements', elements: [element('ID_GENERATED')], generated: true },
      { url: 'memory://book/one.xml', elements: [element('ID_ONE')], diagnostics: [{ level: 'warning', message: 'one', fileUrl: 'memory://book/one.xml' }] },
      {
        url: 'memory://book/two.xml',
        elements: [element('ID_TWO')],
        extensions: [{ id: 'ID_ONE', rules: [], supports: ['FromTwo'] }],
        diagnostics: [{ level: 'warning', message: 'two', fileUrl: 'memory://book/two.xml' }],
      },
    ],
    { parts: PARTS },
  );
}

test('every file loads, in order, each element recorded as the source\'s', () => {
  const library = new ContentLibrary();
  const report = library.loadBundle(URL, book());
  assert.deepEqual([...library.elements.all()].map((e) => e.id), ['ID_GENERATED', 'ID_ONE', 'ID_TWO']);
  assert.deepEqual(library.elements.get('ID_ONE')!.supports, ['FromTwo']);
  assert.equal(library.elements.get('ID_ONE')!.origin.sourceId, URL);
  assert.equal(report.filesLoaded, 2, 'a generated file is no file of the source');
  assert.deepEqual(report.declared, ['ID_ONE', 'ID_TWO'], 'nor are its elements what the source declares');
  assert.deepEqual(library.diagnostics.map((d) => d.message), ['one', 'two']);
});

test('an index switched off leaves out its files, their extensions and what they said, and nothing else', () => {
  // Perturbation: matching only the switched-off address, not what is under it, keeps ID_TWO.
  const library = new ContentLibrary();
  const report = library.loadBundle(URL, book(), { excluded: ['memory://book/extra.index'] });
  assert.deepEqual([...library.elements.all()].map((e) => e.id), ['ID_GENERATED', 'ID_ONE']);
  assert.deepEqual(library.elements.get('ID_ONE')!.supports, [], 'its extension goes with it');
  assert.deepEqual(library.diagnostics.map((d) => d.message), ['one']);
  assert.deepEqual(report.declared, ['ID_ONE']);
});

test('what a conversion generated loads whatever is switched off, and only where nothing declares its id', () => {
  const library = new ContentLibrary();
  library.loadBundle('memory://first', testBundle('memory://first', [{ url: 'memory://first/a.xml', elements: [element('ID_GENERATED', { name: 'Declared' })] }]));
  library.loadBundle(URL, book(), { excluded: ['memory://book/one.xml', 'memory://book/extra.index'] });
  // Perturbation: adding a generated element like any other replaces what the first source declares.
  assert.equal(library.elements.get('ID_GENERATED')!.name, 'Declared');
  assert.equal(library.sourceOverlaps().size, 0);
});

test('withoutGenerated loads the files alone', () => {
  const library = new ContentLibrary();
  library.loadBundle(URL, book(), { withoutGenerated: true });
  assert.equal(library.elements.get('ID_GENERATED'), undefined);
});

test('a file an earlier source loaded is not loaded again, and still counts as what the later one declares', () => {
  // Core lists the Player's Handbook's own index: the second source reads none of it itself (ADR 0090).
  const library = new ContentLibrary();
  library.loadBundle('memory://core', testBundle('memory://core', [{ url: 'memory://book/one.xml', elements: [element('ID_ONE')] }]));
  const report = library.loadBundle(URL, book());
  assert.equal(report.filesLoaded, 1);
  assert.equal(library.elements.get('ID_ONE')!.origin.sourceId, 'memory://core');
  assert.deepEqual(report.declared, ['ID_ONE', 'ID_TWO']);
  assert.deepEqual(library.diagnostics.map((d) => d.message), ['two'], 'what the skipped file said is the first source\'s');
});

test('a bundle with no list of files, a save\'s content or a homebrew body, loads its elements', () => {
  const library = new ContentLibrary();
  library.loadBundle('homebrew:x', { formatVersion: 1, elements: [element('ID_A'), element('ID_B')] });
  assert.deepEqual([...library.elements.all()].map((e) => e.id), ['ID_A', 'ID_B']);
});

test('excludedAddresses walks under an index switched off, at its first mention', () => {
  assert.deepEqual([...excludedAddresses(PARTS, ['memory://book/extra.index'])].sort(), ['memory://book/extra.index', 'memory://book/two.xml']);
  assert.deepEqual([...excludedAddresses(PARTS, undefined)], []);
});
