/**
 * The ADR 0012 test.
 *
 * *"A save file generated in an app that has 200 books of sources should be openable in a
 * fresh app with zero sources."* That is the product requirement, not an optimization, so it
 * gets a test that does exactly what it says: build a character with the whole corpus
 * loaded, write it, throw the corpus away, open the file, and demand that the derived output
 * is **identical** — every element, every stat, every pending choice, every problem.
 *
 * It runs twice. Once against a committed fixture corpus, so it runs everywhere including
 * CI. Once against the real 12,058-element AuroraLegacy install, when one is on the machine —
 * skipped rather than failed when it is not, because the corpus is 740 files of licensed
 * content that will never live in this repository.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BundleElementIndex,
  MapElementIndex,
  collectCharacterContent,
  createCharacter,
  deriveCharacter,
  packCharacterContainer,
  readCharacterContainer,
  resolveCharacterKind,
  setChoice,
  setRoll,
  validateCharacter,
  validateGameSystem,
  validateManifest,
  type Character,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import { parseAuroraElements } from '@incudo/aurora-import';
import { ContentLibrary, HttpContentSource } from '@incudo/content';

import { summarize } from './character-commands.ts';
import { FIXTURES_DIR, GOLDEN_DIR, fixtureCharacter } from './fixture-character.ts';
import { readContainer, writeContainer } from './node-save.ts';
import { LocalMirrorFetcher, NodeFetcher } from './node-platform.ts';
import { loadSchemas } from './node-system.ts';


/** Set INCUDO_AURORA_INDEX to point the corpus half of this test somewhere else. */
const AURORA_INDEX =
  process.env['INCUDO_AURORA_INDEX'] ??
  'C:/Users/gcorn/Documents/5e Character Builder/custom/AuroraLegacy.index';

async function fixtureSystem(): Promise<GameSystem> {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, 'system.json'), 'utf8')) as unknown;
  const result = validateGameSystem(raw, await loadSchemas());
  assert.deepEqual(result.errors, [], 'the fixture system should validate');
  return result.value!;
}

async function fixtureCorpus(): Promise<MapElementIndex> {
  const xml = await readFile(join(FIXTURES_DIR, 'content.xml'), 'utf8');
  const file = parseAuroraElements(xml, { sourceId: 'fixture', fileUrl: 'fixture/content.xml' });
  assert.deepEqual(
    file.diagnostics.filter((d) => d.level === 'error'),
    [],
  );
  const index = new MapElementIndex();
  index.addAll(file.elements);
  return index;
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'incudo-test-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

test('a save built with the full corpus opens with zero sources, identically', async () => {
  const system = await fixtureSystem();
  const corpus = await fixtureCorpus();
  const character = fixtureCharacter();

  // 1. Build with everything loaded, exactly as an app with 200 books would.
  const withCorpus = summarize(deriveCharacter(character, system, corpus));
  assert.ok(withCorpus.elements.length > 5, 'the fixture character should reach real content');

  await withTempDir(async (dir) => {
    // 2. Save it.
    const path = join(dir, 'aelin.incu');
    const content = collectCharacterContent(character, corpus);
    await writeContainer(path, packCharacterContainer(character, content, { generator: 'test' }));

    // 3. Forget the corpus. This is the fresh install: nothing configured, nothing cached.
    const { container, problems } = readCharacterContainer(await readContainer(path));
    assert.deepEqual(
      problems.filter((p) => p.level === 'error'),
      [],
    );
    const offline: ElementIndex = new BundleElementIndex(container!.content.elements);

    // 4. Derive again, against the save's own content and nothing else.
    const withoutCorpus = summarize(deriveCharacter(container!.character, system, offline));

    assert.deepEqual(withoutCorpus, withCorpus);
  });
});

test('the embedded subset is a subset, and the parts that matter are in it', async () => {
  const corpus = await fixtureCorpus();
  const content = collectCharacterContent(fixtureCharacter(), corpus);
  const ids = content.elements.map((e) => e.id);

  assert.ok(content.elements.length < corpus.size, 'a save should not be a copy of the corpus');

  // Chosen, granted, granted behind a gate this character has not reached, a select's
  // default, and an element named only by a requirement.
  for (const id of [
    'ID_KIN_RIVERFOLK',
    'ID_TRAIT_AMPHIBIOUS',
    'ID_FEATURE_UNBROKEN',
    'ID_KNACK_SWIMMER',
    'ID_CALLING_WARDEN',
  ]) {
    assert.ok(ids.includes(id), `${id} should be embedded`);
  }

  // The bag, and the whole bag (ADR 0024). The coat is worn, the weave adorns it, and the net
  // is only carried — nothing grants, selects or requires any of the three, so each is here
  // solely because the collector seeds from the inventory. Leaving the carried one out would
  // produce a save that opens with an empty pocket and says nothing about it.
  for (const id of ['ID_GEAR_TIDEWALKERS_COAT', 'ID_GEAR_TIDESILK_WEAVE', 'ID_GEAR_NET']) {
    assert.ok(ids.includes(id), `${id} should be embedded`);
  }

  // Content the character never touches is not along for the ride.
  for (const id of ['ID_FILLER_A', 'ID_FILLER_E', 'ID_KNACK_DIVER'.replace('DIVER', 'NOPE')]) {
    assert.ok(!ids.includes(id), `${id} should not be embedded`);
  }

  // A reference nothing defines is recorded rather than quietly dropped.
  assert.deepEqual(content.unresolved, ['ID_TRAIT_MISSING_ON_PURPOSE']);
});

test('levelling up inside the save works without sources, because gates were followed', async () => {
  const system = await fixtureSystem();
  const corpus = await fixtureCorpus();
  const character = { ...fixtureCharacter(), progress: 1 };

  const content = collectCharacterContent(character, corpus);
  const offline = new BundleElementIndex(content.elements);

  // Built at level 1, then advanced to 7 with nothing but the save loaded. The level-7
  // feature is there because collecting ignores gates — see collectCharacterContent.
  const levelled = { ...character, progress: 7 };
  const online = summarize(deriveCharacter(levelled, system, corpus));
  const offlineSummary = summarize(deriveCharacter(levelled, system, offline));
  assert.deepEqual(offlineSummary, online);
  assert.ok(online.elements.includes('ID_FEATURE_UNBROKEN'));
});

test('the zip and the folder are the same tree', async () => {
  const corpus = await fixtureCorpus();
  const character = fixtureCharacter();
  const files = packCharacterContainer(character, collectCharacterContent(character, corpus), {
    assets: new Map([['assets/portrait.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]]),
    now: '2026-01-01T00:00:00.000Z',
  });

  await withTempDir(async (dir) => {
    await writeContainer(join(dir, 'a.incu'), files);
    await writeContainer(join(dir, 'unpacked'), files);

    const fromZip = await readContainer(join(dir, 'a.incu'));
    const fromFolder = await readContainer(join(dir, 'unpacked'));

    assert.deepEqual([...fromZip.keys()].sort(), [...fromFolder.keys()].sort());
    for (const [path, bytes] of fromZip) {
      assert.deepEqual([...bytes], [...fromFolder.get(path)!], path);
    }

    // And both still open.
    for (const files of [fromZip, fromFolder]) {
      const { container, problems } = readCharacterContainer(files);
      assert.deepEqual(problems, []);
      assert.equal(container!.character.name, 'Aelin of the Reeds');
    }
  });
});

/**
 * `fixtures/aelin/` is a real save in its unpacked form, committed to git.
 *
 * It is the regression guard on the container *format*: a change to what a save contains
 * arrives as a reviewable JSON diff rather than as a silently different file — which is the
 * property ADR 0012 claims for the folder form, demonstrated on the project's own repo. When
 * this fails and the change was deliberate, `npm run fixtures:rebuild` and read the diff.
 */
test('the committed golden container still matches what the code writes', async () => {
  const corpus = await fixtureCorpus();
  const character = fixtureCharacter();
  const written = packCharacterContainer(character, collectCharacterContent(character, corpus), {
    generator: 'incudo-fixtures',
  });
  const golden = await readContainer(GOLDEN_DIR);

  assert.deepEqual([...written.keys()].sort(), [...golden.keys()].sort());
  for (const [path, bytes] of written) {
    assert.equal(
      new TextDecoder().decode(bytes),
      new TextDecoder().decode(golden.get(path)!),
      `${path} differs — run \`npm run fixtures:rebuild\` if that was intended`,
    );
  }

  // And the committed form is one the reader accepts, not just one the writer produces.
  const { container, problems } = readCharacterContainer(golden);
  assert.deepEqual(problems, []);
  assert.equal(container!.character.name, 'Aelin of the Reeds');
  assert.deepEqual(container!.character.rolls, { 'wounds:level:2': 5, 'wounds:level:3': 3 });
});

test('rewriting a save drops content a removed choice took with it', async () => {
  const corpus = await fixtureCorpus();
  const full = fixtureCharacter();
  const trimmed = setChoice(full, 'build/calling', []);

  const before = collectCharacterContent(full, corpus).elements.map((e) => e.id);
  const after = collectCharacterContent(trimmed, corpus).elements.map((e) => e.id);

  assert.ok(before.includes('ID_FEATURE_WATCHFUL'));
  assert.ok(!after.includes('ID_FEATURE_WATCHFUL'));
  assert.ok(after.length < before.length);
});

test('what a save writes matches the published schemas', async () => {
  const schemas = await loadSchemas();
  const corpus = await fixtureCorpus();
  const character = fixtureCharacter();
  const files = packCharacterContainer(character, collectCharacterContent(character, corpus), {
    assets: new Map([['assets/portrait.png', new Uint8Array([1, 2, 3])]]),
  });

  const parse = (path: string) => JSON.parse(new TextDecoder().decode(files.get(path)!));

  const manifest = validateManifest(parse('manifest.json'), schemas);
  assert.deepEqual(manifest.errors, []);

  const saved = validateCharacter(parse('character.json'), schemas);
  assert.deepEqual(saved.errors, []);
});

test('a beast is a character too, and the engine never says which is which', async () => {
  const system = await fixtureSystem();
  const corpus = await fixtureCorpus();

  let beast = createCharacter('fixture', 'beast', { name: 'River Drake', progress: 4 });
  beast = setChoice(beast, 'build/beast', ['ID_BEAST_RIVER_DRAKE']);

  const derived = deriveCharacter(beast, system, corpus);
  assert.equal(derived.kind.id, 'beast');
  assert.equal(derived.stats.get('threat')?.value, 4);
  assert.equal(derived.stats.get('level'), undefined);
  assert.equal(derived.stats.get('guard')?.value, 15);

  await withTempDir(async (dir) => {
    const path = join(dir, 'drake.incu');
    await writeContainer(
      path,
      packCharacterContainer(beast, collectCharacterContent(beast, corpus)),
    );
    const { container } = readCharacterContainer(await readContainer(path));
    const offline = deriveCharacter(container!.character, system, new BundleElementIndex(container!.content.elements));
    assert.deepEqual(summarize(offline), summarize(derived));
  });
});

// ---------------------------------------------------------------------------
// The same property, against the real thing.

const auroraAvailable = existsSync(AURORA_INDEX);

test(
  'the real corpus: a 5e character built from 12,058 elements opens with zero sources',
  { skip: auroraAvailable ? false : `no Aurora install at ${AURORA_INDEX}` },
  async () => {
    const system = await loadShippedSystem('dnd5e');
    const corpus = await loadAuroraCorpus();
    assert.ok(corpus.size > 10000, 'expected the full corpus');

    let character = createCharacter('dnd5e', 'pc', { name: 'Vigaro', progress: 3 });
    character = setChoice(character, 'build/race', ['ID_RACE_HALFELF']);
    character = setChoice(character, 'build/class', ['ID_WOTC_PHB_CLASS_ROGUE']);
    character = setChoice(character, 'build/background', ['ID_BACKGROUND_CRIMINAL']);

    const withCorpus = summarize(deriveCharacter(character, system, corpus));
    assert.ok(withCorpus.elements.length > 30);

    await withTempDir(async (dir) => {
      const path = join(dir, 'vigaro.incu');
      const content = collectCharacterContent(character, corpus, {
        kind: resolveCharacterKind(system, character.kind),
      });
      await writeContainer(path, packCharacterContainer(character, content));

      // A few dozen elements out of twelve thousand, in a file measured in kilobytes.
      assert.ok(content.elements.length < 300, `embedded ${content.elements.length} elements`);
      const bytes = (await readFile(path)).length;
      assert.ok(bytes < 500_000, `save is ${bytes} bytes`);

      const { container } = readCharacterContainer(await readContainer(path));
      const offline = new BundleElementIndex(container!.content.elements);
      assert.deepEqual(summarize(deriveCharacter(container!.character, system, offline)), withCorpus);
    });
  },
);

async function loadShippedSystem(id: string): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', id, 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], `systems/${id} should validate`);
  return result.value!;
}

async function loadAuroraCorpus(): Promise<ElementIndex & { size: number }> {
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
