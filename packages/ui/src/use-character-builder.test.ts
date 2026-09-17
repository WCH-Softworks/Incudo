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
  type Setter,
} from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';

function element(
  id: string,
  type: string,
  rules: Rule[] = [],
  setters: Record<string, Setter> = {},
): Element {
  return {
    id,
    type,
    name: id,
    source: 'test',
    setters,
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

/** A random() that walks a chosen list, so a rolled score is a known number. */
function sequence(values: number[], sides: number): () => number {
  let i = 0;
  // Past the end every die comes up 1, deliberately: a set this did not intend to produce
  // (an unwanted reroll, say) reads as a 3 rather than quietly reproducing the same numbers.
  return () => ((values[i++] ?? 1) - 1) / sides;
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

test('an unanswered pick sorts before a select that something already chosen opened', () => {
  // Background before Skill Proficiency, generalised: an unanswered Race or Background often
  // grants something outright that a class's own select would otherwise offer, and the select
  // already excludes whatever the character holds (`candidatesFor`) — so listing the pick
  // first means a skill the character will get for free is off the list before it is chosen
  // from, not a wasted duplicate discovered after the fact. Presentation only: both are open
  // and answerable regardless of order (ADR 0017), which the last assertion checks directly.
  const sys = system();
  sys.characterKinds[0]!.buildSteps!.push({
    id: 'origin',
    label: 'Origin',
    types: ['Origin'],
    required: true,
  });
  const index = indexWith(
    element('CLASSY', 'Widget', [
      { kind: 'select', key: 'sub', type: 'Gadget', name: 'Subchoice', number: 1 },
    ]),
    element('GADGET', 'Gadget'),
    element('AN_ORIGIN', 'Origin'),
  );
  const b = builder(index, sys);
  b.choose('build/kit', ['CLASSY']);

  const state = b.getState();
  const kinds = state.decisions.map((d) => d.kind);
  assert.ok(
    kinds.indexOf('pick') < kinds.indexOf('select'),
    `the still-open Origin pick should read before Subchoice, got ${kinds.join(', ')}`,
  );

  // Answering the select while the pick is still open is not refused — the order is a
  // reading order, not a gate.
  const subchoice = state.decisions.find((d) => d.kind === 'select')!;
  b.choose(subchoice.id, ['GADGET']);
  assert.ok(b.getState().derived.elementIds.has('GADGET'));
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
  // The two are different questions, and closing the decision on either alone would strand
  // the other. The scenario is no longer "a target nobody touched", because choosing a points
  // method now seeds every target at the cheapest value it prices — see the test below. It is
  // reachable by clearing one, which the editor allows and which leaves the state the
  // assertion is about: no points left, and a target holding nothing.
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'buy');
  b.setBudgetStat('scores', 'grit', undefined);
  b.setBaseStat('vigour', 11); // 4 of a 10-point pool
  const budget = b.getState().steps.find((s) => s.id === 'scores')!.budget!;
  assert.equal(budget.remaining, 6);
  assert.deepEqual(budget.unassigned, ['grit']);

  const decision = b.getState().decisions.find((d) => d.kind === 'budget');
  assert.ok(decision, 'still open on both counts');

  // Now exhaust the pool exactly, leaving grit unassigned. The fixture's table prices 11 at
  // 4, so two more of those is the whole 10-point pool bar 2 — spend it with a third.
  const spent = system().generationMethods!.find((m) => m.id === 'buy')!;
  assert.equal(spent.costs!['11'], 4);
  b.setBaseStat('vigour', 11);
  assert.equal(b.getState().steps.find((s) => s.id === 'scores')!.budget!.remaining, 6);
  const stillOpen = b.getState().decisions.find((d) => d.kind === 'budget');
  assert.ok(stillOpen, 'a pool with points left and an untouched target is not finished');
});

// --- the editor: point buy --------------------------------------------------

test('choosing a points method seeds every target at the cheapest value it prices', () => {
  // Without this the character has no score at all for a target nobody touched, and the
  // derivation reads the stat's declared default — 10 here, which is *higher* than the 8 a
  // point-buy character would have paid nothing for. A legal-looking set nobody bought.
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'buy');
  const budget = b.budgetFor('scores')!;
  assert.deepEqual(budget.rows.map((r) => r.base), [8, 8]);
  assert.equal(budget.spent, 0, 'and the cheapest value costs nothing');
  assert.deepEqual(budget.unassigned, []);
  assert.ok(
    b.getState().decisions.some((d) => d.kind === 'budget'),
    'still open, because the pool is untouched — which is what the two conditions are for',
  );
});

test('point buy will not let you spend past the pool', () => {
  // The named test of CODE-REUSE-POLICY rule 2: "point buy let me spend 28 points" has to be
  // fixable in a package, so the refusal is here rather than in a disabled button.
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'buy');
  b.setBudgetStat('scores', 'vigour', 11); // 4 of 10
  b.setBudgetStat('scores', 'grit', 11); //   8 of 10

  const before = b.budgetFor('scores')!;
  assert.equal(before.remaining, 2);
  assert.equal(before.rows[0]!.increase, undefined, 'the table prices nothing above 11');

  // A direct set of an unaffordable value writes nothing — not a clamp, not a partial spend.
  b.setBudgetStat('scores', 'vigour', 10);
  b.setBudgetStat('scores', 'vigour', 11);
  assert.equal(b.budgetFor('scores')!.spent, 8);
  assert.equal(b.getState().character.baseStats?.['vigour'], 11);
});

test('a row says where the next step lands, what it costs, and whether it is affordable', () => {
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'buy');
  // 8 → 9 → 10 → 11 at 0, 1, 2, 4: the steps are not uniform, which is why the row carries
  // the price rather than the shell assuming one.
  const at8 = b.budgetFor('scores')!.rows[0]!;
  assert.deepEqual(at8.increase, { value: 9, cost: 1, affordable: true });
  assert.equal(at8.decrease, undefined, '8 is the bottom of the table');

  b.adjustBudgetStat('scores', 'vigour', +1);
  b.adjustBudgetStat('scores', 'vigour', +1);
  const at10 = b.budgetFor('scores')!.rows[0]!;
  assert.equal(at10.base, 10);
  assert.deepEqual(at10.increase, { value: 11, cost: 2, affordable: true });
  assert.deepEqual(at10.decrease, { value: 9, refund: 1 });

  b.adjustBudgetStat('scores', 'grit', +1);
  b.adjustBudgetStat('scores', 'grit', +1);
  b.adjustBudgetStat('scores', 'grit', +1); // grit 11, costing 4; 6 of 10 spent
  const tight = b.budgetFor('scores')!;
  assert.equal(tight.remaining, 4);
  assert.deepEqual(tight.rows[0]!.increase, { value: 11, cost: 2, affordable: true });

  b.adjustBudgetStat('scores', 'vigour', +1); // 8 of 10
  assert.equal(b.budgetFor('scores')!.remaining, 2);
  // Both are at the table's top now, so there is no step up to price at all.
  assert.equal(b.budgetFor('scores')!.rows[0]!.increase, undefined);
});

test('an unaffordable step writes nothing when asked for anyway', () => {
  const sys = system();
  // A pool of 3 makes the second 11 unaffordable while the table still prices it — the state
  // the affordability flag exists for, which the 10-point fixture cannot reach.
  sys.generationMethods!.find((m) => m.id === 'buy')!.pool = 5;
  const b = builder(indexWith(), sys);
  b.setGenerationMethod('scores', 'buy');
  b.setBudgetStat('scores', 'vigour', 11); // 4 of 5
  const row = b.budgetFor('scores')!.rows[1]!;
  assert.deepEqual(row.increase, { value: 9, cost: 1, affordable: true });

  b.setBudgetStat('scores', 'grit', 11); // would cost 4 of the 1 remaining
  assert.equal(b.budgetFor('scores')!.rows[1]!.base, 8, 'refused, and nothing half-applied');
  assert.equal(b.budgetFor('scores')!.remaining, 1);

  b.adjustBudgetStat('scores', 'grit', +1); // 9 costs 1: exactly affordable
  assert.equal(b.budgetFor('scores')!.rows[1]!.base, 9);
  assert.equal(b.budgetFor('scores')!.remaining, 0);
  assert.equal(b.budgetFor('scores')!.rows[1]!.increase?.affordable, false, 'and no further');
  b.adjustBudgetStat('scores', 'grit', +1);
  assert.equal(b.budgetFor('scores')!.rows[1]!.base, 9, 'the unaffordable step did nothing');
});

// --- the editor: assignment -------------------------------------------------

test('an array publishes its values and which target holds each', () => {
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'array');
  assert.deepEqual(b.budgetFor('scores')!.pool, [{ value: 11 }, { value: 9 }]);

  b.setBudgetStat('scores', 'grit', 11);
  assert.deepEqual(b.budgetFor('scores')!.pool, [
    { value: 11, assignedTo: 'grit' },
    { value: 9 },
  ]);
});

test('assigning a value another target holds swaps them rather than duplicating it', () => {
  // Six values, six abilities, each used once. Allowing two 11s would build a set the method
  // could not produce; clearing the other target would lose a value out of the pool.
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'array');
  b.setBudgetStat('scores', 'vigour', 11);
  b.setBudgetStat('scores', 'grit', 9);

  b.setBudgetStat('scores', 'grit', 11);
  const rows = b.budgetFor('scores')!.rows;
  assert.deepEqual(rows.map((r) => [r.stat, r.base]), [['vigour', 9], ['grit', 11]]);
  assert.deepEqual(
    b.budgetFor('scores')!.pool,
    [{ value: 11, assignedTo: 'grit' }, { value: 9, assignedTo: 'vigour' }],
    'and every value is still placed exactly once',
  );
});

test('a value that is not in the pool is refused', () => {
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'array');
  b.setBudgetStat('scores', 'vigour', 15);
  assert.equal(b.budgetFor('scores')!.rows[0]!.base, undefined);
});

test('a duplicated rolled value can be placed twice, because there are two of it', () => {
  const sys = system();
  sys.generationMethods!.find((m) => m.id === 'array')!.values = [11, 11];
  const b = builder(indexWith(), sys);
  b.setGenerationMethod('scores', 'array');
  b.setBudgetStat('scores', 'vigour', 11);
  b.setBudgetStat('scores', 'grit', 11);
  assert.deepEqual(b.budgetFor('scores')!.rows.map((r) => r.base), [11, 11]);
  assert.deepEqual(b.budgetFor('scores')!.unassigned, []);
});

// --- the editor: rolling ----------------------------------------------------

test('rolling records results, and re-reading the state never rerolls', () => {
  // ADR 0019's rule, made unreachable rather than merely documented: the state a view reads
  // comes from a pure function, so a repaint cannot produce a new score.
  const sys = system();
  sys.generationMethods!.push({ id: 'roll', label: 'Roll', dice: '4d6dl1', count: 2 });
  sys.characterKinds[0]!.buildSteps![0]!.budget!.methods!.push('roll');
  const b = new CharacterBuilder(createCharacter('test', 'pc', { progress: 1 }), sys, indexWith(), {
    random: sequence([6, 6, 6, 1, 3, 3, 3, 2], 6),
  });

  b.setGenerationMethod('scores', 'roll');
  assert.deepEqual(b.budgetFor('scores')!.dice, {
    notation: '4d6dl1',
    count: 2,
    rolled: 0,
    unreadable: undefined,
  });
  assert.deepEqual(b.budgetFor('scores')!.pool, [], 'nothing to assign until dice are thrown');

  b.rollBudget('scores');
  const rolled = b.budgetFor('scores')!;
  assert.deepEqual(rolled.pool, [{ value: 18 }, { value: 9 }]);
  assert.equal(rolled.dice?.rolled, 2);
  assert.deepEqual(b.getState().character.rolls, { 'scores:roll:0': 18, 'scores:roll:1': 9 });

  for (let i = 0; i < 5; i += 1) b.getState();
  assert.deepEqual(b.getState().character.rolls, { 'scores:roll:0': 18, 'scores:roll:1': 9 });

  b.rollBudget('scores');
  assert.deepEqual(
    b.getState().character.rolls,
    { 'scores:roll:0': 18, 'scores:roll:1': 9 },
    'and rolling again fills only what is unrolled, which is nothing',
  );
});

test('clearing a rolled set discards the assignment with it', () => {
  const sys = system();
  sys.generationMethods!.push({ id: 'roll', label: 'Roll', dice: '4d6dl1', count: 2 });
  sys.characterKinds[0]!.buildSteps![0]!.budget!.methods!.push('roll');
  const b = new CharacterBuilder(createCharacter('test', 'pc', { progress: 1 }), sys, indexWith(), {
    random: sequence([6, 6, 6, 1, 3, 3, 3, 2], 6),
  });
  b.setGenerationMethod('scores', 'roll');
  b.rollBudget('scores');
  b.setBudgetStat('scores', 'vigour', 18);

  b.clearBudgetRolls('scores');
  assert.deepEqual(b.getState().character.rolls, {});
  assert.equal(
    b.getState().character.baseStats?.['vigour'],
    undefined,
    'a placement of values that no longer exist is not a score',
  );
});

test('an unreadable dice notation is reported and rolls nothing', () => {
  const sys = system();
  sys.generationMethods!.push({ id: 'roll', label: 'Roll', dice: 'four d six', count: 2 });
  sys.characterKinds[0]!.buildSteps![0]!.budget!.methods!.push('roll');
  const b = builder(indexWith(), sys);
  b.setGenerationMethod('scores', 'roll');
  assert.match(b.budgetFor('scores')!.dice!.unreadable!, /cannot read/);
  b.rollBudget('scores');
  assert.deepEqual(b.getState().character.rolls, {}, 'rather than guessing at 1d6');
});

// --- the editor: switching method -------------------------------------------

test('changing method clears the assignment and keeps the rolls', () => {
  const sys = system();
  sys.generationMethods!.push({ id: 'roll', label: 'Roll', dice: '4d6dl1', count: 2 });
  sys.characterKinds[0]!.buildSteps![0]!.budget!.methods!.push('roll');
  const b = new CharacterBuilder(createCharacter('test', 'pc', { progress: 1 }), sys, indexWith(), {
    random: sequence([6, 6, 6, 1, 3, 3, 3, 2], 6),
  });
  b.setGenerationMethod('scores', 'roll');
  b.rollBudget('scores');
  b.setBudgetStat('scores', 'vigour', 18);
  b.setBudgetStat('scores', 'grit', 9);

  b.setGenerationMethod('scores', 'buy');
  assert.deepEqual(
    b.budgetFor('scores')!.rows.map((r) => r.base),
    [8, 8],
    'a rolled 18 is not a value point buy prices, so it does not survive as one',
  );
  assert.deepEqual(
    b.getState().character.rolls,
    { 'scores:roll:0': 18, 'scores:roll:1': 9 },
    'but a recorded roll is an input and never silently disappears (ADR 0007)',
  );

  b.setGenerationMethod('scores', 'roll');
  assert.deepEqual(b.budgetFor('scores')!.pool, [{ value: 18 }, { value: 9 }], 'still waiting');
  assert.deepEqual(b.budgetFor('scores')!.unassigned, ['vigour', 'grit']);
});

test('a character with scores and no recorded method keeps them under free entry', () => {
  // Every one of the nine real Aurora saves is this: six scores and no method, because Aurora
  // records none. Found by opening one in the running app — the editor had nothing to show and
  // picking a method to see the scores was how a user would have lost them.
  const character = createCharacter('test', 'pc', { progress: 1 });
  const imported = { ...character, baseStats: { vigour: 18, grit: 17 } };
  const b = new CharacterBuilder(imported, system(), indexWith());

  const before = b.budgetFor('scores')!;
  assert.equal(before.methodId, undefined);
  assert.equal(before.mode, 'free', 'so the rows are editable rather than hidden');
  assert.deepEqual(before.rows.map((r) => r.base), [18, 17]);

  b.setGenerationMethod('scores', 'manual');
  assert.deepEqual(
    b.budgetFor('scores')!.rows.map((r) => r.base),
    [18, 17],
    'manual entry can hold anything the others produced, so nothing is thrown away',
  );
});

test('a points method starts clean even from values it happens to price', () => {
  // The mode is the rule, not the number. The fixture's table prices 9, so a leftover rolled 9
  // would survive a per-value check — and would sit inside a spend nobody made.
  const character = createCharacter('test', 'pc', { progress: 1 });
  const b = new CharacterBuilder(
    { ...character, baseStats: { vigour: 18, grit: 9 } },
    system(),
    indexWith(),
  );
  b.setGenerationMethod('scores', 'buy');
  assert.deepEqual(b.budgetFor('scores')!.rows.map((r) => r.base), [8, 8]);
  assert.equal(b.budgetFor('scores')!.spent, 0);
});

test('choosing the method already recorded changes nothing', () => {
  // Re-selecting the current method must not wipe the work: the clear is for a *change*.
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'array');
  b.setBudgetStat('scores', 'vigour', 11);
  b.setGenerationMethod('scores', 'array');
  assert.equal(b.budgetFor('scores')!.rows[0]!.base, 11);
});

// --- the editor: what a base is not -----------------------------------------

test('a contribution lands on top of the base, and the row says so separately', () => {
  // ADR 0014's whole trap, made visible: the +2 is a contribution, the 11 is the base, and
  // the editor shows both so a user cannot mistake one for the other.
  const index = indexWith(
    element('BLESSED', 'Widget', [
      { kind: 'stat', key: 's', name: 'vigour', value: { kind: 'number', value: 2 } },
    ]),
  );
  const b = builder(index);
  b.setGenerationMethod('scores', 'manual');
  b.setBudgetStat('scores', 'vigour', 11);
  b.choose('build/start', ['BLESSED']);

  const row = b.budgetFor('scores')!.rows[0]!;
  assert.equal(row.base, 11);
  assert.equal(row.total, 13);
  assert.equal(row.bonus, 2);
  assert.equal(b.getState().character.baseStats?.['vigour'], 11, 'and the base is what is stored');
  assert.equal(b.getState().character.overrides?.['vigour'], undefined, 'never an override');
});

test('manual entry is clamped to the bounds the method declares', () => {
  const sys = system();
  sys.generationMethods!.find((m) => m.id === 'manual')!.min = 1;
  sys.generationMethods!.find((m) => m.id === 'manual')!.max = 30;
  const b = builder(indexWith(), sys);
  b.setGenerationMethod('scores', 'manual');
  b.setBudgetStat('scores', 'vigour', 99);
  assert.equal(b.budgetFor('scores')!.rows[0]!.base, 30);
  b.setBudgetStat('scores', 'vigour', -5);
  assert.equal(b.budgetFor('scores')!.rows[0]!.base, 1);
});

test('a budget refuses to write a stat that is not one of its targets', () => {
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'manual');
  b.setBudgetStat('scores', 'spare points', 99);
  assert.equal(b.getState().character.baseStats?.['spare points'], undefined);
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

// --- a decision that can hold more than one element (ADR 0032) --------------

test('a multi-slot select publishes what it already holds, empty until something is chosen', () => {
  const index = indexWith(
    element('CLASSY', 'Widget', [
      { kind: 'select', key: 'skills', type: 'Gadget', name: 'Skills', number: 2 },
    ]),
    element('A', 'Gadget'),
    element('B', 'Gadget'),
  );
  const b = builder(index);
  b.choose('build/start', ['CLASSY']);

  const decision = b.getState().decisions.find((d) => d.label === 'Skills')!;
  assert.deepEqual(decision.chosen, []);
  assert.equal(decision.remaining, 2);
});

test('sending the union of what is chosen and a new pick accumulates, one at a time', () => {
  // The bug the report was named after: `choose(id, [value])` replaces the whole recorded
  // list, so a second pick silently discarded the first and the select could never close.
  // The pane's fix is to send `choose` what this test sends it — the union — not the new
  // value alone.
  const index = indexWith(
    element('CLASSY', 'Widget', [
      { kind: 'select', key: 'skills', type: 'Gadget', name: 'Skills', number: 2 },
    ]),
    element('A', 'Gadget'),
    element('B', 'Gadget'),
    element('C', 'Gadget'),
  );
  const b = builder(index);
  b.choose('build/start', ['CLASSY']);

  let decision = b.getState().decisions.find((d) => d.label === 'Skills')!;
  b.choose(decision.id, [...decision.chosen, 'A']);

  decision = b.getState().decisions.find((d) => d.label === 'Skills')!;
  assert.deepEqual(decision.chosen, ['A'], 'the first answer survives a second pick');
  assert.equal(decision.remaining, 1);
  assert.deepEqual(decision.candidates.sort(), ['B', 'C'], 'and is excluded from what is left');

  b.choose(decision.id, [...decision.chosen, 'B']);

  const state = b.getState();
  assert.equal(
    state.decisions.some((d) => d.label === 'Skills'),
    false,
    'both slots filled closes the decision',
  );
  assert.ok(state.derived.elementIds.has('A'));
  assert.ok(state.derived.elementIds.has('B'));
});

test('an answered slot settles immediately, splitting one pool across pending and picks', () => {
  // The point of the split: a wizard's first Skill Proficiency should not wait for the second
  // to become editable in "Choices already made", and the still-open decision should stop
  // showing an answer that has already moved there.
  const index = indexWith(
    element('CLASSY', 'Widget', [
      { kind: 'select', key: 'skills', type: 'Gadget', name: 'Skills', number: 2 },
    ]),
    element('A', 'Gadget'),
    element('B', 'Gadget'),
    element('C', 'Gadget'),
  );
  const b = builder(index);
  b.choose('build/start', ['CLASSY']);
  const decision = b.getState().decisions.find((d) => d.label === 'Skills')!;
  b.choose(decision.id, ['A']);

  const state = b.getState();
  const stillOpen = state.decisions.find((d) => d.label === 'Skills')!;
  assert.ok(stillOpen, 'one slot remains outstanding');
  assert.equal(stillOpen.remaining, 1);
  assert.deepEqual(stillOpen.candidates.sort(), ['B', 'C']);

  const settled = state.picks.find((p) => p.ruleKey === decision.id)!;
  assert.ok(settled, 'and the filled slot is already in "Choices already made"');
  assert.deepEqual(settled.chosen, ['A']);
  assert.deepEqual(
    settled.candidates.sort(),
    ['A', 'B', 'C'],
    'its own dropdown can keep A or swap to whatever nobody else holds',
  );
});

test('taking back one answer reopens it as a candidate', () => {
  const index = indexWith(
    element('CLASSY', 'Widget', [
      { kind: 'select', key: 'skills', type: 'Gadget', name: 'Skills', number: 2 },
    ]),
    element('A', 'Gadget'),
    element('B', 'Gadget'),
  );
  const b = builder(index);
  b.choose('build/start', ['CLASSY']);
  const first = b.getState().decisions.find((d) => d.label === 'Skills')!;
  b.choose(first.id, ['A', 'B']);
  assert.equal(b.getState().decisions.some((d) => d.label === 'Skills'), false);

  // Removing one is the remaining set without it — the write `choose` already supports,
  // not a new method.
  b.choose(first.id, ['A']);
  const reopened = b.getState().decisions.find((d) => d.label === 'Skills')!;
  assert.deepEqual(reopened.chosen, ['A']);
  assert.deepEqual(reopened.candidates, ['B']);
});

test("a pick's chosen is always empty, because an answered one leaves the open list", () => {
  const b = builder(indexWith(element('W1', 'Widget')));
  const pick = b.getState().decisions.find((d) => d.kind === 'pick')!;
  assert.deepEqual(pick.chosen, []);
});

test('a fully answered multi-select settles into picks, not gone, once every slot is filled', () => {
  // The follow-up to the bug fix above: filling the last slot used to make the whole decision
  // disappear with no way back to it, the same hole a top-level pick had before `picks`
  // existed. This is that same fix, one level down (ADR 0032).
  const index = indexWith(
    element('CLASSY', 'Widget', [
      { kind: 'select', key: 'skills', type: 'Gadget', name: 'Skills', number: 2 },
    ]),
    element('A', 'Gadget'),
    element('B', 'Gadget'),
    element('C', 'Gadget'),
  );
  const b = builder(index);
  b.choose('build/start', ['CLASSY']);
  const decision = b.getState().decisions.find((d) => d.label === 'Skills')!;
  b.choose(decision.id, ['A', 'B']);

  const state = b.getState();
  assert.equal(state.decisions.some((d) => d.label === 'Skills'), false, 'no longer outstanding');

  const settled = state.picks.find((p) => p.ruleKey === decision.id)!;
  assert.ok(settled, 'but not gone — it moved to picks');
  assert.equal(settled.label, 'Skills');
  assert.deepEqual(settled.chosen, ['A', 'B'], 'one entry per filled slot, in order');
  assert.deepEqual(
    settled.candidates.sort(),
    ['A', 'B', 'C'],
    'candidates always include what is chosen now, same contract as a top-level pick',
  );
});

test('changing one slot of a settled multi-select keeps the others', () => {
  const index = indexWith(
    element('CLASSY', 'Widget', [
      { kind: 'select', key: 'skills', type: 'Gadget', name: 'Skills', number: 2 },
    ]),
    element('A', 'Gadget'),
    element('B', 'Gadget'),
    element('C', 'Gadget'),
  );
  const b = builder(index);
  b.choose('build/start', ['CLASSY']);
  const decision = b.getState().decisions.find((d) => d.label === 'Skills')!;
  b.choose(decision.id, ['A', 'B']);

  // The write a per-slot dropdown makes: the recorded list with just that index replaced.
  const settled = b.getState().picks.find((p) => p.ruleKey === decision.id)!;
  const next = [...settled.chosen];
  next[0] = 'C';
  b.choose(settled.ruleKey, next);

  const after = b.getState().picks.find((p) => p.ruleKey === decision.id)!;
  assert.deepEqual(after.chosen, ['C', 'B'], 'the untouched slot survives the write');
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

test('"discard and roll again" discards and rolls again, in one act', () => {
  // The button said two things and did one: it cleared the set, brought the Roll button back
  // and waited for a second click. `sequence` hands out 18, 9 and then 10, 12, so a working
  // reroll lands on the second pair and a discard-only one lands on nothing at all.
  const sys = system();
  sys.generationMethods!.push({ id: 'roll', label: 'Roll', dice: '4d6dl1', count: 2 });
  sys.characterKinds[0]!.buildSteps![0]!.budget!.methods!.push('roll');
  const b = new CharacterBuilder(createCharacter('test', 'pc', { progress: 1 }), sys, indexWith(), {
    random: sequence([6, 6, 6, 1, 3, 3, 3, 2, 4, 3, 3, 1, 5, 4, 3, 2], 6),
  });

  b.setGenerationMethod('scores', 'roll');
  b.rollBudget('scores');
  b.setBudgetStat('scores', 'vigour', 18);
  assert.deepEqual(b.getState().character.rolls, { 'scores:roll:0': 18, 'scores:roll:1': 9 });

  b.rerollBudget('scores');

  const after = b.getState();
  assert.deepEqual(
    after.character.rolls,
    { 'scores:roll:0': 10, 'scores:roll:1': 12 },
    'a new set, not an empty one waiting for a second click',
  );
  assert.equal(after.steps[0]!.budget!.dice!.rolled, 2, 'and the step owes no further rolls');
  assert.deepEqual(b.budgetFor('scores')!.pool, [{ value: 10 }, { value: 12 }]);
  assert.equal(
    after.character.baseStats?.['vigour'],
    undefined,
    'the old placement goes with the values it placed',
  );
});

test('rerolling a budget with no dice changes nothing', () => {
  // Point buy has no dice, so there is nothing to discard and nothing to throw. The guard is
  // what stops a shell that shows the button under the wrong method from wiping a spend.
  const b = builder(indexWith());
  b.setGenerationMethod('scores', 'buy');
  const before = b.getState().character;
  b.rerollBudget('scores');
  assert.equal(b.getState().character, before, 'same character, untouched');
});

// --- picks you can change ---------------------------------------------------

test('an answered pick stays on screen, with what it chose and what it could choose instead', () => {
  // Answering used to delete the only control that could change the answer: the pick left
  // `decisions` (correctly — it is not outstanding) and nothing replaced it, so race, class
  // and background were one-way doors. `picks` is the settled half.
  const b = builder(indexWith(element('W1', 'Widget'), element('W2', 'Widget')));
  assert.deepEqual(b.getState().picks, [], 'nothing settled before anything is chosen');

  b.choose('build/kit', ['W1']);

  const settled = b.getState().picks;
  assert.equal(settled.length, 1);
  assert.equal(settled[0]!.ruleKey, 'build/kit');
  assert.equal(settled[0]!.stepId, 'kit');
  assert.deepEqual(settled[0]!.chosen, ['W1']);
  assert.deepEqual(
    settled[0]!.candidates.sort(),
    ['W1', 'W2'],
    'including what is chosen now, so the control can show it selected',
  );
  assert.deepEqual(
    b.getState().decisions.filter((d) => d.kind === 'pick'),
    [],
    'and it is still not outstanding',
  );
});

test('changing a settled pick replaces it rather than adding to it', () => {
  const b = builder(indexWith(element('W1', 'Widget'), element('W2', 'Widget')));
  b.choose('build/kit', ['W1']);
  b.choose('build/kit', ['W2']);

  const state = b.getState();
  assert.deepEqual(state.picks[0]!.chosen, ['W2']);
  assert.ok(state.derived.elementIds.has('W2'));
  assert.ok(!state.derived.elementIds.has('W1'), 'the old choice stops seeding the derivation');
});

test('a settled pick rebuilds its candidates against the character as it is now', () => {
  // Not remembered from when the choice was made. An element gated on something the *current*
  // character no longer has must not be offered as a replacement.
  const gated = element('W2', 'Widget');
  gated.requirements = { kind: 'has', id: 'OPTION' };
  const b = builder(indexWith(element('W1', 'Widget'), gated, element('OPTION', 'Gadget')));

  b.choose('build/options', ['OPTION']);
  b.choose('build/kit', ['W1']);
  assert.deepEqual(b.getState().picks[0]!.candidates.sort(), ['W1', 'W2']);

  b.choose('build/options', []);
  assert.deepEqual(
    b.getState().picks[0]!.candidates,
    ['W1'],
    'the option is off, so the gated widget is no longer an alternative',
  );
});

// --- hit points (levelRoll) --------------------------------------------------

function systemWithLevelRoll(): GameSystem {
  const sys = system();
  sys.characterKinds[0]!.buildSteps!.push({
    id: 'levels',
    label: 'Levels',
    types: [],
    perLevel: true,
    requires: ['kit'],
    levelRoll: { pattern: 'hp:level:{n}', dieSetter: 'hd', classType: 'Widget' },
  });
  return sys;
}

test('a step with no levelRoll publishes no hit point state', () => {
  const b = builder(indexWith());
  assert.equal(b.hitPointsFor('kit'), undefined);
});

test('the first level is always the maximum, and nothing is open before a class is chosen', () => {
  const sys = systemWithLevelRoll();
  const b = builder(indexWith(element('CLASSY', 'Widget', [], { hd: { value: 'd8' } })), sys);
  assert.equal(b.hitPointsFor('levels')?.pending.length, 0, 'no governing element yet');
  assert.equal(b.getState().decisions.some((d) => d.kind === 'hitpoints'), false);

  b.choose('build/kit', ['CLASSY']);
  const hp = b.hitPointsFor('levels')!;
  assert.equal(hp.levels.length, 1);
  assert.equal(hp.levels[0]!.isFirst, true);
  assert.equal(hp.levels[0]!.dieSides, 8);
  assert.equal(hp.levels[0]!.recorded, undefined);
  assert.equal(hp.pending.length, 1);
  assert.equal(b.getState().decisions.some((d) => d.kind === 'hitpoints'), true);

  // Asking to "roll" a first level still takes the maximum — it is not a choice.
  b.recordHitPoints('levels', 1, 'roll');
  assert.equal(b.getState().character.rolls['hp:level:1'], 8);
  assert.equal(b.getState().decisions.some((d) => d.kind === 'hitpoints'), false);
});

test('a later level offers a roll or the average, and the average is floor(sides/2)+1', () => {
  const sys = systemWithLevelRoll();
  const b = new CharacterBuilder(
    createCharacter('test', 'pc', { progress: 2 }),
    sys,
    indexWith(element('CLASSY', 'Widget', [], { hd: { value: 'd8' } })),
    { random: sequence([5], 8) },
  );
  b.choose('build/kit', ['CLASSY']);
  const level2 = b.hitPointsFor('levels')!.levels.find((l) => l.level === 2)!;
  assert.equal(level2.isFirst, false);
  assert.equal(level2.average, 5);

  b.recordHitPoints('levels', 2, 'roll');
  assert.equal(b.getState().character.rolls['hp:level:2'], 5, 'the sequenced roll');
});

test('recording an already-recorded level changes nothing', () => {
  const sys = systemWithLevelRoll();
  const b = builder(indexWith(element('CLASSY', 'Widget', [], { hd: { value: 'd8' } })), sys);
  b.choose('build/kit', ['CLASSY']);
  b.recordHitPoints('levels', 1, 'average');
  const before = b.getState().character.rolls;

  b.recordHitPoints('levels', 1, 'roll');
  assert.deepEqual(b.getState().character.rolls, before, 'no repaint or replay can reroll it');
});

test('a class with no readable die is reported and offers nothing', () => {
  const sys = systemWithLevelRoll();
  const b = builder(indexWith(element('CLASSY', 'Widget')), sys); // no hd setter at all
  b.choose('build/kit', ['CLASSY']);

  const level1 = b.hitPointsFor('levels')!.levels[0]!;
  assert.equal(level1.dieSides, undefined);
  assert.match(level1.unreadable!, /names no hit die/);
  assert.equal(b.hitPointsFor('levels')!.pending.length, 0, 'nothing to record blindly');
  assert.equal(b.getState().decisions.some((d) => d.kind === 'hitpoints'), false);

  b.recordHitPoints('levels', 1, 'average');
  assert.deepEqual(b.getState().character.rolls, {}, 'rather than guessing at a die');
});

test('advancement names which element governs each level, for a character with no single class', () => {
  const index = indexWith(
    element('FIGHTER', 'Widget', [], { hd: { value: 'd10' } }),
    element('WIZARD', 'Widget', [], { hd: { value: 'd6' } }),
  );
  const character = {
    ...createCharacter('test', 'pc', { progress: 2 }),
    advancement: [
      { at: 1, elementId: 'FIGHTER' },
      { at: 2, elementId: 'WIZARD' },
    ],
  };
  const b = new CharacterBuilder(character, systemWithLevelRoll(), index);

  const hp = b.hitPointsFor('levels')!;
  assert.equal(hp.levels[0]!.dieSides, 10, 'level 1 went to the fighter');
  assert.equal(hp.levels[1]!.dieSides, 6, 'level 2 went to the wizard');
});
