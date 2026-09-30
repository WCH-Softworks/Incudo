/**
 * The print options step's view-model — ADR 0078.
 *
 * No game in the fixture: a sheet document with its own sections only, one holding a creature, one keeping a text, one
 * with all three parts. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, type Storage } from '@incudo/core';

import {
  cssString,
  DEFAULT_PRINT_OPTIONS,
  finishPrintStep,
  OWN_SECTIONS_LABEL,
  parsePrintOptions,
  printOptionsView,
  printPartsOf,
  printRendering,
  PRINT_OPTIONS_KEY,
  readPrintOptions,
  withPageNumbers,
  withPrintPart,
  withRunningName,
  type PrintOptions,
} from './print-options.ts';
import type { SheetDocument } from './sheet-document.ts';

const own: SheetDocument = {
  name: 'Nyx',
  title: 'Nyx',
  kindName: 'Tinker',
  elementCount: 4,
  sections: [{ id: 'scores', label: 'Scores', rows: [{ stat: 'grit', label: 'Grit', value: '14' }], printed: [], elements: [] }],
};

const withCreature: SheetDocument = {
  ...own,
  companions: {
    label: 'Contraptions',
    creatures: [{ elementId: 'C1', name: 'Clockwork Owl', notes: [], sections: [] }],
  },
};

const keeping: SheetDocument = {
  ...own,
  references: { label: 'Kept beside it', entries: [{ elementId: 'R1', name: 'Kraken', html: '<p>Bite.</p>' }] },
};

const all: SheetDocument = { ...withCreature, references: keeping.references };

test('a sheet with only its own sections is offered no parts at all', () => {
  // Fails if a parts group is shown on such a sheet (one checkbox that cannot be unticked is not a choice).
  assert.equal(printOptionsView(own, DEFAULT_PRINT_OPTIONS).parts, undefined);
  assert.deepEqual(printPartsOf(own), ['sections']);
  // A companions or references part with nothing in it is not a part.
  assert.deepEqual(printPartsOf({ ...own, companions: { label: 'Contraptions', creatures: [] }, references: { label: 'Kept', entries: [] } }), ['sections']);
});

test('the parts offered are the document\'s, labelled with its own labels, in the order it prints them', () => {
  const view = printOptionsView(all, DEFAULT_PRINT_OPTIONS);
  // Fails if a label is written here as a game noun ("Companions", "For reference") rather than read from the document.
  assert.deepEqual(
    view.parts!.choices.map((c) => [c.part, c.label, c.chosen]),
    [
      ['sections', OWN_SECTIONS_LABEL, true],
      ['companions', 'Contraptions', true],
      ['references', 'Kept beside it', true],
    ],
  );
  assert.deepEqual(printOptionsView(withCreature, DEFAULT_PRINT_OPTIONS).parts!.choices.map((c) => c.part), ['sections', 'companions']);
  assert.deepEqual(printOptionsView(keeping, DEFAULT_PRINT_OPTIONS).parts!.choices.map((c) => c.part), ['sections', 'references']);
});

test('the last part chosen stays chosen', () => {
  let options = withPrintPart(DEFAULT_PRINT_OPTIONS, withCreature, 'sections', false);
  assert.deepEqual(options.omit, ['sections']);
  const view = printOptionsView(withCreature, options);
  assert.deepEqual(view.parts!.choices.map((c) => [c.part, c.chosen, c.locked]), [
    ['sections', false, false],
    ['companions', true, true],
  ]);
  // Fails if the last part may be unticked: nothing would print.
  options = withPrintPart(options, withCreature, 'companions', false);
  assert.deepEqual(options.omit, ['sections']);
  // A remembered set leaving out every part this sheet has prints its own sections.
  const remembered: PrintOptions = { omit: ['sections', 'companions'], pageNumbers: true, runningName: true };
  assert.deepEqual(printOptionsView(withCreature, remembered).options.omit, ['companions']);
  assert.deepEqual(printOptionsView(own, remembered).options.omit, ['companions']);
});

test('a part a sheet lacks is never offered and a remembered omission of it is kept for the next sheet that has it', () => {
  const remembered: PrintOptions = { omit: ['companions'], pageNumbers: true, runningName: true };
  // Fails if the remembered omission puts a checkbox onto a sheet with no creatures.
  assert.deepEqual(printOptionsView(keeping, remembered).parts!.choices.map((c) => c.part), ['sections', 'references']);
  assert.deepEqual(printRendering(remembered, keeping).classes, ['print-page-numbers', 'print-running-name']);
  // Kept, so the sheet that has creatures leaves them out.
  const after = withPrintPart(remembered, keeping, 'references', false);
  assert.deepEqual(after.omit, ['companions', 'references']);
  assert.equal(printOptionsView(withCreature, after).parts!.choices.find((c) => c.part === 'companions')!.chosen, false);
  // Toggling a part the sheet lacks changes nothing.
  assert.deepEqual(withPrintPart(DEFAULT_PRINT_OPTIONS, keeping, 'companions', false).omit, []);
});

test('the classes name exactly the omitted parts the sheet has and the running items chosen', () => {
  let options = withPrintPart(DEFAULT_PRINT_OPTIONS, all, 'companions', false);
  options = withPrintPart(options, all, 'references', false);
  // Fails if an omitted part is left without its class.
  assert.deepEqual(printRendering(options, all).classes, ['print-omit-companions', 'print-omit-references', 'print-page-numbers', 'print-running-name']);
  options = withPageNumbers(withRunningName(DEFAULT_PRINT_OPTIONS, false), false);
  assert.deepEqual(printRendering(options, all), { classes: [] });
  assert.deepEqual(printRendering(withRunningName(DEFAULT_PRINT_OPTIONS, false), own), { classes: ['print-page-numbers'] });
  const view = printOptionsView(own, options);
  assert.equal(view.pageNumbers.chosen, false);
  assert.equal(view.runningName.chosen, false);
});

test('the running name is one @page rule holding the name and nothing else, on the page its combination prints on', () => {
  assert.equal(printRendering(DEFAULT_PRINT_OPTIONS, own).pageRule, '@page sheet-named-numbered { @top-left { content: "Nyx"; } }');
  assert.equal(printRendering(withPageNumbers(DEFAULT_PRINT_OPTIONS, false), own).pageRule, '@page sheet-named { @top-left { content: "Nyx"; } }');
  assert.equal(printRendering(withRunningName(DEFAULT_PRINT_OPTIONS, false), own).pageRule, undefined);
  // Fails if the name is written into the rule unescaped: `A "B" \ C` would end the string and the rule.
  const tricky = { ...own, title: 'A "B" \\ C}\n@page{' };
  const rule = printRendering(DEFAULT_PRINT_OPTIONS, tricky).pageRule!;
  assert.equal(rule, '@page sheet-named-numbered { @top-left { content: "A \\"B\\" \\\\ C}\\a @page{"; } }');
  // Nothing but the name's string sits between the rule's own braces.
  const content = /content: ("(?:[^"\\]|\\.)*");/.exec(rule)![1]!;
  assert.equal(rule.replace(content, 'X'), '@page sheet-named-numbered { @top-left { content: X; } }');
});

test('cssString escapes a quote, a backslash, a line break and a control character, and nothing else', () => {
  assert.equal(cssString('Nyx'), '"Nyx"');
  assert.equal(cssString('a"b'), '"a\\"b"');
  assert.equal(cssString('a\\b'), '"a\\\\b"');
  assert.equal(cssString('a\nb\r\tc'), '"a\\a b\\d \\9 c"');
  assert.equal(cssString('\u0000\u007f'), '"\\0 \\7f "');
  assert.equal(cssString("Ænir's Ōwl ☼"), '"Ænir\'s Ōwl ☼"');
});

/** Storage that counts its writes. */
class CountingStorage extends MemoryStorage {
  writes = 0;
  override async write(key: string, value: string): Promise<void> {
    this.writes++;
    await super.write(key, value);
  }
}

test('remembered: written on Print, not on Cancel, and read when the step opens', async () => {
  const storage = new CountingStorage();
  assert.deepEqual(await readPrintOptions(storage), DEFAULT_PRINT_OPTIONS);
  const chosen = withPageNumbers(withPrintPart(DEFAULT_PRINT_OPTIONS, all, 'references', false), false);
  // Fails if Cancel writes: what was in force stays in force, and nothing is stored.
  assert.deepEqual(await finishPrintStep(storage, 'cancel', chosen, DEFAULT_PRINT_OPTIONS), DEFAULT_PRINT_OPTIONS);
  assert.equal(storage.writes, 0);
  assert.equal(await storage.read(PRINT_OPTIONS_KEY), null);
  assert.deepEqual(await finishPrintStep(storage, 'print', chosen, DEFAULT_PRINT_OPTIONS), chosen);
  assert.equal(storage.writes, 1);
  assert.deepEqual(await readPrintOptions(storage), chosen);
});

test('a stored value that does not parse falls back to the defaults, field by field', async () => {
  assert.deepEqual(parsePrintOptions(null), DEFAULT_PRINT_OPTIONS);
  assert.deepEqual(parsePrintOptions('not json'), DEFAULT_PRINT_OPTIONS);
  assert.deepEqual(parsePrintOptions('[1,2]'), DEFAULT_PRINT_OPTIONS);
  // A part nobody knows is not left out; the known one is.
  assert.deepEqual(parsePrintOptions('{"omit":["spells","references"],"pageNumbers":false}'), { omit: ['references'], pageNumbers: false, runningName: true });
  // A field of the wrong shape is the default's, and the others are kept.
  assert.deepEqual(parsePrintOptions('{"omit":"companions","pageNumbers":"no","runningName":false}'), { omit: [], pageNumbers: true, runningName: false });
  // A storage that cannot be read is the defaults.
  const broken: Storage = {
    read: () => Promise.reject(new Error('no')),
    write: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    list: () => Promise.resolve([]),
  };
  assert.deepEqual(await readPrintOptions(broken), DEFAULT_PRINT_OPTIONS);
});
