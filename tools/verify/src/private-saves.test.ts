/**
 * The helpers `library.test.ts` and `save-copy.test.ts` use to fail without naming a character.
 *
 * Those two tests only run where a set of real saves are installed, so nothing in CI would notice
 * a helper that had started printing what it exists to hide. This runs everywhere, on a made-up
 * name. Each case first checks that the *plain* call does print the sentinel, so a pass cannot
 * mean the sentinel never reached the reporter in the first place.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';

import type { DerivedSummary } from './derived-summary.ts';
import {
  assertNoneReported,
  assertSameBytes,
  assertSameSummary,
  saveLabel,
  unnamed,
} from './private-saves.ts';

const SENTINEL = 'Sentinel-Character-Name';

/** Everything a test reporter could print about a failure: message, stack, and own properties. */
function everythingPrinted(error: unknown): string {
  return inspect(error, { depth: 6, showHidden: false });
}

async function rejection(work: () => Promise<unknown>): Promise<unknown> {
  return work().then(
    () => assert.fail('expected a failure'),
    (error: unknown) => error,
  );
}

function summaryNamed(name: string, hp: number): DerivedSummary {
  return {
    character: { id: 'id-1', name, systemId: 'dnd5e', kind: 'pc', progress: 1 },
    elements: ['ID_A'],
    stats: { hp },
    pendingChoices: [],
    problems: [],
  };
}

test('saveLabel is a one-based position, as aurora-oracle.test.ts writes it', () => {
  assert.equal(saveLabel(0, 9), 'save 1/9');
  assert.equal(saveLabel(8, 9), 'save 9/9');
});

test('unnamed drops an fs error whole: no path in the message, the stack or a property', async () => {
  const missing = join(tmpdir(), 'no-such-folder-for-this-test', `${SENTINEL}.incu`);

  const raw = await rejection(() => readFile(missing));
  assert.ok(everythingPrinted(raw).includes(SENTINEL), 'the plain error does name the file');

  const wrapped = await rejection(() => unnamed('reading it', () => readFile(missing)));
  assert.ok(wrapped instanceof Error);
  assert.equal(wrapped.message, 'reading it failed (ENOENT)');
  assert.equal((wrapped as { path?: unknown }).path, undefined);
  assert.equal(wrapped.cause, undefined);
  assert.ok(!everythingPrinted(wrapped).includes(SENTINEL));
});

test('unnamed reports only the class of an error with no code, since a parse error quotes its input', async () => {
  // `JSON.parse` quotes the start of what it choked on, truncated: `"Sentinel-C"...`.
  const quoted = SENTINEL.slice(0, 8);
  const raw = await rejection(async () => JSON.parse(SENTINEL));
  assert.ok(everythingPrinted(raw).includes(quoted), 'the plain error quotes the text');

  const wrapped = await rejection(() => unnamed('reading it', async () => JSON.parse(SENTINEL)));
  assert.equal((wrapped as Error).message, 'reading it failed (SyntaxError)');
  assert.ok(!everythingPrinted(wrapped).includes(quoted));
});

test('unnamed returns what the work returns', async () => {
  assert.equal(await unnamed('adding', async () => 1 + 1), 2);
});

test('assertSameSummary names the fields that differ and prints no value', () => {
  assert.throws(
    () => assert.deepEqual(summaryNamed(SENTINEL, 5), summaryNamed(SENTINEL, 6)),
    (error) => everythingPrinted(error).includes(SENTINEL),
    'a plain deepEqual does print the name',
  );

  assertSameSummary(summaryNamed(SENTINEL, 5), summaryNamed(SENTINEL, 5), 'equal summaries');

  const failure = (() => {
    try {
      assertSameSummary(summaryNamed(SENTINEL, 5), summaryNamed(SENTINEL, 6), 'save 1/9 derives');
    } catch (error) {
      return error;
    }
    return assert.fail('expected a difference');
  })();
  assert.ok(!everythingPrinted(failure).includes(SENTINEL));
  assert.match((failure as Error).message, /save 1\/9 derives \(differs in: stats\)/);

  // A name that differs is reported as the field, and neither name is printed.
  assert.throws(
    () => assertSameSummary(summaryNamed(SENTINEL, 5), summaryNamed('Other', 5), 'save 1/9'),
    (error) => /differs in: character\)/.test((error as Error).message) && !everythingPrinted(error).includes(SENTINEL),
  );
  assert.throws(() => assertSameSummary(summaryNamed('a', 1), undefined, 'save 1/9'), /nothing was recorded/);
});

test('assertNoneReported prints a count, never the items', () => {
  assertNoneReported([], 'nothing to report');

  const items = [`${SENTINEL}.incu: could not be read`];
  assert.throws(
    () => assert.deepEqual(items, []),
    (error) => everythingPrinted(error).includes(SENTINEL),
    'a plain deepEqual does print the item',
  );
  assert.throws(
    () => assertNoneReported(items, 'save 1/9 should read'),
    // Node appends its own `1 !== 0` to a custom message, so the message is checked by its start.
    (error) =>
      (error as Error).message.startsWith('save 1/9 should read (1 reported)') &&
      !everythingPrinted(error).includes(SENTINEL),
  );
});

test('assertSameBytes compares bytes and prints none of them', () => {
  assertSameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]), 'same');
  assert.throws(() => assertSameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]), 'changed'), {
    message: 'changed',
  });
  assert.throws(() => assertSameBytes(undefined, new Uint8Array([1]), 'missing'), { message: 'missing' });
  assert.throws(
    () => assertSameBytes(new Uint8Array([7, 7, 7]), new Uint8Array([9, 9, 9]), 'changed'),
    (error) => !/7, 7|9, 9|0x07|0x09/.test(everythingPrinted(error)),
  );
});
