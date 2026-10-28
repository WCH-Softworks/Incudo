/**
 * A stat block's printed lines and ability table — ADR 0126 decision 7. No game in the fixture: a beast prints its guard
 * ("12 (natural)"), its pace ("30 ft., climb 20 ft.") and its senses ("keen nose; awareness 11"), a second beast from an
 * older book prints a guard the beast's own rule moves, and the kind shows two scores with a save beside one of them.
 * Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, deriveCharacter, MapElementIndex, resolveCharacterKind, type Element, type GameSystem, type Rule } from '@incudo/core';

import { rowAside } from './sheet-document.ts';
import { sheetView } from './sheet.ts';

const num = (value: number) => ({ kind: 'number' as const, value });
const add = (name: string, value: number): Rule => ({ kind: 'stat', key: `stat:${name}`, name, value: num(value) });

function beast(id: string, source: string, guard: string, rules: Rule[]): Element {
  const setters = { guard: { value: guard }, pace: { value: '30 ft., climb 20 ft.' }, senses: { value: 'keen nose; awareness 11' } };
  return { id, type: 'Beast', name: id, source, setters, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

const SYSTEM: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Beast' }],
  stats: [
    { name: 'guard', label: 'Guard', default: 0 },
    { name: 'pace', label: 'Pace', default: 0 },
    { name: 'pace:climb', label: 'Climb', default: 0 },
    { name: 'awareness', label: 'Awareness', default: 0 },
    { name: 'brawn', label: 'Brawn', default: 10 },
    { name: 'wits', label: 'Wits', default: 12 },
    { name: 'wits:save', label: 'Wits', default: 3, signed: true },
  ],
  characterKinds: [
    {
      id: 'beast',
      name: 'Beast',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Beast'],
      buildSteps: [],
      sheet: {
        layout: 'statBlock',
        statBlock: { abilities: 'scores', saves: 'saves', wide: { section: 'what', sources: ['New Book'] } },
        sections: [
          { id: 'what', label: 'What', types: ['Beast'], place: 'head' },
          {
            id: 'head',
            label: 'Head',
            place: 'head',
            stats: ['guard', 'pace', 'awareness'],
            printed: [
              { types: ['Beast'], setter: 'guard', label: 'Guard, as printed', stat: 'guard' },
              { types: ['Beast'], setter: 'pace', label: 'Pace, as printed', stat: 'pace' },
              { types: ['Beast'], setter: 'senses', label: 'Senses', stat: 'awareness', at: 'last' },
            ],
          },
          { id: 'other', label: 'Other Paces', stats: ['pace:climb'], coveredByPrint: 'pace' },
          { id: 'scores', label: 'Scores', stats: ['brawn', 'wits'] },
          { id: 'saves', label: 'Saves', stats: ['brawn:save', 'wits:save'], showWhen: '{stat}' },
        ],
      },
    },
  ],
};

function view(element: Element) {
  const index = new MapElementIndex();
  index.add(element);
  const character = { ...createCharacter('test', 'beast'), choices: [{ ruleKey: 'build/beast', elementIds: [element.id] }] };
  return sheetView(deriveCharacter(character, SYSTEM, index), resolveCharacterKind(SYSTEM, 'beast'));
}

const NEW = beast('NEW', 'New Book', '12 (natural)', [add('guard', 12), add('pace', 30), add('pace:climb', 20), add('awareness', 11)]);
const OLD = beast('OLD', 'Old Book', '12 (natural)', [add('guard', 14), add('pace', 30), add('pace:climb', 20), add('awareness', 11)]);

test('a print of a row\'s own number is the row\'s value, read at the number the line says, and is not a line again', () => {
  // Fails if mergePrinted is not called (the three prints stay lines), reads the last number for every line (Pace 20), or
  // the first for the senses (11 against "keen nose" with no number first, then awareness).
  const head = view(NEW).sections.find((s) => s.id === 'head')!;
  assert.deepEqual(
    head.rows.map((r) => [r.label, r.value, r.printed ?? null]),
    [
      ['Guard', '12 (natural)', null],
      ['Pace', '30 ft., climb 20 ft.', null],
      ['Awareness', 'keen nose; awareness 11', null],
    ],
  );
  assert.deepEqual(head.printed, []);
});

test('a print whose number is not the one in force is written beside the row, and covers nothing', () => {
  // Fails if a differing print replaces the row (the derived 14 lost) or is dropped, or if a section is left out because a
  // stat it is covered by was printed beside its row rather than as its value.
  const sheet = view(OLD);
  const guard = sheet.sections.find((s) => s.id === 'head')!.rows.find((r) => r.stat === 'guard')!;
  assert.equal(guard.value, '14');
  assert.equal(rowAside(guard), 'printed 12 (natural)');
  // The pace's print is its value, so the other paces it names go.
  assert.equal(sheet.sections.some((s) => s.id === 'other'), false);
});

test('the ability table pairs each score with its shown save by the declared order, and opens wide only for the named books', () => {
  // Fails if a save is paired by position among the shown rows (Brawn would take Wits' save), or wide is read from anything
  // but the listed element's book.
  const block = view(NEW).statBlock!;
  assert.equal(block.wide, true);
  assert.deepEqual(
    block.table.map(({ ability, save }) => [ability.label, save?.value ?? null]),
    [
      ['Brawn', null],
      ['Wits', '+3'],
    ],
  );
  assert.equal(view(OLD).statBlock!.wide, false);
});
