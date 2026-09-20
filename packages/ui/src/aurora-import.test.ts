/**
 * The Aurora import, as the app runs it — against a fake store and a save written by hand.
 *
 * `tools/verify/src/library.test.ts` is the other half of this: the same function over the
 * nine real `.dnd5e` files and the real 12,058-element corpus. This one is where the *logic*
 * is checked, and in particular the two steps that fail silently when they are left out —
 * the overlay of the elements Aurora generates at runtime, and `extraIds`. Both are asserted
 * here by **reading the container back with zero sources**, because that is the only place
 * their absence shows: a save written without them still writes, still lists, and is simply
 * missing pieces forever.
 *
 * Nothing here constructs a `ContentSource`, a `Fetcher` or a `ContentLibrary`. The import
 * takes an `ElementIndex` because resolving Aurora's ids genuinely needs one; everything
 * after it — listing, opening, deriving — still needs nothing at all (ADR 0012).
 *
 * The save below is written by shape rather than by content, like `parse-save.test.ts`: the
 * real files are somebody's characters and never come near this repository.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MapElementIndex,
  type CharacterStore,
  type ContainerFiles,
  type Element,
  type ElementIndex,
  type GameSystem,
  type LibraryEntryRef,
  type PickedFile,
} from '@incudo/core';
import type { ConfiguredSource } from '@incudo/content';

import { CharacterLibrary } from './character-library.ts';
import { importAuroraSaveIntoLibrary, importAuroraSavesIntoLibrary } from './aurora-import.ts';

// --- a library that is a Map -----------------------------------------------

class FakeStore implements CharacterStore {
  readonly available = true;
  readonly entries = new Map<string, { form: 'zip' | 'folder'; files: ContainerFiles }>();

  async location(): Promise<string | null> {
    return '/characters';
  }
  async choose(): Promise<string | null> {
    return '/characters';
  }
  async list(): Promise<LibraryEntryRef[]> {
    return [...this.entries].map(([name, entry]) => ({ name, form: entry.form }));
  }
  async read(entry: LibraryEntryRef): Promise<ContainerFiles> {
    const found = this.entries.get(entry.name);
    if (!found) throw new Error('no such file or directory');
    return new Map(found.files);
  }
  async write(entry: LibraryEntryRef, files: ContainerFiles): Promise<void> {
    this.entries.set(entry.name, { form: entry.form, files: new Map(files) });
  }
  async remove(entry: LibraryEntryRef): Promise<void> {
    this.entries.delete(entry.name);
  }
}

// --- the smallest 5e-shaped system -----------------------------------------

/** `dnd5e`, because Aurora names the game in the file extension and the import checks it. */
function testSystem(): GameSystem {
  return {
    formatVersion: 1,
    id: 'dnd5e',
    name: 'Test 5e',
    version: '1.0.0',
    elementTypes: [{ name: 'Race' }, { name: 'Class' }, { name: 'Racial Trait' }, { name: 'Level' }],
    stats: [{ name: 'level', default: 1 }],
    characterKinds: [
      {
        id: 'pc',
        name: 'Character',
        default: true,
        progression: {
          kind: 'level',
          min: 1,
          max: 20,
          stat: 'level',
          elementIdPattern: 'ID_LEVEL_{n}',
        },
        elementTypes: ['Race', 'Class'],
        grants: ['ID_BASELINE'],
        buildSteps: [{ id: 'race', label: 'Race', types: ['Race'] }],
        sheet: { sections: [{ id: 's', label: 'S', stats: ['level'] }] },
      },
    ],
  };
}

const SOURCE_URL = 'https://example.test/core.index';

function element(id: string, type = 'Race'): Element {
  return {
    id,
    name: id,
    type,
    setters: {},
    rules: [],
    supports: [],
    source: 'Test Book',
    origin: { sourceId: SOURCE_URL, fileUrl: `${SOURCE_URL}#x`, format: 'incudo' },
  };
}

function corpus(): ElementIndex {
  const index = new MapElementIndex();
  index.add(element('ID_BASELINE'));
  index.add(element('ID_LEVEL_1', 'Level'));
  index.add(element('ID_LEVEL_2', 'Level'));
  index.add(element('ID_RACE_TEST'));
  index.add(element('ID_CLASS_TEST', 'Class'));
  index.add(element('ID_TRAIT_KEEN_NOSE', 'Racial Trait'));
  // In Aurora's `<sum>` and reached by nothing the character chose. It is embedded only if
  // `extraIds` is passed through, which is the point of asserting on it.
  index.add(element('ID_ONLY_IN_SUM', 'Racial Trait'));
  return index;
}

const configured: ConfiguredSource[] = [
  {
    id: SOURCE_URL,
    url: SOURCE_URL,
    name: 'Core',
    enabled: true,
    mode: 'stream',
    version: '1.2.0',
    addedAt: '2026-01-01T00:00:00.000Z',
  },
];

/**
 * A save with the two awkward cases in it.
 *
 * `ID_INTERNAL_CLASS_FEATURE_ASI_4_TEST` is in no content file — Aurora materialises that
 * family at runtime, one per class per ability-score-improvement level — so the importer
 * synthesizes it and the overlay is what makes it resolvable. `ID_ONLY_IN_SUM` is real
 * content that nothing in the build tree reaches, so only `extraIds` embeds it.
 */
function save(name: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<character version="1.0.3" preview="false">
  <display-properties favorite="false">
    <name>${name}</name>
    <level>2</level>
  </display-properties>
  <build>
    <input><name>${name}</name></input>
    <abilities available-points="15">
      <strength>8</strength>
      <dexterity>15</dexterity>
      <constitution>14</constitution>
      <intelligence>10</intelligence>
      <wisdom>12</wisdom>
      <charisma>13</charisma>
    </abilities>
    <elements level-count="2" registered-count="2">
      <element type="Level" name="1" id="ID_LEVEL_1" rndhp="6" />
      <element type="Level" name="2" id="ID_LEVEL_2">
        <element type="Race" name="Race" requiredLevel="1" checksum="abc" registered="ID_RACE_TEST">
          <element type="Racial Trait" name="Keen Nose" id="ID_TRAIT_KEEN_NOSE" />
        </element>
        <element type="Class" name="Class" requiredLevel="1" checksum="99" registered="ID_CLASS_TEST">
          <element type="Class Feature" name="Ability Score Improvement" id="ID_INTERNAL_CLASS_FEATURE_ASI_4_TEST" />
        </element>
      </element>
    </elements>
    <sum element-count="4">
      <element type="Race" id="ID_RACE_TEST" />
      <element type="Racial Trait" id="ID_ONLY_IN_SUM" />
      <element type="Class Feature" id="ID_INTERNAL_CLASS_FEATURE_ASI_4_TEST" />
      <element type="Level" id="ID_LEVEL_1" />
    </sum>
  </build>
  <sources><restricted /></sources>
</character>`;
}

function picked(fileName: string, xml: string): PickedFile {
  return { name: fileName, bytes: new TextEncoder().encode(xml) };
}

async function emptyLibrary(): Promise<[CharacterLibrary, FakeStore]> {
  const store = new FakeStore();
  const library = new CharacterLibrary(store);
  library.setProfile(configured);
  await library.restore();
  return [library, store];
}

// --- the properties that matter --------------------------------------------

test('an imported save carries the elements Aurora generated and the ones only its <sum> names', async () => {
  const [library] = await emptyLibrary();

  const report = await importAuroraSaveIntoLibrary(library, picked('Aelin.dnd5e', save('Aelin')), {
    system: testSystem(),
    elements: corpus(),
  });

  assert.equal(report.ok, true, report.message);
  assert.equal(report.entry?.name, 'aelin.incu', 'ADR 0027 names the file after the character');
  assert.deepEqual(report.unresolved, [], 'nothing should be left dangling');

  // Now forget the corpus entirely. This is the ADR 0012 read: whatever the import failed to
  // embed is gone, and there is no source to fall back on.
  const opened = await library.open('aelin.incu');
  assert.ok(opened, 'the imported character should open');

  assert.ok(
    opened.elements.get('ID_INTERNAL_CLASS_FEATURE_ASI_4_TEST'),
    'the overlay of Aurora-generated elements has to reach the container',
  );
  assert.ok(
    opened.elements.get('ID_ONLY_IN_SUM'),
    "extraIds — Aurora's own <sum> — has to reach the container",
  );
  assert.ok(opened.elements.get('ID_BASELINE'), "the kind's baseline grant is embedded");
  assert.ok(opened.elements.get('ID_LEVEL_2'), 'the progression element is embedded');
  assert.equal(opened.character.progress, 2);
  assert.deepEqual(opened.character.baseStats, {
    strength: 8,
    dexterity: 15,
    constitution: 14,
    intelligence: 10,
    wisdom: 12,
    charisma: 13,
  });
});

test('the import records which source it was built against', async () => {
  const [library] = await emptyLibrary();
  await importAuroraSaveIntoLibrary(library, picked('Aelin.dnd5e', save('Aelin')), {
    system: testSystem(),
    elements: corpus(),
  });

  // ADR 0028, derived rather than asserted: every embedded element carries `origin.sourceId`,
  // so nothing has to be told which index this came from.
  const entry = library.getState().entries[0]!;
  assert.deepEqual(
    entry.sources.map((ref) => ref.id),
    [SOURCE_URL],
  );
  assert.deepEqual(
    entry.sourceStatuses.map((status) => status.state),
    ['present'],
  );
});

test('two characters with one name become two files, and neither overwrites the other', async () => {
  const [library, store] = await emptyLibrary();

  const reports = await importAuroraSavesIntoLibrary(
    library,
    [picked('Aelin.dnd5e', save('Aelin')), picked('Aelin (copy).dnd5e', save('Aelin'))],
    { system: testSystem(), elements: corpus() },
  );

  assert.deepEqual(
    reports.map((report) => report.ok),
    [true, true],
  );
  assert.deepEqual(
    reports.map((report) => report.entry?.name),
    ['aelin.incu', 'aelin-2.incu'],
  );
  assert.equal(store.entries.size, 2);
});

test('importing with no content loaded is refused, and says why', async () => {
  const [library, store] = await emptyLibrary();

  const report = await importAuroraSaveIntoLibrary(library, picked('Aelin.dnd5e', save('Aelin')), {
    system: testSystem(),
    elements: new MapElementIndex(),
  });

  assert.equal(report.ok, false);
  assert.match(report.message ?? '', /needs content loaded/i);
  assert.equal(store.entries.size, 0, 'nothing half-imported should have been written');
});

test('a file that is not an Aurora save for this system is refused by its extension', async () => {
  const [library] = await emptyLibrary();
  const options = { system: testSystem(), elements: corpus() };

  const wrongGame = await importAuroraSaveIntoLibrary(
    library,
    picked('Aelin.pathfinder', save('Aelin')),
    options,
  );
  assert.equal(wrongGame.ok, false);
  assert.match(wrongGame.message ?? '', /pathfinder save/);

  const noExtension = await importAuroraSaveIntoLibrary(library, picked('Aelin', save('Aelin')), options);
  assert.equal(noExtension.ok, false);
  assert.match(noExtension.message ?? '', /no extension/);

  const notXml = await importAuroraSaveIntoLibrary(
    library,
    picked('Aelin.dnd5e', 'this is not a character'),
    options,
  );
  assert.equal(notXml.ok, false);
});

test('what the importer had to say survives, counted rather than repeated', async () => {
  const [library] = await emptyLibrary();

  const report = await importAuroraSaveIntoLibrary(library, picked('Aelin.dnd5e', save('Aelin')), {
    system: testSystem(),
    elements: corpus(),
  });

  // The synthesized element is a warning, not a silence: the character is carrying something
  // rebuilt from what the save recorded about it, and that is worth saying (ADR 0005).
  assert.ok(
    report.diagnostics.some(
      (diagnostic) => diagnostic.level === 'warning' && /Rebuilt 1 element/.test(diagnostic.message),
    ),
    `expected the generated-element warning, got ${JSON.stringify(report.diagnostics)}`,
  );
  assert.ok(
    report.diagnostics.every((diagnostic) => diagnostic.count >= 1),
    'every diagnostic carries how many times it happened',
  );
});
