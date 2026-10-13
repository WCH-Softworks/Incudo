/**
 * The sheet as one document, written as Markdown and exported through the save port — ADR 0075.
 *
 * No game in the fixture: a character with two sections (one with rows beside values and a listed element whose
 * prerequisites are unmet, one printing lines), a held creature that one element gave, and three kept elements (one with
 * text, one with none, one not loaded). Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FileSaveOptions, FileSaver, PaperSize, PdfWriter, SavedFile } from '@incudo/core';

import type { CompanionsView } from './companions.ts';
import type { ReferenceRow } from './references.ts';
import {
  listedAside,
  listedDice,
  listedName,
  NO_KEPT_TEXT,
  PREREQUISITES_UNMET,
  referenceEntry,
  rowAside,
  sheetDocument,
  UNNAMED_CHARACTER,
  type SheetDocumentSource,
} from './sheet-document.ts';
import { exportSheet, exportSheetPdf } from './sheet-export.ts';
import { sheetMarkdown } from './sheet-markdown.ts';
import type { SheetView } from './sheet.ts';

const sheet: SheetView = {
  kindName: 'Tinker',
  elementCount: 17,
  unfilled: 0,
  sections: [
    {
      id: 'scores',
      label: 'Scores',
      description: 'What the tinker is made of.',
      rows: [
        { stat: 'grit', label: 'Grit', value: '14', beside: '+2', mark: { label: 'deft', count: 2 } },
        { stat: 'luck', label: 'Luck', value: '-1', mark: { label: 'handy_*', count: 1 } },
      ],
      printed: [],
      elements: [
        { elementId: 'G1', name: 'Wrench', progress: 3, dice: { count: 3, sides: 10 } },
        { elementId: 'G2', name: 'Spanner_of_*Doom*', prerequisitesUnmet: true },
        { elementId: 'G3', name: 'Zap', group: { value: '1', label: 'Tier_1' }, prepared: { label: 'packed', always: false } },
      ],
    },
    {
      id: 'first',
      label: 'First Line',
      rows: [],
      printed: [{ elementId: 'C1', label: 'Hit Dice', text: '5 [d8s]' }],
      elements: [],
    },
  ],
};

const companions: CompanionsView = {
  label: 'Companions',
  description: 'Creatures it holds.',
  creatures: [
    {
      elementId: 'C1',
      name: 'Clockwork Owl',
      source: 'Test Book',
      heldBy: ['Owl Kit', 'Brass Charm'],
      notes: ['One feature this creature names is not in any loaded source.'],
      unfilled: 0,
      sections: [{ id: 'stats', label: 'Stat Block', rows: [{ stat: 'companion:grit', label: 'Grit', value: '8', beside: '-1' }], printed: [], elements: [] }],
    },
  ],
};

const rows: ReferenceRow[] = [
  { elementId: 'R1', name: 'Kraken', source: 'Test Book', type: 'Information', known: true, shown: true, description: '<h4 /><p><em>Gargantuan</em></p><h4>Actions</h4><p>Bite.</p>' },
  { elementId: 'R2', name: 'Blank', type: 'Information', known: true, shown: true, description: '<p> </p>' },
  { elementId: 'R3', name: 'R3', type: '', known: false, shown: false, note: 'Not in the loaded content. Load the content it came from to see it.' },
];

const source: SheetDocumentSource = {
  character: { name: 'Nyx' },
  sheet,
  companions,
  references: { label: 'For reference', rows },
  freeform: { available: false, label: '', groups: [] },
  descriptions: undefined,
};

test('the document holds what the pane showed, with the sentences the pane used to compose', () => {
  const doc = sheetDocument(source);
  assert.equal(doc.name, 'Nyx');
  assert.equal(doc.kindName, 'Tinker');
  assert.equal(doc.sections, sheet.sections, 'the sections are the sheet view\'s, not a copy of their rows');
  // Fails if `from` is not written here (the pane composed "From …" itself).
  assert.equal(doc.companions!.creatures[0]!.from, 'From Owl Kit, Brass Charm');
  assert.deepEqual(doc.companions!.creatures[0]!.notes, companions.creatures[0]!.notes);
  // Fails if a kept element with no text gets no sentence, or one not shown loses its own.
  assert.deepEqual(
    doc.references!.entries.map((e) => [e.name, e.html !== undefined, e.note]),
    [
      ['Kraken', true, undefined],
      ['Blank', false, NO_KEPT_TEXT],
      ['R3', false, rows[2]!.note],
    ],
  );
});

test('a creature nothing names has no from line, and a character keeping nothing has no reference part', () => {
  const doc = sheetDocument({
    ...source,
    companions: { ...companions, creatures: [{ ...companions.creatures[0]!, heldBy: [] }] },
    references: { label: 'For reference', rows: [] },
    freeform: { available: false, label: '', groups: [] },
  });
  assert.equal(doc.companions!.creatures[0]!.from, undefined);
  assert.equal(doc.references, undefined);
  assert.equal(sheetDocument({ ...source, companions: undefined }).companions, undefined);
});

test('the Build pane\'s kept element reads the same entry', () => {
  assert.deepEqual(referenceEntry(rows[1]!), sheetDocument(source).references!.entries[1]);
});

test('the Markdown: title, kind, a heading per section, one list of rows, elements and printed lines, escaped', () => {
  const markdown = sheetMarkdown(sheetDocument(source));
  assert.equal(
    markdown,
    [
      '# Nyx',
      '',
      'Tinker',
      '',
      '## Scores',
      '',
      'What the tinker is made of.',
      '',
      '- Grit: 14 (+2, deft)',
      '- Luck: -1 (handy\\_\\*)',
      '- Wrench 3 (3d10)',
      `- Spanner\\_of\\_\\*Doom\\* (${PREREQUISITES_UNMET})`,
      '- Zap (Tier\\_1, packed)',
      '',
      '## First Line',
      '',
      '- Hit Dice: 5 [d8s]',
      '',
      '## Companions',
      '',
      'Creatures it holds.',
      '',
      '### Clockwork Owl · Test Book',
      '',
      'From Owl Kit, Brass Charm',
      '',
      'One feature this creature names is not in any loaded source.',
      '',
      '#### Stat Block',
      '',
      '- Grit: 8 (-1)',
      '',
      '## For reference',
      '',
      '### Kraken · Test Book',
      '',
      '*Gargantuan*',
      '',
      '#### Actions',
      '',
      'Bite.',
      '',
      '### Blank',
      '',
      NO_KEPT_TEXT,
      '',
      '### R3',
      '',
      'Not in the loaded content. Load the content it came from to see it.',
      '',
    ].join('\n'),
  );
  // Fails if the pane's element count is written: it counts internal elements and says nothing on paper.
  assert.doesNotMatch(markdown, /17/);
});

test('the title is the name trimmed, or unnamed when blank, and the Markdown and a print say the same (ADR 0077)', () => {
  // Fails if the title is the untrimmed name, or a blank name is left blank: a printed page would be headed by nothing.
  assert.equal(sheetDocument(source).title, 'Nyx');
  assert.equal(sheetDocument({ ...source, character: { name: '  Nyx the Bold ' } }).title, 'Nyx the Bold');
  assert.equal(sheetDocument({ ...source, character: { name: ' \t ' } }).title, UNNAMED_CHARACTER);
  // The name as written stays beside it: the Sheet's name field edits that, not the title.
  assert.equal(sheetDocument({ ...source, character: { name: '  Nyx the Bold ' } }).name, '  Nyx the Bold ');
  // Markup is the title as written; each renderer escapes it (the Markdown below, the pane as React text).
  assert.equal(sheetDocument({ ...source, character: { name: '<b>Nyx</b>' } }).title, '<b>Nyx</b>');
  // Fails if the Markdown computes its own heading instead of reading the document's.
  const retitled = { ...sheetDocument(source), title: 'Read from the document' };
  assert.match(sheetMarkdown(retitled), /^# Read from the document\n/);
});

test('a blank name is titled as unnamed, and a name that reads as markup is escaped', () => {
  assert.match(sheetMarkdown(sheetDocument({ ...source, character: { name: '  ' } })), new RegExp(`^# ${UNNAMED_CHARACTER}\\n`));
  // Fails if the title is not escaped: `<b>` would reach a Markdown reader as a tag.
  assert.match(sheetMarkdown(sheetDocument({ ...source, character: { name: '<b>Nyx</b>' } })), /^# \\<b>Nyx\\<\/b>\n/);
});

// --- the export ------------------------------------------------------------------------------------

class FakeSaver implements FileSaver {
  available = true;
  unavailableReason?: string;
  saved: { bytes: Uint8Array; options: FileSaveOptions }[] = [];
  answer: SavedFile | null | Error = { name: 'nyx.md' };
  async save(bytes: Uint8Array, options: FileSaveOptions): Promise<SavedFile | null> {
    if (this.answer instanceof Error) throw this.answer;
    this.saved.push({ bytes, options });
    return this.answer;
  }
}

test('an export writes the Markdown as UTF-8 through the save port, named after the character, and returns a name only', async () => {
  const saver = new FakeSaver();
  const doc = sheetDocument({ ...source, character: { name: 'Nyx Évora' } });
  const result = await exportSheet(saver, doc);
  assert.deepEqual(result, { status: 'saved', file: { name: 'nyx.md' } });
  // Like a copy, it returns nothing a caller could point the editing session at (ADR 0038).
  assert.deepEqual(Object.keys(result), ['status', 'file']);
  const [{ bytes, options }] = saver.saved as [{ bytes: Uint8Array; options: FileSaveOptions }];
  assert.equal(new TextDecoder().decode(bytes), sheetMarkdown(doc));
  assert.equal(options.suggestedName, 'nyx-evora.md');
  assert.deepEqual(options.extensions, ['md']);
});

test('a cancel is an answer, a failed write is reported, and no dialog means no export', async () => {
  const saver = new FakeSaver();
  saver.answer = null;
  assert.deepEqual(await exportSheet(saver, sheetDocument(source)), { status: 'cancelled' });
  saver.answer = new Error('The disk is full.');
  assert.deepEqual(await exportSheet(saver, sheetDocument(source)), { status: 'failed', message: 'The disk is full.' });
  const none = new FakeSaver();
  none.available = false;
  none.unavailableReason = 'No dialog here.';
  assert.deepEqual(await exportSheet(none, sheetDocument(source)), { status: 'failed', message: 'No dialog here.' });
  assert.equal(none.saved.length, 0);
});

// ADR 0079. Fails if the mark is left out of what follows a value, if the two are not joined in one pair of parentheses,
// or if a row with neither gets empty ones.
test("what follows a row's value is what is beside it and its mark, or nothing", () => {
  assert.equal(rowAside({ beside: '+2', mark: { label: 'deft', count: 2 } }), '+2, deft');
  assert.equal(rowAside({ mark: { label: 'handy', count: 1 } }), 'handy');
  assert.equal(rowAside({ beside: '+2' }), '+2');
  assert.equal(rowAside({}), undefined);
});

// ADR 0079. Fails if a track's count is left out of what a listed element is called (the Markdown above reads "Wrench"
// too), if it is put before the shorter name, or if an element with none gets a trailing space or a 0.
test("a listed element rooting a track is called with the track's count, after the name the sheet gives it", () => {
  assert.equal(listedName({ name: 'Paladin', progress: 3 }), 'Paladin 3');
  assert.equal(listedName({ name: 'The Tinkerer', sheetName: 'Tinker', progress: 12 }), 'Tinker 12');
  assert.equal(listedName({ name: 'Wrench' }), 'Wrench');
});

// ADR 0079. Fails if a listed element's group or prepared mark is left out of its wording (the Markdown above reads "Zap"),
// if the two are in the other order, or if an element with neither gets empty parentheses.
test("what follows a listed element's name is its group and its prepared mark, or nothing", () => {
  assert.equal(listedAside({ group: { value: '1', label: 'Level 1' }, prepared: { label: 'prepared', always: false } }), 'Level 1, prepared');
  assert.equal(listedAside({ group: { value: '0', label: 'Cantrip' } }), 'Cantrip');
  assert.equal(listedAside({ prepared: { label: 'always prepared', always: true } }), 'always prepared');
  assert.equal(listedAside({}), undefined);
});

// ADR 0079. Fails if a listed element's dice are left out of its wording (the Markdown above reads "Wrench 3"), if they
// follow the group or prepared mark rather than lead, or if the count and die are written the other way round.
test("a listed element's track dice lead what follows its name", () => {
  assert.equal(listedDice({ dice: { count: 3, sides: 10 } }), '3d10');
  assert.equal(listedDice({}), undefined);
  assert.equal(listedAside({ dice: { count: 12, sides: 6 }, group: { value: '1', label: 'Tier 1' } }), '12d6, Tier 1');
  assert.equal(listedAside({ dice: { count: 1, sides: 8 } }), '1d8');
});

// --- the PDF export (ADR 0079) -----------------------------------------------------------------------

class FakePdfWriter implements PdfWriter {
  available = true;
  unavailableReason?: string;
  asked: PaperSize[] = [];
  answer: Uint8Array | Error = new Uint8Array([37, 80, 68, 70]);
  async write(paper: PaperSize): Promise<Uint8Array> {
    this.asked.push(paper);
    if (this.answer instanceof Error) throw this.answer;
    return this.answer;
  }
}

// Fails if the paper is not handed to the writer, if the writer's bytes are not what is saved, if the file is not named
// after the character as a .pdf, or if the result carries more than a name.
test('a PDF export asks the writer for the page on the paper chosen and saves its bytes, named after the character', async () => {
  const writer = new FakePdfWriter();
  const saver = new FakeSaver();
  saver.answer = { name: 'nyx.pdf' };
  const paper = { widthInches: 8.5, heightInches: 11 };
  const result = await exportSheetPdf(writer, saver, sheetDocument({ ...source, character: { name: 'Nyx Évora' } }), paper);
  assert.deepEqual(result, { status: 'saved', file: { name: 'nyx.pdf' } });
  assert.deepEqual(writer.asked, [paper]);
  const [{ bytes, options }] = saver.saved as [{ bytes: Uint8Array; options: FileSaveOptions }];
  assert.deepEqual([...bytes], [37, 80, 68, 70]);
  assert.equal(options.suggestedName, 'nyx-evora.pdf');
  assert.deepEqual(options.extensions, ['pdf']);
});

// Fails if a writer that failed still opens the save dialog, if no writer or no dialog is not reported in its own words,
// or if a cancel is reported as a failure.
test('a PDF that cannot be written asks for no file, and a cancel is an answer', async () => {
  const paper = { widthInches: 8.5, heightInches: 11 };
  const failing = new FakePdfWriter();
  failing.answer = new Error('This WebView2 cannot print to PDF.');
  const saver = new FakeSaver();
  assert.deepEqual(await exportSheetPdf(failing, saver, sheetDocument(source), paper), { status: 'failed', message: 'This WebView2 cannot print to PDF.' });
  assert.equal(saver.saved.length, 0);
  const none = new FakePdfWriter();
  none.available = false;
  none.unavailableReason = 'Windows only.';
  assert.deepEqual(await exportSheetPdf(none, saver, sheetDocument(source), paper), { status: 'failed', message: 'Windows only.' });
  assert.equal(none.asked.length, 0);
  const noDialog = new FakeSaver();
  noDialog.available = false;
  noDialog.unavailableReason = 'No dialog here.';
  const writer = new FakePdfWriter();
  assert.deepEqual(await exportSheetPdf(writer, noDialog, sheetDocument(source), paper), { status: 'failed', message: 'No dialog here.' });
  assert.equal(writer.asked.length, 0);
  saver.answer = null;
  assert.deepEqual(await exportSheetPdf(new FakePdfWriter(), saver, sheetDocument(source), paper), { status: 'cancelled' });
});
