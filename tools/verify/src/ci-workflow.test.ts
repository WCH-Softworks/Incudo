/**
 * What the CI workflow (`.github/workflows/ci.yml`) relies on: no push trigger, a plan read once, three groups that read
 * it, one required check that says they all passed, and a record of each full run that passed, so that a later run on
 * the same files against the same corpus head is not run again.
 *
 * A branch push runs nothing (the maintainer's call, 2026-11-26): main changes only by a pull request, which ran this.
 * The daily run (ADR 0042) and a release tag (release.yml, mobile-release.yml through `workflow_call`) skip everything
 * when `plan` finds the record `aurora-corpus` uploads after a full run passes, `build` included, named by the checkout's
 * git tree and the corpus head. That is what stops a desktop tag and a phone tag on one commit running the suite twice.
 * If the two names drifted apart, the record would never be found and every run would run in full (harmless); if the
 * skip reached a pull request or a manual run, it would lose its checks (not harmless); if a quick suite, a run whose
 * `build` failed or a fork's pull request could record, a skip would stand on nothing; if `aurora-corpus` could pass
 * without every group, the required check would mean nothing; if a failed plan skipped `build`, a required check would
 * read skipped. Those are what this holds.
 *
 * What this cannot hold: that GitHub's artifact listing answers as documented, or that `!cancelled()` runs a job after
 * a failed need. Those are read off real runs.
 *
 * Perturbation: put back a push trigger, let the lookup run on any event, drop the fork filter, `!cancelled()` or the
 * `tested` condition, let `aurora-corpus` pass without checking the groups' result, record a quick suite, a failed
 * build or a fork's run, give the two names different shapes, or take `actions: read` from a caller, and the case about
 * it fails.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..', '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const workflow = read('.github/workflows/ci.yml');

/** The text of one job, from its key to the next job's. */
function job(name: string, text = workflow): string {
  const start = text.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `the workflow has a job ${name}`);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test('a push to a branch runs no CI', () => {
  const on = /\non:\n((?:(?: {2}.*)?\n)*?)\S/.exec(workflow);
  assert.ok(on?.[1], 'ci.yml has an `on:` block');
  assert.doesNotMatch(on[1], /^ {2}push:/m, 'no push trigger');
  for (const trigger of ['pull_request', 'schedule', 'workflow_dispatch', 'workflow_call']) {
    assert.match(on[1], new RegExp(`^  ${trigger}:`, 'm'), `still started by ${trigger}`);
  }
});

test('only the daily run and a release tag look for a record, and only a record found skips anything', () => {
  const plan = job('plan');
  assert.match(plan, /LOOK: \$\{\{ github\.event_name == 'schedule' \|\| github\.ref_type == 'tag' \}\}/, 'never a pull request or a manual run');
  assert.match(plan, /if \[ "\$LOOK" = true \] && \[ -n "\$name" \]; then/);
  assert.match(plan, /select\(\.expired == false and \.workflow_run\.head_repository_id == \.workflow_run\.repository_id\)/, "never a fork's record");
  assert.match(plan, /tested: \$\{\{ steps\.record\.outputs\.tested \}\}/);
  assert.match(plan, /\n {6}actions: read\n/, 'the plan may list artifacts');
  const groups = job('corpus');
  assert.match(groups, /\n    needs: plan\n/);
  assert.match(groups, /\n    if: needs\.plan\.outputs\.tested != 'true'\n/);
  const build = job('build');
  assert.match(build, /\n    needs: plan\n/);
  assert.match(
    build,
    /\n    if: \$\{\{ !cancelled\(\) && needs\.plan\.outputs\.tested != 'true' \}\}\n/,
    'build is skipped only on a found record; a failed plan still runs it',
  );
  const check = job('aurora-corpus');
  assert.match(check, /\n    needs: \[plan, build, corpus\]\n/);
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

test("a record is uploaded only after a full run of this repository's own passed, under the name the plan looks for", () => {
  const check = job('aurora-corpus');
  const condition = /- name: The pair this run passed on\n\s*id: passed\n\s*if: >-\n((?:\s{10}.*\n)+)/.exec(check)?.[1]?.replace(/\s+/g, ' ');
  assert.ok(condition, 'the record has a condition');
  assert.match(condition, /needs\.plan\.outputs\.suite == 'full'/, 'only a full suite');
  assert.match(condition, /needs\.plan\.outputs\.record != ''/, 'only when the corpus head was read');
  assert.match(condition, /needs\.build\.result == 'success'/, 'only when build passed too');
  assert.match(
    condition,
    /\(github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository\)/,
    "never a fork's pull request",
  );
  const passed = check.indexOf('- name: Every corpus group passed');
  const record = check.indexOf('uses: actions/upload-artifact@');
  assert.ok(passed > 0 && record > passed, 'the record is uploaded after the groups are checked, so a failed run records none');
  assert.match(check, /name: \$\{\{ needs\.plan\.outputs\.record \}\}\n/, 'uploaded under the name the plan made');
  assert.match(
    job('plan'),
    /name="ci-passed-\$\(git rev-parse 'HEAD\^\{tree\}'\)-\$CORPUS"/,
    "the name is the checkout's tree and the corpus head",
  );
  assert.match(job('plan'), /record: \$\{\{ steps\.record\.outputs\.name \}\}/);
});

test('every group reads the corpus head the plan read, never a commit written in the file', () => {
  const groups = job('corpus');
  assert.match(groups, /path: \.corpus\n(?:\s*#.*\n)*\s*ref: \$\{\{ needs\.plan\.outputs\.corpus \}\}\n/);
  assert.match(job('plan'), /git ls-remote https:\/\/github\.com\/AuroraLegacy\/elements\.git HEAD/);
  assert.match(groups, /INCUDO_CORPUS_SUITE: \$\{\{ needs\.plan\.outputs\.suite \}\}/, 'the plan decides the suite for every group');
});

test('each release lets CI look for a record', () => {
  for (const path of ['.github/workflows/release.yml', '.github/workflows/mobile-release.yml']) {
    const ci = job('ci', read(path));
    assert.match(ci, /uses: \.\/\.github\/workflows\/ci\.yml/, `${path} calls ci.yml`);
    assert.match(ci, /\n    permissions:\n {6}contents: read\n {6}actions: read\n/, `${path} grants the plan actions: read`);
  }
});
