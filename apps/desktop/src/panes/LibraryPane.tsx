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

import { useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryEntry, LibraryState } from '@incudo/ui';

export function LibraryPane({
  state,
  onChooseFolder,
  onRefresh,
  onOpen,
  onNew,
  onRemove,
  onOpenSettings,
  askForFolder,
  onDismissAsk,
  shell,
}: {
  state: LibraryState;
  onChooseFolder: () => void;
  onRefresh: () => void;
  onOpen: (entry: LibraryEntry) => void;
  onNew: () => void;
  onRemove: (entry: LibraryEntry) => void;
  onOpenSettings: () => void;
  /** First run: nobody has chosen a folder and nobody has waved the question away yet. */
  askForFolder: boolean;
  onDismissAsk: () => void;
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
        <FirstRunDialog
          open={askForFolder}
          onChooseFolder={onChooseFolder}
          onDismiss={onDismissAsk}
          shell={shell}
        />
        <h2>Characters</h2>
        <p className="lede">
          Incudo does not know where you keep your characters yet.{' '}
          <button type="button" className="link" onClick={onChooseFolder}>
            Choose a folder
          </button>{' '}
          and everything in it shows up here. You can change it later in{' '}
          <button type="button" className="link" onClick={onOpenSettings}>
            Settings
          </button>
          .
        </p>
      </main>
    );
  }

  return (
    <main className="pane">
      <div className="library-head">
        <h2>Characters</h2>
        {/*
          The folder is named, and changing it is not. That is a setting you go and find
          (ADR 0027's folder is chosen once and remembered); a "Change folder…" button sitting
          next to "New character" reads like something you are meant to press.
        */}
        <span className="status" title={state.location ?? undefined}>
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

/**
 * The one-time question: where do you keep your characters?
 *
 * A real `<dialog>` rather than a div with a high z-index, because the browser already knows
 * how to trap focus, close on Escape and paint a backdrop, and doing any of that by hand is
 * how a modal ends up unreachable from a keyboard.
 *
 * **Dismissible on purpose.** Not having a library folder is a perfectly workable state: you
 * can add content sources and build a character without one, and only *saving* needs somewhere
 * to save to. A dialog you cannot decline would be the toll gate ADR 0027 exists to remove,
 * just moved to a different screen.
 */
function FirstRunDialog({
  open,
  onChooseFolder,
  onDismiss,
  shell,
}: {
  open: boolean;
  onChooseFolder: () => void;
  onDismiss: () => void;
  shell: 'tauri' | 'browser';
}): React.JSX.Element | null {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="ask" onClose={onDismiss} onCancel={onDismiss}>
      <h2>Where do you keep your characters?</h2>
      <p className="lede">
        Pick a folder and Incudo remembers it. It lists every <code>.incu</code> inside, and
        leaves everything else in there alone — it is your folder, so put it in git, sync it, copy
        files in and out. Incudo rescans and never renames anything.
      </p>
      <p className="hint">
        You do not need one to look around: content sources and the builder work without it, and
        a saved character needs no content sources to open (ADR 0012).
        {shell === 'browser' &&
          ' In this browser build a reload may need one click to reconnect to the folder.'}
      </p>
      <div className="row">
        <button type="button" className="on" onClick={onChooseFolder}>
          Choose folder…
        </button>
        <button type="button" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </dialog>
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
  const src = useObjectUrl(entry.portrait, mediaTypeOf(entry.portraitPath));
  if (!src) {
    return (
      <div className="portrait empty" aria-hidden="true">
        <span>no portrait</span>
      </div>
    );
  }
  return <img className="portrait" src={src} alt={`Portrait of ${entry.title}`} />;
}

/**
 * The media type, from the name the importer gave the file.
 *
 * Not always PNG: the importer sniffs five formats and names the asset accordingly, and one
 * of the nine real sample saves carries a JPEG. Assuming PNG here handed the browser a blob
 * under the wrong type — found by running the library against those saves, which no unit test
 * had caught because every fixture portrait was a PNG.
 */
function mediaTypeOf(path: string | undefined): string {
  const extension = path?.toLowerCase().split('.').pop();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'bmp') return 'image/bmp';
  if (extension === 'webp') return 'image/webp';
  return 'image/png';
}

/** Blob URLs are a resource; this revokes them when the card goes away or the bytes change. */
function useObjectUrl(bytes: Uint8Array | undefined, type: string): string | undefined {
  const blob = useMemo(
    () => (bytes ? new Blob([bytes as BlobPart], { type }) : undefined),
    [bytes, type],
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
