/**
 * ADR 0052: what each source refers to that nothing loaded declares, reported against the source that refers to it.
 *
 * The report is counts and lists, and a wrong attribution keeps every count right: a missing id reported against the
 * wrong source is still one missing id. So these compare the report with what the sources were written to hold, and
 * with the same sources after the missing one is added. Each names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GENERATED_SOURCE_ID, auroraGeneratedElements, type ElementAppend } from '@incudo/aurora-import';
import { referencedElementIds, type Element, type Rule } from '@incudo/core';
import { ContentLibrary } from './library.ts';
import type { ContentIndex, ContentSource, ElementFile, FileRef } from './source.ts';

interface Spec {
  id: string;
  grants?: string[];
  requires?: string;
  selectDefault?: string;
}

interface File {
  elements?: Spec[];
  appends?: Array<{ target: string; tag: string; grants?: string[] }>;
}

function element(spec: Spec, sourceId: string, fileUrl: string): Element {
  const rules: Rule[] = (spec.grants ?? []).map((id) => ({ kind: 'grant', type: 'Widget', id }) as Rule);
  if (spec.selectDefault) {
    rules.push({ kind: 'select', key: 'select:Pick', type: 'Widget', name: 'Pick', number: 1, default: spec.selectDefault } as Rule);
  }
  return {
    id: spec.id,
    type: 'Widget',
    name: spec.id,
    source: 'test',
    setters: {},
    rules,
    supports: [],
    requirements: spec.requires ? { kind: 'has', id: spec.requires } : undefined,
    origin: { sourceId, format: 'incudo', fileUrl },
  };
}

function source(name: string, format: 'aurora' | 'incudo', ...files: File[]): { source: ContentSource; url: string } {
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
          elements: (file.elements ?? []).map((spec) => element(spec, url, ref.url)),
          appends: (file.appends ?? []).map(
            (a) =>
              ({
                id: a.target,
                rules: (a.grants ?? []).map((id) => ({ kind: 'grant', type: 'Widget', id })),
                supports: [a.tag],
                fileUrl: ref.url,
              }) as ElementAppend,
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
  for (const s of sources) await library.loadSource(s.source, s.url);
  return library;
}

const CORE = () =>
  source('core', 'incudo', { elements: [{ id: 'ID_SKILL_ARCANA' }, { id: 'ID_LANGUAGE_COMMON' }, { id: 'ID_SPELL_MISTY_STEP' }] });
const BOOK = () =>
  source('book', 'incudo', {
    elements: [
      { id: 'ID_RACE_ELF', grants: ['ID_LANGUAGE_COMMON', 'ID_LANGUAGE_ELVISH'] },
      { id: 'ID_LANGUAGE_ELVISH' },
      { id: 'ID_BACKGROUND_SAGE', selectDefault: 'ID_SKILL_ARCANA' },
      // A requirement on something nothing declares is how content says "unless": never reported.
      { id: 'ID_FEAT_OLD', requires: 'ID_FEAT_2024_REPLACEMENT' },
    ],
    appends: [{ target: 'ID_SPELL_MISTY_STEP', tag: 'Artificer', grants: ['ID_ARTIFICER_NOTE'] }],
  });

test('a book without the source it builds on reports what it refers to, against itself', async () => {
  // Perturbation: counting requirements too adds ID_FEAT_2024_REPLACEMENT; dropping select defaults loses ID_SKILL_ARCANA.
  const library = await load(BOOK());
  assert.deepEqual([...library.missingContent().entries()], [
    ['memory://book/index', { references: ['ID_LANGUAGE_COMMON', 'ID_SKILL_ARCANA'], additions: ['ID_SPELL_MISTY_STEP'] }],
  ]);
});

test('adding the source it builds on clears the report, whichever order they load in', async () => {
  // The append's own grant is reported once its target exists, and against the book: the rule came from the book,
  // though it now sits on core's element. Perturbation: reading the folded element whole reports it against core.
  for (const order of [[CORE(), BOOK()], [BOOK(), CORE()]]) {
    const report = (await load(...order)).missingContent();
    assert.deepEqual([...report.entries()], [['memory://book/index', { references: ['ID_ARTIFICER_NOTE'], additions: [] }]]);
  }
});

test('what an append adds is not reported against the source it was added to', async () => {
  // The same, with the appended grant resolvable: nothing is left, for either source.
  const note = source('note', 'incudo', { elements: [{ id: 'ID_ARTIFICER_NOTE' }] });
  const report = (await load(BOOK(), CORE(), note)).missingContent();
  assert.deepEqual([...report.entries()], []);
});

test('an element replaced by a later source is judged by the definition that won', async () => {
  // Perturbation: walking every definition ever loaded, rather than the index, reports the first ID_RACE_ELF's grants.
  const reprint = source('reprint', 'incudo', { elements: [{ id: 'ID_RACE_ELF', grants: ['ID_LANGUAGE_ELVISH'] }] });
  const report = (await load(BOOK(), reprint)).missingContent();
  assert.deepEqual(report.get('memory://book/index')?.references, ['ID_SKILL_ARCANA']);
  assert.equal(report.get('memory://reprint/index'), undefined);
});

test('what the Aurora overlay refers to is reported against the first Aurora source, never as a source of its own', async () => {
  // An Aurora source with none of the content the overlay grants. Perturbation: keying by origin alone reports it
  // under the overlay's own id, which no user added and the Sources pane has no line for.
  const overlay = auroraGeneratedElements();
  const expected = [...referencedElementIds(overlay, { requirements: false })]
    .filter((id) => !overlay.some((e) => e.id === id))
    .sort();
  assert.ok(expected.length > 0, 'the overlay grants something it does not declare itself');

  const first = source('first', 'aurora', { elements: [{ id: 'ID_NOTHING' }] });
  const second = source('second', 'aurora', { elements: [{ id: 'ID_ALSO_NOTHING' }] });
  const report = (await load(first, second)).missingContent();
  assert.equal(report.get(GENERATED_SOURCE_ID), undefined);
  assert.equal(report.get('memory://second/index'), undefined);
  for (const id of expected) assert.ok(report.get('memory://first/index')?.references.includes(id), `${id} is reported`);
});
