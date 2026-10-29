/**
 * The format policy — ADR 0130.
 *
 * Only 1.0's formats are supported, and their numbers are the baseline: these tests hold every schema to the numbers
 * `FORMAT_VERSIONS` says the readers know, so moving one is a deliberate edit in three places (the schema, the constant,
 * the ADR) and never a drift. And a file a newer Incudo wrote is refused by each reader with the one sentence that says
 * so (the maintainer's call, 2026-10-28), never opened: opening it would drop what this version cannot read, and a Save
 * would write the loss back. Each case names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  checkContentBundle,
  createCharacter,
  encodeJson,
  FORMAT_VERSIONS,
  LATEST_CHARACTER_FORMAT_VERSION,
  newerFormatNote,
  packCharacterContainer,
  readCharacterContainer,
  validateGameSystem,
} from '@incudo/core';
import { readFeatureLibrary } from '@incudo/ui';

import { loadSchemas, systemsDirectory } from './node-system.ts';

const schemaOf = async (name: string): Promise<Record<string, any>> =>
  JSON.parse(await readFile(join(systemsDirectory(), '..', 'schemas', name), 'utf8')) as Record<string, any>;

test('every schema states the number its reader knows, and 1.0 is the baseline', async () => {
  // Perturbation: bump a schema's const, or LATEST_CHARACTER_FORMAT_VERSION, without the other, and this names it.
  const character = await schemaOf('character.schema.json');
  const numbers = Array.from({ length: FORMAT_VERSIONS.character }, (_, i) => i + 1);
  assert.deepEqual(character.properties.formatVersion.enum, numbers, 'character.json reads every number from 1 up');
  assert.equal(FORMAT_VERSIONS.character, LATEST_CHARACTER_FORMAT_VERSION);
  for (const [file, reads] of [
    ['manifest.schema.json', FORMAT_VERSIONS.container],
    ['content.schema.json', FORMAT_VERSIONS.content],
    ['system.schema.json', FORMAT_VERSIONS.system],
    ['feature-library.schema.json', FORMAT_VERSIONS.featureLibrary],
  ] as const) {
    assert.equal((await schemaOf(file)).properties.formatVersion.const, reads, file);
  }
  // 1.0's baseline (ADR 0130): character 14, every other format 1.
  assert.deepEqual(FORMAT_VERSIONS, { character: 14, container: 1, content: 1, system: 1, featureLibrary: 1 });
});

function container(edit: (files: Map<string, Uint8Array>) => void) {
  const character = createCharacter('dnd5e', 'pc', { progress: 1 });
  const files = packCharacterContainer(character, { elements: [], unresolved: [] });
  edit(files);
  return readCharacterContainer(files);
}

test('a character file a newer Incudo wrote is refused, naming why', () => {
  // Perturbation: drop the container's checks and the file opens, the unknown fields lost on the next Save.
  const character = { ...createCharacter('dnd5e', 'pc', { progress: 1 }), formatVersion: FORMAT_VERSIONS.character + 1 };
  const newerCharacter = container((files) => files.set('character.json', encodeJson(character)));
  assert.equal(newerCharacter.container, undefined);
  assert.deepEqual(
    newerCharacter.problems.map((p) => p.message),
    [newerFormatNote('character', FORMAT_VERSIONS.character + 1, FORMAT_VERSIONS.character)],
  );
  assert.match(newerCharacter.problems[0]!.message, /newer version of Incudo \(format 15; this version reads up to 14\)/);

  const newerManifest = container((files) => {
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
    files.set('manifest.json', encodeJson({ ...manifest, formatVersion: 2 }));
  });
  assert.equal(newerManifest.container, undefined);
  assert.match(newerManifest.problems[0]!.message, /This character file was written by a newer version of Incudo/);

  // Every format this version knows still opens.
  const current = container(() => {});
  assert.ok(current.container, 'a file at this version opens');
});

test('content, a system definition and a feature library from a newer Incudo are refused the same way', async () => {
  // Perturbation: drop any reader's check and its case reads the schema's error, or opens.
  assert.deepEqual(checkContentBundle({ formatVersion: 2, elements: [] }).problems, [newerFormatNote('content', 2, 1)]);

  const dnd5e = JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'system.json'), 'utf8'));
  const system = validateGameSystem({ ...dnd5e, formatVersion: 2 }, await loadSchemas());
  assert.equal(system.value, undefined);
  assert.deepEqual(system.errors, [{ path: 'formatVersion', message: newerFormatNote('system definition', 2, 1) }]);

  const library = readFeatureLibrary(encodeJson({ formatVersion: 2, features: [] }), await schemaOf('feature-library.schema.json'));
  assert.equal(library.status, 'unreadable');
  assert.match(library.status === 'unreadable' ? library.reason : '', /^This feature library \(incudo-features\.json\) was written by a newer version of Incudo/);
});
