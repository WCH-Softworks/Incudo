/**
 * How a test talks about the nine real Aurora saves without naming one.
 *
 * `library.test.ts` and `save-copy.test.ts` run over personal data, and their headers promise that
 * a failure says what broke without putting anyone's character into a log. `assert` breaks that
 * promise quietly: a message that interpolates a library entry's name prints the character's
 * name (the file is a slug of it), and `deepEqual` prints both values on a failure, so comparing
 * two `summarize()` results prints `character.name`, and comparing two lists of problems prints
 * every message in them — a JSON parse error quotes the text it choked on.
 *
 * Everything here asserts exactly what the plain call would have and says less when it fails:
 * a position, a count, the names of the fields that differ, never a value.
 *
 * Labels follow `aurora-oracle.test.ts`: the position in the sorted folder listing of the `.dnd5e`
 * files, so `save 3/9` is the same save in every one of these tests and on every run.
 */

import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

import type { DerivedSummary } from './derived-summary.ts';

/** `save 3/9` for index 2 of 9. */
export function saveLabel(index: number, total: number): string {
  return `save ${index + 1}/${total}`;
}

/**
 * Run a read or write that touches a save or a library file, and let it fail without its path.
 *
 * An `fs` error names the file in its message, in `path`, and in `stack`, and the test reporter
 * prints all three. The file is named for its character. The error is replaced whole rather
 * than edited, and carries no `cause`, because a scrubbed message beside an intact `path` hides
 * nothing. What is left is what was being done and the error's `code` (`ENOENT`, `EISDIR`) or,
 * for anything without one, its class — a zip or JSON error can quote the bytes it choked on.
 */
export async function unnamed<T>(what: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const kind =
      typeof code === 'string' ? code : error instanceof Error ? error.name : 'a non-Error value';
    throw new Error(`${what} failed (${kind})`);
  }
}

/** A list that must be empty, reported by its length. Its items are not printed. */
export function assertNoneReported(items: readonly unknown[], message: string): void {
  assert.equal(items.length, 0, `${message} (${items.length} reported)`);
}

/**
 * Two derived summaries that must be identical. A summary carries the character's name, so on a
 * difference this names the top-level fields that differ (`stats`, `elements`, …) and stops there.
 */
export function assertSameSummary(
  actual: DerivedSummary,
  expected: DerivedSummary | undefined,
  message: string,
): void {
  assert.ok(expected, `${message} (nothing was recorded to compare against)`);
  if (isDeepStrictEqual(actual, expected)) return;
  const differing = (Object.keys(actual) as Array<keyof DerivedSummary>).filter(
    (key) => !isDeepStrictEqual(actual[key], expected[key]),
  );
  assert.fail(`${message} (differs in: ${differing.join(', ')})`);
}

/** Two byte arrays that must be identical, without printing a portrait's bytes when they are not. */
export function assertSameBytes(
  actual: Uint8Array | undefined,
  expected: Uint8Array | undefined,
  message: string,
): void {
  assert.ok(
    actual !== undefined && expected !== undefined && Buffer.from(actual).equals(expected),
    message,
  );
}
