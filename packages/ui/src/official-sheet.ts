/**
 * "Fill the official sheet…": the user's own copy of a published form, kept, and filled from the sheet — ADR 0079
 * decision 3.
 *
 * Incudo never ships, downloads or sends the form. The step links to the page the publisher offers it on, for the user to
 * download in their own browser, and takes the copy they choose. The copy is kept in `Storage` beside a user's own source
 * files (ADR 0056's place for a user's file, not a cache), one per form, so it is chosen once; it is removable, and a
 * filled copy is a new file saved where the user says, the kept copy left as it is.
 *
 * This is the step's view-model and the copy's keeping: what the step says and offers, and the result line. Reading the
 * PDF is the shell's (it may use a PDF library; this package may not), and recognising it is `recogniseForm`.
 */

import type { Storage } from '@incudo/core';

import { suggestedFileName } from './character-library.ts';
import type { FormMap, FormValues } from './form-fill.ts';

/** A copy the user chose: its file name, for saying which, and its bytes. */
export interface KeptForm {
  name: string;
  bytes: Uint8Array;
}

/** Where a form's copy is kept: beside a user's own source files (`sources/files/`), never under a cache prefix. */
export function formCopyKey(mapId: string): string {
  return `forms/${encodeURIComponent(mapId)}`;
}

/** The kept copy, or `null` when none is kept or what is kept cannot be read. */
export async function readFormCopy(storage: Storage, mapId: string): Promise<KeptForm | null> {
  let text: string | null;
  try {
    text = await storage.read(formCopyKey(mapId));
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    const record = JSON.parse(text) as { name?: unknown; bytes?: unknown };
    if (typeof record.name !== 'string' || typeof record.bytes !== 'string') return null;
    return { name: record.name, bytes: fromBase64(record.bytes) };
  } catch {
    return null;
  }
}

/** Keep a copy the shell has recognised, replacing any kept before. */
export async function keepFormCopy(storage: Storage, mapId: string, copy: KeptForm): Promise<void> {
  await storage.write(formCopyKey(mapId), JSON.stringify({ name: copy.name, bytes: toBase64(copy.bytes) }));
}

export async function removeFormCopy(storage: Storage, mapId: string): Promise<void> {
  await storage.remove(formCopyKey(mapId));
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes as base64, `Storage` holding text. Written out rather than `btoa`, which wants a string of bytes built first. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? '=' : B64[c & 63]!;
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const ch of clean) {
    const index = B64.indexOf(ch);
    if (index < 0) throw new Error('not base64');
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (value >> bits) & 255;
    }
  }
  return out.subarray(0, at);
}

// --- the step ------------------------------------------------------------------------------------

export interface OfficialSheetView {
  heading: string;
  lede: string[];
  /** The page to download the form from, shown to open or copy. */
  download: { label: string; url: string };
  /** Which copy is kept, as a sentence. */
  copy: string;
  /** What choosing a copy is called: a first one, or another. */
  choose: string;
  /** Offered only while a copy is kept. */
  remove?: string;
  fill: { label: string; enabled: boolean };
  /** Why the last copy chosen was refused, or why filling failed. */
  problem?: string;
}

export function officialSheetView(map: FormMap, kept: Pick<KeptForm, 'name'> | null, problem?: string): OfficialSheetView {
  return {
    heading: 'Fill the official sheet',
    lede: [
      `Incudo can fill ${map.name} that ${map.publisher} publishes, from this character's sheet.`,
      'Incudo does not include or download it. Download it in your browser from the page below, then choose your copy. Incudo keeps your copy and leaves it as it is: the filled sheet is a new file, saved where you choose.',
    ],
    download: { label: 'Download page', url: map.download },
    copy: kept ? `Your copy: ${kept.name}` : 'No copy chosen yet.',
    choose: kept ? 'Choose another copy…' : 'Choose your copy…',
    ...(kept ? { remove: 'Remove copy' } : {}),
    fill: { label: 'Fill and save…', enabled: kept !== null },
    ...(problem ? { problem } : {}),
  };
}

/** What the Sheet's bar says after a fill: the file, and what was left off with where it is instead. */
export function officialSheetResult(fileName: string, values: Pick<FormValues, 'leftOff'>): string {
  const saved = `Filled the official sheet as ${fileName}.`;
  return values.leftOff.length ? `${saved} Left off, and on Incudo's own sheet: ${values.leftOff.join('; ')}.` : saved;
}

/** The name a filled sheet is offered under: the character's, marked as the official sheet, so it sits apart from Incudo's own PDF. */
export function officialSheetFileName(characterName: string): string {
  return suggestedFileName(`${characterName.trim() || 'character'} official sheet`, 'pdf');
}
