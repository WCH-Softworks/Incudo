/**
 * What a spell's level and prepared mark on the sheet would read, measured before the sheet document carries either.
 *
 * ADR 0079 decision 4's third item: the official 2014 form lays spells out by level, with a prepared box on every levelled
 * line, and both official sheets list spells by level. The sheet document's Spells section lists held spells by name. A
 * spell's level is a setter on its element (5e: `level`, which the spell pickers already show through `candidateNotes`);
 * whether it is prepared is ADR 0046's: `DerivedCharacter.preparation` publishes, per preparing block, what content keeps
 * always prepared (`always`) and what the player's recorded list counts (`chosen`).
 *
 * Over the thirty samples (found with `samplesWhere`), this asks:
 *
 * - **What each listed spell's level setter reads**, by value, and how many listed spells have none (or one that is not a
 *   whole number from 0 to 9).
 * - **Per casting block that prepares**: how many spells are always prepared and how many chosen, and how many of each the
 *   Spells section lists. A block that prepares from a list (a cleric) records spells the derivation does not hold
 *   (ADR 0046: `prepared` is embedded, not seeded), so a prepared spell may be one the Spells section does not list.
 * - **Whether a spell is prepared by more than one block**, and whether a spell one block holds (`held`, a book) is
 *   prepared by another, which is what "listed under one block, prepared by another" can mean: the Spells section is not
 *   per block, so a mark read from every block at once is right only if no spell answers differently in two.
 * - **How the Spells section orders spells today**: whether it is already by level, by name, or the order held.
 *
 * Report-only (ADR 0042): `ℹ` lines, nothing asserted but that samples were read.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ElementId } from '@incudo/core';
import { CharacterBuilder, sheetDocument } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

type Diagnostic = { diagnostic: (s: string) => void };

const isSorted = <T>(values: T[], compare: (a: T, b: T) => number): boolean => values.every((v, i) => i === 0 || compare(values[i - 1]!, v) <= 0);

test('the samples: what a listed spell\'s level and prepared mark would read', { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  let samples = 0;
  let withSpells = 0;
  let listedSpells = 0;
  const levelValues = new Map<string, number>();
  let noLevel = 0;
  const blockLines: string[] = [];
  let preparedNotListed = 0;
  let alwaysNotListed = 0;
  const multiBlock: string[] = [];
  const heldElsewhere: string[] = [];
  const order = { byLevel: 0, byName: 0, byLevelThenName: 0, neither: 0 };
  const orderExamples: string[] = [];
  let preparedListed = 0;
  let alwaysListed = 0;
  let sharedOnTwoLists = 0;

  for (const sample of samplesWhere(() => true)) {
    samples++;
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const derived = run.derived;
    const doc = sheetDocument(new CharacterBuilder(run.imported.character, run.system, run.elements).getState());
    const spells = doc.sections.find((s) => s.id === 'spells')?.elements ?? [];
    const listed = new Set(spells.map((e) => e.elementId));
    if (spells.length) withSpells++;
    const levels: number[] = [];
    for (const e of spells) {
      listedSpells++;
      const raw = run.elements.get(e.elementId)?.setters.level?.value;
      const value = raw === undefined ? '(none)' : raw.trim();
      levelValues.set(value, (levelValues.get(value) ?? 0) + 1);
      const level = Number(value);
      if (raw === undefined || !Number.isInteger(level) || level < 0 || level > 9) noLevel++;
      levels.push(Number.isInteger(level) ? level : 99);
    }
    if (spells.length > 1) {
      const names = spells.map((e) => e.name);
      const byLevel = isSorted(levels, (a, b) => a - b);
      const byName = isSorted(names, (a, b) => a.localeCompare(b));
      const pairs = spells.map((e, i) => ({ level: levels[i]!, name: e.name }));
      const byBoth = isSorted(pairs, (a, b) => a.level - b.level || a.name.localeCompare(b.name));
      if (byBoth) order.byLevelThenName++;
      else if (byLevel) order.byLevel++;
      else if (byName) order.byName++;
      else {
        order.neither++;
        if (orderExamples.length < 3) orderExamples.push(`${sample.id}: ${pairs.slice(0, 5).map((p) => `${p.name} (${p.level})`).join(', ')}, …`);
      }
    }

    // Per preparing block: always and chosen, and how many the Spells section lists.
    const preparedBy = new Map<ElementId, string[]>();
    for (const block of derived.preparation) {
      const always = block.always.filter((id) => listed.has(id)).length;
      const chosen = block.chosen.filter((id) => listed.has(id)).length;
      alwaysListed += always;
      preparedListed += chosen;
      alwaysNotListed += block.always.length - always;
      preparedNotListed += block.chosen.length - chosen;
      blockLines.push(
        `${sample.id} ${block.name} (${block.mode}, limit ${block.limit}): always ${block.always.length} (${always} listed), chosen ${block.chosen.length} (${chosen} listed)` +
          `${block.unavailable.length ? `, unavailable ${block.unavailable.length}` : ''}${block.held.length ? `, book holds ${block.held.length}` : ''}`,
      );
      for (const id of [...block.always, ...block.chosen]) preparedBy.set(id, [...(preparedBy.get(id) ?? []), block.name]);
    }
    for (const [id, blocks] of preparedBy) {
      if (blocks.length > 1) multiBlock.push(`${sample.id}: ${run.elements.get(id)?.name ?? id} in ${blocks.join(', ')}`);
    }
    for (const block of derived.preparation) {
      for (const id of block.held) {
        const others = (preparedBy.get(id) ?? []).filter((name) => name !== block.name);
        if (others.length) heldElsewhere.push(`${sample.id}: ${run.elements.get(id)?.name ?? id} held by ${block.name}, prepared by ${others.join(', ')}`);
      }
    }
    // A spell on two preparing blocks' lists at once (always or chosen in one, held in another's book).
    for (const id of listed) {
      const on = derived.preparation.filter((b) => b.always.includes(id) || b.chosen.includes(id) || b.held.includes(id));
      if (on.length > 1) sharedOnTwoLists++;
    }
  }
  assert.ok(samples > 0, 'samples were read');

  t.diagnostic(`${samples} samples, ${withSpells} with a Spells section; ${listedSpells} spells listed`);
  t.diagnostic(
    `the level setter of a listed spell reads: ${[...levelValues].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([v, n]) => `${v} ${n}`).join(', ')}; ` +
      `${noLevel} with none or not a whole number from 0 to 9`,
  );
  t.diagnostic(`preparing blocks: ${blockLines.length}`);
  for (const line of blockLines) t.diagnostic(`  ${line}`);
  t.diagnostic(`always prepared: ${alwaysListed} listed by the Spells section, ${alwaysNotListed} not; chosen: ${preparedListed} listed, ${preparedNotListed} not (recorded, embedded, and not held)`);
  t.diagnostic(`spells prepared by more than one block ${multiBlock.length}${multiBlock.length ? ` (${multiBlock.join('; ')})` : ''}`);
  t.diagnostic(`spells one block's book holds and another prepares ${heldElsewhere.length}${heldElsewhere.length ? ` (${heldElsewhere.join('; ')})` : ''}`);
  t.diagnostic(`listed spells on two preparing blocks' lists at once (always, chosen or a book) ${sharedOnTwoLists}`);
  t.diagnostic(
    `the Spells section's order today, samples with two or more: by level then name ${order.byLevelThenName}, by level only ${order.byLevel}, by name only ${order.byName}, neither ${order.neither}` +
      `${orderExamples.length ? ` (${orderExamples.join('; ')})` : ''}`,
  );
});
