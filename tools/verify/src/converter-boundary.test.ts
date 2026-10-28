/**
 * ADR 0119 decision 1: Aurora is an input format and nothing else. The converter (`@incudo/aurora-import`) is the one
 * place Aurora is read; the engine and the content library import nothing from it, and the content package does not
 * depend on it. The shells hand the content package Aurora's converter as they hand it a fetcher.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { repoRoot } from './node-system.ts';

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sources(path)));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

test('the engine and the content library import nothing of the converter, tests included', async () => {
  // Perturbation: an import of `@incudo/aurora-import` in either package, or the dependency put back, fails this.
  for (const pkg of ['core', 'content']) {
    const root = join(repoRoot(), 'packages', pkg);
    for (const file of await sources(join(root, 'src'))) {
      const text = await readFile(file, 'utf8');
      assert.ok(!/from\s+['"]@incudo\/aurora-import['"]/.test(text), `${pkg}/${file.slice(root.length + 1)} imports the converter`);
    }
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    assert.equal(manifest.dependencies?.['@incudo/aurora-import'], undefined, `${pkg} depends on the converter`);
  }
});
