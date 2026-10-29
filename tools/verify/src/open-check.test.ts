/**
 * A character file that does not derive is refused with a sentence, and one the validator dislikes but derives still
 * opens. Found driving ADR 0119's changes in the Tauri window: a `.incu` whose `character.json` recorded `choices` as an
 * object blanked the whole window ("An error occurred in the <Shell> component"), because nothing asked before the
 * builder derived it. Each case names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BundleElementIndex, createCharacter, validateCharacter, type Character } from '@incudo/core';
import { characterOpenProblem } from '@incudo/ui';

import { loadSchemas, loadShippedSystem } from './node-system.ts';

const system = await loadShippedSystem('dnd5e');
const schemas = await loadSchemas();
const nothing = new BundleElementIndex([]);
const fresh = (): Character => ({ ...createCharacter('dnd5e', 'pc', { progress: 1 }), name: 'Tester' });

test('a character that derives opens', () => {
  // Perturbation: refuse whatever the validator refuses, and the extra field below refuses a file that opens.
  assert.equal(characterOpenProblem(system, fresh(), nothing, schemas), undefined);
  const unknownField = { ...fresh(), aFieldALaterSchemaDropped: true } as Character;
  assert.ok(validateCharacter(unknownField, schemas, system).errors.length > 0, 'the validator refuses the extra field');
  assert.equal(characterOpenProblem(system, unknownField, nothing, schemas), undefined, 'a file opens if it opens');
});

test('a character whose build throws is refused, the validator naming why', () => {
  // Perturbation: drop the try around the build and this throws, which is the blank window.
  const malformed = { ...fresh(), choices: { 'build/class': ['ID_X'] } } as unknown as Character;
  assert.equal(
    characterOpenProblem(system, malformed, nothing, schemas),
    '“Tester” cannot be opened: its file does not read as a character (choices: must be an array, not an object). Nothing on screen was replaced.',
  );
  assert.match(characterOpenProblem(system, malformed, nothing)!, /^“Tester” cannot be opened: its file does not read as a character\. /);
});

test('a kind the system does not declare is refused as before', () => {
  // Perturbation: drop the kind check and the builder's own message comes through the catch instead.
  assert.match(characterOpenProblem(system, { ...fresh(), kind: 'sidekick' }, nothing, schemas)!, /a kind of character \(sidekick\)/);
});

