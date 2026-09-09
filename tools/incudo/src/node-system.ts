/**
 * Loading system definitions and the JSON Schemas, from disk.
 *
 * `@incudo/core` owns the validator and refuses to know about a filesystem, so somebody has
 * to hand it the schema documents. On the CLI that is here; in an app it is a bundler
 * import. Both then call the same `validateGameSystem` — which is the whole requirement of
 * ADR 0011: one implementation, so `incudo system validate` and the app cannot disagree.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatSchemaErrors,
  validateGameSystem,
  type Character,
  type GameSystem,
  type SchemaBundle,
} from '@incudo/core';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repository root, from `tools/incudo/src`. */
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
 * Read and validate a system definition.
 *
 * A system that fails validation is refused rather than partly loaded (ADR 0011). The
 * errors go to the caller's stderr with paths, because the person reading them has the JSON
 * file open and needs to know where to look.
 */
export async function loadSystem(
  path: string,
  err: (text: string) => void,
): Promise<GameSystem | undefined> {
  let raw: unknown;
  try {
    raw = await readJson(await resolveSystemPath(path));
  } catch (error) {
    err(`Could not read ${path}: ${(error as Error).message}\n`);
    return undefined;
  }

  const result = validateGameSystem(raw, await loadSchemas());
  if (!result.valid) {
    err(`${path} is not a valid system definition:\n`);
    for (const line of formatSchemaErrors(result.errors)) err(`  ${line}\n`);
    return undefined;
  }
  return result.value;
}

/**
 * The system a character was built in.
 *
 * An explicit `--system` wins. Otherwise the id recorded in the save is looked up among the
 * shipped systems, so `incudo character show foo.incu` works with no flags — which matters,
 * because opening a save with nothing else configured is the property ADR 0012 is about. The
 * system definition is the one thing a save deliberately does *not* embed.
 */
export async function loadSystemForCharacter(
  character: Character,
  explicitPath: string | undefined,
  err: (text: string) => void,
): Promise<GameSystem | undefined> {
  if (explicitPath) return loadSystem(explicitPath, err);

  const candidate = join(systemsDirectory(), character.systemId, 'system.json');
  const system = await loadSystem(candidate, () => {});
  if (system) return system;

  err(
    `This character was built in the system "${character.systemId}", which is not installed.\n` +
      `  Point at it with --system <path/to/system.json>.\n` +
      `  (A save embeds its content but not its system definition — ADR 0012.)\n`,
  );
  return undefined;
}

/** `--system dnd5e` is as good as the full path to a shipped system. */
async function resolveSystemPath(path: string): Promise<string> {
  if (path.endsWith('.json')) return path;
  return join(systemsDirectory(), path, 'system.json');
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}
