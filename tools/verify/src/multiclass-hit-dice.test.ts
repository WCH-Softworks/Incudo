/**
 * A multiclass save's hit points, with the average option off — ADR 0044, decision 3.
 *
 * With `ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP` off Aurora applies the recorded dice, and every class
 * carries its own list, indexed by its own levels. The importer used to keep only the first list and
 * file it by character level, so a second class's dice were dropped: the multiclass samples read
 * anywhere from 6 low to 18 high. The evidence is Aurora's screen, read by the maintainer, and the
 * perturbation in `packages/aurora-import/src/import-character.test.ts` (read by position, get the
 * old numbers). `aurora verify` cannot see it: it compares elements and stats Aurora records, and
 * Aurora records no hit point total.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runOracle } from './aurora-oracle.ts';
import { realElements, requireCorpus, requireSaves, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

const AVERAGE = 'ID_INTERNAL_OPTION_ALLOW_AVERAGE_HP';

test('a multiclass sample without the average option reads the hit points Aurora showed', { skip: savesSkip }, async (t) => {
  const location = requireCorpus();
  requireSaves();
  const corpus = await realElements();

  const samples = samplesWhere((s) => s.split.length > 1 && !s.options.includes(AVERAGE));
  assert.ok(samples.length > 0, 'the samples include a multiclass character without the option');
  const wrong: string[] = [];
  for (const sample of samples) {
    const run = await runOracle(samplePath(sample), corpus, location.index);
    const derived = run.derived.stats.get('hp')?.value;
    if (derived !== sample.readout.hp) wrong.push(`${sample.id}: Aurora showed ${sample.readout.hp}, derived ${derived}`);
  }
  t.diagnostic(`${samples.length} multiclass samples without the option`);
  assert.deepEqual(wrong, []);
});
