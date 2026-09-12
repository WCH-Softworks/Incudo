/**
 * ADR 0029: the layers get composed, the cache is read back, and a refresh evicts one source.
 *
 * The measurement that motivated it — 238 files, 44.8 s cold and sequential — is in the ADR
 * and cannot be a unit test. What *can* be tested is the property that made it matter: a
 * second load must not touch the network at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, type FetchResult, type Fetcher } from '@incudo/core';

import {
  cachePrefix,
  checkSourceForUpdates,
  composeSource,
  evictSourceCache,
  readVersionStamp,
  writeVersionStamp,
} from './compose.ts';
import { ContentLibrary } from './library.ts';
import { SourceProfile } from './profile.ts';

const INDEX_URL = 'https://example.test/core.index';

/** A fetcher that counts, so "did this touch the network?" is a number rather than a hope. */
class CountingFetcher implements Fetcher {
  readonly requested: string[] = [];
  version = '1.0.0';
  offline = false;

  async fetchText(url: string): Promise<FetchResult> {
    if (this.offline) throw new Error(`offline: refused ${url}`);
    this.requested.push(url);
    if (url.endsWith('.index')) {
      return {
        url,
        text: [
          '<?xml version="1.0" encoding="utf-8"?>',
          '<index>',
          '  <info>',
          '    <name>Core</name>',
          `    <update version="${this.version}" />`,
          '  </info>',
          '  <files>',
          '    <file name="Widgets" url="widgets.xml" />',
          '  </files>',
          '</index>',
        ].join('\n'),
      };
    }
    return {
      url,
      text: [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<elements>',
        '  <element name="Widget" type="Widget" source="Core" id="ID_WIDGET">',
        '    <description><p>A widget.</p></description>',
        '  </element>',
        '</elements>',
      ].join('\n'),
    };
  }
}

function configured(mode: 'stream' | 'download' = 'stream') {
  return new SourceProfile(new MemoryStorage()).add(INDEX_URL, { mode });
}

test('the second load of a source reads the cache and never the network', async () => {
  const fetcher = new CountingFetcher();
  const storage = new MemoryStorage();
  const source = configured();

  const first = await new ContentLibrary().loadSource(
    composeSource(source, { fetcher, storage }),
    INDEX_URL,
  );
  assert.equal(first.filesLoaded, 1);
  const firstRequests = fetcher.requested.length;
  assert.ok(firstRequests >= 2, 'the first load fetches the index and its file');

  // This is the bug the app shipped with: writeThrough wrote a cache nothing read back, so a
  // reload re-fetched all 238 files. Going hard-offline proves the cache is really the reader.
  fetcher.offline = true;
  const second = await new ContentLibrary().loadSource(
    composeSource(source, { fetcher, storage }),
    INDEX_URL,
  );
  assert.equal(second.filesLoaded, 1);
  assert.equal(second.elementsLoaded, 1);
  assert.equal(fetcher.requested.length, firstRequests, 'and nothing else was requested');
});

test('evicting one source leaves every other source alone', async () => {
  const fetcher = new CountingFetcher();
  const storage = new MemoryStorage();
  const source = configured();

  await new ContentLibrary().loadSource(composeSource(source, { fetcher, storage }), INDEX_URL);
  await storage.write(`${cachePrefix('other')}something`, 'not mine');

  const removed = await evictSourceCache(storage, source.id);
  assert.ok(removed >= 2, `expected the index and its file to go, got ${removed}`);
  assert.deepEqual(await storage.list(cachePrefix(source.id)), []);
  assert.deepEqual(await storage.list(cachePrefix('other')), [`${cachePrefix('other')}something`]);

  // And the source reloads from the network, which is what an eviction is for.
  const after = await new ContentLibrary().loadSource(
    composeSource(source, { fetcher, storage }),
    INDEX_URL,
  );
  assert.equal(after.filesLoaded, 1);
});

test('the version is a stamp beside the cache, not part of its keys', async () => {
  const storage = new MemoryStorage();
  await writeVersionStamp(storage, INDEX_URL, '1.0.0');
  assert.equal(await readVersionStamp(storage, INDEX_URL), '1.0.0');

  // Same key whatever the version, which is the half of ADR 0029 that departs from ADR 0004.
  await writeVersionStamp(storage, INDEX_URL, '2.0.0');
  const keys = await storage.list(cachePrefix(INDEX_URL));
  assert.equal(keys.length, 1, `one stamp, not one per version: ${JSON.stringify(keys)}`);
  assert.equal(await readVersionStamp(storage, INDEX_URL), '2.0.0');
});

test('an update check reports and writes nothing', async () => {
  const fetcher = new CountingFetcher();
  const storage = new MemoryStorage();
  const source = configured();

  await writeVersionStamp(storage, source.id, '1.0.0');
  assert.deepEqual(await checkSourceForUpdates(source, { fetcher, storage }), {
    state: 'current',
    version: '1.0.0',
  });

  fetcher.version = '1.4.0';
  assert.deepEqual(await checkSourceForUpdates(source, { fetcher, storage }), {
    state: 'outdated',
    local: '1.0.0',
    remote: '1.4.0',
  });

  // The check must not have filled the cache behind the user's back: only the stamp is there.
  assert.deepEqual(await storage.list(cachePrefix(source.id)), [
    `${cachePrefix(source.id)}.version`,
  ]);
  // And it did not move the stamp either — a check that refreshed would be a silent update.
  assert.equal(await readVersionStamp(storage, source.id), '1.0.0');
});

test('an update check that cannot reach the network says so instead of guessing', async () => {
  const fetcher = new CountingFetcher();
  fetcher.offline = true;
  const storage = new MemoryStorage();
  await writeVersionStamp(storage, INDEX_URL, '1.0.0');

  const status = await checkSourceForUpdates(configured(), { fetcher, storage });
  assert.equal(status.state, 'unknown');
  assert.match((status as { reason: string }).reason, /offline/);
});

test('nothing cached yet is unknown rather than current', async () => {
  const status = await checkSourceForUpdates(configured(), {
    fetcher: new CountingFetcher(),
    storage: new MemoryStorage(),
  });
  assert.equal(status.state, 'unknown');
  assert.match((status as { reason: string }).reason, /nothing was cached/i);
});

/**
 * A load from the cache has to be the *same* load, not merely a load of the same size.
 *
 * For the whole life of ADR 0029's cache, `CachedContentSource.loadFile` returned everything
 * `HttpContentSource` did **except `appends`**. Every `<append>` in a corpus — 171 of them in
 * AuroraLegacy, the mechanism by which a supplement extends a core element without editing
 * it — was therefore dropped on every load after the first.
 *
 * Nothing said so. Same file count, same element count, same diagnostics: what changed was
 * what the character's own elements could *reach*, and that only shows when something walks
 * the graph. It was found by importing one Aurora save twice in the running app and watching
 * "250 elements embedded" become 227 — the missing 23 being the firearms option and every
 * proficiency it grants, which upstream declares with exactly this construct. It would have
 * written short saves for every user from their second session onwards, which is the ADR 0012
 * failure exactly.
 *
 * So the assertion is not "the cache works". It is "the two layers answer the same".
 */
class AppendingFetcher implements Fetcher {
  offline = false;

  async fetchText(url: string): Promise<FetchResult> {
    if (this.offline) throw new Error(`offline: refused ${url}`);
    if (url.endsWith('.index')) {
      return {
        url,
        text: [
          '<?xml version="1.0" encoding="utf-8"?>',
          '<index>',
          '  <info><name>Core</name><update version="1.0.0" /></info>',
          '  <files>',
          '    <file name="Core" url="core.xml" />',
          '    <file name="Supplement" url="supplement.xml" />',
          '  </files>',
          '</index>',
        ].join('\n'),
      };
    }
    if (url.endsWith('supplement.xml')) {
      return {
        url,
        text: [
          '<?xml version="1.0" encoding="utf-8"?>',
          '<elements>',
          '  <append id="ID_MARTIAL_RANGED">',
          '    <supports>Extra Tag</supports>',
          '    <rules><grant type="Proficiency" id="ID_REVOLVER" /></rules>',
          '  </append>',
          '</elements>',
        ].join('\n'),
      };
    }
    return {
      url,
      text: [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<elements>',
        '  <element name="Martial Ranged" type="Proficiency" source="Core" id="ID_MARTIAL_RANGED">',
        '    <rules />',
        '  </element>',
        '</elements>',
      ].join('\n'),
    };
  }
}

test('a load from the cache carries the appends a load from the network did', async () => {
  const fetcher = new AppendingFetcher();
  const storage = new MemoryStorage();
  const source = configured();

  const fresh = new ContentLibrary();
  const first = await fresh.loadSource(composeSource(source, { fetcher, storage }), INDEX_URL);
  assert.equal(first.filesLoaded, 2);
  assert.equal(first.elementsLoaded, 1, 'an append is not an element');
  assert.equal(fresh.elements.get('ID_MARTIAL_RANGED')?.rules.length, 1);
  assert.deepEqual(fresh.elements.get('ID_MARTIAL_RANGED')?.supports, ['Extra Tag']);

  fetcher.offline = true;
  const reloaded = new ContentLibrary();
  const second = await reloaded.loadSource(composeSource(source, { fetcher, storage }), INDEX_URL);

  // Every count agrees, which is the whole problem with counting.
  assert.equal(second.filesLoaded, first.filesLoaded);
  assert.equal(second.elementsLoaded, first.elementsLoaded);
  assert.equal(second.diagnostics.length, first.diagnostics.length);

  assert.equal(
    reloaded.elements.get('ID_MARTIAL_RANGED')?.rules.length,
    1,
    'the append has to survive the cache, or the corpus is quietly a different corpus',
  );
  assert.deepEqual(reloaded.elements.get('ID_MARTIAL_RANGED')?.supports, ['Extra Tag']);
});
