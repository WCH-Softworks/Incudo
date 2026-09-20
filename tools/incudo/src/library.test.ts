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
  createCharacter,
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
import { CharacterBuilder, CharacterLibrary, importAuroraSavesIntoLibrary } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
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

test(
  'a character built in the app keeps its ability scores with zero sources configured',
  { skip: available ? false : `no Aurora install at ${AURORA_INDEX}` },
  async () => {
    // The other half of ADR 0012 for the ability score editor: not "an imported character
    // survives" but "one built here does". Every write goes through `CharacterBuilder`, which
    // is the same view-model the desktop shell drives, so what is checked is the product's own
    // path rather than a hand-made character. Doing this by hand in the app is what turned up
    // the two shell bugs in `use-builder.ts`; this is the part of it that stays checked.
    const system = await shippedSystem();
    const corpus = await auroraCorpus();

    const dir = await mkdtemp(join(tmpdir(), 'incudo-abilities-'));
    try {
      const builder = new CharacterBuilder(
        createCharacter('dnd5e', 'pc', { progress: 1, name: 'Point Buy Dwarf' }),
        system,
        corpus,
      );

      // Point buy, then seven of the twenty-seven points on Constitution: 8 → 14.
      builder.setGenerationMethod('abilities', 'point-buy');
      for (let i = 0; i < 6; i += 1) builder.adjustBudgetStat('abilities', 'constitution', +1);
      // A dwarf, whose +2 must land on top of the 14 rather than replacing it (ADR 0014).
      builder.choose('build/race', ['ID_SRD_RACE_DWARF']);
      builder.choose('build/class', ['ID_WOTC_PHB_CLASS_FIGHTER']);

      const built = builder.getState();
      assert.equal(built.character.baseStats?.['constitution'], 14, 'the base is what is stored');
      assert.equal(built.character.overrides?.['constitution'], undefined, 'never an override');
      assert.equal(built.derived.stats.get('constitution')?.value, 16, '14 plus the dwarf');
      assert.equal(built.derived.stats.get('hp')?.value, 3, 'and a score nobody rolled moves hp');
      const expected = summarize(built.derived);

      const writing = new CharacterLibrary(new NodeCharacterStore(dir));
      await writing.restore();
      const saved = await writing.save(built.character, system, corpus, {
        generator: 'library-test',
      });
      assert.ok(saved.ok, `should save: ${saved.ok ? '' : saved.message}`);

      // Forget the corpus entirely — no profile, no fetcher, nothing configured.
      const library = new CharacterLibrary(new NodeCharacterStore(dir));
      await library.restore();
      const entry = library.getState().entries[0]!;
      const opened = await library.open(entry.name);
      assert.ok(opened, 'should open with no sources');

      const reopened = deriveCharacter(opened.character, system, opened.elements);
      assert.equal(opened.character.baseStats?.['constitution'], 14);
      assert.equal(opened.character.generation?.['abilities'], 'point-buy');
      assert.equal(reopened.stats.get('constitution')?.value, 16, 'the dwarf came with it');
      assert.deepEqual(summarize(reopened), expected, 'and the whole sheet is identical');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

/**
 * The system filter, over the nine real saves — ADR 0031.
 *
 * The unit tests in `packages/ui` prove the partition against a fake store. This proves the
 * thing that actually worries me about a filter: that a folder holding nine perfectly good
 * characters, viewed as another system, says so out loud instead of looking empty. "Nothing
 * here" and "nine, in another system" are different sentences, and a user who sees the first
 * one concludes they picked the wrong folder.
 */
test(
  'nine D&D saves viewed as another system are counted, not hidden',
  { skip: available ? false : `no Aurora install at ${AURORA_INDEX}` },
  async () => {
    const system = await shippedSystem();
    const corpus = await auroraCorpus();
    const saves = (await readdir(SAVES_DIR))
      .filter((name) => extname(name).toLowerCase() === '.dnd5e')
      .map((name) => join(SAVES_DIR, name));

    const dir = await mkdtemp(join(tmpdir(), 'incudo-filter-'));
    try {
      const picked: PickedFile[] = [];
      for (const path of saves) picked.push({ name: basename(path), bytes: await readFile(path) });

      const library = new CharacterLibrary(new NodeCharacterStore(dir));
      await library.restore();
      await importAuroraSavesIntoLibrary(library, picked, {
        system,
        elements: corpus,
        sourceId: AURORA_INDEX,
        generator: 'library-test',
      });

      const all = library.getState().entries.length;
      assert.equal(all, saves.length, 'every save imported');

      // The system the app was actually built around shows all of them.
      library.setSystem('dnd5e');
      assert.equal(library.getState().entries.length, all);
      assert.deepEqual(library.getState().elsewhere, []);

      // Any other system shows none of them — and says how many it is not showing.
      library.setSystem('cairn');
      assert.deepEqual(library.getState().entries, []);
      assert.deepEqual(library.getState().elsewhere, [{ systemId: 'dnd5e', count: all }]);

      // And opening one is still a thing you can do the moment you switch back, with no
      // rescan and no sources — which is ADR 0012 surviving ADR 0031.
      library.setSystem('dnd5e');
      const opened = await library.open(library.getState().entries[0]!.name);
      assert.ok(opened, 'a real save still opens with nothing configured');
      assert.equal(opened.character.systemId, 'dnd5e');
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
