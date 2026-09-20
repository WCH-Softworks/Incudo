/**
 * Every single-class sample save, rebuilt through the builder and compared with what Aurora wrote.
 *
 * `multiclass.test.ts` does this for the one multiclass save: a fresh character, the class chosen
 * and the levels spent through the same calls a click makes, every other pick replayed through
 * `choose`, and the result compared with the import of the real save and with Aurora's own `<sum>`.
 * The other eight saves were only ever *imported*, so nothing had shown that the builder produces
 * what Aurora produced for a Rogue 8 with a subclass, a Wizard 8, an Eldritch Knight — the shapes
 * ROADMAP Phase 2's exit criterion is made of, taken one at a time.
 *
 * What it proves and what it does not. A pass says the builder's write path (`choose`, `setProgress`)
 * reaches the same derived character as the importer's, and that character has the differences against
 * Aurora it always had. It replays picks the save already holds, so it cannot say the builder *offers*
 * the right choices — the app run and `rogue-wizard.test.ts` are for that. And a single class has no
 * track, so it says nothing about ADR 0040.
 *
 * The saves are personal data and stay out of the repo. Positions only ("save 4/9"), as everywhere
 * else here; skipped where they are not installed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BundleElementIndex,
  LayeredElementIndex,
  createCharacter,
  deriveCharacter,
  validateGameSystem,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import { ContentLibrary, HttpContentSource } from '@incudo/content';
import { compareWithAurora, importAuroraCharacter, parseAuroraSave } from '@incudo/aurora-import';
import { CharacterBuilder } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import { LocalMirrorFetcher, NodeFetcher } from './node-platform.ts';
import { loadSchemas } from './node-system.ts';
import { saveLabel, unnamed } from './private-saves.ts';

const AURORA_INDEX =
  process.env['INCUDO_AURORA_INDEX'] ??
  'C:/Users/gcorn/Documents/5e Character Builder/custom/AuroraLegacy.index';
const SAVES_DIR = process.env['INCUDO_AURORA_SAVES'] ?? dirname(dirname(AURORA_INDEX));
const available = existsSync(AURORA_INDEX) && existsSync(SAVES_DIR);

async function shippedSystem(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

async function auroraCorpus(): Promise<ElementIndex> {
  const library = new ContentLibrary();
  await library.loadSource(
    new HttpContentSource({
      id: AURORA_INDEX,
      fetcher: new LocalMirrorFetcher(AURORA_INDEX.replace(/\.index$/i, ''), new NodeFetcher()),
      resolveByName: true,
    }),
    AURORA_INDEX,
  );
  return library.elements;
}

test(
  'each single-class save, rebuilt through the builder, is the character its import is',
  { skip: available ? false : `no Aurora install at ${AURORA_INDEX}` },
  async () => {
    const system = await shippedSystem();
    const corpus = await auroraCorpus();
    const files = (await readdir(SAVES_DIR))
      .filter((name) => extname(name).toLowerCase() === '.dnd5e')
      .sort();
    assert.ok(files.length >= 8, `expected the sample saves, found ${files.length}`);

    let rebuilt = 0;
    let skippedMulticlass = 0;
    for (const [i, file] of files.entries()) {
      const label = saveLabel(i, files.length);
      const xml = await unnamed(`reading ${label}`, () => readFile(join(SAVES_DIR, file), 'utf8'));
      const save = parseAuroraSave(xml);
      const imported = importAuroraCharacter(save, { index: corpus, systemId: 'dnd5e' });
      const elements = new LayeredElementIndex([new BundleElementIndex(imported.generated), corpus]);
      const reference = imported.character;

      // The multiclass save has its own test, and a class-per-level split is what that one is for.
      if (reference.advancement) {
        skippedMulticlass += 1;
        continue;
      }

      // The first class is found from content, as the builder itself finds it.
      const classRecord = reference.choices.find((c) =>
        c.elementIds.some((id) => elements.get(id)?.type === 'Class'),
      );
      assert.ok(classRecord, `${label} records a class`);
      const classId = classRecord.elementIds.find((id) => elements.get(id)?.type === 'Class')!;

      // Inputs that are not picks are the save's own; every pick is replayed through `choose`.
      let seed = createCharacter('dnd5e', 'pc', { progress: 1 });
      seed = { ...seed, inventory: reference.inventory, rolls: reference.rolls };
      const builder = new CharacterBuilder(seed, system, elements);
      for (const [stat, value] of Object.entries(reference.baseStats ?? {})) builder.setBaseStat(stat, value);
      builder.choose('build/class', [classId]);
      builder.setProgress(reference.progress);
      for (const choice of reference.choices) {
        if (choice === classRecord) continue;
        builder.choose(choice.ruleKey, choice.elementIds);
      }

      const built = deriveCharacter(builder.getState().character, system, elements);
      const original = deriveCharacter(reference, system, elements);
      const a = summarize(built);
      const b = summarize(original);

      assert.deepEqual(a.elements, b.elements, `${label}: the same elements, ids and all`);
      assert.deepEqual(a.stats, b.stats, `${label}: the same stat, every one of them`);
      assert.deepEqual(a.pendingChoices, b.pendingChoices, `${label}: the same open pools`);
      assert.deepEqual(
        a.problems.map((p) => p.code),
        b.problems.map((p) => p.code),
        `${label}: the same problems`,
      );

      // Against Aurora itself: exactly the differences the import has, and none of the two kinds
      // CLAUDE.md holds at zero.
      const fingerprint = (d: ReturnType<typeof deriveCharacter>): string[] =>
        compareWithAurora(save, d, { index: elements }).differences
          .map((difference) => `${difference.kind}:${difference.elementId ?? ''}`)
          .sort();
      const builtDifferences = fingerprint(built);
      assert.deepEqual(builtDifferences, fingerprint(original), `${label}: the same differences with Aurora`);
      assert.equal(
        builtDifferences.filter((d) => d.startsWith('stat-mismatch')).length,
        0,
        `${label}: no stat differs from Aurora's`,
      );
      assert.equal(
        builtDifferences.filter((d) => d.startsWith('spell-missing')).length,
        0,
        `${label}: no spell Aurora has is missing`,
      );
      rebuilt += 1;
    }
    assert.equal(skippedMulticlass, 1, 'exactly one of the nine is multiclass, and multiclass.test.ts has it');
    assert.equal(rebuilt, files.length - 1, 'every other save was rebuilt');
  },
);
