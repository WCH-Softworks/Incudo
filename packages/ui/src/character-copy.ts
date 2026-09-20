/**
 * "Save a copy…": the character on screen, written to a file the user picks anywhere — ADR 0038.
 *
 * **A copy is not a Save As.** A Save As moves the document: afterwards the thing being edited
 * *is* the new file, and the next Save goes there. A copy leaves everything where it was. The
 * file being edited, the timestamp its conflict check compares and the name it was last saved
 * under (`working.entry`, `working.readAt` and `working.savedName` in the desktop shell) are all
 * untouched, and this file is why that is structural rather than a matter of care:
 *
 *  - it takes **no `CharacterLibrary` and no `LibraryEntryRef`**, so it has no way to write into
 *    the library, to run the library's conflict check, or to make a listing stale;
 *  - its result carries **no entry and no timestamp**, so a caller has nothing to point
 *    `working` at even by mistake.
 *
 * What is written is what the library writes. `packCharacter` is the one packing function, so a
 * copy is the same self-contained `.incu` (ADR 0012) — it opens with no sources configured — and
 * it is packed from the character as it is *now*, unsaved edits included, which is the point of
 * copying something you are still working on.
 *
 * Nothing here knows what a dialog is. The picker is a port (`FileSaver`), and a phone's share
 * sheet is one more implementation of it.
 */

import type {
  Character,
  ContainerFiles,
  ElementId,
  ElementIndex,
  FileSaver,
  GameSystem,
  SavedFile,
  ZipCodec,
} from '@incudo/core';
import type { ConfiguredSource } from '@incudo/content';

import { packCharacter, suggestedFileName } from './character-library.ts';

export interface CopyOptions {
  /** The configured sources, so the copy records the versions the character was built against. */
  profile?: readonly ConfiguredSource[];
  generator?: string;
  /**
   * Asset bytes to embed — `OpenedCharacter.assets` for a character that was opened. Left out, the
   * copy names a portrait it does not hold, which the reader reports as a placeholder.
   */
  assets?: ContainerFiles;
  /** Ids to embed beyond what the character reaches on its own, as for a library save. */
  extraIds?: ElementId[];
}

export type CopyResult =
  | {
      status: 'saved';
      /** What the user called the file. */
      file: SavedFile;
      /** How many elements the copy embeds. */
      elementCount: number;
      /** Ids the character names that the index could not supply, as `SaveResult` reports them. */
      unresolved: ElementId[];
    }
  /** The user closed the dialog. An answer: nothing was written and nothing is wrong. */
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

export async function saveCopy(
  saver: FileSaver,
  zip: ZipCodec,
  character: Character,
  system: GameSystem,
  elements: ElementIndex,
  options: CopyOptions = {},
): Promise<CopyResult> {
  if (!saver.available) {
    return { status: 'failed', message: saver.unavailableReason ?? 'This platform cannot save a file.' };
  }
  try {
    // Packed before the dialog opens: a character that cannot be packed is reported without the
    // user having chosen a place for a file that will never be written.
    const packed = packCharacter(character, system, elements, {
      profile: options.profile,
      assets: options.assets,
      generator: options.generator,
      extraIds: options.extraIds,
    });
    const bytes = await zip.zip(packed.files);
    const file = await saver.save(bytes, {
      suggestedName: suggestedFileName(character.name),
      title: 'Save a copy of this character',
      extensions: ['incu'],
      label: 'Incudo character',
    });
    if (!file) return { status: 'cancelled' };
    return {
      status: 'saved',
      file,
      elementCount: packed.content.elements.length,
      unresolved: packed.content.unresolved,
    };
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
