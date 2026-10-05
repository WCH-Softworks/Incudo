/**
 * "Multiclassing" in campaign options, measured over the samples and the corpus — ADR 0088.
 *
 * The overlay's `ID_INTERNAL_OPTION_ALLOW_MULTICLASSING` is read by no content file, so whether gating the class control on
 * it moves an import is a question about what Aurora's saves record, not about content. What holds against any corpus,
 * because the saves are frozen: **every multiclass sample records the option**, so a gate on it flags none of them.
 * Perturbation: take the option out of one multiclass sample's options record and it fails.
 *
 * Then what the gate does, against 5e's own system definition: a new character through the builder is offered a second
 * class with the option on and none with it off, and every sample opened in the builder is offered what its options say,
 * no multiclass one flagged. Perturbation: take `multiclassWhen` out of `systems/dnd5e/system.json` and the unticked
 * character and the 21 single-class samples are offered a second class.
 *
 * Found by what each sample is (its split), never by name or position. Skips without a corpus or the saves.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CharacterBuilder, newCharacterOfKind } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
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

test('a new character is offered a second class with the option on and none with it off', { skip: corpusSkip }, async () => {
  const elements = await realElements();
  const system = await loadShippedSystem('dnd5e');
  const builder = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const fighter = elements.byType('Class').find((element) => element.name === 'Fighter' && element.multiclass)!;
  builder.choose('build/class', [fighter.id]);

  const on = builder.classLevelsFor('levels')!;
  assert.equal(on.allowedBy, undefined, 'a new character starts with the option on (ADR 0080)');
  const addable = on.options.filter((option) => !option.taken && option.eligible);
  assert.ok(addable.length > 0, 'on: another class can be added');

  const options = builder.getState().character.choices.find((c) => c.ruleKey === 'build/options')!;
  builder.choose('build/options', options.elementIds.filter((id) => id !== MULTICLASSING));
  const off = builder.classLevelsFor('levels')!;
  assert.equal(off.allowedBy, MULTICLASSING);
  assert.deepEqual(off.options.filter((option) => !option.taken && option.eligible), [], 'off: no other class');
  assert.equal(builder.addLevel('levels', addable[0]!.id), false, 'and adding one is refused');
  assert.equal(builder.addLevel('levels', fighter.id), true, 'a level in the class it has is not');
});

test('every sample opened in the builder is offered what its options say, and none is flagged', { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  const elements = await realElements();
  let offered = 0;
  let gated = 0;
  for (const sample of samplesWhere(() => true)) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const state = new CharacterBuilder(run.imported.character, run.system, run.elements).classLevelsFor('levels')!;
    const held = run.derived.elementIds.has(MULTICLASSING);
    const addable = state.options.filter((option) => !option.taken && option.eligible).length;
    if (held) {
      offered++;
      assert.equal(state.allowedBy, undefined, `${sample.id}: the option is on`);
      assert.ok(addable > 0, `${sample.id}: another class is offered`);
    } else {
      gated++;
      assert.equal(state.allowedBy, MULTICLASSING, `${sample.id}: the option is off`);
      assert.equal(addable, 0, `${sample.id}: no other class is offered`);
      assert.equal(state.classes.length, 1, `${sample.id}: and none is held, so nothing is flagged`);
    }
  }
  t.diagnostic(`${offered} samples offered another class, ${gated} offered none`);
});
