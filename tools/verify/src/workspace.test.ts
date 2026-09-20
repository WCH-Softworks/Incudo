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
  // The packages the rest of the project imports, by name. Not "at least N": a folder count says
  // nothing about which ones are there, and adding a package must not touch this test.
  const names = packages.map(({ pkg }) => pkg.name);
  for (const name of ['@incudo/core', '@incudo/content', '@incudo/aurora-import', '@incudo/ui', '@incudo/verify']) {
    assert.ok(names.includes(name), `${name} is not a workspace package`);
  }

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

test('the mobile app stays out of the workspaces, and apps are listed by name', async () => {
  const root = await readPackage(join(repoRoot(), 'package.json'));
  const workspaces = root.workspaces ?? [];

  // This used to assert `['packages/*', 'tools/*']` exactly, on the grounds that both app
  // package.json files declared Expo and Tauri "for shells that do not exist". The desktop
  // shell exists now, so it is in — and the reason the rule existed was always Expo, not apps
  // in general: React Native's dependency tree is the ~700 MB, and ROADMAP Phase 4 is the
  // earliest anything needs it. Measured when apps/desktop went in: 45 packages, ~7 seconds.
  assert.ok(workspaces.includes('apps/desktop'), 'the desktop shell is a real workspace now');
  assert.ok(!workspaces.includes('apps/mobile'), 'mobile pulls Expo and nothing needs it yet');

  // Listed by name rather than by glob, which is what keeps the line above true: `apps/*`
  // would silently re-admit mobile the day someone runs `npm install`.
  assert.ok(
    !workspaces.some((entry) => entry.startsWith('apps/') && entry.includes('*')),
    'apps are listed individually, so adding one is a deliberate edit',
  );
});

// --- nothing committed names a person's machine ---------------------------------------------

/**
 * A third invariant, for the same reason as the other two: a path on somebody's computer in a committed
 * file is in version control for good, and one already got in. Where real data lives is configuration
 * (`INCUDO_AURORA_INDEX`, an untracked `.env.local`), never a default written into a file.
 *
 * It looks for the *shape* of a home folder rather than any one person's, so it names nobody and works
 * for any contributor. What it reports is a file and a line, never the text it matched, so a failure
 * does not copy the path into a log.
 */
const HOME_PATH = new RegExp(
  [
    '[A-Za-z]:[\\\\/]+' + 'Users' + '[\\\\/]+[^\\\\/\\s"\']+', // a Windows profile
    '(?<![A-Za-z0-9_.-])/' + 'Users' + '/[^/\\s"\']+/', //         a macOS home
    '(?<![A-Za-z0-9_.-])/' + 'home' + '/(?!runner/)[^/\\s"\']+/', // a Linux home (not CI's own)
  ].join('|'),
);

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-types', 'target', 'gen', '.git', '.corpus']);
const TEXT_EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|json|md|yml|yaml|toml|rs|html|css|txt|example)$/i;

async function committedTextFiles(dir: string, into: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) await committedTextFiles(join(dir, entry.name), into);
    } else if (TEXT_EXTENSIONS.test(entry.name)) {
      into.push(join(dir, entry.name));
    }
  }
  return into;
}

test('no committed file names a path on anyone\'s machine', async () => {
  const root = repoRoot();
  const offenders: string[] = [];
  for (const file of await committedTextFiles(root)) {
    // `.env.local` is the one place a real path belongs, and it is not committed.
    if (file.endsWith('.env.local')) continue;
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (HOME_PATH.test(line)) offenders.push(`${file.slice(root.length + 1).split('\\').join('/')}:${i + 1}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'a home-folder path is committed at the places above. Read it from the environment instead ' +
      '(tools/verify/src/real-data.ts): history is permanent.',
  );
});
