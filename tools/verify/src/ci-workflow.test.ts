/**
 * What the CI workflow's corpus jobs (`.github/workflows/ci.yml`) rely on: a plan read once, three groups that read it,
 * and one required check that says they all passed, recording the pair a full run proved for the daily run to skip.
 *
 * The daily run exists to notice the official content moving (ADR 0042). It skips the corpus groups only when a full run
 * has already passed on main's commit against upstream's current head: `plan` looks for the record `aurora-corpus` saves
 * after a full run passes on main, under the same key shape. If the two keys drifted apart, the record would never be
 * found and every daily run would run in full (harmless); if the skip leaked past the schedule, a pull request or a push
 * would lose its corpus check (not harmless); if `aurora-corpus` could pass without every group, the required check
 * would mean nothing. Those are what this holds.
 *
 * What this cannot hold: that GitHub's cache answers as documented, or that `!cancelled()` runs a job after a failed
 * need. Those are read off real runs.
 *
 * Perturbation: let the record lookup run on any event, drop `!cancelled()` or the `tested` condition, let
 * `aurora-corpus` pass without checking the groups' result, record a quick suite or a pull request's run, or give the two
 * keys different prefixes, and the case about it fails.
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

test('only the daily run looks for a record, and only a record it finds skips the corpus groups', () => {
  const plan = job('plan');
  assert.match(plan, /id: record\n\s*if: github\.event_name == 'schedule'\n/, 'the record is looked up on the schedule only');
  assert.match(plan, /lookup-only: true/, 'the lookup downloads nothing');
  assert.match(plan, /tested: \$\{\{ steps\.record\.outputs\.cache-hit \}\}/);
  const groups = job('corpus');
  assert.match(groups, /\n    needs: plan\n/);
  assert.match(groups, /\n    if: needs\.plan\.outputs\.tested != 'true'\n/);
  const check = job('aurora-corpus');
  assert.match(check, /\n    needs: \[plan, corpus\]\n/);
  assert.match(
    check,
    /\n    if: \$\{\{ !cancelled\(\) && needs\.plan\.outputs\.tested != 'true' \}\}\n/,
    'the required check runs after a failed group, and is skipped only on a found record',
  );
});

test('the required check passes only when the plan and every group passed', () => {
  const check = job('aurora-corpus');
  assert.match(check, /PLAN: \$\{\{ needs\.plan\.result \}\}/);
  assert.match(check, /GROUPS: \$\{\{ needs\.corpus\.result \}\}/);
  assert.match(check, /\[ "\$PLAN" = success \] && \[ "\$GROUPS" = success \]/);
  assert.match(job('corpus'), /fail-fast: false/, 'every group reports');
});

test('a record is saved only after a full suite that passed on main, under the key the daily run looks for', () => {
  const check = job('aurora-corpus');
  assert.match(check, /if: github\.ref == 'refs\/heads\/main' && needs\.plan\.outputs\.suite == 'full' && needs\.plan\.outputs\.corpus != ''/);
  const passed = check.indexOf('- name: Every corpus group passed');
  const record = check.indexOf('uses: actions/cache/save@');
  assert.ok(passed > 0 && record > passed, 'the record is saved after the groups are checked, so a failed run saves none');
  const saved = /key: (corpus-tested-\$\{\{ github\.sha \}\}-)\$\{\{ needs\.plan\.outputs\.corpus \}\}/.exec(check);
  const looked = /key: (corpus-tested-\$\{\{ github\.sha \}\}-)\$\{\{ steps\.head\.outputs\.sha/.exec(job('plan'));
  assert.ok(saved && looked, 'both keys name the commit and the corpus head the plan read');
  assert.equal(saved[1], looked[1], 'the same key shape on both sides');
});

test('every group reads the corpus head the plan read, never a commit written in the file', () => {
  const groups = job('corpus');
  assert.match(groups, /path: \.corpus\n(?:\s*#.*\n)*\s*ref: \$\{\{ needs\.plan\.outputs\.corpus \}\}\n/);
  assert.match(job('plan'), /git ls-remote https:\/\/github\.com\/AuroraLegacy\/elements\.git HEAD/);
  assert.match(groups, /INCUDO_CORPUS_SUITE: \$\{\{ needs\.plan\.outputs\.suite \}\}/, 'the plan decides the suite for every group');
});
