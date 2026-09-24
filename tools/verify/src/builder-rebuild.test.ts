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
import { compareWithAurora, importAuroraCharacter, parseAuroraSave } from '@incudo/aurora-import';
import { CharacterBuilder } from '@incudo/ui';

import { preparationViolations } from './aurora-oracle.ts';
import { summarize } from './derived-summary.ts';
import { loadSchemas } from './node-system.ts';
import { saveLabel, unnamed } from './private-saves.ts';
import { SAVES_DIR, realElements, requireSaves, savesSkip } from './real-data.ts';

async function shippedSystem(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

test(
  'each real save, rebuilt through the builder, is the character its import is',
  { skip: savesSkip },
  async () => {
    requireSaves();
    const system = await shippedSystem();
    const corpus = await realElements();
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
      // What each block prepared (ADR 0046), which the picks above do not carry: a whole-list preparer's
      // prepared spells are named by nothing else. Each one the import records must be *offered* by the
      // builder before it is prepared, which is the difference between this and replaying a record, and
      // preparing it must be accepted. Always-prepared spells are not offered and are not replayed.
      const importedRows = deriveCharacter(reference, system, elements).preparation;
      for (const row of importedRows) {
        const offered = new Set(builder.preparationOptionsFor(row.key).map((item) => item.id));
        for (const id of row.chosen) {
          assert.ok(offered.has(id), `${label}: the builder does not offer ${id} to prepare for ${row.name}`);
          assert.equal(builder.prepare(row.key, id), true, `${label}: preparing ${id} for ${row.name} is refused`);
        }
        for (const id of row.always) {
          assert.equal(offered.has(id), false, `${label}: ${id} is always prepared and is offered again`);
        }
      }
      const builtRows = builder.getState().preparation;
      const shape = (rows: typeof builtRows) =>
        rows.map((r) => ({ key: r.key, mode: r.mode, limit: r.limit, always: [...r.always.map((i) => i.id)].sort(), chosen: r.chosen.map((i) => i.id), unavailable: r.unavailable.length, over: r.over }));
      assert.deepEqual(
        shape(builtRows),
        importedRows.map((r) => ({ key: r.key, mode: r.mode, limit: r.limit, always: [...r.always].sort(), chosen: r.chosen, unavailable: 0, over: r.over })),
        `${label}: the builder's prepared lists are the import's`,
      );

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
      assert.deepEqual(
        preparationViolations({ save, derived: built, elements }),
        [],
        `${label}: the rebuilt prepared lists are the ones Aurora recorded`,
      );
      rebuilt += 1;
    }
    // However many saves the folder holds and however they split their levels: each one was rebuilt.
    assert.equal(rebuilt, files.length, 'every save was rebuilt');
  },
);
