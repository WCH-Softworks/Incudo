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
import { formatSchemaErrors, type GameSystem, type JsonSchema, type SchemaBundle } from '@incudo/core';
import { loadShippedCatalog, systemProblemLine } from '@incudo/ui';

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

/**
 * Definitions the tests build with and the apps do not ship. Cairn is here: the one system that is not 5e, kept so the
 * engine is still run against a game with no levels and three scores, and not shipped in 1.0 (the maintainer's call,
 * 2026-10-27; docs/LICENSING.md).
 */
export function fixtureSystemsDirectory(): string {
  return join(repoRoot(), 'tools', 'verify', 'fixtures', 'systems');
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
  return loadSystemAt(join(systemsDirectory(), id, 'system.json'), `the system "${id}" is not shipped here`);
}

/** One of the definitions under `tools/verify/fixtures/systems`, through the same loader. Throws, as above. */
export async function loadFixtureSystem(id: string): Promise<GameSystem> {
  return loadSystemAt(join(fixtureSystemsDirectory(), id, 'system.json'), `the test system "${id}" is not here`);
}

async function loadSystemAt(path: string, missing: string): Promise<GameSystem> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`${missing} (${path}): ${(error as Error).message}`);
  }

  // The loader the apps call for every definition, shipped or the user's (ADR 0107), from the file's text.
  const loaded = loadShippedCatalog([{ text }], await loadSchemas());
  const system = loaded.systems[0];
  if (!system) {
    const problems = loaded.failures.flatMap((failure) => failure.problems);
    throw new Error(`${path} is not a valid system definition:\n  ${problems.map(systemProblemLine).join('\n  ')}`);
  }
  return system;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}
