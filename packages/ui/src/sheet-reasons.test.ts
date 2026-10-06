/**
 * A row says what moved it that the sheet lists nowhere — ADR 0095.
 *
 * No game in the fixture: a "grit" row worked out from "nerve", a feature list that leaves out what content hides, and a
 * header that lists one hidden element anyway. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseStatValue, type Element, type ResolvedStat, type SheetSectionDef, type StatContribution, type StatDef } from '@incudo/core';

import { rowAside } from './sheet-document.ts';
import { sheetMarkdown } from './sheet-markdown.ts';
import { sheetSections, type SheetRow, type SheetSource } from './sheet.ts';

function element(id: string, type: string, hidden: boolean, sheetName?: string): Element {
  return {
    id, type, name: id, source: 'Test Book', setters: {}, rules: [], supports: [], origin: { sourceId: 'test', format: 'incudo' },
    ...(hidden || sheetName ? { sheet: { ...(hidden ? { display: false } : {}), ...(sheetName ? { alt: sheetName } : {}) } } : {}),
  };
}

const resolved = (name: string, value: number, contributions: StatContribution[] = []): [string, ResolvedStat] => [name, { name, value, contributions }];

const STATS: StatDef[] = [
  { name: 'grit', label: 'Grit', derive: parseStatValue('nerve') },
  { name: 'nerve', label: 'Nerve' },
  { name: 'pluck', label: 'Pluck', derive: parseStatValue('pluck:mark') },
  { name: 'pluck:mark', label: 'Pluck mark' },
];

const SECTIONS: SheetSectionDef[] = [
  { id: 'head', label: 'Head', types: ['Origin'] },
  { id: 'numbers', label: 'Numbers', stats: ['grit', 'pluck'], mark: { stat: '{stat}:mark', per: 'one', labels: ['trained'] } },
  { id: 'features', label: 'Features', types: ['Feature', 'Origin Trait', 'Origin'], omitHidden: true },
];

const SHOWN = element('Shown', 'Feature', false);
const QUIET = element('Quiet', 'Feature', true);
const CALM = element('Calm', 'Origin Trait', true, 'Calm Mind');
const DRILL = element('Drill', 'Feature', true);
const ORIGIN = element('Origin', 'Origin', true);

function rows(stats: Array<[string, ResolvedStat]>, elements: Element[] = [SHOWN, QUIET, CALM, DRILL, ORIGIN], sections = SECTIONS): Map<string, SheetRow> {
  const source: SheetSource = { stats: new Map([...stats, resolved('one', 1)]), elements };
  return new Map(sheetSections(sections, source, { stats: STATS, blockStats: [] }).flatMap((s) => s.rows).map((r) => [r.stat, r]));
}

test('a hidden element the sheet leaves out is named on the row it contributes to, by its sheet name, in order', () => {
  // Fails with the row's own contributions not read ("pluck" names nothing), or the element's name used over the shorter
  // one content gives it on a sheet ("Calm" where "Calm Mind" is written).
  const got = rows([resolved('pluck', 5, [{ value: 2, from: 'Quiet' }, { value: 1, from: 'Calm' }, { value: 2, from: 'Shown' }])]);
  assert.deepEqual(got.get('pluck')!.including, ['Quiet', 'Calm Mind']);
  assert.equal(rowAside(got.get('pluck')!), 'including Quiet and Calm Mind');
});

test('a row the kind works out from another stat names what moved that stat', () => {
  // Fails with the kind's `derive` not followed ("grit" names nothing).
  const got = rows([resolved('nerve', 3, [{ value: 3, from: 'Quiet' }]), resolved('grit', 3)]);
  assert.deepEqual(got.get('grit')!.including, ['Quiet']);
});

test('nothing is named that the sheet lists, that moved nothing, or that a shown mark already says', () => {
  // Fails with a listed feature named (Shown), a hidden one another section lists named (Origin, in the head), a
  // contribution of 0 named (Drill), or the mark's stat followed (Quiet, which the row's "trained" already says).
  const got = rows([
    resolved('pluck', 4, [{ value: 2, from: 'Shown' }, { value: 1, from: 'Origin' }, { value: 0, from: 'Drill' }, { value: 1, from: 'base' }]),
    resolved('pluck:mark', 1, [{ value: 1, from: 'Quiet' }]),
  ]);
  assert.equal(got.get('pluck')!.mark?.label, 'trained');
  assert.equal(got.get('pluck')!.including, undefined);
  assert.equal(rowAside(got.get('pluck')!), 'trained');
});

test('a sheet with no section leaving hidden elements out names nothing', () => {
  // Fails with hidden elements named whatever the sections say: a stat block lists everything it holds (ADR 0076).
  const sections = SECTIONS.map(({ omitHidden: _, ...section }) => section);
  const got = rows([resolved('pluck', 2, [{ value: 2, from: 'Quiet' }])], undefined, sections);
  assert.equal(got.get('pluck')!.including, undefined);
});

test('the words follow what is beside the row and its mark, and every export writes them', () => {
  // Fails with `rowAside` ignoring `including`, or joining it to the mark with a comma, which reads as one more name.
  assert.equal(rowAside({ beside: '+3', including: ['A'] }), '+3; including A');
  assert.equal(rowAside({ mark: { label: 'trained', count: 1 }, including: ['A', 'B', 'C'] }), 'trained; including A, B and C');
  assert.equal(rowAside({ beside: '+3' }), '+3');
  const sections = sheetSections(SECTIONS, { stats: new Map([resolved('pluck', 5, [{ value: 2, from: 'Quiet' }]), resolved('one', 1)]), elements: [QUIET] }, { stats: STATS, blockStats: [] });
  const document = { name: 'Test', title: 'Test', kindName: 'Test', elementCount: 1, sections };
  assert.match(sheetMarkdown(document), /Pluck: 5 \(including Quiet\)/);
});
