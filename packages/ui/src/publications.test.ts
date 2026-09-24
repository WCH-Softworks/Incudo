/**
 * Which publications a character is offered — ADR 0049.
 *
 * No game in the fixture. "Book" is a publication only because the system marks the type, which is the ADR's
 * first decision: nothing in core or here names a book. The real corpus is measured in
 * `tools/verify/src/publications.test.ts`.
 *
 * Each test names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  collectCharacterContent,
  containerElementIndex,
  MapElementIndex,
  packCharacterContainer,
  readCharacterContainer,
  resolveCharacterKind,
  type Character,
  type Element,
  type GameSystem,
} from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';
import { offeredIndex, publicationList, togglePublication } from './publications.ts';

function element(id: string, type: string, source: string, extra: Partial<Element> = {}): Element {
  return {
    id,
    type,
    name: id,
    source,
    setters: {},
    rules: [],
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
    ...extra,
  };
}

function system(publication = true): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Book', publication }, { name: 'Kit' }, { name: 'Gadget' }],
    stats: [{ name: 'vigour', default: 10 }],
    characterKinds: [
      {
        id: 'pc',
        name: 'PC',
        default: true,
        progression: { kind: 'level', min: 1, max: 20, stat: 'level' },
        elementTypes: ['Kit', 'Gadget'],
        buildSteps: [{ id: 'kit', label: 'Kit', types: ['Kit'], required: true }],
        sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
      },
    ],
  };
}

function corpus(): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll([
    element('BOOK_ALPHA', 'Book', 'Alpha Book', { name: 'Alpha Book' }),
    element('BOOK_BETA', 'Book', 'Beta Book', { name: 'Beta Book' }),
    element('BOOK_EMPTY', 'Book', 'Empty Book', { name: 'Empty Book' }),
    element('KIT_ALPHA', 'Kit', 'Alpha Book', {
      rules: [
        { kind: 'stat', key: 'v', name: 'vigour', value: { kind: 'number', value: 2 } },
        { kind: 'select', key: 'g', type: 'Gadget', name: 'Gadget', number: 1 },
      ],
    }),
    // Spelt with another case, as seven official elements spell their book.
    element('KIT_BETA', 'Kit', 'beta book'),
    // Not a book: always offered, as 5e's Internal and Core are.
    element('KIT_CORE', 'Kit', 'Core'),
    element('GADGET_ALPHA', 'Gadget', 'Alpha Book'),
    element('GADGET_BETA', 'Gadget', 'Beta Book'),
    element('GADGET_CORE', 'Gadget', 'Core'),
  ]);
  return index;
}

const fresh = (): Character => createCharacter('test', 'pc', { progress: 1 });

function kitOffers(builder: CharacterBuilder): string[] {
  const state = builder.getState();
  const open = state.decisions.find((decision) => decision.stepId === 'kit');
  const settled = state.picks.find((pick) => pick.stepId === 'kit');
  return [...(open?.candidates ?? settled?.candidates ?? [])].sort();
}

function gadgetOffers(builder: CharacterBuilder): string[] {
  const open = builder.getState().decisions.find((decision) => decision.id === 'KIT_ALPHA/g');
  return [...(open?.candidates ?? [])].sort();
}

test('a character with no list is offered every publication, and the builder offers everything', () => {
  // Perturbation: treating an absent list as an empty one offers only KIT_CORE.
  const builder = new CharacterBuilder(fresh(), system(), corpus());
  assert.deepEqual(kitOffers(builder), ['KIT_ALPHA', 'KIT_BETA', 'KIT_CORE']);
  const list = builder.getState().publications;
  assert.equal(list.everything, true);
  assert.deepEqual(
    list.rows.map((row) => [row.name, row.elements, row.offered]),
    [
      ['Alpha Book', 2, true],
      ['Beta Book', 2, true],
      ['Empty Book', 0, true],
    ],
  );
});

test('a list narrows a top-level pick and a select pool, and leaves what names no book offered', () => {
  const builder = new CharacterBuilder(fresh(), system(), corpus());
  builder.setPublications(['Alpha Book']);
  // Perturbation: filtering `get` instead of the lists leaves the pick unchanged; filtering on the exact
  // spelling offers KIT_BETA as a non-book.
  assert.deepEqual(kitOffers(builder), ['KIT_ALPHA', 'KIT_CORE']);
  builder.choose('build/kit', ['KIT_ALPHA']);
  // Perturbation: narrowing only the top-level pick in `packages/ui` offers GADGET_BETA here.
  assert.deepEqual(gadgetOffers(builder), ['GADGET_ALPHA', 'GADGET_CORE']);
});

test('switching a book off changes nothing the character holds, and derives the same numbers', () => {
  const builder = new CharacterBuilder(fresh(), system(), corpus());
  builder.choose('build/kit', ['KIT_ALPHA']);
  const before = builder.getState();
  assert.equal(before.derived.stats.get('vigour')?.value, 12);

  builder.setPublications(['Beta Book']);
  const after = builder.getState();
  // Perturbation: an index whose `get` also filters loses KIT_ALPHA's +2 and its select.
  assert.equal(after.derived.stats.get('vigour')?.value, 12);
  assert.deepEqual(
    after.derived.elements.map((e) => e.id).sort(),
    before.derived.elements.map((e) => e.id).sort(),
  );
  assert.deepEqual(after.character.choices, before.character.choices);
  // Still the answer to its pick, and its alternatives are what the list offers.
  const settled = after.picks.find((pick) => pick.stepId === 'kit');
  assert.deepEqual(settled?.chosen, ['KIT_ALPHA']);
  assert.deepEqual(kitOffers(builder), ['KIT_ALPHA', 'KIT_BETA', 'KIT_CORE']);
  assert.deepEqual(gadgetOffers(builder), ['GADGET_BETA', 'GADGET_CORE']);
});

test('switching one off from everything records every other loaded publication', () => {
  // Perturbation: starting from an empty list records nothing, and the character is offered no books.
  const index = corpus();
  const next = togglePublication(index, system(), fresh(), 'beta book', false);
  assert.deepEqual(next, ['Alpha Book', 'Empty Book']);

  const builder = new CharacterBuilder(fresh(), system(), index);
  builder.offerPublication('Beta Book', false);
  assert.deepEqual(builder.getState().character.publications, ['Alpha Book', 'Empty Book']);
  builder.offerPublication('Beta Book', true);
  assert.deepEqual(builder.getState().character.publications, ['Alpha Book', 'Empty Book', 'Beta Book']);
  // Back to everything removes the field, which is how a character that never chose looks.
  builder.setPublications(undefined);
  assert.equal('publications' in builder.getState().character, false);
});

test('an empty list offers only what names no book', () => {
  const builder = new CharacterBuilder(fresh(), system(), corpus());
  builder.setPublications([]);
  assert.deepEqual(kitOffers(builder), ['KIT_CORE']);
  assert.equal(builder.getState().publications.offered, 0);
});

test('a recorded name nothing loaded has is kept and listed as not loaded', () => {
  // Perturbation: rebuilding the list from what is loaded drops "Gamma Book" on the first toggle.
  const character: Character = { ...fresh(), publications: ['Alpha Book', 'Gamma Book'] };
  const list = publicationList(corpus(), system(), character);
  assert.deepEqual(list.rows.at(-1), { name: 'Gamma Book', elements: 0, offered: true, loaded: false });
  assert.deepEqual(togglePublication(corpus(), system(), character, 'Beta Book', true), [
    'Alpha Book',
    'Gamma Book',
    'Beta Book',
  ]);
});

test('a system with no publication type has nothing to narrow', () => {
  // Perturbation: reading every distinct source as a book hides KIT_CORE and friends under an empty list.
  const character: Character = { ...fresh(), publications: [] };
  const index = corpus();
  assert.equal(offeredIndex(index, system(false), character), index);
  assert.deepEqual(publicationList(index, system(false), character).rows, []);
});

test('the list survives a save and reopens with zero sources, and it is not what opens the character', () => {
  // ADR 0012: the save opens from what it embeds. Perturbation: a container that drops unknown fields loses it.
  const builder = new CharacterBuilder(fresh(), system(), corpus());
  builder.choose('build/kit', ['KIT_ALPHA']);
  builder.setPublications(['Beta Book']);
  const { character } = builder.getState();
  const content = collectCharacterContent(character, corpus(), { kind: resolveCharacterKind(system(), 'pc') });
  const { container } = readCharacterContainer(packCharacterContainer(character, content));
  assert.ok(container);
  assert.deepEqual(container.character.publications, ['Beta Book']);
  const reopened = new CharacterBuilder(container.character, system(), containerElementIndex(container));
  assert.equal(reopened.getState().derived.stats.get('vigour')?.value, 12);
});
