/**
 * Which books this character is offered, as a list of switches.
 *
 * A renderer over `BuilderState.publications` (`packages/ui/src/publications.ts`): what is listed, what
 * is on and what a switch records are all worked out there, and this computes nothing. The search is
 * the shared `searchCandidates`, so it orders matches the way every picker does.
 *
 * Closed by default. Most characters are offered every book and never open it, and a list of well over
 * a hundred books would push everything else in this column down.
 */

import { useState } from 'react';

import type { CharacterBuilder, PublicationList } from '@incudo/ui';
import { searchCandidates } from '@incudo/ui';

export function PublicationsEditor({
  list,
  builder,
}: {
  list: PublicationList;
  builder: CharacterBuilder;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const options = list.rows.map((row) => ({ id: row.name, label: row.name }));
  const byName = new Map(list.rows.map((row) => [row.name, row]));
  const { matches } = searchCandidates(options, query);

  return (
    <details className="publications">
      <summary>
        {list.everything
          ? 'Every book is offered'
          : `${list.offered} of ${list.rows.length} books offered`}
      </summary>
      <p className="hint">
        Only content from the books switched on here is offered when you choose something new. Anything
        this character already has stays, whichever book it came from.
      </p>
      <div className="row">
        <button type="button" onClick={() => builder.setPublications(undefined)} disabled={list.everything}>
          Offer every book
        </button>
        <button type="button" onClick={() => builder.setPublications([])} disabled={list.offered === 0}>
          Offer none
        </button>
      </div>
      <input
        type="search"
        className="picker-search"
        placeholder={`Search ${list.rows.length} book${list.rows.length === 1 ? '' : 's'}…`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {matches.length === 0 ? (
        <p className="hint">No books match &ldquo;{query}&rdquo;.</p>
      ) : (
        <ul className="picker-list">
          {matches.map(({ id: name }) => {
            const row = byName.get(name)!;
            return (
              <li key={name} className="picker-row">
                <label className="toggle publication-row">
                  <input
                    type="checkbox"
                    checked={row.offered}
                    disabled={row.required}
                    onChange={(event) => builder.offerPublication(name, event.target.checked)}
                  />
                  <span className="publication-name">{name}</span>
                  <span className="publication-count">
                    {row.required ? 'always offered' : row.loaded ? `${row.elements}` : 'not loaded'}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
