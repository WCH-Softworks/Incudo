/**
 * Which block an added element is cast through, as the builder records it, a row offers it and a sheet writes it —
 * ADR 0097.
 *
 * No game in the fixture: a hero picks Callings (a set), each declaring a block; Orange prepares Charms from its list and
 * Purple does not. Its kind lets Charms and Knacks be added, and casts an added Charm through a block. Each test names
 * the change that fails it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, type Element, type GameSystem, type Rule } from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';
import { listedAside, sheetDocument } from './sheet-document.ts';
import { sheetMarkdown } from './sheet-markdown.ts';

function element(id: string, type: string, rules: Rule[] = [], extra: Partial<Element> = {}): Element {
  return {
    id,
    type,
    name: id.charAt(0) + id.slice(1).toLowerCase().replace(/_/g, ' '),
    source: 'Book',
    setters: {},
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
    ...extra,
  };
}

const stat = (name: string, value: number): Rule => ({ kind: 'stat', key: `stat:${name}`, name, value: { kind: 'number', value } });

function system(): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Calling', plural: 'Callings' }, { name: 'Charm', plural: 'Charms' }, { name: 'Knack', plural: 'Knacks' }],
    stats: [],
    characterKinds: [
      {
        id: 'hero',
        name: 'Hero',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Calling', 'Charm', 'Knack'],
        blockFilters: [{ key: 'charm:list', tags: ['{name}'] }],
        preparation: {
          blockAttribute: 'prepare',
          limit: '{name}:charm:allow',
          elementType: 'Charm',
          listFilter: '$(charm:list)',
          heldFilter: '$(charm:list)',
        },
        additions: {
          types: ['Charm', 'Knack'],
          blocks: { types: ['Charm'], label: 'Cast as', with: 'cast as {name}', none: 'cast through no calling' },
        },
        buildSteps: [{ id: 'callings', label: 'Callings', types: ['Calling'], multiple: true }],
        sheet: {
          sections: [
            { id: 'charms', label: 'Charms', types: ['Charm'], preparedMark: { always: 'always ready', chosen: 'ready' } },
            { id: 'knacks', label: 'Knacks', types: ['Knack'] },
          ],
        },
      },
    ],
  };
}

const index = new MapElementIndex();
index.addAll([
  element('ORANGE', 'Calling', [stat('orange:charm:allow', 1)], { spellcasting: [{ name: 'Orange', prepare: 'true' }] }),
  element('PURPLE', 'Calling', [], { spellcasting: [{ name: 'Purple' }] }),
  element('GLOW', 'Charm'),
  element('KNACK', 'Knack'),
]);

function hero(callings: string[]): CharacterBuilder {
  const b = new CharacterBuilder(createCharacter('test', 'hero'), system(), index);
  b.choose('build/callings', callings);
  return b;
}

test("adding to a character with one block records it, and the spell is always ready on that block's list", () => {
  // Fails if `addElement` does not record the only block (no block, nothing on the list), or records one for a type the
  // kind does not cast through a block (Knack would carry one).
  const b = hero(['ORANGE']);
  assert.equal(b.addElement('GLOW'), true);
  assert.equal(b.addElement('KNACK'), true);
  const { character, derived } = b.getState();
  assert.deepEqual(character.additionBlocks, { GLOW: 'orange' });
  assert.equal(character.formatVersion, 10);
  assert.deepEqual(derived.preparation[0]?.always, ['GLOW']);
});

test('with two blocks nothing is recorded, the row offers both and none, and a choice is recorded', () => {
  // Fails if a block is guessed among several, if the row offers blocks the character does not hold, or if
  // `setAdditionBlock` does not write.
  const b = hero(['ORANGE', 'PURPLE']);
  b.addElement('GLOW');
  let row = b.getState().additions.rows.find((r) => r.elementId === 'GLOW');
  assert.equal(b.getState().character.additionBlocks, undefined);
  assert.deepEqual(row?.block, {
    label: 'Cast as',
    value: '',
    options: [
      { key: 'orange', name: 'Orange', held: true, label: 'Orange' },
      { key: 'purple', name: 'Purple', held: true, label: 'Purple' },
    ],
    none: 'cast through no calling',
    noneOption: 'None',
  });
  assert.equal(b.setAdditionBlock('GLOW', 'Purple'), true);
  row = b.getState().additions.rows.find((r) => r.elementId === 'GLOW');
  assert.equal(row?.block?.value, 'purple');
  assert.deepEqual(b.getState().derived.additionBlocks, [{ elementId: 'GLOW', block: 'Purple' }]);
  assert.equal(b.setAdditionBlock('GLOW', undefined), true);
  assert.equal(b.getState().character.additionBlocks, undefined);
  assert.equal(b.getState().additions.rows.find((r) => r.elementId === 'KNACK'), undefined);
});

test('the builder refuses a block the character does not hold, a type not cast through one, and what is not added', () => {
  // Fails if any of the three checks in `setAdditionBlock` is removed.
  const b = hero(['ORANGE']);
  b.addElement('GLOW');
  b.addElement('KNACK');
  const before = b.getState().character;
  assert.equal(b.setAdditionBlock('GLOW', 'purple'), false);
  assert.equal(b.setAdditionBlock('KNACK', 'orange'), false);
  assert.equal(b.setAdditionBlock('ORANGE', 'orange'), false);
  assert.equal(b.getState().character, before);
});

test('a block the character no longer holds stays the recorded value, is named, and the row says why', () => {
  // Fails if the row drops a recorded block it cannot find (the choice would show none while the file says Orange), or
  // if the derivation's warning does not reach the row.
  const b = hero(['ORANGE', 'PURPLE']);
  b.addElement('GLOW');
  b.setAdditionBlock('GLOW', 'orange');
  b.choose('build/callings', ['PURPLE']);
  const row = b.getState().additions.rows.find((r) => r.elementId === 'GLOW')!;
  assert.equal(row.block?.value, 'orange');
  assert.deepEqual(row.block?.options.at(-1), { key: 'orange', name: 'orange', held: false, label: 'orange (no longer on the character)' });
  assert.match(row.note ?? '', /no longer has it/);
});

test('the sheet and the text export say what an added spell is cast through, and nothing for anything else', () => {
  // Fails if `additionCasting` is not handed to the sheet (no `cast`), or if `listedAside` leaves it out.
  const b = hero(['ORANGE', 'PURPLE']);
  b.addElement('GLOW');
  b.addElement('KNACK');
  const listed = (state = b.getState()) => state.sheet.sections.flatMap((s) => s.elements);
  assert.equal(listed().find((e) => e.elementId === 'GLOW')?.cast, 'cast through no calling');
  assert.equal(listed().find((e) => e.elementId === 'KNACK')?.cast, undefined);
  b.setAdditionBlock('GLOW', 'orange');
  const glow = listed().find((e) => e.elementId === 'GLOW')!;
  assert.equal(listedAside(glow), 'always ready, cast as Orange');
  assert.match(sheetMarkdown(sheetDocument(b.getState())), /Glow \(always ready, cast as Orange\)/);
});

test('removing the addition removes its block', () => {
  // Fails if `setAdded` keeps a block for an element that is no longer added (the validator would refuse the file).
  const b = hero(['ORANGE']);
  b.addElement('GLOW');
  b.removeAddition('GLOW');
  assert.equal(b.getState().character.additionBlocks, undefined);
});
