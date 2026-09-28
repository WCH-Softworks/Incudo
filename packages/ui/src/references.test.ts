/**
 * What a character keeps beside it as a reference, as the builder offers, keeps, shows and drops it — ADR 0068.
 *
 * No game in the fixture: a hero whose kind keeps Notes for reference and not Knacks. A Note carries a rule that
 * would move "might" if it were held. Two Books are publications. Each test names the change that fails it, and each
 * was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, setReferenced, type Element, type GameSystem, type Rule } from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';

function element(id: string, type: string, source: string, rules: Rule[] = []): Element {
  return {
    id,
    type,
    name: id.charAt(0) + id.slice(1).toLowerCase().replace(/_/g, ' '),
    source,
    setters: {},
    rules,
    supports: [],
    description: `<p>${id} as printed.</p>`,
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

function system(references = true): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Book', publication: true }, { name: 'Note' }, { name: 'Knack' }],
    stats: [{ name: 'might', label: 'Might', default: 10 }],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Knack'],
        ...(references ? { references: { types: ['Note'], label: 'Beside it', description: 'Text to read.' } } : {}),
        buildSteps: [],
        sheet: { sections: [{ id: 'numbers', label: 'Numbers', stats: ['might'] }] },
      },
    ],
  };
}

const index = new MapElementIndex();
index.addAll([
  element('BOOK_A', 'Book', 'Book a'),
  element('BOOK_B', 'Book', 'Book b'),
  element('ZEPHYR', 'Note', 'Book a', [{ kind: 'stat', key: 'might', name: 'might', value: { kind: 'number', value: 5 } }]),
  element('ANVIL', 'Note', 'Book a'),
  element('FAR_NOTE', 'Note', 'Book b'),
  element('KNACK', 'Knack', 'Book a'),
]);

const fresh = (references = true) => new CharacterBuilder(createCharacter('test', 'hero'), system(references), index);

test('every element of the kind\'s types is offered, by name, less what is kept', () => {
  // Fails if the offer is not the kind's types (KNACK offered), not sorted, or offers what is already kept.
  const b = fresh();
  assert.deepEqual(b.referenceOptionsFor(), ['ANVIL', 'FAR_NOTE', 'ZEPHYR']);
  assert.equal(b.addReference('ZEPHYR'), true);
  assert.deepEqual(b.referenceOptionsFor(), ['ANVIL', 'FAR_NOTE']);
  assert.deepEqual(fresh(false).referenceOptionsFor(), [], 'a kind that keeps none offers none');
});

test('a book switched off for this character offers nothing here and cannot be kept from', () => {
  // Fails if the offer or addReference reads everything loaded rather than the offered view (ADR 0049).
  const b = fresh();
  b.setPublications(['Book a']);
  assert.deepEqual(b.referenceOptionsFor(), ['ANVIL', 'ZEPHYR']);
  assert.equal(b.addReference('FAR_NOTE'), false);
  assert.equal(b.getState().character.references, undefined);
});

test('keeping one records it, shows its text and moves nothing derived; the refusals write nothing', () => {
  // Fails if keeping a reference seeds the derivation (might 15, ZEPHYR held), if the state leaves out its text, or if
  // a refusal (a Knack, an unknown id, one already kept, a kind that keeps none) writes anything.
  const b = fresh();
  const before = b.getState().derived;
  assert.equal(b.addReference('ZEPHYR'), true);
  const state = b.getState();
  assert.equal(state.character.formatVersion, 7);
  assert.deepEqual(state.character.references, ['ZEPHYR']);
  assert.equal(state.derived.stats.get('might')?.value, 10);
  assert.deepEqual([...state.derived.elementIds].sort(), [...before.elementIds].sort());
  assert.deepEqual(state.references, {
    available: true,
    label: 'Beside it',
    description: 'Text to read.',
    rows: [
      {
        elementId: 'ZEPHYR',
        name: 'Zephyr',
        source: 'Book a',
        type: 'Note',
        known: true,
        shown: true,
        description: '<p>ZEPHYR as printed.</p>',
      },
    ],
  });

  const kept = b.getState().character;
  assert.equal(b.addReference('ZEPHYR'), false);
  assert.equal(b.addReference('KNACK'), false);
  assert.equal(b.addReference('ID_NOWHERE'), false);
  assert.equal(b.getState().character, kept);
  const none = fresh(false);
  assert.equal(none.addReference('ZEPHYR'), false);
  assert.equal(none.getState().references.available, false);
  assert.equal(none.getState().character.formatVersion, 2);
});

test('a kept reference nothing declares, or of a type the kind does not keep, is listed with why and not shown', () => {
  // Fails if either row is shown (its text rendered), or loses its note.
  const character = setReferenced(setReferenced(createCharacter('test', 'hero'), 'ID_GONE', true), 'KNACK', true);
  const rows = new CharacterBuilder(character, system(), index).getState().references.rows;
  assert.deepEqual(
    rows.map((r) => [r.elementId, r.known, r.shown, r.description, r.note]),
    [
      ['ID_GONE', false, false, undefined, 'Not in the loaded content. Load the content it came from to see it.'],
      ['KNACK', true, false, undefined, 'This kind of character does not keep a Knack for reference, so it is not shown.'],
    ],
  );
});

test('dropping one takes it off, whatever it is, and dropping the last leaves no field', () => {
  // Fails if removeReference refuses an id nothing declares, or leaves an empty list recorded.
  const character = setReferenced(setReferenced(createCharacter('test', 'hero'), 'ID_GONE', true), 'ANVIL', true);
  const b = new CharacterBuilder(character, system(), index);
  b.removeReference('ID_GONE');
  assert.deepEqual(b.getState().character.references, ['ANVIL']);
  b.removeReference('ANVIL');
  assert.equal('references' in b.getState().character, false);
  assert.deepEqual(b.getState().references.rows, []);
});
