/**
 * The ADR 0027 tests, and one of them is the ADR 0012 test wearing a library's clothes.
 *
 * ADR 0012's property — *a save opens with zero content sources* — has been tested since
 * Phase 0 against the real corpus (`tools/incudo/src/self-contained.test.ts`). What has never
 * been tested is the thing the library screen makes load-bearing: that **listing and opening
 * a character needs no source, no index, no network and no content load at all**. Nothing in
 * this file constructs a `ContentLibrary`, a `ContentSource` or a `Fetcher`, and nothing may
 * start to. If opening from the library ever comes to need one, this file should stop
 * compiling long before a user notices.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectCharacterContent,
  createCharacter,
  MapElementIndex,
  packCharacterContainer,
  resolveCharacterKind,
  setChoice,
  type Character,
  type CharacterStore,
  type Element,
  type ElementIndex,
  type GameSystem,
  type LibraryEntryRef,
} from '@incudo/core';
import type { ConfiguredSource } from '@incudo/content';

import { CharacterLibrary } from './character-library.ts';

// --- a library that is a Map -----------------------------------------------

/**
 * An in-memory `CharacterStore`.
 *
 * Small enough to read, which is the point: everything the real Tauri and File System Access
 * implementations do beyond this is I/O, and none of the logic under test is theirs.
 */
class FakeStore implements CharacterStore {
  readonly available = true;
  readonly entries = new Map<string, { form: 'zip' | 'folder'; files: Map<string, Uint8Array> }>();
  private chosen: string | null;
  /** Set to make the next `read` of this entry blow up, the way a vanished file does. */
  unreadable = new Set<string>();
  listCalls = 0;

  constructor(location: string | null = '/characters') {
    this.chosen = location;
  }

  async location(): Promise<string | null> {
    return this.chosen;
  }
  async choose(): Promise<string | null> {
    this.chosen = '/characters';
    return this.chosen;
  }
  async list(): Promise<LibraryEntryRef[]> {
    this.listCalls++;
    return [...this.entries].map(([name, entry]) => ({ name, form: entry.form }));
  }
  async read(entry: LibraryEntryRef): Promise<Map<string, Uint8Array>> {
    if (this.unreadable.has(entry.name)) throw new Error('no such file or directory');
    const found = this.entries.get(entry.name);
    if (!found) throw new Error('no such file or directory');
    return new Map(found.files);
  }
  async write(entry: LibraryEntryRef, files: Map<string, Uint8Array>): Promise<void> {
    this.entries.set(entry.name, { form: entry.form, files: new Map(files) });
  }
  async remove(entry: LibraryEntryRef): Promise<void> {
    this.entries.delete(entry.name);
  }
}

class NoStore implements CharacterStore {
  readonly available = false;
  readonly unavailableReason = 'This browser cannot open a folder.';
  async location(): Promise<string | null> {
    return null;
  }
  async choose(): Promise<string | null> {
    return null;
  }
  async list(): Promise<LibraryEntryRef[]> {
    throw new Error('not available');
  }
  async read(): Promise<Map<string, Uint8Array>> {
    throw new Error('not available');
  }
  async write(): Promise<void> {
    throw new Error('not available');
  }
  async remove(): Promise<void> {
    throw new Error('not available');
  }
}

// --- the smallest system that can own a character --------------------------

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
    origin: { sourceId: 'test', fileUrl: 'test.xml', format: 'incudo' },
    ...patch,
  };
}

function corpus(): ElementIndex {
  const index = new MapElementIndex();
  for (const id of ['ID_BASELINE', 'ID_TIER_1', 'ID_TIER_2', 'ID_KIN_RIVERFOLK', 'ID_UNUSED']) {
    index.add(element(id));
  }
  return index;
}

function hero(name = 'Aelin'): Character {
  let character = createCharacter('test', 'hero', { name, progress: 2 });
  character.id = 'fixed';
  character.createdAt = '2026-01-01T00:00:00.000Z';
  character = setChoice(character, 'build/kin', ['ID_KIN_RIVERFOLK']);
  character.sources = [{ id: 'https://example.test/core.index', name: 'Core', version: '1.2.0' }];
  // Last, because setChoice stamps updatedAt — and the conflict check compares that field, so
  // a fixture whose timestamp moved on every run would make these tests pass by accident.
  character.updatedAt = '2026-01-02T00:00:00.000Z';
  return character;
}

/** A container on disk, written the way `save` writes one. */
function containerFor(character: Character, assets?: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const content = collectCharacterContent(character, corpus(), {
    kind: resolveCharacterKind(testSystem(), 'hero'),
  });
  return packCharacterContainer(character, content, { assets, now: '2026-01-02T00:00:00.000Z' });
}

async function libraryWith(...characters: Character[]): Promise<[CharacterLibrary, FakeStore]> {
  const store = new FakeStore();
  for (const character of characters) {
    await store.write({ name: `${character.name.toLowerCase()}.incu`, form: 'zip' }, containerFor(character));
  }
  const library = new CharacterLibrary(store);
  await library.restore();
  return [library, store];
}

// --- the property that matters ---------------------------------------------

test('a library lists and opens characters with zero sources configured', async () => {
  const [library] = await libraryWith(hero('Aelin'), hero('Vigaro'));

  const state = library.getState();
  assert.equal(state.status, 'ready');
  assert.deepEqual(
    state.entries.map((entry) => entry.title).sort(),
    ['Aelin', 'Vigaro'],
  );
  assert.deepEqual(state.problems, []);

  // Nothing was configured, nothing was fetched, no index was built — and the character still
  // comes back with an ElementIndex over its own embedded content.
  const opened = await library.open('aelin.incu');
  assert.ok(opened, 'the character should open');
  assert.equal(opened.character.name, 'Aelin');
  assert.deepEqual(opened.problems, []);
  assert.ok(opened.elements.get('ID_KIN_RIVERFOLK'), 'its chosen element is embedded');
  assert.ok(opened.elements.get('ID_BASELINE'), "the kind's baseline grant is embedded");
  assert.ok(opened.elements.get('ID_TIER_2'), 'the progression element is embedded');
  assert.equal(opened.elements.get('ID_UNUSED'), undefined, 'and nothing it does not use is');
});

test('every recorded source reads as missing when the profile is empty, and nothing breaks', async () => {
  const [library] = await libraryWith(hero());
  const entry = library.getState().entries[0]!;

  assert.equal(entry.sourceStatuses.length, 1);
  assert.equal(entry.sourceStatuses[0]!.state, 'missing');
  assert.equal(entry.broken, false, 'a missing source is not a broken character');
  assert.ok(await library.open('aelin.incu'), 'and it still opens');
});

// --- ADR 0028's three states ------------------------------------------------

test('a source the profile has at another version reads as moved, and one it lacks as missing', async () => {
  const [library] = await libraryWith(hero());

  const configured = (version: string): ConfiguredSource => ({
    id: 'https://example.test/core.index',
    url: 'https://example.test/core.index',
    name: 'Core',
    enabled: true,
    mode: 'stream',
    version,
    addedAt: '2026-01-01T00:00:00.000Z',
  });

  library.setProfile([configured('1.2.0')]);
  assert.equal(library.getState().entries[0]!.sourceStatuses[0]!.state, 'present');

  library.setProfile([configured('1.3.0')]);
  assert.equal(library.getState().entries[0]!.sourceStatuses[0]!.state, 'moved');

  library.setProfile([]);
  assert.equal(library.getState().entries[0]!.sourceStatuses[0]!.state, 'missing');
});

// --- portraits --------------------------------------------------------------

test('a portrait is real bytes, and its absence is an absence', async () => {
  const store = new FakeStore();
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

  const withFace = hero('Aelin');
  withFace.assets = { portrait: 'assets/portrait.png' };
  await store.write(
    { name: 'aelin.incu', form: 'zip' },
    containerFor(withFace, new Map([['assets/portrait.png', png]])),
  );
  await store.write({ name: 'vigaro.incu', form: 'zip' }, containerFor(hero('Vigaro')));

  const library = new CharacterLibrary(store);
  await library.restore();
  const entries = new Map(library.getState().entries.map((entry) => [entry.title, entry]));

  assert.deepEqual([...entries.get('Aelin')!.portrait!], [...png]);
  // Undefined, not a generated stand-in. The app renders a marked gap; see the README's
  // standing commitment and ADR 0027.
  assert.equal(entries.get('Vigaro')!.portrait, undefined);
});

// --- a container the app cannot read ----------------------------------------

test('a container that will not read is listed with its problems, not hidden', async () => {
  const store = new FakeStore();
  await store.write({ name: 'aelin.incu', form: 'zip' }, containerFor(hero()));
  await store.write(
    { name: 'notes.incu', form: 'zip' },
    new Map([['manifest.json', new TextEncoder().encode('{ this is not json')]]),
  );

  const library = new CharacterLibrary(store);
  await library.restore();
  const broken = library.getState().entries.find((entry) => entry.name === 'notes.incu');

  assert.ok(broken, 'the unreadable entry is still listed');
  assert.equal(broken.broken, true);
  assert.ok(broken.problems.length > 0, 'and it says what is wrong');
  assert.ok(
    broken.problems.some((problem) => /not valid JSON|missing/.test(problem.message)),
    `expected a readable problem, got ${JSON.stringify(broken.problems)}`,
  );
  assert.equal(library.getState().entries.length, 2, 'the good one is unaffected');
});

test('a file that vanishes between the scan and the read is reported, not invented', async () => {
  const [library, store] = await libraryWith(hero());
  store.unreadable.add('aelin.incu');
  await library.refresh();

  const entry = library.getState().entries[0]!;
  assert.equal(entry.broken, true);
  assert.equal(entry.title, 'aelin.incu', 'it falls back to the file name it can still see');
  assert.match(library.getState().problems[0]!, /aelin\.incu/);
});

// --- writing ----------------------------------------------------------------

test('a new character gets a slug for a name, and a second one does not collide', async () => {
  const store = new FakeStore();
  const library = new CharacterLibrary(store);
  await library.restore();

  const first = await library.save(hero('Aelin of the Reeds'), testSystem(), corpus());
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.entry.name, 'aelin-of-the-reeds.incu');

  const second = await library.save(hero('Aelin of the Reeds'), testSystem(), corpus());
  assert.equal(second.ok && second.entry.name, 'aelin-of-the-reeds-2.incu');
  assert.equal(library.getState().entries.length, 2);
});

test('an existing entry keeps its form, so a folder never silently becomes a zip', async () => {
  const store = new FakeStore();
  await store.write({ name: 'borin', form: 'folder' }, containerFor(hero('Borin')));
  const library = new CharacterLibrary(store);
  await library.restore();

  const saved = await library.save(hero('Borin'), testSystem(), corpus(), {
    entry: { name: 'borin', form: 'folder' },
  });
  assert.equal(saved.ok, true);
  assert.equal(store.entries.get('borin')!.form, 'folder');
  assert.equal(library.getState().entries.length, 1, 'and it did not make a second entry');
});

test('a write over a file that changed outside Incudo is refused, not merged', async () => {
  const [library, store] = await libraryWith(hero());

  // Someone else saved over it: same name, later timestamp.
  const theirs = hero();
  theirs.updatedAt = '2026-06-01T00:00:00.000Z';
  await store.write({ name: 'aelin.incu', form: 'zip' }, containerFor(theirs));

  const result = await library.save(hero(), testSystem(), corpus(), {
    entry: { name: 'aelin.incu', form: 'zip' },
    expectUpdatedAt: '2026-01-02T00:00:00.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, 'conflict');
  assert.match((result as { message: string }).message, /changed outside Incudo/);

  // And the other person's file is still theirs.
  const library2 = new CharacterLibrary(store);
  await library2.restore();
  assert.equal(library2.getState().entries[0]!.updatedAt, '2026-06-01T00:00:00.000Z');
});

test('a write with the timestamp it read goes through', async () => {
  const [library] = await libraryWith(hero());
  const result = await library.save(hero(), testSystem(), corpus(), {
    entry: { name: 'aelin.incu', form: 'zip' },
    expectUpdatedAt: '2026-01-02T00:00:00.000Z',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('removing an entry removes the file and rescans', async () => {
  const [library, store] = await libraryWith(hero('Aelin'), hero('Vigaro'));
  await library.remove({ name: 'aelin.incu', form: 'zip' });

  assert.equal(store.entries.has('aelin.incu'), false);
  assert.deepEqual(
    library.getState().entries.map((entry) => entry.title),
    ['Vigaro'],
  );
});

// --- the folder changes underneath ------------------------------------------

test('a refresh re-reads the folder rather than trusting what it last saw', async () => {
  const [library, store] = await libraryWith(hero('Aelin'));
  assert.equal(library.getState().entries.length, 1);

  // A file copied in from a friend, with the app running. ADR 0027: the folder is the list.
  await store.write({ name: 'gift.incu', form: 'zip' }, containerFor(hero('Borin')));
  await library.refresh();

  assert.deepEqual(
    library.getState().entries.map((entry) => entry.title).sort(),
    ['Aelin', 'Borin'],
  );
});

// --- no filesystem at all ---------------------------------------------------

test('a platform with no folder says so, and offers nothing', async () => {
  const library = new CharacterLibrary(new NoStore());
  await library.restore();

  const state = library.getState();
  assert.equal(state.status, 'unavailable');
  assert.equal(state.unavailableReason, 'This browser cannot open a folder.');
  assert.deepEqual(state.entries, []);

  const saved = await library.save(hero(), testSystem(), corpus());
  assert.equal(saved.ok, false);
  assert.equal(!saved.ok && saved.message, 'This browser cannot open a folder.');
});

test('a library with nowhere chosen yet is a first run, not an error', async () => {
  const library = new CharacterLibrary(new FakeStore(null));
  await library.restore();
  assert.equal(library.getState().status, 'no-location');
  assert.deepEqual(library.getState().problems, []);
});

// --- the system filter (ADR 0031) ------------------------------------------

/** The other system in these tests. Same shape, different id — the library never reads more. */
function otherSystem(): GameSystem {
  return { ...testSystem(), id: 'other', name: 'Other' };
}

function otherHero(name: string): Character {
  const character = hero(name);
  character.systemId = 'other';
  return character;
}

function containerForOther(character: Character): Map<string, Uint8Array> {
  const content = collectCharacterContent(character, corpus(), {
    kind: resolveCharacterKind(otherSystem(), 'hero'),
  });
  return packCharacterContainer(character, content, { now: '2026-01-02T00:00:00.000Z' });
}

async function mixedLibrary(): Promise<[CharacterLibrary, FakeStore]> {
  const store = new FakeStore();
  await store.write({ name: 'aelin.incu', form: 'zip' }, containerFor(hero('Aelin')));
  await store.write({ name: 'borin.incu', form: 'zip' }, containerFor(hero('Borin')));
  await store.write({ name: 'zeru.incu', form: 'zip' }, containerForOther(otherHero('Zeru')));
  const library = new CharacterLibrary(store);
  await library.restore();
  return [library, store];
}

test('with no system set the library shows everything, which is what the CLI wants', async () => {
  const [library] = await mixedLibrary();
  assert.equal(library.getState().entries.length, 3);
  assert.deepEqual(library.getState().elsewhere, []);
});

test('choosing a system shows only its characters', async () => {
  const [library] = await mixedLibrary();
  library.setSystem('test');
  assert.deepEqual(
    library.getState().entries.map((e) => e.title).sort(),
    ['Aelin', 'Borin'],
  );
  library.setSystem('other');
  assert.deepEqual(library.getState().entries.map((e) => e.title), ['Zeru']);
});

/**
 * The half that stops a filter from being a disappearance. A folder with nine D&D characters
 * viewed as Cairn must not read "nothing here yet" — that is indistinguishable from having
 * picked the wrong folder, which is the mistake a user actually makes.
 */
test('what the filter hides is counted, not swallowed', async () => {
  const [library] = await mixedLibrary();
  library.setSystem('other');
  assert.deepEqual(library.getState().elsewhere, [{ systemId: 'test', count: 2 }]);
  library.setSystem('test');
  assert.deepEqual(library.getState().elsewhere, [{ systemId: 'other', count: 1 }]);
  library.setSystem(undefined);
  assert.deepEqual(library.getState().elsewhere, []);
});

/**
 * The bug this test exists to stop is data loss, and it is the reason the filtered list is not
 * the list `freeName` asks. Two characters of two systems with one name are one filename.
 */
test('a name is free only if nothing in the whole folder holds it, filtered out or not', async () => {
  const store = new FakeStore();
  await store.write({ name: 'aelin.incu', form: 'zip' }, containerForOther(otherHero('Aelin')));
  const library = new CharacterLibrary(store);
  await library.restore();
  library.setSystem('test');

  // The Aelin already on disk belongs to the other system, so nothing about it is on screen.
  assert.deepEqual(library.getState().entries, []);
  assert.deepEqual(library.getState().elsewhere, [{ systemId: 'other', count: 1 }]);

  const saved = await library.save(hero('Aelin'), testSystem(), corpus());
  assert.equal(saved.ok && saved.entry.name, 'aelin-2.incu', 'must not land on the other one');
  assert.equal(store.entries.has('aelin.incu'), true, 'the original is still there');
});

test('a container that will not read stays visible in every system, because nothing knows whose it is', async () => {
  const store = new FakeStore();
  await store.write({ name: 'aelin.incu', form: 'zip' }, containerFor(hero('Aelin')));
  await store.write({ name: 'junk.incu', form: 'zip' }, new Map([['manifest.json', new TextEncoder().encode('{')]]));
  const library = new CharacterLibrary(store);
  await library.restore();

  library.setSystem('other');
  const titles = library.getState().entries.map((e) => e.name);
  assert.ok(titles.includes('junk.incu'), 'a broken save must not vanish from every system at once');
  assert.deepEqual(library.getState().elsewhere, [{ systemId: 'test', count: 1 }]);
});

test('a source status stays right across a system switch, with no rescan in between', async () => {
  const [library] = await mixedLibrary();
  library.setSystem('other');
  library.setProfile([
    {
      id: 'https://example.test/core.index',
      url: 'https://example.test/core.index',
      name: 'Core',
      enabled: true,
      mode: 'stream',
      version: '1.2.0',
      addedAt: '2026-01-01T00:00:00.000Z',
    },
  ]);
  // Aelin was filtered out when the profile arrived. Switching back must not show her stale.
  library.setSystem('test');
  const aelin = library.getState().entries.find((e) => e.title === 'Aelin');
  assert.equal(aelin?.sourceStatuses[0]?.state, 'present');
});
