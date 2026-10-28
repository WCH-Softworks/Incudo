/**
 * A configured source's content: the file it is kept as, converted when it must be — ADR 0119.
 *
 * A source at an address is converted into Incudo's content format once, when it is first loaded, refreshed, or the
 * converter that wrote it is not the one the app has, and kept as a file in the app's `sources` folder (decision 11).
 * Nothing in another format is kept (decision 10): a conversion reads the network for everything, and the file is all
 * that loads afterwards. A file the user added was converted when it was added and cannot be converted again, so its
 * file is kept whatever converter wrote it. A homebrew source's body is already Incudo content (ADR 0108).
 *
 * What builds before 1.0 kept under `content/<source>/` (the raw files of ADR 0029, the conversion of ADR 0085, their
 * ETags and version stamps) is removed once a source's file is written.
 */

import { applyChanges, checkContentBundle, StorageSourceFiles, type ContentBundle, type ContentPart, type Element, type Fetcher, type SourceFiles, type Storage } from '@incudo/core';

import { FILE_SOURCE_HAS_NO_UPSTREAM, fileSourceKey, fileSourceName, isFileSource } from './file-source.ts';
import { HOMEBREW_HAS_NO_UPSTREAM, homebrewFileUrl, isHomebrewSource, readHomebrew } from './homebrew-source.ts';
import type { ConfiguredSource } from './profile.ts';
import { compareVersions, type ConversionReport, type SourceConverter, type UpdateStatus } from './source.ts';

/** As many requests in flight as a conversion makes (ADR 0029): polite to a host doing this for free. */
const CHECK_CONCURRENCY = 6;

export interface ComposeOptions {
  fetcher: Fetcher;
  storage: Storage;
  /** Where converted sources are kept as files. Absent, they are kept in `storage`. */
  files?: SourceFiles;
  /** Converts a source in another format. Needed to add or refresh one, never to load one already converted. */
  converter?: SourceConverter;
  /** Read an Aurora download folder rather than a repository. See docs/AURORA-FORMAT.md. */
  resolveByName?: boolean;
  /** When a conversion is made, written in it. Absent, nothing is. */
  now?: () => string;
}

/** What a source's conversion is kept under before 1.0: everything under it is removed once its file is written. */
export function cachePrefix(sourceId: string): string {
  return `content/${encodeURIComponent(sourceId)}/`;
}

function filesOf(options: ComposeOptions): SourceFiles {
  return options.files ?? new StorageSourceFiles(options.storage);
}

/** A short, stable hash of a text, for a file name two sources cannot share. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The name of the file a source is kept as: its address's last part, readable, and a hash of its id, so two sources
 * whose addresses end alike keep two files. Stable for the life of the source: never its display name, which may change.
 */
export function sourceFileName(source: Pick<ConfiguredSource, 'id' | 'url'>): string {
  const last = source.url.split(/[/\\:]/).filter(Boolean).pop() ?? 'source';
  const stem =
    last
      .replace(/\.[a-z0-9]+$/i, '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'source';
  return `${stem}-${shortHash(source.id)}.json`;
}

/** Why a source's file could not be read. */
export class UnreadableSourceError extends Error {}

/** A source's kept file, checked; `undefined` when there is none. Throws, with a sentence, when one is there and does not read. */
export async function readSourceFile(source: Pick<ConfiguredSource, 'id' | 'url'>, options: ComposeOptions): Promise<ContentBundle | undefined> {
  const text = await filesOf(options).read(sourceFileName(source));
  if (text === null) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new UnreadableSourceError(`Incudo's file of this source is not valid JSON: ${(error as Error).message}`);
  }
  const { value, problems } = checkContentBundle(raw);
  if (!value) throw new UnreadableSourceError(`Incudo's file of this source cannot be read. ${problems.join(' ')}`);
  return value;
}

/** Write a source's file, and remove what a build before 1.0 kept for it. */
export async function writeSourceFile(source: Pick<ConfiguredSource, 'id' | 'url'>, bundle: ContentBundle, options: ComposeOptions): Promise<void> {
  await filesOf(options).write(sourceFileName(source), `${JSON.stringify(bundle)}\n`);
  const old = await options.storage.list(cachePrefix(source.id));
  if (old.length) await applyChanges(options.storage, old.map((key) => [key, null] as const));
}

/** Remove a source's file, and anything a build before 1.0 kept for it. */
export async function removeSourceFile(source: Pick<ConfiguredSource, 'id' | 'url'>, options: Pick<ComposeOptions, 'storage' | 'files'>): Promise<void> {
  await (options.files ?? new StorageSourceFiles(options.storage)).remove(sourceFileName(source));
  await evictSourceCache(options.storage, source.id);
}

/** Show a source's file in the platform's file manager, where it can. */
export async function revealSourceFile(source: Pick<ConfiguredSource, 'id' | 'url'>, options: Pick<ComposeOptions, 'storage' | 'files'>): Promise<boolean> {
  const files: SourceFiles = options.files ?? new StorageSourceFiles(options.storage);
  if (!files.reveal) return false;
  await files.reveal(sourceFileName(source));
  return true;
}

/** Whether a conversion was written by the converter the app has. One with no record of a converter is Incudo's own. */
function current(bundle: ContentBundle, converter: SourceConverter | undefined): boolean {
  const converted = bundle.source?.converted;
  if (!converted || !converter) return true;
  return converted.from !== converter.format || converted.converter === converter.version;
}

function needConverter(options: ComposeOptions): SourceConverter {
  if (!options.converter) throw new Error('This source has not been converted yet, and nothing here can convert it.');
  return options.converter;
}

/** Convert a source at an address and keep the result, falling back per file to `previous`. */
async function convert(
  source: ConfiguredSource,
  options: ComposeOptions,
  previous: ContentBundle | undefined,
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<{ bundle: ContentBundle; report: ConversionReport }> {
  const converted = await needConverter(options).convertSource({
    fetcher: options.fetcher,
    url: source.url,
    sourceId: source.id,
    resolveByName: options.resolveByName,
    previous,
    onProgress,
    at: options.now?.(),
  });
  await writeSourceFile(source, converted.bundle, options);
  return converted;
}

/**
 * A source's content: a homebrew body, or the file it is kept as, converted first when there is none or another
 * converter wrote it. Throws, with a sentence, when it can be neither read nor converted.
 */
export async function sourceContent(
  source: ConfiguredSource,
  options: ComposeOptions,
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<ContentBundle> {
  if (isHomebrewSource(source)) {
    const read = await readHomebrew(options.storage, source.id);
    if (read.status === 'unreadable') throw new Error(read.reason);
    const fileUrl = homebrewFileUrl(source.url);
    return {
      formatVersion: 1,
      elements: read.bundle.elements.map((element) => ({ ...element, origin: { sourceId: source.id, fileUrl } }) as Element),
      source: { name: source.name, url: source.url, files: [{ url: fileUrl, name: source.name }] },
    };
  }
  const kept = await readSourceFile(source, options);
  if (isFileSource(source)) return kept ?? (await convertKeptFile(source, options));
  if (kept && current(kept, options.converter)) return kept;
  // A conversion another converter wrote is still Incudo content: kept, and loaded, if this one cannot be made.
  try {
    return (await convert(source, options, kept, onProgress)).bundle;
  } catch (error) {
    if (kept) return kept;
    throw error;
  }
}

/**
 * A file source a build before 1.0 added kept the file's text, not its conversion: converted now, once, and the text
 * removed. One with neither is gone.
 */
async function convertKeptFile(source: ConfiguredSource, options: ComposeOptions): Promise<ContentBundle> {
  const text = await options.storage.read(fileSourceKey(source.id));
  if (text === null || !options.converter) throw new Error("Incudo's copy of this file is gone. Add the file again.");
  const bundle = options.converter.convertFile(text, { url: source.url, name: fileSourceName(source), at: options.now?.() });
  await writeSourceFile(source, bundle, options);
  await options.storage.remove(fileSourceKey(source.id));
  return bundle;
}

/** A source's parts tree, for choosing which to switch off (ADR 0055): from its file, converting it first if need be. */
export async function sourceParts(source: ConfiguredSource, options: ComposeOptions): Promise<ContentPart> {
  const bundle = await sourceContent(source, options);
  return bundle.source?.parts ?? { name: source.name, title: source.name, url: source.url, isIndex: false };
}

/** What a refresh did — ADR 0050. */
export interface RefreshReport {
  /** Files that came over the network. */
  fetched: number;
  /** Files a conditional request said were current. */
  unchanged: number;
  /** Files the network could not supply, kept from the previous conversion. */
  kept: Array<{ url: string; reason: string }>;
  /** Files the previous conversion held that the source no longer names. */
  removed: number;
  filesLoaded: number;
  version?: string;
}

/**
 * Convert a source again from the network (ADR 0119 decision 10: no other copy is kept to refresh from). A file that
 * cannot be fetched keeps what the previous conversion held for it, and is reported; if the top index cannot be read,
 * this throws and the kept file is unchanged.
 */
export async function refreshSource(source: ConfiguredSource, options: ComposeOptions): Promise<RefreshReport> {
  if (isFileSource(source)) throw new Error(FILE_SOURCE_HAS_NO_UPSTREAM);
  if (isHomebrewSource(source)) throw new Error(HOMEBREW_HAS_NO_UPSTREAM);
  const previous = await readSourceFile(source, options).catch(() => undefined);
  const { bundle, report } = await convert(source, options, previous);
  const now = new Set((bundle.source?.files ?? []).map((file) => file.url));
  const removed = (previous?.source?.files ?? []).filter((file) => !file.generated && !now.has(file.url)).length;
  return {
    fetched: report.fetched,
    unchanged: report.unchanged,
    kept: report.kept,
    removed,
    filesLoaded: (bundle.source?.files ?? []).filter((file) => !file.generated).length,
    version: bundle.source?.version,
  };
}

/**
 * Ask whether a source changed upstream.
 *
 * Where the fetcher can make a conditional request and the conversion recorded ETags, every file it fetched is asked,
 * six at a time, and the answer says how many changed (ADR 0050). Anything else compares the top index's version with
 * the conversion's, which is all that can be done without ETags.
 *
 * **This never writes.** Reporting is the whole job, and a check that quietly refreshed would be the silent update
 * ADR 0012 refuses.
 */
export async function checkSourceForUpdates(source: ConfiguredSource, options: ComposeOptions): Promise<UpdateStatus> {
  if (isFileSource(source)) return { state: 'unknown', reason: FILE_SOURCE_HAS_NO_UPSTREAM };
  if (isHomebrewSource(source)) return { state: 'unknown', reason: HOMEBREW_HAS_NO_UPSTREAM };
  let kept: ContentBundle | undefined;
  try {
    kept = await readSourceFile(source, options);
  } catch (error) {
    return { state: 'unknown', reason: (error as Error).message };
  }
  const etags = kept?.source?.etags;
  if (options.fetcher.conditional && etags && Object.keys(etags).length) return checkEveryFile(etags, options.fetcher);
  const stamped = kept?.source?.version ?? source.version;
  try {
    const remote = await needConverter(options).latestVersion(options.fetcher, source.url, { resolveByName: options.resolveByName });
    if (!remote || !stamped) {
      return {
        state: 'unknown',
        reason: remote
          ? 'This source has not been converted yet, so there is no version to compare against.'
          : 'That index does not declare a version, so there is nothing to compare.',
      };
    }
    return compareVersions(stamped, remote) < 0
      ? { state: 'outdated', basis: 'version', local: stamped, remote }
      : { state: 'current', basis: 'version', version: remote };
  } catch (error) {
    return { state: 'unknown', reason: (error as Error).message };
  }
}

async function checkEveryFile(etags: Record<string, string>, fetcher: Fetcher): Promise<UpdateStatus> {
  const entries = Object.entries(etags);
  let checked = 0;
  let changed = 0;
  let unanswered = 0;
  let firstFailure: string | undefined;
  for (let start = 0; start < entries.length; start += CHECK_CONCURRENCY) {
    await Promise.all(
      entries.slice(start, start + CHECK_CONCURRENCY).map(async ([url, etag]) => {
        try {
          const result = await fetcher.fetchText(url, { etag });
          checked++;
          if (!result.notModified) changed++;
        } catch (error) {
          unanswered++;
          firstFailure ??= `${url}: ${(error as Error).message}`;
        }
      }),
    );
  }
  if (!checked) {
    return { state: 'unknown', reason: `No file could be reached (${unanswered} tried): ${firstFailure ?? 'no answer'}` };
  }
  return changed
    ? { state: 'outdated', basis: 'files', checked, changed, unanswered }
    : { state: 'current', basis: 'files', checked, unanswered };
}

/** Remove what a build before 1.0 kept for a source under `content/<source>/`. Returns how many keys went. */
export async function evictSourceCache(storage: Storage, sourceId: string): Promise<number> {
  const keys = await storage.list(cachePrefix(sourceId));
  if (keys.length) await applyChanges(storage, keys.map((key) => [key, null] as const));
  return keys.length;
}
