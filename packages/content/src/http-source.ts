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
}

export class HttpContentSource implements ContentSource {
  readonly id: string;
  private readonly fetcher: Fetcher;
  private readonly writeThrough: Storage | undefined;
  private readonly resolveByName: boolean;

  constructor(options: HttpContentSourceOptions) {
    this.id = options.id;
    this.fetcher = options.fetcher;
    this.writeThrough = options.writeThrough;
    this.resolveByName = options.resolveByName ?? false;
  }

  async loadIndex(url: string): Promise<ContentIndex> {
    const result = await this.fetcher.fetchText(url);
    await this.writeThrough?.write(cacheKey(this.id, url), result.text);
    const parsed = parseAuroraIndex(result.text, url, { resolveByName: this.resolveByName });
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
    const result = await this.fetcher.fetchText(ref.url);
    await this.writeThrough?.write(cacheKey(this.id, ref.url), result.text);
    const parsed = parseAuroraElements(result.text, { sourceId: this.id, fileUrl: ref.url });
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
