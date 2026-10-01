/**
 * What a proficiency mark on a save or skill row would read, measured before the sheet document carries one.
 *
 * ADR 0079 decision 4: the official 2014 form has a box beside each of the six saves and eighteen skills, and the sheet
 * document says nothing a box could take; a player character's derivation does. 5e content writes a proficiency as the
 * proficiency bonus into `<skill>:proficiency` or `<ability>:save:proficiency` (`bonus="proficiency"`, `"base"` or none) and
 * expertise as a second one in the `double` bucket, while Jack of All Trades' half bonus goes to `<skill>:misc`. So a row's
 * mark could be read as how many times the proficiency bonus that stat holds, with no game noun in the reader.
 *
 * Over the thirty samples (found with `samplesWhere`), every creature as an NPC, and a held creature's scope, this asks:
 *
 * - **What the ratio is**: the row's `…:proficiency` over `proficiency`, per row. Anything but 0, 1 or 2 is a row a
 *   count of multiples would misread.
 * - **Whether the ratio and what contributes agree**: a ratio of 1 or more with no contribution, or contributions with a
 *   ratio of 0, would mean the stat is not the whole story.
 * - **Which buckets the contributions sit in**, per ratio.
 * - **Whether a row's mark would differ from its value**: a row whose value moves by something other than the modifier
 *   and the proficiency (Jack of All Trades, a magic item) still marks only what proficiency gives.
 *
 * Report-only (ADR 0042) on the commit before the marks were built.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCharacterKind, type DerivedCharacter } from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

type Diagnostic = { diagnostic: (s: string) => void };

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const SKILLS = [
  'acrobatics', 'animal handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation',
  'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight of hand',
  'stealth', 'survival',
];
const ROWS = [...ABILITIES.map((a) => `${a}:save`), ...SKILLS];

const tally = (into: Map<string, number>, key: string): void => void into.set(key, (into.get(key) ?? 0) + 1);
const show = (m: Map<string, number>): string =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

interface Tallies {
  ratios: Map<string, number>;
  buckets: Map<string, number>;
  disagree: string[];
  misc: number;
  bonusZero: number;
}

const fresh = (): Tallies => ({ ratios: new Map(), buckets: new Map(), disagree: [], misc: 0, bonusZero: 0 });

/** Read every row of one derivation, `prefix` naming the stats ('' for a character, 'companion:' for a held creature's scope). */
function readRows(into: Tallies, who: string, derived: DerivedCharacter, prefix = ''): void {
  const stat = (name: string) => derived.stats.get(`${prefix}${name}`);
  const bonus = stat('proficiency')?.value ?? 0;
  if (!bonus) {
    into.bonusZero++;
    return;
  }
  for (const row of ROWS) {
    const prof = stat(`${row}:proficiency`);
    const value = prof?.value ?? 0;
    const ratio = value / bonus;
    tally(into.ratios, Number.isInteger(ratio) ? String(ratio) : `not whole (${value} of ${bonus})`);
    const live = (prof?.contributions ?? []).filter((c) => c.value !== 0);
    for (const c of live) tally(into.buckets, `ratio ${Number.isInteger(ratio) ? ratio : '?'}: ${c.bonus ?? '(none)'}`);
    if ((ratio >= 1) !== (live.length > 0)) into.disagree.push(`${who} ${row}: ratio ${ratio}, ${live.length} contributions`);
    if ((stat(`${row}:misc`)?.value ?? 0) !== 0) into.misc++;
  }
}

function report(t: Diagnostic, what: string, into: Tallies, sheets: number): void {
  t.diagnostic(`${what}: ${sheets} derivations, ${sheets * ROWS.length} rows; proficiency bonus 0 on ${into.bonusZero}`);
  t.diagnostic(`${what}: the row's proficiency stat over the bonus: ${show(into.ratios)}`);
  t.diagnostic(`${what}: buckets of what contributes, by ratio: ${show(into.buckets)}`);
  t.diagnostic(`${what}: rows where the ratio and what contributes disagree ${into.disagree.length}${into.disagree.length ? ` (${into.disagree.slice(0, 8).join('; ')})` : ''}`);
  t.diagnostic(`${what}: rows with something else added (…:misc non-zero), which a mark would not count: ${into.misc}`);
}

test('the samples: a save or skill row\'s proficiency, as multiples of the bonus', { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const own = fresh();
  const held = fresh();
  let sheets = 0;
  let creatures = 0;
  for (const sample of samplesWhere(() => true)) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    readRows(own, sample.id, run.derived);
    sheets++;
    for (const companion of run.derived.companions ?? []) {
      creatures++;
      readRows(held, `${sample.id} ${companion.elementId}`, { ...run.derived, stats: companion.stats } as DerivedCharacter, 'companion:');
    }
  }
  assert.ok(sheets > 0, 'samples were read');
  report(t, 'samples', own, sheets);
  report(t, 'creatures the samples hold, in their scope', held, creatures);
});

test('every creature as an NPC: its rows, as multiples of its bonus', { skip: corpusSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const kind = resolveCharacterKind(system, 'npc');
  const step = kind.buildSteps.find((s) => (s.required || s.pick) && s.types.length > 0 && !s.budget && !s.multiple)!;
  const into = fresh();
  let sheets = 0;
  for (const creature of step.types.flatMap((type) => elements.byType(type))) {
    const builder = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, elements);
    builder.choose(`build/${step.id}`, [creature.id]);
    readRows(into, creature.id, builder.getState().derived);
    sheets++;
  }
  report(t, kind.name, into, sheets);
});
