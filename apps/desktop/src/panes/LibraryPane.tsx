/**
 * The screen the app opens on.
 *
 * Aurora opens on your characters and Incudo used to open on an index URL in a text box, doing
 * nothing at all until 238 files had come down over the network. ADR 0027 turned that around,
 * and ADR 0012 is what makes it possible: everything on this screen is read out of the save
 * files themselves, so it renders with **zero sources configured and no network**.
 *
 * Nothing in this file knows a rule about the game, and nothing decides what is broken or what
 * has moved — that is `CharacterLibrary` in `packages/ui`, where it is testable in Node and
 * where the mobile shell will read the identical thing.
 */

import { useEffect, useMemo, useState } from 'react';
import type { LibraryEntry, LibraryState } from '@incudo/ui';

export function LibraryPane({
  state,
  onChooseFolder,
  onRefresh,
  onOpen,
  onNew,
  onRemove,
  shell,
}: {
  state: LibraryState;
  onChooseFolder: () => void;
  onRefresh: () => void;
  onOpen: (entry: LibraryEntry) => void;
  onNew: () => void;
  onRemove: (entry: LibraryEntry) => void;
  shell: 'tauri' | 'browser';
}): React.JSX.Element {
  if (state.status === 'unavailable') {
    return (
      <main className="pane">
        <h2>Characters</h2>
        <div className="problem warn">
          <strong>There is no character library in this browser.</strong>
          <p>{state.unavailableReason}</p>
          <p className="hint">
            Incudo will not pretend to have a library it cannot back with real files. A save is
            the product — see <code>docs/adr/0027-a-library-is-a-folder.md</code>.
          </p>
        </div>
      </main>
    );
  }

  if (state.status === 'no-location') {
    return (
      <main className="pane">
        <h2>Where do you keep your characters?</h2>
        <p className="lede">
          Pick a folder. Incudo lists every <code>.incu</code> in it and remembers the choice.
          It is your folder — put it in git, sync it, copy files in and out; Incudo rescans and
          never renames anything.
        </p>
        <div className="row">
          <button type="button" className="on" onClick={onChooseFolder}>
            Choose folder…
          </button>
        </div>
        <p className="hint">
          You do not need a content source to open a character. Every save carries the content it
          uses (ADR 0012).
          {shell === 'browser' && ' In the browser build, a reload may need one click here to reconnect.'}
        </p>
      </main>
    );
  }

  return (
    <main className="pane">
      <div className="library-head">
        <h2>Characters</h2>
        <span className="status">
          {state.location}
          {state.entries.length > 0 && ` · ${state.entries.length}`}
        </span>
        <div className="row">
          <button type="button" className="on" onClick={onNew}>
            New character
          </button>
          <button type="button" onClick={onRefresh} disabled={state.busy}>
            {state.busy ? 'Scanning…' : 'Refresh'}
          </button>
          <button type="button" onClick={onChooseFolder}>
            Change folder…
          </button>
        </div>
      </div>

      {state.problems.length > 0 && (
        <div className="problem warn">
          <strong>{state.problems.length} thing(s) in that folder could not be read.</strong>
          <ul>
            {state.problems.slice(0, 20).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {state.entries.length === 0 && !state.busy && (
        <p className="lede">
          Nothing in that folder yet. <strong>New character</strong> starts one, and anything you
          copy in — a save from a friend, a folder out of git — shows up on the next refresh.
        </p>
      )}

      <ul className="library">
        {state.entries.map((entry) => (
          <li key={entry.name}>
            <CharacterCard entry={entry} onOpen={() => onOpen(entry)} onRemove={() => onRemove(entry)} />
          </li>
        ))}
      </ul>
    </main>
  );
}

function CharacterCard({
  entry,
  onOpen,
  onRemove,
}: {
  entry: LibraryEntry;
  onOpen: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const moved = entry.sourceStatuses.filter((status) => status.state === 'moved');
  const missing = entry.sourceStatuses.filter((status) => status.state === 'missing');

  return (
    <article className={`card${entry.broken ? ' broken' : ''}`}>
      <Portrait entry={entry} />

      <div className="card-body">
        <h3 className="card-title">{entry.title}</h3>
        <p className="card-meta">
          {entry.broken ? (
            <span className="bad">will not open</span>
          ) : (
            <>
              {entry.kind}
              {entry.progress !== undefined && ` · ${entry.progress}`}
              {entry.elementCount !== undefined && ` · ${entry.elementCount} elements embedded`}
            </>
          )}
        </p>
        <p className="card-meta">
          <code>{entry.name}</code>
          {entry.form === 'folder' && ' · unpacked'}
          {entry.updatedAt && ` · ${entry.updatedAt.slice(0, 10)}`}
        </p>

        {/*
          ADR 0028: say it, change nothing. A character whose sources are gone is a perfectly
          good character — it derives from what it embeds — and the only thing it cannot do is
          offer new choices from that source.
        */}
        {moved.length > 0 && (
          <p className="card-note">
            {moved.map((status) => status.ref.name ?? status.ref.id).join(', ')} has been updated
            since this was built.
          </p>
        )}
        {missing.length > 0 && (
          <p className="card-note">
            Not in your sources: {missing.map((status) => status.ref.name ?? status.ref.id).join(', ')}.
            Opens anyway.
          </p>
        )}

        {entry.problems.length > 0 && (
          <details className="card-note">
            <summary>
              {entry.problems.length} problem{entry.problems.length === 1 ? '' : 's'} in this file
            </summary>
            <ul>
              {entry.problems.map((problem, i) => (
                <li key={i}>
                  {problem.path ? <code>{problem.path}</code> : null} {problem.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="row">
          <button type="button" onClick={onOpen} disabled={entry.broken}>
            Open
          </button>
          <RemoveButton name={entry.title} onRemove={onRemove} />
        </div>
      </div>
    </article>
  );
}

/**
 * A portrait, or a marked gap.
 *
 * `assets/portrait.png` is the user's own image, extracted out of Aurora's base64. When there
 * is none, this renders **nothing but a labelled space** — never a generated silhouette,
 * avatar, icon or texture. That is a standing project commitment (README, "Never generate
 * artwork"), and a grid of faces is exactly where it is most tempting to break.
 */
function Portrait({ entry }: { entry: LibraryEntry }): React.JSX.Element {
  const src = useObjectUrl(entry.portrait);
  if (!src) {
    return (
      <div className="portrait empty" aria-hidden="true">
        <span>no portrait</span>
      </div>
    );
  }
  return <img className="portrait" src={src} alt={`Portrait of ${entry.title}`} />;
}

/** Blob URLs are a resource; this revokes them when the card goes away or the bytes change. */
function useObjectUrl(bytes: Uint8Array | undefined): string | undefined {
  const blob = useMemo(
    () => (bytes ? new Blob([bytes as BlobPart], { type: 'image/png' }) : undefined),
    [bytes],
  );
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob]);

  return url;
}

/** Deleting someone's file is a two-click action, and the second click says what it deletes. */
function RemoveButton({ name, onRemove }: { name: string; onRemove: () => void }): React.JSX.Element {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <button type="button" onClick={() => setArmed(true)}>
        Delete…
      </button>
    );
  }
  return (
    <button type="button" className="danger" onClick={onRemove}>
      Delete "{name}" from the folder
    </button>
  );
}
