/**
 * Whether the primary pointer can hover, and so whether a hover preview can be the way to read
 * a candidate's description.
 *
 * Capability, not width: a narrow desktop window still has a mouse and a large touch screen
 * does not. `pointer: fine` is in the query because some touch browsers report `hover: hover`.
 * The query follows the *primary* input, so a touch laptop whose primary pointer is its trackpad
 * counts as able to hover and gets no Details button; that trade is accepted rather than
 * showing both controls to everyone.
 */

import { useMediaQuery } from './use-media-query.ts';

export function useCanHover(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)');
}
