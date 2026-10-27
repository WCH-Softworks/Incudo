/**
 * The JSON reader that remembers positions — ADR 0103. Held to `JSON.parse` on every JSON file the repository has and on
 * thousands of broken variants of one; then its positions, and its words for the slips people make.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readJsonText } from './json-text.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));

function jsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...jsonFiles(path));
    else if (name.endsWith('.json')) out.push(path);
  }
  return out;
}

const parses = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
};

// Perturbation: any grammar difference (a trailing comma accepted, an escape read differently) changes a value or a verdict.
test('every JSON file in systems/ and schemas/ reads to the value JSON.parse reads', () => {
  const files = [...jsonFiles(join(root, 'systems')), ...jsonFiles(join(root, 'schemas'))];
  assert.ok(files.length >= 7);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const read = readJsonText(text);
    assert.equal(read.ok, true, file);
    assert.deepEqual(read.ok && read.value, JSON.parse(text), file);
  }
});

// Perturbation: accepting a trailing comma, a leading zero, a bare word, an unescaped line break, or text after the end.
test('on broken variants of a real file, it refuses exactly what JSON.parse refuses', () => {
  const text = readFileSync(join(root, 'tools', 'verify', 'fixtures', 'systems', 'cairn', 'system.json'), 'utf8');
  let seed = 1;
  const random = (n: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  const inserts = [',', '{', '}', '[', ']', '"', ':', "'", '/', '0', '-', '.', 'a', '\\', '\n', ' ', 'e', 'true'];
  let refused = 0;
  for (let i = 0; i < 4000; i++) {
    const at = random(text.length);
    const mutated =
      i % 3 === 0
        ? text.slice(0, at) + text.slice(at + 1 + random(3))
        : text.slice(0, at) + inserts[random(inserts.length)]! + text.slice(at);
    const expected = parses(mutated);
    const read = readJsonText(mutated);
    assert.equal(read.ok, expected.ok, `variant ${i} at ${at}: ${JSON.stringify(mutated.slice(Math.max(0, at - 20), at + 20))}`);
    if (read.ok && expected.ok) assert.deepEqual(read.value, expected.value);
    if (!read.ok) refused++;
  }
  assert.ok(refused > 1000, `${refused} variants refused`);
});

test('a property named __proto__ is an ordinary property, as JSON.parse makes it', () => {
  const read = readJsonText('{"__proto__": {"x": 1}}');
  assert.ok(read.ok);
  assert.deepEqual(Object.keys(read.value as object), ['__proto__']);
  assert.equal(({} as Record<string, unknown>)['x'], undefined);
});

// Perturbation: recording a member at its value rather than its name, or counting lines or columns from 0.
test('each value is placed at its name, or for an array entry at its start, by line and column', () => {
  const text = '{\n  "id": "x",\n  "kinds": [\n    { "id": "pc",\n      "steps": [1, 2] }\n  ]\n}';
  const read = readJsonText(text);
  assert.ok(read.ok);
  const at = (path: string) => read.positions.get(path);
  assert.deepEqual(at(''), { line: 1, column: 1 });
  assert.deepEqual(at('id'), { line: 2, column: 3 });
  assert.deepEqual(at('kinds'), { line: 3, column: 3 });
  assert.deepEqual(at('kinds[0]'), { line: 4, column: 5 });
  assert.deepEqual(at('kinds[0].id'), { line: 4, column: 7 });
  assert.deepEqual(at('kinds[0].steps[1]'), { line: 5, column: 20 });
});

test('a byte order mark at the start is read past, as a Windows editor writes one', () => {
  const read = readJsonText('\uFEFF{"a": 1}');
  assert.ok(read.ok);
  assert.deepEqual(read.value, { a: 1 });
});

// Perturbation: any of these falling through to "This is not valid JSON here".
test('the slips people make are named, at the place to fix', () => {
  const cases: Array<[string, string, number, number]> = [
    ['{\n  "a": 1,\n}', 'There is a comma after the last entry, before the }. JSON does not allow one: remove it.', 2, 9],
    ['[1, 2,\n]', 'There is a comma after the last entry, before the ]. JSON does not allow one: remove it.', 1, 6],
    ['{\n  // a note\n  "a": 1\n}', 'JSON does not allow comments. Remove this one, or put the note in a "description".', 2, 3],
    ["{ 'a': 1 }", 'Names must be in double quotes ("…"), not single quotes.', 1, 3],
    ['{ "a": \'x\' }', 'Text must be in double quotes ("…"), not single quotes.', 1, 8],
    ['{ a: 1 }', 'Names must be in double quotes ("…").', 1, 3],
    ['{\n  "a": 1\n  "b": 2\n}', 'A comma is missing before this entry.', 3, 3],
    ['[\n  {"a": 1}\n  {"b": 2}\n]', 'A comma is missing before this entry.', 3, 3],
    ['{\n  "a": [1, 2\n', 'This [ is never closed with a ].', 2, 8],
    ['{\n  "a": 1\n', 'This { is never closed with a }.', 1, 1],
    ['{ "a": "one\ntwo" }', 'This text is never closed with a " on its line (a line break inside text is written \\n).', 1, 8],
    ['{ "a" 1 }', 'A colon is missing after "a".', 1, 7],
    ['{ "a": 01 }', 'This is not a number JSON can read (no leading zeros, no + sign, digits after a point).', 1, 8],
    ['{ "a": yes }', 'Text must be in double quotes ("…"); only true, false and null are written bare.', 1, 8],
    ['{ "a": 1 } x', 'There is more after the end: everything must be inside the one outer { … }.', 1, 12],
    ['  \n ', 'The file is empty.', 2, 2],
    ['{ "a": "C:\\path" }', '\\p is not something JSON can write after a backslash. A backslash itself is written \\\\.', 1, 11],
  ];
  for (const [text, message, line, column] of cases) {
    assert.deepEqual(readJsonText(text), { ok: false, message, line, column }, text);
  }
});
