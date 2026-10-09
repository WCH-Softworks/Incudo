/**
 * What a new system's file is (ADR 0104): its id, the starts offered, and what each writes. Validation against the real
 * schema, and a character built in the starter, are `tools/verify/src/system-new.test.ts`.
 *
 * Perturbations, each run and failing here: a taken id returned as it is (a new system would replace one); taken ids
 * compared with case; the suffix not cut to the length limit; an overlay written without `version`; a copy keeping its
 * parent's id, or not recording `copiedFrom`; a copy of a copy recording the copy instead of its origin; a blank name
 * accepted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { GameSystem } from '@incudo/core';

import { copiedFromNote, newSystemChoices, newSystemFile, systemIdFor } from './system-new.ts';

const shipped = {
  formatVersion: 1,
  id: 'base',
  name: 'Base Game',
  description: 'The base game.',
  version: '2.3.0',
  elementTypes: [{ name: 'Thing' }],
  stats: [{ name: 'grit', default: 1 }],
  characterKinds: [{ id: 'pc', name: 'PC', default: true, progression: { kind: 'none' }, elementTypes: [], buildSteps: [], sheet: { sections: [] } }],
  suggestedSources: [{ name: 'Its content', url: 'https://example.invalid/base.index' }],
} as unknown as GameSystem;

test('an id is made from the name in the schema\'s alphabet', () => {
  assert.equal(systemIdFor('My Game', []), 'my-game');
  assert.equal(systemIdFor('  Ça va — Édition 2!  ', []), 'ca-va-edition-2');
  assert.equal(systemIdFor('***', []), undefined);
  assert.equal(systemIdFor('', []), undefined);
  assert.equal(systemIdFor('x'.repeat(80), [])!.length, 64);
});

test('a taken id, in any case, is never returned: a suffix is added', () => {
  assert.equal(systemIdFor('Base', ['base']), 'base-2');
  assert.equal(systemIdFor('Base', ['BASE', 'base-2']), 'base-3');
  const long = 'x'.repeat(80);
  const first = systemIdFor(long, [])!;
  const second = systemIdFor(long, [first])!;
  assert.equal(second.length, 64);
  assert.ok(second.endsWith('-2'));
  assert.notEqual(second, first);
});

test('the starts are the starter, then changes to and a copy of each shipped system', () => {
  assert.deepEqual(
    newSystemChoices([shipped]).map((choice) => [choice.key, choice.label]),
    [
      ['starter', 'A small starter system'],
      ['changes:base', 'Changes to Base Game'],
      ['copy:base', 'A copy of Base Game'],
    ],
  );
});

test('a name is required, and one with no letter or digit is refused with a sentence', () => {
  const blank = newSystemFile({ kind: 'starter' }, '   ', []);
  assert.deepEqual(blank, { ok: false, message: 'Give the system a name.' });
  const symbols = newSystemFile({ kind: 'starter' }, '!!!', []);
  assert.equal(symbols.ok, false);
  assert.match(!symbols.ok ? symbols.message : '', /letter or digit/);
});

test('changes to a system are an overlay that changes nothing but its own fields', () => {
  const made = newSystemFile({ kind: 'changes', of: shipped }, 'Our Table', ['base']);
  assert.ok(made.ok);
  assert.equal(made.fileName, 'our-table.json');
  assert.deepEqual(JSON.parse(made.text), {
    formatVersion: 1,
    id: 'our-table',
    name: 'Our Table',
    description: 'Changes to Base Game.',
    version: '0.1.0',
    extends: 'base',
  });
  assert.ok(made.text.endsWith('}\n'));
});

test('a copy is the whole system under a new id, recording what it was copied from', () => {
  const made = newSystemFile({ kind: 'copy', of: shipped }, 'Base Game', ['base']);
  assert.ok(made.ok);
  const written = JSON.parse(made.text) as Record<string, unknown>;
  assert.equal(written['id'], 'base-game');
  assert.equal(written['copiedFrom'], 'base');
  assert.equal(written['version'], '0.1.0');
  assert.equal(written['description'], 'A copy of Base Game.');
  assert.equal('extends' in written, false);
  const same = (value: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'name', 'description', 'version', 'copiedFrom'].includes(key)));
  assert.deepEqual(same(written), same(shipped as unknown as Record<string, unknown>));
  // The id comes first, as a reader of the file looks for it.
  assert.deepEqual(Object.keys(written).slice(0, 6), ['formatVersion', 'id', 'name', 'description', 'version', 'copiedFrom']);
});

test('a copy of a copy records the origin, so it still reaches the content', () => {
  const copy = { ...shipped, id: 'mine', copiedFrom: 'base' } as GameSystem;
  const made = newSystemFile({ kind: 'copy', of: copy }, 'Again', ['base', 'mine']);
  assert.ok(made.ok);
  assert.equal((JSON.parse(made.text) as Record<string, unknown>)['copiedFrom'], 'base');
});

test('a copy\'s card names its origin, or the id it writes when that is not loaded', () => {
  const names: Record<string, string> = { base: 'Base Game' };
  assert.equal(copiedFromNote({}, (id) => names[id]), undefined);
  assert.equal(
    copiedFromNote({ copiedFrom: 'base' }, (id) => names[id]),
    'Uses the content of Base Game, which it was copied from. Later fixes to Base Game do not reach it.',
  );
  assert.equal(copiedFromNote({ copiedFrom: 'gone' }, (id) => names[id]), 'A copy of "gone", which Incudo does not have.');
});
