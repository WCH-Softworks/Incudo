/**
 * A searchable list of candidates, each showing its game text before it is chosen.
 *
 * Replaces the plain `<select>` `BuilderPane.tsx` used for every element decision — Race,
 * Class, Cantrip, Spellbook and the rest — none of which let a player read a candidate's own
 * description before picking it. `Element.description` (`packages/core/src/model.ts`) is where
 * that text lives; `CandidateDescription` sanitizes it (`../sanitize-html.ts`) before showing
 * it, and only for the one row being read, never for the whole list at once.
 *
 * **How the text is reached depends on the device and the layout.** With a mouse or a
 * trackpad, resting on a row (or focusing it with the keyboard) shows the text, and there is no
 * button to press. Where the three builder columns sit side by side it goes to the shared
 * `PreviewDock` at the top of the right-hand column, which keeps it when the pointer leaves.
 * Where they are stacked the dock would be far from the row, so the picker floats its own
 * preview beside the row instead. A touch screen has no hover, so there each row keeps a
 * Details button that expands the text inline. The choice follows the input device, not the
 * window width (`useCanHover`), because a narrow desktop window still has a mouse.
 *
 * The floating preview is a panel positioned against the window rather than a child of the row:
 * the row sits inside a scrolling list inside a scrolling column, and either would clip it. It
 * can be entered and scrolled, since a spell's text is longer than a tooltip, and Escape
 * dismisses it from anywhere.
 *
 * The volume problem is the reason this is not "one card per candidate": Race offers ~139
 * options and a mid-level Wizard's Spellbook decision 300+, so every row is just a name, in a
 * scrolling list, and a search box narrows it. The list is never cut off: someone new to the
 * game has no name to type, so browsing has to reach every option. `candidate-search.ts` and
 * `preview-placement.ts` in `packages/ui` do the matching, ranking and placement
 * (CODE-REUSE-POLICY rule 2); this file renders what they return.
 *
 * This is not a modal and does not block the rest of the screen — ADR 0017 rules out anything
 * that revives a wizard's "answer this before you can see anything else", and a picker that
 * covered the other two columns while open would be exactly that in a different shape.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placePreview, searchCandidates, type PreviewPlacement } from '@incudo/ui';
import type { ElementId, ElementIndex } from '@incudo/core';

import { useCanHover } from '../use-can-hover.ts';
import { CandidateDescription } from './CandidateDescription.tsx';
import { usePreviewDock } from './PreviewDock.tsx';

/** Resting on a row before a floating preview opens, so sweeping the mouse down a list stays quiet. */
const SHOW_DELAY = 250;
/** Before the dock switches. Shorter, since it replaces text rather than covering the screen,
 *  but not zero: a sweep down 300 rows should not sanitize and render 300 descriptions. */
const DOCK_DELAY = 120;
/** Moving to another row while a preview is already up: nearly immediate, or it feels laggy. */
const SWITCH_DELAY = 40;
/** Long enough to cross the gap from a row into its own preview, which can be scrolled. */
const HIDE_DELAY = 150;

export function CandidatePicker({
  candidates,
  elements,
  candidateLabel,
  onSelect,
}: {
  candidates: ElementId[];
  elements: ElementIndex;
  /** A candidate's display text — name plus the book it came from, where one is recorded. */
  candidateLabel: (id: ElementId) => string;
  onSelect: (id: ElementId) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<ElementId | null>(null);
  const preview = useCandidatePreview(elements, candidateLabel);

  const options = useMemo(
    () => candidates.map((id) => ({ id, label: candidateLabel(id) })),
    [candidates, candidateLabel],
  );
  const { matches } = searchCandidates(options, query);

  return (
    <div className="picker">
      <input
        type="search"
        className="picker-search"
        placeholder={`Search ${candidates.length} option${candidates.length === 1 ? '' : 's'}…`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {matches.length === 0 ? (
        <p className="hint">No options match &ldquo;{query}&rdquo;.</p>
      ) : (
        <ul className="picker-list">
          {matches.map((option) => (
            <li
              key={String(option.id)}
              className={preview.previewing(option.id) ? 'picker-row previewing' : 'picker-row'}
              {...preview.rowProps(option.id)}
            >
              <div className="picker-row-head">
                <button
                  type="button"
                  className="picker-choose"
                  aria-describedby={preview.describedBy(option.id)}
                  onClick={() => {
                    preview.close();
                    onSelect(option.id);
                  }}
                >
                  {option.label}
                </button>
                {!preview.canHover && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => setExpandedId(expandedId === option.id ? null : option.id)}
                  >
                    {expandedId === option.id ? 'Hide details' : 'Details'}
                  </button>
                )}
              </div>
              {!preview.canHover && expandedId === option.id && (
                <CandidateDetails id={option.id} elements={elements} />
              )}
            </li>
          ))}
        </ul>
      )}
      {preview.panel}
    </div>
  );
}

/**
 * One candidate's chosen answer, shown as a card rather than reopening the whole search —
 * `SettledPickEditor` in `BuilderPane.tsx` uses this for an already-answered slot. "Change"
 * swaps the card for a `CandidatePicker` scoped to what that slot could hold instead.
 */
export function ChosenCandidate({
  id,
  elements,
  candidateLabel,
  options,
  onChange,
}: {
  id: ElementId;
  elements: ElementIndex;
  candidateLabel: (id: ElementId) => string;
  /** What this slot could hold instead, `id` included — a `SettledPick.candidates`, filtered. */
  options: ElementId[];
  onChange: (id: ElementId) => void;
}): React.JSX.Element {
  const [changing, setChanging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Called before the early return below: hooks cannot be skipped by the `changing` branch.
  const preview = useCandidatePreview(elements, candidateLabel);

  if (changing) {
    return (
      <CandidatePicker
        candidates={options}
        elements={elements}
        candidateLabel={candidateLabel}
        onSelect={(next) => {
          onChange(next);
          setChanging(false);
          setExpanded(false);
        }}
      />
    );
  }

  return (
    <div
      className={preview.previewing(id) ? 'picker-chosen previewing' : 'picker-chosen'}
      {...preview.rowProps(id)}
    >
      <div className="picker-row-head">
        <span className="picker-name">{candidateLabel(id)}</span>
        {!preview.canHover && (
          <button type="button" className="link" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide details' : 'Details'}
          </button>
        )}
        <button
          type="button"
          className="link"
          aria-describedby={preview.describedBy(id)}
          onClick={() => {
            preview.close();
            setChanging(true);
          }}
        >
          Change
        </button>
      </div>
      {!preview.canHover && expanded && <CandidateDetails id={id} elements={elements} />}
      {preview.panel}
    </div>
  );
}

/**
 * How a row's description reaches the screen when the pointer can hover.
 *
 * With a `PreviewDock` on screen, resting on a row writes its id to the dock and nothing is
 * ever hidden: the dock keeps what it last showed, and `previewing` marks the row it belongs
 * to. Without one (stacked columns) this owns a floating panel instead: which candidate is
 * showing, where its row was, and the timers that make it feel right (a pause before it opens,
 * a grace period before it closes).
 *
 * `rowProps` goes on whatever should trigger it; on a device that cannot hover it is empty and
 * `panel` is always null, leaving the Details buttons as the only way to read a description.
 */
function useCandidatePreview(elements: ElementIndex, candidateLabel: (id: ElementId) => string) {
  const canHover = useCanHover();
  const dock = usePreviewDock();
  const docked = canHover && dock?.docked === true;
  const panelId = useId();
  const [shown, setShown] = useState<{ id: ElementId; anchor: DOMRect } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const live = useRef(false);

  const cancel = useCallback(() => window.clearTimeout(timer.current), []);
  const close = useCallback(() => {
    cancel();
    live.current = false;
    setShown(null);
  }, [cancel]);
  useEffect(() => cancel, [cancel]);

  const later = (delay: number, run: () => void): void => {
    cancel();
    timer.current = window.setTimeout(run, delay);
  };
  const show = (id: ElementId, target: HTMLElement, delay: number): void =>
    later(delay, () => {
      if (!target.isConnected) return;
      live.current = true;
      setShown({ id, anchor: target.getBoundingClientRect() });
    });
  const hideSoon = (): void => later(HIDE_DELAY, close);

  const rowProps = (id: ElementId): React.HTMLAttributes<HTMLElement> => {
    if (!canHover) return {};
    if (docked && dock) {
      return {
        onMouseEnter: () => later(DOCK_DELAY, () => dock.show(id)),
        // Leaving only stops a switch that has not happened yet. What is showing stays.
        onMouseLeave: cancel,
        onFocus: () => {
          cancel();
          dock.show(id);
        },
      };
    }
    return {
      onMouseEnter: (event) => show(id, event.currentTarget, live.current ? SWITCH_DELAY : SHOW_DELAY),
      onMouseLeave: hideSoon,
      // Keyboard users get the same text: focus is the other way to rest on a row.
      onFocus: (event) => show(id, event.currentTarget, 0),
      onBlur: hideSoon,
    };
  };

  return {
    canHover,
    close,
    rowProps,
    /** Whether this row is the one whose text is on screen, wherever that is. */
    previewing: (id: ElementId): boolean => (docked ? dock?.currentId === id : shown?.id === id),
    describedBy: (id: ElementId): string | undefined => {
      if (docked) return dock?.currentId === id ? dock.regionId : undefined;
      return shown?.id === id ? panelId : undefined;
    },
    panel:
      canHover && !docked && shown ? (
        <CandidatePreview
          key={shown.id}
          id={shown.id}
          label={candidateLabel(shown.id)}
          anchor={shown.anchor}
          elements={elements}
          panelId={panelId}
          onEnter={cancel}
          onLeave={hideSoon}
          onDismiss={close}
        />
      ) : null,
  };
}

/** The floating panel itself. Measured once rendered, so placement can use its real height. */
function CandidatePreview({
  id,
  label,
  anchor,
  elements,
  panelId,
  onEnter,
  onLeave,
  onDismiss,
}: {
  id: ElementId;
  label: string;
  anchor: DOMRect;
  elements: ElementIndex;
  panelId: string;
  onEnter: () => void;
  onLeave: () => void;
  onDismiss: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<PreviewPlacement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setPlacement(
      placePreview({
        anchor,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        panel: { width: element.offsetWidth, height: element.offsetHeight },
      }),
    );
  }, [anchor]);

  // The panel is positioned from where the row was when it opened, so anything that moves the
  // row leaves it pointing at the wrong place. Scrolling the panel's own text does not count.
  useEffect(() => {
    const dismissUnlessOwn = (event: Event): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      onDismiss();
    };
    // On the window, not the picker: a preview opened by the mouse has no focus inside the
    // picker, and Escape has to work for it too.
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('scroll', dismissUnlessOwn, true);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('keydown', dismissOnEscape);
    return () => {
      window.removeEventListener('scroll', dismissUnlessOwn, true);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('keydown', dismissOnEscape);
    };
  }, [onDismiss]);

  return createPortal(
    <div
      ref={ref}
      id={panelId}
      role="tooltip"
      className="picker-preview"
      style={{
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        visibility: placement ? 'visible' : 'hidden',
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <p className="picker-preview-title">{label}</p>
      <CandidateDescription id={id} elements={elements} />
    </div>,
    document.body,
  );
}

/** An expanded description inside its row, for a device that cannot hover. */
function CandidateDetails({ id, elements }: { id: ElementId; elements: ElementIndex }): React.JSX.Element {
  return (
    <div className="picker-details">
      <CandidateDescription id={id} elements={elements} />
    </div>
  );
}
