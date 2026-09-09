/**
 * The fetchers, and specifically the difference between "we did not use the network" and
 * "we could not have used the network".
 *
 * `LocalMirrorFetcher` falls through to its fallback on a miss, which is right for a partial
 * mirror on someone's laptop and quietly wrong in CI: a mirror miss became a live fetch that
 * could pass by accident, hang, or make an offline run depend on GitHub being up. `--offline`
 * is what turns the claim into a guarantee, so it gets tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { Fetcher } from '@incudo/core';
import { LocalMirrorFetcher, OfflineFetcher } from './node-platform.ts';

const REMOTE = 'https://raw.githubusercontent.com/AuroraLegacy/elements/master/core/spells.xml';

/** Stands in for the network, and records whether anything reached for it. */
class SpyFetcher implements Fetcher {
  calls: string[] = [];
  async fetchText(url: string) {
    this.calls.push(url);
    return { url, text: '<elements/>' };
  }
}

async function withMirror<T>(
  files: Record<string, string>,
  run: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'incudo-mirror-'));
  try {
    for (const [path, body] of Object.entries(files)) {
      const target = join(root, ...path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body, 'utf8');
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('a mirror hit never reaches the fallback', async () => {
  await withMirror({ 'core/spells.xml': '<elements>local</elements>' }, async (root) => {
    const spy = new SpyFetcher();
    const result = await new LocalMirrorFetcher(root, spy).fetchText(REMOTE);

    assert.equal(result.text, '<elements>local</elements>');
    assert.equal(result.fromCache, true);
    assert.deepEqual(spy.calls, []);
  });
});

test('a mirror miss falls through, which is the behaviour --offline exists to stop', async () => {
  await withMirror({}, async (root) => {
    const spy = new SpyFetcher();
    await new LocalMirrorFetcher(root, spy).fetchText(REMOTE);
    // Deliberate for a partial mirror; invisible and wrong in CI.
    assert.deepEqual(spy.calls, [REMOTE]);
  });
});

test('offline turns that silent fetch into a named error', async () => {
  await withMirror({}, async (root) => {
    await assert.rejects(
      () => new LocalMirrorFetcher(root, new OfflineFetcher()).fetchText(REMOTE),
      (error: Error) => {
        // Both halves matter. The URL alone sends people to check their network, which is
        // the one thing that is not the problem; the path says what to actually go and look at.
        assert.match(error.message, /refused to fetch/);
        assert.match(error.message, /--offline/);
        assert.match(error.message, /core[\\/]spells\.xml/);
        return true;
      },
    );
  });
});

test('offline still reads local paths — it refuses the network, not the disk', async () => {
  await withMirror({ 'core.index': 'INDEX' }, async (root) => {
    const result = await new OfflineFetcher().fetchText(join(root, 'core.index'));
    assert.equal(result.text, 'INDEX');
  });
});

test('offline on its own refuses a remote URL outright', async () => {
  await assert.rejects(() => new OfflineFetcher().fetchText(REMOTE), /refused to fetch/);
});
