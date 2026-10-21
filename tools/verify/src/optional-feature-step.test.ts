/**
 * Taking a Tasha's optional class feature through the builder, against the real corpus — ADR 0072, ADR 0129.
 *
 * A 2014 Ranger is built the way the app builds one: a race and the class chosen from what the builder offers, Natural
 * Explorer's own select answered, then Deft Explorer taken from the "Optional class features" step. It holds Deft
 * Explorer and not Natural Explorer, the step's record is a choice and the bag holds nothing, the sheet does not list the
 * option (content hides Deft Explorer's own feature too), and the saved file reopens with no source to the same derivation. Taken back, Natural
 * Explorer returns with its answer and what Deft Explorer's own selects were answered with goes.
 *
 * Built by name and id: the 2014 Ranger, and Deft Explorer by its id. What it replaces is found from content, as the
 * element it withdraws.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BundleElementIndex,
  readCharacterContainer,
  validateCharacter,
} from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, packCharacter } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import { loadSchemas, loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

const STEP = 'build/optional-features';
const DEFT = 'ID_WOTC_TCOE_ITEM_OCF_RANGER_DEFT_EXPLORER';

test('a 2014 Ranger takes Deft Explorer from the step, loses Natural Explorer, saves, and takes it back', { skip: corpusSkip }, async (t) => {
  // Fails if the converter leaves it an item (it is in the bag, or the step offers nothing), if the step is not declared
  // or not published, if it records a bag entry rather than a choice, if its grants do not reach the derivation, if the
  // sheet lists the option, if the save does
  // not reopen with no source to the same derivation, if taking back leaves Deft Explorer's answers recorded, or if it
  // loses Natural Explorer's.
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const pick = (stepId: string, test: (id: string) => boolean) => {
    const decision = b.getState().decisions.find((d) => d.stepId === stepId && d.kind === 'pick');
    const id = decision?.candidates.find(test);
    assert.ok(decision && id, `the ${stepId} step offers what is asked for`);
    b.choose(decision.id, [id]);
  };
  pick('race', (id) => elements.get(id)?.name === 'Human' && elements.get(id)?.source === 'Player’s Handbook');
  pick('class', (id) => elements.get(id)?.name === 'Ranger' && elements.get(id)?.source === 'Player’s Handbook');

  const optional = b.getState().decisions.find((d) => d.id === STEP);
  assert.ok(optional && optional.candidates.includes(DEFT), 'the step offers Deft Explorer');
  assert.equal(elements.get(DEFT)?.type, 'Optional Class Feature');
  const family = elements.byType('Optional Class Feature');
  t.diagnostic(`the step offers a 2014 Ranger ${optional.candidates.length} options; the corpus has ${family.length} of the type`);

  // Natural Explorer's own select, answered before the item is taken, as a character that had it has.
  const before = new Set(b.getState().derived.elementIds);
  b.choose(STEP, [DEFT]);
  const withdrawn = b.getState().withdrawn;
  assert.equal(withdrawn.length, 1, `taking the item withdraws one feature: ${withdrawn.map((w) => w.name).join(', ')}`);
  const natural = withdrawn[0]!;
  b.choose(STEP, []);
  const naturalSelect = b.getState().decisions.find((d) => d.from === natural.elementId && d.kind === 'select');
  assert.ok(naturalSelect?.candidates.length, `${natural.name} opens a select`);
  const answer = naturalSelect.candidates[0]!;
  b.choose(naturalSelect.id, [answer]);
  assert.ok(b.getState().derived.elementIds.has(answer));
  assert.ok(before.has(natural.elementId), `${natural.name} was held before the item`);

  // Taken.
  b.choose(STEP, [DEFT]);
  let state = b.getState();
  const deft = elements.get(DEFT)!.rules.flatMap((r) => (r.kind === 'grant' && elements.get(r.id)?.type === 'Class Feature' ? [r.id] : []))[0]!;
  assert.ok(state.derived.elementIds.has(deft), `${elements.get(deft)?.name} is held`);
  assert.equal(state.derived.elementIds.has(natural.elementId), false, `${natural.name} is not held`);
  assert.equal(state.derived.elementIds.has(answer), false, 'nor its answer');
  assert.deepEqual(state.withdrawn.map((w) => [w.name, w.grantedBy]), [[natural.name, ['Ranger']]]);
  assert.equal(state.character.inventory, undefined, 'nothing in the bag');
  assert.deepEqual(state.character.choices.find((c) => c.ruleKey === STEP)?.elementIds, [DEFT], 'a choice recorded for the step');
  assert.deepEqual(state.picks.find((p) => p.ruleKey === STEP)?.chosen, [DEFT]);
  assert.deepEqual(state.inventory?.rows ?? [], [], 'and nothing in the inventory editor');
  const listed = new Set(state.sheet.sections.flatMap((s) => s.elements.map((e) => e.elementId)));
  assert.equal(listed.has(DEFT), false, 'the sheet does not list the option');

  // What Deft Explorer opens, answered.
  const opened = state.decisions.filter((d) => d.kind === 'select' && d.candidates.length && elements.get(d.from ?? '')?.name !== undefined && !before.has(d.from!));
  for (const d of opened) b.choose(d.id, d.candidates.slice(0, d.remaining));
  const openedKeys = opened.map((d) => d.id);
  t.diagnostic(`answered ${openedKeys.length} selects the item opened: ${opened.map((d) => d.label).join('; ')}`);
  state = b.getState();

  // Saved and reopened with no source.
  assert.deepEqual(validateCharacter(state.character, await loadSchemas()).errors, []);
  const packed = packCharacter(state.character, system, elements, { generator: 'test' });
  const { container } = readCharacterContainer(packed.files);
  const reopened = new CharacterBuilder(container!.character, system, new BundleElementIndex(container!.content.elements));
  assert.deepEqual(summarize(reopened.getState().derived), summarize(state.derived), 'the save derives the same with no source');
  assert.deepEqual(reopened.getState().picks.find((p) => p.ruleKey === STEP)?.chosen, [DEFT], 'and reads it as taken');

  // Taken back.
  b.choose(STEP, []);
  state = b.getState();
  assert.ok(state.derived.elementIds.has(natural.elementId), `${natural.name} is back`);
  assert.ok(state.derived.elementIds.has(answer), 'with its answer');
  assert.equal(state.derived.elementIds.has(deft), false);
  assert.equal(state.character.choices.some((c) => c.ruleKey === STEP), false, 'no choice left for the step');
  assert.deepEqual(state.withdrawn, []);
  const left = state.character.choices.filter((c) => openedKeys.includes(c.ruleKey)).map((c) => c.ruleKey);
  assert.deepEqual(left, [], 'what it opened was answered with is not kept');
});

test('a character offered no Tasha’s is offered none of the options', { skip: corpusSkip }, async () => {
  // Fails if the step offers from everything loaded rather than the character's offered view (ADR 0049).
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const character = { ...newCharacterOfKind(system, 'pc'), publications: ['Player’s Handbook'] };
  const b = new CharacterBuilder(character, system, elements);
  const decision = b.getState().decisions.find((d) => d.id === STEP);
  assert.equal(decision?.candidates.length ?? 0, 0);
});
