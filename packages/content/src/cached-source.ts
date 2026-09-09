/**
 * A local, versioned copy of a source. Fully offline.
 */

import { parseAuroraIndex, parseAuroraElements } from '@heroforge/aurora-import';
import type { Storage } from '@heroforge/core';
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
    super(`Not in the local cache: ${url}`);
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
