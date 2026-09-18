/**
 * A searchable list of candidates, each expandable to its game text before it is chosen.
 *
 * Replaces the plain `<select>` `BuilderPane.tsx` used for every element decision — Race,
 * Class, Cantrip, Spellbook and the rest — none of which let a player read a candidate's own
 * description before picking it. `Element.description` (`packages/core/src/model.ts`) is where
 * that text lives; `sanitizeDescriptionHtml` (`../sanitize-html.ts`) is what makes it safe to
 * show, and only runs for a row the user actually expands, never for the whole list at once.
 *
 * The volume problem is the reason this is not "one card per candidate": Race offers ~139
 * options and a mid-level Wizard's Spellbook decision 300+, so every row starts collapsed to a
 * name and a search box narrows the list before any description is read or rendered. `search-
 * candidates.ts` in `packages/ui` does the matching and the capping (CODE-REUSE-POLICY rule 2);
 * this file only renders what it returns and tracks which row, if any, is expanded.
 *
 * This is not a modal and does not block the rest of the screen — ADR 0017 rules out anything
 * that revives a wizard's "answer this before you can see anything else", and a picker that
 * covered the other two columns while open would be exactly that in a different shape.
 */

import { useMemo, useState } from 'react';
import { searchCandidates } from '@incudo/ui';
import type { ElementId, ElementIndex } from '@incudo/core';

import { sanitizeDescriptionHtml } from '../sanitize-html.ts';

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

  const options = useMemo(
    () => candidates.map((id) => ({ id, label: candidateLabel(id) })),
    [candidates, candidateLabel],
  );
  const { matches, matchCount } = searchCandidates(options, query);

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
            <li key={String(option.id)} className="picker-row">
              <div className="picker-row-head">
                <button type="button" className="picker-choose" onClick={() => onSelect(option.id)}>
                  {option.label}
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={() => setExpandedId(expandedId === option.id ? null : option.id)}
                >
                  {expandedId === option.id ? 'Hide details' : 'Details'}
                </button>
              </div>
              {expandedId === option.id && <CandidateDetails id={option.id} elements={elements} />}
            </li>
          ))}
        </ul>
      )}
      {matchCount > matches.length && (
        <p className="hint">
          Showing {matches.length} of {matchCount}. Narrow the search to see the rest.
        </p>
      )}
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
    <div className="picker-chosen">
      <div className="picker-row-head">
        <span className="picker-name">{candidateLabel(id)}</span>
        <button type="button" className="link" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Hide details' : 'Details'}
        </button>
        <button type="button" className="link" onClick={() => setChanging(true)}>
          Change
        </button>
      </div>
      {expanded && <CandidateDetails id={id} elements={elements} />}
    </div>
  );
}

/** A candidate's sanitized description, or a plain note that it has none. */
function CandidateDetails({ id, elements }: { id: ElementId; elements: ElementIndex }): React.JSX.Element {
  const element = elements.get(id);
  const html = useMemo(
    () => (element?.description ? sanitizeDescriptionHtml(element.description) : undefined),
    [element],
  );
  return (
    <div className="picker-details">
      {html ? (
        <div className="picker-description" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="hint">No description available.</p>
      )}
    </div>
  );
}
