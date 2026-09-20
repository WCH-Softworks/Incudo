/**
 * Every real save, rebuilt through the builder and compared with what Aurora wrote.
 *
 * A fresh character, the class chosen and every level spent through the same calls a click makes
 * (`setProgress` for the first class's levels, `addLevel` for each one that goes to another), every
 * other pick replayed through `choose`, and the result compared with the import of the real save and
 * with Aurora's own `<sum>` and `<magic>`. It does not matter how many saves there are or how they
 * split their levels: each is held to the same relations, so a new character is checked the day it is
 * saved. `multiclass.test.ts` keeps the Paladin/Warlock's extra assertions (the eligibility gate and
 * the hit point dice).
 *
 * What it proves and what it does not. A pass says the builder's write path reaches the same derived
 * character as the importer's, and that character has the differences against Aurora it always had.
 * It replays picks the save already holds, so it cannot say the builder *offers* the right choices —
 * the app run and `rogue-wizard.test.ts` are for that. And for a single class, which has no track, it
 * says nothing about ADR 0040; a multiclass save with a chosen subclass is where that is exercised.
 *
 * The saves are personal data and stay out of the repo. Positions only ("save 4/10"), as everywhere
 * else here, and they move when a save is added; skipped where the saves are not installed.
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
  'each real save, rebuilt through the builder, is the character its import is',
  { skip: available ? false : `no Aurora install at ${AURORA_INDEX}` },
  async () => {
    const system = await shippedSystem();
    const corpus = await auroraCorpus();
    const files = (await readdir(SAVES_DIR))
      .filter((name) => extname(name).toLowerCase() === '.dnd5e')
      .sort();
    assert.ok(files.length > 0, 'there is at least one .dnd5e save to rebuild');

    let rebuilt = 0;
    for (const [i, file] of files.entries()) {
      const label = saveLabel(i, files.length);
      const xml = await unnamed(`reading ${label}`, () => readFile(join(SAVES_DIR, file), 'utf8'));
      const save = parseAuroraSave(xml);
      const imported = importAuroraCharacter(save, { index: corpus, systemId: 'dnd5e' });
      const elements = new LayeredElementIndex([new BundleElementIndex(imported.generated), corpus]);
      const reference = imported.character;

      // The first class is found from content, as the builder itself finds it. For a multiclass
      // character that is the class its first level went to; a single-class one has no other record.
      const advancement = reference.advancement;
      const firstClass = advancement?.[0]?.elementId;
      const classRecord = reference.choices.find((c) =>
        c.elementIds.some((id) => elements.get(id)?.type === 'Class'),
      );
      const classId =
        firstClass ?? classRecord?.elementIds.find((id) => elements.get(id)?.type === 'Class');
      assert.ok(classId, `${label} records a class`);
      // The records that say a level went to a second class. `addLevel` writes them itself, so
      // replaying the import's would be replaying the answer.
      const isMulticlassRecord = (ruleKey: string): boolean => ruleKey.includes('select:Multiclass');

      // Inputs that are not picks are the save's own; every pick is replayed through `choose`.
      let seed = createCharacter('dnd5e', 'pc', { progress: 1 });
      seed = { ...seed, inventory: reference.inventory, rolls: reference.rolls };
      const builder = new CharacterBuilder(seed, system, elements);
      for (const [stat, value] of Object.entries(reference.baseStats ?? {})) builder.setBaseStat(stat, value);
      builder.choose('build/class', [classId]);
      if (advancement) {
        // The first class's levels are a number; each level after that is spent on a class.
        const leading = advancement.findIndex((entry) => entry.elementId !== classId);
        builder.setProgress(leading === -1 ? advancement.length : leading);
        for (const entry of advancement.slice(leading === -1 ? advancement.length : leading)) {
          assert.equal(
            builder.addLevel('levels', entry.elementId),
            true,
            `${label}: level ${entry.at} is refused by the gate that a click goes through`,
          );
        }
      } else {
        builder.setProgress(reference.progress);
      }
      for (const choice of reference.choices) {
        if (choice === classRecord || isMulticlassRecord(choice.ruleKey)) continue;
        builder.choose(choice.ruleKey, choice.elementIds);
      }
      if (advancement) {
        // The same two records an import writes, from the builder's own hands: what each level went
        // to, and the second class's multiclass element (ADR 0036).
        assert.deepEqual(builder.getState().character.advancement, advancement, `${label}: advancement`);
        assert.deepEqual(
          builder.getState().character.choices.filter((c) => isMulticlassRecord(c.ruleKey)),
          reference.choices.filter((c) => isMulticlassRecord(c.ruleKey)),
          `${label}: the multiclass records, keyed as an import keys them`,
        );
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
    // However many saves the folder holds and however they split their levels: each one was rebuilt.
    assert.equal(rebuilt, files.length, 'every save was rebuilt');
  },
);
