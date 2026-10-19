/**
 * A cantrip as an attack row — ADR 0111, measured first and then held on the real corpus.
 *
 * - **What content says about a cantrip's attack**, over the corpus: how many cantrips carry the attack or the save tag,
 *   whether any states its roll as a rule or a sheet line (none does), and how many cantrip selects attach to a casting
 *   block, so that what they pick has a DC and an attack bonus to read.
 * - **The samples**: how many held tagged cantrips a block holds. Aurora records no spell attack rows, so the book is the
 *   referee for the rest.
 *
 * Reported as `ℹ` lines (ADR 0042); the tests after them hold what the 5e declaration does, each failing under its named
 * perturbation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { importAuroraCharacter, parseAuroraSave } from '@incudo/aurora-import';
import { BundleElementIndex, deriveCharacter, LayeredElementIndex, readCharacterContainer, validateCharacter, type Element } from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, packCharacter } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import { loadSchemas, loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { SAMPLES_DIR } from './sample-saves.ts';

const PHB = 'Player’s Handbook';
const ATTACK = 'Spell Attack';
const SAVE = 'Spell Saving Throw';

const isCantrip = (e: Element): boolean => e.type === 'Spell' && e.setters['level']?.value.trim() === '0';
const tagged = (e: Element): boolean => e.supports.includes(ATTACK) || e.supports.includes(SAVE);

test('what content says about a cantrip attack (report)', { skip: corpusSkip }, async (t) => {
  const elements = await realElements();
  t.diagnostic(await corpusProvenance());
  const cantrips = elements.byType('Spell').filter(isCantrip);
  const rows = cantrips.filter(tagged);
  t.diagnostic(`${cantrips.length} cantrips; ${cantrips.filter((e) => e.supports.includes(ATTACK)).length} carry "${ATTACK}", ${cantrips.filter((e) => e.supports.includes(SAVE)).length} "${SAVE}"`);
  t.diagnostic(`${rows.filter((e) => e.rules.length > 0 || e.sheet !== undefined).length} of them carry a rule or a sheet line; ${rows.filter((e) => e.setters['damage'] !== undefined).length} a damage setter`);
  let onBlock = 0;
  let offBlock = 0;
  for (const element of elements.all()) {
    for (const rule of element.rules) {
      if (rule.kind !== 'select' || !/cantrip/i.test(rule.name)) continue;
      if (rule.spellcasting) onBlock++;
      else offBlock++;
    }
  }
  t.diagnostic(`cantrip selects: ${onBlock} attach to a casting block, ${offBlock} to none`);
  assert.ok(rows.length > 0, 'the corpus has tagged cantrips');
});

test('held tagged cantrips in the samples, and the block that holds each (report)', { skip: savesSkip || corpusSkip }, async (t) => {
  const system = await loadShippedSystem('dnd5e');
  const corpus = await realElements();
  let held = 0;
  let unblocked = 0;
  for (const file of (await readdir(SAMPLES_DIR)).filter((n) => extname(n) === '.dnd5e').sort()) {
    const imported = importAuroraCharacter(parseAuroraSave(await readFile(join(SAMPLES_DIR, file), 'utf8')), { index: corpus, systemId: 'dnd5e' });
    const index = new LayeredElementIndex([new BundleElementIndex(imported.generated), corpus]);
    const derived = deriveCharacter(imported.character, system, index);
    for (const attack of derived.attacks) {
      if (!attack.spell) continue;
      held++;
      if (attack.spell.block === undefined) unblocked++;
    }
  }
  t.diagnostic(`${held} spell attack rows on the samples, ${unblocked} cast as no class`);
});

/** A character built through the builder: a race (and a subrace), a class, a level, scores. */
async function built(race: string, className: string, level: number, scores: Record<string, number>, subrace?: string) {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const pick = (stepId: string, test: (e: Element) => boolean) => {
    const decision = b.getState().decisions.find((d) => d.stepId === stepId && d.kind === 'pick');
    const id = decision?.candidates.find((c) => test(elements.get(c)!));
    assert.ok(decision && id, `the ${stepId} step offers what is asked for`);
    b.choose(decision.id, [id]);
  };
  pick('race', (e) => e.name === race && e.source === PHB);
  if (subrace) {
    const decision = b.getState().decisions.find((d) => d.candidates.some((c) => elements.get(c)?.name === subrace));
    assert.ok(decision, `${subrace} is offered`);
    b.choose(decision.id, [decision.candidates.find((c) => elements.get(c)?.name === subrace)!]);
  }
  pick('class', (e) => e.name === className && e.source === PHB);
  b.setProgress(level);
  for (const [stat, value] of Object.entries(scores)) b.setBaseStat(stat, value);
  /** Answer the first open decision offering a spell of this name from the book, under a select named like `select`. */
  const learn = (name: string, select: RegExp) => {
    const decision = b.getState().decisions.find((d) => select.test(d.id) && d.candidates.some((c) => elements.get(c)?.name === name && elements.get(c)?.source === PHB));
    assert.ok(decision, `${name} is offered under ${select}`);
    b.choose(decision.id, [...decision.chosen, decision.candidates.find((c) => elements.get(c)?.name === name && elements.get(c)?.source === PHB)!]);
  };
  const spellId = (name: string) => elements.byType('Spell').find((e) => e.name === name && e.source === PHB)!.id;
  const row = (name: string) => b.getState().sheet.sections.find((s) => s.id === 'attacks')?.attacks?.find((a) => a.name === name);
  return { b, system, elements, learn, spellId, row };
}

test('a Wizard 5 casts Fire Bolt at its bonus, two of the die the user chose', { skip: corpusSkip }, async () => {
  // Fails if the declaration is gone (no row), if the count table is not read (1d10), or if the block's attack bonus is
  // not filled (+0).
  const wizard = await built('Human', 'Wizard', 5, { intelligence: 16 });
  wizard.learn('Fire Bolt', /cantrip/i);
  assert.deepEqual([wizard.row('Fire Bolt')?.bonus, wizard.row('Fire Bolt')?.damage, wizard.row('Fire Bolt')?.notes], ['+6', '—', ['its damage is chosen on Build, under Spells']], 'Intelligence 16 and the Human’s +1 (+3), proficiency +3; no die yet');
  assert.equal(wizard.b.setSpellAttack(wizard.spellId('Fire Bolt'), { sides: [10], damageType: 'fire' }), undefined);
  assert.deepEqual([wizard.row('Fire Bolt')?.damage, wizard.row('Fire Bolt')?.range], ['2d10 fire', '120 feet']);
  assert.match(wizard.b.setSpellAttack(wizard.spellId('Fire Bolt'), { sides: [20] })!, /not offered/);

  const { system, elements } = wizard;
  const state = wizard.b.getState();
  assert.deepEqual(validateCharacter(state.character, await loadSchemas(), system).errors, []);
  assert.equal(state.character.formatVersion, 13);
  const packed = packCharacter(state.character, system, elements, { generator: 'test' });
  const { container } = readCharacterContainer(packed.files);
  const reopened = new CharacterBuilder(container!.character, system, new BundleElementIndex(container!.content.elements));
  assert.deepEqual(summarize(reopened.getState().derived), summarize(state.derived), 'the save derives the same with no source');
  assert.deepEqual(reopened.getState().sheet.sections.find((s) => s.id === 'attacks')?.attacks, state.sheet.sections.find((s) => s.id === 'attacks')?.attacks);
});

test("a Cleric's Sacred Flame is its save DC with the ability the user chose", { skip: corpusSkip }, async () => {
  // Fails if a save reads the attack bonus, or the ability is not written.
  const cleric = await built('Human', 'Cleric', 1, { wisdom: 15 });
  cleric.learn('Sacred Flame', /cantrip/i);
  assert.equal(cleric.b.setSpellAttack(cleric.spellId('Sacred Flame'), { sides: [8], damageType: 'radiant', ability: 'Dexterity' }), undefined);
  assert.equal(cleric.row('Sacred Flame')?.bonus, 'DC 13 Dexterity', '8 + 2 + Wisdom 16 (+3)');
  assert.equal(cleric.row('Sacred Flame')?.damage, '1d8 radiant');
});

test("a High Elf's cantrip is cast as no class until the user names one", { skip: corpusSkip }, async () => {
  // Fails if a chosen block is not read: the row stays "—".
  const elf = await built('Elf', 'Cleric', 1, { intelligence: 14, wisdom: 15 }, 'High Elf');
  elf.learn('Fire Bolt', /high elf/i);
  assert.equal(elf.row('Fire Bolt')?.bonus, '—');
  assert.deepEqual(elf.b.getState().spellAttacks.rows.find((r) => r.name === 'Fire Bolt')?.given, undefined);
  assert.equal(elf.b.setSpellAttack(elf.spellId('Fire Bolt'), { block: 'Cleric' }), undefined);
  assert.equal(elf.row('Fire Bolt')?.bonus, '+4', 'the Cleric attack bonus: Wisdom 15 (+2) and proficiency +2');
});
