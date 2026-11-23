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

test('with no limit given, nothing is cut', () => {
  const labels = Array.from({ length: 300 }, (_, i) => `Option ${String(i).padStart(3, '0')}`);
  const result = searchCandidates(options(labels), '');
  assert.equal(result.matches.length, 300);
  assert.equal(result.matchCount, 300);
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

test('a list given in order keeps it: d4 before d10, with nothing typed and with a query', () => {
  // Perturbation: dropping `ordered` sorts the phone's die list by label, d10 first (found on the emulator, ADR 0132).
  const dice = ['d4', 'd6', 'd8', 'd10', 'd12'].map((label) => ({ id: label, label }));
  assert.deepEqual(searchCandidates(dice, '', Infinity, undefined, true).matches.map((option) => option.label), ['d4', 'd6', 'd8', 'd10', 'd12']);
  assert.deepEqual(searchCandidates(dice, 'd1', Infinity, undefined, true).matches.map((option) => option.label), ['d10', 'd12']);
  // Unordered, as content is listed: alphabetically.
  assert.deepEqual(searchCandidates(dice, '').matches.map((option) => option.label), ['d10', 'd12', 'd4', 'd6', 'd8']);
});
