/**
 * Finding the repository's schemas and shipped systems on disk.
 *
 * `@incudo/core` owns the validator and refuses to know about a filesystem, so somebody has to
 * hand it the schema documents. In a test that is here; in the app it is a bundler import. Both
 * then call the same `validateGameSystem` — the whole requirement of ADR 0011: one
 * implementation, so a system that passes here cannot then fail to load in the app.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatSchemaErrors,
  validateGameSystem,
  type GameSystem,
  type SchemaBundle,
} from '@incudo/core';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repository root, from `tools/<this package>/src`. */
export function repoRoot(): string {
  return resolve(HERE, '..', '..', '..');
}

export function schemasDirectory(): string {
  return join(repoRoot(), 'schemas');
}

export function systemsDirectory(): string {
  return join(repoRoot(), 'systems');
}

let cached: SchemaBundle | undefined;

export async function loadSchemas(): Promise<SchemaBundle> {
  if (cached) return cached;
  const dir = schemasDirectory();
  const [system, character, manifest] = await Promise.all([
    readJson(join(dir, 'system.schema.json')),
    readJson(join(dir, 'character.schema.json')),
    readJson(join(dir, 'manifest.schema.json')),
  ]);
  cached = { system, character, manifest } as SchemaBundle;
  return cached;
}

/**
 * One of the systems the repository ships, validated.
 *
 * A system that fails validation is refused rather than partly loaded (ADR 0011), and the error
 * carries the schema paths, because whoever reads it has the JSON open and needs to know where
 * to look. A save embeds its content and deliberately not its system definition (ADR 0012), so
 * the id a save records is looked up here.
 */
export async function loadShippedSystem(id: string): Promise<GameSystem> {
  const path = join(systemsDirectory(), id, 'system.json');
  let raw: Record<string, unknown>;
  try {
    raw = await readJson(path);
  } catch (error) {
    throw new Error(`the system "${id}" is not shipped here (${path}): ${(error as Error).message}`);
  }

  const result = validateGameSystem(raw, await loadSchemas());
  if (!result.valid || !result.value) {
    throw new Error(
      `${path} is not a valid system definition:\n  ${formatSchemaErrors(result.errors).join('\n  ')}`,
    );
  }
  return result.value;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}
