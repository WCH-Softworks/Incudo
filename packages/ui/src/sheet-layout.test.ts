/**
 * A laid-out sheet's order — ADR 0126: the head band, the side column, then the main column tab by tab, and each section
 * marked with where it goes, so every reader of the document orders the same. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { SheetLayoutDef } from '@incudo/core';

import { sheetMarkdown } from './sheet-markdown.ts';
import { laidOut, type SheetSectionView } from './sheet.ts';

const view = (id: string): SheetSectionView => ({ id, label: id.toUpperCase(), section: id, rows: [{ stat: id, label: id, value: '1' }], printed: [], elements: [] });

const SHEET: SheetLayoutDef = {
  layout: 'page',
  tabs: [
    { id: 'first', label: 'First' },
    { id: 'second', label: 'Second' },
  ],
  sections: [
    { id: 'late', label: 'Late', tab: 'second' },
    { id: 'loose', label: 'Loose' },
    { id: 'side', label: 'Side', place: 'side' },
    { id: 'head', label: 'Head', place: 'head', tiles: true },
    { id: 'early', label: 'Early', place: 'main', tab: 'first' },
  ],
};

test('a laid-out sheet reads head, side, then each tab in order, a section naming no tab in the first', () => {
  // Fails if laidOut keeps the declared order (late first), ranks tabs by declaration of their sections rather than by
  // the sheet's tabs, or puts a section naming no tab anywhere but the first.
  const sections = laidOut(['late', 'loose', 'side', 'head', 'early'].map(view), SHEET);
  assert.deepEqual(sections.map((s) => s.id), ['head', 'side', 'loose', 'early', 'late']);
  assert.deepEqual(
    sections.map((s) => [s.place, s.tab ?? null]),
    [['head', null], ['side', null], ['main', 'first'], ['main', 'first'], ['main', 'second']],
  );
});

test('a sheet that declares no layout keeps its order and marks no place', () => {
  // Fails if laidOut orders or marks a sheet whose system says nothing of a layout (a user's own, ADR 0011).
  const { layout, ...plain } = SHEET;
  void layout;
  const sections = laidOut(['late', 'head'].map(view), plain);
  assert.deepEqual(sections.map((s) => s.id), ['late', 'head']);
  assert.equal(sections[0]!.place, undefined);
});

test('the text export writes the sections in the layout\'s order', () => {
  // Fails if the Markdown writes the document's sections in any order but the one the document gives them.
  const sections = laidOut(['late', 'head'].map(view), SHEET);
  const markdown = sheetMarkdown({ name: 'X', title: 'X', kindName: 'K', sections });
  assert.ok(markdown.indexOf('## HEAD') < markdown.indexOf('## LATE'));
});

test('a one-column reader heads each tab once, at its first section', async () => {
  // Fails if tabStarts heads every section of a tab, or a section in no tab, or a tab the sheet does not label.
  const { tabStarts } = await import('./sheet-document.ts');
  const sections = laidOut(['late', 'loose', 'side', 'head', 'early'].map(view), SHEET);
  assert.deepEqual([...tabStarts({ tabs: SHEET.tabs!, sections })], [
    ['loose', 'First'],
    ['late', 'Second'],
  ]);
  assert.deepEqual([...tabStarts({ sections })], []);
});
