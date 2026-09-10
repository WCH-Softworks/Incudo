/**
 * The one escape hatch in `incudo character verify`.
 *
 * `character verify` derives a save twice — against a corpus, and against nothing but the save
 * — and a difference means the save is not self-contained (ADR 0012). There is exactly one
 * case where a difference is fine: a character imported from Aurora embeds elements Aurora's
 * app invented at runtime and no content file declares, so the *corpus* side is the short one.
 *
 * These tests exist for the dangerous direction. A bug that made this too permissive would
 * turn a genuine ADR 0012 violation into a silent pass, which is the failure the whole command
 * is there to catch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { accountedFor, type DerivedSummary } from './character-commands.ts';

function summary(patch: Partial<DerivedSummary> = {}): DerivedSummary {
  return {
    character: { id: 'x', name: 'X', systemId: 'test', kind: 'pc', progress: 1 },
    elements: ['ID_A', 'ID_B'],
    stats: { vigour: 10 },
    pendingChoices: [],
    problems: [],
    ...patch,
  };
}

test('an element only the save has, plus the unresolved report for it, is accounted for', () => {
  const withSources = summary({
    problems: [
      { level: 'error', code: 'unresolved-element', message: 'missing', elementId: 'ID_EXTRA' },
    ],
  });
  const withoutSources = summary({ elements: ['ID_A', 'ID_B', 'ID_EXTRA'] });

  assert.equal(accountedFor(withSources, withoutSources, new Set(['ID_EXTRA'])), true);
});

test('an unexpected element is never accounted for — that is the real failure', () => {
  const withSources = summary();
  const withoutSources = summary({ elements: ['ID_A', 'ID_B', 'ID_SURPRISE'] });

  assert.equal(accountedFor(withSources, withoutSources, new Set(['ID_EXTRA'])), false);
});

test('an element missing from the save side is not accounted for either', () => {
  // The save losing something is exactly what ADR 0012 forbids, whichever ids were expected.
  const withSources = summary({ elements: ['ID_A', 'ID_B', 'ID_EXTRA'] });
  const withoutSources = summary({ elements: ['ID_A'] });

  assert.equal(accountedFor(withSources, withoutSources, new Set(['ID_EXTRA'])), false);
});

test('a differing stat is never accounted for, even when the element lists are explained', () => {
  const withSources = summary();
  const withoutSources = summary({
    elements: ['ID_A', 'ID_B', 'ID_EXTRA'],
    stats: { vigour: 12 },
  });

  assert.equal(
    accountedFor(withSources, withoutSources, new Set(['ID_EXTRA'])),
    false,
    'an extra element that also moves a number is the case worth failing on',
  );
});

test('a differing pending choice is never accounted for', () => {
  const withSources = summary();
  const withoutSources = summary({
    elements: ['ID_A', 'ID_B', 'ID_EXTRA'],
    pendingChoices: [{ ruleKey: 'k', label: 'L', remaining: 1 }],
  });

  assert.equal(accountedFor(withSources, withoutSources, new Set(['ID_EXTRA'])), false);
});

test('a problem about something else is never accounted for', () => {
  const withSources = summary({
    problems: [
      { level: 'error', code: 'unresolved-element', message: 'missing', elementId: 'ID_EXTRA' },
      { level: 'error', code: 'over-selected', message: 'too many', elementId: 'ID_A' },
    ],
  });
  const withoutSources = summary({ elements: ['ID_A', 'ID_B', 'ID_EXTRA'] });

  assert.equal(accountedFor(withSources, withoutSources, new Set(['ID_EXTRA'])), false);
});

test('with nothing expected, nothing is accounted for', () => {
  // The ordinary case: a natively built character, whose corpus is a superset. Any difference
  // at all is a failure, and this must not become a way to wave one through.
  const withSources = summary();
  const withoutSources = summary({ elements: ['ID_A'] });

  assert.equal(accountedFor(withSources, withoutSources, new Set()), false);
});
