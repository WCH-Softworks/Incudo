/**
 * The desktop updater's configuration, capability, release workflow and latest.json — ADR 0133.
 *
 * What Node can hold of an updater that cannot be driven before a signed release exists: the config the plugin reads,
 * the narrow permissions, the workflow passing the signing secrets and writing latest.json once, and the script that
 * writes it. **The update key is a placeholder until the maintainer generates one**: the release workflow refuses to
 * build with it (`--check-config`), and the first test here says so by name, so it cannot be forgotten into a release.
 *
 * Perturbation: give the endpoint another address, set createUpdaterArtifacts false, grant `updater:default` or
 * `process:default`, drop either secret or `uploadUpdaterJson: false` from release.yml, drop `--check-config` from its
 * check job, move the Rust plugin off the npm package's minor, or make `buildManifest` accept a release missing a
 * platform, and the case about it fails.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..', '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);

interface Manifest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
}

const script = require(join(root, 'apps', 'desktop', 'scripts', 'updater-manifest.cjs')) as {
  PLACEHOLDER_PUBKEY: string;
  ENDPOINT: string;
  REQUIRED_PLATFORMS: string[];
  isMinisignPublicKey(pubkey: unknown): boolean;
  configProblems(conf: unknown): string[];
  archOf(name: string): string | undefined;
  buildManifest(input: {
    tag: string;
    version: string;
    repo: string;
    assets: string[];
    signatures: Record<string, string>;
    pubDate: string;
  }): Manifest;
};

interface TauriConf {
  bundle: { createUpdaterArtifacts?: unknown };
  plugins?: { updater?: { pubkey: string; endpoints: string[]; windows?: { installMode?: string } } };
}
const conf = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')) as TauriConf;

/** A key shaped as `npx tauri signer generate` writes one: base64 of a minisign public key file. */
function fakePublicKey(): string {
  const key = Buffer.concat([Buffer.from('Ed', 'latin1'), Buffer.alloc(40, 7)]).toString('base64');
  return Buffer.from(`untrusted comment: minisign public key: 0707070707070707\n${key}\n`).toString('base64');
}

test('the update key is the placeholder until the maintainer pastes a real one, and only those two are accepted', (t) => {
  const pubkey = conf.plugins?.updater?.pubkey;
  if (pubkey === script.PLACEHOLDER_PUBKEY) {
    // Not a failure here: the release workflow refuses to build with it, which is where it must not get past.
    t.diagnostic(`the update key is still the placeholder ${script.PLACEHOLDER_PUBKEY}; a release refuses it`);
    assert.deepEqual(
      script.configProblems(conf).map((problem) => problem.includes(script.PLACEHOLDER_PUBKEY)),
      [true],
      'the placeholder is the one problem, named',
    );
  } else {
    assert.deepEqual(script.configProblems(conf), [], 'a real key, and nothing else wrong');
  }
  assert.equal(script.isMinisignPublicKey(fakePublicKey()), true);
  for (const bad of [script.PLACEHOLDER_PUBKEY, '', 'RWQ', Buffer.from('untrusted comment: x\nAAAA\n').toString('base64'), 42]) {
    assert.equal(script.isMinisignPublicKey(bad), false, String(bad));
  }
  const real = structuredClone(conf);
  real.plugins!.updater!.pubkey = fakePublicKey();
  assert.deepEqual(script.configProblems(real), []);
});

test('the app asks the published release\'s latest.json and nothing else, and builds signed updates', () => {
  const updater = conf.plugins?.updater;
  assert.deepEqual(updater?.endpoints, ['https://github.com/WCH-Softworks/Incudo/releases/latest/download/latest.json']);
  assert.equal(script.ENDPOINT, updater?.endpoints[0]);
  assert.equal(conf.bundle.createUpdaterArtifacts, true);
  assert.equal(updater?.windows?.installMode, 'passive', 'the installer shows its progress and asks nothing');
  const broken = structuredClone(conf);
  broken.bundle.createUpdaterArtifacts = false;
  broken.plugins!.updater!.endpoints = ['https://github.com/WCH-Softworks/Incudo/releases/download/v1.0.0/latest.json'];
  assert.equal(script.configProblems(broken).filter((problem) => !problem.includes(script.PLACEHOLDER_PUBKEY)).length, 2);
});

test('the window may only check, download-and-install, and restart', () => {
  const capability = JSON.parse(read('apps/desktop/src-tauri/capabilities/default.json')) as { permissions: Array<string | { identifier: string }> };
  const ids = capability.permissions.map((permission) => (typeof permission === 'string' ? permission : permission.identifier));
  assert.deepEqual(
    ids.filter((id) => id.startsWith('updater:') || id.startsWith('process:')).sort(),
    ['process:allow-restart', 'updater:allow-check', 'updater:allow-download-and-install'],
  );
});

test('the Rust plugins and their npm packages are on the same minor, or the Tauri CLI refuses to build', () => {
  const cargo = read('apps/desktop/src-tauri/Cargo.toml');
  const pkg = JSON.parse(read('apps/desktop/package.json')) as { dependencies: Record<string, string> };
  for (const [crate, npm] of [
    ['tauri-plugin-updater', '@tauri-apps/plugin-updater'],
    ['tauri-plugin-process', '@tauri-apps/plugin-process'],
  ] as const) {
    const rust = new RegExp(`^${crate} = "~(\\d+\\.\\d+)"`, 'm').exec(cargo)?.[1];
    const js = /^~(\d+\.\d+)\.\d+$/.exec(pkg.dependencies[npm] ?? '')?.[1];
    assert.ok(rust && js, `${crate} and ${npm} are held to a minor`);
    assert.equal(rust, js, `${crate} ${rust}, ${npm} ${js}`);
  }
  assert.match(read('apps/desktop/src-tauri/src/lib.rs'), /tauri_plugin_updater::Builder::new\(\)\.build\(\)/);
  assert.match(read('apps/desktop/src-tauri/src/lib.rs'), /tauri_plugin_process::init\(\)/);
});

test('the release workflow signs with the two secrets, refuses the placeholder, and writes latest.json once, after every build', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD \}\}/);
  assert.match(workflow, /uploadUpdaterJson: false/, "the action's racy latest.json is off");
  const check = workflow.slice(workflow.indexOf('  check:'), workflow.indexOf('  ci:'));
  assert.match(check, /updater-manifest\.cjs --check-config/, 'the check job refuses the placeholder before anything builds');
  const updater = workflow.slice(workflow.indexOf('\n  updater:'));
  assert.match(updater, /needs: \[check, installers\]/);
  assert.match(updater, /contents: write/);
  assert.match(updater, /updater-manifest\.cjs --tag "\$TAG" --version "\$VERSION"/);
  assert.match(updater, /gh release upload "\$TAG" latest\.json --repo "\$GITHUB_REPOSITORY" --clobber/);
  // No private key or password is ever written into the repository.
  for (const file of ['.github/workflows/release.yml', 'apps/desktop/src-tauri/tauri.conf.json']) {
    assert.doesNotMatch(read(file), /untrusted comment: (rsign|minisign) encrypted secret key/, file);
  }
});

/** What a release holds after the four builds, named as tauri-action names them. */
const ASSETS = [
  'Incudo_1.1.0_x64-setup.exe',
  'Incudo_1.1.0_x64-setup.exe.sig',
  'Incudo_1.1.0_x64_en-US.msi',
  'Incudo_1.1.0_x64_en-US.msi.sig',
  'Incudo_aarch64.app.tar.gz',
  'Incudo_aarch64.app.tar.gz.sig',
  'Incudo_x64.app.tar.gz',
  'Incudo_x64.app.tar.gz.sig',
  'Incudo_1.1.0_aarch64.dmg',
  'Incudo_1.1.0_x64.dmg',
  'Incudo_1.1.0_amd64.AppImage',
  'Incudo_1.1.0_amd64.AppImage.sig',
  'Incudo_1.1.0_amd64.deb',
  'Incudo-1.1.0-1.x86_64.rpm',
];
const SIGNED = ASSETS.filter((name) => ASSETS.includes(`${name}.sig`));
const signatures = Object.fromEntries(SIGNED.map((name) => [name, `sig of ${name}\n`]));
const input = { tag: 'v1.1.0', version: '1.1.0', repo: 'WCH-Softworks/Incudo', assets: ASSETS, signatures, pubDate: '2026-12-01T00:00:00.000Z' };

test("latest.json names every platform's signed installer, by the release's own download address", () => {
  const manifest = script.buildManifest(input);
  assert.equal(manifest.version, '1.1.0');
  assert.equal(manifest.notes, 'What is new in Incudo 1.1.0: https://github.com/WCH-Softworks/Incudo/releases/tag/v1.1.0');
  assert.deepEqual(Object.keys(manifest.platforms), [
    'darwin-aarch64',
    'darwin-aarch64-app',
    'darwin-x86_64',
    'darwin-x86_64-app',
    'linux-x86_64',
    'linux-x86_64-appimage',
    'windows-x86_64',
    'windows-x86_64-msi',
    'windows-x86_64-nsis',
  ]);
  for (const key of script.REQUIRED_PLATFORMS) assert.ok(manifest.platforms[key], key);
  assert.deepEqual(manifest.platforms['windows-x86_64'], {
    signature: 'sig of Incudo_1.1.0_x64-setup.exe',
    url: 'https://github.com/WCH-Softworks/Incudo/releases/download/v1.1.0/Incudo_1.1.0_x64-setup.exe',
  });
  assert.equal(manifest.platforms['windows-x86_64-msi']!.url.endsWith('/Incudo_1.1.0_x64_en-US.msi'), true);
  assert.equal(manifest.platforms['darwin-aarch64']!.url.endsWith('/Incudo_aarch64.app.tar.gz'), true);
  // An unsigned file (the .dmg, the .deb here) is never offered: the updater would refuse it anyway.
  assert.doesNotMatch(JSON.stringify(manifest), /\.dmg|\.deb|\.rpm/);
});

test('latest.json is refused, naming why, rather than written missing a platform or guessing a file', () => {
  // A build that failed: its platform is named.
  const noMac = { ...input, assets: ASSETS.filter((name) => !name.startsWith('Incudo_x64.app')) };
  assert.throws(() => script.buildManifest(noMac), /no signed update for darwin-x86_64/);
  // A file whose processor cannot be read off its name.
  assert.throws(
    () => script.buildManifest({ ...input, assets: [...ASSETS, 'Incudo.app.tar.gz'], signatures: { ...signatures, 'Incudo.app.tar.gz': 'x' } }),
    /Incudo\.app\.tar\.gz does not say which processor/,
  );
  // Two files for one platform.
  const copy = 'Incudo_1.1.0_x64_copy-setup.exe';
  assert.throws(
    () => script.buildManifest({ ...input, assets: [...ASSETS, copy], signatures: { ...signatures, [copy]: 'x' } }),
    /Two files are for windows-x86_64-nsis/,
  );
  assert.throws(() => script.buildManifest({ ...input, version: '1.1.0-rc.1' }), /not the app's version/);
  assert.equal(script.archOf('Incudo_1.1.0_amd64.AppImage'), 'x86_64');
  assert.equal(script.archOf('Incudo_aarch64.app.tar.gz'), 'aarch64');
  assert.equal(script.archOf('Incudo.app.tar.gz'), undefined);
});
