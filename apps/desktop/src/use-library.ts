/**
 * The React binding for `CharacterLibrary`.
 *
 * The same five lines as `use-builder.ts`, for the same reason: what the library *is* — which
 * characters exist, which are broken, which of their sources have moved — lives in
 * `packages/ui`, where it is testable in Node and where the mobile shell reads the identical
 * object. This side does `useSyncExternalStore` and nothing else (CODE-REUSE-POLICY rule 2).
 */

import { useSyncExternalStore } from 'react';
import type { CharacterLibrary, LibraryState } from '@incudo/ui';

export function useLibrary(library: CharacterLibrary): LibraryState {
  return useSyncExternalStore(library.subscribe, library.getState);
}
