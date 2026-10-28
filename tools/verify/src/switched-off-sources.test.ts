/**
 * ADR 0090 on the real corpus: AuroraLegacy's indexes added as sources of their own, some switched off, and what each
 * enabled one's line names of them.
 *
 * Asserted, against any corpus (ADR 0042): what a line names under a switched-off source is exactly what that source,
 * loaded on its own, declares of what the line is missing (nothing more, nothing less), and a source loaded after one
 * that holds the same files (Core, then the Player's Handbook index Core lists) records what those files declare, as if
 * it had loaded alone. Reported: the counts, how large the records are, and how long reading them takes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage } from '@incudo/core';
import { auroraConverter } from '@incudo/aurora-import';
import {
  ContentLibrary,
  SourceProfile,
  declaredKey,
  loadSources,
  readDeclared,
  type ConfiguredSource,
  type LoadedSource,
} from '@incudo/content';

import { convertCorpus, corpusFetcher, readCorpusIndex } from './corpus.ts';
import { corpusProvenance, corpusSkip, requireCorpus } from './real-data.ts';

type Diagnostic = { diagnostic: (s: string) => void };

test('a switched-off source is named for exactly what it declares of what a line is missing', { skip: corpusSkip }, async (t: Diagnostic) => {
  t.diagnostic(corpusProvenance());
  const location = requireCorpus();
  const fetcher = corpusFetcher(location);
  const resolveByName = location.layout === 'aurora-folder';
  const indexOf = (url: string) => readCorpusIndex(location, url);

  // The indexes a user would add one by one, found by what they are rather than by position.
  const top = await indexOf(location.index);
  const groups = top.files.filter((ref) => ref.isIndex);
  const core = groups.find((ref) => /core/i.test(ref.name))!;
  const supplements = groups.find((ref) => /supplement/i.test(ref.name))!;
  assert.ok(core && supplements, 'the corpus has a core and a supplements index');
  const books = [...(await indexOf(core.url)).files, ...(await indexOf(supplements.url)).files].filter((ref) => ref.isIndex);
  const book = (pattern: RegExp) => books.find((ref) => pattern.test(ref.name))!;
  const phb = book(/^players-handbook\.index$/i);
  const tashas = book(/tasha/i);
  const xanathars = book(/xanathar/i);

  const storage = new MemoryStorage();
  const profile = new SourceProfile(storage);
  const added = [core, phb, tashas, xanathars, supplements].map((ref) =>
    profile.add(ref.url, { name: ref.name, mode: 'download' }),
  );
  const nameOf = (id: string) => added.find((source) => source.id === id)!.name;
  const load = async (enabled: ConfiguredSource[]): Promise<Map<string, LoadedSource>> => {
    for (const source of added) source.enabled = enabled.includes(source);
    const loaded = await loadSources(profile.enabled, { fetcher, storage, resolveByName, converter: auroraConverter }, undefined, {
      switchedOff: profile.sources.filter((source) => !source.enabled),
    });
    return new Map(loaded.sources.map((source) => [source.id, source]));
  };
  // Xanathar's is switched off in every case below, and declares nothing any of them is missing.
  const [coreSource, phbSource, tashasSource, , supplementsSource] = added as ConfiguredSource[] as [
    ConfiguredSource,
    ConfiguredSource,
    ConfiguredSource,
    ConfiguredSource,
    ConfiguredSource,
  ];

  // What each declares loaded alone, for the comparison.
  const alone = new Map<string, Set<string>>();
  for (const source of added) {
    const library = new ContentLibrary();
    const report = library.loadBundle(source.id, (await convertCorpus(location, { url: source.url })).bundle);
    alone.set(source.id, new Set(report.declared));
  }

  // Every source loaded once, Core first, so the Player's Handbook index finds its files already loaded.
  const all = await load(added);
  assert.equal(all.get(phbSource.id)!.fileCount, 0, 'Core loaded the book before its own index did');
  for (const source of added) {
    const record = await readDeclared(storage, source);
    assert.deepEqual(new Set(record?.ids), alone.get(source.id), `${source.name}: the record is what it declares alone`);
    t.diagnostic(`record of ${source.name}: ${record!.ids.length} ids, ${(await storage.read(declaredKey(source.id)))!.length.toLocaleString('en')} characters`);
  }

  const check = async (label: string, enabled: ConfiguredSource[]): Promise<void> => {
    const started = performance.now();
    const loaded = await load(enabled);
    const ms = Math.round(performance.now() - started);
    for (const source of enabled) {
      const line = loaded.get(source.id)!;
      const missing = line.missing ?? { references: [], additions: [] };
      const wanted = [...missing.references, ...new Set(missing.additions)];
      const things = new Set(wanted).size;
      const under = new Map((line.switchedOff ?? []).map((supply) => [supply.sourceId, [...supply.references, ...supply.additions]]));
      for (const other of added.filter((o) => !enabled.includes(o))) {
        const declared = alone.get(other.id)!;
        assert.deepEqual(
          under.get(other.id) ?? [],
          wanted.filter((id) => declared.has(id)),
          `${label}, ${source.name}: named under ${other.name} exactly what it declares of what is missing`,
        );
      }
      const covered = new Set([...under.values()].flat());
      t.diagnostic(
        `${label}: ${source.name} misses ${missing.references.length} things and ${new Set(missing.additions).size} addition targets; ` +
          [...under].map(([id, ids]) => `${nameOf(id)} has ${new Set(ids).size}`).join(', ') +
          ` of the ${things} ids; ${new Set(wanted.filter((id) => !covered.has(id))).size} in no switched-off source (${ms} ms)`,
      );
    }
  };

  await check('the 2014 Player\'s Handbook alone', [phbSource]);
  await check('Tasha\'s alone', [tashasSource]);
  await check('the Player\'s Handbook and Tasha\'s', [phbSource, tashasSource]);
  await check('the supplements group alone', [supplementsSource]);
  await check('Core alone', [coreSource]);
});
