/**
 * The format numbers 1.0 writes and reads, and what a reader says of a number above its own — ADR 0130.
 *
 * Only 1.0's formats are supported, and these numbers are its baseline. A file a newer Incudo wrote carries a number
 * this version does not know: it is refused with a sentence, never opened, because opening it would drop what this
 * version cannot read and a Save would write that loss back over the file.
 */

import { LATEST_CHARACTER_FORMAT_VERSION } from './character.ts';

/** The highest number each format's reader knows. A change that moves one moves it here, in its schema and in ADR 0130. */
export const FORMAT_VERSIONS = {
  /** `character.json` (ADR 0012): every number from 1 up is read. */
  character: LATEST_CHARACTER_FORMAT_VERSION,
  /** A `.incu`'s `manifest.json`. */
  container: 1,
  /** Incudo's content format (ADR 0119): a source, a homebrew body, a save's `content.json`. */
  content: 1,
  /** A system definition (ADR 0011). */
  system: 1,
  /** The user's feature library, `incudo-features.json` (ADR 0106). */
  featureLibrary: 1,
} as const;

/** Whether `found` is a format number above `reads`: a file a newer Incudo wrote. Anything not a number is not. */
export function isNewerFormat(found: unknown, reads: number): found is number {
  return typeof found === 'number' && Number.isInteger(found) && found > reads;
}

/** The one sentence for it, naming what the file is. */
export function newerFormatNote(what: string, found: number, reads: number): string {
  return `This ${what} was written by a newer version of Incudo (format ${found}; this version reads up to ${reads}). Update Incudo to open it.`;
}
