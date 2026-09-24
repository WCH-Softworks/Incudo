/**
 * Reads content straight from a repo, on demand.
 *
 * This is the capability Aurora does not have: browse and use a source without
 * downloading it first, and lazily fetch only the files a character actually needs.
 */

import { parseAuroraIndex, parseAuroraElements } from '@incudo/aurora-import';
import type { Fetcher, Storage } from '@incudo/core';
import {
  compareVersions,
  detectFormat,
  type ContentIndex,
  type ContentSource,
  type ElementFile,
  type FileRef,
  type UpdateStatus,
} from './source.ts';

export interface HttpContentSourceOptions {
  id: string;
  fetcher: Fetcher;
  /**
   * When given, every fetched file is written through to this cache, so a streamed
   * source becomes usable offline after first use. This is deliberate: there is no
   * separate "offline mode" switch to forget to flip.
   */
  writeThrough?: Storage;
  /**
   * Read an existing Aurora download folder (its `custom/` directory) instead of a
   * repository. Lets Incudo work straight off a user's Aurora install, fully offline.
   */
  resolveByName?: boolean;
  /**
   * Ask for each file conditionally, with the ETag cached in `writeThrough` beside it, and answer a "not
   * modified" from the cached copy — ADR 0050. Only a refresh sets it, and only a `conditional` fetcher acts
   * on it; anything else fetches in full, as before.
   */
  revalidate?: boolean;
}

/** What a load through this source did: how many files came over the network, and how many were current. */
export interface FetchStats {
  fetched: number;
  unchanged: number;
}

export class HttpContentSource implements ContentSource {
  readonly id: string;
  readonly stats: FetchStats = { fetched: 0, unchanged: 0 };
  private readonly fetcher: Fetcher;
  private readonly writeThrough: Storage | undefined;
  private readonly resolveByName: boolean;
  private readonly revalidate: boolean;

  constructor(options: HttpContentSourceOptions) {
    this.id = options.id;
    this.fetcher = options.fetcher;
    this.writeThrough = options.writeThrough;
    this.resolveByName = options.resolveByName ?? false;
    this.revalidate = options.revalidate ?? false;
  }

  /**
   * One file's text, from the network or, when a conditional request says the cached copy is current, from
   * the cache. The text and its ETag are written through together, so they cannot describe different copies.
   */
  private async fetchText(url: string): Promise<string> {
    const cache = this.writeThrough;
    const conditional = !!this.fetcher.conditional;
    let cached: string | null = null;
    let etag: string | undefined;
    if (cache && conditional && this.revalidate) {
      etag = (await cache.read(etagKey(this.id, url))) ?? undefined;
      if (etag !== undefined) cached = await cache.read(cacheKey(this.id, url));
    }

    const result = await this.fetcher.fetchText(url, etag !== undefined && cached !== null ? { etag } : undefined);
    if (result.notModified) {
      if (cached === null) throw new Error(`${url} was reported unchanged, and there is no cached copy of it`);
      this.stats.unchanged++;
      return cached;
    }

    this.stats.fetched++;
    if (cache) {
      await cache.write(cacheKey(this.id, url), result.text);
      // A conditional fetcher that got no ETag this time must not leave the last one beside new text.
      if (result.etag !== undefined) await cache.write(etagKey(this.id, url), result.etag);
      else if (conditional) await cache.remove(etagKey(this.id, url));
    }
    return result.text;
  }

  async loadIndex(url: string): Promise<ContentIndex> {
    const text = await this.fetchText(url);
    const parsed = parseAuroraIndex(text, url, { resolveByName: this.resolveByName });
    return {
      url: parsed.url,
      name: parsed.name,
      description: parsed.description,
      author: parsed.author,
      version: parsed.version,
      files: parsed.files,
      format: detectFormat(url),
    };
  }

  async loadFile(ref: FileRef): Promise<ElementFile> {
    const text = await this.fetchText(ref.url);
    const parsed = parseAuroraElements(text, { sourceId: this.id, fileUrl: ref.url });
    return {
      url: parsed.url,
      name: parsed.name,
      version: parsed.version,
      elements: parsed.elements,
      appends: parsed.appends,
      diagnostics: parsed.diagnostics,
    };
  }

  async checkForUpdates(index: ContentIndex): Promise<UpdateStatus> {
    try {
      const remote = await this.loadIndex(index.url);
      const cmp = compareVersions(index.version, remote.version);
      return cmp < 0
        ? { state: 'outdated', local: index.version, remote: remote.version }
        : { state: 'current', version: remote.version };
    } catch (error) {
      return { state: 'unknown', reason: (error as Error).message };
    }
  }
}

export function cacheKey(sourceId: string, url: string): string {
  return `content/${encodeURIComponent(sourceId)}/${encodeURIComponent(url)}`;
}

/** Where a file's ETag is kept: inside the source's prefix, so evicting a source takes it too (ADR 0050). */
export function etagKey(sourceId: string, url: string): string {
  return `${etagPrefix(sourceId)}${encodeURIComponent(url)}`;
}

/** Every ETag a source has cached, one key per file. */
export function etagPrefix(sourceId: string): string {
  return `content/${encodeURIComponent(sourceId)}/.etag/`;
}
