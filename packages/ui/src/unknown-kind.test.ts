/**
 * A character whose kind the system does not declare is said, not thrown.
 *
 * A character records its kind by id, and a system can stop declaring one (5e's sidekick was removed; a user's own
 * system can be edited). The builder resolves the kind and throws on one the system lacks, and the desktop shell built
 * one from the stored draft before anything else was on screen, so a draft of a removed kind left a blank window. Found
 * by running the browser build with a sidekick draft from an earlier drive.
 *
 * Held here: the draft is set aside under its own key with what was kept beside it, the shell is given a sentence, and a
 * library file of such a kind opens as a file and is named the same way. What is not held here is the shell showing it,
 * which the browser build was driven for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapElementIndex, MemoryStorage, createCharacter, type Character, type CharacterStore, type GameSystem, type LibraryEntryRef } from '@incudo/core';

import { characterKindMissing } from './character-kinds.ts';
import { CharacterLibrary } from './character-library.ts';
import { DRAFT_KEY, DRAFT_ORIGIN_KEY, DRAFT_SET_ASIDE_PREFIX, readDraftCharacter } from './draft.ts';
import { CharacterBuilder } from './use-character-builder.ts';

function kind(id: string, isDefault = false): GameSystem['characterKinds'][number] {
  return {
    id,
    name: id === 'hero' ? 'Hero' : 'Helper',
    ...(isDefault ? { default: true } : {}),
    progression: { kind: 'none' },
    buildSteps: [],
    sheet: { sections: [] },
  };
}

/** The system as it was when the helper was built, and as it is now. */
const before: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test Game',
  version: '1.0.0',
  elementTypes: [],
  stats: [],
  characterKinds: [kind('hero', true), kind('helper')],
};
const now: GameSystem = { ...before, characterKinds: [kind('hero', true)] };

function helper(): Character {
  const character = createCharacter('test', 'helper', { name: 'Pip' });
  character.id = 'draft-pip';
  return character;
}

/** What the desktop's boot passes: the schema check, here only "is it a character". */
const validate = (value: unknown): Character | undefined => value as Character;

test('the builder throws on a kind the system lacks, which is why nothing may hand it one', () => {
  assert.throws(() => new CharacterBuilder(helper(), now, new MapElementIndex()), /no character kind "helper"/);
  assert.doesNotThrow(() => new CharacterBuilder(helper(), before, new MapElementIndex()));
});

test('a draft of a kind the system does not declare is set aside, with what was kept beside it, and said', async () => {
  const storage = new MemoryStorage();
  const text = JSON.stringify(helper());
  await storage.write(DRAFT_KEY, text);
  await storage.write(DRAFT_ORIGIN_KEY, '{"formatVersion":1,"characterId":"draft-pip"}');

  const read = await readDraftCharacter(now, storage, validate);
  assert.equal(read.character, undefined, 'no character to build');
  assert.equal(
    read.setAside,
    '“Pip” is a kind of character (helper) that Test Game does not have, so it cannot be opened. ' +
      'It was the character you were editing last, and it has been set aside, not deleted.',
  );
  assert.equal(await storage.read(`${DRAFT_SET_ASIDE_PREFIX}draft-pip`), text, 'the draft is kept as it was');
  assert.equal(await storage.read(`${DRAFT_SET_ASIDE_PREFIX}draft-pip:origin`), await storage.read(DRAFT_ORIGIN_KEY));
});

test('a draft of a declared kind is opened, and one of another system is left alone', async () => {
  const storage = new MemoryStorage();
  await storage.write(DRAFT_KEY, JSON.stringify(helper()));
  const read = await readDraftCharacter(before, storage, validate);
  assert.equal(read.character?.id, 'draft-pip');
  assert.equal(read.setAside, undefined);

  const other = await readDraftCharacter({ ...now, id: 'other' }, storage, validate);
  assert.deepEqual(other, {}, "another system's draft is not this one's to set aside");
  assert.deepEqual(await storage.list(DRAFT_SET_ASIDE_PREFIX), []);
});

test('no draft, one that does not read, and a storage that throws all give nothing', async () => {
  const empty = new MemoryStorage();
  assert.deepEqual(await readDraftCharacter(now, empty, validate), {});
  await empty.write(DRAFT_KEY, '{not json');
  assert.deepEqual(await readDraftCharacter(now, empty, validate), {});
  const throwing = new MemoryStorage();
  throwing.read = async () => {
    throw new Error('locked');
  };
  assert.deepEqual(await readDraftCharacter(now, throwing, validate), {});
});

class MemoryStore implements CharacterStore {
  readonly available = true;
  readonly entries = new Map<string, Map<string, Uint8Array>>();
  async location(): Promise<string | null> {
    return '/characters';
  }
  async choose(): Promise<string | null> {
    return '/characters';
  }
  async list(): Promise<LibraryEntryRef[]> {
    return [...this.entries.keys()].map((name) => ({ name, form: 'zip' as const }));
  }
  async read(entry: LibraryEntryRef): Promise<Map<string, Uint8Array>> {
    return new Map(this.entries.get(entry.name)!);
  }
  async write(entry: LibraryEntryRef, files: Map<string, Uint8Array>): Promise<void> {
    this.entries.set(entry.name, new Map(files));
  }
  async remove(entry: LibraryEntryRef): Promise<void> {
    this.entries.delete(entry.name);
  }
}

test('a library file of a kind the system does not declare opens as a file and is named, not built', async () => {
  const library = new CharacterLibrary(new MemoryStore());
  await library.restore();
  const saved = await library.save(helper(), before, new MapElementIndex());
  assert.ok(saved.ok);

  const opened = await library.open(saved.entry.name);
  assert.ok(opened, 'the file reads');
  assert.match(characterKindMissing(now, opened.character) ?? '', /^“Pip” is a kind of character \(helper\) that Test Game does not have/);
  assert.equal(characterKindMissing(before, opened.character), undefined);
  assert.equal(
    characterKindMissing(now, { ...opened.character, name: '  ' }),
    'This character is a kind of character (helper) that Test Game does not have, so it cannot be opened.',
  );
});
