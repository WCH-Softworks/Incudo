/**
 * A sheet section's own line under each element it lists — ADR 0112. No game in the fixture: "Move" and "aid" stand for
 * 5e's Companion Action and companion:attack. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Element, ResolvedStat, SheetSectionDef } from '@incudo/core';

import { sheetMarkdown } from './sheet-markdown.ts';
import { sheetSections, type SheetSource } from './sheet.ts';

function element(id: string, extra: Partial<Element> = {}): Element {
  return { id, type: 'Move', name: id, source: 'Test Book', setters: {}, rules: [], supports: [], origin: { sourceId: 'test', format: 'incudo' }, ...extra };
}

const stat = (name: string, value: number): [string, ResolvedStat] => [name, { name, value, contributions: [] }];

const SECTION: SheetSectionDef = {
  id: 'moves',
  label: 'Moves',
  types: ['Move'],
  elementNote: { text: 'Its holder adds {{aid}} and {{hurt}}.', showWhen: 'aid' },
};

const BITE = element('Bite', { sheet: { description: 'It bites.' } });
const DODGE = element('Dodge');

function listed(stats: Array<[string, ResolvedStat]>, section: SheetSectionDef = SECTION) {
  const source: SheetSource = { stats: new Map(stats), elements: [BITE, DODGE] };
  return sheetSections([section], source, { stats: [], blockStats: [] })[0]!.elements;
}

test('the note is filled and written under every element the section lists, apart from content’s text', () => {
  // Perturbation: merge the note into `text` and Bite's text is no longer content's.
  const elements = listed([stat('aid', 2), stat('hurt', 3)]);
  assert.deepEqual(elements.map((e) => e.note), ['Its holder adds 2 and 3.', 'Its holder adds 2 and 3.']);
  assert.equal(elements[0]!.text, 'It bites.');
});

test('a note whose showWhen reads zero is left out, and one with no showWhen is always written', () => {
  // Perturbation: ignore showWhen and the note is written with nothing to add.
  assert.deepEqual(listed([stat('aid', 0)]).map((e) => e.note), [undefined, undefined]);
  const always = listed([], { ...SECTION, elementNote: { text: 'Always.' } });
  assert.deepEqual(always.map((e) => e.note), ['Always.', 'Always.']);
});

test('the Markdown writes the note as a line of the item, after content’s text or alone', () => {
  // Perturbation: drop the note from the item and neither line carries it.
  const elements = listed([stat('aid', 2), stat('hurt', 2)]);
  const markdown = sheetMarkdown({ name: 'A', title: 'A', kindName: 'Kind', sections: [{ id: 'moves', label: 'Moves', section: 'moves', rows: [], printed: [], elements }] } as never);
  assert.match(markdown, /\*\*Bite\*\*: It bites\. {2}\n {2}Its holder adds 2 and 2\./);
  assert.match(markdown, /- Dodge {2}\n {2}Its holder adds 2 and 2\./);
});
