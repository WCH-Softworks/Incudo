/**
 * Whether a character read from a file can be shown, asked before a shell hands it to a builder.
 *
 * A builder derives its character on its first read, and a character it cannot derive throws there: the desktop's
 * Shell had no boundary for that, so a hand-edited or damaged `character.json` blanked the whole window (found
 * driving ADR 0119's changes in the Tauri window). The file is refused instead, with a sentence, and nothing on screen
 * is replaced. Refused only when the build actually fails, never because the validator dislikes something: a beta's
 * file opens if it opens (ADR 0130), and a field today's schema refuses may still derive. The validator is asked only
 * for the words.
 */

import { validateCharacter, type Character, type ElementIndex, type GameSystem, type SchemaBundle } from '@incudo/core';

import { characterKindMissing } from './character-kinds.ts';
import { CharacterBuilder } from './use-character-builder.ts';

/** A sentence saying why the character cannot be opened, or undefined when it can. */
export function characterOpenProblem(
  system: GameSystem,
  character: Character,
  elements: ElementIndex,
  schemas?: SchemaBundle,
): string | undefined {
  const missing = characterKindMissing(system, character);
  if (missing) return missing;
  try {
    new CharacterBuilder(character, system, elements).getState();
    return undefined;
  } catch {
    const name = typeof character.name === 'string' && character.name.trim() ? `“${character.name.trim()}”` : 'This character';
    const first = schemas ? validateCharacter(character, schemas, system).errors[0] : undefined;
    const why = first ? ` (${first.path ? `${first.path}: ` : ''}${first.message})` : '';
    return `${name} cannot be opened: its file does not read as a character${why}. Nothing on screen was replaced.`;
  }
}
