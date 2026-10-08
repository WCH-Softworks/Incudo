/**
 * An Aurora source converted into Incudo's own form, and loaded from that afterwards — ADR 0085.
 *
 * The cache ADR 0029 built keeps each file's XML as it came, so every load parses all of it again: about five seconds
 * in the desktop window and fifteen on a phone for AuroraLegacy. Converted, each index and file a load read is kept as
 * what `parseAuroraIndex` and `parseAuroraElements` returned, as JSON, the file with its `<append>`s and diagnostics.
 * Not a flat list of elements: `ContentLibrary` folds appends across sources and reports overlaps and missing content
 * per file, so a converted source hands it the same files a raw one does, and a load from either is the same load
 * (`converted-source.test.ts` here and in `tools/verify` hold it, element for element and diagnostic for diagnostic).
 *
 * **One value per file, not one per source.** The first version kept a source as one value of about 21 MB; on the phone
 * `expo-sqlite` took 20 s to read it back, where 800 values of the same size together take about two (ADR 0083's
 * measurement). Per file, a load reads only what it asks for, and a load that fetched a few files writes only those.
 *
 * **What it is stable against.** The parsed form is exactly what a `.incu`'s `content.json` already embeds (ADR 0012),
 * so it is no newer a promise than every save makes: what changes meaning is read where it is evaluated, never where it
 * is parsed (ADR 0046). What it is *not* stable against is the importer's parsing changing what it produces (a
 * construct read that used to be dropped, ADR 0076): each value records `CONVERTER_VERSION`, one written by another is
 * not read, and that file is converted again from the network. A guard test fails when the parsing files change, to make
 * that bump a decision rather than a thing forgotten.
 *
 * **Where it is kept.** Under the source's cache prefix (`convertedPrefix`), so evicting the source's cache takes it
 * too, and each raw file is removed once converted: a source is kept one way or the other (`ConfiguredSource.keep`), the
 * user's choice of space against speed.
 */

import { applyChanges, type Storage } from '@incudo/core';

import { CacheMissError } from './cached-source.ts';
import { cacheKey } from './http-source.ts';
import type { ContentIndex, ContentSource, ElementFile, FileRef, UpdateStatus } from './source.ts';

/**
 * Which parsing wrote a conversion. Bump it when `@incudo/aurora-import`'s `parseAuroraIndex` or `parseAuroraElements`
 * comes to produce something different from the same XML; every value written before is then ignored and made again.
 * `tools/verify`'s `converted-source.test.ts` names the files whose change asks the question. 2 since an element
 * carries the `<extract>` block as `contents` (ADR 0098).
 */
export const CONVERTER_VERSION = 2;

/** One stored value: an index or a file as the parser returned it, and the converter that wrote it. */
interface ConvertedEntry {
  converter: number;
  index?: ContentIndex;
  file?: ElementFile;
}

/** Everything a source's conversion holds, assembled: for tests and reports, never for a load. */
export interface ConvertedSourceData {
  indexes: Record<string, ContentIndex>;
  files: Record<string, ElementFile>;
}

/** Where a source's conversion is kept: inside its cache prefix. */
export function convertedPrefix(sourceId: string): string {
  return `content/${encodeURIComponent(sourceId)}/.converted/`;
}

/** Where one converted index or file is kept. */
export function convertedKey(sourceId: string, url: string): string {
  return `${convertedPrefix(sourceId)}${encodeURIComponent(url)}`;
}

async function readEntry(storage: Storage, sourceId: string, url: string): Promise<ConvertedEntry | undefined> {
  const text = await storage.read(convertedKey(sourceId, url));
  if (text === null) return undefined;
  try {
    const entry = JSON.parse(text) as ConvertedEntry;
    return entry.converter === CONVERTER_VERSION ? entry : undefined;
  } catch {
    return undefined;
  }
}

/** Every value of a source's conversion this converter wrote, assembled; `undefined` when there is none. */
export async function readConverted(storage: Storage, sourceId: string): Promise<ConvertedSourceData | undefined> {
  const prefix = convertedPrefix(sourceId);
  const data: ConvertedSourceData = { indexes: {}, files: {} };
  let found = false;
  for (const key of await storage.list(prefix)) {
    const url = decodeURIComponent(key.slice(prefix.length));
    const entry = await readEntry(storage, sourceId, url);
    if (!entry) continue;
    found = true;
    if (entry.index) data.indexes[url] = entry.index;
    if (entry.file) data.files[url] = entry.file;
  }
  return found ? data : undefined;
}

/** Remove every value of a source's conversion. */
export async function removeConversion(storage: Storage, sourceId: string): Promise<void> {
  for (const key of await storage.list(convertedPrefix(sourceId))) await storage.remove(key);
}

/**
 * The conversion as a content source: each index and file it holds, read when asked for, and a miss for anything else,
 * so a layer behind it (the raw cache, the network) answers that. Every read parses the stored value afresh, so the
 * library gets objects of its own to fold appends into.
 */
export class ConvertedContentSource implements ContentSource {
  readonly id: string;
  private readonly storage: Storage;

  constructor(id: string, storage: Storage) {
    this.id = id;
    this.storage = storage;
  }

  async loadIndex(url: string): Promise<ContentIndex> {
    const index = (await readEntry(this.storage, this.id, url))?.index;
    if (!index) throw new CacheMissError(url);
    return index;
  }

  async loadFile(ref: FileRef): Promise<ElementFile> {
    const file = (await readEntry(this.storage, this.id, ref.url))?.file;
    if (!file) throw new CacheMissError(ref.url);
    return file;
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    return { state: 'unknown', reason: 'No network source configured for this content.' };
  }
}

/**
 * A source that answers from a conversion where it can and from `behind` (the raw cache, the network) where it cannot,
 * keeping a copy of every answer `behind` gave, to be written by `finish` once the load is done.
 *
 * Each copy is made as JSON the moment the answer is given, before `ContentLibrary` folds an append into it: a
 * conversion of folded elements would fold them twice on the next load. `converted` may be undefined, and then every
 * answer comes from `behind` and is kept (a refresh, which converts all it reads).
 */
export class ConvertingContentSource implements ContentSource {
  readonly id: string;
  private readonly storage: Storage;
  private readonly converted: ConvertedContentSource | undefined;
  private readonly behind: ContentSource;
  /** What `behind` answered, as the values `finish` writes. */
  private readonly kept = new Map<string, string>();

  constructor(storage: Storage, behind: ContentSource, converted: ConvertedContentSource | undefined) {
    this.id = behind.id;
    this.storage = storage;
    this.behind = behind;
    this.converted = converted;
  }

  async loadIndex(url: string): Promise<ContentIndex> {
    if (this.converted) {
      try {
        return await this.converted.loadIndex(url);
      } catch {
        // Not converted yet: asked of what is behind.
      }
    }
    const index = await this.behind.loadIndex(url);
    this.kept.set(url, JSON.stringify({ converter: CONVERTER_VERSION, index } satisfies ConvertedEntry));
    return index;
  }

  async loadFile(ref: FileRef): Promise<ElementFile> {
    if (this.converted) {
      try {
        return await this.converted.loadFile(ref);
      } catch {
        // Not converted yet: asked of what is behind.
      }
    }
    const file = await this.behind.loadFile(ref);
    this.kept.set(ref.url, JSON.stringify({ converter: CONVERTER_VERSION, file } satisfies ConvertedEntry));
    return file;
  }

  checkForUpdates(index: ContentIndex): Promise<UpdateStatus> {
    return this.behind.checkForUpdates(index);
  }

  /** The URLs whose conversion `finish` writes. */
  urls(): string[] {
    return [...this.kept.keys()];
  }

  /**
   * Write what was answered from behind the conversion as converted, and remove the raw copy each replaces. A load
   * answered wholly from the conversion writes nothing. ETags stay, which an update check still asks with.
   */
  async finish(): Promise<number> {
    const changes: [string, string | null][] = [];
    for (const [url, value] of this.kept) changes.push([convertedKey(this.id, url), value], [cacheKey(this.id, url), null]);
    await applyChanges(this.storage, changes);
    return this.kept.size;
  }
}
