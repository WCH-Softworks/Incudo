/**
 * A local, versioned copy of a source. Fully offline.
 */

import { parseAuroraIndex, parseAuroraElements } from '@incudo/aurora-import';
import type { Storage } from '@incudo/core';
import { cacheKey } from './http-source.ts';
import {
  detectFormat,
  type ContentIndex,
  type ContentSource,
  type ElementFile,
  type FileRef,
  type UpdateStatus,
} from './source.ts';

export class CacheMissError extends Error {
  readonly url: string;
  constructor(url: string) {
    // The address is `url`, and whoever reports the miss names it; the message says what happened.
    super('Not in the local cache');
    this.name = 'CacheMissError';
    this.url = url;
  }
}

export class CachedContentSource implements ContentSource {
  readonly id: string;
  private readonly storage: Storage;

  constructor(id: string, storage: Storage) {
    this.id = id;
    this.storage = storage;
  }

  async loadIndex(url: string): Promise<ContentIndex> {
    const text = await this.storage.read(cacheKey(this.id, url));
    if (text === null) throw new CacheMissError(url);
    const parsed = parseAuroraIndex(text, url);
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
    const text = await this.storage.read(cacheKey(this.id, ref.url));
    if (text === null) throw new CacheMissError(ref.url);
    const parsed = parseAuroraElements(text, { sourceId: this.id, fileUrl: ref.url });
    return {
      url: parsed.url,
      name: parsed.name,
      version: parsed.version,
      elements: parsed.elements,
      // `appends` was missing here, and `HttpContentSource` has always returned it. Every
      // `<append>` in the corpus — 171 of them, the mechanism a supplement uses to extend a
      // core element — was therefore dropped on every load served from the cache, which is
      // every load after the first. It produced no error, no warning and the same element
      // count: what changed was *reachability*, so a character saved against a cached corpus
      // embedded fewer elements than the same character saved a minute earlier. Found by
      // importing one Aurora save twice in the running app and watching 250 become 227.
      appends: parsed.appends,
      diagnostics: parsed.diagnostics,
    };
  }

  /** A cache alone cannot know about updates; the layered source asks the network one. */
  async checkForUpdates(): Promise<UpdateStatus> {
    return { state: 'unknown', reason: 'No network source configured for this content.' };
  }

  async isCached(url: string): Promise<boolean> {
    return (await this.storage.read(cacheKey(this.id, url))) !== null;
  }
}
