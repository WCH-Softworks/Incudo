/**
 * Where a floating preview goes, given the row it describes and the room the window has.
 *
 * A picker row's description is too long for a tooltip and the row sits inside two nested
 * scrolling columns, so the preview is a panel positioned against the *window* from the row's
 * bounding box. Deciding which side of the row it opens on, and keeping it on screen, is plain
 * geometry with several edge cases (a row at the right edge, a window too narrow for either
 * side, a row near the bottom), which is why it is a function with tests and not arithmetic
 * inside a component — `apps/desktop` is not covered by `npm test`.
 *
 * Preference order is right, then left, then below, then above: beside the row keeps the list
 * itself readable, and only a window with no room to either side stacks the panel on the row.
 */

export interface PreviewRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PreviewSize {
  width: number;
  height: number;
}

export type PreviewSide = 'right' | 'left' | 'below' | 'above' | 'over';

export interface PreviewPlacement {
  left: number;
  top: number;
  side: PreviewSide;
}

export function placePreview({
  anchor,
  viewport,
  panel,
  gap = 8,
  margin = 8,
}: {
  anchor: PreviewRect;
  viewport: PreviewSize;
  panel: PreviewSize;
  /** Space between the row and the panel. */
  gap?: number;
  /** Space kept between the panel and the window's edge. */
  margin?: number;
}): PreviewPlacement {
  const maxLeft = Math.max(margin, viewport.width - margin - panel.width);
  const maxTop = Math.max(margin, viewport.height - margin - panel.height);
  const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max);

  const rightLeft = anchor.right + gap;
  if (rightLeft + panel.width <= viewport.width - margin) {
    return { left: rightLeft, top: clamp(anchor.top, margin, maxTop), side: 'right' };
  }

  const leftLeft = anchor.left - gap - panel.width;
  if (leftLeft >= margin) {
    return { left: leftLeft, top: clamp(anchor.top, margin, maxTop), side: 'left' };
  }

  const left = clamp(anchor.left, margin, maxLeft);
  const below = anchor.bottom + gap;
  if (below + panel.height <= viewport.height - margin) {
    return { left, top: below, side: 'below' };
  }
  const above = anchor.top - gap - panel.height;
  if (above >= margin) {
    return { left, top: above, side: 'above' };
  }

  // No side has room, so the panel covers the row. Reachable only in a window smaller than the
  // panel's own maximum height; better than clipping it off the screen.
  return { left, top: clamp(anchor.top, margin, maxTop), side: 'over' };
}
