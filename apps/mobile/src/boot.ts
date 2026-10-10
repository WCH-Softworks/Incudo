/**
 * The system definitions the phone ships with, validated — the mobile side of the desktop's `boot.ts`.
 *
 * The one place the phone reads the project's shared data (`systems/`, `schemas/`), through `validateGameSystem`, the
 * same function the desktop and the tests call (ADR 0011): there is no second validator. Metro maps `@repo/…` to the
 * repository's own folders (`metro.config.js`), as Vite does for the desktop.
 *
 * Unlike the desktop, the phone asks no "which game?" first: a read-only sheet opens a character against the system
 * its file names, and a character whose system is not shipped says so.
 */

import { validateGameSystem, type GameSystem, type JsonSchema, type SchemaBundle, type SchemaError } from '@incudo/core';
import { checkStartingEquipment, type StartingEquipmentFile } from '@incudo/ui';

import systemSchema from '@repo/schemas/system.schema.json';
import characterSchema from '@repo/schemas/character.schema.json';
import manifestSchema from '@repo/schemas/manifest.schema.json';
import dnd5e from '@repo/systems/dnd5e/system.json';
import cairn from '@repo/systems/cairn/system.json';
import startingEquipmentSchema from '@repo/schemas/starting-equipment.schema.json';
import dnd5eStartingEquipment from '@repo/systems/dnd5e/starting-equipment.json';
import featureLibrarySchemaFile from '@repo/schemas/feature-library.schema.json';

/** The user's feature library's schema (ADR 0106). */
export const featureLibrarySchema = featureLibrarySchemaFile as JsonSchema;

const SHIPPED: unknown[] = [dnd5e, cairn];

export const schemas: SchemaBundle = {
  system: systemSchema as SchemaBundle['system'],
  character: characterSchema as SchemaBundle['character'],
  manifest: manifestSchema as SchemaBundle['manifest'],
};

export interface ShippedSystems {
  systems: GameSystem[];
  /** A shipped definition that would not validate, by whatever id it gave itself. */
  failures: { id: string; errors: SchemaError[] }[];
}

/**
 * The starting equipment shipped beside the systems (ADR 0087), each checked against the system it names by the same
 * `checkStartingEquipment` the desktop and the tests call. One that does not check is left out, and the step offers
 * nothing rather than the wrong package.
 */
export function loadShippedStartingEquipment(systems: readonly GameSystem[]): StartingEquipmentFile[] {
  const files: StartingEquipmentFile[] = [];
  for (const candidate of [dnd5eStartingEquipment] as unknown[]) {
    const system = systems.find((s) => s.id === (candidate as { system?: unknown }).system);
    const result = checkStartingEquipment(candidate, startingEquipmentSchema as JsonSchema, system);
    if (result.value && system) files.push(result.value);
    else console.error('A shipped starting equipment file does not check and is left out.', result.errors);
  }
  return files;
}

export function loadShippedSystems(): ShippedSystems {
  const systems: GameSystem[] = [];
  const failures: ShippedSystems['failures'] = [];
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
