/**
 * What text a user writes about a character, measured before deciding which fields a kind offers — ADR 0092.
 *
 * `Character.freeform` is filled by the Aurora importer and by nothing else. This reads the thirty sample saves and asks,
 * reported as `ℹ` lines (ADR 0042):
 *
 * - **Aurora's vocabulary.** Every key the importer would write from a save's `<input>` and `<appearance>` if each field
 *   were filled, read by filling every empty one (the importer drops what is empty, so the samples' own keys say less).
 * - **What the samples carry.** The keys the importer writes from each sample as it is, by how many samples carry each.
 *
 * And asserts what holds against any save: every field 5e's player character declares is a key in that vocabulary, so an
 * imported character's text is shown with no change to the frozen importer; every key the 2014 form map fills from is
 * one the player character declares; and every key a sample carries is either declared or one of the families ADR 0092
 * leaves out on purpose (coins, experience, attack notes, a background feature's text, the faction symbol, list picks).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseAuroraSave } from '@incudo/aurora-import';
import { resolveCharacterKind } from '@incudo/core';

import { loadShippedSystem, systemsDirectory } from './node-system.ts';
import { savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

type Diagnostic = { diagnostic: (s: string) => void };

const tally = (into: Map<string, number>, key: string): void => void into.set(key, (into.get(key) ?? 0) + 1);
const show = (m: Map<string, number>): string =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

/** The keys `importAuroraCharacter`'s `toFreeform` writes from a parsed save's input and appearance (the name and portrait left out). */
function freeformKeys(xml: string): string[] {
  const save = parseAuroraSave(xml);
  return [
    ...Object.keys(save.input).filter((key) => key !== 'name'),
    ...Object.keys(save.appearance).filter((key) => key !== 'portrait').map((key) => `appearance.${key}`),
  ];
}

/** The save with every empty leaf of its `<input>` and `<appearance>` given text, so the parser keeps its key. */
function filled(xml: string): string {
  return xml.replace(/<input>[\s\S]*<\/appearance>/, (block) =>
    block.replace(/<!\[CDATA\[\]\]>/g, 'x').replace(/<([a-z][\w-]*)([^>/]*)>\s*<\/\1>/gi, '<$1$2>x</$1>'),
  );
}

/** The families ADR 0092 decision 1 leaves undeclared on purpose. */
const LEFT_OUT = /^(currency\.(copper|silver|electrum|gold|platinum|equipment)|experience|attacks\.|background\.feature\.|organization\.symbol|list\.)/;

test('what an Aurora save writes as freeform text, and what 5e and its form read of it', { skip: savesSkip }, async (t: Diagnostic) => {
  const vocabulary = new Map<string, number>();
  const carried = new Map<string, number>();
  let saves = 0;
  for (const sample of samplesWhere(() => true)) {
    const xml = await readFile(samplePath(sample), 'utf8');
    saves++;
    for (const key of freeformKeys(filled(xml))) tally(vocabulary, key.replace(/^attacks\.attack\..*/, 'attacks.attack.*').replace(/^background\.feature\..*/, 'background.feature.*'));
    for (const key of freeformKeys(xml)) tally(carried, key.replace(/^attacks\.attack\..*/, 'attacks.attack.*').replace(/^background\.feature\..*/, 'background.feature.*'));
  }
  assert.ok(saves > 0, 'samples were read');
  t.diagnostic(`${saves} saves; every key the importer would write, filled: ${show(vocabulary)}`);
  t.diagnostic(`keys the samples carry as they are: ${show(carried)}`);

  const system = await loadShippedSystem('dnd5e');
  const declared = (resolveCharacterKind(system, 'pc').freeform?.fields ?? []).map((field) => field.key);
  // Fails if a declared field names a key Aurora never writes: an imported character's text would not appear in it.
  assert.deepEqual(declared.filter((key) => !vocabulary.has(key)), []);
  // Fails if a key the samples carry is neither declared nor left out on purpose: it would be carried and shown nowhere.
  assert.deepEqual([...carried.keys()].filter((key) => !declared.includes(key) && !LEFT_OUT.test(key)), []);
  t.diagnostic(`declared by 5e's player character: ${declared.length}; keys in the vocabulary no field shows: ${[...vocabulary.keys()].filter((k) => !declared.includes(k)).join(', ')}`);

  const map = JSON.parse(await readFile(join(systemsDirectory(), 'dnd5e', 'forms', 'official-2014.json'), 'utf8')) as { fill: Array<{ freeform?: string }> };
  const filledFrom = map.fill.flatMap((rule) => (rule.freeform ? [rule.freeform] : []));
  // Fails if the form fills a box from a key the player character does not declare: the document never holds it.
  assert.deepEqual(filledFrom.filter((key) => !declared.includes(key)), []);
  t.diagnostic(`the 2014 form fills ${filledFrom.length} boxes from them: ${filledFrom.join(', ')}`);
});
