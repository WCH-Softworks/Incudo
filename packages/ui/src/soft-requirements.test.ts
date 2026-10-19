/**
 * A prerequisite naming an element of a type the kind makes soft is a warning beside an offer, not a filter — ADR 0124.
 *
 * No game in the fixture: a hero picks a Calling, and a Calling opens a Knack select. Knacks require Charms (the soft
 * type) or Origins (not soft), alone, in either-or, together, or under a `not`. Each test names the change that fails it,
 * and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, type Element, type GameSystem, type RequirementExpr, type Rule } from '@incudo/core';

import { softShortfallNote } from './soft-requirements.ts';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string, rules: Rule[] = [], requirements?: RequirementExpr): Element {
  return {
    id,
    type,
    name: id.charAt(0) + id.slice(1).toLowerCase().replace(/_/g, ' '),
    source: 'Book',
    setters: {},
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
    ...(requirements ? { requirements } : {}),
  };
}

const has = (id: string): RequirementExpr => ({ kind: 'has', id });
const select = (name: string, type: string, number = 1): Rule =>
  ({ kind: 'select', key: `select:${name}`, name, type, number }) as Rule;

function system(soft = true): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Origin' }, { name: 'Calling' }, { name: 'Knack' }, { name: 'Charm' }],
    stats: [{ name: 'level', label: 'Level', default: 1 }],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'level', stat: 'level', min: 1, max: 10 },
        elementTypes: ['Origin', 'Calling', 'Knack', 'Charm'],
        ...(soft ? { softRequirements: { types: ['Charm'] } } : {}),
        buildSteps: [
          { id: 'origin', label: 'Origin', types: ['Origin'], required: true },
          { id: 'calling', label: 'Calling', types: ['Calling'], required: true },
        ],
        sheet: { sections: [] },
      },
    ],
  };
}

const index = new MapElementIndex();
index.addAll([
  element('HILLS', 'Origin'),
  element('COAST', 'Origin'),
  element('MYSTIC', 'Calling', [select('Knack', 'Knack', 2)]),
  element('SPARK', 'Charm'),
  element('GLOW', 'Charm'),
  element('BOLT', 'Knack', [], has('SPARK')),
  element('EITHER', 'Knack', [], { kind: 'or', children: [has('SPARK'), has('GLOW')] }),
  element('BOTH', 'Knack', [], { kind: 'and', children: [has('SPARK'), has('GLOW')] }),
  element('SEA_BOLT', 'Knack', [], { kind: 'and', children: [has('SPARK'), has('COAST')] }),
  element('NO_SPARK', 'Knack', [], { kind: 'not', child: has('SPARK') }),
  element('PLAIN', 'Knack'),
]);

function mystic(soft = true): CharacterBuilder {
  const builder = new CharacterBuilder(createCharacter('test', 'hero'), system(soft), index);
  builder.choose('build/origin', ['HILLS']);
  builder.choose('build/calling', ['MYSTIC']);
  return builder;
}

const knacks = (builder: CharacterBuilder) => builder.getState().decisions.find((d) => d.label === 'Knack');

test('a candidate short only of a soft element is offered, with what it lacks beside it', () => {
  // Fails if the engine filters on a soft term (Bolt, Either and Both are not offered), or if a non-soft term is made
  // soft too (Sea Bolt, which needs the Coast origin, is offered).
  const builder = mystic();
  const decision = knacks(builder);
  assert.ok(decision);
  assert.deepEqual([...decision.candidates].sort(), ['BOLT', 'BOTH', 'EITHER', 'NO_SPARK', 'PLAIN']);
  const notes = builder.softNotesFor(decision.id);
  assert.equal(notes.get('BOLT'), 'Needs Spark, which this character does not have');
  assert.equal(notes.get('EITHER'), 'Needs Spark or Glow, which this character does not have');
  assert.equal(notes.get('BOTH'), 'Needs Spark and Glow, which this character does not have');
  assert.equal(notes.has('PLAIN'), false);
  assert.equal(notes.has('NO_SPARK'), false);
});

test('a kind that makes nothing soft filters as before', () => {
  // Fails if softness is not read from the kind (Bolt offered with no declaration).
  const builder = mystic(false);
  assert.deepEqual([...knacks(builder)!.candidates].sort(), ['NO_SPARK', 'PLAIN']);
  assert.equal(builder.softNotesFor(knacks(builder)!.id).size, 0);
});

test('a chosen candidate that lacks a soft prerequisite is warned on its settled slot', () => {
  // Fails if a settled pick is not asked (Bolt's warning missing from its slot).
  const builder = mystic();
  builder.choose(knacks(builder)!.id, ['BOLT', 'NO_SPARK']);
  const pick = builder.getState().picks.find((p) => p.label === 'Knack');
  assert.ok(pick);
  assert.equal(builder.softNotesFor(pick.ruleKey).get('BOLT'), 'Needs Spark, which this character does not have');
  assert.ok(
    builder.getState().derived.problems.some((p) => p.code === 'requirement-unmet' && p.elementId === 'BOLT'),
    'a held candidate that lacks it is flagged by the derivation as well',
  );
});

test('the note joins one way by "and" and the ways by "or", each name once', () => {
  assert.equal(softShortfallNote([['SPARK'], ['SPARK']], index), 'Needs Spark, which this character does not have');
  assert.equal(
    softShortfallNote([['SPARK', 'GLOW'], ['BOLT']], index),
    'Needs Spark and Glow or Bolt, which this character does not have',
  );
});
