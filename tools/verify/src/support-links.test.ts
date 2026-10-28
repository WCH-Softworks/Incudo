/**
 * The About screen's links are the README's and the Sponsor button's, and the window may open exactly them.
 *
 * Four places name the same addresses: `packages/ui/src/about.ts` (what the app shows), README's Support section,
 * `.github/FUNDING.yml` (the repository's Sponsor button) and the desktop window's capability, which scopes the opener
 * plugin to the URLs it lists. A page renamed in one and not the others would leave a link that goes somewhere else or,
 * in the window, does nothing at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ABOUT_URLS, SOURCE_LINK, SUPPORT_LINKS } from '@incudo/ui';
import { repoRoot } from './node-system.ts';

const read = (...parts: string[]) => readFile(join(repoRoot(), ...parts), 'utf8');

test('each support link is printed as its own address', () => {
  // Fails if the text a person reads names a different page from the one the link opens.
  for (const link of [SOURCE_LINK, ...SUPPORT_LINKS]) assert.equal(`https://${link.text}`, link.url, link.label);
});

test('the support links are the README Support section\'s, in its order', async () => {
  const readme = await read('README.md');
  const section = readme.slice(readme.indexOf('## Support'));
  const listed = [...section.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((match) => match[1]);
  assert.deepEqual(listed, SUPPORT_LINKS.map((link) => link.url));
});

test('the support links are the Sponsor button\'s', async () => {
  const funding = await read('.github', 'FUNDING.yml');
  const entries = Object.fromEntries(
    [...funding.matchAll(/^(\w+):\s*(\S+)\s*$/gm)].map((match) => [match[1], match[2]] as const),
  );
  const hosts: Record<string, string> = { patreon: 'https://patreon.com/', ko_fi: 'https://ko-fi.com/' };
  const fromFunding = Object.entries(entries).map(([platform, handle]) => {
    assert.ok(hosts[platform], `FUNDING.yml names ${platform}, which this test does not know how to spell as a URL`);
    return hosts[platform] + handle;
  });
  assert.deepEqual([...fromFunding].sort(), SUPPORT_LINKS.map((link) => link.url).sort());
});

test('the window may open exactly the About links, and no other address', async () => {
  const capability = JSON.parse(await read('apps', 'desktop', 'src-tauri', 'capabilities', 'default.json')) as {
    permissions: Array<string | { identifier: string; allow?: Array<{ url: string; path?: string }> }>;
  };
  // Showing where a source's file is kept (ADR 0119) opens a folder and no address: the one other opener permission, and
  // only on the app's own sources folder.
  const folder = capability.permissions.filter((permission) => typeof permission === 'object' && permission.identifier === 'opener:allow-open-path');
  assert.deepEqual(folder, [{ identifier: 'opener:allow-open-path', allow: [{ path: '$APPDATA/sources' }] }]);
  const opener = capability.permissions.filter((permission) => {
    const id = typeof permission === 'string' ? permission : permission.identifier;
    return id.startsWith('opener:') && id !== 'opener:allow-open-path';
  });
  // Fails if the plugin is granted unscoped (`opener:default` or a bare `opener:allow-open-url` opens any address).
  assert.equal(opener.length, 1, JSON.stringify(opener));
  const [only] = opener;
  assert.ok(typeof only === 'object' && only.identifier === 'opener:allow-open-url', JSON.stringify(only));
  assert.deepEqual(only.allow!.map((entry) => entry.url).sort(), [...ABOUT_URLS].sort());
});
