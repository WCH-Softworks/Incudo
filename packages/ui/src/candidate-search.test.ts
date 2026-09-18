import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchCandidates, type CandidateOption } from './candidate-search.ts';

function options(labels: string[]): CandidateOption<string>[] {
  return labels.map((label) => ({ id: label, label }));
}

test('an empty query returns every option, alphabetically, up to the limit', () => {
  const result = searchCandidates(options(['Wizard', 'Fighter', 'Elf']), '', 2);
  assert.deepEqual(
    result.matches.map((m) => m.label),
    ['Elf', 'Fighter'],
  );
  assert.equal(result.matchCount, 3);
});

test('a query filters by substring, case-insensitively', () => {
  const result = searchCandidates(options(['Elf', 'Half-Elf', 'Dwarf']), 'ELF');
  assert.deepEqual(
    result.matches.map((m) => m.label),
    ['Elf', 'Half-Elf'],
  );
  assert.equal(result.matchCount, 2);
});

test('an exact match ranks first, then a prefix match, then a plain substring', () => {
  const result = searchCandidates(options(['Half-Elf', 'Elf', 'Elf — Volo\'s Guide']), 'elf');
  assert.deepEqual(
    result.matches.map((m) => m.label),
    ['Elf', "Elf — Volo's Guide", 'Half-Elf'],
  );
});

test('matchCount reports the true total even when the limit cuts the list', () => {
  const result = searchCandidates(options(['A', 'B', 'C', 'D']), '', 2);
  assert.equal(result.matches.length, 2);
  assert.equal(result.matchCount, 4);
});
