/**
 * A character made into another kind — ADR 0134: measured first, then held.
 *
 * Many characters imported from Aurora as player characters are really creatures a DM built with a player character's
 * tools. The measurement converts every sample to each other kind the 5e system declares and reports, as `ℹ` lines
 * (ADR 0042), what each conversion drops by heading, what it changes, which numbers it could copy as typed values, and
 * how each compares with the sheet the sample had. Nothing in it is asserted beyond "something was converted".
 *
 * What is asserted holds against any corpus. Every sample, converted to every other kind, with every copy made and with
 * none: validates as its new kind; holds no record its new kind does not read (no class track, no bag where the kind has
 * no inventory, no choice of a type the kind does not list, no freeform key only the old kind declared); derives with
 * no error the sample did not already have; reads every copied number as the old sheet showed it; and, packed and
 * reopened with no source, shows the same sheet. And a conversion back to the sample's own kind keeps the name, the
 * ability scores it typed and the race it chose.
 *
 * Perturbations, each run and failing here: the choice filter keeping a choice of a type the target does not list (a
 * class held by an NPC); the closed-pick pass skipped (a Fighting Style kept on a creature with no class); the copy's
 * correction pass skipped (a race's increase counted twice, the score reads one more than the old sheet); the collector
 * handed the old kind (the reopened sheet differs).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BundleElementIndex,
  deriveCharacter,
  readCharacterContainer,
  resolveCharacterKind,
  validateCharacter,
  type Character,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import {
  CharacterBuilder,
  convertCharacterKind,
  kindConversionTargets,
  packCharacter,
  sheetDocument,
  sheetMarkdown,
  type KindConversion,
} from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadSchemas } from './node-system.ts';
import { corpusSkip, measureSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const tally = (into: Map<string, number>, key: string, by = 1): void => void into.set(key, (into.get(key) ?? 0) + by);
const show = (m: Map<string, number>): string =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

/** The sheet's text export of a character, as the builder shows it against `elements`. */
function sheetOf(character: Character, system: GameSystem, elements: ElementIndex): string {
  return sheetMarkdown(sheetDocument(new CharacterBuilder(character, system, elements).getState()));
}

/** The character packed as Save packs it and reopened against nothing but what the file embeds. */
function reopen(character: Character, system: GameSystem, elements: ElementIndex): { character: Character; elements: ElementIndex } {
  const packed = packCharacter(character, system, elements, { generator: 'test' });
  const { container } = readCharacterContainer(packed.files);
  return { character: container!.character, elements: new BundleElementIndex(container!.content.elements) };
}

/** What `character` records that `kindId` does not read, as sentences; empty when it is clean. */
function strayRecords(character: Character, system: GameSystem, elements: ElementIndex): string[] {
  const kind = resolveCharacterKind(system, character.kind);
  const stray: string[] = [];
  const types = new Set(kind.elementTypes);
  for (const choice of character.choices) {
    for (const id of choice.elementIds) {
      const element = elements.get(id);
      if (element && !types.has(element.type)) stray.push(`${choice.ruleKey} holds a ${element.type}`);
    }
    if (choice.ruleKey.startsWith('build/') && !kind.buildSteps.some((s) => `build/${s.id}` === choice.ruleKey)) stray.push(`${choice.ruleKey}: no such step`);
  }
  if (character.advancement?.length && kind.progression.kind !== 'level') stray.push('advancement');
  if (!kind.inventory && (character.inventory?.length || character.money)) stray.push('a bag or a purse');
  if (!kind.preparation && character.prepared) stray.push('prepared');
  if (!kind.attacks?.spells && character.spellAttacks) stray.push('spellAttacks');
  if (!kind.startingEquipment && character.startingEquipment) stray.push('startingEquipment');
  if (!kind.customFeatures && character.customFeatures) stray.push('customFeatures');
  if (!kind.additions && character.additions) stray.push('additions');
  return stray;
}

interface Converted {
  sample: string;
  from: Character;
  elements: ElementIndex;
  system: GameSystem;
  to: string;
  conversion: KindConversion;
}

async function conversions(copy: 'all' | 'none'): Promise<Converted[]> {
  const elements = await realElements();
  const out: Converted[] = [];
  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    for (const target of kindConversionTargets(run.system, run.imported.character.kind)) {
      const conversion = convertCharacterKind(run.imported.character, run.system, target.id, run.elements, copy === 'none' ? { copy: [], add: [] } : {});
      out.push({ sample: sample.id, from: run.imported.character, elements: run.elements, system: run.system, to: target.id, conversion });
    }
  }
  return out;
}

test('every sample made into every other kind: what it would lose, change and copy', { skip: corpusSkip || savesSkip || measureSkip }, async (t) => {
  const all = await conversions('all');
  assert.ok(all.length > 0, 'something was converted');
  for (const to of new Set(all.map((c) => c.to))) {
    const these = all.filter((c) => c.to === to);
    const headings = new Map<string, number>();
    const lines = new Map<string, number>();
    const copies = new Map<string, number>();
    const changed = new Map<string, number>();
    let same = 0;
    for (const c of these) {
      for (const group of c.conversion.lost) {
        tally(headings, group.heading);
        tally(lines, group.heading, group.lines.length);
      }
      for (const copy of c.conversion.copies) tally(copies, copy.label);
      for (const line of c.conversion.changed) tally(changed, line.replace(/[\d/]+/g, 'N').replace(/^.*? is held as/, '… is held as'));
      if (!c.conversion.lost.length) same += 1;
    }
    t.diagnostic(`to ${to}: ${these.length} conversions, ${same} losing nothing`);
    t.diagnostic(`to ${to}, samples losing something under each heading: ${show(headings)}`);
    t.diagnostic(`to ${to}, lines under each heading: ${show(lines)}`);
    t.diagnostic(`to ${to}, numbers offered to copy: ${show(copies)}`);
    t.diagnostic(`to ${to}, changed: ${show(changed)}`);
    const first = these.find((c) => c.conversion.lost.length > 3);
    if (first) {
      t.diagnostic(`to ${to}, one sample's list in full:`);
      for (const group of first.conversion.lost) t.diagnostic(`  ${group.heading}: ${group.lines.join(' | ').slice(0, 400)}`);
      for (const line of first.conversion.changed) t.diagnostic(`  changed: ${line}`);
    }
  }
});

for (const copy of ['all', 'none'] as const) {
  test(`every sample made into every other kind, ${copy === 'all' ? 'every number copied' : 'no number copied'}: valid, clean, and the same with no source`, { skip: corpusSkip || savesSkip }, async () => {
    const schemas = await loadSchemas();
    const failures: string[] = [];
    for (const c of await conversions(copy)) {
      const where = `${c.sample} as ${c.to}`;
      const character = c.conversion.character;
      assert.equal(character.kind, c.to);
      const errors = validateCharacter(character, schemas, c.system).errors;
      if (errors.length) failures.push(`${where}: invalid: ${errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
      for (const stray of strayRecords(character, c.system, c.elements)) failures.push(`${where}: keeps ${stray}`);

      const derived = deriveCharacter(character, c.system, c.elements);
      const before = new Set(deriveCharacter(c.from, c.system, c.elements).problems.filter((p) => p.level === 'error').map((p) => p.code));
      for (const p of derived.problems) if (p.level === 'error' && !before.has(p.code)) failures.push(`${where}: a new error, ${p.code}: ${p.message}`);
      for (const made of c.conversion.copies.filter((x) => x.copied)) {
        const read = derived.stats.get(made.stat.toLowerCase())?.value;
        if (read !== made.value) failures.push(`${where}: ${made.label} copied as ${made.value} reads ${read}`);
      }
      if (copy === 'none' && c.conversion.copies.some((x) => x.copied)) failures.push(`${where}: a copy made when none was asked for`);

      const sheet = sheetOf(character, c.system, c.elements);
      const back = reopen(character, c.system, c.elements);
      const again = sheetOf(back.character, c.system, back.elements);
      if (again !== sheet) failures.push(`${where}: the sheet differs reopened with no source`);
    }
    assert.deepEqual(failures, []);
  });
}

test('made into another kind and back, a sample keeps its name, its typed scores and its race', { skip: corpusSkip || savesSkip }, async () => {
  const failures: string[] = [];
  for (const c of await conversions('none')) {
    const back = convertCharacterKind(c.conversion.character, c.system, c.from.kind, c.elements, { copy: [] }).character;
    const where = `${c.sample} as ${c.to} and back`;
    if (back.name !== c.from.name) failures.push(`${where}: name`);
    for (const [stat, value] of Object.entries(c.from.baseStats ?? {})) {
      if (resolveCharacterKind(c.system, c.to).buildSteps.some((s) => s.budget?.targets.some((x) => x.toLowerCase() === stat.toLowerCase())) && back.baseStats?.[stat] !== value) {
        failures.push(`${where}: ${stat} ${back.baseStats?.[stat]}, typed ${value}`);
      }
    }
    const raceOf = (character: Character): string[] =>
      character.choices.flatMap((ch) => ch.elementIds).filter((id) => c.elements.get(id)?.type === 'Race');
    if (JSON.stringify(raceOf(back)) !== JSON.stringify(raceOf(c.from))) failures.push(`${where}: race ${raceOf(back)} not ${raceOf(c.from)}`);
  }
  assert.deepEqual(failures, []);
});
