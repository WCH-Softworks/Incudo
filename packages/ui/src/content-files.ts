/**
 * Adding Aurora elements files the user picked or dropped — ADR 0056.
 *
 * Bytes in, one file source each, and a line per file saying what happened. The rules for a file (what is refused, what
 * a second file of the same name does) are `addFileSource`'s in `packages/content`; this decodes the bytes and keeps one
 * file's refusal from stopping the rest.
 */

import { addFileSource, type AddFileOptions, type AddedFile, type SourceProfile } from '@incudo/content';
import type { PickedFile, Storage } from '@incudo/core';

export interface ContentFileResult {
  /** The file's own name. */
  name: string;
  added?: AddedFile;
  /** Why it was not added, written for the user. */
  failed?: string;
}

/**
 * Add each file as a source, in the order given. The caller saves the profile and reloads once afterwards, when any
 * file was added.
 */
export async function addContentFiles(
  files: readonly PickedFile[],
  profile: SourceProfile,
  storage: Storage,
  options: AddFileOptions,
): Promise<ContentFileResult[]> {
  const results: ContentFileResult[] = [];
  for (const file of files) {
    try {
      const added = await addFileSource(profile, storage, { name: file.name, text: decodeText(file.bytes) }, options);
      results.push({ name: file.name, added });
    } catch (error) {
      results.push({ name: file.name, failed: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

/**
 * A file's bytes as text: UTF-8 unless a byte order mark says UTF-16, which some Windows editors write. The mark itself
 * is dropped either way.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

/** One sentence for what adding some files did, for the Sources pane. */
export function describeContentFiles(results: readonly ContentFileResult[]): string {
  const added = results.filter((result) => result.added && !result.added.replaced).length;
  const replaced = results.filter((result) => result.added?.replaced).length;
  const failed = results.filter((result) => result.failed).length;
  const parts: string[] = [];
  if (added) parts.push(`${added} ${added === 1 ? 'file' : 'files'} added`);
  if (replaced) parts.push(`${replaced} replaced with the newer copy`);
  if (failed) parts.push(`${failed} not added`);
  return parts.length ? `${parts.join(', ')}.` : 'No file was chosen.';
}
