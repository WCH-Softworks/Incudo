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
import cairn from '@repo/systems/cairn/system.json';

/**
 * Every system definition that ships with the app, in the order the launcher offers them.
 *
 * A list rather than one import, because the app used to hardcode 5e and never ask — the
 * header said "Dungeons & Dragons 5th Edition" from the first frame, on a machine where the
 * user had chosen nothing (ADR 0031). Adding a system here is the whole of adding a system.
 */
const SHIPPED: unknown[] = [dnd5e, cairn];

export const schemas: SchemaBundle = {
  system: systemSchema as SchemaBundle['system'],
  character: characterSchema as SchemaBundle['character'],
  manifest: manifestSchema as SchemaBundle['manifest'],
};

/** A shipped definition that would not validate. Named, so the launcher can say which. */
export interface SystemFailure {
  /** Whatever the file called itself, when it got far enough to say. */
  id: string;
  errors: SchemaError[];
}

export interface ShippedSystems {
  systems: GameSystem[];
  failures: SystemFailure[];
}

/**
 * Every shipped system that validates, plus the ones that did not.
 *
 * Each is checked on its own. One broken definition used to be fatal — there was only one, so
 * "the app cannot start" and "this system cannot be used" were the same sentence. With a
 * launcher they are not: a bad Cairn file must not stop anyone building a D&D character, and
 * the launcher lists it as unavailable with its errors rather than pretending it is not there.
 *
 * Still `validateGameSystem`, the *same* function the CLI calls, for the reason ADR 0011
 * gives. There is no second validator here and there must never be one.
 */
export function loadShippedSystems(): ShippedSystems {
  const systems: GameSystem[] = [];
  const failures: SystemFailure[] = [];
  for (const candidate of SHIPPED) {
    const result = validateGameSystem(candidate, schemas);
    if (result.value) systems.push(result.value);
    else {
      const id = (candidate as { id?: unknown })?.id;
      failures.push({ id: typeof id === 'string' ? id : 'unknown', errors: result.errors });
    }
  }
  return { systems, failures };
}

/** Where the launcher's answer is kept between launches — ADR 0031. */
const SYSTEM_KEY = 'system:current';

export async function readChosenSystem(
  read: (key: string) => Promise<string | null>,
): Promise<string | null> {
  try {
    return await read(SYSTEM_KEY);
  } catch {
    return null;
  }
}

export async function writeChosenSystem(
  systemId: string | null,
  write: (key: string, value: string) => Promise<void>,
): Promise<void> {
  await write(SYSTEM_KEY, systemId ?? '');
}

const CHARACTER_KEY = 'character:current';

/**
 * Read the draft the shell last held, or start a new one **of this system**.
 *
 * The system check is the point. A draft is keyed on nothing but "current", so switching
 * systems used to hand a D&D character to whatever definition was loaded and derive it
 * against the wrong rules — silently, because `deriveCharacter` takes a system and a
 * character and has never had reason to ask whether they agree. A draft belonging to another
 * system is not corrupt and is not discarded: it is simply not this system's, so this system
 * starts fresh and the draft stays in storage until its own system claims it.
 */
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
      if (result.value && result.value.systemId === system.id) return result.value;
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
