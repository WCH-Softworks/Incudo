/**
 * The sheet as one document, written as Markdown and exported through the save port — ADR 0075.
 *
 * No game in the fixture: a character with two sections (one with rows beside values and a listed element whose
 * prerequisites are unmet, one printing lines), a held creature that one element gave, and three kept elements (one with
 * text, one with none, one not loaded). Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FileSaveOptions, FileSaver, SavedFile } from '@incudo/core';

import type { CompanionsView } from './companions.ts';
import type { ReferenceRow } from './references.ts';
import { NO_KEPT_TEXT, PREREQUISITES_UNMET, referenceEntry, sheetDocument, type SheetDocumentSource } from './sheet-document.ts';
import { exportSheet } from './sheet-export.ts';
import { sheetMarkdown, UNNAMED_CHARACTER } from './sheet-markdown.ts';
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
        { stat: 'grit', label: 'Grit', value: '14', beside: '+2' },
        { stat: 'luck', label: 'Luck', value: '-1' },
      ],
      printed: [],
      elements: [
        { elementId: 'G1', name: 'Wrench' },
        { elementId: 'G2', name: 'Spanner_of_*Doom*', prerequisitesUnmet: true },
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
      '- Grit: 14 (+2)',
      '- Luck: -1',
      '- Wrench',
      `- Spanner\\_of\\_\\*Doom\\* (${PREREQUISITES_UNMET})`,
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
