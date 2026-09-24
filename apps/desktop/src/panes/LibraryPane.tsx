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
import type { AuroraImportReport, LibraryEntry, LibraryState } from '@incudo/ui';

export function LibraryPane({
  state,
  systemName,
  nameOfSystem,
  needsSource,
  onOpenSources,
  onChangeSystem,
  onChooseFolder,
  onRefresh,
  onOpen,
  onNew,
  onRemove,
  onOpenSettings,
  onImport,
  onDismissImport,
  importing,
  importBlockedBecause,
  importReports,
  askForFolder,
  onDismissAsk,
  shell,
}: {
  state: LibraryState;
  /** Whose characters these are. The library folder holds every system's — ADR 0031. */
  systemName: string;
  /** Another system's name for its id, since the id is never shown. */
  nameOfSystem: (id: string) => string;
  /** True when this system has no enabled content source. A note, never a block. */
  needsSource: boolean;
  onOpenSources: () => void;
  onChangeSystem: () => void;
  onChooseFolder: () => void;
  onRefresh: () => void;
  onOpen: (entry: LibraryEntry) => void;
  onNew: () => void;
  onRemove: (entry: LibraryEntry) => void;
  onOpenSettings: () => void;
  onImport: () => void;
  onDismissImport: () => void;
  importing: boolean;
  /**
   * Why importing is not possible right now, in a sentence, or undefined when it is.
   *
   * A disabled button with no explanation is the worst of both: the one real precondition
   * here is that an import needs content loaded while opening a character does not, and
   * that asymmetry is worth a sentence rather than a greyed-out control.
   */
  importBlockedBecause?: string;
  importReports: AuroraImportReport[] | null;
  /** First run: nobody has chosen a folder and nobody has waved the question away yet. */
  askForFolder: boolean;
  onDismissAsk: () => void;
  shell: 'tauri' | 'browser';
}): React.JSX.Element {
  if (state.status === 'unavailable') {
    return (
      <main className="pane">
        <h2>Characters</h2>
        <div className="problem warning">
          <strong>There is no character library in this browser.</strong>
          <p>{state.unavailableReason}</p>
          {/*
            ADR 0027: a library is a folder of real files, so there is no fallback to browser
            storage — a character that lived only there could not be copied, synced or backed up.
          */}
          <p className="hint">
            Your characters are kept as ordinary files in a folder you choose, so you can copy,
            sync and back them up. This browser cannot give Incudo such a folder.
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
          <button
            type="button"
            onClick={onImport}
            disabled={importing || importBlockedBecause !== undefined}
            title={importBlockedBecause}
          >
            {importing ? 'Importing…' : 'Import from Aurora…'}
          </button>
          <button type="button" onClick={onRefresh} disabled={state.busy}>
            {state.busy ? 'Scanning…' : 'Refresh'}
          </button>
        </div>
      </div>

      {importBlockedBecause !== undefined && (
        <p className="hint">{importBlockedBecause}</p>
      )}

      {importReports && <ImportReport reports={importReports} onDismiss={onDismissImport} />}

      {state.problems.length > 0 && (
        <div className="problem warning">
          <strong>
            {state.problems.length === 1
              ? 'One thing in that folder could not be read.'
              : `${state.problems.length} things in that folder could not be read.`}
          </strong>
          <ul>
            {state.problems.slice(0, 20).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {/*
        A source is needed to *build* and never to *open* (ADR 0012), so this is a note above
        the list rather than a gate in front of it. It appears after the system is chosen,
        which is the moment ADR 0031 says to check.
      */}
      {needsSource && !state.busy && (
        <div className="problem warn">
          <strong>No content loaded for {systemName}.</strong>
          <p>
            You need a content source to <em>build</em> a character. You do not need one to open
            any of the saves below — each carries the content it uses.
          </p>
          <div className="row">
            <button type="button" onClick={onOpenSources}>
              Add a source
            </button>
          </div>
        </div>
      )}

      {state.entries.length === 0 && !state.busy && (
        <p className="lede">
          No {systemName} characters in that folder yet. <strong>New character</strong> starts
          one, and anything you copy in — a save from a friend, a folder out of git — shows up on
          the next refresh.
        </p>
      )}

      {/*
        The half that stops the system filter from being a disappearance. Nine characters in a
        folder shown as "nothing here" is indistinguishable from having picked the wrong folder,
        which is the mistake a user actually makes.
      */}
      {state.elsewhere.length > 0 && !state.busy && (
        <p className="hint">
          {state.elsewhere
            .map(
              (other) =>
                `${other.count} ${other.systemId === undefined ? 'unrecognised' : nameOfSystem(other.systemId)}`,
            )
            .join(', ')}{' '}
          character(s) in this folder belong to another system and are not shown.{' '}
          <button type="button" className="linklike" onClick={onChangeSystem}>
            Change system
          </button>{' '}
          to see them.
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
 * What the import did, per file.
 *
 * Deliberately not a toast. An Aurora save that imports with warnings is the **normal** case
 * — content moves upstream, a book gets renamed, a character keeps something from a source it
 * had switched off — and ADR 0005's "report it, don't guess" is worth nothing if the report
 * is gone in four seconds. It stays until dismissed, and it names counts rather than the
 * character's contents: these are somebody's personal files.
 */
function ImportReport({
  reports,
  onDismiss,
}: {
  reports: AuroraImportReport[];
  onDismiss: () => void;
}): React.JSX.Element {
  const failed = reports.filter((report) => !report.ok);
  const imported = reports.length - failed.length;

  return (
    <section className={`problem ${failed.length ? 'warning' : 'ok'}`}>
      <div className="library-head">
        <strong>
          {imported} of {reports.length} imported
          {failed.length > 0 && `, ${failed.length} refused`}
        </strong>
        <div className="row">
          <button type="button" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>

      <ul className="import-report">
        {reports.map((report) => (
          <li key={report.file}>
            <p className="card-meta">
              <code>{report.file}</code>
              {report.ok ? (
                <>
                  {' → '}
                  <code>{report.entry?.name}</code>
                  {` · ${report.embedded} elements embedded`}
                  {report.assetCount > 0 && ` · ${report.assetCount} asset(s)`}
                </>
              ) : (
                <span className="bad"> · not imported</span>
              )}
            </p>
            {report.message && <p className="card-note">{report.message}</p>}
            {report.unresolved.length > 0 && (
              <p className="card-note">
                {report.unresolved.length} item(s) this save uses are not in the content you have
                loaded. The character imported anyway and will be missing them — usually a
                disabled source, or a book this index does not carry.
              </p>
            )}
            {report.diagnostics.length > 0 && (
              <details className="card-note">
                <summary>
                  {report.diagnostics.length} note(s) from the import
                </summary>
                <ul>
                  {report.diagnostics.map((diagnostic, i) => (
                    <li key={i} className={diagnostic.level === 'error' ? 'error' : undefined}>
                      {diagnostic.message}
                      {diagnostic.count > 1 && ` (×${diagnostic.count})`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
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
      {/* "Needs no content sources to open" is ADR 0012: a save embeds every element it uses. */}
      <p className="hint">
        You do not need one to look around: content sources and the builder work without it, and
        a saved character opens without any content sources.
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
 * of a set of real saves carries a JPEG. Assuming PNG here handed the browser a blob
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
