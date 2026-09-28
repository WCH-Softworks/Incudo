/**
 * The draft keeps what the shell held beside the character — ADR 0066.
 *
 * Three claims, and each test names the one it holds:
 *
 *  1. **A reload changes nothing.** A character opened from the library and read back through the
 *     draft with no source derives as it did when opened, and its next Save goes to the file it came
 *     from, with the same content embedded. Without the kept record neither holds: that is the bug,
 *     asserted here as the control.
 *  2. **The bytes come back.** Every asset, every byte value, every length modulo three.
 *  3. **All of it or none.** A record for another character, or one that does not read, keeps
 *     nothing; a new character keeps no record at all.
 *
 * What none of it shows is the shell's own two effects, which the browser build was driven for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import {
  MapElementIndex,
  MemoryStorage,
  createCharacter,
  createZipCodec,
  deriveCharacter,
  setChoice,
  type Character,
  type CharacterStore,
  type Element,
  type ElementIndex,
  type GameSystem,
  type LibraryEntryRef,
  type ZipCodec,
} from '@incudo/core';

import { CharacterLibrary } from './character-library.ts';
import {
  DRAFT_ORIGIN_KEY,
  decodeDraftOrigin,
  encodeDraftOrigin,
  readDraftOrigin,
  writeDraftOrigin,
  type DraftOrigin,
} from './draft.ts';

// --- fakes ------------------------------------------------------------------------------------

const zip: ZipCodec = createZipCodec({
  deflateRaw: (data) => new Uint8Array(deflateRawSync(data)),
  inflateRaw: (data) => new Uint8Array(inflateRawSync(data)),
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

// --- a system where the chosen element is the whole character ----------------------------------

function testSystem(): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Beast' }],
    stats: [{ name: 'guard', default: 0 }],
    characterKinds: [
      {
        id: 'monster',
        name: 'Monster',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Beast'],
        buildSteps: [{ id: 'beast', label: 'Beast', types: ['Beast'] }],
        sheet: { sections: [{ id: 's', label: 'S', stats: ['guard'] }] },
      },
    ],
  };
}

function element(id: string, guard: number): Element {
  return {
    id,
    name: id,
    type: 'Beast',
    setters: {},
    rules: [{ kind: 'stat', key: 'g', name: 'guard', value: { kind: 'number', value: guard } }],
    supports: ['Stone'],
    source: 'Homebrew',
    origin: { sourceId: 'local:homebrew.xml', fileUrl: 'local:homebrew.xml', format: 'aurora' },
  };
}

/** The source the character was built from, which is off by the time of the reload. */
function source(): ElementIndex {
  const index = new MapElementIndex();
  index.add(element('ID_DRAKE', 18));
  index.add(element('ID_UNUSED', 3));
  return index;
}

function drake(): Character {
  let character = createCharacter('test', 'monster', { name: 'Drake' });
  character.id = 'draft-drake';
  character = setChoice(character, 'build/beast', ['ID_DRAKE']);
  character.updatedAt = '2026-01-02T00:00:00.000Z';
  return character;
}

/** What the shell does: save from the source, then open the file back, as the library pane does. */
async function openedFromLibrary() {
  const store = new MemoryStore();
  const library = new CharacterLibrary(store);
  await library.restore();
  const saved = await library.save(drake(), testSystem(), source(), { assets: portrait() });
  assert.ok(saved.ok);
  const listed = library.getState().entries.find((entry) => entry.name === saved.entry.name)!;
  const opened = (await library.open(saved.entry.name))!;
  const origin: DraftOrigin = {
    embedded: opened.elements,
    assets: opened.assets,
    entry: { name: listed.name, form: listed.form },
    readAt: listed.updatedAt,
    savedName: opened.character.name,
  };
  return { store, library, opened, origin };
}

function portrait(): Map<string, Uint8Array> {
  return new Map([['assets/portrait.png', Uint8Array.from({ length: 256 }, (_, i) => i)]]);
}

// --- claim 1: a reload changes nothing ---------------------------------------------------------

test('a character read back through the draft with no source derives as it did when opened', async () => {
  const { opened, origin } = await openedFromLibrary();
  const storage = new MemoryStorage();
  await writeDraftOrigin(storage, opened.character.id, origin);

  // The reload: a fresh read, keyed on the draft character's id, and no source at all.
  const kept = await readDraftOrigin(storage, opened.character.id);
  assert.ok(kept.embedded, 'the embedded content is kept');
  const before = deriveCharacter(opened.character, testSystem(), opened.elements);
  const after = deriveCharacter(opened.character, testSystem(), kept.embedded);
  assert.deepEqual([...after.stats], [...before.stats]);
  assert.deepEqual([...after.elementIds].sort(), [...before.elementIds].sort());
  assert.equal(after.stats.get('guard')?.value, 18);

  // The control, which is what the draft used to give back: the character alone, nothing to resolve
  // its creature against, and a guard of 0.
  const bare = deriveCharacter(opened.character, testSystem(), new MapElementIndex());
  assert.equal(bare.stats.get('guard')?.value, 0);
});

test("after a reload, Save writes back to the file the character came from, embedding what it did", async () => {
  const { store, library, opened, origin } = await openedFromLibrary();
  const storage = new MemoryStorage();
  await writeDraftOrigin(storage, opened.character.id, origin);
  const kept = await readDraftOrigin(storage, opened.character.id);

  const before = store.entries.get(origin.entry!.name)!;
  const result = await library.save(opened.character, testSystem(), kept.embedded!, {
    entry: kept.entry,
    form: kept.entry?.form,
    expectUpdatedAt: kept.readAt,
    assets: kept.assets,
  });
  assert.ok(result.ok, result.ok ? '' : result.message);
  assert.equal(result.entry.name, origin.entry!.name, 'the same file, not a second one');
  assert.deepEqual([...store.entries.keys()], [origin.entry!.name]);
  assert.equal(result.elementCount, opened.elements.byType('Beast').length);
  assert.deepEqual(store.entries.get(result.entry.name)!.get('assets/portrait.png'), before.get('assets/portrait.png'));

  // The control: with nothing kept the shell had no entry, so Save chose a fresh name, and packed
  // against no content it embedded no creature. Both halves of what the browser build showed.
  const lost = await library.save(opened.character, testSystem(), new MapElementIndex(), {});
  assert.ok(lost.ok);
  assert.notEqual(lost.entry.name, origin.entry!.name);
  assert.equal(lost.elementCount, 0);
});

test('the conflict check still compares against what the file said when it was opened', async () => {
  // A reload must not refresh `readAt`: the file may have changed on disk since it was opened, and
  // Save should say so rather than write over it.
  const { store, library, opened, origin } = await openedFromLibrary();
  const storage = new MemoryStorage();
  await writeDraftOrigin(storage, opened.character.id, origin);

  const elsewhere = { ...opened.character, name: 'Edited elsewhere', updatedAt: '2026-06-01T00:00:00.000Z' };
  await library.save(elsewhere, testSystem(), source(), { entry: origin.entry });
  assert.equal(store.entries.size, 1);

  const kept = await readDraftOrigin(storage, opened.character.id);
  assert.equal(kept.readAt, origin.readAt);
  const result = await library.save(opened.character, testSystem(), kept.embedded!, {
    entry: kept.entry,
    expectUpdatedAt: kept.readAt,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.reason, 'conflict');
});

// --- claim 2: the bytes come back -------------------------------------------------------------

test('asset bytes survive the record, whatever their length and values', () => {
  for (let length = 0; length < 8; length++) {
    const assets = new Map([
      ['assets/portrait.png', Uint8Array.from({ length: 256 + length }, (_, i) => (i * 7 + length) & 255)],
      ['assets/short.bin', Uint8Array.from({ length }, (_, i) => 255 - i)],
    ]);
    const text = encodeDraftOrigin('c', { assets })!;
    const kept = decodeDraftOrigin(text, 'c');
    assert.deepEqual(kept.assets, assets, `length ${length}`);
    // Standard base64, so the record reads the same anywhere else.
    const stored = JSON.parse(text) as { assets: Record<string, string> };
    assert.equal(stored.assets['assets/short.bin'], Buffer.from(assets.get('assets/short.bin')!).toString('base64'));
  }
});

// --- claim 3: all of it or none -----------------------------------------------------------------

test('a record kept for another character keeps nothing for this one', async () => {
  const { opened, origin } = await openedFromLibrary();
  const storage = new MemoryStorage();
  await writeDraftOrigin(storage, opened.character.id, origin);
  // The draft was replaced (a new character) and the record was not, which two keys allow.
  assert.deepEqual(await readDraftOrigin(storage, 'someone-else'), {});
});

test('a new character keeps no record, and removes the one before it', async () => {
  const { opened, origin } = await openedFromLibrary();
  const storage = new MemoryStorage();
  await writeDraftOrigin(storage, opened.character.id, origin);
  assert.ok(await storage.read(DRAFT_ORIGIN_KEY));

  await writeDraftOrigin(storage, 'fresh', {});
  assert.equal(await storage.read(DRAFT_ORIGIN_KEY), null);
  assert.equal(encodeDraftOrigin('fresh', { readAt: 'x', savedName: 'y' }), undefined, 'no entry, nothing about one');
});

test('a record that does not read keeps nothing, and never throws', async () => {
  const { opened, origin } = await openedFromLibrary();
  const good = JSON.parse(encodeDraftOrigin(opened.character.id, origin)!) as Record<string, unknown>;
  const id = opened.character.id;
  const broken: [string, string | null][] = [
    ['absent', null],
    ['not JSON', '{'],
    ['not an object', '[]'],
    ['another format', JSON.stringify({ ...good, formatVersion: 2 })],
    ['elements not a list', JSON.stringify({ ...good, elements: {} })],
    ['an element with no supports', JSON.stringify({ ...good, elements: [{ id: 'X', type: 'Beast' }] })],
    ['an asset outside assets/', JSON.stringify({ ...good, assets: { 'character.json': 'AAAA' } })],
    ['an asset that is not base64', JSON.stringify({ ...good, assets: { 'assets/p.png': 'no*base64' } })],
    ['an entry of an unknown form', JSON.stringify({ ...good, entry: { name: 'a.incu', form: 'tar' } })],
    ['an entry with no saved name', JSON.stringify({ ...good, savedName: undefined })],
  ];
  for (const [what, text] of broken) assert.deepEqual(decodeDraftOrigin(text, id), {}, what);
  // The good one does read, so each case above failed on its own defect.
  assert.ok(decodeDraftOrigin(JSON.stringify(good), id).embedded);

  const throwing = new MemoryStorage();
  throwing.read = async () => {
    throw new Error('the database refused');
  };
  assert.deepEqual(await readDraftOrigin(throwing, id), {});
});
