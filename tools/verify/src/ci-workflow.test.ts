/**
 * What the CI workflow's daily run (`.github/workflows/ci.yml`) relies on to skip a pair already tested.
 *
 * The daily run exists to notice the official content moving (ADR 0042). It skips `aurora-corpus` only when a full run
 * has already passed on main's commit against upstream's current head: `already-tested` looks for the record a passing
 * full run on main saves, under the same key shape. If the two keys drifted apart, the record would never be found and
 * every daily run would run in full (harmless); if the skip leaked past the schedule, a pull request or a push would
 * lose its corpus check (not harmless). Those are what this holds.
 *
 * What this cannot hold: that GitHub's cache answers as documented, or that `!cancelled()` runs a job after a skipped
 * need. Those were read in the run that added this, on the schedule and on a pull request.
 *
 * Perturbation: let `already-tested` run on any event, drop `!cancelled()` or the `tested` condition from
 * `aurora-corpus`, record a quick suite or a pull request's run, or give the two keys different prefixes, and the case
 * about it fails.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..', '..', '..');
const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n/g, '\n');

/** The text of one job, from its key to the next job's. */
function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `ci.yml has a job ${name}`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test('only the daily run looks for a record, and only a record it finds skips the corpus suite', () => {
  assert.match(job('already-tested'), /\n    if: github\.event_name == 'schedule'\n/, 'already-tested runs on the schedule only');
  const corpus = job('aurora-corpus');
  assert.match(corpus, /\n    needs: already-tested\n/);
  assert.match(
    corpus,
    /\n    if: \$\{\{ !cancelled\(\) && needs\.already-tested\.outputs\.tested != 'true' \}\}\n/,
    'aurora-corpus runs after a skipped or failed already-tested, and is skipped only on a found record',
  );
  assert.match(job('already-tested'), /tested: \$\{\{ steps\.record\.outputs\.cache-hit \}\}/);
  assert.match(job('already-tested'), /lookup-only: true/, 'the lookup downloads nothing');
});

test('a record is saved only by a full suite that passed on main, under the key the daily run looks for', () => {
  const corpus = job('aurora-corpus');
  assert.match(corpus, /if: github\.ref == 'refs\/heads\/main' && env\.INCUDO_CORPUS_SUITE == 'full'/);
  const tests = corpus.indexOf('- name: Real-content tests');
  const record = corpus.indexOf('uses: actions/cache/save@');
  assert.ok(tests > 0 && record > tests, 'the record is saved after the tests, so a failed run saves none');
  const saved = /key: (corpus-tested-\$\{\{ github\.sha \}\}-)/.exec(corpus);
  const looked = /key: (corpus-tested-\$\{\{ github\.sha \}\}-)/.exec(job('already-tested'));
  assert.ok(saved && looked, 'both keys name the commit');
  assert.equal(saved[1], looked[1], 'the same key shape on both sides');
});
