/**
 * Adding Aurora elements files the user picked or dropped — ADR 0056.
 *
 * Bytes in, one file source each, and a line per file saying what happened. The rules for a file (what is refused, what
 * a second file of the same name does) are `addFileSource`'s in `packages/content`; this decodes the bytes and keeps one
 * file's refusal from stopping the rest.
 */

import { addFileSource, type AddFileOptions, type AddedFile, type ComposeOptions, type SourceProfile } from '@incudo/content';
import type { PickedFile } from '@incudo/core';

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
  platform: ComposeOptions,
  options: AddFileOptions,
): Promise<ContentFileResult[]> {
  const results: ContentFileResult[] = [];
  for (const file of files) {
    try {
      const text = decodeText(file.bytes);
      const name = contentFileName(file.name, text);
      const added = await addFileSource(profile, platform, { name, text }, options);
      results.push({ name, added });
    } catch (error) {
      results.push({ name: file.name, failed: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

/**
 * The name a picked file is added under. Its own, unless it has no extension: then it is not the file's name as the user
 * knows it but a provider's id ("msf:52" from Android's Downloads, found on the phone emulator), and a file whose root is
 * `elements` takes the name its own `<info>` gives, else "Added file", with ".xml". It was refused as "not an .xml file"
 * whatever it held. Anything else keeps its name, and is refused for it as before.
 */
export function contentFileName(name: string, text: string): string {
  if (/\.[^.\s]+$/.test(name.trim())) return name;
  // The declaration, comments and processing instructions skipped, as `isAuroraSave` does; what follows is the root.
  const rest = text.slice(0, 4096).replace(/^\s*(?:<\?[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*/i, '');
  if (!/^<elements[\s>/]/.test(rest)) return name;
  const own = /<info>[\s\S]*?<name>([^<]*)<\/name>/.exec(text.slice(0, 8192))?.[1];
  const clean = (own ?? '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  return `${clean || 'Added file'}.xml`;
}

/**
 * A file's bytes as text: UTF-8 unless a byte order mark says UTF-16, which some Windows editors write. The mark itself
 * is dropped either way.
 *
 * UTF-16 is read here by hand, not through `TextDecoder`: the phone's engine (Hermes) has a UTF-8 `TextDecoder` only,
 * and `new TextDecoder('utf-16le')` throws there (measured on the emulator, ADR 0083). Code units are joined as they
 * are, so a surrogate pair stays one character and a lone surrogate stays what the file wrote.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16(bytes, true);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes, false);
  return new TextDecoder('utf-8').decode(bytes);
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const units = Math.floor((bytes.length - 2) / 2);
  const chunks: string[] = [];
  // In slices, so a large file never passes more arguments to fromCharCode than an engine takes.
  for (let start = 0; start < units; start += 8192) {
    const end = Math.min(units, start + 8192);
    const codes = new Array<number>(end - start);
    for (let i = start; i < end; i++) {
      const at = 2 + i * 2;
      codes[i - start] = littleEndian ? bytes[at]! | (bytes[at + 1]! << 8) : (bytes[at]! << 8) | bytes[at + 1]!;
    }
    chunks.push(String.fromCharCode(...codes));
  }
  return chunks.join('');
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
