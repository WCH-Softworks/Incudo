/**
 * What a class's hit dice on the sheet would read, measured before the sheet document carries them.
 *
 * ADR 0079 decision 4's fourth item: both official sheets print hit dice (the 2014 form has a "hit dice" total box), and
 * the sheet document names each class with its level (decision 7: `SheetListedElement.progress`, "Paladin 3") and no
 * die. A class carries its die in a setter (5e: `hd`, which a build step's `levelRoll.dieSetter` and ADR 0044's per-track
 * `setter` expression already read), and a character has one hit die per level of the class, so a class's hit dice would
 * be the track's count (what decision 7 reads) of the die its setter names.
 *
 * Over the thirty samples (found with `samplesWhere`), and the loaded corpus, this asks:
 *
 * - **What each held class's `hd` setter reads**, by value, and how many have none or a value that is not a die.
 * - **Whether a 2014 and a 2024 class of the same name read the same die.**
 * - **Whether the count of dice per class (the track's count, `trackProgress`) agrees with the manifest's split.**
 * - **Whether anything else in content names or adds to hit dice**: an `hd` setter on an element that is not a class, a
 *   stat rule or another setter whose name says hit dice, a sheet placeholder reading one.
 * - **How the multiclass samples would read**, and which of their classes share a die (a total line would add those).
 *
 * Report-only (ADR 0042): `ℹ` lines, nothing asserted but that samples were read.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { trackProgress } from '@incudo/core';

import { runOracle } from './aurora-oracle.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere, type SampleEntry } from './sample-saves.ts';

type Diagnostic = { diagnostic: (s: string) => void };

const DIE = /^d\d+$/i;
const NAMES_HIT_DICE = /(^|[^a-z])(hd|hit ?di(c?e)?)([^a-z]|$)/i;

/** The split as levels per class name, lowercased. */
function splitLevels(sample: SampleEntry): Map<string, number> {
  const out = new Map<string, number>();
  for (const run of sample.split) out.set(run.class.toLowerCase(), (out.get(run.class.toLowerCase()) ?? 0) + run.levels);
  return out;
}

test("the corpus: which elements carry a hit die, and what else names hit dice", { skip: corpusSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const values = new Map<string, number>();
  const notClass: string[] = [];
  const classesWithout: string[] = [];
  const statRules = new Map<string, number>();
  const otherSetters = new Map<string, number>();
  let placeholders = 0;
  let classes = 0;
  for (const element of elements.all()) {
    const hd = element.setters.hd?.value;
    if (element.type === 'Class') {
      classes++;
      if (hd === undefined) classesWithout.push(element.name);
    }
    if (hd !== undefined) {
      values.set(hd.trim(), (values.get(hd.trim()) ?? 0) + 1);
      if (element.type !== 'Class') notClass.push(`${element.name} (${element.type})`);
    }
    for (const name of Object.keys(element.setters)) {
      if (name !== 'hd' && NAMES_HIT_DICE.test(name)) otherSetters.set(name, (otherSetters.get(name) ?? 0) + 1);
    }
    for (const rule of element.rules) {
      if (rule.kind === 'stat' && NAMES_HIT_DICE.test(rule.name)) statRules.set(rule.name, (statRules.get(rule.name) ?? 0) + 1);
    }
    for (const d of element.sheet?.descriptions ?? []) {
      if (/\{\{[^}]*(hd|hit ?di)[^}]*\}\}/i.test(d.text)) placeholders++;
    }
  }
  t.diagnostic(`${classes} Class elements; ${classesWithout.length} without an hd setter${classesWithout.length ? ` (${classesWithout.join(', ')})` : ''}`);
  t.diagnostic(`hd setter values: ${[...values].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([v, n]) => `${v} ${n}`).join(', ')}; ${[...values.keys()].filter((v) => !DIE.test(v)).length} not a die`);
  t.diagnostic(`an hd setter on an element that is not a class: ${notClass.length}${notClass.length ? ` (${notClass.join(', ')})` : ''}`);
  t.diagnostic(`other setters naming hit dice: ${otherSetters.size ? [...otherSetters].map(([n, c]) => `${n} ${c}`).join(', ') : 'none'}`);
  t.diagnostic(`stat rules naming hit dice: ${statRules.size ? [...statRules].map(([n, c]) => `${n} ${c}`).join(', ') : 'none'}`);
  t.diagnostic(`sheet descriptions with a placeholder naming hit dice: ${placeholders}`);
});

test("the samples: what each held class's hit dice would read", { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  let samples = 0;
  let held = 0;
  const values = new Map<string, number>();
  let notDie = 0;
  const countDiffers: string[] = [];
  const byName = new Map<string, Map<string, Set<string>>>();
  const multiclassLines: string[] = [];
  let sharing = 0;
  for (const sample of samplesWhere(() => true)) {
    samples++;
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const derived = run.derived;
    const split = splitLevels(sample);
    const read: string[] = [];
    const dice = new Map<string, number>();
    for (const element of derived.elements.filter((e) => e.type === 'Class')) {
      held++;
      const hd = element.setters.hd?.value?.trim();
      const value = hd ?? '(none)';
      values.set(value, (values.get(value) ?? 0) + 1);
      if (hd === undefined || !DIE.test(hd)) notDie++;
      const count = trackProgress(derived.kind.progression, element, derived.stats);
      const want = split.get(element.name.toLowerCase());
      if (count !== want) countDiffers.push(`${sample.id} ${element.name}: ${count ?? 'none'} against the split's ${want ?? 'none'}`);
      const editions = byName.get(element.name.toLowerCase()) ?? new Map<string, Set<string>>();
      editions.set(sample.edition, (editions.get(sample.edition) ?? new Set()).add(value));
      byName.set(element.name.toLowerCase(), editions);
      read.push(`${element.name} ${count ?? '?'} (${count ?? '?'}${hd ?? '?'})`);
      if (hd) dice.set(hd.toLowerCase(), (dice.get(hd.toLowerCase()) ?? 0) + (count ?? 0));
    }
    if (split.size > 1) {
      const shared = dice.size < split.size;
      if (shared) sharing++;
      const total = [...dice].sort((a, b) => Number(b[0].slice(1)) - Number(a[0].slice(1))).map(([die, n]) => `${n}${die}`).join(' + ');
      multiclassLines.push(`${sample.id} (${sample.edition}): ${read.join(' / ')}; total ${total}${shared ? ', two classes share a die' : ''}`);
    }
  }
  assert.ok(samples > 0, 'samples were read');
  t.diagnostic(`${samples} samples, ${held} classes held`);
  t.diagnostic(`hd setter of a held class: ${[...values].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([v, n]) => `${v} ${n}`).join(', ')}; ${notDie} with none or not a die`);
  const editionsDiffer = [...byName].filter(([, e]) => e.size > 1 && new Set([...e.values()].flatMap((s) => [...s])).size > 1);
  const both = [...byName].filter(([, e]) => e.size > 1).map(([n]) => n);
  t.diagnostic(`classes held in both editions: ${both.length}${both.length ? ` (${both.join(', ')})` : ''}; reading different dice: ${editionsDiffer.length}${editionsDiffer.length ? ` (${editionsDiffer.map(([n, e]) => `${n}: ${[...e].map(([ed, v]) => `${ed} ${[...v].join('/')}`).join(', ')}`).join('; ')})` : ''}`);
  t.diagnostic(`dice per class (the track's count) against the split: ${countDiffers.length} differ${countDiffers.length ? ` (${countDiffers.join('; ')})` : ''}`);
  t.diagnostic(`multiclass samples: ${multiclassLines.length}, ${sharing} with two classes sharing a die`);
  for (const line of multiclassLines) t.diagnostic(`  ${line}`);
});
