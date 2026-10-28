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

import { type JsonSchema, type SchemaBundle } from '@incudo/core';
import { loadShippedCatalog, type ShippedCatalog } from '@incudo/ui';

import systemSchema from '@repo/schemas/system.schema.json';
import characterSchema from '@repo/schemas/character.schema.json';
import manifestSchema from '@repo/schemas/manifest.schema.json';
import dnd5e from '@repo/systems/dnd5e/system.json';
import featureLibrarySchemaFile from '@repo/schemas/feature-library.schema.json';

/** The user's feature library's schema (ADR 0106). */
export const featureLibrarySchema = featureLibrarySchemaFile as JsonSchema;

export const schemas: SchemaBundle = {
  system: systemSchema as SchemaBundle['system'],
  character: characterSchema as SchemaBundle['character'],
  manifest: manifestSchema as SchemaBundle['manifest'],
};

/**
 * The shipped definitions, read by the loader every definition goes through, the
 * desktop's and a user's file's (ADR 0107). Metro gives JSON as a value, not text, so a problem in a shipped definition
 * here has no line; the desktop's does.
 */
let shipped: ShippedCatalog | undefined;

export function loadShippedSystems(): ShippedCatalog {
  if (shipped) return shipped;
  shipped = loadShippedCatalog([{ value: dnd5e }], schemas);
  return shipped;
}
