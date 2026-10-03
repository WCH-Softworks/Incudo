/**
 * Composing the layers ADR 0004 designed and nothing had ever built — ADR 0029.
 *
 * `CachedContentSource` and `LayeredContentSource` have both existed since Phase 0 and the app
 * used neither: it built a bare `HttpContentSource` with `writeThrough`, which writes a cache
 * that nothing reads back. Reloading re-fetched all 238 files, about three quarters of a
 * minute, every time. This is the three lines that were missing.
 *
 * The cache key is per source and per URL (`cacheKey`, unchanged), and the version is a stamp
 * *beside* it rather than part of it. ADR 0029 says why: a version in the key makes every
 * update a copy, with nothing responsible for reaping the generation it replaced.
 */

import type { Fetcher, Storage } from '@incudo/core';
import { CachedContentSource } from './cached-source.ts';
import { FILE_SOURCE_HAS_NO_UPSTREAM, FileContentSource, isFileSource } from './file-source.ts';
import { HttpContentSource, cacheKey, etagKey, etagPrefix } from './http-source.ts';
import { LayeredContentSource } from './layered-source.ts';
import { ContentLibrary } from './library.ts';
import { partsFilter } from './parts.ts';
import { keepsConverted, type ConfiguredSource } from './profile.ts';
import { ConvertedContentSource, ConvertingContentSource, convertedKey, convertedPrefix, removeConversion } from './converted-source.ts';
import { compareVersions, type ContentSource, type FileRef, type UpdateStatus } from './source.ts';

/** As many requests in flight as a load makes (ADR 0029): polite to a host doing this for free. */
const CHECK_CONCURRENCY = 6;

export interface ComposeOptions {
  fetcher: Fetcher;
  storage: Storage;
  /** Read an Aurora download folder rather than a repository. See docs/AURORA-FORMAT.md. */
  resolveByName?: boolean;
}

/** Everything under a source's cache. One prefix, so eviction can be per source. */
export function cachePrefix(sourceId: string): string {
  return `content/${encodeURIComponent(sourceId)}/`;
}

/** The last-seen index version, stored beside the cache rather than inside its keys. */
export function versionStampKey(sourceId: string): string {
  return `${cachePrefix(sourceId)}.version`;
}

/**
 * cache → network, with the network layer named so update checks have something to ask.
 *
 * The HTTP layer keeps its `writeThrough`, which is what makes a streamed source usable
 * offline after first use — ADR 0004's "there is no separate offline mode switch to forget to
 * flip".
 */
export function composeSource(source: ConfiguredSource, options: ComposeOptions): ContentSource {
  return composeForLoad(source, options).source;
}

/**
 * The source a load reads, and what to do once the load is done — ADR 0085.
 *
 * A source kept converted answers from its conversion first (`ConvertingContentSource`), and the raw cache and the
 * network answer only what is not converted yet; `finish` converts that. A source kept as files is ADR 0029's
 * cache → network, and `finish` removes any conversion left from when it was kept converted, so switching back is
 * honoured on the next load.
 */
export function composeForLoad(
  source: ConfiguredSource,
  options: ComposeOptions,
): { source: ContentSource; finish: () => Promise<void> } {
  // A file the user added is its own copy, read from storage and never from a network (ADR 0056).
  if (isFileSource(source)) return { source: new FileContentSource(source.id, options.storage), finish: async () => undefined };
  const http = new HttpContentSource({
    id: source.id,
    fetcher: options.fetcher,
    writeThrough: options.storage,
    resolveByName: options.resolveByName,
  });
  const behind = new LayeredContentSource(source.id, [new CachedContentSource(source.id, options.storage), http], http);
  if (!keepsConverted(source)) {
    return { source: behind, finish: () => removeConversion(options.storage, source.id) };
  }
  const converting = new ConvertingContentSource(
    options.storage,
    behind,
    new ConvertedContentSource(source.id, options.storage),
  );
  return {
    source: converting,
    finish: async () => {
      await converting.finish();
    },
  };
}

/** The network layer on its own, for the things that must not be answered from the cache. */
export function networkSource(source: ConfiguredSource, options: ComposeOptions): ContentSource {
  return new HttpContentSource({
    id: source.id,
    fetcher: options.fetcher,
    // No write-through: an update check that filled the cache would be a silent refresh.
    resolveByName: options.resolveByName,
  });
}

export async function readVersionStamp(
  storage: Storage,
  sourceId: string,
): Promise<string | undefined> {
  return (await storage.read(versionStampKey(sourceId))) ?? undefined;
}

export async function writeVersionStamp(
  storage: Storage,
  sourceId: string,
  version: string | undefined,
): Promise<void> {
  if (version === undefined) {
    await storage.remove(versionStampKey(sourceId));
    return;
  }
  await storage.write(versionStampKey(sourceId), version);
}

/**
 * Ask whether a source changed upstream.
 *
 * Where the fetcher can make a conditional request and the source has ETags cached, every cached file is
 * asked, six at a time, and the answer says how many changed (ADR 0050). Anything else compares the top
 * index's version with the stamp, which is all that can be done without ETags, and which the AuroraLegacy
 * index has not moved since 2023.
 *
 * **This never writes.** Not the cache, not the ETags, not the stamp, not the profile. Reporting is the
 * whole job, and a check that quietly refreshed would be the silent update ADR 0012 spends a section
 * refusing.
 */
export async function checkSourceForUpdates(
  source: ConfiguredSource,
  options: ComposeOptions,
): Promise<UpdateStatus> {
  if (isFileSource(source)) return { state: 'unknown', reason: FILE_SOURCE_HAS_NO_UPSTREAM };
  if (options.fetcher.conditional) {
    const byFile = await checkEveryCachedFile(source, options);
    if (byFile) return byFile;
  }
  return checkIndexVersion(source, options);
}

async function checkEveryCachedFile(
  source: ConfiguredSource,
  options: ComposeOptions,
): Promise<UpdateStatus | undefined> {
  const prefix = etagPrefix(source.id);
  const keys = await options.storage.list(prefix);
  if (!keys.length) return undefined;

  let checked = 0;
  let changed = 0;
  let unanswered = 0;
  let firstFailure: string | undefined;
  await inBatches(keys, CHECK_CONCURRENCY, async (key) => {
    const etag = await options.storage.read(key);
    if (etag === null) return;
    const url = decodeURIComponent(key.slice(prefix.length));
    try {
      const result = await options.fetcher.fetchText(url, { etag });
      checked++;
      if (!result.notModified) changed++;
    } catch (error) {
      unanswered++;
      // A fetcher's message says what went wrong, not where, so the address is added here.
      firstFailure ??= `${url}: ${(error as Error).message}`;
    }
  });

  if (!checked) {
    return {
      state: 'unknown',
      reason: `No file could be reached (${unanswered} tried): ${firstFailure ?? 'no answer'}`,
    };
  }
  return changed
    ? { state: 'outdated', basis: 'files', checked, changed, unanswered }
    : { state: 'current', basis: 'files', checked, unanswered };
}

async function checkIndexVersion(
  source: ConfiguredSource,
  options: ComposeOptions,
): Promise<UpdateStatus> {
  const stamped = (await readVersionStamp(options.storage, source.id)) ?? source.version;
  try {
    const remote = await networkSource(source, options).loadIndex(source.url);
    if (!remote.version || !stamped) {
      return {
        state: 'unknown',
        reason: remote.version
          ? 'Nothing was cached for this source yet, so there is no version to compare against.'
          : 'That index does not declare a version, so there is nothing to compare.',
      };
    }
    return compareVersions(stamped, remote.version) < 0
      ? { state: 'outdated', basis: 'version', local: stamped, remote: remote.version }
      : { state: 'current', basis: 'version', version: remote.version };
  } catch (error) {
    return { state: 'unknown', reason: (error as Error).message };
  }
}

/** Run `work` over `items`, at most `size` at a time. */
async function inBatches<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map(work));
  }
}

/** A file a refresh could not fetch and served from the cache instead, and why. */
export interface KeptFile {
  url: string;
  reason: string;
}

/** What a refresh did — ADR 0050. */
export interface RefreshReport {
  /** Files that came over the network in full: new, or changed since they were cached. */
  fetched: number;
  /** Files a conditional request said were current, kept without downloading them. */
  unchanged: number;
  /** Files the network could not supply, kept from the cache. */
  kept: KeptFile[];
  /** Cached files the source no longer names, removed. */
  removed: number;
  filesLoaded: number;
  version?: string;
}

/**
 * Fetch a source again, network first, and keep what cannot be fetched — ADR 0050, amending ADR 0029's
 * "evict, then reload".
 *
 * Each file is asked of the network, conditionally where the fetcher can: a "not modified" keeps the cached
 * copy without downloading it, a new copy replaces it, and a failure falls back to the cached copy and is
 * reported. Afterwards every key under the source's prefix that the load did not touch is removed, which is a
 * file upstream stopped naming. If the top index cannot be read from either, this throws before removing
 * anything, so a refresh with no network leaves the cache exactly as it was.
 *
 * The caller reloads afterwards, from the cache this has just brought up to date.
 */
export async function refreshSource(source: ConfiguredSource, options: ComposeOptions): Promise<RefreshReport> {
  if (isFileSource(source)) throw new Error(FILE_SOURCE_HAS_NO_UPSTREAM);
  const http = new HttpContentSource({
    id: source.id,
    fetcher: options.fetcher,
    writeThrough: options.storage,
    resolveByName: options.resolveByName,
    revalidate: true,
  });
  // What a failure falls back to: the conversion, then the raw files (ADR 0085). A converted source has no raw files
  // for what it has converted, so without the first a refresh with one file unreachable would lose that file.
  const cached = new LayeredContentSource(source.id, [
    new ConvertedContentSource(source.id, options.storage),
    new CachedContentSource(source.id, options.storage),
  ]);
  const touched = new Set<string>();
  const kept: KeptFile[] = [];

  const networkFirst = async <T>(url: string, network: () => Promise<T>, cache: () => Promise<T>): Promise<T> => {
    try {
      const value = await network();
      touched.add(url);
      return value;
    } catch (error) {
      let value: T;
      try {
        value = await cache();
      } catch {
        throw error;
      }
      touched.add(url);
      kept.push({ url, reason: (error as Error).message });
      return value;
    }
  };

  const refreshing: ContentSource = {
    id: source.id,
    loadIndex: (url: string) => networkFirst(url, () => http.loadIndex(url), () => cached.loadIndex(url)),
    loadFile: (ref: FileRef) => networkFirst(ref.url, () => http.loadFile(ref), () => cached.loadFile(ref)),
    checkForUpdates: (index) => http.checkForUpdates(index),
  };

  // The parts the user switched off are not fetched, and the prune below removes them like a file upstream stopped naming
  // (ADR 0055): the refresh keeps what the load uses.
  // Kept, so a converted source is converted again from everything the refresh read (ADR 0085).
  const recorder = new ConvertingContentSource(options.storage, refreshing, undefined);
  const report = await new ContentLibrary().loadSource(recorder, source.url, { include: partsFilter(source) });

  const keep = new Set<string>([versionStampKey(source.id)]);
  if (keepsConverted(source)) for (const url of touched) keep.add(convertedKey(source.id, url));
  for (const url of touched) {
    keep.add(cacheKey(source.id, url));
    keep.add(etagKey(source.id, url));
  }
  let removed = 0;
  for (const key of await options.storage.list(cachePrefix(source.id))) {
    if (keep.has(key)) continue;
    await options.storage.remove(key);
    if (!key.startsWith(etagPrefix(source.id)) && !key.startsWith(convertedPrefix(source.id))) removed++;
  }

  await writeVersionStamp(options.storage, source.id, report.index.version);
  // Not when nothing was reached: a refresh with no network changes nothing, a converted source included.
  if (keepsConverted(source) && http.stats.fetched + http.stats.unchanged > 0) await recorder.finish();
  return {
    fetched: http.stats.fetched,
    unchanged: http.stats.unchanged,
    kept,
    removed,
    filesLoaded: report.filesLoaded,
    version: report.index.version,
  };
}

/**
 * Throw away one source's cached files, and nothing else's.
 *
 * Per source, explicit, and bounded — never a global flush, which would punish the nineteen
 * sources that did not change for the one that did. Returns how many keys went, so the UI can
 * say something true about what it did.
 */
export async function evictSourceCache(storage: Storage, sourceId: string): Promise<number> {
  const keys = await storage.list(cachePrefix(sourceId));
  for (const key of keys) await storage.remove(key);
  return keys.length;
}

/** For a caller that wants to know whether a particular file is already local. */
export function cacheKeyFor(sourceId: string, url: string): string {
  return cacheKey(sourceId, url);
}
