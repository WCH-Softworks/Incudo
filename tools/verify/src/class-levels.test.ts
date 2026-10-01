/**
 * What a class's level on the sheet would read, measured before the sheet document carries one.
 *
 * ADR 0079 decision 4: the official 2014 form has one "class & level" line, and the sheet document names each class (the
 * Character section lists them) and has only the character level (Combat). A single-class character records no
 * `advancement` (ADR 0036), so a level per class cannot be read from the character; it has to be what the derivation
 * publishes. Every track publishes its own count as the progression's `trackStatPattern` names it (5e: `level:{name}`,
 * ADR 0015), a multiclass character's from its `advancement`, a single-class one's from its one class as an implicit track
 * (ADR 0044 decision 5), each contributed from the track's root element. `gateLevels` (ADR 0076) names a level per held
 * element too.
 *
 * Over the thirty samples (found with `samplesWhere`), this asks, per class the character holds:
 *
 * - **What the track stat reads**, and whether its one contribution comes from that class's element (so a reader can
 *   tell a track's count from a stat that merely shares the name).
 * - **Whether it agrees with the manifest's `split`**, the levels per class the save was built with, summed per class.
 * - **Whether `gateLevels` says the same** for the class element.
 * - **The order the Character section lists the classes in**, against the split's first-taken order.
 * - **Whether the counts add up to the character level.**
 *
 * Report-only (ADR 0042) on the commit before the levels were built.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { trackStatKey } from '@incudo/core';
import { CharacterBuilder, sheetDocument } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere, type SampleEntry } from './sample-saves.ts';

type Diagnostic = { diagnostic: (s: string) => void };

/** The split as levels per class name, lowercased, in the order each class was first taken. */
function splitLevels(sample: SampleEntry): Map<string, number> {
  const out = new Map<string, number>();
  for (const run of sample.split) out.set(run.class.toLowerCase(), (out.get(run.class.toLowerCase()) ?? 0) + run.levels);
  return out;
}

test('the samples: what the derivation publishes as each class\'s level', { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  let single = 0;
  let multi = 0;
  let classes = 0;
  let fromRoot = 0;
  const disagree: string[] = [];
  const gateDisagree: string[] = [];
  const orderDiffers: string[] = [];
  const sumDiffers: string[] = [];
  const multiclassLines: string[] = [];
  for (const sample of samplesWhere(() => true)) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const derived = run.derived;
    const expected = splitLevels(sample);
    if (expected.size > 1) multi++;
    else single++;
    const held = derived.elements.filter((e) => e.type === 'Class');
    let sum = 0;
    const read: string[] = [];
    for (const element of held) {
      classes++;
      const key = trackStatKey(derived.kind.progression, element.name);
      const stat = key ? derived.stats.get(key.toLowerCase()) : undefined;
      const value = stat?.value;
      if (stat && stat.contributions.length === 1 && stat.contributions[0]!.from === element.id) fromRoot++;
      sum += value ?? 0;
      read.push(`${element.name} ${value ?? '(none)'}`);
      const want = expected.get(element.name.toLowerCase());
      if (want !== value) disagree.push(`${sample.id} ${element.name}: ${value ?? 'none'} against the split's ${want ?? 'none'}`);
      const gate = derived.gateLevels.get(element.id);
      if (gate !== value) gateDisagree.push(`${sample.id} ${element.name}: gate level ${gate ?? 'none'}, track ${value ?? 'none'}`);
    }
    if (held.length !== expected.size) disagree.push(`${sample.id}: holds ${held.length} classes, the split names ${expected.size}`);
    const level = derived.stats.get('level')?.value;
    if (sum !== level) sumDiffers.push(`${sample.id}: ${sum} against level ${level}`);
    // The order the document lists them in, against the order they were first taken.
    const doc = sheetDocument(new CharacterBuilder(run.imported.character, run.system, run.elements).getState());
    const listed = (doc.sections.find((s) => s.id === 'identity')?.elements ?? [])
      .filter((e) => run.elements.get(e.elementId)?.type === 'Class')
      .map((e) => e.name.toLowerCase());
    const firstTaken = [...expected.keys()];
    if (listed.join('|') !== firstTaken.join('|')) orderDiffers.push(`${sample.id}: listed ${listed.join(', ')}; taken ${firstTaken.join(', ')}`);
    if (expected.size > 1) multiclassLines.push(`${sample.id}${sample.interleaved ? ' (interleaved)' : ''}: ${read.join(' / ')}`);
  }
  assert.ok(single + multi > 0, 'samples were read');
  t.diagnostic(`samples: ${single} single-class, ${multi} multiclass; ${classes} classes held, ${fromRoot} with a track stat whose one contribution is the class element`);
  t.diagnostic(`track stat against the manifest's split: ${disagree.length} differ${disagree.length ? ` (${disagree.join('; ')})` : ''}`);
  t.diagnostic(`gateLevels against the track stat, per class element: ${gateDisagree.length} differ${gateDisagree.length ? ` (${gateDisagree.join('; ')})` : ''}`);
  t.diagnostic(`track stats summed against the character level: ${sumDiffers.length} differ${sumDiffers.length ? ` (${sumDiffers.join('; ')})` : ''}`);
  t.diagnostic(`Character section's class order against the order first taken: ${orderDiffers.length} differ${orderDiffers.length ? ` (${orderDiffers.join('; ')})` : ''}`);
  for (const line of multiclassLines) t.diagnostic(`multiclass ${line}`);
});
