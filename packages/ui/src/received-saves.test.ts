/**
 * An Aurora save received on a phone, imported on a tap — ADR 0101.
 *
 * What is asked before an import (the game, a source switched on, a source to add), and what an import says afterwards.
 * Each test names the perturbation that fails it.
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
} from '@incudo/core';
import type { ConfiguredSource } from '@incudo/content';

import { CharacterLibrary } from './character-library.ts';
import { receiveFiles, receivedView } from './received-files.ts';
import { importReceivedSaves, importedView, saveImportLine, saveImportStep, type SaveImportPhase } from './received-saves.ts';
import { METERED_NOTE } from './fetch-prompt.ts';

class FakeStore implements CharacterStore {
  readonly available = true;
  readonly entries = new Map<string, ContainerFiles>();
  async location(): Promise<string | null> {
    return '/characters';
  }
  async choose(): Promise<string | null> {
    return '/characters';
  }
  async list(): Promise<LibraryEntryRef[]> {
    return [...this.entries.keys()].map((name) => ({ name, form: 'zip' as const }));
  }
  async read(entry: LibraryEntryRef): Promise<ContainerFiles> {
    const found = this.entries.get(entry.name);
    if (!found) throw new Error('no such file');
    return new Map(found);
  }
  async write(entry: LibraryEntryRef, files: ContainerFiles): Promise<void> {
    this.entries.set(entry.name, new Map(files));
  }
  async remove(entry: LibraryEntryRef): Promise<void> {
    this.entries.delete(entry.name);
  }
}

const SUGGESTED = 'https://example.test/suggested.index';

function system(id: string, name: string, aurora: boolean): GameSystem {
  return {
    formatVersion: 1,
    id,
    name,
    version: '1.0.0',
    elementTypes: [{ name: 'Race' }, { name: 'Level' }],
    stats: [{ name: 'level', default: 1 }],
    characterKinds: [
      {
        id: 'pc',
        name: 'Character',
        default: true,
        progression: { kind: 'level', min: 1, max: 20, stat: 'level', elementIdPattern: 'ID_LEVEL_{n}' },
        elementTypes: ['Race'],
        buildSteps: [{ id: 'race', label: 'Race', types: ['Race'] }],
        sheet: { sections: [{ id: 's', label: 'S', stats: ['level'] }] },
      },
    ],
    ...(aurora ? { auroraTypeMap: {}, suggestedSources: [{ url: SUGGESTED, name: 'Suggested' }] } : {}),
  };
}

const AURORA = system('dnd5e', 'Test 5e', true);
const OTHER = system('cairnish', 'Not Aurora', false);
const SYSTEMS = [AURORA, OTHER];

function source(systemId: string, enabled: boolean, url = 'https://example.test/a.index'): ConfiguredSource {
  return { id: url, url, name: 'A', enabled, mode: 'download', systemId, addedAt: '2026-01-01T00:00:00.000Z' };
}

function element(id: string, type = 'Race'): Element {
  return { id, name: id, type, setters: {}, rules: [], supports: [], source: 'Test Book', origin: { sourceId: SUGGESTED, fileUrl: SUGGESTED, format: 'incudo' } };
}

function corpus(): ElementIndex {
  const index = new MapElementIndex();
  index.add(element('ID_LEVEL_1', 'Level'));
  index.add(element('ID_RACE_TEST'));
  return index;
}

function save(name: string, race = 'ID_RACE_TEST'): Uint8Array {
  return new TextEncoder().encode(`﻿<?xml version="1.0" encoding="utf-8"?>
<character version="1.0.3" preview="false">
  <display-properties favorite="false"><name>${name}</name><level>1</level></display-properties>
  <build>
    <input><name>${name}</name></input>
    <elements level-count="1" registered-count="1">
      <element type="Level" name="1" id="ID_LEVEL_1">
        <element type="Race" name="Race" requiredLevel="1" registered="${race}" />
      </element>
    </elements>
    <sum element-count="2"><element type="Race" id="${race}" /><element type="Level" id="ID_LEVEL_1" /></sum>
  </build>
</character>`);
}

async function library(): Promise<[CharacterLibrary, FakeStore]> {
  const store = new FakeStore();
  const lib = new CharacterLibrary(store);
  await lib.restore();
  return [lib, store];
}

test('a received Aurora save is offered for import, with the button named for how many', async () => {
  const [lib, store] = await library();
  const one = receivedView(await receiveFiles(lib, { unzip: async () => new Map() }, [{ name: 'a.dnd5e', bytes: save('A') }]));
  // Fails if the saves are not handed to the view (no Import button) or the old "import on a computer" sentence stays.
  assert.equal(one.title, 'An Aurora save');
  assert.deepEqual(one.lines, ['"a.dnd5e" is an Aurora save.']);
  assert.equal(one.saves?.label, 'Import');
  assert.equal(one.saves?.files.length, 1);
  const two = receivedView(
    await receiveFiles(lib, { unzip: async () => new Map() }, [
      { name: 'a.dnd5e', bytes: save('A') },
      { name: 'b.dnd5e', bytes: save('B') },
    ]),
  );
  assert.equal(two.saves?.label, 'Import 2 saves');
  assert.equal(store.entries.size, 0, 'receiving imports nothing');
});

test('a file whose name does not say is asked about, among the games that read Aurora content only', () => {
  const context = { systems: SYSTEMS, sources: [source('dnd5e', true)], connection: {} };
  const step = saveImportStep([{ name: 'msf:44', bytes: save('A') }], context);
  // Fails if every system is offered (the one with no `auroraTypeMap` too) or the name's absence is not asked about.
  assert.equal(step.kind, 'choose-game');
  if (step.kind !== 'choose-game') return;
  assert.deepEqual(step.choices, [{ systemId: 'dnd5e', label: 'Import' }]);
  assert.equal(step.message, "Import it as a Test 5e character? The file's name does not say which game it is for.");
  // ".xml" names no game either; ".dnd5e" does, and with the answer given nothing more is asked.
  assert.equal(saveImportStep([{ name: 'a.xml', bytes: save('A') }], context).kind, 'choose-game');
  assert.equal(saveImportStep([{ name: 'a.dnd5e', bytes: save('A') }], context).kind, 'ready');
  assert.equal(saveImportStep([{ name: 'msf:44', bytes: save('A') }], context, 'dnd5e').kind, 'ready');
  // No game reads Aurora saves: refused.
  assert.equal(saveImportStep([{ name: 'msf:44', bytes: save('A') }], { ...context, systems: [OTHER] }).kind, 'no-source');
});

test('what the import needs is asked before it runs: a source switched on, or one to add', () => {
  const file = [{ name: 'a.dnd5e', bytes: save('A') }];
  // Every source of the game off, and another game's on: fails if any enabled source counts, whatever its game.
  const off = saveImportStep(file, { systems: SYSTEMS, sources: [source('dnd5e', false), source('cairnish', true, 'x')], connection: {} });
  assert.equal(off.kind, 'switched-off');
  assert.equal(off.kind === 'switched-off' && off.message, 'Every content source for Test 5e is switched off. Switch one on in Content, then import again.');

  // None: the suggested source, with ADR 0100's sentence, and the metered one only on a metered connection.
  const add = saveImportStep(file, { systems: SYSTEMS, sources: [], connection: {} });
  assert.equal(add.kind, 'needs-source');
  if (add.kind !== 'needs-source') return;
  assert.equal(add.suggestion.url, SUGGESTED);
  assert.equal(add.message, 'Importing needs content for Test 5e. Add Suggested and import? It is downloaded in full now.');
  assert.equal(add.confirm, 'Add and import');
  const metered = saveImportStep(file, { systems: SYSTEMS, sources: [], connection: { metered: true } });
  // Fails if the metered sentence is written here rather than reused from `addSourceNote`.
  assert.ok(metered.kind === 'needs-source' && metered.message.endsWith(METERED_NOTE));

  // The suggestion already added under another system is not offered again (a source belongs to one system).
  const taken = saveImportStep(file, { systems: SYSTEMS, sources: [source('cairnish', true, SUGGESTED)], connection: {} });
  assert.equal(taken.kind, 'no-source');
});

test('an import names the game it was asked for, says a taken name, and counts what is missing', async () => {
  const [lib, store] = await library();
  const loads: string[] = [];
  const phases: SaveImportPhase[] = [];
  const deps = {
    library: lib,
    systems: SYSTEMS,
    load: async (systemId: string) => {
      loads.push(systemId);
      return corpus();
    },
    onPhase: (phase: SaveImportPhase) => phases.push(phase),
  };
  const outcomes = await importReceivedSaves(
    deps,
    [
      { name: 'msf:44', bytes: save('Vesper') },
      { name: 'other.dnd5e', bytes: save('Vesper') },
      { name: 'third.dnd5e', bytes: save('Wren', 'ID_RACE_GONE') },
    ],
    'dnd5e',
  );
  // Fails if a file whose name does not say is handed to the importer as it is (it refuses "no extension").
  assert.deepEqual(
    outcomes.map((outcome) => outcome.status),
    ['imported', 'imported', 'imported'],
  );
  assert.deepEqual(outcomes.map((outcome) => outcome.message), [
    'Imported Vesper.',
    // Fails if the collision is not said.
    'Imported Vesper as vesper-2.incu; the library already had a file called vesper.incu.',
    // Fails if what nothing loaded declares is not counted (ADR 0052: imported, and said).
    'Imported Wren. One thing it uses is not in the content loaded, so it was imported without it.',
  ]);
  assert.deepEqual([...store.entries.keys()].sort(), ['vesper-2.incu', 'vesper.incu', 'wren.incu']);
  // Content loaded once for the game, not once per save.
  assert.deepEqual(loads, ['dnd5e']);
  assert.deepEqual(phases.slice(0, 2), ['loading', 'importing']);

  const view = importedView(outcomes);
  assert.equal(view.title, 'Imported');
  assert.equal(view.open, undefined, 'three imported: nothing to open');
  assert.ok(view.notes.length > 0, 'the importer noted the missing id');
  assert.equal(view.lines.at(-1), `The import noted ${view.notes.length === 1 ? 'one thing' : `${view.notes.length} things`}.`);
});

test('a refused import does not quote a provider id, and one imported is offered to open', async () => {
  const [lib] = await library();
  const deps = { library: lib, systems: SYSTEMS, load: async () => new MapElementIndex() as ElementIndex };
  const [empty] = await importReceivedSaves(deps, [{ name: 'a.dnd5e', bytes: save('A') }]);
  assert.equal(empty!.status, 'refused');
  // Fails if the desktop's sentence keeps its ADR number.
  assert.ok(!/ADR/.test(empty!.message), empty!.message);

  const loaded = { library: lib, systems: SYSTEMS, load: async () => corpus() };
  const broken = new TextEncoder().encode('<?xml version="1.0"?><characters/>');
  const [refused] = await importReceivedSaves(loaded, [{ name: 'msf:44', bytes: broken }], 'dnd5e');
  // Fails if the importer's message quotes the name it was handed ("msf:44.dnd5e").
  assert.equal(refused!.status, 'refused');
  assert.ok(refused!.message.startsWith('The file did not read as an Aurora save'), refused!.message);

  const failing = { library: lib, systems: SYSTEMS, load: async () => Promise.reject(new Error('offline')) };
  const [failed] = await importReceivedSaves(failing, [{ name: 'a.dnd5e', bytes: save('A') }]);
  assert.equal(failed!.message, '"a.dnd5e" was not imported: content did not load. offline');

  const ok = { library: lib, systems: SYSTEMS, load: async () => corpus() };
  const view = importedView(await importReceivedSaves(ok, [{ name: 'a.dnd5e', bytes: save('Solo') }]));
  // Fails if Open is not offered for exactly one.
  assert.deepEqual(view.open, { name: 'solo.incu', title: 'Solo' });
});

test('the line over the screen says what an import waits on', () => {
  const one = [{ name: 'a.dnd5e', bytes: new Uint8Array() }];
  assert.equal(saveImportLine(one, 'loading', { loaded: 312, total: 740 }), 'Loading content to import "a.dnd5e"… 312 of 740');
  assert.equal(saveImportLine(one, 'loading'), 'Loading content to import "a.dnd5e"…');
  assert.equal(saveImportLine([...one, ...one], 'importing'), 'Importing 2 saves…');
  assert.equal(saveImportLine([{ name: 'msf:44', bytes: new Uint8Array() }], 'importing'), 'Importing the file…');
});
