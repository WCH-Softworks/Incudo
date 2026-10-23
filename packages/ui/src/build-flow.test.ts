/**
 * The order and flow of Build's decisions — ADR 0123.
 *
 * No game in the fixture: "Kit" is a class with a hit die and a choice at level 3, "Trait" an optional pick (an
 * alignment), "Option" a campaign option asked when a character is started, and "Extra" what 5e's additional features
 * are, offered only while the option "OPT_EXTRA" is held. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, type Element, type GameSystem, type Rule } from '@incudo/core';

import {
  arrivedDecision,
  decisionGroups,
  decisionKey,
  optionalDecisionsLabel,
  startOptionsSummary,
} from './build-view.ts';
import { newCharacterOfKind } from './character-kinds.ts';
import { firstLevelRecord, type HitPointState } from './hitpoints.ts';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string, rules: Rule[] = [], hd?: string): Element {
  return {
    id,
    type,
    name: id.toLowerCase(),
    source: 'test',
    setters: hd ? { hd: { value: hd } } : {},
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

function system(): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Option' }, { name: 'Kit' }, { name: 'Trait' }, { name: 'Extra' }, { name: 'Path' }],
    stats: [
      { name: 'vigour', default: 10 },
      { name: 'grit', default: 10 },
      { name: 'spare points', default: 0 },
    ],
    generationMethods: [
      { id: 'array', label: 'Array', values: [11, 9] },
      { id: 'manual', label: 'Manual' },
    ],
    characterKinds: [
      {
        id: 'pc',
        name: 'PC',
        default: true,
        progression: { kind: 'level', min: 1, max: 20, stat: 'level' },
        elementTypes: ['Option', 'Kit', 'Trait', 'Extra', 'Path'],
        buildSteps: [
          {
            id: 'scores',
            label: 'Scores',
            types: [],
            required: true,
            budget: { stat: 'spare points', targets: ['vigour', 'grit'], methods: ['array', 'manual'] },
          },
          { id: 'options', label: 'Table rules', types: ['Option'], multiple: true, askedAtStart: true, initial: ['OPT_FEATS'] },
          { id: 'kit', label: 'Kit', types: ['Kit'], required: true },
          {
            id: 'levels',
            label: 'Levels',
            types: ['Path'],
            perLevel: true,
            requires: ['kit'],
            levelRoll: { pattern: 'hp:level:{n}', dieSetter: 'hd', classType: 'Kit' },
          },
          { id: 'extras', label: 'Extras', types: ['Extra'], multiple: true, offeredWhen: 'OPT_EXTRA' },
          { id: 'trait', label: 'Trait', types: ['Trait'], pick: true },
        ],
        sheet: { sections: [] },
      },
    ],
  };
}

function index(): MapElementIndex {
  const elements = new MapElementIndex();
  elements.addAll([
    element('OPT_FEATS', 'Option'),
    element('OPT_EXTRA', 'Option'),
    element('KIT_A', 'Kit', [{ kind: 'select', key: 'path', type: 'Path', name: 'Path', number: 1, level: 3 }], 'd8'),
    element('KIT_B', 'Kit', [], 'd10'),
    element('PATH_A', 'Path'),
    element('TRAIT_A', 'Trait'),
    element('EXTRA_A', 'Extra'),
  ]);
  return elements;
}

function builder(progress = 1): CharacterBuilder {
  const sys = system();
  const character = { ...newCharacterOfKind(sys, 'pc'), progress };
  return new CharacterBuilder(character, sys, index());
}

const labels = (b: CharacterBuilder) => b.getState().decisions.map((d) => d.label);

// --- 1. required first ------------------------------------------------------------------------------------------------

test('what must be answered comes before what may be, at whatever level it opens', () => {
  // Fails if the sort puts the level first again (`Number(!a.blocking) - Number(!b.blocking)` taken out): the optional
  // level 1 Trait would sit above level 2's hit points and level 3's Path.
  const b = builder(3);
  b.choose('build/kit', ['KIT_A']);
  assert.deepEqual(labels(b), ['Scores', 'Hit Points, level 2', 'Path', 'Hit Points, level 3', 'Trait']);
  const groups = decisionGroups(b.getState().decisions);
  assert.deepEqual(groups.required.map((d) => d.label), ['Scores', 'Hit Points, level 2', 'Path', 'Hit Points, level 3']);
  assert.deepEqual(groups.optional.map((d) => d.label), ['Trait']);
  assert.equal(optionalDecisionsLabel(groups.optional.length), 'Optional (1)');
});

test('a step listed with the required decisions sorts among them, is shown there and is not counted as owed', () => {
  // ADR 0127. Fails if `listedWithRequired` is ignored in the sort (Trait drops below the hit points and Path, under
  // "Optional", where a choice that changes the class's own comes after them), or if `decisionGroups` counts it as owed.
  const sys = system();
  const kind = sys.characterKinds[0]!;
  kind.buildSteps = kind.buildSteps!.map((step) => (step.id === 'trait' ? { ...step, listedWithRequired: true, priority: 2.5 } : step));
  const b = new CharacterBuilder({ ...newCharacterOfKind(sys, 'pc'), progress: 3 }, sys, index());
  b.choose('build/kit', ['KIT_A']);
  assert.deepEqual(labels(b), ['Scores', 'Trait', 'Hit Points, level 2', 'Path', 'Hit Points, level 3']);
  const trait = b.getState().decisions.find((d) => d.label === 'Trait')!;
  assert.equal(trait.blocking, false, 'still skippable');
  assert.equal(trait.withRequired, true);
  const groups = decisionGroups(b.getState().decisions);
  assert.deepEqual(groups.required.map((d) => d.label), ['Scores', 'Trait', 'Hit Points, level 2', 'Path', 'Hit Points, level 3']);
  assert.deepEqual(groups.optional, []);
  assert.equal(groups.owed, 4);
});

// --- 2. campaign options asked at the start ----------------------------------------------------------------------------

test('a set asked at the start opens no decision and is listed with its answer, even none', () => {
  // Fails if `askedAtStart` is ignored (Table rules is an open decision again), or if a set answered with nothing loses
  // its line (it would have no way back from Build).
  const b = builder();
  assert.equal(b.getState().decisions.some((d) => d.stepId === 'options'), false);
  assert.equal(b.getState().picks.some((p) => p.stepId === 'options'), false, 'its own line, not a pick with Remove');
  assert.deepEqual(b.getState().startOptions, [
    { stepId: 'options', label: 'Table rules', candidates: ['OPT_FEATS', 'OPT_EXTRA'], chosen: ['OPT_FEATS'] },
  ]);

  b.chooseAtStart('options', []);
  assert.deepEqual(b.getState().startOptions[0]!.chosen, []);
  assert.equal(startOptionsSummary([], (id) => id), 'None');
  assert.equal(b.getState().steps.find((s) => s.id === 'options')?.taken, true, 'answered, by none');
  assert.equal(b.getState().decisions.some((d) => d.stepId === 'options'), false, 'none is an answer');

  b.chooseAtStart('options', ['OPT_EXTRA', 'OPT_FEATS', 'OPT_EXTRA']);
  assert.deepEqual(b.getState().startOptions[0]!.chosen, ['OPT_EXTRA', 'OPT_FEATS']);
  assert.equal(startOptionsSummary(['OPT_EXTRA', 'OPT_FEATS'], (id) => id.toLowerCase()), 'opt_extra, opt_feats');
  // Fails if an element nothing loaded has is named by its id (the summary read "ID_INTERNAL_OPTION_ALLOW_FEATS" while
  // no source had loaded).
  assert.equal(startOptionsSummary(['OPT_EXTRA', 'OPT_FEATS'], () => undefined), '2 not in a loaded source');
  assert.equal(
    startOptionsSummary(['OPT_EXTRA', 'OPT_FEATS'], (id) => (id === 'OPT_FEATS' ? 'Feats' : undefined)),
    'Feats and 1 more not in a loaded source',
  );

  // Only a step asked at the start is answered this way.
  b.chooseAtStart('extras', ['EXTRA_A']);
  assert.equal(b.getState().character.choices.some((c) => c.ruleKey === 'build/extras'), false);
});

test('a step offered only with an option opens nothing until the character holds it, and keeps what it took', () => {
  // Fails if `offeredWhen` is ignored (Extras is offered to every character), or if switching the option off takes away
  // what was taken.
  const b = builder();
  const extras = () => b.getState().decisions.some((d) => d.stepId === 'extras');
  const listed = () => b.getState().steps.some((s) => s.id === 'extras');
  assert.equal(extras(), false);
  assert.equal(listed(), false);
  assert.equal(b.getState().character.declinedDecisions, undefined, 'not offered is not declined');

  b.chooseAtStart('options', ['OPT_FEATS', 'OPT_EXTRA']);
  assert.equal(extras(), true);
  assert.equal(listed(), true);

  b.choose('build/extras', ['EXTRA_A']);
  b.chooseAtStart('options', ['OPT_FEATS']);
  assert.equal(extras(), false);
  assert.ok(b.getState().picks.some((p) => p.stepId === 'extras' && p.chosen.includes('EXTRA_A')), 'still settled');
  assert.equal(listed(), true);
});

test('the first level is recorded as the maximum, and follows a change of the first class', () => {
  // Fails if the first level is a decision again, or if changing the class leaves the old die's maximum (8 on a d10).
  const b = builder(2);
  b.choose('build/kit', ['KIT_A']);
  assert.equal(b.getState().character.rolls['hp:level:1'], 8);
  assert.deepEqual(
    b.getState().decisions.filter((d) => d.kind === 'hitpoints').map((d) => d.hitPointLevel),
    [2],
  );
  b.choose('build/kit', ['KIT_B']);
  assert.equal(b.getState().character.rolls['hp:level:1'], 10);
});

test('a first level holding something other than the old maximum is left alone', () => {
  // Fails if any recorded value is overwritten: a save may hold a 10 on a d8, and only a click may change it.
  const level = (recorded: number | undefined, classElementId: string, dieSides: number) => ({
    level: 1,
    classElementId,
    dieSides,
    isFirst: true,
    ...(recorded !== undefined ? { recorded } : {}),
  });
  const state = (first: ReturnType<typeof level>): HitPointState => ({
    pattern: 'hp:level:{n}',
    levels: [first],
    pending: [],
    reviewing: false,
    reviewingLevels: [],
    fixed: false,
  });
  assert.deepEqual(firstLevelRecord(undefined, state(level(undefined, 'A', 8))), { key: 'hp:level:1', value: 8 });
  assert.equal(firstLevelRecord(undefined, state(level(5, 'A', 8))), undefined);
  assert.deepEqual(firstLevelRecord(state(level(8, 'A', 8)), state(level(8, 'B', 10))), { key: 'hp:level:1', value: 10 });
  assert.equal(firstLevelRecord(state(level(5, 'A', 8)), state(level(5, 'B', 10))), undefined);
  assert.equal(firstLevelRecord(undefined, { ...state(level(undefined, 'A', 8)), fixed: true }), undefined, 'fixed reads its own');
});

test('a character opened with no first level recorded gets it on its first read', () => {
  // Fails if the record is made only on a change: the card would show for a file saved before.
  const sys = system();
  const character = { ...createCharacter('test', 'pc', { progress: 1 }), choices: [{ ruleKey: 'build/kit', elementIds: ['KIT_A'] }] };
  const b = new CharacterBuilder(character, sys, index());
  assert.equal(b.getState().decisions.some((d) => d.kind === 'hitpoints'), false);
  assert.equal(b.getState().character.rolls['hp:level:1'], 8);
});

// --- 5. the scores card waits for its Done -----------------------------------------------------------------------------

test('the scores card stays open after the last score until its Done', () => {
  // Fails if setting the last score closes the card (`reviewBudget` not called), or if Done does not close it.
  const b = builder();
  b.setGenerationMethod('scores', 'array');
  b.setBudgetStat('scores', 'vigour', 11);
  b.setBudgetStat('scores', 'grit', 9);
  const card = () => b.getState().decisions.find((d) => d.kind === 'budget');
  assert.equal(card()?.remaining, 0);
  assert.equal(card()?.blocking, true);
  b.confirmBudget('scores');
  assert.equal(card(), undefined);

  // Changed again from where settled values are edited, it does not come back among the open decisions.
  b.setBudgetStat('scores', 'vigour', 9);
  assert.equal(card(), undefined);
});

// --- 6. the card that has just taken the top ---------------------------------------------------------------------------

test('a decision that takes the top is named, and the same top is not', () => {
  // Fails if `arrivedDecision` names the top whatever it was (every repaint would animate), or never names it.
  const b = builder();
  b.setGenerationMethod('scores', 'array');
  b.setBudgetStat('scores', 'vigour', 11);
  b.setBudgetStat('scores', 'grit', 9);
  const before = decisionKey(b.getState().decisions[0]!);
  assert.equal(before, 'budget:spare points');
  assert.equal(arrivedDecision(before, b.getState().decisions), undefined, 'still the scores');
  b.confirmBudget('scores');
  assert.equal(arrivedDecision(before, b.getState().decisions), 'pick:build/kit');
  assert.equal(arrivedDecision(undefined, b.getState().decisions), undefined, 'nothing was on screen before');
  assert.equal(arrivedDecision(before, []), undefined);
});
