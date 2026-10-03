/**
 * An Aurora source converted into Incudo's own form, and loaded from that afterwards — ADR 0085.
 *
 * The cache ADR 0029 built keeps each file's XML as it came, so every load parses all of it again: about five seconds
 * in the desktop window and fifteen on a phone for AuroraLegacy. Converted, a source is the parsed result of every index
 * and file the load read, as JSON: what `parseAuroraIndex` and `parseAuroraElements` returned, file by file, with each
 * file's `<append>`s and diagnostics. Not a flat list of elements: `ContentLibrary` folds appends across sources and
 * reports overlaps and missing content per file, so a converted source must hand it the same files a raw one does, and
 * a load from either is the same load (`converted-source.test.ts` and `tools/verify`'s `converted-source.test.ts` hold
 * it, element for element and diagnostic for diagnostic).
 *
 * **What it is stable against.** The parsed form is exactly what a `.incu`'s `content.json` already embeds (ADR 0012),
 * so it is no newer a promise than every save makes: what changes meaning is read where it is evaluated, never where it
 * is parsed (ADR 0046). What it is *not* stable against is the importer's parsing changing what it produces (a
 * construct read that used to be dropped, ADR 0076): `CONVERTER_VERSION` says which parser wrote a conversion, one
 * written by another is not read, and the next load converts again from the network. A guard test fails when the
 * parsing files change, to make that bump a decision rather than a thing forgotten.
 *
 * **Where it is kept.** One value under the source's cache prefix (`convertedKey`), so evicting the source's cache
 * takes it too, and the raw files are removed once converted: a source is kept one way or the other
 * (`ConfiguredSource.keep`), the user's choice of space against speed.
 */

import type { Storage } from '@incudo/core';

import { CacheMissError } from './cached-source.ts';
import { cacheKey } from './http-source.ts';
import type { ContentIndex, ContentSource, ElementFile, FileRef, UpdateStatus } from './source.ts';

/**
 * Which parsing wrote a conversion. Bump it when `@incudo/aurora-import`'s `parseAuroraIndex` or `parseAuroraElements`
 * comes to produce something different from the same XML; every conversion written before is then ignored and made
 * again. `tools/verify`'s `converted-source.test.ts` names the files whose change asks the question.
 */
export const CONVERTER_VERSION = 1;

/** What is stored: every index and file one load read, as the parser returned them. */
export interface ConvertedSourceData {
  formatVersion: 1;
  converter: number;
  sourceId: string;
  /** The top index the conversion was loaded from. */
  url: string;
  /** The top index's version when converted, as the cache's stamp records it. */
  version?: string;
  indexes: Record<string, ContentIndex>;
  files: Record<string, ElementFile>;
}

/** Where a source's conversion is kept: inside its cache prefix, beside the version stamp. */
export function convertedKey(sourceId: string): string {
  return `content/${encodeURIComponent(sourceId)}/.converted`;
}

/** A conversion, when one is stored for this source and its parser is this one. */
export async function readConverted(storage: Storage, sourceId: string): Promise<ConvertedSourceData | undefined> {
  const text = await storage.read(convertedKey(sourceId));
  if (text === null) return undefined;
  try {
    const data = JSON.parse(text) as ConvertedSourceData;
    if (data.formatVersion !== 1 || data.converter !== CONVERTER_VERSION || data.sourceId !== sourceId) return undefined;
    return data;
  } catch {
    return undefined;
  }
}

/**
 * The conversion as a content source: every index and file it holds, and a miss for anything else, so a layer behind it
 * (the raw cache, the network) answers that.
 *
 * Read from storage once per instance and on first use, so composing a source stays synchronous; a load makes a new
 * instance, and so gets new objects (`ContentLibrary` adds to the elements it is handed when it folds appends).
 */
export class ConvertedContentSource implements ContentSource {
  readonly id: string;
  private readonly storage: Storage;
  private data: Promise<ConvertedSourceData | undefined> | undefined;

  constructor(id: string, storage: Storage) {
    this.id = id;
    this.storage = storage;
  }

  private read(): Promise<ConvertedSourceData | undefined> {
    this.data ??= readConverted(this.storage, this.id);
    return this.data;
  }

  async loadIndex(url: string): Promise<ContentIndex> {
    const index = (await this.read())?.indexes[url];
    if (!index) throw new CacheMissError(url);
    return index;
  }

  async loadFile(ref: FileRef): Promise<ElementFile> {
    const file = (await this.read())?.files[ref.url];
    if (!file) throw new CacheMissError(ref.url);
    return file;
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    return { state: 'unknown', reason: 'No network source configured for this content.' };
  }
}

/**
 * A source that keeps a copy of everything it answers, to be written as a conversion once the load is done.
 *
 * Each answer is copied as JSON the moment it is given, before `ContentLibrary` folds an append into it: a conversion
 * of folded elements would fold them twice on the next load. `fresh` says whether anything came from somewhere other
 * than `converted`, which is when the stored conversion is out of date (a part switched back on, a converter bump, the
 * first load).
 */
export class RecordingContentSource implements ContentSource {
  readonly id: string;
  private readonly inner: ContentSource;
  private readonly converted: ConvertedContentSource;
  private readonly indexes: Record<string, string> = {};
  private readonly files: Record<string, string> = {};
  /** Answers that did not come from the stored conversion. */
  fresh = 0;

  constructor(inner: ContentSource, converted: ConvertedContentSource) {
    this.id = inner.id;
    this.inner = inner;
    this.converted = converted;
  }

  async loadIndex(url: string): Promise<ContentIndex> {
    const index = await this.inner.loadIndex(url);
    this.indexes[url] = JSON.stringify(index);
    if (!(await this.fromConversion(() => this.converted.loadIndex(url)))) this.fresh++;
    return index;
  }

  async loadFile(ref: FileRef): Promise<ElementFile> {
    const file = await this.inner.loadFile(ref);
    this.files[ref.url] = JSON.stringify(file);
    if (!(await this.fromConversion(() => this.converted.loadFile(ref)))) this.fresh++;
    return file;
  }

  checkForUpdates(index: ContentIndex): Promise<UpdateStatus> {
    return this.inner.checkForUpdates(index);
  }

  /** Whether the stored conversion holds this (it answered first, so it is what was used). */
  private async fromConversion(read: () => Promise<unknown>): Promise<boolean> {
    try {
      await read();
      return true;
    } catch {
      return false;
    }
  }

  /** Everything recorded, as a conversion of the source whose top index is `url`. */
  data(url: string, version: string | undefined): ConvertedSourceData {
    const parse = <T>(record: Record<string, string>): Record<string, T> =>
      Object.fromEntries(Object.entries(record).map(([key, text]) => [key, JSON.parse(text) as T]));
    return {
      formatVersion: 1,
      converter: CONVERTER_VERSION,
      sourceId: this.id,
      url,
      ...(version !== undefined ? { version } : {}),
      indexes: parse<ContentIndex>(this.indexes),
      files: parse<ElementFile>(this.files),
    };
  }

  /** Every URL recorded. */
  urls(): string[] {
    return [...Object.keys(this.indexes), ...Object.keys(this.files)];
  }
}

/**
 * Write a load's conversion and remove the raw copies it replaces. Only when something came from elsewhere: a load
 * answered wholly from the conversion leaves storage as it was. Raw files the load did not read are left alone (a part
 * switched off keeps whatever was cached of it until a refresh prunes it, as before), and so are ETags, which an update
 * check still asks with.
 */
export async function writeConversion(
  storage: Storage,
  recorder: RecordingContentSource,
  url: string,
  version: string | undefined,
): Promise<boolean> {
  if (!recorder.fresh) return false;
  await storage.write(convertedKey(recorder.id), JSON.stringify(recorder.data(url, version)));
  for (const recorded of recorder.urls()) await storage.remove(cacheKey(recorder.id, recorded));
  return true;
}
