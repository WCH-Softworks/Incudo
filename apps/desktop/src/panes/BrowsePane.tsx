/**
 * Looking through what the enabled sources hold — ADR 0053.
 *
 * A renderer over `ContentCatalog` (`packages/ui/src/content-browser.ts`): which elements match, in what
 * order, how many of each type and book, and what one element says about itself are all computed there
 * and tested in Node. This file holds only what the user has typed and chosen, and the page they are on.
 *
 * It is handed the index the last load produced and nothing a character holds, so it shows the same
 * thing whichever character is open, and a save's embedded content is never in it (ADR 0012).
 *
 * Descriptions are sanitized one at a time, for the element being read, as the candidate picker does:
 * rendering ten thousand of them to show a list would be most of the cost of the screen.
 */

import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BROWSER_PAGE,
  contentCatalog,
  fileWithinSource,
  type ContentCatalog,
  type TypeCount,
  type TypeGroup,
} from '@incudo/ui';
import type { ElementId, ElementIndex, GameSystem } from '@incudo/core';
import type { ConfiguredSource } from '@incudo/content';

import { useMediaQuery } from '../use-media-query.ts';
import { CandidateDescription } from './CandidateDescription.tsx';

/** The complement of the `max-width: 1000px` breakpoint that stacks `.browse-columns`. */
const SIDE_BY_SIDE = '(min-width: 1001px)';

/** How many selects an element's detail lists before it says how many more there are. */
const OFFERED_SHOWN = 12;

const GROUP_LABELS: Record<TypeGroup, string> = {
  browsable: 'Categories',
  declared: 'Other types',
  undeclared: 'Types this game system does not describe',
};

/**
 * What the user has typed and chosen. Held by the shell, not here: this pane unmounts whenever another is
 * shown, and a search should still be there after a look at the Build pane. It survives a reload of the
 * content too; a type, book or element the new load lacks is shown as such rather than dropped.
 */
export interface BrowseView {
  text: string;
  type?: string;
  book?: string;
  descriptions: boolean;
  selected: ElementId | null;
}

export const NEW_BROWSE_VIEW: BrowseView = { text: '', descriptions: true, selected: null };

export function BrowsePane({
  elements,
  system,
  sources,
  loading,
  view,
  onView,
  onOpenSources,
}: {
  /** What the enabled sources loaded, or null when nothing has been. */
  elements: ElementIndex | null;
  system: GameSystem;
  /** This system's configured sources, to name the one an element came from. */
  sources: readonly ConfiguredSource[];
  loading: boolean;
  view: BrowseView;
  onView: (view: BrowseView) => void;
  onOpenSources: () => void;
}): React.JSX.Element {
  const catalog = useMemo(() => (elements ? contentCatalog(elements, system) : null), [elements, system]);

  if (!elements || !catalog || catalog.size === 0) {
    return (
      <main className="pane browse">
        <h2>Browse</h2>
        <p className="lede">
          {loading ? 'Content is loading.' : 'No content is loaded. Add or switch on a source to look through it here.'}
        </p>
        {!loading && (
          <div className="row">
            <button type="button" onClick={onOpenSources}>
              Go to Sources
            </button>
          </div>
        )}
      </main>
    );
  }

  return (
    <Browser
      catalog={catalog}
      elements={elements}
      sources={sources}
      view={view}
      onView={onView}
      onOpenSources={onOpenSources}
    />
  );
}

function Browser({
  catalog,
  elements,
  sources,
  view,
  onView,
  onOpenSources,
}: {
  catalog: ContentCatalog;
  elements: ElementIndex;
  sources: readonly ConfiguredSource[];
  view: BrowseView;
  onView: (view: BrowseView) => void;
  onOpenSources: () => void;
}): React.JSX.Element {
  const { text, type, book, descriptions, selected } = view;
  const change = (next: Partial<BrowseView>): void => onView({ ...view, ...next });
  const setSelected = (id: ElementId | null): void => change({ selected: id });
  // The page reached is not kept: coming back to a search starts at its first hundred.
  const [limit, setLimit] = useState(BROWSER_PAGE);
  // Stacked, the element being read replaces the list rather than sitting above or below it: above, a
  // long description pushed the search box off the screen; below, it is a hundred rows from the one
  // that opened it. Both were tried at 800 pixels wide. What was typed and the page reached are kept.
  const sideBySide = useMediaQuery(SIDE_BY_SIDE);
  const reading = !sideBySide && selected !== null;
  // The pane scrolls itself, so the element opens at the top and the list comes back where it was left.
  const pane = useRef<HTMLElement>(null);
  const detail = useRef<HTMLElement>(null);
  const listScroll = useRef(0);
  useLayoutEffect(() => {
    // Side by side, the detail column scrolls on its own and starts each element at its top.
    if (detail.current) detail.current.scrollTop = 0;
    if (pane.current) pane.current.scrollTop = reading ? 0 : listScroll.current;
  }, [reading, selected]);
  const open = (id: ElementId): void => {
    if (!reading && pane.current) listScroll.current = pane.current.scrollTop;
    setSelected(id);
  };

  // Typing stays responsive while a long list re-renders behind it.
  const query = useDeferredValue(text);
  useEffect(() => setLimit(BROWSER_PAGE), [query, type, book, descriptions]);

  const result = useMemo(
    () => catalog.search({ text: query, type, book, descriptions, limit }),
    [catalog, query, type, book, descriptions, limit],
  );
  const groups = groupTypes(result.types);

  return (
    <main className="pane browse" ref={pane}>
      <div className="browse-columns">
        <section className="browse-list" aria-label="Search" hidden={reading}>
          <input
            type="search"
            className="browse-search"
            placeholder={`Search ${catalog.size.toLocaleString()} elements…`}
            aria-label="Search loaded content"
            value={text}
            onChange={(event) => change({ text: event.target.value })}
            autoFocus
          />
          <div className="browse-filters">
            <label>
              Type{' '}
              <select value={type ?? ''} onChange={(event) => change({ type: event.target.value || undefined })}>
                <option value="">All types</option>
                {groups.map(([group, types]) => (
                  <optgroup key={group} label={GROUP_LABELS[group]}>
                    {types.map((entry) => (
                      <option key={entry.type} value={entry.type}>
                        {entry.label} ({entry.count.toLocaleString()})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {/* An empty key is a real book choice (elements that record none), so "all" is a character no
                source string can hold. */}
            <label>
              Book{' '}
              <select value={book ?? '\u0000'} onChange={(event) => change({ book: event.target.value === '\u0000' ? undefined : event.target.value })}>
                <option value={'\u0000'}>All books</option>
                {result.books.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.name || 'No book recorded'} ({entry.count.toLocaleString()})
                  </option>
                ))}
              </select>
            </label>
            <label className="browse-check">
              <input type="checkbox" checked={descriptions} onChange={(event) => change({ descriptions: event.target.checked })} />
              Search descriptions
            </label>
          </div>

          {result.idle ? (
            <Categories types={result.types} onPick={(picked) => change({ type: picked })} />
          ) : (
            <>
              <p className="hint">
                {result.count === 0
                  ? 'Nothing matches.'
                  : `${result.count.toLocaleString()} ${result.count === 1 ? 'match' : 'matches'}` +
                    (result.rows.length < result.count ? `, showing the first ${result.rows.length.toLocaleString()}` : '')}
              </p>
              <ul className="browse-rows">
                {result.rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className={selected === row.id ? 'browse-row on' : 'browse-row'}
                      onClick={() => open(row.id)}
                    >
                      <span className="browse-name">{row.name}</span>
                      <span className="browse-meta">
                        {row.typeLabel}
                        {row.book && ` · ${row.book}`}
                        {row.matched === 'id' && ' · matched by id'}
                      </span>
                      {row.excerpt && <span className="browse-excerpt">{row.excerpt}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {result.rows.length < result.count && (
                <div className="row">
                  <button type="button" onClick={() => setLimit(limit + BROWSER_PAGE)}>
                    Show {Math.min(BROWSER_PAGE, result.count - result.rows.length).toLocaleString()} more
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <section
          ref={detail}
          className="browse-detail"
          aria-label="Details"
          aria-live="polite"
          hidden={!sideBySide && !reading}>
          {reading && (
            <div className="row">
              <button type="button" onClick={() => setSelected(null)}>
                Back to results
              </button>
            </div>
          )}
          {selected ? (
            <Detail
              id={selected}
              catalog={catalog}
              elements={elements}
              sources={sources}
              onSelect={setSelected}
              onOpenSources={onOpenSources}
            />
          ) : (
            <p className="hint">Choose an element to read it here.</p>
          )}
        </section>
      </div>
    </main>
  );
}

/** The types the system marks browsable, as buttons: where looking starts when nothing is typed. */
function Categories({ types, onPick }: { types: TypeCount[]; onPick: (type: string) => void }): React.JSX.Element {
  const categories = types.filter((entry) => entry.group === 'browsable');
  if (!categories.length) return <p className="hint">Type to search, or choose a type.</p>;
  return (
    <>
      <p className="hint">Type to search, or choose a category.</p>
      <ul className="browse-categories">
        {categories.map((entry) => (
          <li key={entry.type}>
            <button type="button" onClick={() => onPick(entry.type)}>
              {entry.label} <span className="count">{entry.count.toLocaleString()}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Detail({
  id,
  catalog,
  elements,
  sources,
  onSelect,
  onOpenSources,
}: {
  id: ElementId;
  catalog: ContentCatalog;
  elements: ElementIndex;
  sources: readonly ConfiguredSource[];
  onSelect: (id: ElementId) => void;
  onOpenSources: () => void;
}): React.JSX.Element {
  const detail = useMemo(() => catalog.describe(id), [catalog, id]);
  if (!detail) return <p className="hint">This element is no longer loaded.</p>;
  const { element } = detail;
  const source = sources.find((candidate) => candidate.id === detail.sourceId);

  return (
    <article>
      <h2 className="browse-title">{element.name}</h2>
      <p className="browse-meta">
        {detail.typeLabel}
        {detail.book && ` · ${detail.book}`}
      </p>
      <CandidateDescription id={id} elements={elements} />

      {detail.offeredBy.length > 0 && (
        <>
          <h3>Offered by</h3>
          <ul className="browse-offered">
            {detail.offeredBy.slice(0, OFFERED_SHOWN).map((offer) => (
              <li key={`${offer.ownerId}\n${offer.select}`}>
                <button type="button" className="link" onClick={() => onSelect(offer.ownerId)}>
                  {offer.ownerName}
                </button>{' '}
                <span className="hint">({offer.select})</span>
              </li>
            ))}
          </ul>
          {detail.offeredBy.length > OFFERED_SHOWN && (
            <p className="hint">and {(detail.offeredBy.length - OFFERED_SHOWN).toLocaleString()} more.</p>
          )}
        </>
      )}

      <h3>Where it comes from</h3>
      <dl>
        <div>
          <dt>Source</dt>
          <dd>
            {source?.name ?? 'Added when the content was loaded'}{' '}
            <button type="button" className="link" onClick={onOpenSources}>
              Go to Sources
            </button>
          </dd>
        </div>
        <div>
          <dt>File</dt>
          <dd>{detail.fileUrl ? <code>{fileWithinSource(detail.fileUrl, source?.url)}</code> : 'None: it is not read from a file.'}</dd>
        </div>
        <div>
          <dt>Id</dt>
          <dd>
            <code>{element.id}</code>
          </dd>
        </div>
        {element.supports.length > 0 && (
          <div>
            <dt>Tags</dt>
            <dd>
              {element.supports.map((tag) => (
                // Bordered, because a tag may hold a space ("Saving Throw") and plain text would run
                // two tags together.
                <span key={tag} className="tag browse-tag">
                  {tag}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
    </article>
  );
}

/** The types with matches, in the catalog's order, split into its three groups; empty groups left out. */
function groupTypes(types: TypeCount[]): Array<[TypeGroup, TypeCount[]]> {
  const groups: Array<[TypeGroup, TypeCount[]]> = [];
  for (const entry of types) {
    const last = groups[groups.length - 1];
    if (last && last[0] === entry.group) last[1].push(entry);
    else groups.push([entry.group, [entry]]);
  }
  return groups;
}
