/**
 * Files handed to the app from outside it — ADR 0099.
 *
 * What a file is decides by its contents, a character is added unchanged and never over a file already there, an Aurora
 * save is named and not imported, and a share that starts the app waits for the library before naming anything. Each
 * test names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import {
  MapElementIndex,
  collectCharacterContent,
  createCharacter,
  createZipCodec,
  packCharacterContainer,
  type CharacterStore,
  type LibraryEntryRef,
  type ZipCodec,
} from '@incudo/core';

import { CharacterLibrary } from './character-library.ts';
import { isAuroraSave, receiveFiles, receivedView, type ReceivedFile } from './received-files.ts';

const zip: ZipCodec = createZipCodec({
  deflateRaw: (data) => new Uint8Array(deflateRawSync(data)),
  inflateRaw: (data) => new Uint8Array(inflateRawSync(data)),
});

class MapStore implements CharacterStore {
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
    const found = this.entries.get(entry.name);
    if (!found) throw new Error('no such file');
    return new Map(found);
  }
  async write(entry: LibraryEntryRef, files: Map<string, Uint8Array>): Promise<void> {
    this.entries.set(entry.name, new Map(files));
  }
  async remove(entry: LibraryEntryRef): Promise<void> {
    this.entries.delete(entry.name);
  }
}

function container(name: string): Map<string, Uint8Array> {
  const character = createCharacter('test', 'hero', { name, progress: 1 });
  character.id = `id-${name}`;
  return packCharacterContainer(character, collectCharacterContent(character, new MapElementIndex()), {
    now: '2026-01-02T00:00:00.000Z',
  });
}

async function shared(name: string | undefined, character: string): Promise<ReceivedFile> {
  return { ...(name !== undefined ? { name } : {}), bytes: await zip.zip(container(character)) };
}

async function library(...names: string[]): Promise<[CharacterLibrary, MapStore]> {
  const store = new MapStore();
  for (const name of names) store.entries.set(`${name.toLowerCase()}.incu`, container(name));
  return [new CharacterLibrary(store), store];
}

test('a shared character is added unchanged under the name it came with', async () => {
  const [lib, store] = await library();
  await lib.restore();
  const file = await shared('Vesper of the Marsh.incu', 'Vesper');
  const outcomes = await receiveFiles(lib, zip, [file]);
  // Fails if the files are repacked (the manifest's bytes would differ) or the name comes from the character.
  assert.deepEqual(outcomes, [
    { status: 'added', entry: { name: 'vesper-of-the-marsh.incu', form: 'zip' }, title: 'Vesper', message: 'Added Vesper.' },
  ]);
  assert.deepEqual(store.entries.get('vesper-of-the-marsh.incu'), await zip.unzip(file.bytes));
  assert.deepEqual(receivedView(outcomes), {
    title: 'Added to your characters',
    lines: ['Added Vesper.'],
    open: { name: 'vesper-of-the-marsh.incu', title: 'Vesper' },
  });
});

test('a share with no name, or a name without .incu, is named after the character', async () => {
  const [lib] = await library();
  await lib.restore();
  // Fails if the extension decides (both are refused) or the sender's opaque name is used ("1000034.incu").
  const outcomes = await receiveFiles(lib, zip, [await shared(undefined, 'Aelin'), await shared('1000034', 'Borin')]);
  assert.deepEqual(
    outcomes.map((outcome) => (outcome.status === 'added' ? outcome.entry.name : outcome.status)),
    ['aelin.incu', 'borin.incu'],
  );
});

test('a taken name is never written over, and the sentence says which name was used', async () => {
  const [lib, store] = await library('Aelin');
  await lib.restore();
  const before = store.entries.get('aelin.incu');
  const outcomes = await receiveFiles(lib, zip, [await shared('AELIN.incu', 'Another')]);
  // Fails if the existing file is replaced, or if the sentence reads as if the file kept its name.
  assert.equal(store.entries.get('aelin.incu'), before);
  assert.deepEqual(outcomes.map((outcome) => outcome.message), [
    'Added Another as aelin-2.incu; the library already had a file called aelin.incu.',
  ]);
});

test('a share that starts the app waits for the library before naming the file', async () => {
  const [lib, store] = await library('Aelin');
  // Not restored: the app was opened by the share. Fails without the restore in `receiveFiles` (refused: no folder
  // chosen), and would overwrite aelin.incu if the name were chosen before the scan had listed it.
  const before = store.entries.get('aelin.incu');
  const outcomes = await receiveFiles(lib, zip, [await shared('aelin.incu', 'Another')]);
  assert.equal(outcomes[0]!.status, 'added');
  assert.equal(outcomes[0]!.status === 'added' && outcomes[0]!.entry.name, 'aelin-2.incu');
  assert.equal(store.entries.get('aelin.incu'), before);
});

test('an Aurora save in UTF-16 or with a comment first is recognised; other XML is not', () => {
  const utf16 = (text: string): Uint8Array => {
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) bytes[2 + i * 2] = text.charCodeAt(i);
    return bytes;
  };
  const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
  // Fails if zero bytes are kept (UTF-16) or comments are not skipped.
  assert.equal(isAuroraSave(utf16('<?xml version="1.0" encoding="utf-16"?>\n<character version="1.0">')), true);
  assert.equal(isAuroraSave(utf8('<?xml version="1.0"?><!-- saved --><character>')), true);
  // Fails if any element starting with "character" counts.
  assert.equal(isAuroraSave(utf8('<?xml version="1.0"?><characters/>')), false);
  assert.equal(isAuroraSave(utf8('<?xml version="1.0"?><elements><character/></elements>')), false);
});

test('anything else is refused with a sentence and nothing is written', async () => {
  const [lib, store] = await library();
  await lib.restore();
  const notes = { name: 'notes.txt', bytes: new TextEncoder().encode('hello') };
  const fakeZip = { name: 'broken.incu', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]) };
  const otherZip = { name: 'photos.zip', bytes: await zip.zip(new Map([['a.txt', new TextEncoder().encode('a')]])) };
  const outcomes = await receiveFiles(lib, zip, [notes, fakeZip, otherZip, await shared('ok.incu', 'Kept')]);
  // Fails if a bad file stops the rest, or if a zip that is not a character is added.
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ['refused', 'refused', 'refused', 'added']);
  assert.equal(outcomes[0]!.message, '"notes.txt" is not an Incudo character file (.incu).');
  assert.deepEqual([...store.entries.keys()], ['ok.incu']);
  // One character added among refusals: still offered to open, under a title that says not everything went in.
  assert.deepEqual(receivedView(outcomes).title, 'Some files were not added');
  assert.deepEqual(receivedView(outcomes).open, { name: 'ok.incu', title: 'Kept' });
});

test('two characters added offer none to open', async () => {
  const [lib] = await library();
  await lib.restore();
  const outcomes = await receiveFiles(lib, zip, [await shared('a.incu', 'A'), await shared('b.incu', 'B')]);
  // Fails if the first of several is opened, which would hide the second.
  assert.equal(receivedView(outcomes).open, undefined);
  assert.deepEqual(receivedView(outcomes).lines, ['Added A.', 'Added B.']);
});

test('a file the platform could not read is named, and the rest are still added', async () => {
  const [lib, store] = await library();
  await lib.restore();
  const lost = { name: 'lost.incu', bytes: new Uint8Array(), unreadable: 'permission denied' };
  const outcomes = await receiveFiles(lib, zip, [lost, { bytes: new Uint8Array(), unreadable: 'gone' }, await shared('ok.incu', 'Kept')]);
  // Fails if an unreadable file is read as empty bytes ("not an Incudo character file") or stops the rest.
  assert.deepEqual(outcomes.map((outcome) => outcome.message), [
    'Could not read "lost.incu": permission denied',
    'Could not read the file: gone',
    'Added Kept.',
  ]);
  assert.deepEqual([...store.entries.keys()], ['ok.incu']);
});

test("a provider's id for a file is not quoted as its name", async () => {
  const [lib] = await library();
  await lib.restore();
  const aurora = new TextEncoder().encode('<?xml version="1.0"?><character version="1.0"/>');
  const outcomes = await receiveFiles(lib, zip, [
    { name: 'msf:44', bytes: aurora },
    { name: '1000034', bytes: new TextEncoder().encode('hello') },
    { name: 'save.dnd5e', bytes: aurora },
  ]);
  // Fails if any name is quoted whatever its shape ("msf:44" is what Android's Recent files hand the picker).
  assert.deepEqual(outcomes.map((outcome) => outcome.message.split(' is ')[0]), ['The file', 'The file', '"save.dnd5e"']);
});
