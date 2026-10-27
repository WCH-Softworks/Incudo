/**
 * What a section folds into another entry, leaves out because a mark says it, and writes with its answers — ADR 0126.
 *
 * No game in the fixture: a tinker holds knacks and gizmos. "Kit" grants "Toolbox", which grants "Wrench" and "Pliers"
 * (two steps); "Grip" contributes only to the mark stat of a marked row; "Spare" contributes to that and to something
 * else; "Style" chooses "Flourish" (a line of its own) and nothing else, "Hunt" (a line of its own) chooses "Quarry"
 * (none), "Boost" chooses "Bump" twice (a type no section lists), and "Note" says nothing and chooses nothing. Each test
 * names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  deriveCharacter,
  MapElementIndex,
  resolveCharacterKind,
  type Element,
  type GameSystem,
  type Rule,
} from '@incudo/core';

import { alsoText, listedName, listedParts } from './sheet-document.ts';
import { sheetMarkdown } from './sheet-markdown.ts';
import { sheetView, type SheetSectionView } from './sheet.ts';

function element(id: string, type: string, name: string, rules: Rule[] = [], extra: Partial<Element> = {}): Element {
  return { id, type, name, source: 'Test Book', setters: {}, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' }, ...extra };
}
const grant = (id: string, type = 'Knack'): Rule => ({ kind: 'grant', key: `grant:${id}`, type, id });
const add = (name: string, value: number): Rule => ({ kind: 'stat', key: `stat:${name}`, name, value: { kind: 'number', value } });
const select = (name: string, type: string, number = 1): Rule => ({ kind: 'select', key: `select:${name}`, type, name, number });
const line = (text: string) => ({ sheet: { description: text } });

const ELEMENTS: Element[] = [
  element('KIT', 'Knack', 'Kit', [grant('TOOLBOX')]),
  element('TOOLBOX', 'Knack', 'Toolbox', [grant('WRENCH'), grant('PLIERS')]),
  element('WRENCH', 'Knack', 'Wrench'),
  element('PLIERS', 'Knack', 'Pliers'),
  element('GRIP', 'Knack', 'Grip', [add('grip:knack', 2)]),
  element('SPARE', 'Knack', 'Spare', [add('grip:knack', 2), add('luck', 1)]),
  element('STYLE', 'Gizmo', 'Style', [select('Style', 'Gizmo')]),
  element('FLOURISH', 'Gizmo', 'Flourish', [], line('Twirl it.')),
  element('HUNT', 'Gizmo', 'Hunt', [select('Quarry', 'Gizmo')], line('Track it.')),
  element('QUARRY', 'Gizmo', 'Quarry'),
  element('BOOST', 'Gizmo', 'Boost', [select('Bump', 'Bump', 2)]),
  element('BUMP', 'Bump', 'Bump +1'),
  element('NOTE', 'Gizmo', 'Note'),
];

function system(fields: { fold?: boolean; omitMarked?: boolean; answers?: boolean } = { fold: true, omitMarked: true, answers: true }): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test System',
    version: '1.0.0',
    elementTypes: [{ name: 'Knack' }, { name: 'Gizmo' }, { name: 'Bump' }],
    stats: [
      { name: 'grip', label: 'Grip', default: 1 },
      { name: 'grip:knack', default: 0 },
      { name: 'knack', default: 2 },
      { name: 'luck', label: 'Luck', default: 0 },
    ],
    characterKinds: [
      {
        id: 'tinker',
        name: 'Tinker',
        default: true,
        progression: { kind: 'none' },
        elementTypes: ['Knack', 'Gizmo', 'Bump'],
        buildSteps: [],
        sheet: {
          sections: [
            { id: 'skills', label: 'Skills', stats: ['grip'], mark: { stat: '{stat}:knack', per: 'knack', labels: ['handy'] } },
            {
              id: 'knacks',
              label: 'Knacks',
              types: ['Knack'],
              ...(fields.fold ? { fold: true } : {}),
              ...(fields.omitMarked ? { omitMarked: true } : {}),
            },
            { id: 'gizmos', label: 'Gizmos', types: ['Gizmo'], ...(fields.answers ? { answers: true } : {}) },
          ],
        },
      },
    ],
  };
}

function sheet(sys = system()): SheetSectionView[] {
  const index = new MapElementIndex();
  for (const e of ELEMENTS) index.add(e);
  const character = createCharacter('test', 'tinker', { name: 'T' });
  character.choices = [
    { ruleKey: 'build/all', elementIds: ['KIT', 'GRIP', 'SPARE', 'STYLE', 'HUNT', 'BOOST', 'NOTE'] },
    { ruleKey: 'STYLE/select:Style', elementIds: ['FLOURISH'] },
    { ruleKey: 'HUNT/select:Quarry', elementIds: ['QUARRY'] },
    { ruleKey: 'BOOST/select:Bump', elementIds: ['BUMP', 'BUMP'] },
  ];
  const kind = resolveCharacterKind(sys, 'tinker');
  const derived = deriveCharacter(character, sys, index);
  return sheetView(derived, kind, new Set(), (id) => index.get(id)).sections;
}

const names = (section: SheetSectionView | undefined): string[] => (section?.elements ?? []).map((e) => listedName(e));

test('a section that folds lists a granter once and carries what it reaches, through two steps', () => {
  // Fails if foldGrants is not called, or if the walk stops at the first step (Wrench and Pliers listed on their own).
  const knacks = sheet().find((s) => s.id === 'knacks')!;
  assert.deepEqual(names(knacks), ['Kit', 'Spare']);
  assert.deepEqual(knacks.elements[0]!.includes?.map((r) => r.name), ['Toolbox', 'Wrench', 'Pliers']);
  // Without the field nothing is folded.
  const plain = sheet(system({})).find((s) => s.id === 'knacks')!;
  assert.deepEqual(names(plain).sort(), ['Grip', 'Kit', 'Pliers', 'Spare', 'Toolbox', 'Wrench']);
});

test('a section that leaves out what a mark says leaves out only what moves nothing but the mark', () => {
  // Fails if omitMarkedElements is not called (Grip listed), or reads "any" for "every" contribution (Spare left out).
  const knacks = sheet().find((s) => s.id === 'knacks')!;
  assert.deepEqual(knacks.omitted?.map((r) => r.name), ['Grip']);
  assert.ok(names(knacks).includes('Spare'));
});

test('answers: a chooser with nothing to say is written as its answer, a quiet answer is folded in, the rest named once', () => {
  // Fails if foldAnswers is not called, or if a chooser with a line of its own is folded away (Hunt gone), or if an
  // answer listed nowhere is named under a chooser that has a line of its own.
  const gizmos = sheet().find((s) => s.id === 'gizmos')!;
  assert.deepEqual(names(gizmos).sort(), ['Boost: Bump +1, Bump +1', 'Hunt: Quarry', 'Note', 'Style: Flourish']);
  const { entries, also } = listedParts(gizmos);
  assert.deepEqual(entries.map((e) => listedName(e)).sort(), ['Boost: Bump +1, Bump +1', 'Hunt: Quarry', 'Style: Flourish']);
  assert.equal(alsoText(also), 'Note');
  // Without the field the section lists as before, and has no "Also" line.
  const plain = sheet(system({})).find((s) => s.id === 'gizmos')!;
  assert.deepEqual(names(plain).sort(), ['Boost', 'Flourish', 'Hunt', 'Note', 'Quarry', 'Style']);
  assert.deepEqual(listedParts(plain).also, []);
});

test('the export writes the folded section, its answers and its "Also" line, and no included name', () => {
  // Fails if the Markdown writes every element as an entry again, or writes what a granter includes.
  const sections = sheet();
  const markdown = sheetMarkdown({ name: 'T', title: 'T', kindName: 'Tinker', sections });
  assert.match(markdown, /^- \*\*Style: Flourish\*\*: Twirl it\.$/m);
  assert.match(markdown, /^- Also: Note$/m);
  assert.doesNotMatch(markdown, /Wrench/);
  assert.match(markdown, /^- Kit$/m);
});
