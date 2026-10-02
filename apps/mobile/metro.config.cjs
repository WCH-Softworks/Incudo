/**
 * Metro, for a phone app that lives in a workspace — ADR 0083. `.cjs` because the package is an ES module (so Node and
 * `tsc` read `src/zip.ts` as one when `tools/verify` tests it) and Metro loads its config with `require`.
 *
 * Three things beyond Expo's defaults:
 * - the repository root is watched, so the shared packages (`packages/*`, TypeScript sources, imported with their `.ts`
 *   extensions) and the shipped data (`systems/`, `schemas/`) are part of the bundle;
 * - `@repo/systems` and `@repo/schemas` name those folders, as the desktop's Vite config does;
 * - `react` always resolves to this app's copy. The desktop keeps a newer React of its own, and which copy npm hoists
 *   to the root is npm's business: a second React in the bundle fails at the first hook, so this does not leave it to
 *   chance.
 */

const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...new Set([...(config.watchFolders ?? []), repoRoot])];

const aliases = {
  '@repo/systems': path.join(repoRoot, 'systems'),
  '@repo/schemas': path.join(repoRoot, 'schemas'),
};

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const [alias, folder] of Object.entries(aliases)) {
    if (moduleName.startsWith(`${alias}/`)) {
      return { type: 'sourceFile', filePath: path.join(folder, ...moduleName.slice(alias.length + 1).split('/')) };
    }
  }
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return { type: 'sourceFile', filePath: require.resolve(moduleName, { paths: [projectRoot] }) };
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
