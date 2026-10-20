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

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { candidateGroups, CURRENT_CHOICE, placePreview, searchCandidates, type PreviewPlacement } from '@incudo/ui';
import type { CandidateNoteDef, ElementId, ElementIndex } from '@incudo/core';

import { useCanHover } from '../use-can-hover.ts';
import { CandidateDescription } from './CandidateDescription.tsx';
import { usePreviewDock } from './PreviewDock.tsx';

/**
 * The kind's candidate notes, for grouping: a list whose candidates a note with `groups` reaches (a spell list by level)
 * is shown in collapsible groups. The Build pane provides it; a picker outside it lists flat.
 */
export const CandidateNotesContext = createContext<readonly CandidateNoteDef[]>([]);

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
  notes,
  warnings,
  current,
  onSelect,
}: {
  candidates: ElementId[];
  elements: ElementIndex;
  /** A candidate's display text — name plus the book it came from, where one is recorded. */
  candidateLabel: (id: ElementId) => string;
  /**
   * A line under some candidates, worded by the view-model: what one would give that the character already has
   * (`overlapNote`). Not part of the label, so a search does not match it.
   */
  notes?: ReadonlyMap<ElementId, string>;
  /** A line under a candidate offered all the same: what it lacks of a prerequisite the kind makes soft (ADR 0124). */
  warnings?: ReadonlyMap<ElementId, string>;
  /** The answer a settled choice holds now, when this list changes it: marked, so the user sees what they would replace. */
  current?: ElementId;
  onSelect: (id: ElementId) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<ElementId | null>(null);
  const preview = useCandidatePreview(elements, candidateLabel);

  const options = useMemo(
    () => candidates.map((id) => ({ id, label: candidateLabel(id) })),
    [candidates, candidateLabel],
  );
  const { matches } = searchCandidates(options, query, Infinity, current);
  // In groups where the kind marks a note for it (a spell list by level), each one folded by a click on its heading. While
  // something is typed every group with a match is shown open, so a search is never hidden inside a closed group.
  const noteDefs = useContext(CandidateNotesContext);
  const groups = useMemo(() => candidateGroups(candidates, noteDefs, elements), [candidates, noteDefs, elements]);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const searching = query.trim() !== '';

  const row = (option: { id: ElementId; label: string }): React.JSX.Element => (
    <li
      key={String(option.id)}
      className={['picker-row', preview.previewing(option.id) ? 'previewing' : '', option.id === current ? 'current' : '']
        .filter(Boolean)
        .join(' ')}
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
          {option.id === current && <span className="tag done">{CURRENT_CHOICE}</span>}
          {notes?.has(option.id) && <span className="picker-note">{notes.get(option.id)}</span>}
          {warnings?.has(option.id) && <span className="picker-note warning">{warnings.get(option.id)}</span>}
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
      {!preview.canHover && expandedId === option.id && <CandidateDetails id={option.id} elements={elements} />}
    </li>
  );

  const grouped = groups
    ? groups
        .map((group) => {
          const inGroup = new Set(group.options);
          return { label: group.label, matches: matches.filter((option) => inGroup.has(option.id)) };
        })
        .filter((group) => group.matches.length > 0)
    : undefined;

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
        grouped ? (
        <div className="picker-list picker-groups" onMouseLeave={preview.release}>
          {grouped.map((group) => {
            const open = searching || !folded.has(group.label);
            return (
              <section key={group.label} className="picker-group">
                <button
                  type="button"
                  className="picker-group-head"
                  aria-expanded={open}
                  disabled={searching}
                  onClick={() =>
                    setFolded((previous) => {
                      const next = new Set(previous);
                      if (next.has(group.label)) next.delete(group.label);
                      else next.add(group.label);
                      return next;
                    })
                  }
                >
                  <span aria-hidden="true">{open ? '▾' : '▸'}</span> {group.label}{' '}
                  <span className="count">{group.matches.length}</span>
                </button>
                {open && <ul className="picker-group-rows">{group.matches.map(row)}</ul>}
              </section>
            );
          })}
        </div>
        ) : (
        <ul className="picker-list" onMouseLeave={preview.release}>
          {matches.map(row)}
        </ul>
        )
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
  notesFor,
  onChange,
  onChangeRequest,
  onRemove,
  warning,
}: {
  id: ElementId;
  elements: ElementIndex;
  candidateLabel: (id: ElementId) => string;
  /** What this slot could hold instead, `id` included — a `SettledPick.candidates`, filtered. */
  options: ElementId[];
  /** The picker's notes, asked for only once "Change" is pressed: working them out costs a derivation. */
  notesFor?: () => ReadonlyMap<ElementId, string>;
  /** Absent where the answer is taken back rather than changed — an element added to the character. */
  onChange?: (id: ElementId) => void;
  /** Given only where an answer may be taken back — a member of a set, never a race. */
  onRemove?: () => void;
  /**
   * Where Change opens the list somewhere else, the Build pane's middle column (ADR 0124), rather than in this card.
   * When given, `onChange` is not called from here.
   */
  onChangeRequest?: () => void;
  /** A line under the answer: what it lacks of a prerequisite the kind makes soft (ADR 0124). */
  warning?: string;
}): React.JSX.Element {
  const [changing, setChanging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Asked once per opening of the picker, not on every render of a settled card.
  const [notes, setNotes] = useState<ReadonlyMap<ElementId, string> | undefined>(undefined);
  // Called before the early return below: hooks cannot be skipped by the `changing` branch.
  const preview = useCandidatePreview(elements, candidateLabel);

  if (changing && onChange) {
    return (
      <CandidatePicker
        candidates={options}
        elements={elements}
        candidateLabel={candidateLabel}
        notes={notes}
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
        {(onChange || onChangeRequest) && (
          <button
            type="button"
            className="link"
            aria-describedby={preview.describedBy(id)}
            onClick={() => {
              preview.close();
              if (onChangeRequest) return onChangeRequest();
              setNotes(notesFor?.());
              setChanging(true);
            }}
          >
            Change
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            className="link"
            onClick={() => {
              preview.close();
              onRemove();
            }}
          >
            Remove
          </button>
        )}
      </div>
      {warning && <p className="picker-note warning">{warning}</p>}
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
    /** The pointer left the list: the dock lets its text go unless the pointer reaches the dock first. */
    release: (): void => {
      cancel();
      if (docked) dock?.release();
    },
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
