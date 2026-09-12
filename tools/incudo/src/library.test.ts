/**
 * The library, over the nine real Aurora saves, with **zero sources configured**.
 *
 * `character-library.test.ts` and `aurora-import.test.ts` in `packages/ui` prove the same
 * properties against a fake store and hand-made saves, which is where the logic is. This is
 * the other half: real characters, imported from real `.dnd5e` files against the real
 * 12,058-element corpus, written to a real folder, listed and opened by the real view-model
 * with nothing configured and no network. It is the difference between "the code path works"
 * and "the product works".
 *
 * The import runs through `importAuroraSavesIntoLibrary` — the same function the desktop
 * shell's button calls — rather than a transcription of it here. This file used to carry its
 * own copy of the sequence, and a copy is exactly where the overlay or `extraIds` goes
 * missing in the app while the test stays green.
 *
 * Skipped rather than failed where the Aurora install is not on the machine, exactly as
 * `self-contained.test.ts` does — those files are personal data and will never be in this
 * repository. Nothing here prints a character's name or any of its contents; every assertion
 * is on counts and shapes, so a failure says what broke without putting anyone's character
 * into a CI log.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveCharacter,
  validateGameSystem,
  type CharacterStore,
  type ContainerFiles,
  type ElementIndex,
  type GameSystem,
  type LibraryEntryRef,
  type PickedFile,
} from '@incudo/core';
import { ContentLibrary, HttpContentSource } from '@incudo/content';
import { imageExtension } from '@incudo/aurora-import';
import { CharacterLibrary, importAuroraSavesIntoLibrary } from '@incudo/ui';

import { summarize } from './character-commands.ts';
import { readContainer, writeContainer } from './node-save.ts';
import { LocalMirrorFetcher, NodeFetcher } from './node-platform.ts';
import { loadSchemas } from './node-system.ts';

const AURORA_INDEX =
  process.env['INCUDO_AURORA_INDEX'] ??
  'C:/Users/gcorn/Documents/5e Character Builder/custom/AuroraLegacy.index';

const SAVES_DIR = process.env['INCUDO_AURORA_SAVES'] ?? dirname(dirname(AURORA_INDEX));

const available = existsSync(AURORA_INDEX) && existsSync(SAVES_DIR);

/**
 * A `CharacterStore` over a real directory.
 *
 * ADR 0027's port, implemented against `node:fs` — the third implementation after Tauri's
 * plugins and the browser's File System Access API, and the only one a test can drive. It is
 * a dozen lines because the port is small on purpose: the shells differ in how they reach a
 * folder, not in what a library is.
 */
class NodeCharacterStore implements CharacterStore {
  readonly available = true;
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async location(): Promise<string | null> {
    return this.root;
  }
  async choose(): Promise<string | null> {
    return this.root;
  }
  async list(): Promise<LibraryEntryRef[]> {
    const entries: LibraryEntryRef[] = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (existsSync(join(this.root, entry.name, 'manifest.json'))) {
          entries.push({ name: entry.name, form: 'folder' });
        }
      } else if (extname(entry.name).toLowerCase() === '.incu') {
        entries.push({ name: entry.name, form: 'zip' });
      }
    }
    return entries;
  }
  async read(entry: LibraryEntryRef): Promise<ContainerFiles> {
    return readContainer(join(this.root, entry.name));
  }
  async write(entry: LibraryEntryRef, files: ContainerFiles): Promise<void> {
    await writeContainer(join(this.root, entry.name), files, entry.form);
  }
  async remove(entry: LibraryEntryRef): Promise<void> {
    await rm(join(this.root, entry.name), { recursive: true, force: true });
  }
}

test(
  'the nine real saves list and open from a library with zero sources configured',
  { skip: available ? false : `no Aurora install at ${AURORA_INDEX}` },
  async () => {
    const system = await shippedSystem();
    const corpus = await auroraCorpus();
    assert.ok(corpus.size > 10000, 'expected the full corpus');

    const saves = (await readdir(SAVES_DIR))
      .filter((name) => extname(name).toLowerCase() === '.dnd5e')
      .map((name) => join(SAVES_DIR, name));
    assert.ok(saves.length >= 8, `expected the sample saves, found ${saves.length}`);

    const dir = await mkdtemp(join(tmpdir(), 'incudo-library-'));
    try {
      // 1. Import every save with the whole corpus loaded, exactly as the desktop shell's
      //    "Import from Aurora…" does — an app with 200 books, in ADR 0012's words.
      const picked: PickedFile[] = [];
      for (const path of saves) {
        picked.push({ name: basename(path), bytes: await readFile(path) });
      }

      const importing = new CharacterLibrary(new NodeCharacterStore(dir));
      await importing.restore();
      const reports = await importAuroraSavesIntoLibrary(importing, picked, {
        system,
        elements: corpus,
        sourceId: AURORA_INDEX,
        generator: 'library-test',
      });

      const expected = new Map<string, ReturnType<typeof summarize>>();
      let withPortrait = 0;
      for (const report of reports) {
        assert.ok(report.ok, `${report.file} should import: ${report.message}`);
        assert.deepEqual(
          report.diagnostics.filter((diagnostic) => diagnostic.level === 'error'),
          [],
          `${report.file} should import without errors`,
        );
        expected.set(
          report.entry!.name,
          summarize(deriveCharacter(report.character!, system, report.elements!)),
        );
        if (report.assetCount) withPortrait++;
      }
      assert.equal(reports.length, saves.length);

      // 2. Now forget all of it. No profile, no ContentLibrary, no fetcher — a fresh install.
      const library = new CharacterLibrary(new NodeCharacterStore(dir));
      await library.restore();

      const state = library.getState();
      assert.equal(state.status, 'ready');
      assert.deepEqual(state.problems, [], 'nothing in the folder should be unreadable');
      assert.equal(state.entries.length, saves.length, 'every save should be listed');

      for (const entry of state.entries) {
        assert.equal(entry.broken, false, `${entry.name} should not be broken`);
        assert.ok(entry.title.length > 0, `${entry.name} should show a name`);
        assert.equal(entry.systemId, 'dnd5e');
        assert.ok((entry.elementCount ?? 0) > 0, `${entry.name} should embed content`);

        // ADR 0028: every recorded source reads `missing` against an empty profile, and that
        // is not an error. The character opens and derives regardless.
        assert.ok(entry.sourceStatuses.length > 0, `${entry.name} should record its sources`);
        assert.ok(
          entry.sourceStatuses.every((status) => status.state === 'missing'),
          `${entry.name} should report its sources missing, not present`,
        );

        // 3. Open it, and derive against the save's own content and nothing else.
        const opened = await library.open(entry.name);
        assert.ok(opened, `${entry.name} should open`);
        assert.deepEqual(
          opened.problems.filter((problem) => problem.level === 'error'),
          [],
        );
        assert.deepEqual(
          summarize(deriveCharacter(opened.character, system, opened.elements)),
          expected.get(entry.name),
          `${entry.name} should derive identically with no sources`,
        );
      }

      // 4. A portrait is real bytes or it is absent. Never anything in between, and never
      //    anything generated — see the README's standing commitment.
      const shown = state.entries.filter((entry) => entry.portrait !== undefined);
      assert.equal(shown.length, withPortrait, 'exactly the saves with a portrait should have one');
      for (const entry of shown) {
        const bytes = entry.portrait!;
        assert.ok(bytes.length > 0, `${entry.name}'s portrait should not be empty`);

        // Real image bytes, and the extension the importer chose has to agree with them.
        // This assertion started out as "is it a PNG?" and one of the nine is a **JPEG** —
        // Aurora's inline base64 is whatever picture the user had. The app was building its
        // blob URLs as image/png, which this is the reason for fixing.
        const extension = imageExtension(bytes);
        assert.ok(extension, `${entry.name}'s portrait should be a recognisable image`);
        assert.ok(
          entry.portraitPath?.endsWith(`.${extension}`),
          `${entry.name} is named ${entry.portraitPath} but its bytes are ${extension}`,
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

async function shippedSystem(): Promise<GameSystem> {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'systems',
    'dnd5e',
    'system.json',
  );
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

async function auroraCorpus(): Promise<ElementIndex & { size: number }> {
  const library = new ContentLibrary();
  await library.loadSource(
    new HttpContentSource({
      id: AURORA_INDEX,
      fetcher: new LocalMirrorFetcher(AURORA_INDEX.replace(/\.index$/i, ''), new NodeFetcher()),
      resolveByName: true,
    }),
    AURORA_INDEX,
  );
  return library.elements as ElementIndex & { size: number };
}
