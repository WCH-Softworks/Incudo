/**
 * Elements a user adds to a character from loaded content, as the builder offers, adds, shows and removes them —
 * ADR 0064.
 *
 * No game in the fixture: a hero picks an Origin, and its kind lets Knacks, Marks and (to show a pick is never
 * answered by an addition) Origins be added, and not Boons. Two Books are publications. Each test names the change
 * that fails it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  MapElementIndex,
  setAdded,
  type Element,
  type GameSystem,
  type RequirementExpr,
  type Rule,
} from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string, source: string, rules: Rule[] = [], requirements?: RequirementExpr): Element {
  return {
    id,
    type,
    name: id.charAt(0) + id.slice(1).toLowerCase().replace(/_/g, ' '),
    source,
    setters: {},
    rules,
    supports: [],
    ...(requirements ? { requirements } : {}),
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

const might = (value: number): Rule => ({ kind: 'stat', key: `might:${value}`, name: 'might', value: { kind: 'number', value } });
const select = (name: string, type: string): Rule => ({ kind: 'select', key: `select:${name}`, type, name, number: 1 });

function system(additions = true): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [
      { name: 'Book', publication: true },
      { name: 'Origin', plural: 'Origins' },
      { name: 'Knack', plural: 'Knacks' },
      { name: 'Mark', plural: 'Marks' },
      { name: 'Boon' },
    ],
    stats: [{ name: 'might', label: 'Might', default: 10 }],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Origin', 'Knack', 'Mark', 'Boon'],
        ...(additions
          ? { additions: { types: ['Mark', 'Knack', 'Origin'], description: 'Anything, whatever it asks for.' } }
          : {}),
        buildSteps: [{ id: 'origin', label: 'Origin', types: ['Origin'], required: true }],
        sheet: { sections: [{ id: 'numbers', label: 'Numbers', stats: ['might'] }] },
      },
    ],
  };
}

const index = new MapElementIndex();
index.addAll([
  element('BOOK_A', 'Book', 'Book a'),
  element('BOOK_B', 'Book', 'Book b'),
  element('HILLS', 'Origin', 'Book a', [{ kind: 'grant', key: 'g', type: 'Knack', id: 'KEEN' }]),
  element('COAST', 'Origin', 'Book a'),
  element('KEEN', 'Knack', 'Book a', [might(2), select('Another Mark', 'Mark')]),
  element('STRONG_ONLY', 'Knack', 'Book a', [might(1)], { kind: 'atLeast', stat: 'might', value: 15 }),
  element('FAR_KNACK', 'Knack', 'Book b'),
  element('MARK_DEEP', 'Mark', 'Book a', [select('Deeper', 'Mark')]),
  element('MARK_PLAIN', 'Mark', 'Book a'),
  element('BOON', 'Boon', 'Book a', [might(5)]),
]);

const hero = (additions = true) => new CharacterBuilder(createCharacter('test', 'hero'), system(additions), index);
const ids = (options: { elementId: string }[]) => options.map((o) => o.elementId);

test('every element of the declared types is offered whatever its requirements, and says whether they hold', () => {
  // Fails if the offer is filtered by the element's own requirements (Strong only is missing), or loses the kind's
  // order of types.
  const b = hero();
  const options = b.additionOptionsFor();
  assert.deepEqual(ids(options), ['MARK_DEEP', 'MARK_PLAIN', 'FAR_KNACK', 'KEEN', 'STRONG_ONLY', 'COAST', 'HILLS']);
  assert.equal(options.find((o) => o.elementId === 'STRONG_ONLY')?.prerequisitesMet, false);
  assert.equal(options.find((o) => o.elementId === 'KEEN')?.prerequisitesMet, true);
  assert.deepEqual(ids(b.additionOptionsFor('Mark')), ['MARK_DEEP', 'MARK_PLAIN']);
  assert.deepEqual(ids(b.additionOptionsFor('Boon')), []);
  const state = b.getState().additions;
  assert.equal(state.available, true);
  assert.equal(state.description, 'Anything, whatever it asks for.');
  assert.deepEqual(state.types, [
    { type: 'Mark', label: 'Marks' },
    { type: 'Knack', label: 'Knacks' },
    { type: 'Origin', label: 'Origins' },
  ]);
});

test('what the character holds or has added is not offered again', () => {
  // Fails if the offer does not leave out held elements (Keen, which Hills grants) or added ones.
  const b = hero();
  b.choose('build/origin', ['HILLS']);
  assert.ok(b.addElement('MARK_PLAIN'));
  assert.deepEqual(ids(b.additionOptionsFor('Knack')), ['FAR_KNACK', 'STRONG_ONLY']);
  assert.deepEqual(ids(b.additionOptionsFor('Mark')), ['MARK_DEEP']);
});

test('a book switched off for this character offers nothing here and cannot be added from', () => {
  // Fails if the offer or the add reads everything loaded rather than the offered view.
  const b = hero();
  b.setPublications(['Book a']);
  assert.deepEqual(ids(b.additionOptionsFor('Knack')), ['KEEN', 'STRONG_ONLY']);
  assert.equal(b.addElement('FAR_KNACK'), false);
  assert.equal(b.getState().character.additions, undefined);
});

test('adding holds the element and records it, and is refused for what may not be added', () => {
  // Fails if the builder does not check the kind's types (the Boon is recorded), what is held, or the kind itself.
  const b = hero();
  b.choose('build/origin', ['HILLS']);
  assert.equal(b.addElement('BOON'), false);
  assert.equal(b.addElement('KEEN'), false, 'Hills already grants it');
  assert.equal(b.addElement('NOWHERE'), false);
  assert.ok(b.addElement('MARK_PLAIN'));
  assert.equal(b.addElement('MARK_PLAIN'), false, 'already added');
  const state = b.getState();
  assert.deepEqual(state.character.additions, ['MARK_PLAIN']);
  assert.equal(state.character.formatVersion, 5);
  assert.ok(state.derived.elementIds.has('MARK_PLAIN'));

  const none = hero(false);
  assert.equal(none.getState().additions.available, false);
  assert.equal(none.addElement('MARK_PLAIN'), false);
  assert.deepEqual(none.additionOptionsFor(), []);
});

test('a row is flagged while its prerequisites fail and says so, and the flag clears when they hold', () => {
  // Fails if the row does not read the derivation's `requirement-unmet` (it says met while the problems list says not).
  const b = hero();
  b.choose('build/origin', ['COAST']);
  assert.ok(b.addElement('STRONG_ONLY'));
  let row = b.getState().additions.rows[0]!;
  assert.deepEqual(row, {
    elementId: 'STRONG_ONLY',
    name: 'Strong only',
    type: 'Knack',
    known: true,
    held: true,
    prerequisitesMet: false,
    note: 'Its prerequisites are not met. It is on the character anyway.',
  });
  assert.equal(b.getState().derived.stats.get('might')?.value, 11);
  b.setBaseStat('might', 15);
  row = b.getState().additions.rows[0]!;
  assert.equal(row.prerequisitesMet, true);
  assert.equal(row.note, undefined);
});

test('a row the content does not declare, or whose type may not be added, says why it is not held', () => {
  // Fails if an unknown id is shown as held, or the engine's reason for refusing a type is not carried to the row.
  const character = setAdded(setAdded(createCharacter('test', 'hero'), 'GONE', true), 'BOON', true);
  const rows = new CharacterBuilder(character, system(), index).getState().additions.rows;
  assert.deepEqual(rows.map((r) => [r.elementId, r.known, r.held]), [
    ['GONE', false, false],
    ['BOON', true, false],
  ]);
  assert.equal(rows[0]!.note, 'Not in the loaded content. Load the content it came from to see it and use it.');
  assert.equal(rows[1]!.note, 'Boon was added to this character, and a Hero cannot have a Boon added. It is not on the character.');
});

test('removing an addition takes off the answers of the selects it closed, and only those', () => {
  // Fails if removal leaves the answers recorded (Mark deep stays held through them), or prunes one pass only (the
  // answer to Mark deep's own select stays), or prunes a pool another element still opens.
  const b = hero();
  b.choose('build/origin', ['COAST']);
  assert.ok(b.addElement('KEEN'));
  b.choose('KEEN/select:Another Mark', ['MARK_DEEP']);
  b.choose('MARK_DEEP/select:Deeper', ['MARK_PLAIN']);
  assert.ok(b.getState().derived.elementIds.has('MARK_PLAIN'));
  b.removeAddition('KEEN');
  let state = b.getState();
  assert.deepEqual(state.character.choices.map((c) => c.ruleKey), ['build/origin']);
  assert.ok(!state.derived.elementIds.has('MARK_DEEP'));
  assert.ok(!state.derived.elementIds.has('MARK_PLAIN'));

  // Keen added, then also granted by Hills: taking the addition off leaves Keen held, and its select's answer kept.
  const kept = hero();
  kept.choose('build/origin', ['COAST']);
  assert.ok(kept.addElement('KEEN'));
  kept.choose('KEEN/select:Another Mark', ['MARK_PLAIN']);
  kept.choose('build/origin', ['HILLS']);
  kept.removeAddition('KEEN');
  state = kept.getState();
  assert.equal(state.character.additions, undefined);
  assert.ok(state.derived.elementIds.has('KEEN'));
  assert.deepEqual(state.character.choices.map((c) => c.ruleKey).sort(), ['KEEN/select:Another Mark', 'build/origin']);
});

test('an added element of a pick step\'s type does not answer that pick', () => {
  // Fails if an addition is recorded as a choice (the Origin pick would find Coast by its type and read as answered).
  const b = hero();
  assert.ok(b.addElement('COAST'));
  const state = b.getState();
  assert.ok(state.decisions.some((d) => d.kind === 'pick' && d.stepId === 'origin'));
  assert.ok(!state.picks.some((p) => p.stepId === 'origin'));
  assert.ok(state.derived.elementIds.has('COAST'));
  b.choose('build/origin', ['HILLS']);
  assert.deepEqual(b.getState().character.additions, ['COAST']);
});
