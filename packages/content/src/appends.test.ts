/**
 * An `<append>` reaches its target whichever source is loaded first.
 *
 * The app loads each enabled source into one `ContentLibrary`, in the order the user added them. Appends used to be
 * applied at the end of each source's own load, so a supplement added before the book it extends lost every append
 * for good: Tasha's added before AuroraLegacy's core dropped 51 support tags, with a warning and nothing else. The
 * tests compare two orders of the same sources, because a count of elements does not move when a tag goes missing.
 * Each names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ElementAppend } from '@incudo/aurora-import';
import type { Element } from '@incudo/core';
import { ContentLibrary } from './library.ts';
import type { ContentIndex, ContentSource, ElementFile, FileRef } from './source.ts';

function element(id: string, fileUrl: string, supports: string[] = []): Element {
  return {
    id,
    type: 'Widget',
    name: id,
    source: 'test',
    setters: {},
    rules: [],
    supports,
    origin: { sourceId: 'test', format: 'incudo', fileUrl },
  };
}

function append(id: string, tag: string, fileUrl: string): ElementAppend {
  return { id, rules: [{ kind: 'grant', type: 'Widget', id: `ID_GRANTED_BY_${tag}` }], supports: [tag], fileUrl } as ElementAppend;
}

interface File {
  elements?: string[];
  appends?: Array<[target: string, tag: string]>;
}

/** A source of one index naming its files. `incudo` format, so nothing Aurora generates gets in the way. */
function source(name: string, ...files: File[]): { source: ContentSource; url: string } {
  const url = `memory://${name}/index`;
  const refs: FileRef[] = files.map((_, i) => ({ name: `${i}.xml`, url: `memory://${name}/${i}.xml`, isIndex: false }));
  const index: ContentIndex = { url, name, files: refs, format: 'incudo' };
  return {
    url,
    source: {
      id: url,
      loadIndex: async () => index,
      loadFile: async (ref: FileRef): Promise<ElementFile> => {
        const file = files[refs.findIndex((r) => r.url === ref.url)]!;
        return {
          url: ref.url,
          elements: (file.elements ?? []).map((id) => element(id, ref.url)),
          appends: (file.appends ?? []).map(([target, tag]) => append(target, tag, ref.url)),
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

/** What each element ended up with, rules and tags alike, in order. */
function shape(library: ContentLibrary): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of library.elements.all()) {
    out[e.id] = `${e.supports.join(',')} | ${e.rules.map((r) => ('id' in r ? r.id : r.kind)).join(',')}`;
  }
  return out;
}

const misses = (library: ContentLibrary): string[] =>
  library.diagnostics.filter((d) => d.message.startsWith('An <append> targets')).map((d) => d.elementId!);

const CORE = () => source('core', { elements: ['ID_WIZARD', 'ID_FIREBALL'] });
const SUPPLEMENT = () => source('supplement', { elements: ['ID_ARTIFICER'], appends: [['ID_FIREBALL', 'Artificer'], ['ID_WIZARD', 'Extended']] });

test('a supplement added before the book it extends gets its appends, as it does after', async () => {
  // Perturbation: dropping the appends that waited from the targets looked at again leaves the second order without
  // the tags and with two warnings.
  const coreFirst = await load(CORE(), SUPPLEMENT());
  const supplementFirst = await load(SUPPLEMENT(), CORE());

  assert.deepEqual(shape(supplementFirst), shape(coreFirst));
  assert.equal(shape(supplementFirst)['ID_FIREBALL'], 'Artificer | ID_GRANTED_BY_Artificer');
  assert.deepEqual(supplementFirst.elements.bySupport('Artificer').map((e) => e.id), ['ID_FIREBALL']);
  // The warning the first load gave was right when it was given, and is withdrawn once the target arrives.
  // Perturbation: not splicing it out leaves both.
  assert.deepEqual(misses(supplementFirst), []);
});

test('an append whose target never loads is a warning, once, however many sources follow', async () => {
  // Perturbation: warning again for every append still waiting at the end of each load gives three.
  const library = await load(SUPPLEMENT(), source('other', { elements: ['ID_OTHER'] }), source('more', { elements: ['ID_MORE'] }));
  assert.deepEqual(misses(library).sort(), ['ID_FIREBALL', 'ID_WIZARD']);
});

test('an append is applied once, however many sources load after it', async () => {
  // Perturbation: folding every target again at the end of each load, over what it holds now, doubles the tag.
  const library = await load(CORE(), SUPPLEMENT(), source('other', { elements: ['ID_OTHER'] }), source('more', { elements: ['ID_MORE'] }));
  assert.equal(shape(library)['ID_FIREBALL'], 'Artificer | ID_GRANTED_BY_Artificer');
});

test('a later source that redefines an appended element gets the appends too, as one load would', async () => {
  // In one load, appends are folded after every file, so they land on whichever definition won. Across sources the
  // same must hold. Perturbation: looking again only at targets that waited, not at ones whose element was replaced,
  // leaves the replacement without the tag.
  const reprint = source('reprint', { elements: ['ID_FIREBALL'] });
  const library = await load(CORE(), SUPPLEMENT(), reprint);
  const fireball = library.elements.get('ID_FIREBALL')!;
  assert.equal(fireball.origin.fileUrl, 'memory://reprint/0.xml');
  assert.deepEqual(fireball.supports, ['Artificer']);

  const oneLoad = await load(source('all', { elements: ['ID_WIZARD', 'ID_FIREBALL'] }, { elements: ['ID_ARTIFICER'], appends: [['ID_FIREBALL', 'Artificer'], ['ID_WIZARD', 'Extended']] }, { elements: ['ID_FIREBALL'] }));
  assert.deepEqual(oneLoad.elements.get('ID_FIREBALL')!.supports, fireball.supports);
});

test('two sources appending to one element both land, in the order their files loaded', async () => {
  // Perturbation: folding only the appends of the current load over the element as it was replaces the first tag.
  const second = source('second', { appends: [['ID_FIREBALL', 'Sorcerer']] });
  const library = await load(SUPPLEMENT(), second, CORE());
  assert.equal(shape(library)['ID_FIREBALL'], 'Artificer,Sorcerer | ID_GRANTED_BY_Artificer,ID_GRANTED_BY_Sorcerer');
  assert.deepEqual(misses(library), []);
});
