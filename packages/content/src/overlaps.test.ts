/**
 * ADR 0054: when two sources define the same id, the one loaded later is used, and each source says what it shares with
 * the others and whose version is used.
 *
 * Counts alone would pass a report that attributed a pair backwards, or compared an element with an `<append>` folded
 * into it, so these name the sources and ids. Each names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { auroraGeneratedElements, type ElementAppend } from '@incudo/aurora-import';
import type { Element } from '@incudo/core';
import { ContentLibrary } from './library.ts';
import type { ContentIndex, ContentSource, ElementFile, FileRef } from './source.ts';

/** An element by id, and a name that stands for "what the definition says". */
type Spec = [id: string, name: string];

interface File {
  elements?: Spec[];
  appends?: Array<{ target: string; tag: string }>;
}

function source(name: string, ...files: File[]): { source: ContentSource; url: string } {
  return sourceOf(name, 'incudo', ...files);
}

function sourceOf(name: string, format: 'aurora' | 'incudo', ...files: File[]): { source: ContentSource; url: string } {
  const url = `memory://${name}/index`;
  const refs: FileRef[] = files.map((_, i) => ({ name: `${i}.xml`, url: `memory://${name}/${i}.xml`, isIndex: false }));
  const index: ContentIndex = { url, name, files: refs, format };
  return {
    url,
    source: {
      id: url,
      loadIndex: async () => index,
      loadFile: async (ref: FileRef): Promise<ElementFile> => {
        const file = files[refs.findIndex((r) => r.url === ref.url)]!;
        return {
          url: ref.url,
          elements: (file.elements ?? []).map(
            ([id, label]): Element => ({
              id,
              type: 'Widget',
              name: label,
              source: 'test',
              setters: {},
              rules: [],
              supports: [],
              origin: { sourceId: url, format: 'incudo', fileUrl: ref.url },
            }),
          ),
          appends: (file.appends ?? []).map(
            (a) => ({ id: a.target, rules: [], supports: [a.tag], fileUrl: ref.url }) as ElementAppend,
          ),
          diagnostics: [],
        };
      },
      checkForUpdates: async () => ({ state: 'unknown', reason: 'test' }),
    },
  };
}

async function load(...sources: Array<{ source: ContentSource; url: string }>): Promise<ContentLibrary> {
  const library = new ContentLibrary();
  for (const s of sources) await library.loadSource(s.source, s.url, { withoutGeneratedElements: true });
  return library;
}

const redefinitionWarnings = (library: ContentLibrary): string[] =>
  library.diagnostics.filter((d) => d.message.includes('is defined in more than one file')).map((d) => d.elementId!);

test('the later source is used, and each side of the pair says so', async () => {
  const core = source('core', { elements: [['ID_A', 'Core A'], ['ID_B', 'Same B'], ['ID_C', 'Core only']] });
  const homebrew = source('homebrew', { elements: [['ID_A', 'House A'], ['ID_B', 'Same B']] });
  const library = await load(core, homebrew);

  assert.equal(library.elements.get('ID_A')!.name, 'House A', 'the later definition is the one loaded');
  // Perturbation: attributing the pair backwards swaps these two.
  assert.deepEqual(library.sourceOverlaps().get(homebrew.url), [
    { sourceId: core.url, used: 'this', differ: ['ID_A'], same: 1 },
  ]);
  assert.deepEqual(library.sourceOverlaps().get(core.url), [
    { sourceId: homebrew.url, used: 'other', differ: ['ID_A'], same: 1 },
  ]);
  // Perturbation: keeping the old warning for a redefinition across sources.
  assert.deepEqual(redefinitionWarnings(library), [], 'a redefinition across sources is not a warning');
});

test('reversing the order reverses which is used', async () => {
  const core = source('core', { elements: [['ID_A', 'Core A']] });
  const homebrew = source('homebrew', { elements: [['ID_A', 'House A']] });
  const library = await load(homebrew, core);

  assert.equal(library.elements.get('ID_A')!.name, 'Core A');
  assert.deepEqual(library.sourceOverlaps().get(core.url), [
    { sourceId: homebrew.url, used: 'this', differ: ['ID_A'], same: 0 },
  ]);
});

test('with three sources, only the one used is paired with the others', async () => {
  const first = source('first', { elements: [['ID_A', 'one']] });
  const second = source('second', { elements: [['ID_A', 'two']] });
  const third = source('third', { elements: [['ID_A', 'one']] });
  const overlaps = (await load(first, second, third)).sourceOverlaps();

  // Perturbation: pairing each definition with the one before it pairs first with second.
  assert.deepEqual(overlaps.get(first.url), [{ sourceId: third.url, used: 'other', differ: [], same: 1 }]);
  assert.deepEqual(overlaps.get(second.url), [{ sourceId: third.url, used: 'other', differ: ['ID_A'], same: 0 }]);
  assert.deepEqual(overlaps.get(third.url), [
    { sourceId: first.url, used: 'this', differ: [], same: 1 },
    { sourceId: second.url, used: 'this', differ: ['ID_A'], same: 0 },
  ]);
});

test('definitions are compared as their files declared them, not with an append folded in', async () => {
  // The supplement's append waits for core, and is folded into core's element when core loads, before the mirror.
  const supplement = source('supplement', { appends: [{ target: 'ID_A', tag: 'Extra' }] });
  const core = source('core', { elements: [['ID_A', 'A']] });
  const mirror = source('mirror', { elements: [['ID_A', 'A']] });
  const library = await load(supplement, core, mirror);

  assert.deepEqual(library.elements.get('ID_A')!.supports, ['Extra'], 'the append lands on the definition used');
  // Perturbation: comparing the element in the index, which carries core's folded append, reads as different.
  assert.deepEqual(library.sourceOverlaps().get(mirror.url), [
    { sourceId: core.url, used: 'this', differ: [], same: 1 },
  ]);
});

test('within one source, the later file still wins with a warning, and the source is represented by it', async () => {
  const core = source('core', { elements: [['ID_A', 'first']] }, { elements: [['ID_A', 'second'], ['ID_A', 'third']] });
  const mirror = source('mirror', { elements: [['ID_A', 'third']] });
  const library = await load(core, mirror);

  assert.deepEqual(redefinitionWarnings(library), ['ID_A'], 'the two-file redefinition inside core is the one warning');
  // Perturbation: recording core's first definition, or its second, reads as different.
  assert.deepEqual(library.sourceOverlaps().get(core.url), [
    { sourceId: mirror.url, used: 'other', differ: [], same: 1 },
  ]);
});

test('a later source that redefines an id in two of its own files is represented by the second', async () => {
  const core = source('core', { elements: [['ID_A', 'final']] });
  const homebrew = source('homebrew', { elements: [['ID_A', 'draft']] }, { elements: [['ID_A', 'final']] });
  const library = await load(core, homebrew);

  assert.equal(library.elements.get('ID_A')!.name, 'final');
  assert.deepEqual(redefinitionWarnings(library), ['ID_A'], 'inside homebrew, still a warning');
  // Perturbation: not replacing homebrew's recorded draft with its final reads as different.
  assert.deepEqual(library.sourceOverlaps().get(homebrew.url), [
    { sourceId: core.url, used: 'this', differ: [], same: 1 },
  ]);
});

test('replacing an element of the Aurora overlay stays a warning and is no source overlap', async () => {
  const generated = auroraGeneratedElements()[0]!;
  const aurora = sourceOf('aurora', 'aurora', { elements: [[generated.id, 'Redefined']] });
  const library = new ContentLibrary();
  await library.loadSource(aurora.source, aurora.url);

  assert.equal(library.elements.get(generated.id)!.name, 'Redefined');
  assert.deepEqual(redefinitionWarnings(library), [generated.id]);
  assert.equal(library.sourceOverlaps().size, 0);
});
