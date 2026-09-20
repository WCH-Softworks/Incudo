/**
 * "Save a copy…" — ADR 0038.
 *
 * Three claims, and each test names the one it holds:
 *
 *  1. **A copy is the file the library would write.** Same packing function, same bytes, from the
 *     character as it is on screen, and it opens with nothing configured (ADR 0012).
 *  2. **A copy is not a Save As.** It has no way to touch the library, its conflict check or the
 *     file being edited. This is held from both ends: the store is a spy that records every
 *     call, and the result is asserted to carry nothing a caller could point `working` at.
 *  3. **Cancelling is an answer.** Nothing is written, nothing is reported as wrong.
 *
 * What none of it can show is a real dialog or a real disk, which the desktop README says was and
 * was not seen. Each test was checked by breaking the behaviour it names; the ADR lists them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import {
  BundleElementIndex,
  MapElementIndex,
  collectCharacterContent,
  createCharacter,
  createZipCodec,
  deriveCharacter,
  packCharacterContainer,
  readCharacterContainer,
  resolveCharacterKind,
  setChoice,
  type Character,
  type CharacterStore,
  type Element,
  type ElementIndex,
  type FileSaveOptions,
  type FileSaver,
  type GameSystem,
  type LibraryEntryRef,
  type SavedFile,
  type ZipCodec,
} from '@incudo/core';
import type { ConfiguredSource } from '@incudo/content';

import { saveCopy } from './character-copy.ts';
import { CharacterLibrary, packCharacter, suggestedFileName } from './character-library.ts';

// --- fakes ------------------------------------------------------------------------------------

const zip: ZipCodec = createZipCodec({
  deflateRaw: (data) => new Uint8Array(deflateRawSync(data)),
  inflateRaw: (data) => new Uint8Array(inflateRawSync(data)),
});

/** A destination the user chose, recorded. `answer` is what the dialog reports. */
class FakeSaver implements FileSaver {
  available = true;
  unavailableReason: string | undefined;
  readonly calls: { bytes: Uint8Array; options: FileSaveOptions }[] = [];
  /** A name to hand back, `null` for a cancel, or an error to throw. */
  answer: SavedFile | null | Error = { name: 'chosen.incu' };

  async save(bytes: Uint8Array, options: FileSaveOptions): Promise<SavedFile | null> {
    this.calls.push({ bytes, options });
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}

/** A library folder that remembers every call made to it, so "never touched" is a fact. */
class SpyStore implements CharacterStore {
  readonly available = true;
  readonly entries = new Map<string, Map<string, Uint8Array>>();
  readonly log: string[] = [];

  async location(): Promise<string | null> {
    return '/characters';
  }
  async choose(): Promise<string | null> {
    return '/characters';
  }
  async list(): Promise<LibraryEntryRef[]> {
    this.log.push('list');
    return [...this.entries.keys()].map((name) => ({ name, form: 'zip' as const }));
  }
  async read(entry: LibraryEntryRef): Promise<Map<string, Uint8Array>> {
    this.log.push(`read ${entry.name}`);
    const found = this.entries.get(entry.name);
    if (!found) throw new Error('no such file');
    return new Map(found);
  }
  async write(entry: LibraryEntryRef, files: Map<string, Uint8Array>): Promise<void> {
    this.log.push(`write ${entry.name}`);
    this.entries.set(entry.name, new Map(files));
  }
  async remove(entry: LibraryEntryRef): Promise<void> {
    this.log.push(`remove ${entry.name}`);
    this.entries.delete(entry.name);
  }
}

// --- the smallest system that can own a character ---------------------------------------------

function testSystem(): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Widget' }],
    stats: [{ name: 'vigour', default: 10 }],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'level', min: 1, max: 5, stat: 'tier', elementIdPattern: 'ID_TIER_{n}' },
        elementTypes: ['Widget'],
        grants: ['ID_BASELINE'],
        buildSteps: [{ id: 'kin', label: 'Kin', types: ['Widget'] }],
        sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
      },
    ],
  };
}

function element(id: string, patch: Partial<Element> = {}): Element {
  return {
    id,
    name: id,
    type: 'Widget',
    setters: {},
    rules: [],
    supports: [],
    source: 'Test Book',
    origin: { sourceId: 'https://example.test/core.index', fileUrl: 'test.xml', format: 'incudo' },
    ...patch,
  };
}

function corpus(): ElementIndex {
  const index = new MapElementIndex();
  for (const id of ['ID_BASELINE', 'ID_TIER_1', 'ID_TIER_2', 'ID_KIN_RIVERFOLK', 'ID_KIN_HILLFOLK', 'ID_UNUSED']) {
    index.add(element(id));
  }
  return index;
}

const PROFILE: ConfiguredSource[] = [
  {
    id: 'https://example.test/core.index',
    url: 'https://example.test/core.index',
    name: 'Core',
    enabled: true,
    mode: 'stream',
    version: '3.0.0',
    addedAt: '2026-01-01T00:00:00.000Z',
  },
];

function hero(name = 'Aelin'): Character {
  let character = createCharacter('test', 'hero', { name, progress: 2 });
  character.id = 'fixed';
  character.createdAt = '2026-01-01T00:00:00.000Z';
  character = setChoice(character, 'build/kin', ['ID_KIN_RIVERFOLK']);
  // Last, because setChoice stamps updatedAt and the conflict check compares that field.
  character.updatedAt = '2026-01-02T00:00:00.000Z';
  return character;
}

async function unpack(bytes: Uint8Array) {
  const { container, problems } = readCharacterContainer(await zip.unzip(bytes));
  assert.ok(container, `the copy should read as a container: ${JSON.stringify(problems)}`);
  return { container, problems };
}

function sameFiles(a: Map<string, Uint8Array>, b: Map<string, Uint8Array>): void {
  assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort());
  for (const [path, bytes] of a) assert.deepEqual(bytes, b.get(path), path);
}

// --- claim 1: it is the file the library would write ------------------------------------------

test('a copy is byte for byte what the library writes for the same character', async () => {
  // The two paths share `packCharacter`. If a copy grew its own serializer this is the test
  // that would notice the first difference, including the manifest and the recorded sources.
  const character = hero();
  const store = new SpyStore();
  const library = new CharacterLibrary(store);
  await library.restore();
  library.setProfile(PROFILE);
  const saved = await library.save(character, testSystem(), corpus(), { generator: 'same' });
  assert.ok(saved.ok);

  const saver = new FakeSaver();
  const result = await saveCopy(saver, zip, character, testSystem(), corpus(), {
    profile: PROFILE,
    generator: 'same',
  });
  assert.equal(result.status, 'saved');

  const onDisk = store.entries.get(saved.entry.name)!;
  sameFiles(await zip.unzip(saver.calls[0]!.bytes), onDisk);
});

test('a copy records the source versions the profile holds, as a save does', async () => {
  const bare: Character = { ...hero(), sources: [] };
  const saver = new FakeSaver();
  await saveCopy(saver, zip, bare, testSystem(), corpus(), { profile: PROFILE });

  const { container } = await unpack(saver.calls[0]!.bytes);
  assert.deepEqual(
    container.character.sources?.map((s) => [s.id, s.version]),
    [['https://example.test/core.index', '3.0.0']],
  );
  // ...and with no profile it records nothing it was not told, rather than inventing a version.
  const none = new FakeSaver();
  await saveCopy(none, zip, bare, testSystem(), corpus());
  assert.deepEqual((await unpack(none.calls[0]!.bytes)).container.character.sources ?? [], []);
});

test('a copy is the character as it is now, unsaved edits included, and the file on disk is not touched', async () => {
  const saved = hero('Aelin');
  const store = new SpyStore();
  const library = new CharacterLibrary(store);
  await library.restore();
  const written = await library.save(saved, testSystem(), corpus());
  assert.ok(written.ok);
  const before = new Map(store.entries.get(written.entry.name)!);

  // Edited on screen and never saved: a new name and a different kin.
  const edited = setChoice({ ...saved, name: 'Aelin the Younger' }, 'build/kin', ['ID_KIN_HILLFOLK']);
  const saver = new FakeSaver();
  await saveCopy(saver, zip, edited, testSystem(), corpus());

  const { container } = await unpack(saver.calls[0]!.bytes);
  assert.equal(container.character.name, 'Aelin the Younger');
  assert.ok(container.content.elements.some((e) => e.id === 'ID_KIN_HILLFOLK'), 'the new choice is embedded');
  assert.ok(!container.content.elements.some((e) => e.id === 'ID_KIN_RIVERFOLK'), 'and the old one is not');
  sameFiles(store.entries.get(written.entry.name)!, before);
});

test('a copy opens with zero sources and derives exactly as the original does', async () => {
  // ADR 0012, on a copy. The original derives against the whole corpus; the copy is read back
  // through nothing but its own embedded content.
  const character = hero();
  const saver = new FakeSaver();
  await saveCopy(saver, zip, character, testSystem(), corpus(), { profile: PROFILE });

  const { container } = await unpack(saver.calls[0]!.bytes);
  const alone = new BundleElementIndex(container.content.elements);
  // The derived numbers and the elements they came from. Not the whole result: it carries the
  // character back, and a copy legitimately records the sources it was built against.
  const fromCopy = deriveCharacter(container.character, testSystem(), alone);
  const original = deriveCharacter(character, testSystem(), corpus());
  assert.deepEqual([...fromCopy.stats], [...original.stats]);
  assert.deepEqual([...fromCopy.elementIds].sort(), [...original.elementIds].sort());
  assert.deepEqual(fromCopy.pendingChoices, original.pendingChoices);
  assert.deepEqual(fromCopy.problems, original.problems);
  assert.ok(alone.get('ID_TIER_2'), 'the progression element is embedded');
  assert.ok(alone.get('ID_BASELINE'), "and the kind's baseline");
  assert.equal(alone.get('ID_UNUSED'), undefined, 'and nothing else');
});

test('the dialog is offered the character\'s name as a .incu, with a filter for it', async () => {
  const saver = new FakeSaver();
  await saveCopy(saver, zip, hero('Aelin of the Reeds'), testSystem(), corpus());
  const { options } = saver.calls[0]!;
  assert.equal(options.suggestedName, 'aelin-of-the-reeds.incu');
  assert.deepEqual(options.extensions, ['incu']);
  assert.equal(options.label, 'Incudo character');
  assert.doesNotMatch(`${options.title} ${options.label}`, /\badr\b|\d{4}|_/i);

  assert.equal(suggestedFileName(''), 'character.incu');
  assert.equal(suggestedFileName('Zoë / Ünder: "Ash"'), 'zoe-under-ash.incu');
});

test('what the result names is what the user typed, not what was offered', async () => {
  const saver = new FakeSaver();
  saver.answer = { name: 'backup-before-level-3.incu' };
  const result = await saveCopy(saver, zip, hero(), testSystem(), corpus());
  assert.equal(result.status === 'saved' && result.file.name, 'backup-before-level-3.incu');
  assert.equal(result.status === 'saved' && result.elementCount > 0, true);
});

// --- claim 2: it is not a Save As -------------------------------------------------------------

test('a copy never touches the library, its conflict check or the file being edited', async () => {
  const character = hero();
  const store = new SpyStore();
  const library = new CharacterLibrary(store);
  await library.restore();
  const written = await library.save(character, testSystem(), corpus());
  assert.ok(written.ok);

  // What the shell holds while editing: the entry, and the timestamp its next Save will send.
  const entry = written.entry;
  const readAt = library.getState().entries[0]!.updatedAt;
  const stateBefore = library.getState();
  const bytesBefore = new Map(store.entries.get(entry.name)!);
  const logBefore = [...store.log];
  let notified = 0;
  library.subscribe(() => notified++);

  const saver = new FakeSaver();
  const result = await saveCopy(saver, zip, { ...character, name: 'Renamed for the copy' }, testSystem(), corpus());
  assert.equal(result.status, 'saved');

  // Not one call reached the store: no write, and none of the reads the conflict check makes,
  // and no listing that would have made the library's own view stale.
  assert.deepEqual(store.log, logBefore, 'the store was not called');
  assert.equal(library.getState(), stateBefore, 'the library state is the same object');
  assert.equal(notified, 0, 'and nobody was told anything changed');
  sameFiles(store.entries.get(entry.name)!, bytesBefore);

  // The next Save from the same editing session still carries the same `readAt`, and lands.
  const next = await library.save(character, testSystem(), corpus(), {
    entry,
    expectUpdatedAt: readAt,
  });
  assert.ok(next.ok, next.ok ? '' : `${next.reason}: ${next.message}`);
});

test('a copy hands a caller nothing to point the editing session at', async () => {
  // `working.entry`, `working.readAt` and `working.savedName` are set from a save's result. A
  // copy's result has no entry, no timestamp and no name of the character to remember, so there
  // is nothing to assign even by mistake. Adding one would have to change this list.
  const saver = new FakeSaver();
  const result = await saveCopy(saver, zip, hero(), testSystem(), corpus());
  assert.deepEqual(Object.keys(result).sort(), ['elementCount', 'file', 'status', 'unresolved']);
  assert.deepEqual(Object.keys((result as { file: object }).file), ['name']);
});

test('the file it writes is not registered anywhere: the library still lists what it listed', async () => {
  const store = new SpyStore();
  const library = new CharacterLibrary(store);
  await library.restore();
  await library.save(hero('Aelin'), testSystem(), corpus());
  const listed = library.getState().entries.map((e) => e.name);

  await saveCopy(new FakeSaver(), zip, hero('Someone else'), testSystem(), corpus());
  await library.refresh();
  assert.deepEqual(library.getState().entries.map((e) => e.name), listed);
});

// --- claim 3: cancelling is an answer ---------------------------------------------------------

test('cancelling the dialog is a result, writes nothing and is not a failure', async () => {
  const saver = new FakeSaver();
  saver.answer = null;
  const result = await saveCopy(saver, zip, hero(), testSystem(), corpus());
  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(saver.calls.length, 1, 'the dialog was shown');
});

test('a write that fails is reported with its message, never thrown', async () => {
  const saver = new FakeSaver();
  saver.answer = new Error('The disk is full.');
  const result = await saveCopy(saver, zip, hero(), testSystem(), corpus());
  assert.deepEqual(result, { status: 'failed', message: 'The disk is full.' });
});

test('a platform with no save dialog says why and shows nothing', async () => {
  const saver = new FakeSaver();
  saver.available = false;
  saver.unavailableReason = 'This browser cannot save a file to your computer.';
  const result = await saveCopy(saver, zip, hero(), testSystem(), corpus());
  assert.deepEqual(result, { status: 'failed', message: 'This browser cannot save a file to your computer.' });
  assert.equal(saver.calls.length, 0);
});

test('a character that cannot be packed is reported before any dialog opens', async () => {
  const saver = new FakeSaver();
  const broken = { ...hero(), kind: 'nonexistent' };
  const result = await saveCopy(saver, zip, broken, testSystem(), corpus());
  assert.equal(result.status, 'failed');
  assert.equal(saver.calls.length, 0, 'the user was not asked for a place to put nothing');
});

// --- the shared packing function --------------------------------------------------------------

test('packCharacter is the one path: the library and a copy embed the same content', () => {
  // The library's Save was rewritten to call this, so a divergence would have to be introduced
  // on purpose. What this holds is that it still packs what `collectCharacterContent` reaches.
  const character = hero();
  const packed = packCharacter(character, testSystem(), corpus());
  const direct = collectCharacterContent(character, corpus(), {
    kind: resolveCharacterKind(testSystem(), 'hero'),
  });
  assert.deepEqual(
    packed.content.elements.map((e) => e.id).sort(),
    direct.elements.map((e) => e.id).sort(),
  );
  assert.deepEqual(
    packed.files,
    packCharacterContainer(character, packed.content, { now: '2026-01-02T00:00:00.000Z' }),
  );
});
