/**
 * An Aurora save imported with its content loaded names that content's source on its library card, and no other.
 *
 * Found driving the installed rc.2 build: every imported character's card read "Not in your sources: Aurora Legacy
 * Essentials, Player's Handbook, … Opens anyway." with AuroraLegacy, which holds every one of those books, loaded. The
 * importer recorded each book the character drew on as a `SourceRef` named by the book's `Source` element id, and the
 * library matches refs against configured sources by index URL (ADR 0028), which a book id never is. Books are not
 * content sources; the ones a character is offered are `Character.publications` (ADR 0049).
 *
 * Every sample is imported through `importAuroraSaveIntoLibrary`, the desktop's function, into a library whose profile
 * holds the corpus as the one configured source, keyed as the app keys it: by the URL its elements carry as
 * `origin.sourceId`. Each card must record that source and read it present.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import type { CharacterStore, LibraryEntryRef } from '@incudo/core';
import type { ConfiguredSource } from '@incudo/content';
import { CharacterLibrary, importAuroraSaveIntoLibrary } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

function memoryLibrary(): CharacterLibrary {
  const entries = new Map<string, Map<string, Uint8Array>>();
  const store: CharacterStore = {
    available: true,
    location: async () => 'library',
    choose: async () => 'library',
    list: async (): Promise<LibraryEntryRef[]> => [...entries.keys()].map((name) => ({ name, form: 'zip' as const })),
    read: async (entry) => new Map(entries.get(entry.name)),
    write: async (entry, files) => void entries.set(entry.name, new Map(files)),
    remove: async (entry) => void entries.delete(entry.name),
  };
  return new CharacterLibrary(store);
}

test('an imported sample with its source loaded names no source as missing', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const sourceIds = new Set<string>();
  for (const element of elements.all()) if (!element.origin.sourceId.startsWith('aurora:')) sourceIds.add(element.origin.sourceId);
  assert.equal(sourceIds.size, 1, 'the corpus loads as one source');
  const [url] = sourceIds;
  const profile: ConfiguredSource[] = [
    { id: url!, url: url!, name: 'Corpus', systemId: 'dnd5e', enabled: true, mode: 'download', addedAt: '2026-01-01T00:00:00.000Z' },
  ];

  const library = memoryLibrary();
  library.setProfile(profile);
  await library.restore();
  const samples = samplesWhere(() => true);
  for (const sample of samples) {
    const path = samplePath(sample);
    const report = await importAuroraSaveIntoLibrary(library, { name: basename(path), bytes: new Uint8Array(readFileSync(path)) }, { system, elements });
    assert.ok(report.ok, `${sample.file} imports`);
  }

  const entries = library.getState().entries;
  assert.equal(entries.length, samples.length);
  for (const entry of entries) {
    assert.deepEqual(entry.sources.map((ref) => ref.id), [url], `${entry.name} records the corpus as its source, and nothing else`);
    assert.deepEqual(entry.sourceStatuses.map((status) => status.state), ['present'], `${entry.name} reads its source present`);
  }
});
