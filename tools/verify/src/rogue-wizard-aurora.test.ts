/**
 * ROADMAP Phase 2's exit criterion against Aurora: the Wizard 4 / Rogue 4 described in
 * `rogue-wizard-build.ts`, built through the builder, compared with the save the maintainer made of the
 * same description in Aurora.
 *
 * The description is what was handed over; the save is what came back, so the two were made by
 * different hands, and Aurora's `<sum>` and `<magic>` are a referee that had no part in either. This is
 * the comparison `rogue-wizard.test.ts` cannot make: that one is worked out from the Player's Handbook
 * and has only the book to answer to.
 *
 * The save is found by what it is, a character whose levels went four to the Wizard and then four to
 * the Rogue, and not by its name, its position or how many other saves sit beside it. Where there is
 * none, this skips: it is an artefact of the maintainer's machine, like every other real save.
 *
 * What is asserted is what Aurora *records*, and what the description fixes:
 *  - no `stat-mismatch` and no `spell-missing`: both blocks' slots, the save DC, the attack bonus, the
 *    shared caster level and every spell Aurora lists;
 *  - that each of those rows was compared at all, measured by breaking it (`rowsCompared`);
 *  - that whatever Aurora derived and this build did not is an input the description does not name: the
 *    Aurora marker for the level the second class began at, or a campaign option (the save turns on
 *    Customized Proficiencies, which the description never mentions).
 * What is not asserted is what the description leaves to the person: the Sage traits (this build fills
 * them, the save has none) and the hit point rolls (this build takes averages, the save has its own
 * rolls, and Aurora records the rolls and never the total, so no oracle sees `hp`, ADR 0019).
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

import { rowsCompared, type OracleRun } from './aurora-oracle.ts';
import { LocalMirrorFetcher, NodeFetcher } from './node-platform.ts';
import { loadSchemas } from './node-system.ts';
import { ROGUE, WIZARD, buildRogueWizard } from './rogue-wizard-build.ts';
import { unnamed } from './private-saves.ts';

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

const SPLIT = [...Array<string>(4).fill(WIZARD), ...Array<string>(4).fill(ROGUE)].join(',');

test(
  'the described Wizard 4 / Rogue 4, built through the builder, agrees with the Aurora save of it',
  { skip: available ? false : `no Aurora install at ${AURORA_INDEX}` },
  async (t) => {
    const system = await shippedSystem();
    const corpus = await auroraCorpus();

    for (const name of (await readdir(SAVES_DIR)).filter((n) => extname(n).toLowerCase() === '.dnd5e')) {
      const xml = await unnamed('reading a save', () => readFile(join(SAVES_DIR, name), 'utf8'));
      const save = parseAuroraSave(xml);
      const imported = importAuroraCharacter(save, { index: corpus, systemId: 'dnd5e' });
      if (imported.character.advancement?.map((entry) => entry.elementId).join(',') !== SPLIT) continue;

      const elements = new LayeredElementIndex([new BundleElementIndex(imported.generated), corpus]);
      const builder = new CharacterBuilder(createCharacter('dnd5e', 'pc', { progress: 1 }), system, elements);
      buildRogueWizard(builder, elements);
      const built = deriveCharacter(builder.getState().character, system, elements);
      const comparison = compareWithAurora(save, built, { index: elements });

      // 1. Everything Aurora records numerically, and every spell it lists.
      const real = comparison.differences
        .filter((d) => d.kind === 'stat-mismatch' || d.kind === 'spell-missing')
        .map((d) => `${d.kind}  ${d.elementId ?? ''}  ${d.message}`);
      assert.deepEqual(real, [], `the built character disagrees with Aurora's own numbers:\n  ${real.join('\n  ')}`);

      // 2. That those rows were compared for this build and not skipped: two casting blocks, so two
      //    slot rows, two save DCs, two attack bonuses, and the one shared caster level.
      const run: OracleRun = {
        save,
        imported,
        system,
        elements,
        derived: built,
        comparison,
      };
      assert.deepEqual(rowsCompared(run), { slots: 2, dc: 2, attack: 2, casterLevel: 1 });
      assert.equal(built.stats.get('multiclass:spellcasting:level')?.value, save.magicLevel, 'the shared caster level');

      // 3. What Aurora has that this build lacks is an input the description does not name.
      const notInputs = comparison.differences
        .filter((d) => d.kind === 'element-missing')
        .map((d) => d.elementId ?? '')
        .filter((id) => !id.startsWith('ID_INTERNAL_MULTICLASS_LEVEL_') && elements.get(id)?.type !== 'Option');
      assert.deepEqual(notInputs, [], 'an element Aurora derived that no option or marker explains');
      return;
    }
    t.skip('no save of a Wizard 4 / Rogue 4 is installed');
  },
);
