import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CandidateNoteDef, Element } from '@incudo/core';
import { candidateLabel, candidateNote } from './candidate-label.ts';
import { searchCandidates } from './candidate-search.ts';

// No game in the fixture: a "Charm" has a "tier" and tier 0 reads "Trivial", which is the same
// claim a spell's level makes without core ever learning what a spell is.

function element(id: string, type: string, source: string, setters: Record<string, string> = {}): Element {
  return {
    id,
    type,
    name: id,
    source,
    setters: Object.fromEntries(Object.entries(setters).map(([k, value]) => [k, { value }])),
    rules: [],
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

const NOTES: CandidateNoteDef[] = [
  { types: ['Charm'], setter: 'tier', label: 'Tier {value}', labels: { '0': 'Trivial' } },
];

test('a note is printed between the name and the source', () => {
  assert.equal(
    candidateLabel(element('Glow', 'Charm', 'Book', { tier: '3' }), NOTES),
    'Glow (Tier 3) — Book',
  );
});

test('an exact-value label beats the general one', () => {
  assert.equal(candidateNote(element('Glow', 'Charm', 'Book', { tier: '0' }), NOTES), 'Trivial');
});

test('no note for a type the system did not ask about, or a candidate without the setter', () => {
  assert.equal(candidateLabel(element('Glow', 'Widget', 'Book', { tier: '3' }), NOTES), 'Glow — Book');
  assert.equal(candidateLabel(element('Glow', 'Charm', 'Book'), NOTES), 'Glow — Book');
  assert.equal(candidateLabel(element('Glow', 'Charm', 'Book', { tier: '  ' }), NOTES), 'Glow — Book');
});

test('a kind that declares no notes prints what it always did', () => {
  assert.equal(candidateLabel(element('Glow', 'Charm', 'Book', { tier: '3' })), 'Glow — Book');
  assert.equal(candidateLabel(element('Glow', 'Charm', '', { tier: '3' })), 'Glow');
  assert.equal(candidateLabel(element('Glow', 'Charm', '')), 'Glow');
});

test('the note is part of what a search matches, so "trivial" narrows to the tier 0 ones', () => {
  const options = [
    element('Glow', 'Charm', 'Book', { tier: '0' }),
    element('Blaze', 'Charm', 'Book', { tier: '3' }),
    element('Flicker', 'Charm', 'Book', { tier: '0' }),
  ].map((e) => ({ id: e.id, label: candidateLabel(e, NOTES) }));
  assert.deepEqual(
    searchCandidates(options, 'trivial').matches.map((m) => m.id),
    ['Flicker', 'Glow'],
  );
});
