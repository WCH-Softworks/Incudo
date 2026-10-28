/**
 * One elements file the user added, converted into a source of its own — ADR 0056, and since ADR 0119 converted when it
 * is added and kept only as Incudo content.
 *
 * Homebrew for Aurora is mostly single files passed around by hand, never published behind an index. Such a file is a
 * source of its own: a line in the profile like any other, loaded through the same library, and addressed as
 * `local:<file name>`. The file itself is not kept (ADR 0119 decision 10): what is kept is its conversion, in the
 * `sources` folder like every other source's, so adding a newer copy is how it is updated.
 */

import type { Storage } from '@incudo/core';

import { removeSourceFile, writeSourceFile, type ComposeOptions } from './compose.ts';
import { removeDeclared } from './declared.ts';
import { homebrewKey, isHomebrewSource } from './homebrew-source.ts';
import type { ConfiguredSource, SourceProfile } from './profile.ts';

const SCHEME = 'local:';

/** A file source's id and URL: its file name, so adding the same file again replaces the copy (ADR 0056). */
export function fileSourceUrl(fileName: string): string {
  return `${SCHEME}${fileName}`;
}

/** Where a build before 1.0 kept a file source's text. Removed with the source. */
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
 * Add one file as a source, or replace the one that has its name (ADR 0056): converted, and the conversion kept. The
 * caller saves the profile and reloads.
 *
 * Refused, with a sentence for the user, when it is not an elements file the converter can read. Nothing is written
 * when it is refused.
 */
export async function addFileSource(
  profile: SourceProfile,
  platform: ComposeOptions,
  file: { name: string; text: string },
  options: AddFileOptions,
): Promise<AddedFile> {
  if (!/\.xml$/i.test(file.name)) {
    throw new Error(`${file.name} is not an .xml file. Only an Aurora elements file can be added this way.`);
  }
  if (!platform.converter) throw new Error('Nothing here can convert this file.');
  const url = fileSourceUrl(file.name);
  const existing = profile.find(url);
  if (existing?.systemId !== undefined && existing.systemId !== options.systemId) {
    const other = options.nameOfSystem?.(existing.systemId) ?? 'another system';
    throw new Error(
      `A file named ${file.name} is already added under ${other}, and a source can only belong to one system at a time.`,
    );
  }
  const bundle = platform.converter.convertFile(file.text, { url, name: file.name, at: platform.now?.() });

  await writeSourceFile({ id: url, url }, bundle, platform);
  await platform.storage.remove(fileSourceKey(url));
  const version = bundle.source?.version;
  const source = existing
    ? profile.update(url, { version, kind: 'file', systemId: options.systemId })!
    : profile.add(url, {
        kind: 'file',
        name: bundle.source?.name ?? file.name.replace(/\.xml$/i, ''),
        systemId: options.systemId,
        version,
        mode: 'download',
      });
  const declared = bundle.elements.filter((element) => element.origin?.fileUrl === url).length;
  return { source, replaced: !!existing, elements: declared, additions: bundle.extensions?.length ?? 0 };
}

/** Remove a source from the profile, and what is kept for it with it (ADR 0056). The caller saves the profile. */
export async function removeSource(
  profile: SourceProfile,
  platform: Pick<ComposeOptions, 'storage' | 'files'>,
  id: string,
): Promise<boolean> {
  const source = profile.find(id);
  if (!source) return false;
  const storage: Storage = platform.storage;
  if (isFileSource(source)) await storage.remove(fileSourceKey(id));
  if (isHomebrewSource(source)) await storage.remove(homebrewKey(id));
  else await removeSourceFile(source, platform);
  await removeDeclared(storage, id);
  return profile.remove(id);
}
