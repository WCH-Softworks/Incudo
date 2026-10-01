/**
 * Refreshing a character's content — ADR 0082. No game: a tinker whose charm adds to its grit, and a source that has
 * since made the charm add more and grant a lamp. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BundleElementIndex, createCharacter, type Element, type GameSystem } from '@incudo/core';

import { contentChanges, refreshDocuments, refreshedElements, refreshNotice, refreshReview } from './content-refresh.ts';
import type { SheetDocument } from './sheet-document.ts';

const num = (value: number) => ({ kind: 'number' as const, value });

function element(id: string, name: string, extra: Partial<Element> = {}, sourceId = 'then'): Element {
  return { id, type: 'Charm', name, source: 'Book', setters: {}, rules: [], supports: [], origin: { sourceId, format: 'incudo' }, ...extra };
}

const system: GameSystem = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  version: '1.0.0',
  elementTypes: [{ name: 'Charm' }],
  stats: [{ name: 'grit', label: 'Grit', default: 10 }],
  characterKinds: [
    {
      id: 'tinker',
      name: 'Tinker',
      default: true,
      progression: { kind: 'none' },
      elementTypes: ['Charm'],
      buildSteps: [],
      sheet: { sections: [{ id: 'scores', label: 'Scores', stats: ['grit'] }, { id: 'gear', label: 'Gear', types: ['Charm'] }] },
    },
  ],
};

const charmThen = element('CHARM', 'Charm', { rules: [{ kind: 'stat', key: 'grit', name: 'grit', value: num(1) }] });
const charmNow = element('CHARM', 'Charm', {
  rules: [
    { kind: 'stat', key: 'grit', name: 'grit', value: num(3) },
    { kind: 'grant', id: 'LAMP' } as never,
  ],
}, 'now');
const lamp = element('LAMP', 'Lamp', {}, 'now');
const marker = element('MARKER', 'Marker');
const same = element('SAME', 'Same');

const embedded = new BundleElementIndex([charmThen, marker, same]);
const loaded = new BundleElementIndex([charmNow, lamp, { ...same, origin: { sourceId: 'now', format: 'incudo' } }]);

function tinker() {
  const character = createCharacter('test', 'tinker');
  character.choices = [{ ruleKey: 'build/gear', elementIds: ['CHARM', 'MARKER', 'SAME'] }];
  return character;
}

// Fails if where an element came from counts as a change (every element of a source added under another URL would read
// changed), if a changed definition is missed, or if a copy the sources lack is called changed rather than kept.
test('a copy differs when its definition does, and is kept when the sources lack it', () => {
  const changes = contentChanges(embedded, loaded);
  assert.deepEqual(changes.changed.map((e) => e.id), ['CHARM']);
  assert.deepEqual(changes.kept.map((e) => e.id), ['MARKER']);
  assert.deepEqual(contentChanges(new BundleElementIndex([same]), loaded), { changed: [], kept: [] });
});

// Fails if a refresh keeps the old copy, drops a copy the sources lack, or adds what the character does not carry.
test("a refresh takes up the sources' definitions and keeps every copy they lack", () => {
  const after = refreshedElements(embedded, loaded);
  assert.deepEqual(after.map((e) => e.id).sort(), ['CHARM', 'MARKER', 'SAME']);
  assert.equal(after.find((e) => e.id === 'CHARM'), charmNow);
  assert.equal(after.find((e) => e.id === 'MARKER'), marker);
});

// Fails if a kept copy alone is offered (a refresh would change nothing), or the count is not the changed copies'.
test('the offer counts changed copies, and nothing is offered when only kept ones differ', () => {
  assert.equal(refreshNotice(contentChanges(embedded, loaded)), 'Your sources have changed one of the elements this character was saved with.');
  assert.equal(refreshNotice({ changed: [charmThen, same], kept: [] }), 'Your sources have changed 2 of the elements this character was saved with.');
  assert.equal(refreshNotice({ changed: [], kept: [marker] }), undefined);
});

// Fails if the "before" sheet is not the character as it opens now (copies in front), if the "after" is not with the
// sources' definitions in front, or if a row's or a listed element's change is not reported.
test('the review is the Sheet as it opens now against the Sheet a refresh would make', () => {
  const { before, after } = refreshDocuments(tinker(), system, embedded, loaded);
  const review = refreshReview(before, after, contentChanges(embedded, loaded));
  assert.deepEqual(review.rows, [{ section: 'Scores', label: 'Grit', before: '11', after: '13' }]);
  assert.deepEqual(review.listed, [{ section: 'Gear', name: 'Lamp', change: 'added' }]);
  assert.deepEqual(review.changed, ['Charm']);
  assert.deepEqual(review.kept, ['Marker']);
  assert.equal(review.sameSheet, undefined);
});

// Fails if an element a section stops listing is not reported, a row that goes away reads anything but "—", or a review
// with no difference on the Sheet does not say so.
test('removed rows and elements are reported, and a refresh that changes no sheet says so', () => {
  const doc = (rows: SheetDocument['sections'][number]['rows'], names: string[]): SheetDocument => ({
    name: 'Nyx',
    title: 'Nyx',
    kindName: 'Tinker',
    elementCount: 1,
    sections: [{ id: 'scores', label: 'Scores', rows, printed: [], elements: names.map((n) => ({ elementId: n, name: n })) }],
  });
  const review = refreshReview(doc([{ stat: 'grit', label: 'Grit', value: '12' }], ['A', 'B']), doc([], ['A']), { changed: [charmThen], kept: [] });
  assert.deepEqual(review.rows, [{ section: 'Scores', label: 'Grit', before: '12', after: '—' }]);
  assert.deepEqual(review.listed, [{ section: 'Scores', name: 'B', change: 'removed' }]);
  const unchanged = refreshReview(doc([], ['A']), doc([], ['A']), { changed: [charmThen], kept: [] });
  assert.match(unchanged.sameSheet ?? '', /read the same/);
});
