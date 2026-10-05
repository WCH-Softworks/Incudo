/**
 * "Multiclassing" in campaign options, measured over the samples and the corpus — ADR 0088.
 *
 * The overlay's `ID_INTERNAL_OPTION_ALLOW_MULTICLASSING` is read by no content file, so whether gating the class control on
 * it moves an import is a question about what Aurora's saves record, not about content. What holds against any corpus,
 * because the saves are frozen: **every multiclass sample records the option**, so a gate on it flags none of them.
 * Perturbation: take the option out of one multiclass sample's options record and it fails.
 *
 * Found by what each sample is (its split), never by name or position. Skips without a corpus or the saves.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runOracle } from './aurora-oracle.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere, type SampleEntry } from './sample-saves.ts';

const MULTICLASSING = 'ID_INTERNAL_OPTION_ALLOW_MULTICLASSING';

type Diagnostic = { diagnostic: (s: string) => void };

const classCount = (sample: SampleEntry): number => new Set(sample.split.map((run) => run.class.toLowerCase())).size;

test('the samples: which record the option, and every multiclass one does', { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  let on = 0;
  let multi = 0;
  const keys = new Set<string>();
  const multiclassOff: string[] = [];
  const samples = samplesWhere(() => true);
  for (const sample of samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const held = run.derived.elementIds.has(MULTICLASSING);
    for (const choice of run.imported.character.choices) if (choice.elementIds.includes(MULTICLASSING)) keys.add(choice.ruleKey);
    if (held) on++;
    if (classCount(sample) > 1) {
      multi++;
      if (!held) multiclassOff.push(sample.id);
    }
  }
  t.diagnostic(`${on} of ${samples.length} samples record the option; ${multi} are multiclass; recorded under ${[...keys].join(', ') || 'nothing'}`);
  assert.deepEqual(multiclassOff, [], 'every multiclass sample records the option, so a gate on it flags none');
});
