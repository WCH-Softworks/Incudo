/**
 * What `.github/workflows/tag-on-merge.yml` relies on: merging a pull request that moves an app's version tags it and
 * starts that release, so nobody pushes a release tag by hand (the maintainer's call, 2026-11-26).
 *
 * It runs on a merged pull request from this repository, never a push or a fork's; tags only a version with no tag yet;
 * checks the desktop's three version files before a tag exists that release.yml would refuse; creates the desktop tag
 * at the merge commit and starts release.yml on it, which takes a dispatch only on a tag; and leaves the phone to Phone
 * tag, which checks the notes before it tags, asking for the listing when the pull request changed its text.
 *
 * What this cannot hold: that GitHub starts a dispatch GITHUB_TOKEN asked for, or that the merge commit is what
 * `merge_commit_sha` names after a squash or a rebase. Those are read off real runs.
 *
 * Perturbation: drop the merged or the fork condition, add a push trigger, tag before the version files are compared or
 * the tag is found new, tag a commit other than the merge commit, take `workflow_dispatch` or its tag check from
 * release.yml, or start Phone tag without the listing input, and the case about it fails.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..', '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const workflow = read('.github/workflows/tag-on-merge.yml');

test("only a merged pull request from this repository starts it, and never a push", () => {
  assert.match(workflow, /^on:\n  pull_request:\n    types: \[closed\]\n    branches: \[main\]\n\n/m);
  assert.doesNotMatch(workflow, /^  (push|schedule|workflow_run|pull_request_target):/m);
  assert.match(
    workflow,
    /if: github\.event\.pull_request\.merged == true && github\.event\.pull_request\.head\.repo\.full_name == github\.repository\n/,
  );
  assert.match(workflow, /^permissions:\n  contents: write\n  actions: write\n\n/m, 'it writes a tag and starts a run, nothing else');
  assert.doesNotMatch(workflow, /secrets\.|environment:/);
});

test('the desktop is tagged at the merge commit, only once its version is new and its three files agree', () => {
  const steps = [
    "steps.changed.outputs.desktop == 'true'",
    "require('./apps/desktop/src-tauri/tauri.conf.json').version",
    'git ls-remote --exit-code --tags origin "refs/tags/$tag"',
    'apps/desktop/src-tauri/Cargo.toml',
    "require('./apps/desktop/package.json').version",
    'gh api "repos/$GITHUB_REPOSITORY/git/refs" -f "ref=refs/tags/$TAG" -f "sha=$MERGED"',
    'gh workflow run release.yml --repo "$GITHUB_REPOSITORY" --ref "$TAG"',
  ].map((step) => [step, workflow.indexOf(step)] as const);
  for (const [step, at] of steps) assert.ok(at > 0, `it runs ${step}`);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i]![1] > steps[i - 1]![1], `${steps[i]![0]} after ${steps[i - 1]![0]}`);
  assert.match(workflow, /MERGED: \$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}\n\s+run: \|\n\s+gh api/, 'the tag is the merge commit');
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}/, 'the versions are read off the merge commit');
  assert.match(workflow, /has '\^apps\/desktop\/src-tauri\/tauri\\\.conf\\\.json\$'/);
});

test('release.yml takes a dispatch, and only on a tag', () => {
  const release = read('.github/workflows/release.yml');
  assert.match(release, /^on:\n  push:\n    tags: \['v\*'\]\n  workflow_dispatch:\n/m);
  const check = release.indexOf("if: github.ref_type != 'tag'");
  const checkout = release.indexOf('- uses: actions/checkout@');
  assert.ok(check > 0 && check < checkout, 'a dispatch on a branch stops before anything else');
});

test('the phone is left to Phone tag, which checks the notes before it tags, with the listing when its text moved', () => {
  assert.match(workflow, /if: \$\{\{ !cancelled\(\) && steps\.changed\.outputs\.phone == 'true' \}\}/, 'independent of the desktop');
  assert.match(workflow, /has '\^apps\/mobile\/app\\\.json\$'/);
  assert.match(workflow, /has '\^apps\/mobile\/play\/metadata\/\[\^\/\]\+\/\[\^\/\]\+\\\.txt\$'/, 'the listing text, not a changelog');
  assert.match(workflow, /gh workflow run mobile-tag\.yml --repo "\$GITHUB_REPOSITORY" --ref main -f "listing=\$LISTING"/);
  const phone = workflow.slice(workflow.indexOf('- name: Start Phone tag'));
  assert.ok(phone.indexOf('git ls-remote --exit-code --tags origin "refs/tags/mobile-v$version"') < phone.indexOf('gh workflow run'));
  assert.doesNotMatch(phone, /git\/refs/, 'Phone tag makes the phone tag, after its own checks');
  const listing = new RegExp("^apps/mobile/play/metadata/[^/]+/[^/]+\\.txt$");
  assert.ok(listing.test('apps/mobile/play/metadata/en-US/full_description.txt'));
  assert.ok(!listing.test('apps/mobile/play/metadata/en-US/changelogs/1000199.txt'));
});
