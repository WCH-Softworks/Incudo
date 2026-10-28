/**
 * ADR 0052: what each source refers to that nothing loaded declares, reported against the source that refers to it.
 *
 * The report is counts and lists, and a wrong attribution keeps every count right: a missing id reported against the
 * wrong source is still one missing id. So these compare the report with what the sources were written to hold, and
 * with the same sources after the missing one is added. Each names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { referencedElementIds, type ContentBundle, type Element, type Rule } from '@incudo/core';
import { ContentLibrary } from './library.ts';
import { testBundle, type TestFile } from './test-bundle.ts';

interface Spec {
  id: string;
  grants?: string[];
  requires?: string;
  selectDefault?: string;
}

/** What a conversion writes for Aurora's app, as a file of its own: two marker elements stand for it here. */
const GENERATED: Element[] = ['ID_INTERNAL_MARKER_A', 'ID_INTERNAL_MARKER_B'].map((id) => ({
  id,
  type: 'Grants',
  name: id,
  source: '',
  setters: {},
  // One grants what nothing declares, so there is something to report against whichever source brought it in.
  rules: id.endsWith('_A') ? [{ kind: 'grant', key: 'grant-0', type: 'Grants', id: 'ID_INTERNAL_NOWHERE' } as Rule] : [],
  supports: [],
  origin: { sourceId: 'x' },
}));

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

interface TestSource {
  id: string;
  bundle: ContentBundle;
}

function source(name: string, generated: boolean, ...files: File[]): TestSource {
  const url = `memory://${name}/index`;
  const testFiles: TestFile[] = files.map((file, i) => {
    const fileUrl = `memory://${name}/${i}.xml`;
    return {
      url: fileUrl,
      elements: (file.elements ?? []).map((spec) => element(spec, url, fileUrl)),
      extensions: (file.appends ?? []).map((a) => ({
        id: a.target,
        rules: (a.grants ?? []).map((id) => ({ kind: 'grant', key: `grant-${id}`, type: 'Widget', id }) as Rule),
        supports: [a.tag],
      })),
    };
  });
  // What a conversion writes for Aurora's app: its own elements, as a file of their own.
  if (generated) testFiles.unshift({ url: 'incudo:aurora/app-elements', elements: GENERATED, generated: true });
  return { id: url, bundle: testBundle(url, testFiles) };
}

function load(...sources: TestSource[]): ContentLibrary {
  const library = new ContentLibrary();
  for (const s of sources) library.loadBundle(s.id, s.bundle);
  return library;
}

const CORE = () =>
  source('core', false, { elements: [{ id: 'ID_SKILL_ARCANA' }, { id: 'ID_LANGUAGE_COMMON' }, { id: 'ID_SPELL_MISTY_STEP' }] });
const BOOK = () =>
  source('book', false, {
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
  const library = load(BOOK());
  assert.deepEqual([...library.missingContent().entries()], [
    ['memory://book/index', { references: ['ID_LANGUAGE_COMMON', 'ID_SKILL_ARCANA'], additions: ['ID_SPELL_MISTY_STEP'] }],
  ]);
});

test('adding the source it builds on clears the report, whichever order they load in', async () => {
  // The append's own grant is reported once its target exists, and against the book: the rule came from the book,
  // though it now sits on core's element. Perturbation: reading the folded element whole reports it against core.
  for (const order of [[CORE(), BOOK()], [BOOK(), CORE()]]) {
    const report = (load(...order)).missingContent();
    assert.deepEqual([...report.entries()], [['memory://book/index', { references: ['ID_ARTIFICER_NOTE'], additions: [] }]]);
  }
});

test('what an extension adds is not reported against the source it was added to', async () => {
  // The same, with the appended grant resolvable: nothing is left, for either source.
  const note = source('note', false, { elements: [{ id: 'ID_ARTIFICER_NOTE' }] });
  const report = (load(BOOK(), CORE(), note)).missingContent();
  assert.deepEqual([...report.entries()], []);
});

test('an element replaced by a later source is judged by the definition that won', async () => {
  // Perturbation: walking every definition ever loaded, rather than the index, reports the first ID_RACE_ELF's grants.
  const reprint = source('reprint', false, { elements: [{ id: 'ID_RACE_ELF', grants: ['ID_LANGUAGE_ELVISH'] }] });
  const report = (load(BOOK(), reprint)).missingContent();
  assert.deepEqual(report.get('memory://book/index')?.references, ['ID_SKILL_ARCANA']);
  assert.equal(report.get('memory://reprint/index'), undefined);
});

test('what a conversion generated refers to is reported against the first source that brought it in', async () => {
  // An Aurora source with none of the content the overlay grants. Perturbation: keying by origin alone reports it
  // under the overlay's own id, which no user added and the Sources pane has no line for. Since ADR 0129 the overlay
  // grants nothing it does not declare itself (its bag proxies named two languages), so what is held is that nothing
  // is reported under the overlay, and that whatever it may grant later is reported against the first source.
  const overlay = GENERATED;
  const expected = [...referencedElementIds(overlay, { requirements: false })]
    .filter((id) => !overlay.some((e) => e.id === id))
    .sort();

  const first = source('first', true, { elements: [{ id: 'ID_NOTHING' }] });
  const second = source('second', true, { elements: [{ id: 'ID_ALSO_NOTHING' }] });
  const report = (load(first, second)).missingContent();
  assert.equal(report.get('memory://second/index'), undefined);
  for (const id of expected) assert.ok(report.get('memory://first/index')?.references.includes(id), `${id} is reported`);
});
