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
