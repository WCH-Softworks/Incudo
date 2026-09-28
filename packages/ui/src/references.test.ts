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

function system(references = true, grants: string[] = []): GameSystem {
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
        ...(grants.length ? { grants } : {}),
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
    suggestions: [],
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

test("a kept reference's text has what it embeds put in place, whatever type that is", () => {
  // ADR 0069. Fails if the row's description is the text as content wrote it (the marker left as an empty gap), or if
  // the embed is looked up anywhere but the index the builder shows content from.
  const withEmbed = new MapElementIndex();
  withEmbed.addAll([
    { ...element('SUMMONS', 'Note', 'Book a'), description: '<p>It appears.</p><div element="KNACK" />' },
    element('KNACK', 'Knack', 'Book a'),
  ]);
  const b = new CharacterBuilder(createCharacter('test', 'hero'), system(), withEmbed);
  assert.equal(b.addReference('SUMMONS'), true);
  assert.equal(b.getState().references.rows[0]!.description, '<p>It appears.</p><div><h5>Knack</h5><p>KNACK as printed.</p></div>');
});

/** A hero holding what the kind grants it, over an index of its own. */
function holding(grants: string[], elements: Element[]): CharacterBuilder {
  const idx = new MapElementIndex();
  idx.addAll([element('BOOK_A', 'Book', 'Book a'), element('BOOK_B', 'Book', 'Book b'), ...elements]);
  return new CharacterBuilder(createCharacter('test', 'hero'), system(true, grants), idx);
}

const printing = (id: string, type: string, source: string, ...embeds: string[]): Element => ({
  ...element(id, type, source),
  description: `<p>${id} prints.</p>${embeds.map((e) => `<div element="${e}" />`).join('')}`,
});

test("what the character's own elements print, of a type the kind keeps, is suggested by name with what prints it", () => {
  // ADR 0070. Fails if suggestions are read from everything loaded rather than what is held (ANVIL, printed by a Knack
  // nothing holds, suggested); if embeds inside an embed are not followed (DEEP missing); if a type the kind does not
  // keep is suggested (PRINTED_KNACK); if an embed naming nothing is (ID_GONE); if the two holders of SPIRIT are not
  // both named; or if the list is not by name.
  const b = holding(
    ['HOLDER', 'SECOND'],
    [
      printing('HOLDER', 'Knack', 'Book a', 'SPIRIT', 'PRINTED_KNACK', 'FAR_NOTE', 'ID_GONE'),
      printing('SECOND', 'Knack', 'Book a', 'SPIRIT'),
      printing('PRINTED_KNACK', 'Knack', 'Book a', 'DEEP'),
      element('SPIRIT', 'Note', 'Book a'),
      element('DEEP', 'Note', 'Book a'),
      element('FAR_NOTE', 'Note', 'Book b'),
      printing('LOOSE', 'Knack', 'Book a', 'ANVIL'),
      element('ANVIL', 'Note', 'Book a'),
    ],
  );
  assert.deepEqual(b.getState().references.suggestions, [
    { elementId: 'DEEP', name: 'Deep', source: 'Book a', printedIn: ['Holder'] },
    { elementId: 'FAR_NOTE', name: 'Far note', source: 'Book b', printedIn: ['Holder'] },
    { elementId: 'SPIRIT', name: 'Spirit', source: 'Book a', printedIn: ['Holder', 'Second'] },
  ]);
  assert.equal(b.getState().character.references, undefined, 'a suggestion records nothing');
});

test('a suggestion goes once it is kept, and a book switched off suggests nothing', () => {
  // Fails if what is kept stays suggested, or if suggestions ignore the offered view (ADR 0049): FAR_NOTE's book is off.
  const b = holding(
    ['HOLDER'],
    [printing('HOLDER', 'Knack', 'Book a', 'SPIRIT', 'FAR_NOTE'), element('SPIRIT', 'Note', 'Book a'), element('FAR_NOTE', 'Note', 'Book b')],
  );
  b.setPublications(['Book a']);
  assert.deepEqual(b.getState().references.suggestions.map((s) => s.elementId), ['SPIRIT']);
  assert.equal(b.addReference('SPIRIT'), true);
  assert.deepEqual(b.getState().references.suggestions, []);
  b.removeReference('SPIRIT');
  assert.deepEqual(b.getState().references.suggestions.map((s) => s.elementId), ['SPIRIT']);
});

test('a circle of embeds ends, and suggestions go exactly as deep as a description is shown', () => {
  // Fails if there is no depth limit (the circle runs out of stack, and N5 and N6 are suggested) or if the limit is one
  // early (N4 missing). The limit is what ends a circle: there is no check of its own to perturb.
  const circle = holding(
    ['HOLDER'],
    [printing('HOLDER', 'Knack', 'Book a', 'C1'), printing('C1', 'Note', 'Book a', 'C2'), printing('C2', 'Note', 'Book a', 'C3'), printing('C3', 'Note', 'Book a', 'C1', 'HOLDER')],
  );
  assert.deepEqual(circle.getState().references.suggestions.map((s) => s.elementId), ['C1', 'C2', 'C3']);

  const chain = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6'];
  const deep = holding(
    ['HOLDER'],
    [printing('HOLDER', 'Knack', 'Book a', 'N1'), ...chain.map((id, i) => printing(id, 'Note', 'Book a', ...(chain[i + 1] ? [chain[i + 1]!] : [])))],
  );
  assert.deepEqual(deep.getState().references.suggestions.map((s) => s.elementId), ['N1', 'N2', 'N3', 'N4']);
});

test('a kind that keeps nothing suggests nothing, whatever its elements print', () => {
  // Fails if suggestions are computed without the kind's types.
  const idx = new MapElementIndex();
  idx.addAll([printing('HOLDER', 'Knack', 'Book a', 'SPIRIT'), element('SPIRIT', 'Note', 'Book a')]);
  const b = new CharacterBuilder(createCharacter('test', 'hero'), system(false, ['HOLDER']), idx);
  assert.deepEqual(b.getState().references.suggestions, []);
});
