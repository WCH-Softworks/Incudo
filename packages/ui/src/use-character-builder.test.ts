/**
 * The builder, tested on the claim ADR 0017 actually makes: that there is no cursor, that
 * a decision opened by a later choice arrives without navigating anywhere, and that the
 * abilities step is a real decision rather than a placeholder reporting itself finished.
 *
 * No game in the fixture. "Widget" and "vigour" would be a class and a strength score in
 * 5e, and the builder cannot tell — which is the point of ADR 0009 and ADR 0003.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  MapElementIndex,
  type Element,
  type GameSystem,
  type Rule,
} from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string, rules: Rule[] = []): Element {
  return {
    id,
    type,
    name: id,
    source: 'test',
    setters: {},
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

function system(overrides: Partial<GameSystem> = {}): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Widget' }, { name: 'Gadget' }],
    stats: [
      { name: 'vigour', default: 10 },
      { name: 'grit', default: 10 },
      { name: 'spare points', default: 0 },
    ],
    generationMethods: [
      { id: 'buy', label: 'Buy', pool: 10, costs: { '8': 0, '9': 1, '10': 2, '11': 4 } },
      { id: 'array', label: 'Array', values: [11, 9] },
      { id: 'manual', label: 'Manual' },
    ],
    characterKinds: [
      {
        id: 'pc',
        name: 'PC',
        default: true,
        progression: { kind: 'level', min: 1, max: 20, stat: 'level' },
        elementTypes: ['Widget', 'Gadget'],
        buildSteps: [
          {
            id: 'scores',
            label: 'Scores',
            types: [],
            required: true,
            budget: {
              stat: 'spare points',
              targets: ['vigour', 'grit'],
              methods: ['buy', 'array', 'manual'],
            },
          },
          { id: 'kit', label: 'Kit', types: ['Widget'], required: true },
          { id: 'extras', label: 'Extras', types: ['Gadget'], requires: ['kit'] },
        ],
        sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
      },
    ],
    ...overrides,
  };
}

function builder(index: MapElementIndex, sys: GameSystem = system()): CharacterBuilder {
  const character = createCharacter('test', 'pc', { progress: 1 });
  return new CharacterBuilder(character, sys, index);
}

function indexWith(...elements: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll(elements);
  return index;
}

// --- open decisions ---------------------------------------------------------

test('there is no current step, only a list of what is open', () => {
  const state = builder(indexWith()).getState();
  assert.equal('currentStepId' in state, false);
  assert.ok(Array.isArray(state.decisions));
});

test('a decision opened by a later choice arrives without navigating anywhere', () => {
  const index = indexWith(
    element('PICK_ME', 'Widget', [
      { kind: 'select', key: 'sub', type: 'Gadget', name: 'Subchoice', number: 1 },
    ]),
    element('GADGET', 'Gadget'),
    element('OPENER', 'Widget', [
      { kind: 'grant', key: 'g', type: 'Widget', id: 'PICK_ME' },
    ]),
  );
  const b = builder(index);
  const character = b.getState().character;
  // Seed a choice that grants the element carrying the new select.
  b.choose('build/start', ['OPENER']);

  const opened = b.getState().decisions.find((d) => d.label === 'Subchoice');
  assert.ok(opened, 'the subchoice is outstanding the moment its granter is chosen');
  assert.equal(opened.kind, 'select');
  assert.equal(opened.from, 'PICK_ME', 'and it says what opened it');
  assert.equal(opened.stepId, 'extras', 'grouped by type, without gating the answer');
  assert.equal(character.choices.length, 0, 'the original character is untouched');
});

test('a decision that a level opens is tagged with the level that opened it', () => {
  const index = indexWith(
    element('CLASSY', 'Widget', [
      { kind: 'select', key: 'asi', type: 'Gadget', name: 'Improvement', number: 1, level: 4 },
    ]),
    element('GADGET', 'Gadget'),
  );
  const b = builder(index);
  b.choose('build/start', ['CLASSY']);
  assert.equal(b.getState().decisions.some((d) => d.label === 'Improvement'), false);

  // Level-up is not a special screen: it is a change to a number.
  b.setProgress(4);
  const improvement = b.getState().decisions.find((d) => d.label === 'Improvement');
  assert.ok(improvement);
  assert.equal(improvement.openedAt, 4);
});

test('an optional select is open but not blocking', () => {
  const index = indexWith(
    element('CLASSY', 'Widget', [
      { kind: 'select', key: 'o', type: 'Gadget', name: 'Optional', number: 1, optional: true },
    ]),
    element('GADGET', 'Gadget'),
  );
  const b = builder(index);
  b.choose('build/start', ['CLASSY']);
  const optional = b.getState().decisions.find((d) => d.label === 'Optional');
  assert.equal(optional?.blocking, false);
  assert.equal(b.getState().steps.find((s) => s.id === 'extras')?.complete, true);
});

test('focus is presentation and changes nothing about what is outstanding', () => {
  const b = builder(indexWith());
  const before = b.getState().decisions.length;
  b.focus('spare points');
  assert.equal(b.getState().focusedId, 'spare points');
  assert.equal(b.getState().decisions.length, before);
});

// --- steps as groupings with dependencies -----------------------------------

test('steps come back in dependency order, not declaration order', () => {
  const b = builder(indexWith());
  assert.deepEqual(b.getState().steps.map((s) => s.id), ['scores', 'kit', 'extras']);
});

test('a step whose dependency is unmet is unavailable, and says which step would open it', () => {
  const sys = system();
  // Make "kit" itself depend on something later in the array, so it cannot be available.
  sys.characterKinds[0]!.buildSteps![1]!.requires = ['nowhere'];
  const extras = builder(indexWith(), sys).getState().steps.find((s) => s.id === 'extras');
  assert.equal(extras?.available, false);
  assert.deepEqual(extras?.blockedBy, ['kit']);
});

test('an available step with nothing outstanding is complete', () => {
  // "extras" is the only step here that is neither required nor budgeted, so it is the only
  // one that can be complete with nothing done to it.
  const extras = builder(indexWith()).getState().steps.find((s) => s.id === 'extras');
  assert.equal(extras?.available, true);
  assert.equal(extras?.complete, true);
});

// --- top-level picks --------------------------------------------------------

test('a required step with nothing picked is not complete, and says what may be picked', () => {
  // The bug the desktop shell found on its first run: "kit" is required and names a type, no
  // content declares a `<select>` for it, so it produced no decision and reported itself
  // complete from the first render. A character could not choose a class at all.
  const b = builder(indexWith(element('W1', 'Widget'), element('W2', 'Widget')));
  const kit = b.getState().steps.find((s) => s.id === 'kit');
  assert.equal(kit?.available, true);
  assert.equal(kit?.complete, false, 'nothing has been picked');

  const pick = b.getState().decisions.find((d) => d.kind === 'pick');
  assert.equal(pick?.id, 'build/kit');
  assert.equal(pick?.blocking, true);
  assert.deepEqual(pick?.candidates.sort(), ['W1', 'W2']);
});

test('answering a pick closes it, under the key the rest of the project already writes', () => {
  const b = builder(indexWith(element('W1', 'Widget')));
  b.choose('build/kit', ['W1']);

  const state = b.getState();
  assert.deepEqual(state.decisions.filter((d) => d.kind === 'pick'), []);
  assert.equal(state.steps.find((s) => s.id === 'kit')?.complete, true);
  // Seeded like any other choice, so the picked element is really in the derivation.
  assert.ok(state.derived.elementIds.has('W1'));
  // `build/<stepId>` is the convention the committed fixture save and aurora-import use.
  assert.ok(state.character.choices.some((c) => c.ruleKey === 'build/kit'));
});

test('a pick offers only elements whose own requirements are met', () => {
  // The Human Variant case: an element gated on a campaign option is not offered until the
  // option is on. Filtered through the engine's own context, not a second copy of it.
  const gated = element('W2', 'Widget');
  gated.requirements = { kind: 'has', id: 'OPTION' };

  const b = builder(indexWith(element('W1', 'Widget'), gated, element('OPTION', 'Gadget')));
  assert.deepEqual(b.getState().decisions.find((d) => d.kind === 'pick')?.candidates, ['W1']);

  b.choose('build/options', ['OPTION']);
  assert.deepEqual(
    b.getState().decisions.find((d) => d.kind === 'pick')?.candidates.sort(),
    ['W1', 'W2'],
  );
});

test('an optional step is never a pick, because declining it is an answer', () => {
  // "extras" names a type and is not required. Publishing a blocking decision for it would
  // make a character who wants no gadgets permanently unfinished.
  const b = builder(indexWith(element('G1', 'Gadget')));
  assert.deepEqual(
    b.getState().decisions.filter((d) => d.stepId === 'extras'),
    [],
  );
});

// --- the budget -------------------------------------------------------------

test('the abilities step is a real decision, not a placeholder reporting itself finished', () => {
  // The concrete bug ADR 0017 names: `"types": []` could never match a pending choice, so
  // the step was `complete: true` from the first render and the view-model had no way to
  // set a score at all.
  const b = builder(indexWith());
  const scores = b.getState().steps.find((s) => s.id === 'scores');
  assert.equal(scores?.complete, false);
  assert.deepEqual(scores?.budget?.unassigned, ['vigour', 'grit']);
});

test('setting a base stat answers the budget, and finishing it closes the decision', () => {
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'manual');
  b.setBaseStat('vigour', 11);
  assert.deepEqual(
    b.getState().steps.find((s) => s.id === 'scores')?.budget?.unassigned,
    ['grit'],
  );

  b.setBaseStat('grit', 9);
  const state = b.getState();
  assert.deepEqual(state.steps.find((s) => s.id === 'scores')?.budget?.unassigned, []);
  assert.equal(state.decisions.some((d) => d.kind === 'budget'), false);
  assert.equal(state.character.baseStats?.['vigour'], 11);
});

test('a points method spends from the declared cost table, which lives in data', () => {
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'buy');
  b.setBaseStat('vigour', 11); // costs 4
  b.setBaseStat('grit', 9); //   costs 1
  const budget = b.getState().steps.find((s) => s.id === 'scores')?.budget;
  assert.equal(budget?.pooled, true);
  assert.equal(budget?.available, 10);
  assert.equal(budget?.spent, 5);
  assert.equal(budget?.remaining, 5);
  assert.equal(
    b.getState().decisions.find((d) => d.kind === 'budget')?.remaining,
    5,
    'and the open decision reads the points still to spend',
  );
});

test('a method that hands out values is not reported as a pool, because it is not one', () => {
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'array');
  const budget = b.getState().steps.find((s) => s.id === 'scores')?.budget;
  assert.equal(budget?.pooled, false);
  assert.deepEqual(budget?.methods.map((m) => m.id), ['buy', 'array', 'manual']);
});

test('content granting points reopens the budget, with no new rule kind', () => {
  // The case the whole ADR is named after: something later hands you a point, and the
  // decision reopens where you are rather than behind a Back button.
  const index = indexWith(
    element('GENEROUS', 'Widget', [
      { kind: 'stat', key: 's', name: 'spare points', value: { kind: 'number', value: 2 } },
    ]),
  );
  const b = builder(index);
  b.setGenerationMethod('scores', 'buy');
  b.setBaseStat('vigour', 11);
  b.setBaseStat('grit', 11); // 4 + 4 of a 10-point pool
  assert.equal(b.getState().decisions.some((d) => d.kind === 'budget'), true, '2 left');

  const before = b.getState().steps.find((s) => s.id === 'scores')!.budget!;
  b.choose('build/start', ['GENEROUS']);
  const after = b.getState().steps.find((s) => s.id === 'scores')!.budget!;
  assert.equal(after.available, before.available + 2);
  assert.equal(after.remaining, before.remaining + 2);
});

test('the recorded method survives on the character, so a later edit reads it right', () => {
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'array');
  assert.equal(b.getState().character.generation?.['scores'], 'array');
  assert.equal(b.getState().steps.find((s) => s.id === 'scores')?.budget?.methodId, 'array');
});

test('a kind with no budgeted step publishes no budget decisions', () => {
  const sys = system();
  delete sys.characterKinds[0]!.buildSteps![0]!.budget;
  const state = builder(indexWith(), sys).getState();
  assert.equal(state.decisions.some((d) => d.kind === 'budget'), false);
  assert.equal(state.steps.find((s) => s.id === 'scores')?.budget, undefined);
});

test('spending the last point does not close a budget with scores still unassigned', () => {
  // The two are different questions. Point buy can exhaust the pool while two targets have
  // never been touched, and closing the decision then would strand them.
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'buy');
  b.setBaseStat('vigour', 11); // 4 of a 10-point pool; grit never set
  const budget = b.getState().steps.find((s) => s.id === 'scores')!.budget!;
  assert.equal(budget.remaining, 6);
  assert.deepEqual(budget.unassigned, ['grit']);

  const decision = b.getState().decisions.find((d) => d.kind === 'budget');
  assert.ok(decision, 'still open on both counts');

  // Now exhaust the pool exactly, leaving grit unassigned.
  const spent = system().generationMethods!.find((m) => m.id === 'buy')!;
  assert.equal(spent.costs!['11'], 4);
  b.setBaseStat('vigour', 11);
  b.setGenerationMethod('scores', 'buy');
  const stillOpen = b.getState().decisions.find((d) => d.kind === 'budget');
  assert.ok(stillOpen, 'a full pool with an untouched target is not a finished decision');
});

test('a rolled set is open on assignment alone, with no points to report', () => {
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'array');
  const decision = b.getState().decisions.find((d) => d.kind === 'budget');
  assert.equal(decision?.remaining, 2, 'two scores to place, not two points to spend');
  b.setBaseStat('vigour', 11);
  b.setBaseStat('grit', 9);
  assert.equal(b.getState().decisions.some((d) => d.kind === 'budget'), false);
});

test('a growing allowance is one decision the shell can answer, not three', () => {
  // Aurora's shape for "you know two cantrips, and one more at 4th and 10th level": three
  // same-named selects on one element. A decision is addressed by its id, and `choose`
  // replaces the whole recorded list — so three decisions sharing an id would be
  // unanswerable, quite apart from the errors it used to report.
  const index = indexWith(
    element('CASTER', 'Widget', [
      { kind: 'select', key: 'select:Cantrip', type: 'Gadget', name: 'Cantrip', number: 2, level: 1 },
      { kind: 'select', key: 'select:Cantrip', type: 'Gadget', name: 'Cantrip', number: 1, level: 4 },
    ]),
    element('A', 'Gadget'),
    element('B', 'Gadget'),
    element('C', 'Gadget'),
  );
  const build = new CharacterBuilder(
    createCharacter('test', 'pc', { progress: 4 }),
    system(),
    index,
  );
  build.choose('seed', ['CASTER']);

  const open = build.getState().decisions.filter((d) => d.id === 'CASTER/select:Cantrip');
  assert.equal(open.length, 1);
  assert.equal(open[0]!.remaining, 3);

  build.choose('CASTER/select:Cantrip', ['A', 'B', 'C']);
  const after = build.getState();
  assert.deepEqual(after.decisions.filter((d) => d.id === 'CASTER/select:Cantrip'), []);
  assert.deepEqual(after.derived.problems, []);
});

test('a filter Incudo cannot evaluate is named, not silently empty', () => {
  // The distinction that cost a wrong diagnosis: an unresolved `$(…)` matches nothing, so the
  // candidate list is empty — which is indistinguishable on screen from "you have not loaded
  // the content". A shell needs to tell the two apart, so the term is carried out by name.
  const sys = system();
  const caster = element('CASTER', 'Widget', [
    {
      kind: 'select',
      key: 'k',
      type: 'Gadget',
      name: 'Spell',
      number: 1,
      supports: { kind: 'interpolate', key: 'spellcasting:list' },
    },
  ]);

  const b = builder(indexWith(caster, element('G1', 'Gadget')), sys);
  b.choose('seed', ['CASTER']);

  const spell = b.getState().decisions.find((d) => d.label === 'Spell');
  assert.deepEqual(spell?.candidates, [], 'an unresolved term matches nothing, deliberately');
  assert.deepEqual(spell?.unresolved, ['spellcasting:list']);

  // And an ordinary filter reports nothing unresolved, so the flag means what it says.
  const plain = builder(indexWith(element('G1', 'Gadget')), sys)
    .getState()
    .decisions.find((d) => d.kind === 'pick');
  assert.deepEqual(plain?.unresolved, []);
});
