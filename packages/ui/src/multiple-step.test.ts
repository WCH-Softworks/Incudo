/**
 * A build step that offers a set — ADR 0032.
 *
 * No game in the fixture. "Option" is a campaign rule in 5e and the builder cannot tell: the only
 * thing that makes this step a set is `multiple: true` in its declaration, which is the ADR's whole
 * argument for a format change over a special case for a step called `options`.
 *
 * Each test was written to fail if the behaviour it names is removed, and the perturbation that
 * catches it is named beside the assertion. The real corpus is measured in
 * `tools/verify/src/campaign-options.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  MapElementIndex,
  parseRequirements,
  type Character,
  type Element,
  type GameSystem,
} from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string, extra: Partial<Element> = {}): Element {
  return {
    id,
    type,
    name: id,
    source: 'test',
    setters: {},
    rules: [],
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
    ...extra,
  };
}

function system(steps: GameSystem['characterKinds'][number]['buildSteps'] = undefined): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Option' }, { name: 'Widget' }],
    stats: [{ name: 'vigour', default: 10 }],
    characterKinds: [
      {
        id: 'pc',
        name: 'PC',
        default: true,
        progression: { kind: 'level', min: 1, max: 20, stat: 'level' },
        elementTypes: ['Option', 'Widget'],
        buildSteps: steps ?? [
          { id: 'options', label: 'Table rules', types: ['Option'], multiple: true },
          { id: 'kit', label: 'Kit', types: ['Widget'], required: true },
        ],
        sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
      },
    ],
  };
}

function corpus(): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll([
    element('OPT_A', 'Option'),
    element('OPT_B', 'Option'),
    element('OPT_C', 'Option'),
    element('W_PLAIN', 'Widget'),
    // Offered only while the character holds OPT_A — the shape the corpus writes for the Human
    // Variant and for every Tasha's "customized" alternative.
    element('W_GATED', 'Widget', { requirements: parseRequirements('OPT_A') }),
  ]);
  return index;
}

function builder(character?: Character, sys: GameSystem = system()): CharacterBuilder {
  return new CharacterBuilder(character ?? createCharacter('test', 'pc', { progress: 1 }), sys, corpus());
}

const optionsDecision = (b: CharacterBuilder) =>
  b.getState().decisions.find((d) => d.stepId === 'options');
const chosenOptions = (b: CharacterBuilder) =>
  b.getState().character.choices.find((c) => c.ruleKey === 'build/options')?.elementIds;

test('a set is open from the start, offers every candidate, and never blocks', () => {
  // Perturbation: leave `multiple` out of the compute loop and there is no decision at all.
  const b = builder();
  const decision = optionsDecision(b)!;

  assert.ok(decision, 'the set is on screen with nothing chosen');
  assert.equal(decision.multiple, true);
  assert.equal(decision.blocking, false, 'a table that uses none is the ordinary case');
  assert.deepEqual(decision.candidates.sort(), ['OPT_A', 'OPT_B', 'OPT_C']);
  assert.deepEqual(decision.chosen, []);

  const step = b.getState().steps.find((s) => s.id === 'options')!;
  assert.equal(step.complete, true, 'an optional set never holds a step open');
  assert.equal(step.required, false);
});

test('the required pick beside it is still the only thing that blocks', () => {
  const b = builder();
  const blocking = b.getState().decisions.filter((d) => d.blocking);
  assert.deepEqual(blocking.map((d) => d.stepId), ['kit']);
});

test('adding to a set sends the whole set, and each answer settles as it is recorded', () => {
  // Perturbation: have `choose` write only the new id and the second answer replaces the first.
  const b = builder();
  b.choose('build/options', [...optionsDecision(b)!.chosen, 'OPT_A']);
  b.choose('build/options', [...optionsDecision(b)!.chosen, 'OPT_C']);

  assert.deepEqual(chosenOptions(b), ['OPT_A', 'OPT_C']);
  const decision = optionsDecision(b)!;
  assert.deepEqual(decision.chosen, ['OPT_A', 'OPT_C']);
  assert.deepEqual(decision.candidates, ['OPT_B'], 'what is left to add, and no answer twice');

  const settled = b.getState().picks.find((p) => p.stepId === 'options')!;
  assert.deepEqual(settled.chosen, ['OPT_A', 'OPT_C']);
  assert.equal(settled.multiple, true, 'so a shell knows an answer here may be taken back');
  assert.deepEqual(settled.candidates.sort(), ['OPT_A', 'OPT_B', 'OPT_C'], 'including what is chosen');
});

test('taking answers back writes the rest, and the last one leaves the set empty and open', () => {
  const b = builder();
  b.choose('build/options', ['OPT_A', 'OPT_B']);

  b.choose('build/options', ['OPT_B']);
  assert.deepEqual(chosenOptions(b), ['OPT_B']);
  assert.ok(!b.getState().derived.elementIds.has('OPT_A'), 'the option stops applying');

  b.choose('build/options', []);
  assert.equal(chosenOptions(b), undefined, 'no empty record is kept');
  assert.equal(b.getState().picks.some((p) => p.stepId === 'options'), false);
  assert.deepEqual(optionsDecision(b)!.candidates.sort(), ['OPT_A', 'OPT_B', 'OPT_C']);
});

test('an option changes what the rest of the character is offered', () => {
  // The measurement ADR 0032 asks for: candidates a pick offers with the option off and on.
  // Perturbation: read the set from anywhere but the derivation's own choices and the gated widget
  // never appears.
  const b = builder();
  const kit = () => b.getState().decisions.find((d) => d.stepId === 'kit')!.candidates.sort();

  assert.deepEqual(kit(), ['W_PLAIN'], 'off: the gated one is not offered');
  b.choose('build/options', ['OPT_A']);
  assert.deepEqual(kit(), ['W_GATED', 'W_PLAIN'], 'on: it is');
  b.choose('build/options', []);
  assert.deepEqual(kit(), ['W_PLAIN'], 'and off again when the option is taken back');
});

test('an answered set can be skipped, and comes back when reconsidered', () => {
  const b = builder();
  b.choose('build/options', ['OPT_A']);
  b.decline('build/options');

  assert.equal(optionsDecision(b), undefined, 'skipped: off the open list');
  assert.deepEqual(b.getState().declined.map((d) => d.id), ['build/options']);
  assert.deepEqual(chosenOptions(b), ['OPT_A'], 'skipping is not an answer and touches nothing');

  b.reconsider('build/options');
  assert.deepEqual(optionsDecision(b)!.chosen, ['OPT_A']);
});

test('an imported save\'s options are already answered, under the key it writes them', () => {
  // `aurora-import` records a save's options under `build/options` (OPTIONS_RULE_KEY), so the
  // builder reads them without a second place to look. Perturbation: key the set anywhere else
  // and an imported character's options read as none.
  const character: Character = {
    ...createCharacter('test', 'pc', { progress: 1 }),
    choices: [{ ruleKey: 'build/options', elementIds: ['OPT_B'] }],
  };
  const b = builder(character);

  assert.deepEqual(b.getState().picks.find((p) => p.stepId === 'options')!.chosen, ['OPT_B']);
  assert.deepEqual(optionsDecision(b)!.candidates.sort(), ['OPT_A', 'OPT_C']);
});

test('nothing left to add closes the decision, and the settled set stays', () => {
  const b = builder();
  b.choose('build/options', ['OPT_A', 'OPT_B', 'OPT_C']);

  assert.equal(optionsDecision(b), undefined);
  assert.deepEqual(b.getState().picks.find((p) => p.stepId === 'options')!.chosen, ['OPT_A', 'OPT_B', 'OPT_C']);
});

test('a step without `multiple` is exactly what it was', () => {
  // Perturbation: treat every non-required typed step as a set and this step, which is neither
  // required nor multiple (equipment, spells and details in 5e), gains a decision it never had.
  const b = builder(undefined, system([
    { id: 'options', label: 'Table rules', types: ['Option'] },
    { id: 'kit', label: 'Kit', types: ['Widget'], required: true },
  ]));
  assert.equal(optionsDecision(b), undefined);
  assert.deepEqual(b.getState().picks, []);
});

test('a definition that skipped validation is not published as a pick and a set at once', () => {
  const b = builder(undefined, system([
    { id: 'options', label: 'Table rules', types: ['Option'], multiple: true, required: true },
    { id: 'kit', label: 'Kit', types: ['Widget'], required: true },
  ]));
  const forOptions = b.getState().decisions.filter((d) => d.stepId === 'options');
  assert.equal(forOptions.length, 1);
  assert.equal(forOptions[0]!.blocking, false, '`multiple` wins: a set is never blocking');
});
