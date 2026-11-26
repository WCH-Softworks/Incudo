/**
 * What ADR 0132 settles for the phone's Google Play release, held where a committed file can hold it: the version and
 * its code, the permissions the release asks for, what Android backs up, NetInfo's reachability check, and the privacy
 * policy's account of all of it. A release build's own manifest is read by `apps/mobile/scripts/check-permissions.cjs`,
 * which the release workflow and the pull-request Android check run after building (ADR 0135, decision 8); what is held
 * here is that they do, and that its list is the policy's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const mobile = join(root, 'apps', 'mobile');
const require = createRequire(import.meta.url);
const read = (...parts: string[]): string => readFileSync(join(root, ...parts), 'utf8');

const app = JSON.parse(read('apps', 'mobile', 'app.json')) as {
  expo: { version: string; plugins: unknown[]; android: { package: string; versionCode: number; blockedPermissions: string[] } };
};
const pkg = JSON.parse(read('apps', 'mobile', 'package.json')) as { version: string };
const { parseTag, versionCode, RELEASE } = require(join(mobile, 'scripts', 'release-version.cjs')) as {
  parseTag: (tag: string) => { version: string; candidate?: number };
  versionCode: (version: string, candidate?: number) => number;
  RELEASE: number;
};
const symbols = require(join(mobile, 'plugins', 'debug-symbols.cjs')) as {
  addDebugSymbols: (contents: string) => string;
  LEVEL: string;
};
const permissions = require(join(mobile, 'scripts', 'check-permissions.cjs')) as {
  USED: string[];
  OWN: (pkg: string) => string[];
  requested: (manifest: string) => string[];
  problems: (names: string[], pkg: string) => string[];
};
const notes = require(join(mobile, 'scripts', 'release-notes.cjs')) as {
  LIMIT: number;
  languages: (metadata?: string) => string[];
  noteProblems: (text: string, where: string) => string[];
  tagProblems: (tag: string, metadata?: string) => string[];
};
const backup = require(join(mobile, 'plugins', 'backup-rules.cjs')) as {
  INCLUDED: string[];
  DATA_EXTRACTION_RULES: string;
  FULL_BACKUP_CONTENT: string;
};

test("the package name is the one Play knows the app by, and never changes", () => {
  // Play ties a listing to its package name for good: another name is another app, with none of its installs or reviews.
  assert.equal(app.expo.android.package, "com.wchsoftworks.incudo");
});

test("the phone's version is one number, and the committed code is the release's", () => {
  assert.equal(app.expo.version, pkg.version, 'app.json and apps/mobile/package.json name the same version');
  assert.match(app.expo.version, /^\d+\.\d+\.\d+$/, 'no -rc in the app: the tag says what is a candidate');
  assert.equal(app.expo.android.versionCode, versionCode(app.expo.version), 'the committed versionCode is the release (N = 99)');
});

test('a version code only rises: candidates, then the release, then the next version', () => {
  const order = ['mobile-v1.0.0-rc.1', 'mobile-v1.0.0-rc.2', 'mobile-v1.0.0-rc.98', 'mobile-v1.0.0', 'mobile-v1.0.1-rc.1',
    'mobile-v1.0.1', 'mobile-v1.1.0-rc.1', 'mobile-v1.99.99', 'mobile-v2.0.0-rc.1'];
  const codes = order.map((tag) => {
    const { version, candidate } = parseTag(tag);
    return versionCode(version, candidate);
  });
  for (let i = 1; i < codes.length; i++) assert.ok(codes[i]! > codes[i - 1]!, `${order[i]} after ${order[i - 1]}`);
  assert.equal(versionCode('1.0.0'), 1_000_000 + RELEASE);
  // A desktop tag is never the phone's, and a candidate cannot reach the release's slot.
  assert.throws(() => parseTag('v1.0.0'));
  assert.throws(() => parseTag('mobile-v1.0.0-rc.99'));
  assert.throws(() => parseTag('mobile-v1.0.0-rc.0'));
  assert.throws(() => versionCode('1.100.0'));
});

/** What the app keeps, by what the privacy policy calls it. Adding a permission means adding its row. */
const KEPT: Record<string, string> = {
  'android.permission.INTERNET': 'Internet',
  'android.permission.ACCESS_NETWORK_STATE': 'Network state, Wi-Fi state',
  'android.permission.ACCESS_WIFI_STATE': 'Network state, Wi-Fi state',
};

test('the release asks only for what the app uses, and the privacy policy lists exactly that', () => {
  // Measured in a release build (ADR 0132): Expo's template and the dev menu add these, and nothing uses them.
  for (const permission of ['SYSTEM_ALERT_WINDOW', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'VIBRATE']) {
    assert.ok(app.expo.android.blockedPermissions.includes(`android.permission.${permission}`), `${permission} is blocked`);
  }
  for (const permission of Object.keys(KEPT)) {
    assert.ok(!app.expo.android.blockedPermissions.includes(permission), `${permission} is kept`);
  }
  const policy = read('docs', 'PRIVACY.md');
  const rows = [...policy.matchAll(/^\| ([^|]+?) \| [^|]+ \|$/gm)].map((m) => m[1]!).filter((r) => r !== 'Permission');
  assert.deepEqual(rows.sort(), [...new Set(Object.values(KEPT))].sort(), "the policy's permission table");
});

test('Android backs up the library and the settings, never a source', () => {
  assert.ok(app.expo.plugins.includes('./plugins/backup-rules.cjs'), 'app.json applies the backup rules');
  assert.deepEqual(backup.INCLUDED, ['library/', 'SQLite/']);
  for (const rules of [backup.DATA_EXTRACTION_RULES, backup.FULL_BACKUP_CONTENT]) {
    const included = [...rules.matchAll(/<include domain="file" path="([^"]+)" \/>/g)].map((m) => m[1]);
    assert.ok(included.length > 0 && included.every((folder) => backup.INCLUDED.includes(folder!)), 'every rule file names only these');
    assert.doesNotMatch(rules, /sources/);
  }
  // The folders are the ones platform.ts writes: a rename there must rename the rule.
  const platform = read('apps', 'mobile', 'src', 'platform.ts');
  assert.match(platform, /new Directory\(Paths\.document, 'library'\)/);
  assert.match(platform, /openDatabaseAsync\('incudo\.db'\)/);
  assert.match(platform, /new Directory\(Paths\.document, 'sources'\)/);
});

test('NetInfo never checks reachability by requesting an address of its own', () => {
  const platform = read('apps', 'mobile', 'src', 'platform.ts');
  assert.match(platform, /NetInfo\.configure\(\{ reachabilityShouldRun: \(\) => false \}\)/);
  assert.doesNotMatch(platform, /isInternetReachable/);
});

test('the phone workflow starts on its own tags and checks the version and the release notes first', () => {
  const workflow = read('.github', 'workflows', 'mobile-release.yml').replace(/\r\n/g, '\n');
  assert.match(workflow, /^on:\n  push:\n    tags: \['mobile-v\*'\]$/m, 'only mobile-v tags');
  // The desktop's starts on `v*`; a phone tag must never be one.
  assert.match(read('.github', 'workflows', 'release.yml'), /tags: \['v\*'\]/);
  assert.ok(!'mobile-v1.0.0'.startsWith('v'));
  const check = workflow.indexOf('release-version.cjs "$GITHUB_REF_NAME")');
  const notes = workflow.indexOf('release-notes.cjs "$GITHUB_REF_NAME"');
  const ci = workflow.indexOf('\n  ci:\n');
  const write = workflow.indexOf('release-version.cjs "$GITHUB_REF_NAME" --write');
  const prebuild = workflow.indexOf('expo prebuild');
  assert.ok(check > 0 && check < notes && notes < ci, 'the tag and its notes are checked before anything runs');
  assert.ok(ci < write && write < prebuild, 'then its code is written, then prebuild');
  assert.match(workflow, /grep -q "jar verified"/, 'an unsigned bundle fails the run');
  assert.match(workflow, /keytool -printcert -jarfile "\$aab"/, "a bundle signed by any key but the upload key fails the run");
});

test('only an approved run reads a secret, and it uploads the signed bundle with fastlane', () => {
  const workflow = read('.github', 'workflows', 'mobile-release.yml').replace(/\r\n/g, '\n');
  const release = workflow.indexOf('\n  release:\n');
  assert.ok(release > 0, 'the job that signs and uploads');
  const job = workflow.slice(release);
  assert.match(job, /^    needs: \[check, ci\]\n    runs-on: ubuntu-latest\n    environment: play$/m, 'it waits in the play environment');
  assert.doesNotMatch(workflow.slice(0, release), /secrets\./, 'nothing before it reads a secret');
  const secrets = new Set([...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]));
  assert.deepEqual([...secrets].sort(), [
    'ANDROID_UPLOAD_KEYSTORE',
    'ANDROID_UPLOAD_KEYSTORE_PASSWORD',
    'ANDROID_UPLOAD_KEY_ALIAS',
    'ANDROID_UPLOAD_KEY_PASSWORD',
    'PLAY_SERVICE_ACCOUNT_JSON',
  ]);
  assert.match(job, new RegExp(`SUPPLY_PACKAGE_NAME: ${app.expo.android.package.replace(/\./g, '\\.')}\n`), 'the package Play knows');
  for (const skip of ['APK', 'METADATA', 'IMAGES', 'SCREENSHOTS']) {
    assert.match(job, new RegExp(`SUPPLY_SKIP_UPLOAD_${skip}: 'true'`), `the upload leaves ${skip.toLowerCase()} alone`);
  }
  assert.doesNotMatch(job, /SUPPLY_SKIP_UPLOAD_CHANGELOGS/, 'the release notes go with it');
  const kept = job.indexOf('actions/upload-artifact');
  const upload = job.indexOf('bundle exec fastlane supply');
  assert.ok(kept > 0 && kept < upload, 'the bundle is kept before the upload, so a failed upload loses nothing');
  // A candidate goes to internal testing and a release to closed testing; a draft unless the variable says otherwise.
  assert.match(workflow, /\*-rc\.\*\) track=internal ;;\n\s+\*\) track=alpha ;;/);
  assert.match(workflow, /STATUS: \$\{\{ vars\.PLAY_RELEASE_STATUS \|\| 'draft' \}\}/);
  assert.match(workflow, /draft\|completed\) ;;/, 'any other status stops the run');
});

test('fastlane is pinned to one version, in the Gemfile and its lock', () => {
  const gemfile = read('apps', 'mobile', 'play', 'Gemfile');
  const version = /^gem "fastlane", "(\d+\.\d+\.\d+)"$/m.exec(gemfile)?.[1];
  assert.ok(version, 'an exact version');
  assert.match(read('apps', 'mobile', 'play', 'Gemfile.lock'), new RegExp(`^    fastlane \\(${version.replace(/\./g, '\\.')}\\)$`, 'm'));
});

test('every release note fits Play, and a tag with none stops before anything is built', () => {
  const metadata = join(mobile, 'play', 'metadata');
  const found = notes.languages(metadata);
  assert.ok(found.length > 0, 'a language folder');
  for (const language of found) {
    const folder = join(metadata, language, 'changelogs');
    for (const file of readdirSync(folder)) {
      assert.match(file, /^\d+\.txt$/, `${language}/${file} is named by its version code`);
      assert.deepEqual(notes.noteProblems(readFileSync(join(folder, file), 'utf8'), file), []);
    }
  }
  assert.deepEqual(notes.noteProblems('', 'x.txt'), ['x.txt is empty']);
  assert.deepEqual(notes.noteProblems('é'.repeat(notes.LIMIT), 'x.txt'), [], 'characters, not bytes');
  assert.deepEqual(notes.noteProblems('a'.repeat(notes.LIMIT + 1), 'x.txt'), [`x.txt is ${notes.LIMIT + 1} characters, and Play takes ${notes.LIMIT}`]);
  const unwritten = `mobile-v${app.expo.version}-rc.98`;
  assert.match(notes.tagProblems(unwritten, metadata).join('\n'), /changelogs\/\d+\.txt is missing/);
});

test("the build is checked for the permissions the policy lists, and nothing else", () => {
  assert.deepEqual([...permissions.USED].sort(), Object.keys(KEPT).sort(), 'the checker allows exactly the kept ones');
  const pkg = app.expo.android.package;
  const manifest = `<manifest>
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <permission android:name="${pkg}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" android:protectionLevel="signature" />
    <uses-permission android:name="${pkg}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" />
  </manifest>`;
  assert.deepEqual(permissions.problems(permissions.requested(manifest), pkg), [], 'a release build as measured passes');
  const added = manifest.replace('</manifest>', '<uses-permission android:name="android.permission.VIBRATE" /></manifest>');
  assert.deepEqual(permissions.problems(permissions.requested(added), pkg), [
    'asks for android.permission.VIBRATE, which ADR 0132 decision 4 does not list',
  ]);
  const lost = manifest.replace(/<uses-permission android:name="android.permission.INTERNET" \/>/, '');
  assert.deepEqual(permissions.problems(permissions.requested(lost), pkg), [
    'does not ask for android.permission.INTERNET, which the app uses',
  ]);
});

test("the release bundle carries its native debug symbols, written into the generated build file once", () => {
  assert.ok(app.expo.plugins.includes('./plugins/debug-symbols.cjs'), 'app.json applies the plugin');
  // The shape `expo prebuild` writes for SDK 58's template.
  const template = `android {\n    defaultConfig {\n        applicationId 'com.wchsoftworks.incudo'\n        versionCode 1000099\n    }\n}\n`;
  const written = symbols.addDebugSymbols(template);
  assert.match(written, /defaultConfig \{\n        ndk \{ debugSymbolLevel 'SYMBOL_TABLE' \}\n        applicationId/);
  assert.equal(symbols.addDebugSymbols(written), written, 'a second prebuild over the same file adds nothing');
  assert.throws(() => symbols.addDebugSymbols('android {\n}\n'), /no defaultConfig/, 'a template it cannot read fails the prebuild');
});

test('the release workflow runs one at a time, checks the built permissions and symbols, and keeps the bundle 90 days', () => {
  const workflow = read('.github', 'workflows', 'mobile-release.yml').replace(/\r\n/g, '\n');
  assert.match(workflow, /^concurrency:\n  group: mobile-release\n  cancel-in-progress: false$/m);
  const build = workflow.indexOf(':app:bundleRelease');
  const check = workflow.indexOf('node scripts/check-permissions.cjs');
  const sign = workflow.indexOf('grep -q "jar verified"');
  assert.ok(build > 0 && build < check && check < sign, 'built, then its permissions read, then its signature');
  assert.match(workflow, /grep -q "BUNDLE-METADATA\/com\.android\.tools\.build\.debugsymbols\/"/);
  assert.match(workflow, /retention-days: 90/);
});

test('a pull request bundles the phone with Metro, and builds it with Gradle when it touches what the native build reads', () => {
  const workflow = read('.github', 'workflows', 'mobile-check.yml').replace(/\r\n/g, '\n');
  assert.match(workflow, /^on:\n  pull_request:\n/m);
  assert.match(workflow, /npx expo export --platform android/);
  for (const path of ['apps/mobile/', 'package\\.json$', 'package-lock\\.json$']) {
    assert.ok(workflow.includes(path), `the native build runs when ${path} changes`);
  }
  const build = workflow.indexOf(':app:bundleRelease');
  const check = workflow.indexOf('node scripts/check-permissions.cjs');
  assert.ok(build > 0 && build < check, 'the permissions are read off the build it made');
  assert.match(workflow, /BUNDLE-METADATA\/com\.android\.tools\.build\.debugsymbols\//);
  assert.doesNotMatch(workflow, /secrets\./, 'a pull request never sees a secret');
});
