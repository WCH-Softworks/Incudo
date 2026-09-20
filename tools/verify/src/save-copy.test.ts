/**
 * "Save a copy…", over the real saves, written to a real disk — ADR 0038.
 *
 * `packages/ui/src/character-copy.test.ts` proves the logic against fakes and hand-made
 * characters. This is the other half, and it is ADR 0012 applied to a copy: a file written by
 * `saveCopy` opens with **zero sources configured** and derives exactly as the character it was
 * made from, for every real Aurora character in the folder.
 *
 * The path is the desktop shell's: import a save into a library, open it from there (which is
 * what puts a character on the Build pane), and copy it. The copy is packed from the opened
 * character and the save's own embedded content — which is all an app with no source loaded has —
 * and, in the second half, again from that content layered over the whole corpus, which is what an
 * app with sources loaded has. The two must agree.
 *
 * Skipped rather than failed where the Aurora install is not on the machine, like the tests
 * beside it. Nothing here prints a character's name or contents; every assertion is a count or a
 * shape, so a failure says what broke without putting anyone's character into a CI log.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BundleElementIndex,
  LayeredElementIndex,
  deriveCharacter,
  readCharacterContainer,
  validateGameSystem,
  type CharacterStore,
  type ContainerFiles,
  type ElementIndex,
  type FileSaveOptions,
  type FileSaver,
  type GameSystem,
  type LibraryEntryRef,
  type PickedFile,
  type SavedFile,
} from '@incudo/core';
import { CharacterLibrary, importAuroraSavesIntoLibrary, saveCopy } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import {
  assertNoneReported,
  assertSameBytes,
  assertSameSummary,
  saveLabel,
  unnamed,
} from './private-saves.ts';
import { readContainer, writeContainer } from './node-save.ts';
import { nodeZipCodec } from './node-zip.ts';
import { loadSchemas } from './node-system.ts';
import { AURORA_INDEX, SAVES_DIR, realElements, requireSaves, savesSkip } from './real-data.ts';

/** A `CharacterStore` over a real directory; the same dozen lines `library.test.ts` carries. */
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
      if (!entry.isDirectory() && extname(entry.name).toLowerCase() === '.incu') {
        entries.push({ name: entry.name, form: 'zip' });
      }
    }
    return entries;
  }
  async read(entry: LibraryEntryRef): Promise<ContainerFiles> {
    // `library.open` does not catch this, so a missing file would reach the reporter with its path.
    return unnamed('reading a library entry', () => readContainer(join(this.root, entry.name)));
  }
  async write(entry: LibraryEntryRef, files: ContainerFiles): Promise<void> {
    await writeContainer(join(this.root, entry.name), files, entry.form);
  }
  async remove(): Promise<void> {
    throw new Error('a copy must never remove anything');
  }
}

/**
 * The port over `node:fs`: what the user typed into a save dialog is the suggested name, moved
 * to one that is free when it is taken — the dialog's own replace question, answered "no".
 */
class NodeFileSaver implements FileSaver {
  readonly available = true;
  private readonly dir: string;
  readonly written: string[] = [];

  constructor(dir: string) {
    this.dir = dir;
  }

  async save(bytes: Uint8Array, options: FileSaveOptions): Promise<SavedFile | null> {
    let name = options.suggestedName;
    for (let n = 2; existsSync(join(this.dir, name)); n += 1) {
      name = options.suggestedName.replace(/\.incu$/, `-${n}.incu`);
    }
    await writeFile(join(this.dir, name), bytes);
    this.written.push(name);
    return { name };
  }
}

/** Every file under a directory, with its bytes, so "nothing changed" can be a comparison. */
async function snapshot(root: string): Promise<Map<string, string>> {
  return unnamed('taking a folder snapshot', async () => {
    const found = new Map<string, string>();
    for (const name of await readdir(root)) {
      found.set(name, Buffer.from(await readFile(join(root, name))).toString('base64'));
    }
    return found;
  });
}

test(
  'a copy of each real save opens with zero sources and derives identically',
  { skip: savesSkip },
  async () => {
    requireSaves();
    const system = await shippedSystem();
    const corpus = await realElements();
    assert.ok(corpus.size > 10000, 'expected the full corpus');

    // Sorted, so that "save 3/9" in a failure is the same save every time and in every test
    // that labels them this way (`private-saves.ts`).
    const saves = (await readdir(SAVES_DIR))
      .filter((name) => extname(name).toLowerCase() === '.dnd5e')
      .sort()
      .map((name) => join(SAVES_DIR, name));
    assert.ok(saves.length > 0, 'there is at least one .dnd5e save to copy');

    const libraryDir = await mkdtemp(join(tmpdir(), 'incudo-copy-library-'));
    const copiesDir = await mkdtemp(join(tmpdir(), 'incudo-copy-out-'));
    try {
      // 1. A library of them, and what each derives to.
      const picked: PickedFile[] = [];
      for (const [i, path] of saves.entries()) {
        picked.push({
          name: basename(path),
          bytes: await unnamed(`reading ${saveLabel(i, saves.length)}`, () => readFile(path)),
        });
      }
      const importing = new CharacterLibrary(new NodeCharacterStore(libraryDir));
      await importing.restore();
      const reports = await importAuroraSavesIntoLibrary(importing, picked, {
        system,
        elements: corpus,
        sourceId: AURORA_INDEX,
        generator: 'save-copy-test',
      });
      // A library entry is named for its character, so it is never printed: `labelOf` says which
      // of the saves it is by position. `report.file` and `report.message` name the file and can
      // quote it, so neither is printed either.
      const labels = new Map<string, string>();
      const labelOf = (entryName: string): string =>
        labels.get(entryName) ?? 'an entry this import did not write';

      const expected = new Map<string, ReturnType<typeof summarize>>();
      // Whether the import found a portrait, so that "keeps it" is checked against what the save
      // had and not against every save having one.
      const hadPortrait = new Map<string, boolean>();
      for (const [i, report] of reports.entries()) {
        assert.ok(report.ok, `${saveLabel(i, reports.length)} should import`);
        labels.set(report.entry!.name, saveLabel(i, reports.length));
        hadPortrait.set(report.entry!.name, report.assetCount > 0);
        expected.set(
          report.entry!.name,
          summarize(deriveCharacter(report.character!, system, report.elements!)),
        );
      }

      // 2. A fresh library with no profile and no corpus, as an app opened on a character with
      //    no source loaded. Open each, copy it, and check what landed on disk.
      const library = new CharacterLibrary(new NodeCharacterStore(libraryDir));
      await library.restore();
      const before = await snapshot(libraryDir);
      const saver = new NodeFileSaver(copiesDir);

      let copied = 0;
      for (const entry of library.getState().entries) {
        const saveName = labelOf(entry.name);
        const opened = await library.open(entry.name);
        assert.ok(opened, `${saveName} should open`);

        const originalIds = readCharacterContainer(
          await unnamed(`reading ${saveName} from the library`, () =>
            readContainer(join(libraryDir, entry.name)),
          ),
        ).container!.content.elements.map((element) => element.id);

        // From its own content alone: an app with nothing loaded. The assets are the ones the
        // library handed back on opening, as the shell holds them.
        const alone = await saveCopy(saver, nodeZipCodec, opened.character, system, opened.elements, {
          generator: 'save-copy-test',
          assets: opened.assets,
        });
        assert.equal(alone.status, 'saved', `${saveName} should copy`);
        if (alone.status !== 'saved') continue;
        assert.ok(alone.file.name.endsWith('.incu'));
        copied += 1;

        // From its own content over the whole corpus: an app with sources loaded.
        const layered = await saveCopy(
          saver,
          nodeZipCodec,
          opened.character,
          system,
          new LayeredElementIndex([opened.elements, corpus]),
          { generator: 'save-copy-test', assets: opened.assets },
        );
        assert.equal(layered.status, 'saved');
        if (layered.status !== 'saved') continue;

        // 3. Read each copy back from the disk and derive from nothing but itself.
        for (const [route, name] of [
          ['embedded only', alone.file.name],
          ['layered over the corpus', layered.file.name],
        ] as const) {
          const label = `${saveName} (${route})`;
          const { container, problems } = readCharacterContainer(
            await unnamed(`reading the copy of ${label}`, () =>
              readContainer(join(copiesDir, name)),
            ),
          );
          assert.ok(container, `${label} should read as a container`);
          // A problem's message can quote the text a JSON parse choked on, so it is counted.
          assertNoneReported(
            problems.filter((problem) => problem.level === 'error'),
            `${label} should read without errors`,
          );
          assertSameSummary(
            summarize(
              deriveCharacter(
                container.character,
                system,
                new BundleElementIndex(container.content.elements),
              ),
            ),
            expected.get(entry.name),
            `${label} should derive identically with no sources`,
          );
          assert.equal(container.character.id, opened.character.id, 'it is the same character');

          // The portrait is in the copy as real bytes, and the reader has nothing to say about
          // an asset it cannot find. A save keeps a portrait exactly when it had one.
          assert.equal(
            opened.assets.size > 0,
            hadPortrait.get(entry.name),
            `${saveName}: the portrait is there exactly when the import found one`,
          );
          assert.equal(container.assets.size, opened.assets.size, `${label} lost an asset`);
          for (const [path, bytes] of opened.assets) {
            assertSameBytes(container.assets.get(path), bytes, `${label} altered ${path}`);
          }
          assertNoneReported(
            problems.filter((problem) => /not in the container/.test(problem.message)),
            `${label} names an asset it does not hold`,
          );
          // Nothing the character *uses* is lost. What a re-save may drop is an element only the
          // Aurora import embedded, through `extraIds` — Aurora's own `<sum>`, kept so that
          // `aurora verify` stays meaningful — which no rule reaches and no derived number
          // depends on. The app's Save drops the same ones, and so does a copy.
          const inCopy = new Set(container.content.elements.map((element) => element.id));
          const reached = deriveCharacter(opened.character, system, opened.elements).elementIds;
          for (const id of originalIds) {
            if (!inCopy.has(id)) {
              assert.ok(!reached.has(id), `${label} dropped an element it uses`);
            }
          }
        }

        // The two routes embed the same elements: copying with sources loaded adds nothing the
        // character does not use, and copying without them loses nothing it does.
        const idsOf = async (name: string): Promise<string[]> =>
          readCharacterContainer(
            await unnamed(`reading a copy of ${saveName}`, () =>
              readContainer(join(copiesDir, name)),
            ),
          )
            .container!.content.elements.map((element) => element.id)
            .sort();
        assert.deepEqual(
          await idsOf(alone.file.name),
          await idsOf(layered.file.name),
          `${saveName}: with and without sources loaded, the copy embeds the same elements`,
        );
      }
      assert.equal(copied, saves.length, 'every save was copied');

      // 4. The library was not touched: every file, byte for byte, and nothing added.
      assert.deepEqual(await snapshot(libraryDir), before, 'the library folder is unchanged');
      assert.equal((await readdir(libraryDir)).length, saves.length);

      // 5. Saving an opened character back into the library keeps its portrait too. This is the
      //    other half of the same gap: the app's Save and its copy were dropping it together.
      const resaving = new CharacterLibrary(new NodeCharacterStore(libraryDir));
      await resaving.restore();
      for (const entry of resaving.getState().entries) {
        const saveName = labelOf(entry.name);
        const opened = await resaving.open(entry.name);
        assert.ok(opened);
        const kept = entry.portrait;
        assert.equal(kept !== undefined, hadPortrait.get(entry.name), `${saveName}: a portrait is listed exactly when the import found one`);
        const saved = await resaving.save(opened.character, system, opened.elements, {
          entry: { name: entry.name, form: entry.form },
          expectUpdatedAt: entry.updatedAt,
          assets: opened.assets,
        });
        assert.ok(saved.ok, `${saveName} should re-save`);
        const after = resaving.getState().entries.find((e) => e.name === entry.name)!;
        if (kept === undefined) assert.equal(after.portrait, undefined, `${saveName} gained a portrait on a re-save`);
        else assertSameBytes(after.portrait, kept, `${saveName} lost its portrait on a re-save`);
      }

      // 6. The copies are real library entries: a folder of them lists, opens and is not broken.
      const copies = new CharacterLibrary(new NodeCharacterStore(copiesDir));
      await copies.restore();
      assertNoneReported(copies.getState().problems, 'no copy should be unreadable');
      assert.equal(copies.getState().entries.length, saves.length * 2);
      assert.ok(copies.getState().entries.every((entry) => !entry.broken));
    } finally {
      await rm(libraryDir, { recursive: true, force: true });
      await rm(copiesDir, { recursive: true, force: true });
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

