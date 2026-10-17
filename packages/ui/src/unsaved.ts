/**
 * Whether the character on screen has changes its library file does not, and what that means for the commands that
 * would replace it (ADR 0120).
 *
 * The desktop's library is explicit-save (ADR 0027) and the draft is the autosave that keeps the character on screen
 * across a reload (ADR 0066). Neither said whether the two agreed, so Open on the card of the character being edited read
 * the file again and the edits were gone without a word, under a bar still saying "Saved to …". Found by a hands-on pass
 * of the app, not by a test.
 *
 * The baseline is the character as it was last opened, saved or started (`WorkingCharacter.baseline`), kept beside the
 * draft so a reload still knows it. What is on screen is compared with it by its recorded inputs, every field but when
 * it was last changed: an edit undone reads as no change, which is what a user means by one.
 */

import type { Character, GameSystem, LibraryEntryRef } from '@incudo/core';

import { newCharacterOfKind } from './character-kinds.ts';
import type { WorkingCharacter } from './draft.ts';

/** What the Build pane's bar says while the character has changes its file does not. */
export const UNSAVED_CHANGES = 'Unsaved changes';

export interface EditState {
  /**
   * Whether there is a character to build: one opened, made with New character, or kept by the draft from one of those.
   * Before any, the app has a blank character only because the builder needs one, and nothing should send the user to it.
   */
  started: boolean;
  /** Whether replacing what is on screen would lose something its library file does not have. */
  unsaved: boolean;
}

/**
 * Two characters with the same recorded inputs: every field compared, keys in any order, but `updatedAt`, which every
 * edit moves.
 */
export function sameCharacter(a: Character, b: Character): boolean {
  return canonical(withoutStamp(a)) === canonical(withoutStamp(b));
}

/**
 * The edit state of `current`, the builder's character, against what the shell holds.
 *
 * A draft written before the baseline was kept has none. Then a character in the library, or one that is not a blank one
 * of its kind, is started, and is counted unsaved until it is next saved or opened: whether it matches its file cannot be
 * known, and asking once too often loses less than not asking. A blank one is not started.
 */
export function editState(working: WorkingCharacter, current: Character, system: GameSystem): EditState {
  if (working.baseline) return { started: true, unsaved: !sameCharacter(current, working.baseline) };
  if (working.entry || !isBlank(current, system)) return { started: true, unsaved: true };
  return { started: false, unsaved: false };
}

/**
 * What Open on a library card does.
 *
 * `show`: the card is the character on screen and it has unsaved changes, so Build is shown and the file is not read
 * (reading it would put the file's character over the edits). `ask`: another character would replace unsaved changes.
 * `open`: read the file. Opening the character on screen with nothing unsaved still reads it, so a file changed on disk
 * since is what is shown.
 */
export function openOutcome(
  working: WorkingCharacter,
  edit: EditState,
  entry: LibraryEntryRef,
): 'show' | 'ask' | 'open' {
  if (!edit.unsaved) return 'open';
  return working.entry && working.entry.name === entry.name && working.entry.form === entry.form ? 'show' : 'ask';
}

/** What would replace the character on screen: a new character, another one opened, or a change of system. */
export type Replacement =
  | { kind: 'new' }
  | { kind: 'open'; name: string }
  | { kind: 'system' };

export interface ReplacePrompt {
  title: string;
  lede: string;
  /** The button that saves first and then carries on; absent when there is no library to save to. */
  save?: string;
  discard: string;
  keep: string;
}

/** The question asked before `replacement` replaces unsaved changes to `name`. */
export function replacePrompt(replacement: Replacement, name: string, canSave: boolean): ReplacePrompt {
  const who = name.trim() || 'This character';
  const what =
    replacement.kind === 'new'
      ? 'Starting a new character'
      : replacement.kind === 'open'
        ? `Opening ${replacement.name.trim() || 'another character'}`
        : 'Changing the system';
  return {
    title: 'Save your changes first?',
    lede: `${who} has changes that are not saved to your library. ${what} will replace them.`,
    ...(canSave ? { save: 'Save first' } : {}),
    discard: 'Discard changes',
    keep: 'Keep editing',
  };
}

/** What Build and the Sheet say before any character is started. */
export const NOTHING_STARTED = {
  title: 'No character yet',
  text: 'Start a new character, or open one from your library, on the Characters screen.',
} as const;

/** A blank character of its kind, as New character makes it: everything but its id, name and stamps. */
function isBlank(character: Character, system: GameSystem): boolean {
  let blank: Character;
  try {
    blank = newCharacterOfKind(system, character.kind);
  } catch {
    return false;
  }
  const strip = ({ id: _id, name: _name, createdAt: _created, ...rest }: Character) => rest;
  return sameCharacter(strip(character) as Character, strip(blank) as Character);
}

function withoutStamp(character: Character): Omit<Character, 'updatedAt'> {
  const { updatedAt: _stamp, ...rest } = character;
  return rest;
}

/** JSON with every object's keys sorted, so two characters built in different orders compare by content. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return inner;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(inner).sort()) sorted[key] = (inner as Record<string, unknown>)[key];
    return sorted;
  });
}
