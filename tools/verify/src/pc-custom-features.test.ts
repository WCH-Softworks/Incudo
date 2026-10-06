/**
 * A player character carries features its user writes, and they only add — ADR 0094.
 *
 * Measured first, over 5e's own sheet: outside the ability scores, the worn slots and the spell slots, every number a
 * player character's sheet shows is worked out (armour class from armour, hit points from hit dice, speed, saves,
 * skills and passive Perception from content), so a written feature may add to them and set none. Its saves' and
 * skills' marks are read from proficiency stats content supplies and the kind does not declare, so none may be marked.
 * Built through the builder from loaded content and packed and reopened with no source.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BundleElementIndex,
  customFeatureStats,
  customFeatureTypes,
  deriveCharacter,
  readCharacterContainer,
  resolveCharacterKind,
  type Element,
} from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, packCharacter } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusSkip, realElements } from './real-data.ts';

test('a player character may name the numbers its sheet works out, only to add to them, and no ability score', async (t) => {
  // Fails if the kind's `sections` lets the ability scores, worn slots or spell slots in, if a stat a PC works out
  // becomes settable, or if a save or skill is offered a mark (content's proficiency would then be added to twice).
  const system = await loadShippedSystem('dnd5e');
  const pc = resolveCharacterKind(system, 'pc');
  assert.ok(pc.customFeatures, 'the 5e player character may carry written features');
  const stats = customFeatureStats(pc);
  const groups = [...new Set(stats.map((s) => s.group))];
  t.diagnostic(`${stats.length} stats in ${groups.join(', ')}`);
  const scores = new Set(pc.buildSteps.find((s) => s.id === 'abilities')!.budget!.targets.map((s) => s.toLowerCase()));
  assert.deepEqual(stats.filter((s) => scores.has(s.stat.toLowerCase())).map((s) => s.stat), [], 'no ability score');
  assert.deepEqual(stats.filter((s) => s.settable).map((s) => s.stat), [], 'nothing a PC works out may be set');
  assert.deepEqual(stats.filter((s) => s.mark).map((s) => s.stat), [], 'no save or skill may be marked');
  for (const stat of ['ac', 'hp', 'speed', 'perception', 'dexterity:save', 'perception:passive']) {
    assert.ok(stats.some((s) => s.stat === stat), `${stat} is offered`);
  }
  // Listed among the character's features, whichever type it is held as.
  const features = pc.sheet.sections.find((s) => s.id === 'features')!;
  assert.deepEqual(customFeatureTypes(pc).filter((type) => !features.types?.includes(type)), []);
  assert.equal(customFeatureTypes(pc)[0], pc.customFeatures.type);
});

test('a written feature adds to a built character, is listed with its features, and the save keeps it', { skip: corpusSkip }, async () => {
  // Fails if the feature's add lines are not its rules (armour class stays), if passive Perception does not read the
  // Perception it adds to, if it is not listed under Features & Traits, or if the save does not carry it.
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  const pick = (stepId: string, test: (e: Element) => boolean) => {
    const decision = b.getState().decisions.find((d) => d.stepId === stepId && d.kind === 'pick');
    const id = decision?.candidates.find((c) => test(elements.get(c)!));
    assert.ok(decision && id, `the ${stepId} step offers what is asked for`);
    b.choose(decision.id, [id]);
  };
  pick('race', (e) => e.name === 'Human' && e.source === 'Player’s Handbook');
  pick('class', (e) => e.name === 'Fighter' && e.source === 'Player’s Handbook');
  const before = b.getState().derived;
  const number = (derived: typeof before, stat: string) => derived.stats.get(stat)?.value ?? 0;

  const id = b.addCustomFeature('Lucky Charm')!;
  b.updateCustomFeature(id, {
    description: 'Found on the road.',
    stats: [
      { stat: 'ac', mode: 'add', value: 1 },
      { stat: 'perception', mode: 'add', value: 2 },
    ],
  });
  let state = b.getState();
  assert.equal(number(state.derived, 'ac'), number(before, 'ac') + 1);
  assert.equal(number(state.derived, 'perception'), number(before, 'perception') + 2);
  assert.equal(number(state.derived, 'perception:passive'), number(before, 'perception:passive') + 2);
  assert.deepEqual(state.derived.problems.filter((p) => p.code.startsWith('custom-feature')), []);
  assert.equal(state.character.formatVersion, 4);
  const listed = () => state.sheet.sections.find((s) => s.id === 'features')?.elements.map((e) => e.name) ?? [];
  assert.ok(listed().includes('Lucky Charm'), 'listed under Features & Traits');

  // Held as a Feat it is still listed there, and recorded as one.
  b.updateCustomFeature(id, { type: 'Feat' });
  state = b.getState();
  assert.ok(listed().includes('Lucky Charm'));
  assert.equal(state.character.formatVersion, 6);

  const { container } = readCharacterContainer(packCharacter(state.character, system, elements, { generator: 'test' }).files);
  const reopened = deriveCharacter(container!.character, system, new BundleElementIndex(container!.content.elements));
  for (const stat of ['ac', 'perception', 'perception:passive']) {
    assert.equal(number(reopened, stat), number(state.derived, stat), `${stat} after reopening with no source`);
  }
});
