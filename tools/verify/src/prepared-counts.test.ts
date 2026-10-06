/**
 * How many spells a 2024 class prepares, where content states it, and what the builder owes — ADR 0097 decision A.
 *
 * The 2024 book prints a Prepared Spells column in every caster's Features table. ADR 0046 read the count only from a
 * `<class>:spellcasting:prepare` stat, which the 2024 Wizard, Cleric and Druid carry and the Paladin and Ranger do not,
 * and concluded that content does not state theirs. It does, in the shape content uses for every 2024 caster that is not
 * a Wizard, Cleric or Druid: a spell select attached to the block (`spellcasting="Paladin"`), whose slots open level by
 * level. What the book calls the prepared list is what those picks hold.
 *
 * The first test reads each class's column out of its description, **for this measurement only** (ADR 0005: nothing at
 * run time reads prose), and reports beside it what content's rules state: the allowance of each select attached to the
 * class's block, and whether the block prepares. On AuroraLegacy/elements at `c28ce6c`: the 2024 Paladin's, Ranger's,
 * Bard's, Sorcerer's and Warlock's spell select allowance equals the column at all 20 levels, and the Eldritch Knight's
 * and Arcane Trickster's from level 3; the Wizard, Cleric and Druid prepare by a stat. It asserts nothing (ADR 0042).
 *
 * The others hold, against any corpus that has the classes, what the builder makes of it, each with the perturbation
 * that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { declaredBlocks, type Element, type ElementIndex, type GameSystem } from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, type BuilderState } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

const PHB24 = 'Player’s Handbook (2024)';
const PHB = 'Player’s Handbook';

/** The Prepared Spells columns as the 2024 Player's Handbook prints them, levels 1 to 20. Typed from the book. */
const HALF_CASTER = [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15];
const FULL_CASTER = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];
const WIZARD = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25];

/** The Prepared Spells column of a class's features table, read from its description for this measurement only. */
function preparedColumn(html: string): number[] | undefined {
  const table = /<table[^>]*class="class-features"[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1];
  if (!table) return undefined;
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()),
  );
  const index = (rows[0] ?? []).findIndex((c) => /prepared/i.test(c));
  if (index < 0) return undefined;
  const out: number[] = [];
  for (const row of rows) {
    const level = Number(row[0]);
    if (Number.isInteger(level) && level >= 1 && level <= 20) out[level - 1] = Number(row[index]);
  }
  return out;
}

test('on the corpus: where each 2024 class states how many spells it prepares', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const all = [...(await realElements()).all()];
  for (const element of all) {
    if ((element.type !== 'Class' && element.type !== 'Archetype') || element.source !== PHB24) continue;
    const column = element.description ? preparedColumn(element.description) : undefined;
    if (!column) continue;
    const same = all.filter((e) => e.source === element.source);
    const blocks = same
      .flatMap((e) => declaredBlocks(e))
      .filter((b) => b.attributes['extend'] !== 'true' && b.name.toLowerCase() === element.name.toLowerCase());
    for (const block of blocks) {
      const allowance = new Map<string, number[]>();
      for (const e of same) {
        for (const r of e.rules) {
          if (r.kind !== 'select' || r.type !== 'Spell' || r.spellcasting !== block.name) continue;
          const sums = allowance.get(r.name) ?? Array<number>(20).fill(0);
          for (let level = r.level ?? 1; level <= 20; level++) sums[level - 1]! += r.number;
          allowance.set(r.name, sums);
        }
      }
      // A subclass's table starts at its third level; what the reading finds before that is not a count.
      const from = element.type === 'Archetype' ? 2 : 0;
      const matching = [...allowance].filter(([, sums]) => sums.every((v, i) => i < from || v === column[i]));
      t.diagnostic(
        `${element.name}: block prepares ${block.attributes['prepare'] ?? 'no'}; column ${column.join(',')}; ` +
          `a select's allowance equal to it: ${matching.map(([name]) => name).join(', ') || 'none'}`,
      );
    }
  }
});

/** A fresh character of a class from one book, its race that book's Human. */
function freshOf(system: GameSystem, elements: ElementIndex, cls: string, book: string): CharacterBuilder | undefined {
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  for (const [step, name] of [['race', 'Human'], ['class', cls]] as const) {
    const decision = b.getState().decisions.find((d) => d.stepId === step);
    const id = decision?.candidates.find((c) => elements.get(c)?.name === name && elements.get(c)?.source === book);
    if (!decision || !id) return undefined;
    b.choose(decision.id, [id]);
  }
  return b;
}

test('a 2024 Paladin and Ranger are owed the spells their Prepared Spells column says, at every level', { skip: corpusSkip }, async (t) => {
  // Fails if a pool's allowance stops summing the rules that have opened (say, a pool read from its first rule's
  // `number`), or if a select's `level` stops gating on the class's level: either owes a different count somewhere.
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  for (const cls of ['Paladin', 'Ranger']) {
    const b = freshOf(system, elements, cls, PHB24);
    if (!b) return void t.skip(`no 2024 ${cls} in this corpus`);
    const owed: number[] = [];
    for (let level = 1; level <= 20; level++) {
      b.setProgress(level);
      const state: BuilderState = b.getState();
      owed.push(state.decisions.find((d) => d.label === `Spell (${cls})`)?.remaining ?? 0);
      // No prepared list: the picks are the list, so nothing reads a limit of 0 and nothing is over it.
      assert.equal(state.derived.preparation.length, 0, `${cls} ${level} has no prepared list`);
    }
    t.diagnostic(`2024 ${cls}: owed ${owed.join(',')}`);
    assert.deepEqual(owed, HALF_CASTER, `2024 ${cls} is owed its column's count at every level`);
  }
});

test('a 2024 Wizard, Cleric and Druid prepare the count their column says, at every level', { skip: corpusSkip }, async (t) => {
  // Fails if `<class>:spellcasting:prepare` stops being the limit (every level reads the minimum).
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  for (const [cls, column] of [['Wizard', WIZARD], ['Cleric', FULL_CASTER], ['Druid', FULL_CASTER]] as const) {
    const b = freshOf(system, elements, cls, PHB24);
    if (!b) return void t.skip(`no 2024 ${cls} in this corpus`);
    const limits: number[] = [];
    for (let level = 1; level <= 20; level++) {
      b.setProgress(level);
      limits.push(b.getState().derived.preparation.find((p) => p.key === cls.toLowerCase())?.limit ?? -1);
    }
    t.diagnostic(`2024 ${cls}: limit ${limits.join(',')}`);
    assert.deepEqual(limits, column, `2024 ${cls}'s limit is its column`);
  }
});

test('a 2014 Wizard whose Intelligence modifier would leave it none prepares one', { skip: corpusSkip }, async (t) => {
  // Fails without 5e's `preparation.minimum` (the limit reads 0, so one prepared spell would be over it).
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = freshOf(system, elements, 'Wizard', PHB);
  if (!b) return void t.skip('no 2014 Wizard in this corpus');
  b.setBaseStat('intelligence', 8);
  const state = b.getState();
  const wizard = state.derived.preparation.find((p) => p.key === 'wizard');
  assert.ok(wizard, 'a level 1 Wizard prepares');
  const stated = state.derived.stats.get('wizard:spellcasting:prepare')?.value ?? 0;
  assert.ok(stated <= 0, `content's own formula reads ${stated} here, which the minimum lifts`);
  assert.equal(wizard.limit, 1);
});

test('the typed columns are what the corpus prints', { skip: corpusSkip }, async () => {
  // A guard on the guard: the columns above are typed from the book, and the corpus's descriptions print the same.
  const all = [...(await realElements()).all()];
  const classOf = (name: string): Element | undefined =>
    all.find((e) => e.type === 'Class' && e.source === PHB24 && e.name === name);
  for (const [name, column] of [['Paladin', HALF_CASTER], ['Ranger', HALF_CASTER], ['Wizard', WIZARD], ['Cleric', FULL_CASTER], ['Druid', FULL_CASTER]] as const) {
    const element = classOf(name);
    if (!element?.description) continue;
    assert.deepEqual(preparedColumn(element.description), column, `the 2024 ${name}'s printed column`);
  }
});
