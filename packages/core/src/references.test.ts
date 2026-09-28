/**
 * Elements a character keeps beside it as a reference — ADR 0068.
 *
 * The fixture has no game in it: a hero whose kind may keep Notes as references and not Knacks. A Note carries a rule,
 * a grant and a requirement of its own, none of which may reach the character, because a reference is text kept beside
 * it and never held. Each test names the change that fails it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCharacter } from './engine.ts';
import { collectCharacterContent } from './container.ts';
import { createCharacter, referenceIdsOf, setReferenced, type Character } from './character.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';
import { resolveCharacterKind, type GameSystem, type ReferencesDef } from './system.ts';

function element(id: string, type: string, rules: Rule[] = []): Element {
  return {
    id,
    type,
    name: id,
    source: 'test',
    setters: {},
    rules,
    supports: [],
    description: `<p>${id} as printed.</p>`,
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

function system(references: ReferencesDef | null = { types: ['Note'], label: 'For reference' }): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Note' }, { name: 'Knack' }],
    stats: [
      { name: 'level', default: 0 },
      { name: 'might', label: 'Might', default: 10 },
    ],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'level', min: 1, max: 20 },
        elementTypes: ['Knack'],
        references: references ?? undefined,
        buildSteps: [],
        sheet: { sections: [{ id: 'numbers', label: 'Numbers', stats: ['might'] }, { id: 'notes', label: 'Notes', types: ['Note'] }] },
      },
      { id: 'sidekick', name: 'Sidekick', extends: 'hero' },
    ],
  };
}

const index = new MapElementIndex();
for (const e of [
  element('NOTE', 'Note', [
    { kind: 'stat', key: 'might', name: 'might', value: { kind: 'number', value: 5 } },
    { kind: 'grant', key: 'g', type: 'Knack', id: 'KNACK_FROM_NOTE' },
    { kind: 'select', key: 'select:Pick', type: 'Knack', name: 'Pick', number: 1 },
  ]),
  element('OTHER_NOTE', 'Note'),
  element('KNACK_FROM_NOTE', 'Knack'),
  element('KNACK', 'Knack'),
]) {
  index.add(e);
}

function hero(references: string[] = []): Character {
  let character = createCharacter('test', 'hero', { progress: 1 });
  for (const id of references) character = setReferenced(character, id, true);
  return character;
}

test('keeping a reference raises the character to format 7, and only a character that keeps one', () => {
  // Fails if setReferenced does not raise the version (a reader of 6 would drop the field), or raises it always.
  const plain = hero();
  assert.equal(plain.formatVersion, 2);
  const one = setReferenced(plain, 'NOTE', true);
  assert.equal(one.formatVersion, 7);
  assert.deepEqual(one.references, ['NOTE']);
  assert.deepEqual(referenceIdsOf(setReferenced(one, 'OTHER_NOTE', true)), ['NOTE', 'OTHER_NOTE'], 'in the order chosen');
  assert.equal(setReferenced(one, 'NOTE', true), one, 'keeping one already kept changes nothing');

  // Dropping the last leaves no field and the version where it is: nothing downgrades one.
  const none = setReferenced(one, 'NOTE', false);
  assert.equal('references' in none, false);
  assert.equal(none.formatVersion, 7);
});

test('a reference is never held: no rule of it applies, nothing it grants or opens reaches the character', () => {
  // Fails if references are seeded into the derivation like additions (NOTE held, might 15, the Knack granted and a
  // select opened) — which would make a stat block beside an NPC something the NPC has.
  const without = deriveCharacter(hero(), system(), index);
  const withRef = deriveCharacter(hero(['NOTE', 'OTHER_NOTE']), system(), index);
  assert.deepEqual([...withRef.elementIds].sort(), [...without.elementIds].sort());
  assert.equal(withRef.elementIds.has('NOTE'), false);
  assert.equal(withRef.elementIds.has('KNACK_FROM_NOTE'), false);
  assert.equal(withRef.stats.get('might')?.value, 10);
  assert.deepEqual(withRef.pendingChoices, without.pendingChoices);
  assert.deepEqual(withRef.problems, without.problems);
});

test('a save embeds every reference, so it shows with no source', () => {
  // Fails if collectCharacterContent does not seed references: the save would reopen with an id and no text.
  const kind = resolveCharacterKind(system(), 'hero');
  const subset = collectCharacterContent(hero(['NOTE', 'OTHER_NOTE']), index, { kind });
  const embedded = subset.elements.map((e) => e.id);
  assert.ok(embedded.includes('NOTE'));
  assert.ok(embedded.includes('OTHER_NOTE'));
  assert.deepEqual(subset.unresolved, []);
  assert.equal(subset.elements.find((e) => e.id === 'NOTE')?.description, '<p>NOTE as printed.</p>');
});

test('the kind says which types may be a reference, and a kind extending it keeps them', () => {
  // Fails if resolveCharacterKind drops `references`, or does not carry it along `extends`.
  assert.deepEqual(resolveCharacterKind(system(), 'hero').references?.types, ['Note']);
  assert.deepEqual(resolveCharacterKind(system(), 'sidekick').references?.types, ['Note']);
  assert.equal(resolveCharacterKind(system(null), 'hero').references, undefined);
});
