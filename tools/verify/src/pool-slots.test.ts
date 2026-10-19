/**
 * Which recorded picks still fit a slot the character has, measured over the corpus and the samples — ADR 0096.
 *
 * Measuring first, report-only lines. The corpus: how many `select` pools have more than one rule, and how their
 * rules differ. The samples: every recorded pick, whether it answers a pool content declares, whether that pool is
 * still open, which slot it fits, and which slot the old level-order fill would have put it in.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveCharacter,
  evaluateRequirements,
  poolSlots,
  requirementContextFor,
  collectCharacterContent,
  MapElementIndex,
  resolveCharacterKind,
  type Element,
  type ElementIndex,
} from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { summarize } from './derived-summary.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

type Diagnostic = { diagnostic: (s: string) => void };

/** How many picks the old level-order fill put in a rule they do not fit: pick n in the rule whose slots reach n. */
function levelOrderMisfits(rules: readonly { number: number }[], picks: readonly { fits: number[] }[]): number {
  let misfits = 0;
  let rule = 0;
  let used = 0;
  for (const pick of picks) {
    while (rule < rules.length && used >= rules[rule]!.number) {
      rule++;
      used = 0;
    }
    if (rule < rules.length && !pick.fits.includes(rule)) misfits++;
    used++;
  }
  return misfits;
}

test('the corpus: select pools with more than one rule, and how their rules differ', { skip: corpusSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  let groups = 0;
  let multi = 0;
  const differ = { supports: 0, requirements: 0, type: 0, number: 0 };
  for (const element of elements.all() as Iterable<Element>) {
    const pools = new Map<string, Extract<Element['rules'][number], { kind: 'select' }>[]>();
    for (const rule of element.rules) {
      if (rule.kind !== 'select') continue;
      pools.set(rule.key, [...(pools.get(rule.key) ?? []), rule]);
    }
    for (const rules of pools.values()) {
      groups++;
      if (rules.length < 2) continue;
      multi++;
      const same = (f: (r: (typeof rules)[number]) => unknown) => new Set(rules.map((r) => JSON.stringify(f(r)) ?? '')).size === 1;
      if (!same((r) => r.supports)) differ.supports++;
      if (!same((r) => r.requirements)) differ.requirements++;
      if (!same((r) => r.type)) differ.type++;
      if (!same((r) => r.number)) differ.number++;
    }
  }
  t.diagnostic(
    `${groups} select pools, ${multi} with more than one rule: ${differ.supports} differ in supports, ` +
      `${differ.requirements} in requirements, ${differ.type} in type, ${differ.number} in number`,
  );
  assert.ok(groups > 0);
});

test('the samples: every recorded pick, its pool and its slot', { skip: corpusSkip || savesSkip }, async (t: Diagnostic) => {
  const elements = await realElements();
  const tally = {
    records: 0,
    picks: 0,
    poolPicks: 0,
    freePicks: 0,
    uncounted: 0,
    unplaced: 0,
    levelOrderMisfits: 0,
    poolsWithRulesThatDiffer: 0,
    ownRequirementsFalse: 0,
    reversedDiffers: 0,
    reversedLevelOrderMisfits: 0,
  };
  const freeKeys = new Map<string, number>();
  const notes: string[] = [];
  for (const sample of samplesWhere(() => true)) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const { derived } = run;
    const index = run.elements;
    const ctx = requirementContextFor(derived);
    tally.uncounted += derived.uncounted.length;
    for (const pick of derived.uncounted) notes.push(`${sample.id}: uncounted ${pick.reason} ${pick.elementId} under ${pick.ruleKey}`);
    tally.unplaced += derived.problems.filter((p) => p.code === 'choice-unplaced').length;
    for (const choice of derived.character.choices) {
      tally.records++;
      tally.picks += choice.elementIds.length;
      for (const id of choice.elementIds) {
        const element = index.get(id);
        if (!element?.requirements || !derived.elementIds.has(id)) continue;
        const before = { ...ctx, hasElement: (other: string) => other !== id && ctx.hasElement(other) };
        if (!evaluateRequirements(element.requirements, before)) {
          tally.ownRequirementsFalse++;
          notes.push(`${sample.id}: own requirements false for ${element.type} ${element.name} under ${choice.ruleKey}`);
        }
      }
      const slots = poolSlots(derived, index, choice.ruleKey);
      if (!slots) {
        tally.freePicks += choice.elementIds.length;
        const shape = choice.ruleKey.replace(/^[^/]*\//, '<owner>/').replace(/\d+/g, 'N');
        freeKeys.set(shape, (freeKeys.get(shape) ?? 0) + 1);
        continue;
      }
      tally.poolPicks += choice.elementIds.length;
      if (slots.picks.some((pick) => pick.fits.length !== slots.rules.length)) tally.poolsWithRulesThatDiffer++;
      tally.levelOrderMisfits += levelOrderMisfits(slots.rules, slots.picks);
      tally.reversedLevelOrderMisfits += levelOrderMisfits(slots.rules, [...slots.picks].reverse());
    }
    // Every pool's record reversed: a matching places the same picks, so nothing derived moves.
    const reversed = {
      ...derived.character,
      choices: derived.character.choices.map((c) => ({ ...c, elementIds: [...c.elementIds].reverse() })),
    };
    const again = deriveCharacter(reversed, run.system, index);
    const ids = (s: ReadonlySet<string>) => [...s].sort().join(',');
    const unplacedIn = (d: typeof derived) => d.problems.filter((p) => p.code === 'choice-unplaced').length;
    if (
      ids(again.elementIds) !== ids(derived.elementIds) ||
      again.pendingChoices.length !== derived.pendingChoices.length ||
      unplacedIn(again) !== unplacedIn(derived) ||
      JSON.stringify(again.uncounted.map((p) => p.elementId).sort()) !== JSON.stringify(derived.uncounted.map((p) => p.elementId).sort())
    ) {
      tally.reversedDiffers++;
      notes.push(`${sample.id}: reversing the records changes the derivation`);
    }
  }
  t.diagnostic(JSON.stringify(tally));
  // What holds against any corpus: a matching places the same picks whatever order they are recorded in.
  assert.equal(tally.reversedDiffers, 0, 'reversing every record changes nothing derived');
  t.diagnostic(`keys no pool owns: ${[...freeKeys].map(([k, n]) => `${k} ×${n}`).join(', ')}`);
  for (const note of notes) t.diagnostic(note);
});

// --- what it does, through the builder, against the real corpus ------------------------------------------------------

const PHB = 'Player’s Handbook';
// What Aurora's app generates names no book once converted.
const INTERNAL = '';
const ROGUE = 'ID_WOTC_PHB_CLASS_ROGUE';
const WIZARD = 'ID_WOTC_PHB_CLASS_WIZARD';
const FIGHTER = 'ID_WOTC_PHB_CLASS_FIGHTER';

/** A fresh 5e character in the builder: a 2014 Human of the given class. */
async function start(classId: string): Promise<{ builder: CharacterBuilder; elements: ElementIndex }> {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const builder = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const human = elements.byType('Race').find((e) => e.name === 'Human' && e.source === PHB)!;
  builder.choose('build/race', [human.id]);
  builder.choose('build/class', [classId]);
  return { builder, elements };
}

/** Answer an open decision by a candidate's name and book, adding to what it holds, as the pane does. */
function answer(builder: CharacterBuilder, elements: ElementIndex, label: string, ...names: string[]): void {
  for (const name of names) {
    const decision = builder.getState().decisions.find((d) => d.label === label);
    assert.ok(decision, `"${label}" is not open`);
    const [wanted, book = PHB] = name.split('|');
    const matches = decision.candidates.filter((id) => elements.get(id)?.name === wanted && elements.get(id)?.source === book);
    assert.equal(matches.length, 1, `"${label}" offers ${matches.length} of "${name}", not one`);
    builder.choose(decision.id, [...decision.chosen, matches[0]!]);
  }
}

const offers = (builder: CharacterBuilder, elements: ElementIndex, label: string, name: string): boolean =>
  builder.getState().decisions.find((d) => d.label === label)?.candidates.some((id) => elements.get(id)?.name === name) ??
  false;

const spell = (elements: ElementIndex, name: string): string =>
  elements.byType('Spell').find((s) => s.name === name && s.source === PHB)!.id;

test('an Arcane Trickster may take its any-school spell after its enchantment one', { skip: corpusSkip }, async () => {
  // Fails under the old level-order fill: the 2014 book declares the any-school rule first, so Charm Person took it and
  // Magic Missile (evocation) was no longer offered.
  const { builder, elements } = await start(ROGUE);
  builder.setProgress(3);
  answer(builder, elements, 'Roguish Archetype', 'Arcane Trickster');
  answer(builder, elements, 'Spell (Arcane Trickster)', 'Charm Person');
  assert.ok(offers(builder, elements, 'Spell (Arcane Trickster)', 'Magic Missile'), 'the any-school slot is still open');
  answer(builder, elements, 'Spell (Arcane Trickster)', 'Magic Missile');
  assert.equal(offers(builder, elements, 'Spell (Arcane Trickster)', 'Shield'), false, 'once taken, only a restricted slot is left');
  answer(builder, elements, 'Spell (Arcane Trickster)', 'Disguise Self');
  const derived = builder.getState().derived;
  assert.deepEqual(derived.problems.filter((p) => p.code === 'choice-unplaced'), []);
  const key = derived.answeredChoices.find((c) => c.label === 'Spell (Arcane Trickster)')!.ruleKey;
  assert.ok(poolSlots(derived, elements, key)!.picks.every((pick) => pick.slot !== undefined), 'every pick has a slot it fits');
});

test('a Wizard 5 lowered to 3 keeps its level 4 improvement recorded and not counting', { skip: corpusSkip }, async (t: Diagnostic) => {
  // Fails if the improvement still counts (Intelligence stays raised) or if lowering removes it from the record.
  const { builder, elements } = await start(WIZARD);
  builder.setProgress(5);
  answer(builder, elements, 'Improvement Option (Wizard 4)', `Ability Score Improvement|${INTERNAL}`);
  answer(builder, elements, 'Ability Score Increase (Wizard 4)', `Intelligence +1|${INTERNAL}`, `Intelligence +1|${INTERNAL}`);
  const at5 = builder.getState().derived.stats.get('intelligence')?.value ?? 0;
  const recorded = JSON.stringify(builder.getState().character.choices);

  builder.setProgress(3);
  const state = builder.getState();
  assert.equal(state.derived.stats.get('intelligence')?.value, at5 - 2, 'the +2 no longer counts');
  assert.equal(JSON.stringify(state.character.choices), recorded, 'nothing left the record');
  t.diagnostic(state.uncounted.map((row) => `${row.label}: ${row.note} (${row.items.map((i) => i.name).join(', ')})`).join('; '));
  assert.deepEqual(state.uncounted.map((row) => row.reason), ['closed', 'closed']);

  builder.setProgress(5);
  assert.equal(builder.getState().derived.stats.get('intelligence')?.value, at5, 'and back at 5 it counts again');
  assert.deepEqual(builder.getState().uncounted, []);
});

test('a Fighter 5 / Wizard 3 whose Wizard levels go to the Fighter keeps the Wizard picks, not counting', { skip: corpusSkip }, async (t: Diagnostic) => {
  // Fails if the Wizard's cantrips and spellbook still count once it has no level.
  const { builder, elements } = await start(FIGHTER);
  assert.equal(builder.applySplit('levels', [{ classId: FIGHTER, levels: 5 }, { classId: WIZARD, levels: 3 }]), true);
  answer(builder, elements, 'Cantrip (Wizard)', 'Fire Bolt', 'Mage Hand', 'Prestidigitation');
  answer(builder, elements, 'Spellbook (Wizard)', 'Magic Missile', 'Shield');
  const fireBolt = spell(elements, 'Fire Bolt');
  assert.ok(builder.getState().derived.elementIds.has(fireBolt));

  assert.equal(builder.applySplit('levels', [{ classId: FIGHTER, levels: 8 }]), true);
  const state = builder.getState();
  assert.equal(state.derived.elementIds.has(fireBolt), false);
  t.diagnostic(state.uncounted.map((row) => `${row.label}: ${row.note}`).join('; '));
  const labels = state.uncounted.map((row) => row.label);
  assert.ok(labels.includes('Cantrip (Wizard)') && labels.includes('Spellbook (Wizard)'));
  assert.ok(state.uncounted.every((row) => row.reason === 'closed'));
  assert.ok(state.character.choices.some((c) => c.elementIds.includes(fireBolt)), 'still recorded');

  // Saved and reopened with no source, it derives the same: the save carries the element whose pool the picks answer,
  // so they still read as not counting. Fails if `collectCharacterContent` does not embed it.
  const system = await loadShippedSystem('dnd5e');
  const kind = resolveCharacterKind(system, 'pc');
  const saved = new MapElementIndex();
  saved.addAll(collectCharacterContent(state.character, elements, { kind }).elements);
  assert.deepEqual(summarize(deriveCharacter(state.character, system, saved, { kind })), summarize(state.derived));
});
