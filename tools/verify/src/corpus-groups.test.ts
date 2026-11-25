/**
 * The real-content suite's three groups (`corpus-groups.ts`) cover every file `test:verify` runs, each once, and CI runs
 * exactly those groups.
 *
 * The danger in splitting a suite is a file that no part runs: it would be green by never running in CI. So every
 * `.test.ts` under `tools/*\/src` (the set `npm run test:verify` globs) must be named by exactly one group, every name a
 * group gives must be a file, and ci.yml's matrix must list every group and no other.
 *
 * Perturbation: add a test file to no group, name one in two, name one that does not exist, or drop a group from the
 * matrix, and the case about it fails.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { CORPUS_GROUPS, corpusGroupPaths } from './corpus-groups.ts';

const root = join(import.meta.dirname, '..', '..', '..');

/** Every file `test:verify`'s glob `tools/*\/src/**\/*.test.ts` matches, as a repository path. */
function verifyTestFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.test.ts')) found.push(relative(root, path).replace(/\\/g, '/'));
    }
  };
  for (const tool of readdirSync(join(root, 'tools'), { withFileTypes: true })) {
    if (tool.isDirectory()) {
      try {
        walk(join(root, 'tools', tool.name, 'src'));
      } catch {
        // A tool with no src folder has no tests the glob reaches.
      }
    }
  }
  return found.sort();
}

test('every test file test:verify runs is in exactly one corpus group, and every name is a file', () => {
  const named = Object.keys(CORPUS_GROUPS).flatMap((name) => corpusGroupPaths(name));
  const twice = named.filter((path, i) => named.indexOf(path) !== i);
  assert.deepEqual(twice, [], 'a file is in two groups');
  const files = verifyTestFiles();
  assert.deepEqual(files.filter((file) => !named.includes(file)), [], 'a test file is in no group: place it in corpus-groups.ts by what it is about');
  assert.deepEqual(named.filter((path) => !files.includes(path)), [], 'a group names a file that does not exist');
});

test("ci.yml's corpus matrix is exactly the groups, and runs a group's files", () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n/g, '\n');
  const matrix = /\n {6}matrix:\n {8}group: \[([^\]]*)\]\n/.exec(workflow);
  assert.ok(matrix, 'ci.yml has a corpus matrix over groups');
  assert.deepEqual(
    matrix[1]!.split(',').map((name) => name.trim()).sort(),
    Object.keys(CORPUS_GROUPS).sort(),
  );
  assert.match(workflow, /tools\/verify\/src\/corpus-groups\.ts "\$\{\{ matrix\.group \}\}"/, "the job runs its group's files");
});
