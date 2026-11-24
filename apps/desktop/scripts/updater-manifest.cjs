// The desktop updater's release half — ADR 0133. Two jobs, both run by .github/workflows/release.yml and held by
// tools/verify/src/desktop-updater.test.ts:
//
//   node updater-manifest.cjs --check-config
//       Refuses a release whose tauri.conf.json still carries the placeholder update key, or a key that is not a
//       minisign public key, or no updater artifacts, or another address than the published release's latest.json.
//
//   node updater-manifest.cjs --tag v1.1.0 --version 1.1.0 --repo owner/name --assets names.txt --signatures dir
//       Writes latest.json to stdout from the release's own assets: every installer with a .sig beside it, under the
//       platform key the updater asks for. Fails, naming it, when a platform the release builds is missing.
//
// Why this and not tauri-action's own latest.json: each of the four build jobs read the release's latest.json, added
// its platform and uploaded it again, with nothing stopping two jobs reading the same copy, so the last upload could
// drop another platform. This runs once, after every build, and fails rather than write a partial file. Its download
// addresses are `releases/download/<tag>/<file>`, which answer once the draft is published.
//
// CommonJS, like apps/mobile/scripts/release-version.cjs, so Node runs it on a runner with nothing installed.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** What tauri.conf.json carries until the maintainer pastes the real public key (`npx tauri signer generate`). */
const PLACEHOLDER_PUBKEY = 'REPLACE-WITH-THE-UPDATE-PUBLIC-KEY';

/** The one address the app asks: GitHub serves it only from the newest published release that is not a pre-release. */
const ENDPOINT = 'https://github.com/WCH-Softworks/Incudo/releases/latest/download/latest.json';

/** Every platform the release workflow builds. A latest.json missing one would leave its users on the old version. */
const REQUIRED_PLATFORMS = ['windows-x86_64', 'darwin-aarch64', 'darwin-x86_64', 'linux-x86_64'];

/**
 * Whether `pubkey` reads as Tauri writes one: base64 of a minisign public key file, a comment line and then the key,
 * which is base64 of 42 bytes beginning "Ed".
 */
function isMinisignPublicKey(pubkey) {
  if (typeof pubkey !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(pubkey)) return false;
  const lines = Buffer.from(pubkey, 'base64').toString('utf8').split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment:')) return false;
  const key = Buffer.from(lines[1], 'base64');
  return key.length === 42 && key.subarray(0, 2).toString('latin1') === 'Ed';
}

/** What is wrong with tauri.conf.json for a release that updates, as sentences; empty when nothing is. */
function configProblems(conf) {
  const problems = [];
  const updater = conf && conf.plugins && conf.plugins.updater;
  if (!conf || !conf.bundle || conf.bundle.createUpdaterArtifacts !== true) {
    problems.push('bundle.createUpdaterArtifacts is not true, so no update would be built or signed.');
  }
  if (!updater) {
    problems.push('tauri.conf.json has no plugins.updater.');
    return problems;
  }
  if (updater.pubkey === PLACEHOLDER_PUBKEY) {
    problems.push(
      `plugins.updater.pubkey is still the placeholder ${PLACEHOLDER_PUBKEY}. Run \`npx tauri signer generate\`, keep the ` +
        'private key out of the repository, and paste the public key there.',
    );
  } else if (!isMinisignPublicKey(updater.pubkey)) {
    problems.push('plugins.updater.pubkey is not a minisign public key as `npx tauri signer generate` writes one.');
  }
  const endpoints = updater.endpoints;
  if (!Array.isArray(endpoints) || endpoints.length !== 1 || endpoints[0] !== ENDPOINT) {
    problems.push(`plugins.updater.endpoints must be exactly ["${ENDPOINT}"].`);
  }
  return problems;
}

/** The chip an asset is built for, read off its name: `aarch64`, `x86_64`, or undefined. */
function archOf(name) {
  if (/(^|[_.-])(aarch64|arm64)([_.-]|$)/i.test(name)) return 'aarch64';
  if (/(^|[_.-])(x86_64|x64|amd64)([_.-]|$)/i.test(name)) return 'x86_64';
  return undefined;
}

/** The kinds of installer the updater installs, by how the file ends, with the platform and the plain key's choice. */
const KINDS = [
  { suffix: '-setup.exe', os: 'windows', bundle: 'nsis', plain: true },
  { suffix: '.msi', os: 'windows', bundle: 'msi', plain: false },
  { suffix: '.app.tar.gz', os: 'darwin', bundle: 'app', plain: true },
  { suffix: '.AppImage', os: 'linux', bundle: 'appimage', plain: true },
  { suffix: '.deb', os: 'linux', bundle: 'deb', plain: false },
  { suffix: '.rpm', os: 'linux', bundle: 'rpm', plain: false },
];

/**
 * latest.json for a release, from its asset names and the text of each `.sig` (keyed by the signed file's name).
 * Throws, naming the file or the platform, rather than write a manifest that leaves anyone behind.
 */
function buildManifest({ tag, version, repo, assets, signatures, pubDate }) {
  if (!/^v\d+\.\d+\.\d+(-rc\.\d+)?$/.test(tag)) throw new Error(`${tag} is not a release tag.`);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${version} is not the app's version.`);
  const platforms = {};
  const put = (key, entry, from) => {
    if (platforms[key]) throw new Error(`Two files are for ${key}: ${platforms[key].from} and ${from}.`);
    platforms[key] = { ...entry, from };
  };
  for (const name of assets) {
    const kind = KINDS.find((candidate) => name.endsWith(candidate.suffix));
    if (!kind || signatures[name] === undefined) continue;
    const arch = archOf(name);
    if (!arch) throw new Error(`${name} does not say which processor it is for.`);
    const entry = {
      signature: signatures[name].trim(),
      url: `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
    };
    put(`${kind.os}-${arch}-${kind.bundle}`, entry, name);
    if (kind.plain) put(`${kind.os}-${arch}`, entry, name);
  }
  const missing = REQUIRED_PLATFORMS.filter((key) => !platforms[key]);
  if (missing.length > 0) {
    throw new Error(`The release has no signed update for ${missing.join(', ')}. Run the failed build again, then this.`);
  }
  const sorted = {};
  for (const key of Object.keys(platforms).sort()) {
    const { from: _from, ...entry } = platforms[key];
    sorted[key] = entry;
  }
  return {
    version,
    notes: `What is new in Incudo ${version}: https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: pubDate,
    platforms: sorted,
  };
}

function argument(argv, name) {
  const at = argv.indexOf(name);
  if (at < 0 || at + 1 >= argv.length) throw new Error(`${name} is required.`);
  return argv[at + 1];
}

function main(argv) {
  if (argv.includes('--check-config')) {
    const confPath = path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json');
    const problems = configProblems(JSON.parse(fs.readFileSync(confPath, 'utf8')));
    for (const problem of problems) console.error(`::error::${problem}`);
    return problems.length === 0 ? 0 : 1;
  }
  const dir = argument(argv, '--signatures');
  const signatures = {};
  for (const file of fs.readdirSync(dir)) {
    if (file.endsWith('.sig')) signatures[file.slice(0, -'.sig'.length)] = fs.readFileSync(path.join(dir, file), 'utf8');
  }
  const assets = fs
    .readFileSync(argument(argv, '--assets'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const manifest = buildManifest({
    tag: argument(argv, '--tag'),
    version: argument(argv, '--version'),
    repo: argument(argv, '--repo'),
    assets,
    signatures,
    pubDate: new Date().toISOString(),
  });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  return 0;
}

module.exports = { PLACEHOLDER_PUBKEY, ENDPOINT, REQUIRED_PLATFORMS, isMinisignPublicKey, configProblems, archOf, buildManifest };

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
