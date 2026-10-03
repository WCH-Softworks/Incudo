/**
 * Editing a character and saving it with Save — the phone's build flow, ADR 0086.
 *
 * A play edit is written at once by replacing `character.json` (ADR 0084), because it changes nothing a file embeds. A
 * build edit changes what the character reaches, so its file is packed again (`CharacterLibrary.save`, `packCharacter`),
 * and that is the user's Save, as on the desktop (the maintainer's choice). This keeps what a Save needs between edits:
 * the library entry it writes to, the `updated` it last read there (ADR 0027 refuses a write over a change made
 * elsewhere), the assets the file carried (a `Character` names its portrait and does not hold it), and the character as
 * last saved, so a screen can ask whether anything is unsaved.
 *
 * A new character has no entry until its first Save, which names its file after it (`CharacterLibrary.save`); later
 * Saves write to that file whatever the character is renamed to.
 */

import type { Character, ContainerFiles, ElementIndex, GameSystem, LibraryEntryRef } from '@incudo/core';

import type { CharacterLibrary } from './character-library.ts';

export interface EditSession {
  /** The file it is saved to; absent until a new character's first Save. */
  entry?: LibraryEntryRef;
  /** The entry's `updated` when it was last read or written. */
  readAt?: string;
  /** The file's assets, written back with it. */
  assets?: ContainerFiles;
  /** The character as last saved or opened, to compare with. */
  saved: string;
}

/** A session over a character just opened from `entry`, or a new one (no entry). */
export function beginEdit(
  character: Character,
  origin: { entry?: LibraryEntryRef; readAt?: string; assets?: ContainerFiles } = {},
): EditSession {
  return { ...origin, saved: JSON.stringify(character) };
}

/** Whether the character differs from what was last saved or opened. */
export function hasUnsavedChanges(session: EditSession, character: Character): boolean {
  return JSON.stringify(character) !== session.saved;
}

export type EditSaveResult =
  | { ok: true; session: EditSession; entry: LibraryEntryRef }
  | { ok: false; reason: 'conflict' | 'failed'; message: string };

/**
 * Save the character into the library: to the session's entry, or to a new one named after it. A write over a file
 * changed since it was read is refused, and the session stays as it was so nothing is lost.
 */
export async function saveEdit(
  library: CharacterLibrary,
  session: EditSession,
  character: Character,
  system: GameSystem,
  elements: ElementIndex,
  generator: string,
): Promise<EditSaveResult> {
  const result = await library.save(character, system, elements, {
    ...(session.entry ? { entry: session.entry, expectUpdatedAt: session.readAt } : {}),
    ...(session.assets ? { assets: session.assets } : {}),
    generator,
  });
  if (!result.ok) return result;
  // The library listed itself again after writing; what it read there is what the next Save compares with.
  const listed = library.getState().entries.find((entry) => entry.name === result.entry.name);
  return {
    ok: true,
    entry: result.entry,
    session: {
      entry: result.entry,
      ...(listed?.updatedAt !== undefined ? { readAt: listed.updatedAt } : {}),
      ...(session.assets ? { assets: session.assets } : {}),
      saved: JSON.stringify(character),
    },
  };
}
