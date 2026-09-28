/**
 * The React binding for `CharacterBuilder`.
 *
 * This is the "five-line `useSyncExternalStore` in each shell" its docstring promises, and it is
 * the whole of what the shell adds to the view-model. Nothing about what is outstanding, what a
 * step requires, or what a decision means lives on this side of the line — see
 * docs/CODE-REUSE-POLICY.md rule 2. If a bug is "the app offered the wrong choice", it is fixable
 * in `packages/ui`, not here.
 *
 * It is no longer five lines, and the reason is worth reading before shortening it again. The
 * builder owns the character after construction, so a rebuild starts the character over from
 * whatever it is handed — and this hook is rebuilt whenever the content index changes. All three
 * bugs below were found by using the app and none had a failing test; the first two were here
 * from the first commit of this file, and the third came with the fix for the second.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { CharacterBuilder, type BuilderState } from '@incudo/ui';
import type { Character, ElementIndex, GameSystem } from '@incudo/core';

export function useBuilder(
  character: Character,
  system: GameSystem,
  elements: ElementIndex,
): { builder: CharacterBuilder; state: BuilderState } {
  /**
   * The character as it stands, so a rebuild resumes rather than reverts.
   *
   * **Bug one: changing a content source threw away every edit.** Enabling or disabling a
   * source replaces `elements`, which rebuilds the builder — from the shell's `working.character`,
   * which is the character as it was *opened* and is never written back to. Six ability scores,
   * a race and a class, silently back to straight 10s. Nothing on screen said so, and the
   * autosave then wrote the reverted character straight over the draft, so it was not even
   * recoverable by reloading: the work was simply gone. Watched happen, once, to a character
   * built to test something else.
   *
   * Only the builder's own state writes to it (the effect at the bottom). Syncing it from the
   * `character` prop as well would be a second writer, and the stale one — which is the bug.
   */
  const current = useRef(character);

  // Rebuilt when the content index changes, because the builder resolves elements through it —
  // and when the shell hands over a *different character*, which is what `character.id` is
  // doing in the dependency list. The character's *contents* are deliberately not a dependency:
  // re-creating on every edit would throw the user's work away on every keystroke.
  //
  // **Bug two: "New character" did nothing.** It sets a blank character on the shell's state
  // and switches to this pane, and the memo saw the same system and the same index and handed
  // back a builder still holding the previous character. Opening from the library only appeared
  // to work — a save brings its own embedded content, so `elements` changed and took the rebuild
  // with it.
  //
  // **Bug three: opening the character already on screen kept the one on screen.** Keyed on
  // `character.id`, a file opened from the library whose character had that id (the same
  // character, saved and then edited, or changed on disk since) resumed the builder's state and
  // never read the file. Found by opening a hand-edited save. So the key is the object the shell
  // hands over: open, new and import each hand over a new one, and a save or a content reload
  // hands over the same one, which is when resuming is right.
  const handed = useRef(character);
  const builder = useMemo(
    // Same object as last time: only the content changed, so resume from the latest state, which
    // is what fixes bug one. A new object: start from it, whatever its id.
    () => new CharacterBuilder(handed.current === character ? current.current : character, system, elements),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [system, elements, character],
  );

  // After the render that used it, so a second call of the memo (React's development double
  // render) makes the same choice as the first.
  useEffect(() => {
    handed.current = character;
  }, [character]);

  const state = useSyncExternalStore(builder.subscribe, builder.getState);

  // The builder's own edits, remembered for the next rebuild. Without this the ref only ever
  // holds what the shell passed, and bug one comes back the moment something reloads content.
  useEffect(() => {
    current.current = state.character;
  }, [state.character]);

  return { builder, state };
}
