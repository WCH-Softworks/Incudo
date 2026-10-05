/**
 * The words on a source's line for what it misses and which switched-off source had it (ADR 0052, ADR 0090). Each case
 * names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { missingNote } from './source-notes.ts';

const names: Record<string, string> = { core: 'Core', phb: "Player's Handbook" };
const nameOf = (id: string): string => names[id] ?? id;

test('nothing missing is no note', () => {
  assert.equal(missingNote({ references: [], additions: [] }, undefined, nameOf), undefined);
});

test('the summary says what is missing as before, and names no source when none had it', () => {
  // Perturbation: naming a source for an id no record holds would put a sentence under the upstream typo.
  const note = missingNote({ references: ['ID_TYPO'], additions: [] }, undefined, nameOf)!;
  assert.equal(note.summary, 'Refers to 1 thing none of your enabled sources contain.');
  assert.deepEqual(note.switchedOff, []);
  const additions = missingNote({ references: [], additions: ['ID_A', 'ID_A'] }, [], nameOf)!;
  assert.equal(additions.summary, '2 of its additions to other content have nothing to add to.');
  assert.deepEqual(additions.additions, ['ID_A'], 'a target once');
});

test('a switched-off source is named with how much of it it had, at its last load', () => {
  // Perturbation: counting the additions twice (one per append, not per target) makes Core's "all of them" a number.
  const note = missingNote(
    { references: ['ID_A', 'ID_B'], additions: ['ID_T', 'ID_T'] },
    [
      { sourceId: 'core', references: ['ID_A', 'ID_B'], additions: ['ID_T'] },
      { sourceId: 'phb', references: ['ID_B'], additions: [] },
    ],
    nameOf,
  )!;
  assert.equal(note.summary, 'Refers to 2 things none of your enabled sources contain, and 2 of its additions to other content have nothing to add to.');
  assert.deepEqual(
    note.switchedOff.map((s) => s.sentence),
    [
      'Core, which is switched off, had all of them when it was last loaded.',
      "Player's Handbook, which is switched off, had 1 of them when it was last loaded.",
    ],
  );
  assert.deepEqual(note.switchedOff[0]!.ids, ['ID_A', 'ID_B', 'ID_T']);
  // Perturbation: listing references and targets without merging them repeats an id that is both, and "all of them"
  // becomes a count.
  const both = missingNote(
    { references: ['ID_A'], additions: ['ID_A'] },
    [{ sourceId: 'core', references: ['ID_A'], additions: ['ID_A'] }],
    nameOf,
  )!;
  assert.deepEqual(both.switchedOff[0]!.ids, ['ID_A']);
  assert.equal(both.switchedOff[0]!.sentence, 'Core, which is switched off, had it when it was last loaded.');
  const one = missingNote({ references: ['ID_A'], additions: [] }, [{ sourceId: 'core', references: ['ID_A'], additions: [] }], nameOf)!;
  assert.equal(one.switchedOff[0]!.sentence, 'Core, which is switched off, had it when it was last loaded.');
});
