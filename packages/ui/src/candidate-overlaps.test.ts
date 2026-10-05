/**
 * Which offered candidates would give the character something it already has, and the words beside them.
 *
 * No game in the fixture: a hero picks an Origin and a Calling. The Hills origin grants the Keen knack, which grants the
 * Sight skill; a Calling may grant Sight too, directly or through a knack, at a level, or only when a condition holds. The kind names Skill as worth marking and not Knack. Each test names the change that fails it, and
 * each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, type Element, type GameSystem, type Rule } from '@incudo/core';

import { overlapNote } from './candidate-overlaps.ts';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string, rules: Rule[] = []): Element {
  return {
    id,
    type,
    name: id.charAt(0) + id.slice(1).toLowerCase().replace(/_/g, ' '),
    source: 'Book',
    setters: {},
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

const grant = (type: string, id: string, extra: Partial<Rule> = {}): Rule =>
  ({ kind: 'grant', key: `grant:${id}`, type, id, ...extra }) as Rule;

function system(marks = true): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Origin' }, { name: 'Calling' }, { name: 'Knack' }, { name: 'Skill' }],
    stats: [{ name: 'level', label: 'Level', default: 1 }],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'level', stat: 'level', min: 1, max: 10 },
        elementTypes: ['Origin', 'Calling', 'Knack', 'Skill'],
        ...(marks ? { candidateOverlaps: { types: ['Skill'] } } : {}),
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
  element('HILLS', 'Origin', [grant('Knack', 'KEEN')]),
  element('COAST', 'Origin', [grant('Skill', 'SWIM')]),
  element('KEEN', 'Knack', [grant('Skill', 'SIGHT')]),
  element('SIGHT', 'Skill'),
  element('SWIM', 'Skill'),
  element('LORE', 'Skill'),
  element('WATCHER', 'Calling', [grant('Skill', 'SIGHT'), grant('Skill', 'LORE')]),
  element('SCOUT', 'Calling', [grant('Knack', 'KEEN')]),
  element('TRACKER', 'Calling', [grant('Knack', 'EYES')]),
  element('EYES', 'Knack', [grant('Skill', 'SIGHT')]),
  element('LATE_WATCHER', 'Calling', [grant('Skill', 'SIGHT', { level: 3 })]),
  element('IF_COAST', 'Calling', [grant('Skill', 'SIGHT', { requirements: { kind: 'has', id: 'COAST' } })]),
  element('SAGE', 'Calling', [grant('Skill', 'LORE')]),
]);

function hero(marks = true): CharacterBuilder {
  const builder = new CharacterBuilder(createCharacter('test', 'hero'), system(marks), index);
  builder.choose('build/origin', ['HILLS']);
  return builder;
}

test('a candidate granting what is held is marked with it, directly or through what it grants', () => {
  // Fails if the walk follows only a candidate's own grants (Tracker, whose Eyes grants Sight, is not marked), if the
  // held set is not read (Sage, whose Lore is new, is marked), or if types are not filtered (Scout is marked with Keen).
  const marks = hero().overlapsFor('build/calling');
  assert.deepEqual(marks.get('WATCHER'), ['SIGHT'], 'Watcher gives Sight again, and Lore is new');
  assert.deepEqual(marks.get('TRACKER'), ['SIGHT'], 'Tracker gives Sight through a knack of its own');
  assert.equal(marks.has('SAGE'), false, 'Sage gives nothing held');
  assert.equal(marks.has('SCOUT'), false, 'Scout gives Keen, held, of a type the kind does not name');
});

test('a grant gated above the level the candidate is taken at, or on a condition that is false, is not followed', () => {
  // Fails if `level` is ignored (Late watcher is marked at level 1), or requirements are not read (If coast is marked).
  const builder = hero();
  let marks = builder.overlapsFor('build/calling');
  assert.equal(marks.has('LATE_WATCHER'), false, 'its Sight comes at level 3');
  assert.equal(marks.has('IF_COAST'), false, 'its Sight comes only from the coast');
  builder.setProgress(3);
  marks = builder.overlapsFor('build/calling');
  assert.deepEqual(marks.get('LATE_WATCHER'), ['SIGHT'], 'at level 3 it gives Sight again');
});

test('a settled slot is judged without its own answer, so what the answer gives is not redundant', () => {
  // Fails if a settled slot is judged against the character as it stands: Hills would be marked with the Sight it gives.
  const builder = hero();
  builder.choose('build/calling', ['WATCHER']);
  const marks = builder.overlapsFor('build/origin', 0);
  assert.deepEqual(marks.get('HILLS'), ['SIGHT'], 'Watcher gives Sight too, so Hills would give it again');
  assert.equal(marks.has('COAST'), false);
  const alone = hero();
  alone.choose('build/calling', ['SAGE']);
  assert.equal(alone.overlapsFor('build/origin', 0).size, 0, 'with Sage, nothing but Hills gives Sight');
});

test('a kind naming no types marks nothing, and a decision that is not open marks nothing', () => {
  // Fails if the walk defaults to every type when the kind declares none.
  assert.equal(hero(false).overlapsFor('build/calling').size, 0);
  assert.equal(hero().overlapsFor('build/nothing').size, 0);
  assert.equal(hero().overlapsFor('build/origin', 4).size, 0, 'no such slot');
});

test('the note names what is held, at most three, and says how many more', () => {
  assert.equal(overlapNote(undefined, index), undefined);
  assert.equal(overlapNote(['SIGHT'], index), 'The character already has Sight');
  assert.equal(overlapNote(['SIGHT', 'LORE'], index), 'The character already has Sight and Lore');
  assert.equal(overlapNote(['SIGHT', 'LORE', 'SWIM'], index), 'The character already has Sight, Lore and Swim');
  assert.equal(
    overlapNote(['SIGHT', 'LORE', 'SWIM', 'NOWHERE'], index),
    'The character already has Sight, Lore, Swim and 1 more',
  );
});
