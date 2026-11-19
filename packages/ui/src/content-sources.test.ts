/**
 * The phone's content sources (`content-sources.ts`, ADR 0086). Each case names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, type FetchResult, type Fetcher, type GameSystem } from '@incudo/core';
import { auroraConverter } from '@incudo/aurora-import';
import { SourceProfile, cachePrefix, readSourceFile } from '@incudo/content';

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
  const sources = new ContentSources({ fetcher: new Host(), storage, converter: auroraConverter }, systems);
  await sources.restore();
  assert.equal(sources.suggestionsFor('game').length, 1);
  await sources.add('game', systems[0]!.suggestedSources![0]!);
  const [added] = sources.sourcesFor('game');
  assert.equal(added?.mode, 'download');
  assert.equal(added?.systemId, 'game');
  assert.ok(sources.getState().loaded['game']?.elements.get('ID_WIDGET'));
  assert.equal(sources.suggestionsFor('game').length, 0);
  assert.deepEqual(sources.sourcesFor('other'), [], "another system's sources are its own (ADR 0031)");
  assert.ok(await readSourceFile({ id: INDEX, url: INDEX }, { fetcher: new Host(), storage }), 'kept as its conversion (ADR 0119)');
  const saved = await SourceProfile.load(storage);
  assert.equal(saved.find(INDEX)?.elementCount, 1, 'the profile records what it contributed');
});

test('a load of the same sources is not made again; switching one off makes the next one again', async () => {
  // Perturbation: `load` without its key fetches or reads the whole source on every build screen.
  const host = new Host();
  const sources = new ContentSources({ fetcher: host, storage: new MemoryStorage(), converter: auroraConverter }, systems);
  await sources.add('game', systems[0]!.suggestedSources![0]!);
  const first = sources.getState().loaded['game'];
  assert.equal(await sources.load('game'), first);
  await sources.setEnabled(INDEX, false);
  assert.notEqual(sources.getState().loaded['game'], first, 'the load of the old set is forgotten');
  assert.equal((await sources.load('game')).elements.get('ID_WIDGET'), undefined);
});

test('two callers asking at once share one load', async () => {
  // Perturbation: no `pending` map makes two loads, twice the reads.
  const host = new Host();
  const storage = new MemoryStorage();
  await new ContentSources({ fetcher: host, storage, converter: auroraConverter }, systems).add('game', systems[0]!.suggestedSources![0]!);
  const sources = new ContentSources({ fetcher: host, storage, converter: auroraConverter }, systems);
  await sources.restore();
  const [a, b] = await Promise.all([sources.load('game'), sources.load('game')]);
  assert.equal(a, b);
});

test('removing a source removes the file it was kept as', async () => {
  // Perturbation: removing the profile entry only leaves its file, which on a phone is the space it took.
  const storage = new MemoryStorage();
  const sources = new ContentSources({ fetcher: new Host(), storage, converter: auroraConverter }, systems);
  await sources.add('game', systems[0]!.suggestedSources![0]!);
  await sources.remove(INDEX);
  assert.deepEqual(await storage.list(cachePrefix(INDEX)), []);
  assert.equal(await readSourceFile({ id: INDEX, url: INDEX }, { fetcher: new Host(), storage }), undefined);
  assert.equal(sources.sourcesFor('game').length, 0);
  assert.equal(sources.getState().loaded['game'], undefined);
});

test('restoring again publishes nothing', async () => {
  // Perturbation: `restore` patching a new `sources` array every call made the phone's Build screen, whose effect
  // restores and then depends on the sources it reads, render in a loop until React stopped it.
  const sources = new ContentSources({ fetcher: new Host(), storage: new MemoryStorage(), converter: auroraConverter }, systems);
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
  const sources = new ContentSources({ fetcher: host, storage: new MemoryStorage(), converter: auroraConverter }, systems);
  await sources.add('game', systems[0]!.suggestedSources![0]!);
  const adding = sources.add('game', { url: EXTRA, name: 'Extra' });
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
  const sources = new ContentSources({ fetcher: host, storage: new MemoryStorage(), converter: auroraConverter }, systems);
  await sources.add('game', systems[0]!.suggestedSources![0]!);
  const adding = sources.add('game', { url: EXTRA, name: 'Extra' });
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

// --- the phone's Content screen says what the desktop's Sources pane says (ADR 0132) -----------------------------------

const TWO = 'https://example.test/two.index';
/** An index of two files, so one can be switched off; and a conditional host, so an update check asks every file. */
class TwoFiles implements Fetcher {
  readonly conditional = true;
  changed = false;
  async fetchText(url: string, opts?: { etag?: string }): Promise<FetchResult> {
    const etag = `"${this.changed && url.endsWith('b.xml') ? 'v2' : 'v1'}:${url}"`;
    if (opts?.etag === etag) return { url, text: '', notModified: true, etag };
    if (url.endsWith('.index')) {
      return { url, etag, text: '<index><info><name>Two</name><update version="1.0.0" /></info><files><file name="a" url="a.xml" /><file name="b" url="b.xml" /></files></index>' };
    }
    const id = url.endsWith('a.xml') ? 'ID_A' : 'ID_B';
    return { url, etag, text: `<elements><element name="${id}" type="Widget" source="Two" id="${id}" /></elements>` };
  }
}
const twoSystems = [{ id: 'game', name: 'Game', suggestedSources: [{ url: TWO, name: 'Two' }] }] as unknown as GameSystem[];
const file = (name: string, xml: string) => ({ name, bytes: new TextEncoder().encode(xml) });

test("a source's parts are read, one switched off is left out of the next load, and the profile records it", async () => {
  // Perturbation: `setExcluded` not reloading leaves ID_B offered until something else loads; not persisting forgets it.
  const storage = new MemoryStorage();
  const sources = new ContentSources({ fetcher: new TwoFiles(), storage, converter: auroraConverter }, twoSystems);
  await sources.add('game', twoSystems[0]!.suggestedSources![0]!);
  const tree = await sources.readParts(TWO);
  const b = tree.children?.find((part) => part.url.endsWith('b.xml'));
  assert.ok(b, 'the tree lists the file');
  await sources.setExcluded(TWO, [b.url]);
  const loaded = sources.getState().loaded['game']!;
  assert.ok(loaded.elements.get('ID_A'));
  assert.equal(loaded.elements.get('ID_B'), undefined);
  assert.deepEqual((await SourceProfile.load(storage)).find(TWO)?.excluded, [b.url]);
  await sources.setExcluded(TWO, []);
  assert.ok(sources.getState().loaded['game']!.elements.get('ID_B'), 'switched on again');
  assert.equal((await SourceProfile.load(storage)).find(TWO)?.excluded, undefined);
});

test('a check for updates is reported on the source and changes nothing; a refresh clears it and reports itself', async () => {
  // Perturbation: a check that refreshed would change the loaded content; a refresh not recording its report says nothing.
  const host = new TwoFiles();
  const sources = new ContentSources({ fetcher: host, storage: new MemoryStorage(), converter: auroraConverter }, twoSystems);
  await sources.add('game', twoSystems[0]!.suggestedSources![0]!);
  await sources.checkForUpdates(TWO);
  assert.equal(sources.getState().updates[TWO]?.state, 'current');
  host.changed = true;
  const before = sources.getState().loaded['game'];
  await sources.checkForUpdates(TWO);
  const status = sources.getState().updates[TWO];
  assert.equal(status?.state, 'outdated');
  assert.equal(status?.state === 'outdated' && status.changed, 1);
  assert.equal(sources.getState().loaded['game'], before, 'a check loads nothing');
  await sources.refresh(TWO);
  assert.equal(sources.getState().updates[TWO], undefined, 'a refresh answers the check');
  const report = sources.getState().refreshes[TWO];
  assert.ok(report && !('failed' in report) && report.fetched >= 1);
});

test('an Aurora file the user picked is a source of its own under the system, loaded at once; one that does not read is a line', async () => {
  // Perturbation: `addFiles` not loading leaves the file's elements unoffered; not reporting a refusal says nothing at all.
  const storage = new MemoryStorage();
  const sources = new ContentSources({ fetcher: new TwoFiles(), storage, converter: auroraConverter }, twoSystems);
  await sources.restore();
  await sources.addFiles('game', [
    file('blades.xml', '<elements><element name="Blade" type="Widget" source="Mine" id="ID_BLADE" /></elements>'),
    file('broken.xml', 'not xml at all'),
  ]);
  const results = sources.getState().files!;
  assert.equal(results.length, 2);
  assert.ok(results[0]!.added);
  assert.ok(results[1]!.failed, results[1]!.failed);
  const [added] = sources.sourcesFor('game');
  assert.equal(added?.kind, 'file');
  assert.ok(sources.getState().loaded['game']?.elements.get('ID_BLADE'));
});

test('of two sources defining one id the later is used, the line says so, and moving one changes which', async () => {
  // Perturbation: `move` moving among every system's sources, or not loading again, leaves the other definition used.
  const sources = new ContentSources({ fetcher: new TwoFiles(), storage: new MemoryStorage(), converter: auroraConverter }, twoSystems);
  await sources.restore();
  const widget = (word: string) => `<elements><element name="Thing" type="Widget" source="${word}" id="ID_THING"><description>${word}</description></element></elements>`;
  await sources.addFiles('game', [file('first.xml', widget('First')), file('second.xml', widget('Second'))]);
  const loaded = () => sources.getState().loaded['game']!;
  assert.equal(loaded().elements.get('ID_THING')?.source, 'Second');
  const second = loaded().sources.find((source) => source.name.includes('second'))!;
  assert.equal(second.overlaps?.[0]?.used, 'this');
  await sources.move(second.id, 'up');
  assert.equal(loaded().elements.get('ID_THING')?.source, 'First');
});

test("a source missing what a switched-off one had names it, from that one's last load", async () => {
  // Perturbation: `load` without `switchedOff` leaves the line saying only that something is missing (ADR 0090).
  const sources = new ContentSources({ fetcher: new TwoFiles(), storage: new MemoryStorage(), converter: auroraConverter }, twoSystems);
  await sources.add('game', twoSystems[0]!.suggestedSources![0]!);
  await sources.addFiles('game', [file('needs.xml', '<elements><element name="Needs" type="Widget" source="Mine" id="ID_NEEDS"><rules><grant type="Widget" id="ID_A" /></rules></element></elements>')]);
  await sources.setEnabled(TWO, false);
  const loaded = await sources.load('game');
  const needs = loaded.sources.find((source) => source.name.includes('needs'))!;
  assert.deepEqual(needs.missing?.references, ['ID_A']);
  assert.equal(needs.switchedOff?.[0]?.sourceId, TWO);
});

test('switching a source on or off loads its system again when it was loaded, so every line says what it misses now', async () => {
  // Found on the emulator (ADR 0132's drive): the phone forgot the load and showed no notes until a Build screen loaded
  // again, where the desktop loads at once. Perturbation: `setEnabled` only forgetting the load fails this.
  const sources = new ContentSources({ fetcher: new TwoFiles(), storage: new MemoryStorage(), converter: auroraConverter }, twoSystems);
  await sources.add('game', twoSystems[0]!.suggestedSources![0]!);
  await sources.addFiles('game', [file('needs.xml', '<elements><element name="Needs" type="Widget" source="Mine" id="ID_NEEDS"><rules><grant type="Widget" id="ID_A" /></rules></element></elements>')]);
  await sources.setEnabled(TWO, false);
  // Nothing here asks for a load: the switch started one.
  for (let i = 0; i < 50 && sources.getState().loaded['game'] === undefined; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  const needs = sources.getState().loaded['game']?.sources.find((source) => source.name.includes('needs'));
  assert.deepEqual(needs?.missing?.references, ['ID_A']);
  assert.equal(needs?.switchedOff?.[0]?.sourceId, TWO);
});

test('a switch of a system nothing has loaded loads nothing: the phone loads only when asked', async () => {
  // Perturbation: loading on every switch would download or read a source on the Content screen unasked (ADR 0086).
  const host = new TwoFiles();
  const storage = new MemoryStorage();
  await new ContentSources({ fetcher: host, storage, converter: auroraConverter }, twoSystems).add('game', twoSystems[0]!.suggestedSources![0]!);
  const sources = new ContentSources({ fetcher: host, storage, converter: auroraConverter }, twoSystems);
  await sources.restore();
  await sources.setEnabled(TWO, false);
  await sources.setEnabled(TWO, true);
  assert.equal(sources.getState().loaded['game'], undefined);
});
