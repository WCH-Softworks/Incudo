/**
 * The user's feature library — ADR 0106.
 *
 * No game in the fixture: a keeper holds an Ox whose own rule states its "beast:stride". A feature written on one
 * keeper is saved to the library, given to another, changed in the library and offered back. Each test names the
 * change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createCharacter,
  MapElementIndex,
  type CharacterStore,
  type Element,
  type GameSystem,
  type JsonSchema,
  type LibraryEntryRef,
} from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';
import {
  addToLibrary,
  checkFeatureLibrary,
  EMPTY_FEATURE_LIBRARY,
  encodeFeatureLibrary,
  FEATURE_LIBRARY_FILE,
  FeatureLibrary,
  featureLinkView,
  libraryOffers,
  readFeatureLibrary,
  saveChangesToLibrary,
  type FeatureLibraryFile,
  type FeatureLibraryRead,
} from './feature-library.ts';

const schema = JSON.parse(readFileSync(new URL('../../../schemas/feature-library.schema.json', import.meta.url), 'utf8')) as JsonSchema;

function system(types?: string[]): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Beast' }, { name: 'Knack', plural: 'Knacks' }, { name: 'Deed', plural: 'Deeds' }],
    stats: [
      { name: 'stride', label: 'Stride', default: 0, startsFrom: 'beast:stride' },
      { name: 'guard', label: 'Guard', default: 10 },
    ],
    characterKinds: [
      {
        id: 'keeper',
        name: 'Keeper',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Beast', 'Knack', 'Deed'],
        customFeatures: { type: 'Knack', ...(types ? { types } : {}) },
        buildSteps: [{ id: 'beast', label: 'Beast', types: ['Beast'], required: true }],
        sheet: {
          sections: [
            { id: 'numbers', label: 'Numbers', stats: ['stride', 'guard'] },
            { id: 'knacks', label: 'Knacks', types: ['Knack'] },
            { id: 'deeds', label: 'Deeds', types: ['Deed'] },
          ],
        },
      },
    ],
  };
}

const ox: Element = {
  id: 'OX',
  type: 'Beast',
  name: 'Ox',
  source: 'test',
  setters: {},
  rules: [{ kind: 'stat', key: 's', name: 'beast:stride', value: { kind: 'number', value: 40 } }],
  supports: [],
  origin: { sourceId: 'test', format: 'incudo' },
};
const index = new MapElementIndex();
index.addAll([ox]);

function keeper(types?: string[]): CharacterBuilder {
  const b = new CharacterBuilder(createCharacter('test', 'keeper'), system(types), index);
  b.choose('build/beast', ['OX']);
  return b;
}

function godspeedOn(b: CharacterBuilder): string {
  const id = b.addCustomFeature('Godspeed')!;
  b.updateCustomFeature(id, { description: 'Blessed by a god of roads.', stats: [{ stat: 'stride', mode: 'set', value: 60 }] });
  return id;
}

const ready = (file: FeatureLibraryFile): FeatureLibraryRead => ({ status: 'ready', file });

test('a feature saved from one character is given to another as a linked copy, once', () => {
  // Fails if `givenFeature` drops the link (no format 12, no `library`), if `giveLibraryFeature` gives a second copy, or
  // if `libraryOffers` stops saying which are given.
  const first = keeper();
  const id = godspeedOn(first);
  const feature = first.getState().character.customFeatures!.find((f) => f.id === id)!;
  const { file, entry } = addToLibrary(EMPTY_FEATURE_LIBRARY, feature, 'test', 'f-1');
  assert.deepEqual(entry, {
    id: 'f-1',
    system: 'test',
    revision: 1,
    name: 'Godspeed',
    description: 'Blessed by a god of roads.',
    stats: [{ stat: 'stride', mode: 'set', value: 60 }],
  });
  assert.deepEqual(checkFeatureLibrary(file, schema).errors, []);

  const second = keeper();
  const given = second.giveLibraryFeature(entry)!;
  const state = second.getState();
  assert.equal(state.derived.stats.get('stride')?.value, 60);
  assert.equal(state.character.formatVersion, 12);
  assert.deepEqual(state.character.customFeatures!.find((f) => f.id === given)!.library, { id: 'f-1', revision: 1 });
  assert.equal(second.giveLibraryFeature(entry), undefined);
  assert.equal(second.getState().character.customFeatures!.length, 1);
  assert.deepEqual(
    libraryOffers(ready(file), 'test', state.character.customFeatures!).map((o) => [o.entry.id, o.given]),
    [['f-1', true]],
  );
  assert.deepEqual(libraryOffers(ready(file), 'other', []), []);
  assert.equal(second.giveLibraryFeature({ ...entry, id: 'f-2', system: 'other' }), undefined);

  // The copy needs no library: the character alone derives it.
  const reopened = new CharacterBuilder(state.character, system(), index);
  assert.equal(reopened.getState().derived.stats.get('stride')?.value, 60);
});

test('a newer revision is offered only when it differs, and Update keeps where the copy is listed', () => {
  // Fails if `featureLinkView` offers on the revision alone (a library saved with no change would nag), if
  // `updatedFromLibrary` takes the library's type over the character's, or if the update does not record the revision.
  const b = keeper(['Knack', 'Deed']);
  const entry = addToLibrary(EMPTY_FEATURE_LIBRARY, { id: 'x', name: 'Godspeed', stats: [{ stat: 'stride', mode: 'set', value: 60 }] }, 'test', 'f-1');
  const id = b.giveLibraryFeature(entry.entry)!;
  b.updateCustomFeature(id, { type: 'Deed' });
  const copy = () => b.getState().character.customFeatures!.find((f) => f.id === id)!;
  assert.equal(copy().library?.edited, undefined, 'where it is listed is not an edit');
  assert.equal(featureLinkView(copy(), ready(entry.file)).status, 'current');

  const same = saveChangesToLibrary(entry.file, 'f-1', { id: 'x', name: 'Godspeed', stats: [{ stat: 'stride', mode: 'set', value: 60 }] })!;
  assert.equal(same.entry.revision, 2);
  assert.equal(featureLinkView(copy(), ready(same.file)).status, 'current');

  const faster = saveChangesToLibrary(same.file, 'f-1', { id: 'x', name: 'Godspeed', stats: [{ stat: 'stride', mode: 'set', value: 80 }] })!;
  const view = featureLinkView(copy(), ready(faster.file));
  assert.equal(view.status, 'update');
  assert.equal(view.note, 'Godspeed has changed in your feature library.');
  assert.equal(view.save, undefined);
  b.updateFromLibrary(id, view.entry!);
  assert.equal(b.getState().derived.stats.get('stride')?.value, 80);
  assert.deepEqual(copy().library, { id: 'f-1', revision: 3 });
  assert.equal(copy().type, 'Deed');
  assert.equal(featureLinkView(copy(), ready(faster.file)).status, 'current');
});

test('a copy changed on the character is marked, never nagged, and an update says it replaces the change', () => {
  // Fails if `updateCustomFeature` stops marking a linked copy edited, or if the view stops wording the replacement.
  const b = keeper();
  const { file, entry } = addToLibrary(EMPTY_FEATURE_LIBRARY, { id: 'x', name: 'Godspeed', stats: [{ stat: 'stride', mode: 'set', value: 60 }] }, 'test', 'f-1');
  const id = b.giveLibraryFeature(entry)!;
  b.updateCustomFeature(id, { stats: [{ stat: 'stride', mode: 'set', value: 70 }] });
  const copy = () => b.getState().character.customFeatures!.find((f) => f.id === id)!;
  assert.deepEqual(copy().library, { id: 'f-1', revision: 1, edited: true });
  assert.deepEqual(featureLinkView(copy(), ready(file)), { status: 'edited', edited: true, save: 'Save changes to your feature library' });

  const newer = saveChangesToLibrary(file, 'f-1', { id: 'x', name: 'Godspeed', stats: [{ stat: 'stride', mode: 'set', value: 90 }] })!;
  const view = featureLinkView(copy(), ready(newer.file));
  assert.equal(view.status, 'update');
  assert.equal(view.note, 'Godspeed has changed in your feature library. Updating replaces the changes made to it here.');
  assert.equal(view.save, 'Save changes to your feature library, replacing its newer version');

  // Saved back: the library takes the copy, and the copy records the new revision and is no longer edited.
  const saved = saveChangesToLibrary(newer.file, 'f-1', copy())!;
  b.linkCustomFeature(id, saved.entry);
  assert.deepEqual(copy().library, { id: 'f-1', revision: 3 });
  assert.equal(saved.entry.stats[0]!.value, 70);
  assert.equal(featureLinkView(copy(), ready(saved.file)).status, 'current');

  // Gone from the library: still on the character, and it says so.
  assert.equal(featureLinkView(copy(), ready(EMPTY_FEATURE_LIBRARY)).note, 'Not in your feature library any more.');
  assert.equal(featureLinkView(copy(), undefined).status, 'current');
});

test("the library's type is used where the kind lists it, and the kind's default where not", () => {
  // Fails if `givenFeature` copies a type the kind does not list (the feature would be held nowhere).
  const entry = addToLibrary(EMPTY_FEATURE_LIBRARY, { id: 'x', name: 'Charge', type: 'Deed', stats: [] }, 'test', 'f-1').entry;
  const listing = keeper(['Knack', 'Deed']);
  const a = listing.giveLibraryFeature(entry)!;
  assert.equal(listing.getState().character.customFeatures!.find((f) => f.id === a)!.type, 'Deed');
  const plain = keeper();
  const b = plain.giveLibraryFeature(entry)!;
  assert.equal(plain.getState().character.customFeatures!.find((f) => f.id === b)!.type, undefined);
  assert.equal(plain.getState().customFeatures.features[0]!.type, 'Knack');
});

test('the checker refuses an id twice, and a file that does not read is unreadable, not empty', () => {
  // Fails if the duplicate check is removed, or if `readFeatureLibrary` reads a broken file as an empty library.
  const one = { id: 'f-1', system: 'test', revision: 1, name: 'A', stats: [] };
  assert.deepEqual(checkFeatureLibrary({ formatVersion: 1, features: [one, one] }, schema).errors, [
    { path: 'features[1].id', message: '"f-1" is already used by another feature' },
  ]);
  assert.equal(checkFeatureLibrary({ formatVersion: 1, features: [{ ...one, revision: 0 }] }, schema).value, undefined);
  assert.deepEqual(readFeatureLibrary(null, schema), { status: 'ready', file: EMPTY_FEATURE_LIBRARY });
  const bom = new TextEncoder().encode(`﻿${JSON.stringify({ formatVersion: 1, features: [one] })}`);
  assert.equal(readFeatureLibrary(bom, schema).status, 'ready');
  assert.equal(readFeatureLibrary(new TextEncoder().encode('{ "formatVersion": 1, "features": [ }'), schema).status, 'unreadable');
  assert.deepEqual(readFeatureLibrary(new TextEncoder().encode('{ "formatVersion": 2, "features": [] }'), schema), {
    status: 'unreadable',
    reason: 'This feature library (incudo-features.json) was written by a newer version of Incudo (format 2; this version reads up to 1). Update Incudo to open it.',
  });
});

class FolderStore implements CharacterStore {
  readonly available = true;
  files = new Map<string, Uint8Array>();
  location = async () => 'a folder';
  choose = async () => 'a folder';
  list = async (): Promise<LibraryEntryRef[]> => [];
  read = async () => new Map<string, Uint8Array>();
  write = async () => {};
  remove = async () => {};
  readFile = async (name: string) => this.files.get(name) ?? null;
  writeFile = async (name: string, bytes: Uint8Array) => {
    this.files.set(name, bytes);
  };
}

test('every write reads the file first, and a file that does not read is never written over', async () => {
  // Fails if `FeatureLibrary` writes from what it last loaded (the feature added elsewhere is lost), or writes over an
  // unreadable file.
  const store = new FolderStore();
  const library = new FeatureLibrary(store, schema);
  await library.load();
  assert.equal(library.getState().status, 'ready');
  const link = await library.save({ id: 'x', name: 'Godspeed', stats: [{ stat: 'stride', mode: 'set', value: 60 }] }, 'test');
  assert.equal(link?.revision, 1);

  // Another device adds one; this library has not loaded since.
  const read = readFeatureLibrary(store.files.get(FEATURE_LIBRARY_FILE)!, schema) as { file: FeatureLibraryFile };
  store.files.set(FEATURE_LIBRARY_FILE, encodeFeatureLibrary(addToLibrary(read.file, { id: 'y', name: 'Thick Hide', stats: [] }, 'test', 'f-other').file));
  const again = await library.save({ id: 'x', name: 'Godspeed', stats: [{ stat: 'stride', mode: 'set', value: 70 }], library: link! }, 'test');
  assert.deepEqual(again, { id: link!.id, revision: 2 });
  const after = readFeatureLibrary(store.files.get(FEATURE_LIBRARY_FILE)!, schema) as { file: FeatureLibraryFile };
  assert.deepEqual(after.file.features.map((f) => [f.name, f.revision]), [['Godspeed', 2], ['Thick Hide', 1]]);
  assert.equal(await library.remove('f-other'), true);
  assert.equal((readFeatureLibrary(store.files.get(FEATURE_LIBRARY_FILE)!, schema) as { file: FeatureLibraryFile }).file.features.length, 1);

  const broken = new TextEncoder().encode('{ "features": "hand edited" }');
  store.files.set(FEATURE_LIBRARY_FILE, broken);
  assert.equal(await library.save({ id: 'z', name: 'Keen', stats: [] }, 'test'), undefined);
  assert.equal(store.files.get(FEATURE_LIBRARY_FILE), broken);
  assert.equal(library.getState().status, 'unreadable');

  // A store with no file methods keeps no library.
  const { readFile: _r, writeFile: _w, ...bare } = new FolderStore();
  const none = new FeatureLibrary({ ...bare, available: true } as CharacterStore, schema);
  assert.equal(none.getState().status, 'unavailable');
});
