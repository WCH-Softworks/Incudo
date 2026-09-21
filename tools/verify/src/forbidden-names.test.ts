/**
 * No file in the repository may name a real person's character.
 *
 * Git history is permanent, and a name that once got into a committed file stays in it. This is the
 * guard against it coming back: an agent or a contributor pasting a name from a personal save into an
 * ADR, a comment or a test title.
 *
 * **The names are not stored here.** What is stored is the first 24 hex digits of a salted SHA-256 of
 * each lowercased word, so a reader of this file learns nothing, and a name that was never in the
 * repository cannot be pulled out of it by reading. (It is a fingerprint, not a secret: anyone with a
 * list of candidate names can test them against it. Those names are already in the permanent history of
 * earlier commits, so this discloses nothing that history does not, and it is deliberately not a
 * password hash.) A failure prints where a forbidden word is and never the word, so a CI log does not
 * become the next place one appears.
 *
 * Every word of every file is checked, whichever the file: prose, code, a test title, a schema
 * description. Files that are not text are skipped. Adding a word means adding its hash, and the
 * script that makes one is the two lines in `wordHash`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { repoRoot } from './node-system.ts';

const SALT = 'incudo/forbidden-names/v1:';

/** Fingerprints of the forbidden words: character names and their surnames, lowercased. */
const FORBIDDEN: ReadonlySet<string> = new Set([
  '017785769b42ef8b0e2daaf3',
  '2ecadc82dfa222dcef353136',
  '3c99fb5eb2333917ef5da6b1',
  '5958113f7b9e899f6c6076a0',
  '5d3e7ff5a852f019824c9da0',
  '6cae5818e99e76601184dbec',
  '81cd508b574f2ddd08d25575',
  '850dbee39c2f6a24ed2caeda',
  'a55b66eb86aebaaf5427edd3',
  'a8d57675397ac0eadd4ad3b2',
  'b7eaff9249b12ebfbf937837',
  'c98921add004ab12c437a134',
  'd56083dcd3d82a9eb7353599',
  'd79418a7c76e96f44a62f7d5',
]);

export function wordHash(word: string): string {
  return createHash('sha256').update(SALT + word.toLowerCase()).digest('hex').slice(0, 24);
}

/** The words of a text: runs of letters, so `Name's` is `Name` and `s`, and a hyphenated name is two. */
export function words(text: string): string[] {
  return text.match(/\p{L}+/gu) ?? [];
}

/** Line numbers, 1-based, of every line that holds a forbidden word. The words themselves are not returned. */
export function forbiddenLines(text: string, forbidden: ReadonlySet<string> = FORBIDDEN): number[] {
  const lines: number[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (words(line).some((w) => w.length >= 3 && forbidden.has(wordHash(w)))) lines.push(i + 1);
  });
  return lines;
}

const NOT_TEXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.icns', '.webp', '.zip', '.incu', '.woff', '.woff2', '.ttf']);

/** Tracked files and files that are not yet tracked or ignored, so a name is caught before it is added. */
function candidateFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter((f) => f !== '' && !NOT_TEXT.has(extname(f).toLowerCase()));
}

test('the guard finds a forbidden word by its fingerprint, in any case and beside any punctuation', () => {
  // The real fingerprints are the ones above; detection is shown on a word this file may say.
  const forbidden = new Set([wordHash('control')]);
  const text = ['nothing here', "Control's", 'or here', 'the CONTROL-group', 'controlled is a different word'].join('\n');
  assert.deepEqual(forbiddenLines(text, forbidden), [2, 4]);
  assert.deepEqual(forbiddenLines('nothing here\nor here', forbidden), []);

  assert.deepEqual(words("Name's-thing, ünïcode"), ['Name', 's', 'thing', 'ünïcode']);
  assert.equal(wordHash('Word'), wordHash('word'), 'case does not matter');
  assert.equal(wordHash('word').length, 24);
  assert.equal(FORBIDDEN.size, 14, 'adding a word is deliberate: it adds its fingerprint here');
  assert.equal(FORBIDDEN.has(wordHash('control')), false, 'an ordinary word is not forbidden');
});

test('no file in the repository names a real person\'s character', async () => {
  const root = repoRoot();
  const offenders: string[] = [];
  for (const file of candidateFiles()) {
    let text: string;
    try {
      text = await readFile(join(root, file), 'utf8');
    } catch {
      continue; // a file that vanished between the listing and the read
    }
    if (text.includes('\0')) continue; // not text
    for (const line of forbiddenLines(text)) offenders.push(`${file}:${line}`);
  }
  assert.deepEqual(
    offenders,
    [],
    'a word that must never be committed is at the places above (it is not printed, so this log does not ' +
      'repeat it). Describe the character by what it holds ("a level 12 Fighter save"), never by its name: ' +
      'history is permanent.',
  );
});
