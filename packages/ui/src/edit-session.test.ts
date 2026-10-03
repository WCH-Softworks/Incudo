/**
 * Saving a character being built or edited (`edit-session.ts`, ADR 0086). Each case names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  MapElementIndex,
  readCharacterContainer,
  setChoice,
  type CharacterStore,
  type Element,
  type GameSystem,
  type LibraryEntryRef,
} from '@incudo/core';

import { CharacterLibrary } from './character-library.ts';
import { beginEdit, hasUnsavedChanges, saveEdit } from './edit-session.ts';

class MapStore implements CharacterStore {
  readonly available = true;
  readonly files = new Map<string, Map<string, Uint8Array>>();
  async location(): Promise<string | null> {
    return 'here';
  }
  async choose(): Promise<string | null> {
    return 'here';
  }
  async list(): Promise<LibraryEntryRef[]> {
    return [...this.files.keys()].map((name) => ({ name, form: 'zip' as const }));
  }
  async read(entry: LibraryEntryRef): Promise<Map<string, Uint8Array>> {
    return new Map(this.files.get(entry.name)!);
  }
  async write(entry: LibraryEntryRef, files: Map<string, Uint8Array>): Promise<void> {
    this.files.set(entry.name, new Map(files));
  }
  async remove(entry: LibraryEntryRef): Promise<void> {
    this.files.delete(entry.name);
  }
}

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Widget' }],
  stats: [],
  characterKinds: [
    {
      id: 'hero',
      name: 'Hero',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Widget'],
      buildSteps: [{ id: 'kin', label: 'Kin', types: ['Widget'], required: true }],
      sheet: { sections: [] },
    },
  ],
} as unknown as GameSystem;

const widget = (id: string): Element => ({
  id,
  name: id,
  type: 'Widget',
  setters: {},
  rules: [],
  supports: [],
  source: 'Test',
  origin: { sourceId: 'test', format: 'incudo' },
});

function index(): MapElementIndex {
  const elements = new MapElementIndex();
  elements.add(widget('ID_KIN'));
  elements.add(widget('ID_OTHER_KIN'));
  return elements;
}

async function library(): Promise<[CharacterLibrary, MapStore]> {
  const store = new MapStore();
  const lib = new CharacterLibrary(store);
  await lib.restore();
  return [lib, store];
}

test('a new character is written to a file of its own, and later Saves write to that file', async () => {
  // Perturbation: not carrying `result.entry` into the session makes the second Save write "hero (2).incu" beside it.
  const [lib, store] = await library();
  let character = setChoice(createCharacter('test', 'hero', { name: 'Hero' }), 'build/kin', ['ID_KIN']);
  let session = beginEdit(character);
  const first = await saveEdit(lib, session, character, system, index(), 'test');
  assert.ok(first.ok);
  session = first.session;
  character = { ...setChoice(character, 'build/kin', ['ID_OTHER_KIN']), name: 'Renamed' };
  const second = await saveEdit(lib, session, character, system, index(), 'test');
  assert.ok(second.ok);
  assert.deepEqual([...store.files.keys()], [first.entry.name]);
  const { container } = readCharacterContainer(store.files.get(first.entry.name)!);
  assert.deepEqual(container!.content.elements.map((e) => e.id), ['ID_OTHER_KIN'], 'the file embeds what it reaches now');
});

test('nothing is unsaved after a Save, and an edit is', async () => {
  // Perturbation: leaving `saved` as it was opened reports a change after every Save, so leaving always asks.
  const [lib] = await library();
  const character = setChoice(createCharacter('test', 'hero', { name: 'Hero' }), 'build/kin', ['ID_KIN']);
  const opened = beginEdit(character);
  assert.equal(hasUnsavedChanges(opened, character), false);
  const edited = { ...character, name: 'Other' };
  assert.equal(hasUnsavedChanges(opened, edited), true);
  const saved = await saveEdit(lib, opened, edited, system, index(), 'test');
  assert.ok(saved.ok);
  assert.equal(hasUnsavedChanges(saved.session, edited), false);
});

test('a Save over a file changed elsewhere since it was read is refused, and the session is kept', async () => {
  // Perturbation: saving without `expectUpdatedAt` overwrites the other device's change.
  const [lib, store] = await library();
  const character = setChoice(createCharacter('test', 'hero', { name: 'Hero' }), 'build/kin', ['ID_KIN']);
  const first = await saveEdit(lib, beginEdit(character), character, system, index(), 'test');
  assert.ok(first.ok);
  // Another device writes the same file later.
  const theirs = { ...character, name: 'Theirs', updatedAt: '2099-01-01T00:00:00.000Z' };
  const other = new CharacterLibrary(store);
  await other.restore();
  assert.ok((await other.save(theirs, system, index(), { entry: first.entry, expectUpdatedAt: first.session.readAt })).ok);
  await lib.refresh();
  const mine = await saveEdit(lib, first.session, { ...character, name: 'Mine' }, system, index(), 'test');
  assert.equal(mine.ok, false);
  assert.equal(!mine.ok && mine.reason, 'conflict');
});

test("a file's assets are written back with it", async () => {
  // Perturbation: dropping `assets` from the save loses the portrait the file carried (CLAUDE.md, ADR 0038).
  const [lib, store] = await library();
  const character = { ...setChoice(createCharacter('test', 'hero', { name: 'Hero' }), 'build/kin', ['ID_KIN']), assets: { portrait: 'assets/portrait.png' } };
  const assets = new Map([['assets/portrait.png', new Uint8Array([1, 2, 3])]]);
  const saved = await saveEdit(lib, beginEdit(character, { assets }), character, system, index(), 'test');
  assert.ok(saved.ok);
  assert.deepEqual([...store.files.get(saved.entry.name)!.get('assets/portrait.png')!], [1, 2, 3]);
});
