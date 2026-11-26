/**
 * The release build asks for exactly the permissions ADR 0132 decision 4 lists — read off the build, not off `app.json`.
 *
 * `app.json` blocks what Expo's template and the dev menu add, and `tools/verify/src/mobile-release.test.ts` holds that
 * list. What a phone is asked for is what the Android Gradle Plugin merges from every library, which only a build
 * shows. This reads the merged release manifests under `android/app/build/intermediates` and fails, naming them, on a
 * permission nobody listed here, or on one listed here that the build lost (ADR 0135, decision 8).
 *
 * Run from `apps/mobile` after `gradlew :app:bundleRelease`: `node scripts/check-permissions.cjs`. The release workflow
 * and the pull-request Android check both run it.
 */

const fs = require('node:fs');
const path = require('node:path');

/** What the app uses, as the privacy policy's table says (`docs/PRIVACY.md`). */
const USED = ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE', 'android.permission.ACCESS_WIFI_STATE'];

/**
 * AndroidX's own: a permission the app declares for itself and holds, so that a receiver registered at run time is not
 * exported. Measured in every release build (`docs/release-checks/mobile-v1.0.0-rc.2.md`). Nothing outside the app can
 * hold it, and it asks the user nothing.
 */
const OWN = (pkg) => [`${pkg}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`];

/** Every merged manifest of the release variant under a build's intermediates. */
function releaseManifests(intermediates) {
  const found = [];
  const walk = (dir, trail) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(next, [...trail, entry.name]);
      else if (entry.name === 'AndroidManifest.xml' && /^merged_manifests?$/.test(trail[0] ?? '') && trail.includes('release')) {
        found.push(next);
      }
    }
  };
  walk(intermediates, []);
  return found;
}

/** The `uses-permission` names a manifest asks for, sorted, once each. */
function requested(manifest) {
  const names = [...manifest.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*\bandroid:name="([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

/** Sentences for every way a manifest's permissions differ from what is allowed; empty when it agrees. */
function problems(names, pkg) {
  const allowed = new Set([...USED, ...OWN(pkg)]);
  const out = [];
  for (const name of names) if (!allowed.has(name)) out.push(`asks for ${name}, which ADR 0132 decision 4 does not list`);
  for (const name of USED) if (!names.includes(name)) out.push(`does not ask for ${name}, which the app uses`);
  return out;
}

module.exports = { USED, OWN, releaseManifests, requested, problems };

if (require.main === module) {
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'));
  const pkg = app.expo.android.package;
  const intermediates = path.join(__dirname, '..', 'android', 'app', 'build', 'intermediates');
  if (!fs.existsSync(intermediates)) {
    process.stderr.write(`No build at ${path.relative(process.cwd(), intermediates)}: run gradlew :app:bundleRelease first\n`);
    process.exit(1);
  }
  const manifests = releaseManifests(intermediates);
  if (manifests.length === 0) {
    process.stderr.write('The build has no merged release manifest under its intermediates\n');
    process.exit(1);
  }
  let failed = false;
  for (const file of manifests) {
    const names = requested(fs.readFileSync(file, 'utf8'));
    const where = path.relative(path.join(__dirname, '..'), file);
    const found = problems(names, pkg);
    if (found.length === 0) process.stdout.write(`${where}: ${names.join(', ')}\n`);
    for (const line of found) {
      failed = true;
      process.stdout.write(`::error::${where} ${line}\n`);
    }
  }
  process.exit(failed ? 1 : 0);
}
