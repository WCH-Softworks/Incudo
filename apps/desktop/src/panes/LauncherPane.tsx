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
 *
 * **A card is for someone choosing a game, not for someone maintaining the app.** It shows the
 * system's name, its own logo where it has one, and a sentence about the game. It used to show
 * `description` verbatim, and 5e's read "the first system definition, and the one Incudo is
 * tested against… see docs/adr/0003" — accurate, useful, and the wrong voice entirely. Those
 * notes live in `systems/README.md` now. Nothing on a card cites an ADR.
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
  /** True for a definition the user added themselves, which they may also remove. */
  mine?: boolean;
}

export function LauncherPane({
  systems,
  failures,
  summaries,
  current,
  onChoose,
  onAddSystem,
  onRemoveSystem,
  adding,
  addProblem,
  onDismissAddProblem,
  canAdd,
  cannotAddReason,
  libraryLocation,
}: {
  systems: readonly GameSystem[];
  failures: readonly SystemFailure[];
  summaries: Record<string, SystemSummary>;
  /** Set when the user is changing systems rather than starting, so the screen can say so. */
  current?: string;
  onChoose: (system: GameSystem) => void;
  onAddSystem: () => void;
  onRemoveSystem: (system: GameSystem) => void;
  adding: boolean;
  /** What went wrong with the last add, with its validation errors. Dismissed, never timed out. */
  addProblem?: { message: string; errors?: { path: string; message: string }[] };
  onDismissAddProblem: () => void;
  canAdd: boolean;
  cannotAddReason?: string;
  libraryLocation: string | null;
}): React.JSX.Element {
  return (
    <main className="pane launcher">
      <h2>{current ? 'Change system' : 'Choose a system'}</h2>
      <p className="lede">
        Pick the game you are playing. Your library shows that game's characters, and content
        sources are kept separately for each.
      </p>

      <ul className="system-list">
        {systems.map((system) => (
          <li key={system.id} className={system.id === current ? 'system current' : 'system'}>
            <SystemCard
              system={system}
              summary={summaries[system.id] ?? { sources: 0, enabled: 0 }}
              isCurrent={system.id === current}
              onChoose={() => onChoose(system)}
              onRemove={() => onRemoveSystem(system)}
            />
          </li>
        ))}
      </ul>

      <div className="row">
        <button type="button" onClick={onAddSystem} disabled={adding || !canAdd}>
          {adding ? 'Reading…' : 'Add a system…'}
        </button>
        <span className="hint">
          {canAdd
            ? 'Incudo can build in any game somebody has written a definition for. Point it at a system.json.'
            : cannotAddReason}
        </span>
      </div>

      {addProblem && (
        <div className="problem error">
          <strong>{addProblem.message}</strong>
          {addProblem.errors && addProblem.errors.length > 0 && (
            <ul>
              {addProblem.errors.slice(0, 8).map((error) => (
                <li key={`${error.path}${error.message}`}>
                  {error.path ? `${error.path}: ` : ''}
                  {error.message}
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <button type="button" onClick={onDismissAddProblem}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/*
        A definition that will not validate is named rather than omitted. Omitting it makes a
        broken file look like one that was never added, which is the diagnosis nobody can act
        on — the same reason the engine reports rather than guesses (ADR 0005).
      */}
      {failures.length > 0 && (
        <section className="warn">
          <h3>Could not be loaded</h3>
          <ul>
            {failures.map((failure) => (
              <li key={failure.id}>
                <strong>{failure.id}</strong> — this definition does not match the system format,
                so Incudo will not load part of it.
                <ul>
                  {failure.errors.slice(0, 5).map((error) => (
                    <li key={`${error.path}${error.message}`}>
                      {error.path ? `${error.path}: ` : ''}
                      {error.message}
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
          ? `Your characters are in ${libraryLocation}. One folder holds every game; this choice decides which of them you see.`
          : 'You have not chosen a folder for your characters yet. That comes next, and it is one folder for every game.'}
      </p>
    </main>
  );
}

function SystemCard({
  system,
  summary,
  isCurrent,
  onChoose,
  onRemove,
}: {
  system: GameSystem;
  summary: SystemSummary;
  isCurrent: boolean;
  onChoose: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <>
      <button type="button" className="system-choose" onClick={onChoose}>
        {/*
          The system's own logo, where its author supplied one, and nothing at all where they
          did not. Never a generated glyph or a letter in a coloured circle standing in for a
          publisher's mark — that is the standing commitment in the README, and a grid of cards
          is exactly where it is most tempting to break.
        */}
        {system.logo && <img className="system-logo" src={system.logo} alt="" />}
        <span className="system-text">
          <span className="system-name">
            {system.name}
            {summary.mine && <span className="badge">yours</span>}
            {isCurrent && <span className="badge">current</span>}
          </span>
          {system.description && <span className="system-desc">{system.description}</span>}
          <span className="system-facts">{facts(summary)}</span>
        </span>
      </button>
      {summary.mine && (
        <button
          type="button"
          className="system-remove"
          onClick={onRemove}
          title={`Remove ${system.name} from Incudo`}
        >
          Remove
        </button>
      )}
    </>
  );
}

/**
 * The two things worth knowing before picking, in a player's words.
 *
 * "0 characters · no content sources yet" was accurate and read like a database row. What a
 * user is deciding between is "I have characters here" and "there is nothing here yet".
 */
function facts(summary: SystemSummary): string {
  const characters =
    summary.characters === undefined
      ? undefined
      : summary.characters === 0
        ? 'No characters yet'
        : `${summary.characters} character${summary.characters === 1 ? '' : 's'}`;
  const content =
    summary.enabled > 0
      ? 'content ready'
      : summary.sources > 0
        ? 'content added but switched off'
        : 'no content added yet';
  return characters ? `${characters} · ${content}` : content;
}
