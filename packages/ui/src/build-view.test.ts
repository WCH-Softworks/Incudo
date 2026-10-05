/**
 * The build screen's shared readings (`build-view.ts`). Each case names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { StatDef } from '@incudo/core';

import {
  classOptionGroups,
  currentSplit,
  movedSplitRow,
  progressPrintedHint,
  progressResetLabel,
  splitDraftView,
  withAddedSplitRow,
  withSplitRow,
  withoutSplitRow,
  decisionTags,
  preparedItemText,
  settledSteps,
  shortfallText,
  slotOptions,
  stepStatus,
  unavailableReason,
  withSlot,
  withoutSlot,
} from './build-view.ts';
import type { ClassOption } from './multiclass.ts';
import type { BuilderStep, OpenDecision, SettledPick } from './use-character-builder.ts';

const pick = (chosen: string[], candidates: string[], repeatable: string[] = []): SettledPick => ({
  ruleKey: 'X/select:Language',
  stepId: 'languages',
  label: 'Language',
  chosen,
  candidates,
  repeatable,
});

test('a slot is offered its own answer and what no other slot holds', () => {
  // Perturbation: dropping `candidate === own` takes a slot's own answer out of its list.
  const two = pick(['A', 'B'], ['A', 'B', 'C']);
  assert.deepEqual(slotOptions(two, 0), ['A', 'C']);
  assert.deepEqual(slotOptions(two, 1), ['B', 'C']);
});

test('what may repeat is offered to every slot', () => {
  // Perturbation: ignoring `repeatable` leaves Constitution out of the second slot, and a +2 cannot be made.
  const asi = pick(['CON', 'STR'], ['CON', 'STR', 'DEX'], ['CON', 'STR', 'DEX']);
  assert.deepEqual(slotOptions(asi, 1), ['CON', 'STR', 'DEX']);
});

test('changing a slot keeps the others; taking one back removes only it', () => {
  // Perturbation: `withSlot` returning `[next]` loses every other slot's answer, the bug ADR 0032 fixed.
  const three = pick(['A', 'B', 'C'], ['A', 'B', 'C', 'D']);
  assert.deepEqual(withSlot(three, 1, 'D'), ['A', 'D', 'C']);
  assert.deepEqual(withoutSlot(three, 0), ['B', 'C']);
});

const step = (patch: Partial<BuilderStep>): BuilderStep => ({
  id: 'abilities',
  label: 'Ability Scores',
  required: true,
  available: true,
  blockedBy: [],
  openCount: 0,
  complete: true,
  ...patch,
});

const decision = (patch: Partial<OpenDecision>): OpenDecision => ({
  id: 'abilities',
  kind: 'budget',
  label: 'Ability Scores',
  stepId: 'abilities',
  blocking: true,
  remaining: 0,
  candidates: [],
  chosen: [],
  unresolved: [],
  ...patch,
});

test('a budget is settled once nothing is outstanding on it', () => {
  // Perturbation: settling a budget whatever `decisions` holds shows its editor twice, open and settled.
  const budget = { rows: [] } as unknown as NonNullable<BuilderStep['budget']>;
  const steps = [step({ budget })];
  assert.equal(settledSteps({ steps, decisions: [decision({})] }).length, 0);
  assert.equal(settledSteps({ steps, decisions: [] }).length, 1);
});

test('hit points are settled only once a level is recorded and none is outstanding', () => {
  // Perturbation: dropping the `levels.length > 0` term lists an empty hit point editor for a level 0 character.
  const none = step({ id: 'hp', hitPoints: { levels: [] } as unknown as NonNullable<BuilderStep['hitPoints']> });
  const some = step({ id: 'hp', hitPoints: { levels: [{ level: 1 }] } as unknown as NonNullable<BuilderStep['hitPoints']> });
  assert.equal(settledSteps({ steps: [none], decisions: [] }).length, 0);
  assert.equal(settledSteps({ steps: [some], decisions: [decision({ kind: 'hitpoints', stepId: 'hp' })] }).length, 0);
  assert.equal(settledSteps({ steps: [some], decisions: [] }).length, 1);
});

test("a decision's tags: optional, what is left, where it opened; a set has no count", () => {
  // Perturbation: counting a set ("0 left") says the opposite of a set, which may take any number.
  assert.deepEqual(decisionTags(decision({ kind: 'select', blocking: false, remaining: 2, openedAt: 4 })), ['optional', '2 left', 'opened at 4']);
  assert.deepEqual(decisionTags(decision({ kind: 'pick', multiple: true, blocking: false })), ['optional']);
});

test("a step's status names what holds it shut", () => {
  // Perturbation: an unavailable step reading "complete" was the first bug the desktop shell found.
  assert.equal(stepStatus(step({ available: false, blockedBy: ['class'] }), (id) => (id === 'class' ? 'Class' : id)), 'needs Class');
  assert.equal(stepStatus(step({ complete: false, openCount: 2 })), '2 open');
  assert.equal(stepStatus(step({})), 'complete');
});

const stats: StatDef[] = [{ name: 'str', derive: { kind: 'ref', stat: 'strength' } } as StatDef, { name: 'strength', label: 'Strength' } as StatDef];

test("a class's shortfall and reason, in the system's own words", () => {
  // Perturbation: `shortfallText` printing the stat's name reads "str 13", which the corpus writes and no player does.
  assert.equal(shortfallText([[{ stat: 'str', needs: 13, has: 10 }]], stats), 'Strength 13 (you have 10)');
  const option = (patch: Partial<ClassOption>): ClassOption => ({ id: 'ID_C', taken: false, eligible: false, ...patch });
  assert.equal(unavailableReason(option({ eligible: true }), String), undefined);
  assert.equal(unavailableReason(option({ unavailable: 'excluded', excludedBy: 'ID_OTHER' }), () => 'Other'), 'cannot be combined with Other');
  assert.equal(unavailableReason(option({ prerequisite: 'Strength 13' }), String), 'needs Strength 13');
  const groups = classOptionGroups([option({ id: 'a', taken: true, eligible: true }), option({ id: 'b', eligible: true }), option({ id: 'c' })]);
  assert.deepEqual([groups.taken, groups.available, groups.unavailable].map((g) => g.map((o) => o.id)), [['a'], ['b'], ['c']]);
});

test('a prepared item reads with its note', () => {
  assert.equal(preparedItemText({ id: 'S', name: 'Shield', note: 'Level 1' }), 'Shield (Level 1)');
  assert.equal(preparedItemText({ id: 'S', name: 'Shield' }), 'Shield');
});

const F = { classId: 'FIGHTER', levels: 12 };
const W = { classId: 'WIZARD', levels: 5 };

test('a split edit starts from the classes held, in the order taken', () => {
  // Perturbation: reading `levels` (one row per level) instead of `classes` gives seventeen rows.
  assert.deepEqual(currentSplit({ classes: [{ id: 'FIGHTER', levels: 12 }, { id: 'WIZARD', levels: 5 }] }), [F, W]);
});

test("a split's total, and Apply only for whole counts adding up to no more than the most", () => {
  // Perturbation: dropping the `tooHigh` term lets a level 21 split be applied; dropping `Number.isInteger` lets 2.5 be.
  assert.deepEqual(splitDraftView({ maxLevel: 20 }, [F, W]), { rows: [F, W], total: 17, totalText: 'Character level 17', valid: true });
  const over = splitDraftView({ maxLevel: 20 }, [F, { ...W, levels: 9 }]);
  assert.equal(over.totalText, 'Character level 21 — the most is 20');
  assert.equal(over.valid, false);
  assert.equal(splitDraftView({ maxLevel: 20 }, [F, { ...W, levels: 2.5 }]).valid, false);
  assert.equal(splitDraftView({ maxLevel: 20 }, [F, { ...W, levels: 0 }]).valid, false);
  // A field emptied mid-edit is NaN: counted as nothing, and not applicable.
  const empty = splitDraftView({ maxLevel: 20 }, [F, { ...W, levels: Number.NaN }]);
  assert.equal(empty.total, 12);
  assert.equal(empty.valid, false);
  assert.equal(splitDraftView({ maxLevel: 20 }, []).valid, false, 'no rows is no split');
  assert.equal(splitDraftView({ maxLevel: undefined }, [{ ...F, levels: 40 }]).valid, true, 'no most, no cap');
});

test('a split row changes, moves, goes and comes in place', () => {
  // Perturbation: `movedSplitRow` swapping past the end leaves an undefined row; `withoutSplitRow` emptying the list
  // offers a split of nothing; `withAddedSplitRow` ignoring the last row starts every new row at the first class.
  assert.deepEqual(withSplitRow([F, W], 1, { levels: 3 }), [F, { ...W, levels: 3 }]);
  assert.deepEqual(movedSplitRow([F, W], 1, -1), [W, F]);
  assert.deepEqual(movedSplitRow([F, W], 1, 1), [F, W]);
  assert.deepEqual(movedSplitRow([F, W], 0, -1), [F, W]);
  assert.deepEqual(withoutSplitRow([F, W], 0), [W]);
  assert.deepEqual(withoutSplitRow([W], 0), [W]);
  assert.deepEqual(withAddedSplitRow([F, W], { firstClassId: 'FIGHTER' }), [F, W, { classId: 'WIZARD', levels: 1 }]);
  assert.deepEqual(withAddedSplitRow([], { firstClassId: 'FIGHTER' }), [{ classId: 'FIGHTER', levels: 1 }]);
});

test("the link back to a printed progression shows only while a typed value differs from it", () => {
  // Perturbation: dropping the `recorded` term shows the link on an untouched creature; dropping the equality offers
  // to "go back" to the number already shown.
  const nameOf = (id: string): string => (id === 'WOLF' ? 'Wolf' : id);
  assert.equal(progressResetLabel({ recorded: true, printed: 0.25, printedBy: 'WOLF', value: 2 }, nameOf), "Use Wolf's (1/4)");
  assert.equal(progressResetLabel({ recorded: false, printed: 0.25, printedBy: 'WOLF', value: 0.25 }, nameOf), undefined);
  assert.equal(progressResetLabel({ recorded: true, printed: 0.25, printedBy: 'WOLF', value: 0.25 }, nameOf), undefined);
  assert.equal(progressResetLabel({ recorded: true, value: 3 }, nameOf), undefined, 'nothing printed');
  assert.equal(progressResetLabel({ recorded: true, printed: 1, value: 3 }, nameOf), 'Use the printed one (1)');
  // Perturbation: ignoring `printable` puts the sentence under a level, which no element prints.
  assert.equal(progressPrintedHint({ printable: false, printedBy: 'WOLF' }, nameOf), undefined);
  assert.match(progressPrintedHint({ printable: true, printedBy: 'WOLF' }, nameOf)!, /^A faded number is Wolf's own, .*Clear what you typed/);
  assert.match(progressPrintedHint({ printable: true }, nameOf)!, /what the character holds prints/);
});
