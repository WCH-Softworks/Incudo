/**
 * "Which game are you playing?" — ADR 0031.
 *
 * The app used to answer this itself. `boot.ts` imported one system definition, the header
 * read "Dungeons & Dragons 5th Edition · no content loaded" from the first frame, and a user
 * who had chosen nothing was told what they had chosen. Two systems ship and a user may author
 * more (ADR 0011), so the question is real and this is where it gets asked.
 *
 * It comes *before* the library rather than beside it, which is a deliberate amendment to
 * ADR 0027: the answer scopes what the library shows. Choosing D&D means seeing D&D
 * characters, and only those.
 *
 * What this screen must never become is a toll gate on content. A save carries its own
 * elements and opens with nothing configured (ADR 0012), so picking a system leads straight to
 * the library — never to "now add a source". Whether any content exists is *shown* here, as a
 * fact about each system, and acted on later.
 */

import type { GameSystem } from '@incudo/core';

import type { SystemFailure } from '../boot.ts';

/** What the launcher can say about a system before anything is loaded. */
export interface SystemSummary {
  /** Characters in the library folder that belong to it. Undefined when no folder is chosen. */
  characters?: number;
  /** Sources the user has assigned to it. */
  sources: number;
  /** …of which are enabled. */
  enabled: number;
}

export function LauncherPane({
  systems,
  failures,
  summaries,
  current,
  onChoose,
  libraryLocation,
}: {
  systems: readonly GameSystem[];
  failures: readonly SystemFailure[];
  summaries: Record<string, SystemSummary>;
  /** Set when the user is changing systems rather than starting, so the screen can say so. */
  current?: string;
  onChoose: (system: GameSystem) => void;
  libraryLocation: string | null;
}): React.JSX.Element {
  return (
    <main className="pane launcher">
      <h2>{current ? 'Change system' : 'Choose a system'}</h2>
      <p className="lede">
        Incudo's engine knows nothing about any particular game — a system definition supplies
        the vocabulary, and 5e is the first one rather than the architecture. What you pick here
        decides which characters your library shows and which content sources apply.
      </p>

      <ul className="system-list">
        {systems.map((system) => {
          const summary = summaries[system.id] ?? { sources: 0, enabled: 0 };
          return (
            <li key={system.id} className={system.id === current ? 'system current' : 'system'}>
              <button type="button" className="system-choose" onClick={() => onChoose(system)}>
                <span className="system-name">{system.name}</span>
                <span className="system-version">version {system.version}</span>
                {system.description && <span className="system-desc">{system.description}</span>}
                <span className="system-facts">
                  {summary.characters === undefined
                    ? 'library folder not chosen yet'
                    : `${summary.characters} character${summary.characters === 1 ? '' : 's'} in your library`}
                  {' · '}
                  {summary.sources === 0
                    ? 'no content sources yet'
                    : `${summary.enabled} of ${summary.sources} source${summary.sources === 1 ? '' : 's'} enabled`}
                </span>
              </button>
              {system.id === current && <span className="badge">current</span>}
            </li>
          );
        })}
      </ul>

      {/*
        A definition that will not validate is named rather than omitted. Omitting it makes a
        broken build look like a system that was never written, which is the diagnosis nobody
        can act on — the same reason the engine reports rather than guesses (ADR 0005).
      */}
      {failures.length > 0 && (
        <section className="warn">
          <h3>Unavailable</h3>
          <p>
            {failures.length} shipped system definition(s) did not validate, so they cannot be
            used. This is a broken build rather than anything you did — ADR 0011.
          </p>
          <ul>
            {failures.map((failure) => (
              <li key={failure.id}>
                <code>{failure.id}</code>
                <ul>
                  {failure.errors.slice(0, 5).map((error) => (
                    <li key={`${error.path}${error.message}`}>
                      {error.path}: {error.message}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="note">
        {libraryLocation
          ? `Your library is ${libraryLocation}. It holds characters of every system; this choice decides which of them you see.`
          : 'You have not chosen a library folder yet. That comes next, and it is one folder for every system.'}
      </p>
    </main>
  );
}
