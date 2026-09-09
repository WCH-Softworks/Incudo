/**
 * The one fixture character, shared by the tests and by the golden-container rebuilder.
 *
 * Every field that would otherwise be `new Date()` or a random id is pinned, because the
 * committed golden container under `fixtures/aelin/` has to be byte-stable — a fixture that
 * changes on every run is a fixture nobody can review.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCharacter, setChoice, setRoll, type Character } from '@incudo/core';

export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
export const GOLDEN_DIR = join(FIXTURES_DIR, 'aelin');

/** A hero built the way a user would build one: choices, a level, and recorded rolls. */
export function fixtureCharacter(): Character {
  let character = createCharacter('fixture', 'hero', { name: 'Aelin of the Reeds', progress: 7 });
  character.id = 'fixed-id-for-a-stable-test';
  character.createdAt = '2026-01-01T00:00:00.000Z';
  character = setChoice(character, 'build/kin', ['ID_KIN_RIVERFOLK']);
  character = setChoice(character, 'build/calling', ['ID_CALLING_WARDEN']);
  character = setChoice(character, 'ID_KIN_RIVERFOLK/select:Riverfolk Knack', ['ID_KNACK_DIVER']);
  character = setChoice(character, 'ID_CALLING_WARDEN/select:Starting Gear', ['ID_GEAR_SPEAR']);
  character = setRoll(character, 'wounds:level:2', 5);
  character = setRoll(character, 'wounds:level:3', 3);
  character.updatedAt = '2026-01-02T00:00:00.000Z';
  return character;
}
