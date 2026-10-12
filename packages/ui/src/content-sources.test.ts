/**
 * The phone's content sources (`content-sources.ts`, ADR 0086). Each case names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, type FetchResult, type Fetcher, type GameSystem } from '@incudo/core';
import { SourceProfile, cachePrefix, convertedPrefix } from '@incudo/content';

import { ContentSources } from './content-sources.ts';

const INDEX = 'https://example.test/core.index';

class Host implements Fetcher {
  asked = 0;
  async fetchText(url: string): Promise<FetchResult> {
    this.asked++;
    if (url.endsWith('.index')) {
      return { url, text: '<index><info><name>Core</name><update version="1.0.0" /></info><files><file name="w" url="w.xml" /></files></index>' };
    }
    return { url, text: '<elements><element name="Widget" type="Widget" source="Core" id="ID_WIDGET" /></elements>' };
  }
}

const systems = [
  { id: 'game', name: 'Game', suggestedSources: [{ url: INDEX, name: 'Core', official: true }] },
  { id: 'other', name: 'Other' },
] as unknown as GameSystem[];

test('a suggested source is added under its system, downloaded and loaded, and offered no more', async () => {
  // Perturbation: `add` not loading leaves the build screen with nothing until something else asks.
  const storage = new MemoryStorage();
  const sources = new ContentSources({ fetcher: new Host(), storage }, systems);
  await sources.restore();
  assert.equal(sources.suggestionsFor('game').length, 1);
  await sources.add('game', systems[0]!.suggestedSources![0]!, 'converted');
  const [added] = sources.sourcesFor('game');
  assert.equal(added?.mode, 'download');
  assert.equal(added?.systemId, 'game');
  assert.ok(sources.getState().loaded['game']?.elements.get('ID_WIDGET'));
  assert.equal(sources.suggestionsFor('game').length, 0);
  assert.deepEqual(sources.sourcesFor('other'), [], "another system's sources are its own (ADR 0031)");
  assert.ok((await storage.list(convertedPrefix(INDEX))).length > 0, 'kept converted as chosen (ADR 0085)');
  const saved = await SourceProfile.load(storage);
  assert.equal(saved.find(INDEX)?.elementCount, 1, 'the profile records what it contributed');
});

test('a load of the same sources is not made again; switching one off makes the next one again', async () => {
  // Perturbation: `load` without its key fetches or reads the whole source on every build screen.
  const host = new Host();
  const sources = new ContentSources({ fetcher: host, storage: new MemoryStorage() }, systems);
  await sources.add('game', systems[0]!.suggestedSources![0]!, 'converted');
  const first = sources.getState().loaded['game'];
  assert.equal(await sources.load('game'), first);
  await sources.setEnabled(INDEX, false);
  assert.equal(sources.getState().loaded['game'], undefined);
  assert.equal((await sources.load('game')).elements.get('ID_WIDGET'), undefined);
});

test('two callers asking at once share one load', async () => {
  // Perturbation: no `pending` map makes two loads, twice the reads and twice the conversion.
  const host = new Host();
  const storage = new MemoryStorage();
  await new ContentSources({ fetcher: host, storage }, systems).add('game', systems[0]!.suggestedSources![0]!, 'files');
  const sources = new ContentSources({ fetcher: host, storage }, systems);
  await sources.restore();
  const [a, b] = await Promise.all([sources.load('game'), sources.load('game')]);
  assert.equal(a, b);
});

test('removing a source removes what it kept on the device', async () => {
  // Perturbation: removing the profile entry only leaves its content in storage, which on a phone is the space it took.
  const storage = new MemoryStorage();
  const sources = new ContentSources({ fetcher: new Host(), storage }, systems);
  await sources.add('game', systems[0]!.suggestedSources![0]!, 'converted');
  await sources.remove(INDEX);
  assert.deepEqual(await storage.list(cachePrefix(INDEX)), []);
  assert.equal(sources.sourcesFor('game').length, 0);
  assert.equal(sources.getState().loaded['game'], undefined);
});

test('choosing how a source is kept loads it again that way', async () => {
  // Perturbation: `setKeep` only recording the choice leaves the conversion in place until something else loads.
  const storage = new MemoryStorage();
  const sources = new ContentSources({ fetcher: new Host(), storage }, systems);
  await sources.add('game', systems[0]!.suggestedSources![0]!, 'converted');
  await sources.setKeep(INDEX, 'files');
  assert.deepEqual(await storage.list(convertedPrefix(INDEX)), []);
  assert.ok(sources.getState().loaded['game']?.elements.get('ID_WIDGET'));
});

test('restoring again publishes nothing', async () => {
  // Perturbation: `restore` patching a new `sources` array every call made the phone's Build screen, whose effect
  // restores and then depends on the sources it reads, render in a loop until React stopped it.
  const sources = new ContentSources({ fetcher: new Host(), storage: new MemoryStorage() }, systems);
  await sources.restore();
  const before = sources.getState();
  let published = 0;
  sources.subscribe(() => published++);
  await sources.restore();
  assert.equal(published, 0);
  assert.equal(sources.getState(), before);
});

const EXTRA = 'https://example.test/extra.index';

/** A host that answers the extra source only when told to, one request at a time, in the order the test chooses. */
class SlowHost implements Fetcher {
  readonly held: Array<() => void> = [];
  private asked: Array<() => void> = [];
  /** Resolves once `count` requests for the extra source are waiting. */
  waiting(count: number): Promise<void> {
    if (this.held.length >= count) return Promise.resolve();
    return new Promise((resolve) => this.asked.push(() => this.held.length >= count && resolve()));
  }
  async fetchText(url: string): Promise<FetchResult> {
    if (url === EXTRA) {
      await new Promise<void>((release) => {
        this.held.push(release);
        for (const check of this.asked) check();
      });
      return { url, text: '<index><info><name>Extra</name><update version="1.0.0" /></info><files><file name="x" url="x.xml" /></files></index>' };
    }
    if (url.endsWith('x.xml')) {
      return { url, text: '<elements><element name="Extra" type="Widget" source="Extra" id="ID_EXTRA" /></elements>' };
    }
    return new Host().fetchText(url);
  }
}

test('a load whose sources were switched since it began publishes nothing, and hands back the current load', async () => {
  // Perturbation: publishing every load as it ends (the old `load`) leaves the extra source's element in the content
  // after it was switched off, because its load, begun first, ended last.
  const host = new SlowHost();
  const sources = new ContentSources({ fetcher: host, storage: new MemoryStorage() }, systems);
  await sources.add('game', systems[0]!.suggestedSources![0]!, 'converted');
  const adding = sources.add('game', { url: EXTRA, name: 'Extra' }, 'converted');
  await host.waiting(1);
  await sources.setEnabled(EXTRA, false);
  const now = await sources.load('game');
  assert.equal(now.elements.get('ID_EXTRA'), undefined);
  assert.equal(sources.getState().loading, undefined, 'the current load has published; the other will not');

  host.held[0]!();
  await adding;
  assert.equal(sources.getState().loaded['game'], now, 'the earlier load, ending last, changed nothing');
  assert.equal(sources.getState().loading, undefined);
  assert.equal(await sources.load('game'), now);
});

test('a load that will not publish does not end "loading" while the current one runs', async () => {
  // Perturbation: clearing `loading` whenever any load ends tells the screen nothing is loading while the current
  // load is still running.
  const host = new SlowHost();
  const sources = new ContentSources({ fetcher: host, storage: new MemoryStorage() }, systems);
  await sources.add('game', systems[0]!.suggestedSources![0]!, 'converted');
  const adding = sources.add('game', { url: EXTRA, name: 'Extra' }, 'converted');
  await host.waiting(1);
  await sources.setEnabled(INDEX, false);
  const current = sources.load('game');
  await host.waiting(2);

  host.held[0]!();
  const settled = adding.then(() => 'ended');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(sources.getState().loading, 'the extra-only load is still running');
  assert.equal(sources.getState().loaded['game'], undefined, 'and nothing has been published');

  host.held[1]!();
  const loaded = await current;
  assert.equal(await settled, 'ended');
  assert.ok(loaded.elements.get('ID_EXTRA'));
  assert.equal(loaded.elements.get('ID_WIDGET'), undefined, 'Core was switched off');
  assert.equal(sources.getState().loaded['game'], loaded);
  assert.equal(sources.getState().loading, undefined);
});
