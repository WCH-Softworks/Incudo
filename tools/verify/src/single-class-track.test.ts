/**
 * A character with one class publishes that class's level — ADR 0044, decision 5.
 *
 * `advancement` exists only while there is more than one class (ADR 0036), so a single-class character
 * had no track and every `level:<class>` that content reads (a subclass's hit points, 79 rules for the
 * Ranger alone) was 0 for it. The counts in the oracle cannot see that: they compare elements, and a
 * stat that reads 0 removes no element. The evidence is this invariant over the samples, and the
 * perturbation in `packages/core/src/engine.test.ts` (no declared `trackType`, no published count).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runOracle } from './aurora-oracle.ts';
import { realElements, requireCorpus, requireSaves, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

test('every single-class sample publishes its class level', { skip: savesSkip }, async (t) => {
  const location = requireCorpus();
  requireSaves();
  const corpus = await realElements();

  const samples = samplesWhere((s) => s.split.length === 1);
  assert.ok(samples.length > 0, 'the samples include single-class characters');
  const wrong: string[] = [];
  for (const sample of samples) {
    const run = await runOracle(samplePath(sample), corpus, location.index);
    const [only] = sample.split;
    const name = run.derived.elements.find((e) => e.type === 'Class')?.name.toLowerCase();
    const level = run.derived.stats.get('level')?.value;
    const published = name === undefined ? undefined : run.derived.stats.get(`level:${name}`)?.value;
    if (published !== level || level !== only!.levels) {
      wrong.push(`${sample.id}: level:${name} is ${published}, the character is level ${level}`);
    }
  }
  t.diagnostic(`${samples.length} single-class samples`);
  assert.deepEqual(wrong, []);
});
