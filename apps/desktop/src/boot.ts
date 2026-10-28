/**
 * Everything the shell needs before it can show a character: the system definition, validated.
 *
 * This is the one place the app reads the project's shared data (`systems/`, `schemas/`) rather
 * than a package. It goes through `validateGameSystem` — the *same* function the tests call — for
 * the reason ADR 0011 gives: a system that passes the tests and then fails to
 * load in the app would make "if it parses, the app can build in it" a lie. There is no second
 * validator here and there must never be one.
 */

import {
  defaultCharacterKindId,
  validateCharacter,
  type Character,
  type GameSystem,
  type SchemaBundle,
  type JsonSchema,
  type Storage,
} from '@incudo/core';
import {
  DRAFT_KEY,
  checkFormMap,
  loadShippedCatalog,
  newCharacterOfKind,
  readDraftCharacter,
  readDraftOrigin,
  type FormMap,
  type ShippedCatalog,
  type SystemDefinitionSource,
  type WorkingCharacter,
} from '@incudo/ui';

import systemSchema from '@repo/schemas/system.schema.json';
import characterSchema from '@repo/schemas/character.schema.json';
import manifestSchema from '@repo/schemas/manifest.schema.json';
// As text, so a shipped definition is read by the same `readJsonText` a user's file is, and a problem in it has a line.
import dnd5e from '@repo/systems/dnd5e/system.json?raw';
import formMapSchema from '@repo/schemas/form-map.schema.json';
import dnd5eOfficial2014 from '@repo/systems/dnd5e/forms/official-2014.json';
import featureLibrarySchemaFile from '@repo/schemas/feature-library.schema.json';

/** The user's feature library's schema (ADR 0106), which `FeatureLibrary` checks the folder's file against. */
export const featureLibrarySchema = featureLibrarySchemaFile as JsonSchema;

/**
 * Every system definition that ships with the app, in the order the launcher offers them, as the text of its file.
 *
 * A list rather than one import, because the app used to hardcode 5e and never ask — the
 * header said "Dungeons & Dragons 5th Edition" from the first frame, on a machine where the
 * user had chosen nothing (ADR 0031). Adding a system here is the whole of adding a system.
 */
const SHIPPED: SystemDefinitionSource[] = [{ text: dnd5e }];

export const schemas: SchemaBundle = {
  system: systemSchema as SchemaBundle['system'],
  character: characterSchema as SchemaBundle['character'],
  manifest: manifestSchema as SchemaBundle['manifest'],
};

/**
 * The shipped definitions, read once, by the loader every definition goes through
 * (ADR 0107): `readJsonText`, `validateGameSystem`, warnings and problems located. A user's definitions are read by the
 * same function through `UserSystemStore`, and `systemCatalog` puts the two together. One broken definition is not
 * fatal: the launcher lists it with its problems, as it does a user's.
 */
let shipped: ShippedCatalog | undefined;

export function loadShippedSystems(): ShippedCatalog {
  if (shipped) return shipped;
  shipped = loadShippedCatalog(SHIPPED, schemas);
  return shipped;
}

/**
 * The form maps shipped beside the systems (ADR 0079 decision 5): which field of a published form takes what from the
 * sheet. A map is not part of the system format; it is read here, checked by the same `checkFormMap` the tests call, and
 * one that does not check is left out and logged, which leaves its command unavailable rather than filling a form wrong.
 */
const SHIPPED_FORMS: unknown[] = [dnd5eOfficial2014];

export function loadShippedForms(): FormMap[] {
  const maps: FormMap[] = [];
  for (const candidate of SHIPPED_FORMS) {
    const result = checkFormMap(candidate, formMapSchema as JsonSchema);
    if (result.value) maps.push(result.value);
    else console.error('A shipped form map does not check and is left out.', result.errors);
  }
  return maps;
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
export async function loadCharacter(system: GameSystem, storage: Storage): Promise<{ character: Character; setAside?: string }> {
  // Validated, not trusted. This came out of storage, which the user can edit and which an older version of this app
  // may have written — so it goes through the published character schema exactly as a `.incu` would. A corrupt draft
  // is not worth losing the app over; it starts fresh rather than refusing to boot. So does one whose kind the system
  // no longer declares, which `readDraftCharacter` sets aside and says so.
  const read = await readDraftCharacter(system, storage, (value) => validateCharacter(value, schemas).value);
  return { character: read.character ?? newCharacter(system), ...(read.setAside ? { setAside: read.setAside } : {}) };
}

/** The draft the shell starts from, and the sentence to say when the last one could not be opened. */
export interface LoadedDraft extends WorkingCharacter {
  setAside?: string;
}

/**
 * The draft and what was kept beside it (ADR 0066): the embedded content, assets and library entry
 * of the file it was opened from, so a reload hands the shell back what it held. A record kept for
 * any other character is not this one's, which includes the fresh character `loadCharacter` starts
 * when the draft is another system's or was set aside.
 */
export async function loadDraft(system: GameSystem, storage: Storage): Promise<LoadedDraft> {
  const { character, setAside } = await loadCharacter(system, storage);
  return { ...(await readDraftOrigin(storage, character.id)), character, ...(setAside ? { setAside } : {}) };
}

/**
 * A blank character of one of the system's kinds, the default one when none is named.
 *
 * `newCharacterOfKind` (`packages/ui`) does the work, including starting the kind at the start of
 * its own progression: a 5e PC at level 1 and a monster at challenge 0.
 */
export function newCharacter(system: GameSystem, kindId?: string): Character {
  const kind = kindId ?? defaultCharacterKindId(system);
  if (!kind) throw new Error(`System "${system.id}" declares no character kinds.`);
  return newCharacterOfKind(system, kind);
}

export async function saveCharacter(
  character: Character,
  write: (key: string, value: string) => Promise<void>,
): Promise<void> {
  await write(DRAFT_KEY, JSON.stringify(character));
}
