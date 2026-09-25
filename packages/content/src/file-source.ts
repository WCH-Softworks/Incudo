/**
 * One Aurora elements file the user added, kept as a copy in the app's own storage — ADR 0056.
 *
 * Homebrew for Aurora is mostly single files passed around by hand, never published behind an index. Such a file is a
 * source of its own: a line in the profile like any other, loaded through the same library, and addressed as
 * `local:<file name>`. Its text lives under `sources/files/`, outside the `content/` cache prefix, because it is the
 * only copy the app has and nothing that evicts or prunes a cache may reach it.
 */

import { parseAuroraElements, parseAuroraIndex } from '@incudo/aurora-import';
import type { Storage } from '@incudo/core';
import type { ConfiguredSource, SourceProfile } from './profile.ts';
import type { ContentIndex, ContentSource, ElementFile, FileRef, UpdateStatus } from './source.ts';

const SCHEME = 'local:';

/** A file source's id and URL: its file name, so adding the same file again replaces the copy (ADR 0056). */
export function fileSourceUrl(fileName: string): string {
  return `${SCHEME}${fileName}`;
}

/** Where a file source's text is kept. */
export function fileSourceKey(sourceId: string): string {
  return `sources/files/${encodeURIComponent(sourceId)}`;
}

/** The file name a file source was added under, for showing it. */
export function fileSourceName(source: Pick<ConfiguredSource, 'url'>): string {
  return source.url.startsWith(SCHEME) ? source.url.slice(SCHEME.length) : source.url;
}

export function isFileSource(source: Pick<ConfiguredSource, 'kind'>): boolean {
  return source.kind === 'file';
}

/** Said when a file source is asked something only a source at an address can answer. */
export const FILE_SOURCE_HAS_NO_UPSTREAM =
  'This is a file you added, so there is nowhere to check for a newer version. Add the newer file to replace it.';

/**
 * A file source as a `ContentSource`: an index of one file, the file itself, and no update check. The copy is read from
 * storage and parsed once per instance, since the library asks for the index and then the file.
 */
export class FileContentSource implements ContentSource {
  readonly id: string;
  private readonly storage: Storage;
  private parsed: Promise<ReturnType<typeof parseAuroraElements>> | undefined;

  constructor(id: string, storage: Storage) {
    this.id = id;
    this.storage = storage;
  }

  private parse(url: string): Promise<ReturnType<typeof parseAuroraElements>> {
    this.parsed ??= this.storage.read(fileSourceKey(this.id)).then((text) => {
      if (text === null) throw new Error("Incudo's copy of this file is gone. Add the file again.");
      return parseAuroraElements(text, { sourceId: this.id, fileUrl: url });
    });
    return this.parsed;
  }

  async loadIndex(url: string): Promise<ContentIndex> {
    const parsed = await this.parse(url);
    const name = fileSourceName({ url });
    return {
      url,
      name: parsed.name || name.replace(/\.xml$/i, ''),
      version: parsed.version,
      files: [{ name, url, isIndex: false }],
      format: 'aurora',
    };
  }

  async loadFile(ref: FileRef): Promise<ElementFile> {
    const parsed = await this.parse(ref.url);
    return {
      url: parsed.url,
      name: parsed.name,
      version: parsed.version,
      elements: parsed.elements,
      appends: parsed.appends,
      diagnostics: parsed.diagnostics,
    };
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    return { state: 'unknown', reason: FILE_SOURCE_HAS_NO_UPSTREAM };
  }
}

export interface AddedFile {
  source: ConfiguredSource;
  /** A file of the same name was already a source, and its copy was replaced. */
  replaced: boolean;
  /** Elements the file declares, and additions to elements declared elsewhere. */
  elements: number;
  additions: number;
}

export interface AddFileOptions {
  /** The system it is added under — ADR 0031. */
  systemId: string;
  /** A system's name for its id, for the sentence that refuses a name another system holds. */
  nameOfSystem?: (id: string) => string;
}

/**
 * Add one file as a source, or replace the copy of the file source that has its name (ADR 0056), and write its text to
 * storage. The caller saves the profile and reloads.
 *
 * Refused, with a sentence for the user, when the file is not an Aurora elements file: an index names files at URLs, so
 * a copy of one alone loads nothing, and anything else holds no element to add. Nothing is written when it is refused.
 */
export async function addFileSource(
  profile: SourceProfile,
  storage: Storage,
  file: { name: string; text: string },
  options: AddFileOptions,
): Promise<AddedFile> {
  if (!/\.xml$/i.test(file.name)) {
    throw new Error(`${file.name} is not an .xml file. Only an Aurora elements file can be added this way.`);
  }
  const url = fileSourceUrl(file.name);
  const parsed = parseAuroraElements(file.text, { sourceId: url, fileUrl: url });
  if (!parsed.elements.length && !parsed.appends.length) {
    if (parseAuroraIndex(file.text, url).files.length) {
      throw new Error(`${file.name} is an index: it lists files at their addresses. Add it by its address instead.`);
    }
    throw new Error(`${file.name} holds no Aurora elements.`);
  }

  const existing = profile.find(url);
  if (existing?.systemId !== undefined && existing.systemId !== options.systemId) {
    const other = options.nameOfSystem?.(existing.systemId) ?? 'another system';
    throw new Error(
      `A file named ${file.name} is already added under ${other}, and a source can only belong to one system at a time.`,
    );
  }

  await storage.write(fileSourceKey(url), file.text);
  const source = existing
    ? profile.update(url, { version: parsed.version, kind: 'file', systemId: options.systemId })!
    : profile.add(url, {
        kind: 'file',
        name: parsed.name || file.name.replace(/\.xml$/i, ''),
        systemId: options.systemId,
        version: parsed.version,
        mode: 'download',
      });
  return { source, replaced: !!existing, elements: parsed.elements.length, additions: parsed.appends.length };
}

/** Remove a source from the profile, and a file source's copy with it (ADR 0056). The caller saves the profile. */
export async function removeSource(profile: SourceProfile, storage: Storage, id: string): Promise<boolean> {
  const source = profile.find(id);
  if (!source) return false;
  if (isFileSource(source)) await storage.remove(fileSourceKey(id));
  return profile.remove(id);
}
