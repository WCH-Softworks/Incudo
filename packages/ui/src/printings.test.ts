/**
 * One thing printed in two books, as a build screen offers it — ADR 0125.
 *
 * No game in the fixture: a hero picks a Calling, which opens a pool of two Knacks (a type identified by name). "Spark"
 * is printed in the Old Book and the New Book; the New Book prints "Echo" twice on purpose. Quirks are not identified by
 * name, and the New Book prints two "Agile"s, one given by the Deer and one by the Rat. Each test names the change that
 * fails it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  deriveCharacter,
  MapElementIndex,
  type Element,
  type GameSystem,
  type Rule,
} from '@incudo/core';

import { additionOptionLabel, additionOptions } from './additions.ts';
import { slotOptions } from './build-view.ts';
import { candidateGiver, candidateLabel } from './candidate-label.ts';
import { candidateOverlaps } from './candidate-overlaps.ts';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string, name: string, source: string, rules: Rule[] = [], setters: Element['setters'] = {}): Element {
  return { id, type, name, source, setters, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const select = (name: string, type: string, number: number): Rule =>
  ({ kind: 'select', key: `select:${name}`, name, type, number }) as Rule;
const grant = (id: string, type: string): Rule => ({ kind: 'grant', key: `grant:${id}`, id, type }) as Rule;

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [
    { name: 'Calling' },
    { name: 'Knack', identifiedByName: true },
    { name: 'Boon' },
    { name: 'Quirk' },
    { name: 'Beast' },
  ],
  stats: [{ name: 'level', label: 'Level', default: 1 }],
  characterKinds: [
    {
      id: 'hero',
      name: 'Hero',
      default: true,
      progression: { kind: 'level', stat: 'level', min: 1, max: 10 },
      elementTypes: ['Calling', 'Knack', 'Boon', 'Quirk', 'Beast'],
      additions: { types: ['Knack'] },
      candidateOverlaps: { types: ['Knack'] },
      buildSteps: [{ id: 'calling', label: 'Calling', types: ['Calling'], required: true }],
      sheet: { sections: [] },
    },
  ],
};

const index = new MapElementIndex();
index.addAll([
  element('MYSTIC', 'Calling', 'Mystic', 'Old Book', [select('Knack', 'Knack', 2), select('Boon', 'Boon', 1)]),
  element('GIFTED', 'Calling', 'Gifted', 'Old Book', [select('Knack', 'Knack', 2), grant('SPARK_OLD', 'Knack')]),
  element('SPARK_OLD', 'Knack', 'Spark', 'Old Book'),
  element('SPARK_NEW', 'Knack', 'Spark', 'New Book'),
  element('ECHO_1', 'Knack', 'Echo', 'New Book'),
  element('ECHO_2', 'Knack', 'Echo', 'New Book'),
  element('GLOW', 'Knack', 'Glow', 'Old Book'),
  element('NEW_SPARK_BOON', 'Boon', 'Boon of Spark', 'New Book', [grant('SPARK_NEW', 'Knack')]),
  element('DEER', 'Beast', 'Deer', 'New Book', [], { traits: { value: 'AGILE_DEER' } }),
  element('RAT', 'Beast', 'Rat', 'New Book', [grant('AGILE_RAT', 'Quirk')]),
  element('AGILE_DEER', 'Quirk', 'Agile', 'New Book'),
  element('AGILE_RAT', 'Quirk', 'Agile', 'New Book'),
  element('LONE', 'Quirk', 'Lone', 'New Book'),
]);

function hero(calling: string): CharacterBuilder {
  const builder = new CharacterBuilder(createCharacter('test', 'hero'), system, index);
  builder.choose('build/calling', [calling]);
  return builder;
}

const knackPick = (builder: CharacterBuilder) => builder.getState().picks.find((pick) => pick.label === 'Knack')!;
const knackDecision = (builder: CharacterBuilder) => builder.getState().decisions.find((d) => d.label === 'Knack');

test('picking one printing takes the other off the open decision, and its own slot may still change book', () => {
  // Fails if the open decision still offers Spark from the New Book, or if the settled slot cannot change to it.
  const builder = hero('MYSTIC');
  assert.ok(knackDecision(builder)!.candidates.includes('SPARK_NEW'));
  builder.choose('MYSTIC/select:Knack', ['SPARK_OLD']);
  assert.ok(!knackDecision(builder)!.candidates.includes('SPARK_NEW'));
  assert.ok(slotOptions(knackPick(builder), 0).includes('SPARK_NEW'));
});

test('a slot is never offered another printing of a second slot\'s answer, and a same-book copy stays offered', () => {
  // Fails if `slotOptions` ignores printings (slot 1 offered Spark from the New Book beside slot 0's Old Book Spark),
  // or if a same-book copy reads as a printing (slot 1 not offered the second Echo).
  const builder = hero('MYSTIC');
  builder.choose('MYSTIC/select:Knack', ['SPARK_OLD', 'GLOW']);
  const pick = knackPick(builder);
  assert.ok(pick.candidates.includes('SPARK_NEW'));
  assert.ok(slotOptions(pick, 0).includes('SPARK_NEW'));
  assert.ok(!slotOptions(pick, 1).includes('SPARK_NEW'));

  const echoes = hero('MYSTIC');
  echoes.choose('MYSTIC/select:Knack', ['ECHO_1', 'GLOW']);
  assert.ok(slotOptions(knackPick(echoes), 1).includes('ECHO_2'));
});

test('a printing held from elsewhere is offered to no slot', () => {
  // Fails if a granted printing is treated as the pool's own (its other printing offered to a slot to change to).
  const builder = hero('GIFTED');
  builder.choose('GIFTED/select:Knack', ['GLOW', 'ECHO_1']);
  const pick = knackPick(builder);
  assert.ok(!pick.candidates.includes('SPARK_NEW'));
});

test('an addition offers the other printing of what is held, marked with the book it is held from', () => {
  // Fails if the offer leaves it out (adding is whatever its prerequisites) or does not mark it.
  const builder = hero('GIFTED');
  const derived = builder.getState().derived;
  const options = additionOptions(derived, builder.getState().kind, index);
  const spark = options.find((option) => option.elementId === 'SPARK_NEW');
  assert.equal(spark?.heldFrom, 'Old Book');
  assert.equal(additionOptionLabel('Spark — New Book', spark!), 'Spark — New Book · already has it from Old Book');
  assert.equal(options.find((option) => option.elementId === 'GLOW')?.heldFrom, undefined);
});

test('a candidate that would grant another printing of something held is marked with what is held', () => {
  // Fails if the overlap walk compares ids only: the New Book's Spark is not the Old Book's id.
  const builder = hero('GIFTED');
  const derived = deriveCharacter(builder.getState().character, system, index);
  const marks = candidateOverlaps(['NEW_SPARK_BOON'], derived, builder.getState().kind, index);
  assert.deepEqual(marks.get('NEW_SPARK_BOON'), ['SPARK_OLD']);
});

test('two elements of one type, name and book are told apart by what gives them', () => {
  // Fails if the label ignores the index (two identical "Agile — New Book" rows), reads only grants or only setters,
  // or names a giver for an element nothing shares a name with.
  assert.equal(candidateLabel(index.get('AGILE_DEER')!, [], index), 'Agile (from Deer) — New Book');
  assert.equal(candidateLabel(index.get('AGILE_RAT')!, [], index), 'Agile (from Rat) — New Book');
  assert.equal(candidateLabel(index.get('AGILE_RAT')!, []), 'Agile — New Book');
  assert.equal(candidateGiver(index.get('LONE')!, index), undefined);
  assert.equal(candidateGiver(index.get('SPARK_OLD')!, index), undefined);
});
