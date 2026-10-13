/**
 * No test file writes to standard output; a figure a test reports is a `t.diagnostic`, which prints as the same `ℹ`
 * line.
 *
 * `node --test` runs each file in a child process whose stdout carries the runner's own messages, V8-serialized, with
 * whatever the test prints in between. The parent finds a message by its two-byte header, but once it has read one it
 * takes the next four bytes of the same read as the next message's length without looking for a header first, and it
 * builds that length with signed bitwise operators. A `console.log('ℹ …')` that arrives in the same read straight after
 * a message (the parent was busy, as it is with the whole suite in parallel) has `ℹ`'s third byte, 0xB9, as the
 * length's top byte: the length is negative, so the line is "complete" and is deserialized as a message, and the file
 * fails with "Unable to deserialize cloned data due to invalid or unsupported version." and no assertion failing. It
 * did, in 3 of 7 full runs on Windows (Node 24.14), for `missing-content.test.ts`, and passed every time alone.
 * `t.diagnostic` is reported as one of the serialized messages, so nothing a test says is ever read as one.
 *
 * Perturbation: put `console.log(\`ℹ ${corpusProvenance()}\`)` back into `missing-content.test.ts`, and this fails
 * naming the file and line.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..', '..', '..');

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'fixtures' ? [] : testFiles(path);
    return entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** What `npm test` runs: `packages/*\/src` and `tools/*\/src`. */
function suite(): string[] {
  return ['packages', 'tools'].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const src = join(root, group, entry.name, 'src');
        try {
          return testFiles(src);
        } catch {
          return [];
        }
      }),
  );
}

/** Calls that reach the child's stdout. Standard error is a pipe of its own and is not parsed. */
const STDOUT = /\b(console\.(?:log|info|debug|table|dir)|process\.stdout\.write)\s*\(/;

test('no test file writes to standard output, which the test runner parses as its own messages', () => {
  const files = suite();
  const calls: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, at) => {
        // Calls, not mentions: a comment may name one, as this file's do.
        const code = line.trimStart();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        const match = STDOUT.exec(code.replace(/\/\/.*$/, ''));
        if (match) calls.push(`${relative(root, file).replace(/\\/g, '/')}:${at + 1}: ${match[1]}()`);
      });
  }
  assert.ok(files.length > 50, 'the test files were not found');
  assert.deepEqual(calls, []);
});
