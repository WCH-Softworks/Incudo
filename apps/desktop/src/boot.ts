/**
 * Everything the shell needs before it can show a character: the system definition, validated.
 *
 * This is the one place the app reads the project's shared data (`systems/`, `schemas/`) rather
 * than a package. It goes through `validateGameSystem` — the *same* function the CLI calls — for
 * the reason ADR 0011 gives: a system that passes `incudo system validate` and then fails to
 * load in the app would make "if it parses, the app can build in it" a lie. There is no second
 * validator here and there must never be one.
 */

import {
  clampProgress,
  createCharacter,
  defaultCharacterKindId,
  initialProgress,
  resolveCharacterKind,
  validateCharacter,
  validateGameSystem,
  type Character,
  type GameSystem,
  type SchemaBundle,
  type SchemaError,
} from '@incudo/core';

import systemSchema from '@repo/schemas/system.schema.json';
import characterSchema from '@repo/schemas/character.schema.json';
import manifestSchema from '@repo/schemas/manifest.schema.json';
import dnd5e from '@repo/systems/dnd5e/system.json';

export const schemas: SchemaBundle = {
  system: systemSchema as SchemaBundle['system'],
  character: characterSchema as SchemaBundle['character'],
  manifest: manifestSchema as SchemaBundle['manifest'],
};

export type SystemLoad =
  | { ok: true; system: GameSystem }
  | { ok: false; errors: SchemaError[] };

/**
 * The shipped 5e definition.
 *
 * Failing here is a broken build rather than a broken character, so the app says so on screen
 * instead of rendering an empty sheet — the same instinct as the engine reporting a problem
 * rather than guessing (ADR 0005).
 */
export function loadShippedSystem(): SystemLoad {
  const result = validateGameSystem(dnd5e, schemas);
  if (!result.value) return { ok: false, errors: result.errors };
  return { ok: true, system: result.value };
}

const CHARACTER_KEY = 'character:current';

/** Read the character the shell last held, or start a new one. */
export async function loadCharacter(
  system: GameSystem,
  read: (key: string) => Promise<string | null>,
): Promise<Character> {
  try {
    const saved = await read(CHARACTER_KEY);
    if (saved) {
      // Validated, not trusted. This came out of storage, which the user can edit and which an
      // older version of this app may have written — so it goes through the published character
      // schema exactly as a `.incu` would.
      const result = validateCharacter(JSON.parse(saved) as unknown, schemas);
      if (result.value) return result.value;
    }
  } catch {
    // A corrupt draft is not worth losing the app over; start fresh rather than refusing to boot.
  }
  return newCharacter(system);
}

/**
 * A blank character of the system's default kind.
 *
 * The same three calls `incudo character new` makes, in the same order — including
 * `initialProgress`, because a 5e PC starts at level 1 and a monster at challenge 0, and the
 * kind's progression is the only thing that knows which.
 */
export function newCharacter(system: GameSystem): Character {
  const kindId = defaultCharacterKindId(system);
  if (!kindId) throw new Error(`System "${system.id}" declares no character kinds.`);
  const kind = resolveCharacterKind(system, kindId);

  const character = createCharacter(system.id, kind.id, {
    name: 'New Character',
    progress: initialProgress(kind.progression),
  });
  character.progress = clampProgress(kind.progression, character.progress);
  return character;
}

export async function saveCharacter(
  character: Character,
  write: (key: string, value: string) => Promise<void>,
): Promise<void> {
  await write(CHARACTER_KEY, JSON.stringify(character));
}
