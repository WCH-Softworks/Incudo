/**
 * The phone's version and its Android version code — ADR 0132, decision 3. One implementation, used by the release
 * workflow (`.github/workflows/mobile-release.yml`) and held by `tools/verify/src/mobile-release.test.ts`.
 *
 * The phone has a version of its own (`app.json`'s `expo.version`, equal to `apps/mobile/package.json`'s), and its
 * version code only rises: MAJOR·1 000 000 + MINOR·10 000 + PATCH·100 + N, N a candidate's number (1 to 98) and 99 the
 * release itself. So 1.0.0-rc.1 < 1.0.0-rc.2 < 1.0.0 < 1.0.1-rc.1, and Play refuses nothing it should take.
 *
 * Run as a script with a tag (`mobile-v1.0.0-rc.2`): checks the tag against the app's version, prints the version code,
 * and with `--write` writes it into `app.json` (the workflow does this before prebuild; a committed `app.json` keeps the
 * release's own code, N = 99).
 */

const fs = require('node:fs');
const path = require('node:path');

const RELEASE = 99;

/** `{ version, candidate }` from a tag, or throws with a sentence. */
function parseTag(tag) {
  const match = /^mobile-v(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(tag);
  if (!match) throw new Error(`Tag ${tag} is neither mobile-vX.Y.Z nor mobile-vX.Y.Z-rc.N`);
  const candidate = match[4] === undefined ? undefined : Number(match[4]);
  if (candidate !== undefined && (candidate < 1 || candidate >= RELEASE)) {
    throw new Error(`Tag ${tag}: a candidate's number runs from 1 to ${RELEASE - 1}`);
  }
  return { version: `${match[1]}.${match[2]}.${match[3]}`, candidate };
}

/** The version code of a version and a candidate number (none: the release). */
function versionCode(version, candidate) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Version ${version} is not X.Y.Z`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (minor > 99 || patch > 99) throw new Error(`Version ${version}: minor and patch run to 99`);
  const n = candidate ?? RELEASE;
  return major * 1_000_000 + minor * 10_000 + patch * 100 + n;
}

module.exports = { parseTag, versionCode, RELEASE };

if (require.main === module) {
  const [tag, flag] = process.argv.slice(2);
  try {
    const appPath = path.join(__dirname, '..', 'app.json');
    const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const { version, candidate } = parseTag(tag ?? '');
    for (const [file, found] of [['app.json', app.expo.version], ['apps/mobile/package.json', pkg.version]]) {
      if (found !== version) throw new Error(`Tag ${tag} is version ${version}, and ${file} says ${found}`);
    }
    const code = versionCode(version, candidate);
    if (flag === '--write') {
      app.expo.android.versionCode = code;
      fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);
    }
    process.stdout.write(`${code}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
