/**
 * The user's feature library against 5e's own kinds — ADR 0106.
 *
 * Measured first: an NPC may set seven numbers a player character works out, so one library feature, "Godspeed: Speed
 * 60", sets an NPC's speed and changes nothing on a player character, which says so rather than guessing; and the two
 * kinds share no type, so the feature is listed as each kind's default where the library's type is not the kind's.
 * Neither character needs the library to reopen. No content needed: both are built from nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  BundleElementIndex,
  deriveCharacter,
  MapElementIndex,
  readCharacterContainer,
  validateCharacter,
  type JsonSchema,
} from '@incudo/core';
import {
  addToLibrary,
  checkFeatureLibrary,
  CharacterBuilder,
  EMPTY_FEATURE_LIBRARY,
  newCharacterOfKind,
  packCharacter,
} from '@incudo/ui';

import { loadSchemas, loadShippedSystem, schemasDirectory } from './node-system.ts';

test('one library feature sets an NPC and only reads as add-only on a player character, and neither needs the library', async () => {
  // Fails if a given feature's set line is applied on a kind that works the number out, if the library's type is kept
  // on a kind that does not list it (the feature would be held nowhere), or if a reopened save loses the link.
  const system = await loadShippedSystem('dnd5e');
  const schemas = await loadSchemas();
  const librarySchema = JSON.parse(await readFile(join(schemasDirectory(), 'feature-library.schema.json'), 'utf8')) as JsonSchema;
  const empty = new MapElementIndex();

  const npc = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, empty);
  const written = npc.addCustomFeature('Godspeed')!;
  npc.updateCustomFeature(written, { stats: [{ stat: 'speed', mode: 'set', value: 60 }] });
  const { file, entry } = addToLibrary(EMPTY_FEATURE_LIBRARY, npc.getState().character.customFeatures![0]!, system.id, 'f-godspeed');
  assert.deepEqual(checkFeatureLibrary({ ...file, features: file.features.map((f) => ({ ...f, type: 'Companion Trait' })) }, librarySchema).errors, []);
  const typed = { ...entry, type: 'Companion Trait' };

  const second = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, empty);
  second.giveLibraryFeature(typed);
  assert.equal(second.getState().derived.stats.get('speed')?.value, 60);
  assert.equal(second.getState().customFeatures.features[0]!.type, 'Companion Trait');

  const pc = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, empty);
  const speedBefore = pc.getState().derived.stats.get('speed')?.value;
  pc.giveLibraryFeature(typed);
  const pcState = pc.getState();
  assert.equal(pcState.derived.stats.get('speed')?.value, speedBefore);
  const [view] = pcState.customFeatures.features;
  assert.equal(view!.type, 'Class Feature');
  assert.deepEqual(view!.lines.map((l) => l.status), ['add-only']);
  assert.equal(pcState.character.customFeatures![0]!.type, undefined);

  for (const state of [second.getState(), pcState]) {
    assert.deepEqual(validateCharacter(state.character, schemas).errors, []);
    const { container } = readCharacterContainer(packCharacter(state.character, system, empty, { generator: 'test' }).files);
    assert.deepEqual(container!.character.customFeatures![0]!.library, { id: 'f-godspeed', revision: 1 });
    assert.equal(container!.character.formatVersion, 12);
    const reopened = deriveCharacter(container!.character, system, new BundleElementIndex(container!.content.elements));
    assert.equal(reopened.stats.get('speed')?.value, state.derived.stats.get('speed')?.value);
  }
});
