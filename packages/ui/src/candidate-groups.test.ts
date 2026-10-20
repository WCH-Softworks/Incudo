/**
 * A picker's candidates in groups by a note the kind declares with `groups` (a spell list by level). No game in the
 * fixture: "tier" is what 5e's spell `level` is. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapElementIndex, type CandidateNoteDef, type Element } from '@incudo/core';
import { byLowestCandidateGroup, candidateGroups, OTHER_CANDIDATES_LABEL } from './candidate-label.ts';

function charm(id: string, tier?: string, type = 'Charm'): Element {
  return {
    id,
    type,
    name: id,
    source: 'test',
    setters: tier === undefined ? {} : { tier: { value: tier } },
    rules: [],
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

const index = new MapElementIndex();
index.addAll([charm('C10', '10'), charm('C2', '2'), charm('C0A', '0'), charm('C0B', ' 0 '), charm('BARE'), charm('RING', '1', 'Ring')]);
const note: CandidateNoteDef = { types: ['Charm'], setter: 'tier', label: 'Tier {value}', labels: { '0': 'Minor' }, groups: true };

test('candidates are grouped by the note, in the values\' order read as numbers, each keeping its own order, Other last', () => {
  // Fails if the values sort as text ("10" before "2"), if a group re-sorts what it was given, or if what the note does
  // not reach (no setter, another type) is dropped rather than listed last.
  assert.deepEqual(candidateGroups(['C10', 'C0B', 'C2', 'BARE', 'C0A', 'RING'], [note], index), [
    { label: 'Minor', options: ['C0B', 'C0A'] },
    { label: 'Tier 2', options: ['C2'] },
    { label: 'Tier 10', options: ['C10'] },
    { label: OTHER_CANDIDATES_LABEL, options: ['BARE', 'RING'] },
  ]);
});

test('no grouping without a note that groups, and none for one group', () => {
  // Fails if a note without `groups` groups (every kind's spell notes would), or if a list all of one value gets a heading.
  assert.equal(candidateGroups(['C10', 'C2'], [{ ...note, groups: undefined }], index), undefined);
  assert.equal(candidateGroups(['C0A', 'C0B'], [note], index), undefined);
  assert.equal(candidateGroups(['BARE', 'RING'], [note], index), undefined, 'nothing grouped is no grouping');
});

test('decisions are ordered by the lowest group they offer, stably, ungrouped last', () => {
  // A Wizard's cantrip pool before its spellbook though it opened later. Fails if the values sort as text (a tier 10 pool
  // before a tier 2 one), if equal pools change places, or if a pool the note does not reach is put first.
  const d = (name: string, candidates: string[]) => ({ name, candidates });
  const ordered = byLowestCandidateGroup(
    [d('book', ['C10', 'C2']), d('rings', ['RING']), d('high', ['C10']), d('minor', ['C0A']), d('book2', ['C2'])],
    [note],
    index,
  );
  assert.deepEqual(ordered.map((x) => x.name), ['minor', 'book', 'book2', 'high', 'rings']);
  assert.deepEqual(byLowestCandidateGroup([d('a', ['C10']), d('b', ['C0A'])], [{ ...note, groups: undefined }], index).map((x) => x.name), ['a', 'b']);
});
