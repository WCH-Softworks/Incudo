/**
 * ROADMAP Phase 2's exit criterion against Aurora: the Rogue 4 / Wizard 4 described in
 * `rogue-wizard-interleaved-build.ts`, built through the builder, compared with the sample save of the same
 * description (docs/SAMPLE-SAVES.md, sample 06).
 *
 * The description is what was handed over; the save is what came back, so the two were made by different
 * hands, and Aurora's `<sum>` and `<magic>` are a referee that had no part in either. This is the comparison
 * `rogue-wizard.test.ts` cannot make: that one is worked out from the Player's Handbook and has only the book to
 * answer to. And it is the one `builder-rebuild.test.ts` cannot make either: that replays the picks a save
 * already holds, so it cannot say the builder *offers* the right choices, in the right order, one level at a time.
 *
 * The save is found by what it is, a manifest entry whose levels alternate between a Rogue and a Wizard, four
 * of each, and not by its name or position. Where there is none, this skips.
 *
 * What is asserted is what Aurora *records*, and what the description fixes:
 *  - no `stat-mismatch` and no `spell-missing`: both blocks' slots, the save DC, the attack bonus, the shared
 *    caster level and every spell Aurora lists;
 *  - that each of those rows was compared at all, measured by breaking it (`rowsCompared`);
 *  - that whatever Aurora derived and this build did not is an input the description does not name: the Aurora
 *    marker for the level the second class began at, or a campaign option (the sample also turns on Customized
 *    Proficiencies, which the description never mentions).
 *  - the prepared list (ADR 0046): the description leaves *which* spells to prepare to the person, so what is
 *    held is what the builder does with the save's own. Its Wizard's limit is the count Aurora's screen showed,
 *    every spell the save prepared is offered by this build's book and accepted, and the result is the list
 *    the save records. That closes the last clause of the exit criterion.
 * What is not asserted is what the description leaves to the person, and the hit points, which no oracle sees
 * (ADR 0019).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BundleElementIndex,
  LayeredElementIndex,
  createCharacter,
  deriveCharacter,
  validateGameSystem,
  type GameSystem,
} from '@incudo/core';
import { compareWithAurora, importAuroraCharacter, parseAuroraSave } from '@incudo/aurora-import';
import { CharacterBuilder } from '@incudo/ui';

import { preparationViolations, rowsCompared, type OracleRun } from './aurora-oracle.ts';
import { loadSchemas } from './node-system.ts';
import { buildInterleavedRogueWizard } from './rogue-wizard-interleaved-build.ts';
import { realElements, requireSaves, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

async function shippedSystem(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

/** Four Rogue levels and four Wizard levels, alternating. */
const isTheDescription = (s: { split: Array<{ class: string; levels: number }>; interleaved: boolean }): boolean => {
  const total = (name: string) => s.split.filter((r) => r.class === name).reduce((n, r) => n + r.levels, 0);
  return s.interleaved && total('Rogue') === 4 && total('Wizard') === 4 && s.split.length === 8;
};

test(
  'the described Rogue 4 / Wizard 4, built one level at a time, agrees with the Aurora save of it',
  { skip: savesSkip },
  async (t) => {
    requireSaves();
    const system = await shippedSystem();
    const corpus = await realElements();

    const samples = samplesWhere(isTheDescription);
    if (samples.length === 0) {
      t.skip('no sample of an interleaved Rogue 4 / Wizard 4 is present');
      return;
    }
    for (const sample of samples) {
      const save = parseAuroraSave(await readFile(samplePath(sample), 'utf8'));
      const imported = importAuroraCharacter(save, { index: corpus, systemId: 'dnd5e' });
      const elements = new LayeredElementIndex([new BundleElementIndex(imported.generated), corpus]);
      const builder = new CharacterBuilder(createCharacter('dnd5e', 'pc', { progress: 1 }), system, elements);
      buildInterleavedRogueWizard(builder, elements);
      const built = deriveCharacter(builder.getState().character, system, elements);
      const comparison = compareWithAurora(save, built, { index: elements });

      // 1. Everything Aurora records numerically, and every spell it lists.
      const real = comparison.differences
        .filter((d) => d.kind === 'stat-mismatch' || d.kind === 'spell-missing')
        .map((d) => `${d.kind}  ${d.elementId ?? ''}  ${d.message}`);
      assert.deepEqual(real, [], `${sample.id}: the built character disagrees with Aurora's own numbers:\n  ${real.join('\n  ')}`);

      // 2. That those rows were compared for this build and not skipped: two casting blocks, so two slot
      //    rows, two save DCs, two attack bonuses, and the one shared caster level.
      const run: OracleRun = { save, imported, system, elements, derived: built, comparison };
      assert.deepEqual(rowsCompared(run), { slots: 2, dc: 2, attack: 2, casterLevel: 1 });
      assert.equal(built.stats.get('multiclass:spellcasting:level')?.value, save.magicLevel, 'the shared caster level');

      // 3. What Aurora has that this build lacks is an input the description does not name.
      //    The one exception is named, and asserted to still be the exception: the Ritual Caster feat's two
      //    spells are chosen through a `Ritual` support filter that Incudo does not read yet, so the builder
      //    cannot offer them. The day it can, they stop being missing and this line fails, which is the point.
      const notInputs = comparison.differences
        .filter((d) => d.kind === 'element-missing')
        .map((d) => d.elementId ?? '')
        .filter((id) => !id.startsWith('ID_INTERNAL_MULTICLASS_LEVEL_') && elements.get(id)?.type !== 'Option');
      assert.deepEqual(
        notInputs.sort(),
        ['ID_PHB_SPELL_ALARM', 'ID_PHB_SPELL_COMPREHEND_LANGUAGES'],
        `${sample.id}: an element Aurora derived that no option, marker or unread filter explains`,
      );

      // 4a. Prepared spells (ADR 0046). Which to prepare is not in the description, so the save's are
      //     prepared through the builder's own write path, each one offered first. The limit is what Aurora's
      //     screen showed for the Wizard, and the list that results is the list Aurora recorded.
      const flagged = save.magic
        .find((block) => block.name.trim().toLowerCase() === 'wizard')!
        .spells.filter((spell) => spell.prepared)
        .map((spell) => spell.id);
      assert.ok(flagged.length > 0, `${sample.id}: the save prepares something`);
      const offered = new Set(builder.preparationOptionsFor('wizard').map((item) => item.id));
      for (const id of flagged) {
        assert.ok(offered.has(id), `${sample.id}: this build's spellbook does not offer ${id} to prepare`);
        assert.equal(builder.prepare('wizard', id), true, `${sample.id}: preparing ${id} is refused`);
      }
      const prepared = deriveCharacter(builder.getState().character, system, elements);
      assert.deepEqual(
        preparationViolations({ save, derived: prepared, elements }, sample.readout.prepared),
        [],
        `${sample.id}: the prepared list disagrees with what Aurora recorded and showed`,
      );
      // The other class is an Arcane Trickster: it knows spells, it does not prepare them, and says so.
      assert.deepEqual(prepared.preparation.map((b) => b.key), ['wizard']);

      // 4b. The levels went where the save says they did, in the same order.
      assert.deepEqual(
        builder.getState().character.advancement?.map((entry) => entry.elementId),
        imported.character.advancement?.map((entry) => entry.elementId),
        `${sample.id}: the class each level was taken in`,
      );
    }
  },
);
