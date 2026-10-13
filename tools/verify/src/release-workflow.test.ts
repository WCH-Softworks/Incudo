/**
 * What the release workflow (`.github/workflows/release.yml`, ROADMAP Phase 9) relies on and Node can hold.
 *
 * The workflow starts on a `v*` tag and stops before building anything unless the tag is `vX.Y.Z` or `vX.Y.Z-rc.N` and
 * its X.Y.Z is the version in all three of `tauri.conf.json`, `Cargo.toml` and `apps/desktop/package.json`. A mismatch is
 * found only after a tag has been pushed, so the three are held to each other here, on every test run, and the tag
 * pattern is read out of the workflow and run against what the ROADMAP says it accepts and refuses.
 *
 * What this cannot hold: that the actions exist, that a runner builds, or that an installer starts. Those are the run's,
 * and the ROADMAP item is ticked on a real tag's installers, not on this.
 *
 * Perturbation: give any one of the three files another version, or a `-rc` suffix, and this fails naming it; loosen or
 * tighten the workflow's tag pattern (drop the `$`, allow `-beta`) and the tag cases fail; drop `workflow_call` from
 * `ci.yml`, `releaseDraft: true`, either macOS target or the ad-hoc signing identity, and the case about it fails.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..', '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const workflow = read('.github/workflows/release.yml');

/** The three versions, each read the way the workflow reads it. */
function versions(): Record<string, string> {
  const conf = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')) as { version: string };
  const pkg = JSON.parse(read('apps/desktop/package.json')) as { version: string };
  // The workflow's `sed -n 's/^version = "\(.*\)"/\1/p' | head -1`: the first such line is the package's own.
  const cargo = /^version = "(.*)"/m.exec(read('apps/desktop/src-tauri/Cargo.toml'));
  assert.ok(cargo, 'Cargo.toml has a version line');
  return { 'tauri.conf.json': conf.version, 'Cargo.toml': cargo[1]!, 'apps/desktop/package.json': pkg.version };
}

test("the app's three version fields agree, and none carries a pre-release suffix", () => {
  const found = versions();
  const [first] = Object.values(found);
  for (const [file, version] of Object.entries(found)) {
    assert.equal(version, first, `${file} says ${version}`);
    // A Windows .msi refuses a pre-release that is not a number: a candidate's version is the one it will become.
    assert.match(version, /^\d+\.\d+\.\d+$/, `${file}'s version is X.Y.Z`);
  }
});

/** The workflow's own pattern, as bash's `[[ =~ ]]` reads it (an ERE, which JavaScript reads the same here). */
function tagPattern(): RegExp {
  const match = /\[\[ "\$tag" =~ (\^v.*\$) \]\]/.exec(workflow);
  assert.ok(match, 'release.yml checks the tag with a pattern');
  return new RegExp(match[1]!);
}

test('the tag pattern accepts vX.Y.Z and vX.Y.Z-rc.N, and nothing else', () => {
  const pattern = tagPattern();
  for (const tag of ['v0.1.0', 'v0.1.0-rc.1', 'v0.1.0-rc.3', 'v1.12.0-rc.10', 'v10.0.0']) {
    assert.ok(pattern.test(tag), `accepts ${tag}`);
  }
  for (const tag of ['0.1.0', 'v0.1', 'v0.1.0-rc', 'v0.1.0-rc.', 'v0.1.0-beta.1', 'v0.1.0-rc1', 'v0.1.0-rc.1-x', 'v0.1.0 ', 'vX.Y.Z']) {
    assert.ok(!pattern.test(tag), `refuses ${JSON.stringify(tag)}`);
  }
  // The workflow reads `BASH_REMATCH[1]` as the version and a non-empty `BASH_REMATCH[2]` (the `-rc.N` part) as "pre-release".
  assert.equal(pattern.exec('v0.1.0-rc.2')?.[1], '0.1.0');
  assert.equal(pattern.exec('v0.1.0-rc.2')?.[2], '-rc.2');
  assert.equal(pattern.exec('v0.1.0')?.[2], undefined);
});

test('the release runs ci.yml first and leaves a draft', () => {
  assert.match(workflow, /uses: \.\/\.github\/workflows\/ci\.yml/, 'release.yml calls ci.yml');
  assert.match(read('.github/workflows/ci.yml'), /^\s*workflow_call:/m, 'ci.yml can be called');
  assert.match(workflow, /needs: \[check, ci\]/, 'the installers wait for the check and CI');
  assert.match(workflow, /releaseDraft: true/, 'the release is a draft');
  assert.match(workflow, /tags: \['v\*'\]/, 'a tag starts it');
  assert.doesNotMatch(workflow, /branches:/, 'a push to a branch does not');
});

test('macOS builds both chips, signed ad hoc', () => {
  assert.match(workflow, /--target aarch64-apple-darwin/);
  assert.match(workflow, /--target x86_64-apple-darwin/);
  const config = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')) as { bundle: { macOS?: { signingIdentity?: string } } };
  assert.equal(config.bundle.macOS?.signingIdentity, '-', 'an ad-hoc identity, or Apple silicon reads the app as damaged');
});
