/**
 * The sheet's Descriptions part — ADR 0114. No game in the fixture: "Knack" and "Gear" stand for 5e's features and items.
 * Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapElementIndex, type Element } from '@incudo/core';

import { formValues, type FormMap } from './form-fill.ts';
import { printPartsOf } from './print-options.ts';
import { sheetDescriptions } from './sheet-descriptions.ts';
import type { SheetDocument } from './sheet-document.ts';
import { sheetMarkdown } from './sheet-markdown.ts';
import type { SheetSectionView } from './sheet.ts';

function element(id: string, description?: string): Element {
  return { id, type: 'Knack', name: id, source: 'Test Book', setters: {}, rules: [], supports: [], origin: { sourceId: 'test', format: 'incudo' }, ...(description !== undefined ? { description } : {}) };
}

const index = new MapElementIndex();
index.addAll([
  element('Quick', '<p>Moves <b>fast</b>.</p>'),
  element('Sly', '<p>Hides well.</p>'),
  element('Blank'),
  element('Wrench', '<p>Turns bolts.</p>'),
  element('Bite', '<p>It bites.</p>'),
]);

const section = (id: string, label: string, ids: string[], describe: boolean): SheetSectionView => ({
  id,
  section: id,
  label,
  rows: [],
  printed: [],
  elements: ids.map((elementId) => ({ elementId, name: elementId })),
  ...(describe ? { describe: true as const } : {}),
});

test('only a describing section’s elements, once each, by section, those with no text left out', () => {
  // Perturbation: ignore `describe` and Wrench is described; drop the seen set and Quick is described twice.
  const part = sheetDescriptions(
    [section('knacks', 'Knacks', ['Quick', 'Blank', 'Sly'], true), section('gear', 'Gear', ['Wrench'], false), section('more', 'More', ['Quick'], true)],
    { creatures: [{ elementId: 'OWL', name: 'Owl', heldBy: [], notes: [], unfilled: 0, sections: [section('acts', 'Actions', ['Bite'], true)] }] },
    index,
  );
  assert.deepEqual(part?.groups.map((g) => [g.label, g.entries.map((e) => e.name)]), [
    ['Knacks', ['Quick', 'Sly']],
    ['Owl: Actions', ['Bite']],
  ]);
  assert.equal(part?.label, 'Descriptions');
  assert.equal(part?.groups[0]!.entries[0]!.html, '<p>Moves <b>fast</b>.</p>');
});

test('no describing section with a described element is no part', () => {
  assert.equal(sheetDescriptions([section('gear', 'Gear', ['Wrench'], false), section('knacks', 'Knacks', ['Blank'], true)], undefined, index), undefined);
});

const knacks = section('knacks', 'Knacks', ['Quick', 'Sly'], true);
const doc = (descriptions = sheetDescriptions([knacks], undefined, index)): SheetDocument => ({
  name: 'Nyx',
  title: 'Nyx',
  kindName: 'Tinker',
  sections: [knacks],
  ...(descriptions ? { descriptions } : {}),
});

test('the Markdown writes the part after the sections: a heading, a group, an element, its text', () => {
  // Perturbation: leave the part out of the export and none of these lines are there.
  const markdown = sheetMarkdown(doc());
  assert.match(markdown, /## Descriptions\n\n### Knacks\n\n#### Quick\n\nMoves \*\*fast\*\*\.\n\n#### Sly\n\nHides well\.\n/);
  assert.ok(markdown.indexOf('## Knacks') < markdown.indexOf('## Descriptions'));
});

test('print offers the part when the document has it', () => {
  // Perturbation: drop the part from printPartsOf and the step cannot leave it out.
  assert.deepEqual(printPartsOf(doc()), ['sections', 'descriptions']);
  const { descriptions: _none, ...without } = doc();
  assert.deepEqual(printPartsOf(without), ['sections']);
});

const map = (lines: number, perLine = 40): FormMap => ({
  formatVersion: 1,
  id: 'test',
  name: 'a test form',
  publisher: 'Nobody',
  download: 'https://example.invalid/form',
  system: 'test',
  kinds: ['pc'],
  encoding: 'WinAnsi',
  fields: { Box: 'text' },
  fill: [{ flow: { fields: ['Box'], capacity: [{ lines, perLine, fontSize: 7 }] }, list: { section: 'knacks', join: '\n', describe: true } }],
});

test('the form writes whole texts where all of them fit, and the lines alone where they do not', () => {
  // Perturbation: drop `describe` from the rule and the roomy box gets only the names; skip the fit check and the tight
  // box gets "Quick: Moves fast." and leaves Sly off.
  assert.equal(formValues(doc(), map(4)).text.Box, 'Quick: Moves fast.\nSly: Hides well.');
  const tight = formValues(doc(), map(1));
  assert.equal(tight.text.Box, 'Quick', 'one line holds no whole text, and only the first name');
  assert.deepEqual(tight.leftOff, ["1 of 2 Knacks past the form's box"]);
  assert.equal(formValues(doc(), map(2, 12)).text.Box, 'Quick\nSly', 'two short lines hold both names and not both texts');
});
