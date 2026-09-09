/**
 * The two workspace invariants CLAUDE.md states, as tests rather than as prose.
 *
 * Both had already broken silently once. The packages pointed `main`/`exports` at `./dist/`,
 * so importing `@incudo/core` needed a build — which every local run happened to satisfy,
 * because `npm run typecheck` emits `dist/` as a side effect and people run it before they run
 * anything else. CI's corpus job does not run typecheck, so it was the only thing that ever
 * told the truth, and what it said was ERR_MODULE_NOT_FOUND.
 *
 * A rule nothing checks is a rule that is already false somewhere.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { repoRoot } from './node-system.ts';

interface PackageJson {
  name?: string;
  main?: string;
  types?: string;
  exports?: unknown;
  workspaces?: string[];
}

async function readPackage(path: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageJson;
}

async function workspacePackages(): Promise<Array<{ dir: string; pkg: PackageJson }>> {
  const found: Array<{ dir: string; pkg: PackageJson }> = [];
  for (const group of ['packages', 'tools']) {
    const root = join(repoRoot(), group);
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const manifest = join(dir, 'package.json');
      if (existsSync(manifest)) found.push({ dir, pkg: await readPackage(manifest) });
    }
  }
  return found;
}

/** Every string in a package's `exports`, however it is nested. */
function exportTargets(exports: unknown, into: string[] = []): string[] {
  if (typeof exports === 'string') into.push(exports);
  else if (Array.isArray(exports)) for (const e of exports) exportTargets(e, into);
  else if (exports && typeof exports === 'object') {
    for (const value of Object.values(exports)) exportTargets(value, into);
  }
  return into;
}

test('no package entry point requires a build step', async () => {
  const packages = await workspacePackages();
  assert.ok(packages.length >= 4, 'expected core, content, aurora-import, ui and the CLI');

  for (const { dir, pkg } of packages) {
    const targets = [pkg.main, pkg.types, ...exportTargets(pkg.exports)].filter(
      (t): t is string => typeof t === 'string',
    );

    for (const target of targets) {
      // The failure this exists to catch: "./dist/index.js" resolves only after tsc has run,
      // so `npm ci && npm test` on a clean checkout dies with ERR_MODULE_NOT_FOUND.
      assert.ok(
        !target.includes('dist/'),
        `${pkg.name} points "${target}" at dist/, which only exists after a build. ` +
          `Point it at ./src/ — Node strips the types on import (CLAUDE.md, "Hard constraints").`,
      );
      assert.ok(
        existsSync(join(dir, target)),
        `${pkg.name} points at "${target}", which is not in the checkout.`,
      );
    }
  }
});

test('apps/* stay out of the workspaces', async () => {
  const root = await readPackage(join(repoRoot(), 'package.json'));
  // Their package.json files declare Expo and Tauri for shells that do not exist, so adding
  // them turns `npm install` from 8 seconds into ~700 MB before there is anything to run.
  assert.deepEqual(root.workspaces, ['packages/*', 'tools/*']);
});
