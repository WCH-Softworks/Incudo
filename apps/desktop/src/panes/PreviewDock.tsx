/**
 * A fixed place on the builder screen where the option being pointed at is read.
 *
 * A floating panel beside the hovered row worked but was easy to miss, and it vanished the
 * moment the pointer left, so reading anything long meant keeping the mouse still. The dock is
 * one area at the top of the right-hand column that every picker writes to. It **keeps its
 * content when the pointer leaves**, so the text can be scrolled and reread, and the row it
 * describes stays marked in its list.
 *
 * It only exists where it can be seen beside the pickers. Below the breakpoint at which the
 * three columns stack (`max-width: 1000px` in `styles.css`) the right-hand column sits far from
 * the row, so `docked` is false and a picker falls back to its own floating preview. It also
 * needs a pointer that can hover; a touch screen reads a description through the Details button.
 *
 * This is UI state only: which candidate is showing. Nothing here decides what can be chosen.
 */

import { createContext, useContext, useId, useMemo, useState } from 'react';
import type { ElementId, ElementIndex } from '@incudo/core';

import { useCanHover } from '../use-can-hover.ts';
import { useMediaQuery } from '../use-media-query.ts';
import { PREVIEW_EMPTY, PREVIEW_HIDE_LABEL, PREVIEW_SHOW_LABEL, PREVIEW_TITLE } from '@incudo/ui';

import { CandidateDescription } from './CandidateDescription.tsx';

/** The complement of the `max-width: 1000px` breakpoint that stacks `.columns`. */
const COLUMNS_SIDE_BY_SIDE = '(min-width: 1001px)';

interface Dock {
  /** Whether the dock is on screen and pickers should write to it instead of floating. */
  docked: boolean;
  currentId: ElementId | null;
  show: (id: ElementId) => void;
  /** The dock's element id, for `aria-describedby` on whatever it is describing. */
  regionId: string;
}

const DockContext = createContext<Dock | null>(null);

export function PreviewDockProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const canHover = useCanHover();
  const sideBySide = useMediaQuery(COLUMNS_SIDE_BY_SIDE);
  const [currentId, setCurrentId] = useState<ElementId | null>(null);
  const regionId = useId();

  const value = useMemo<Dock>(
    () => ({ docked: canHover && sideBySide, currentId, show: setCurrentId, regionId }),
    [canHover, sideBySide, currentId, regionId],
  );
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

/** Null outside a provider, which a picker reads as "no dock, float your own". */
export function usePreviewDock(): Dock | null {
  return useContext(DockContext);
}

export function PreviewDock({
  elements,
  candidateLabel,
  collapsed,
  onCollapsed,
}: {
  elements: ElementIndex;
  candidateLabel: (id: ElementId) => string;
  /**
   * Folded to its title line, so the settled choices beneath it have the column (ADR 0115): the user's preference. The
   * row being pointed at is still named, so what the description would be about is never lost.
   */
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
}): React.JSX.Element | null {
  const dock = usePreviewDock();
  if (!dock?.docked) return null;

  return (
    <section
      className={collapsed ? 'preview-dock collapsed' : 'preview-dock'}
      id={dock.regionId}
      aria-label={PREVIEW_TITLE}
    >
      <div className="preview-dock-head">
        <p className={dock.currentId === null ? 'preview-dock-title hint' : 'preview-dock-title'}>
          {dock.currentId === null ? (collapsed ? PREVIEW_TITLE : PREVIEW_EMPTY) : candidateLabel(dock.currentId)}
        </p>
        <button type="button" className="link" aria-expanded={!collapsed} onClick={() => onCollapsed(!collapsed)}>
          {collapsed ? PREVIEW_SHOW_LABEL : PREVIEW_HIDE_LABEL}
        </button>
      </div>
      {!collapsed && dock.currentId !== null && <CandidateDescription id={dock.currentId} elements={elements} />}
    </section>
  );
}
