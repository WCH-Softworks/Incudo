/**
 * The React binding for `CharacterBuilder`.
 *
 * This is the "five-line `useSyncExternalStore` in each shell" its docstring promises, and it is
 * the whole of what the shell adds to the view-model. Nothing about what is outstanding, what a
 * step requires, or what a decision means lives on this side of the line — see
 * docs/CODE-REUSE-POLICY.md rule 2. If a bug is "the app offered the wrong choice", it is fixable
 * in `packages/ui`, not here.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { CharacterBuilder, type BuilderState } from '@incudo/ui';
import type { Character, ElementIndex, GameSystem } from '@incudo/core';

export function useBuilder(
  character: Character,
  system: GameSystem,
  elements: ElementIndex,
): { builder: CharacterBuilder; state: BuilderState } {
  // Rebuilt when the content index changes, because the builder resolves elements through it.
  // The character is the builder's own mutable state after construction, so it is deliberately
  // not a dependency — re-creating on every edit would throw away the user's work.
  const builder = useMemo(
    () => new CharacterBuilder(character, system, elements),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [system, elements],
  );
  const state = useSyncExternalStore(builder.subscribe, builder.getState);
  return { builder, state };
}
