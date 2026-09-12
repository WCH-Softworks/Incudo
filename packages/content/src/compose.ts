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
import { HttpContentSource, cacheKey } from './http-source.ts';
import { LayeredContentSource } from './layered-source.ts';
import type { ConfiguredSource } from './profile.ts';
import { compareVersions, type ContentSource, type UpdateStatus } from './source.ts';

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
  const http = new HttpContentSource({
    id: source.id,
    fetcher: options.fetcher,
    writeThrough: options.storage,
    resolveByName: options.resolveByName,
  });
  const cached = new CachedContentSource(source.id, options.storage);
  return new LayeredContentSource(source.id, [cached, http], http);
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
 * Ask the network what version the index is at now, and compare it with the stamp.
 *
 * **This never writes.** Not the cache, not the stamp, not the profile. Reporting is the whole
 * job, and a check that quietly refreshed would be the silent update ADR 0012 spends a section
 * refusing.
 */
export async function checkSourceForUpdates(
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
      ? { state: 'outdated', local: stamped, remote: remote.version }
      : { state: 'current', version: remote.version };
  } catch (error) {
    return { state: 'unknown', reason: (error as Error).message };
  }
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
