/**
 * Every system Incudo ships has its licence recorded, and About shows the notice that licence asks for.
 *
 * docs/LICENSING.md's rule (ADR 0010): a system is in `systems/` only once its licence has been read and recorded, and
 * the attribution the licence requires is in the definition's `licence.attribution` and on the About screen. Until
 * 2026-10-27 the second half was true of nothing: 5e's SRD notice was in its definition and on no screen.
 *
 * What ships is what the apps import, so the folders under `systems/` and the definitions each app's `boot.ts` reads
 * are held to the same list; a system dropped from the apps but left in the folder (or the other way round) fails here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { systemAttributions } from '@incudo/ui';
import { loadShippedSystem, repoRoot, systemsDirectory } from './node-system.ts';

const shippedIds = async (): Promise<string[]> =>
  (await readdir(systemsDirectory(), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const read = (...parts: string[]) => readFile(join(repoRoot(), ...parts), 'utf8');

test('every shipped system records its licence, with the notice it asks for and the date it was read', async () => {
  const ids = await shippedIds();
  assert.ok(ids.length > 0, 'systems/ holds no definition');
  for (const id of ids) {
    const system = await loadShippedSystem(id);
    // Fails if a system is shipped with no licence assessed (docs/LICENSING.md's checklist, step 6).
    assert.ok(system.licence, `systems/${id} has no licence block`);
    assert.ok(system.licence.attribution?.trim(), `systems/${id} records no attribution`);
    assert.match(system.licence.verified ?? '', /^\d{4}-\d{2}-\d{2}$/, `systems/${id} records no date its licence was read`);
  }
});

test('About shows every shipped system\'s notice, word for word', async () => {
  const systems = await Promise.all((await shippedIds()).map(loadShippedSystem));
  const shown = systemAttributions(systems);
  // Fails if About leaves a shipped system's notice out, or rewords it.
  assert.deepEqual(
    shown.map((entry) => [entry.system, entry.text]),
    systems.map((system) => [system.name, system.licence!.attribution!.trim()]),
  );
  // A system with no notice adds no line: About never prints an empty one.
  assert.deepEqual(systemAttributions([{ name: 'Mine', licence: undefined }]), []);
});

test('the desktop\'s About is handed every shipped system\'s notice, and draws them', async () => {
  const app = await read('apps', 'desktop', 'src', 'App.tsx');
  const pane = await read('apps', 'desktop', 'src', 'panes', 'SettingsPane.tsx');
  // Fails if the Settings pane is no longer given the notices, or is given only some systems' (the user's too).
  assert.match(app, /attributions=\{systemAttributions\(loadShippedSystems\(\)\.systems\)\}/);
  // Fails if the pane stops drawing what it is given.
  assert.match(pane, /attributions\.map\(/);
});

test('the apps ship exactly the systems in systems/', async () => {
  const ids = await shippedIds();
  for (const boot of [['apps', 'desktop', 'src', 'boot.ts'], ['apps', 'mobile', 'src', 'boot.ts']]) {
    const text = await read(...boot);
    const imported = [...text.matchAll(/@repo\/systems\/([^/]+)\/system\.json/g)].map((match) => match[1]!).sort();
    assert.deepEqual(imported, ids, boot.join('/'));
  }
});
