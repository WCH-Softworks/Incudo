/**
 * Incudo's content format and its schema — ADR 0119 decision 4.
 *
 * `schemas/content.schema.json` is the contract; `checkContentBundle` is the one checker and runs the schema through the
 * one validator when it is handed it. What this holds: every element of the official corpus, the committed fixture's
 * `content.json`, and the content every sample's save embeds read as the format, by the schema; and the schema and the
 * checker refuse the same broken files.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { CharacterLibrary, importAuroraSaveIntoLibrary } from '@incudo/ui';

import {
  CONTENT_FORMAT_VERSION,
  checkContentBundle,
  readCharacterContainer,
  type CharacterStore,
  type ContentBundle,
  type JsonSchema,
  type LibraryEntryRef,
} from '@incudo/core';

import { GOLDEN_DIR } from './fixture-character.ts';
import { loadShippedSystem, schemasDirectory } from './node-system.ts';
import { corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

async function schema(): Promise<JsonSchema> {
  return JSON.parse(await readFile(join(schemasDirectory(), 'content.schema.json'), 'utf8')) as JsonSchema;
}

test('the fixture content reads as the content format, by the schema', async () => {
  const raw = JSON.parse(await readFile(join(GOLDEN_DIR, 'content.json'), 'utf8'));
  const { value, problems } = checkContentBundle(raw, { schema: await schema() });
  assert.deepEqual(problems, []);
  assert.equal(value?.formatVersion, CONTENT_FORMAT_VERSION);
});

test('the checker and the schema refuse the same broken files, each with a sentence', async () => {
  const contract = await schema();
  const element = { id: 'ID_A', type: 'Feat', name: 'A', source: '', setters: {}, rules: [], supports: [] };
  const good: ContentBundle = { formatVersion: 1, elements: [element as never] };
  assert.deepEqual(checkContentBundle(good, { schema: contract }).problems, []);
  const broken: Array<[string, unknown]> = [
    ['another version', { ...good, formatVersion: 2 }],
    ['no elements', { formatVersion: 1 }],
    ['an element with no id', { formatVersion: 1, elements: [{ ...element, id: '' }] }],
    ['an id twice', { formatVersion: 1, elements: [element, { ...element, id: 'id_a' }] }],
    ['an element with no rules', { formatVersion: 1, elements: [{ ...element, rules: undefined }] }],
  ];
  for (const [what, file] of broken) {
    assert.ok(checkContentBundle(file).problems.length, `the checker should refuse ${what}`);
  }
  // What only the schema says: the shape of a rule and of an expression.
  const shapes: Array<[string, unknown]> = [
    ['a rule of no kind', { formatVersion: 1, elements: [{ ...element, rules: [{ kind: 'wish', key: 'w' }] }] }],
    ['a field nothing reads', { formatVersion: 1, elements: [{ ...element, colour: 'red' }] }],
    [
      'a stat whose value is not an expression',
      { formatVersion: 1, elements: [{ ...element, rules: [{ kind: 'stat', key: 's', name: 'x', value: 2 }] }] },
    ],
  ];
  for (const [what, file] of shapes) {
    assert.ok(checkContentBundle(file, { schema: contract }).problems.length, `the schema should refuse ${what}`);
  }
});

test('every element of the corpus reads as the content format, by the schema', { skip: corpusSkip }, async () => {
  const elements = [...(await realElements()).all()];
  const { problems } = checkContentBundle({ formatVersion: 1, elements }, { schema: await schema() });
  assert.deepEqual(problems, []);
});

test('the content each sample save embeds reads as the content format, by the schema', { skip: corpusSkip || savesSkip }, async () => {
  const contract = await schema();
  const elements = await realElements();
  const system = await loadShippedSystem('dnd5e');
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
  const library = new CharacterLibrary(store);
  await library.restore();
  for (const sample of readManifest().samples) {
    const path = samplePath(sample);
    const report = await importAuroraSaveIntoLibrary(library, { name: basename(path), bytes: new Uint8Array(readFileSync(path)) }, { system, elements });
    assert.ok(report.ok, `${sample.file} imports`);
  }
  assert.ok(entries.size > 0);
  for (const [name, files] of entries) {
    const read = readCharacterContainer(files);
    assert.ok(read.container, `${name} reads back`);
    assert.deepEqual(checkContentBundle(read.container.content, { schema: contract }).problems, [], name);
  }
});
