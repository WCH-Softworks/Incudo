/**
 * A build step that is a pick of one without being required — ADR 0068.
 *
 * No game in the fixture: a kind whose "Origin" is a pick that may be skipped (an NPC's creature, in 5e, which an NPC
 * built by hand has none of), beside a required "Kit" and a "Lore" step that is neither and so only heads the selects
 * content opens. Each test names the change that fails it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, type Element, type GameSystem } from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string): Element {
  return { id, type, name: id, source: 'test', setters: {}, rules: [], supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Origin' }, { name: 'Widget' }, { name: 'Lore' }],
  stats: [{ name: 'vigour', default: 10 }],
  characterKinds: [
    {
      id: 'npc',
      name: 'NPC',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Origin', 'Widget', 'Lore'],
      buildSteps: [
        { id: 'origin', label: 'Origin', types: ['Origin'], pick: true },
        { id: 'kit', label: 'Kit', types: ['Widget'], required: true },
        { id: 'lore', label: 'Lore', types: ['Lore'] },
      ],
      sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
    },
  ],
};

const index = new MapElementIndex();
index.addAll([element('HILLS', 'Origin'), element('COAST', 'Origin'), element('GEAR', 'Widget'), element('TALE', 'Lore')]);

const fresh = () => new CharacterBuilder(createCharacter('test', 'npc'), system, index);
const decision = (b: CharacterBuilder, stepId: string) => b.getState().decisions.find((d) => d.stepId === stepId);
const step = (b: CharacterBuilder, stepId: string) => b.getState().steps.find((s) => s.id === stepId)!;

test('a pick that is not required is offered as a pick, and does not block', () => {
  // Fails if topLevelPickSteps ignores `pick` (no Origin decision at all), or if the decision is published blocking.
  const b = fresh();
  const origin = decision(b, 'origin');
  assert.equal(origin?.kind, 'pick');
  assert.equal(origin?.blocking, false);
  assert.deepEqual([...origin!.candidates].sort(), ['COAST', 'HILLS']);
  assert.equal(decision(b, 'kit')?.blocking, true, 'a required pick still blocks');
  // A step that is neither required, a set nor a pick offers nothing of its own, as before.
  assert.equal(decision(b, 'lore'), undefined);
});

test('it can be skipped, and then its step is complete; reconsidered, it is offered again', () => {
  // Fails if the decision is blocking (decline refuses it and the step stays open).
  const b = fresh();
  b.decline('build/origin');
  assert.equal(decision(b, 'origin'), undefined);
  assert.equal(step(b, 'origin').complete, true);
  assert.deepEqual(b.getState().declined.map((d) => d.id), ['build/origin']);
  b.reconsider('build/origin');
  assert.equal(decision(b, 'origin')?.kind, 'pick');
});

test('answered, it is a settled pick like any other, and can be changed', () => {
  // Fails if topLevelPickSteps ignores `pick`: the answer is recorded and never published as a settled pick.
  const b = fresh();
  b.choose('build/origin', ['HILLS']);
  assert.equal(decision(b, 'origin'), undefined);
  const settled = b.getState().picks.find((p) => p.stepId === 'origin');
  assert.deepEqual(settled?.chosen, ['HILLS']);
  b.choose(settled!.ruleKey, ['COAST']);
  assert.ok(b.getState().derived.elementIds.has('COAST'));
  assert.equal(b.getState().derived.elementIds.has('HILLS'), false);
});
