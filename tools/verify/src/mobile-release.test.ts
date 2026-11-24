/**
 * What ADR 0132 settles for the phone's Google Play release, held where a committed file can hold it: the version and
 * its code, the permissions the release asks for, what Android backs up, NetInfo's reachability check, and the privacy
 * policy's account of all of it. A release build's own manifest is read in the release check (`aapt dump
 * permissions`), since CI builds none.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('the phone workflow starts on its own tags, checks the version first, signs from secrets and publishes nothing', () => {
  const workflow = read('.github', 'workflows', 'mobile-release.yml').replace(/\r\n/g, '\n');
  assert.match(workflow, /^on:\n  push:\n    tags: \['mobile-v\*'\]$/m, 'only mobile-v tags');
  // The desktop's starts on `v*`; a phone tag must never be one.
  assert.match(read('.github', 'workflows', 'release.yml'), /tags: \['v\*'\]/);
  assert.ok(!'mobile-v1.0.0'.startsWith('v'));
  const check = workflow.indexOf('release-version.cjs "$GITHUB_REF_NAME")');
  const write = workflow.indexOf('release-version.cjs "$GITHUB_REF_NAME" --write');
  const prebuild = workflow.indexOf('expo prebuild');
  assert.ok(check > 0 && check < write && write < prebuild, 'the tag is checked, then its code written, then prebuild');
  const secrets = new Set([...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]));
  assert.deepEqual([...secrets].sort(), ['ANDROID_UPLOAD_KEYSTORE', 'ANDROID_UPLOAD_KEYSTORE_PASSWORD', 'ANDROID_UPLOAD_KEY_ALIAS', 'ANDROID_UPLOAD_KEY_PASSWORD']);
  assert.doesNotMatch(workflow, /contents: write|r0adkll|upload-google-play|SERVICE_ACCOUNT/, 'publishes nowhere');
  assert.match(workflow, /grep -q "jar verified"/, 'an unsigned bundle fails the run');
});
