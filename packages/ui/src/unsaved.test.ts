/**
 * Whether the character on screen has unsaved changes, and what Open, New character and a change of system do about it
 * (`unsaved.ts`, ADR 0120). Each case names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MapElementIndex,
  MemoryStorage,
  setChoice,
  setName,
  setPlayState,
  type Character,
  type CharacterStore,
  type Element,
  type GameSystem,
  type LibraryEntryRef,
} from '@incudo/core';

import { CharacterLibrary } from './character-library.ts';
import { newCharacterOfKind } from './character-kinds.ts';
import { decodeDraftOrigin, readDraftOrigin, writeDraftOrigin, type WorkingCharacter } from './draft.ts';
import { CharacterBuilder } from './use-character-builder.ts';
import { editState, openOutcome, replacePrompt, sameCharacter } from './unsaved.ts';

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

const hero = (): Character => setChoice(newCharacterOfKind(system, 'hero', 'Hero'), 'build/kin', ['ID_KIN']);

test('a character is the same whatever its stamp and the order of its keys, and not after an edit', () => {
  // Perturbation: comparing `updatedAt` too makes an edit undone read as unsaved for ever.
  const character = hero();
  const reordered = Object.fromEntries(Object.entries(character).reverse()) as unknown as Character;
  assert.ok(sameCharacter(character, { ...reordered, updatedAt: '2099-01-01T00:00:00.000Z' }));
  assert.ok(!sameCharacter(character, setChoice(character, 'build/kin', ['ID_OTHER_KIN'])));
  const undone = setChoice(setChoice(character, 'build/kin', ['ID_OTHER_KIN']), 'build/kin', ['ID_KIN']);
  assert.ok(sameCharacter(character, undone), 'an edit undone is no change');
});

test('play spent and rested back is no change, though it raised the format version', () => {
  // Perturbation: comparing `formatVersion` leaves a character "unsaved" after a long rest gives back what it spent
  // (seen in the Tauri window: a legendary creature's actions spent and restored).
  const character = hero();
  const spent = setPlayState(character, { spent: { hp: 5 } });
  const rested = setPlayState(spent, {});
  assert.equal(rested.play, undefined);
  assert.ok(rested.formatVersion > character.formatVersion, 'the fixture is the case: the version stays raised');
  assert.ok(sameCharacter(character, rested));
  assert.ok(!sameCharacter(character, spent));
});

test('a character opened from the library reads as saved in the builder, and an edit makes it unsaved', async () => {
  // Perturbation: a builder that rewrote the character it was handed would make every Open read as unsaved; reading
  // `working.character` instead of the builder's character would never see an edit (the bug: "Saved to …" over edits).
  const store = new MapStore();
  const library = new CharacterLibrary(store);
  await library.restore();
  const saved = await library.save(hero(), system, index(), { generator: 'test' });
  assert.ok(saved.ok);
  const opened = await library.open(saved.entry.name);
  assert.ok(opened);

  const working: WorkingCharacter = {
    character: opened.character,
    embedded: opened.elements,
    entry: saved.entry,
    savedName: opened.character.name,
    baseline: opened.character,
  };
  const builder = new CharacterBuilder(opened.character, system, opened.elements);
  assert.deepEqual(editState(working, builder.getState().character, system), { started: true, unsaved: false });

  builder.choose('build/kin', ['ID_OTHER_KIN']);
  assert.deepEqual(editState(working, builder.getState().character, system), { started: true, unsaved: true });
});

test('before anything is started there is nothing to build, and New character starts one with nothing unsaved', () => {
  // Perturbation: reading a working state with no baseline as started puts the Build pane's count and the builder in
  // front of a user who has opened nothing (the app's first launch).
  const blank = newCharacterOfKind(system, 'hero');
  assert.deepEqual(editState({ character: blank }, blank, system), { started: false, unsaved: false });

  const fresh = newCharacterOfKind(system, 'hero');
  assert.deepEqual(editState({ character: fresh, baseline: fresh }, fresh, system), { started: true, unsaved: false });
  const named = setName(fresh, 'Someone');
  assert.deepEqual(editState({ character: fresh, baseline: fresh }, named, system), { started: true, unsaved: true });
});

test('a draft kept before the baseline was: a blank one is not started, an edited or filed one is unsaved', () => {
  // Perturbation: reading every draft without a baseline as not started hides a character the user was building before
  // this change; reading one from the library as saved would let Open read the file over its edits.
  const edited = hero();
  assert.deepEqual(editState({ character: edited }, edited, system), { started: true, unsaved: true });
  const filed = newCharacterOfKind(system, 'hero');
  const entry = { name: 'hero.incu', form: 'zip' as const };
  assert.deepEqual(editState({ character: filed, entry, savedName: filed.name }, filed, system), {
    started: true,
    unsaved: true,
  });
});

test('Open on the character on screen shows it while it has unsaved changes, asks for another, and reads a saved one', () => {
  // Perturbation: always `open` is the bug, the file read over the edits without a word; `show` for every card would
  // never open another character while one is unsaved.
  const character = hero();
  const entry = { name: 'hero.incu', form: 'zip' as const };
  const working: WorkingCharacter = { character, entry, savedName: 'Hero', baseline: character };
  const unsaved = { started: true, unsaved: true };
  const saved = { started: true, unsaved: false };
  assert.equal(openOutcome(working, unsaved, entry), 'show');
  assert.equal(openOutcome(working, unsaved, { name: 'other.incu', form: 'zip' }), 'ask');
  assert.equal(openOutcome(working, unsaved, { name: 'hero.incu', form: 'folder' }), 'ask', 'another file of that name');
  assert.equal(openOutcome(working, saved, entry), 'open', 'read again: the file may have changed on disk');
  assert.equal(openOutcome({ character, baseline: character }, unsaved, entry), 'ask', 'a new character is in no file');
});

test('the question names the character and what would replace it, and offers Save only with a library', () => {
  const asked = replacePrompt({ kind: 'open', name: 'Mira' }, 'Hero', true);
  assert.match(asked.lede, /^Hero has changes that are not saved to your library\. Opening Mira will replace them\.$/);
  assert.equal(asked.save, 'Save first');
  assert.equal(replacePrompt({ kind: 'new' }, ' ', false).save, undefined);
  assert.match(replacePrompt({ kind: 'new' }, ' ', false).lede, /^This character has/);
  assert.match(replacePrompt({ kind: 'system' }, 'Hero', true).lede, /Changing the system will replace them/);
});

test('the draft keeps the baseline, for this character only', async () => {
  // Perturbation: not writing `baseline` makes every reload read as "unsaved" (or, with no entry, as nothing started).
  const character = hero();
  const storage = new MemoryStorage();
  await writeDraftOrigin(storage, character.id, { baseline: character });
  const back = await readDraftOrigin(storage, character.id);
  assert.ok(back.baseline && sameCharacter(back.baseline, character));
  assert.deepEqual(await readDraftOrigin(storage, 'someone-else'), {});
  const another = JSON.stringify({ formatVersion: 1, characterId: character.id, baseline: { ...character, id: 'other' } });
  assert.deepEqual(decodeDraftOrigin(another, character.id), {}, "a baseline that is not this character's");
});
