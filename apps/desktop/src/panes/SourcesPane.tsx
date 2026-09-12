/**
 * Content sources: add, name, remove, enable, stream or download, and check for updates.
 *
 * ADR 0004 designed all of this and the app shipped a single text box. ADR 0028 says what the
 * list *is* — the user's profile, which no character depends on — and ADR 0029 says what the
 * cache does underneath. This renders that and holds no policy of its own.
 *
 * Adding a source is a thing you come here and do. It is not a toll gate: the library screen
 * works with this list empty, which is the whole point of ADR 0012.
 */

import { useState } from 'react';
import type { ConfiguredSource, SourceMode, UpdateStatus } from '@incudo/content';

import { AURORA_LEGACY_INDEX, type LoadProgress, type LoadedContent } from '../content.ts';

export interface SourcesActions {
  add: (url: string, mode: SourceMode) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  setMode: (id: string, mode: SourceMode) => Promise<void>;
  checkForUpdates: (id: string) => Promise<void>;
  refresh: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function SourcesPane({
  sources,
  content,
  progress,
  busy,
  updates,
  actions,
  shell,
}: {
  sources: readonly ConfiguredSource[];
  content: LoadedContent | null;
  progress: LoadProgress | null;
  busy: boolean;
  updates: Record<string, UpdateStatus>;
  actions: SourcesActions;
  shell: 'tauri' | 'browser';
}): React.JSX.Element {
  const [url, setUrl] = useState(AURORA_LEGACY_INDEX);
  const [mode, setMode] = useState<SourceMode>('stream');
  const [failure, setFailure] = useState<string | null>(null);

  async function add(): Promise<void> {
    setFailure(null);
    try {
      await actions.add(url.trim(), mode);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }

  const loadedById = new Map((content?.sources ?? []).map((source) => [source.id, source]));

  return (
    <main className="pane">
      <h2>Content sources</h2>
      <p className="lede">
        Incudo reads Aurora's content ecosystem as-is. Point it at an index and it loads every
        file that index references. You need one of these to <em>build</em> a character; you
        never need one to <em>open</em> a saved one.
      </p>

      <h3>Add a source</h3>
      <div className="row">
        <input
          type="url"
          value={url}
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setUrl(event.target.value)}
          aria-label="Index URL"
        />
        <select
          value={mode}
          disabled={busy}
          aria-label="Stream or download"
          onChange={(event) => setMode(event.target.value as SourceMode)}
        >
          <option value="stream">Stream</option>
          <option value="download">Download</option>
        </select>
        <button type="button" onClick={() => void add()} disabled={busy || !url.trim()}>
          {busy ? 'Loading…' : 'Add'}
        </button>
      </div>
      <p className="hint">
        <strong>Download</strong> fetches everything now and keeps it, so the source works
        offline from here on. <strong>Stream</strong> fetches when the source is first used and
        writes through to the same cache, so it is offline after that too. Either way nothing
        is re-fetched until you ask — see ADR 0029, which is also honest about the lazy
        per-file loading that would make the difference bigger and does not exist yet.
      </p>

      {progress && (
        <p className="progress">
          {progress.source}: {progress.loaded} / {progress.total} — {progress.current}
        </p>
      )}

      {failure && (
        <div className="problem error">
          <strong>Could not load that index.</strong>
          <p>{failure}</p>
          {shell === 'browser' && (
            <p className="hint">
              A browser <code>fetch</code> is subject to CORS, which is one of the reasons the
              desktop app is a Tauri shell rather than a web page. Running under{' '}
              <code>npm run desktop:app</code> uses Tauri's HTTP plugin instead, which is not.
            </p>
          )}
        </div>
      )}

      <h3>Configured</h3>
      {sources.length === 0 && (
        <p className="lede">
          None yet. Your characters still open — a save carries the content it uses (ADR 0012).
        </p>
      )}

      <ul className="sources">
        {sources.map((source) => (
          <li key={source.id}>
            <SourceRow
              source={source}
              loaded={loadedById.get(source.id)}
              update={updates[source.id]}
              busy={busy}
              actions={actions}
            />
          </li>
        ))}
      </ul>

      {sources.length > 0 && (
        <div className="row">
          <button type="button" onClick={() => void actions.reload()} disabled={busy}>
            {busy ? 'Loading…' : 'Reload enabled sources'}
          </button>
        </div>
      )}

      {content && (content.errors.length > 0 || content.warnings.length > 0) && (
        <section className="result">
          <h3>What the last load said</h3>
          {content.errors.length > 0 && (
            <details>
              <summary>{content.errors.length} error(s)</summary>
              <ul>
                {content.errors.slice(0, 50).map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            </details>
          )}
          {content.warnings.length > 0 && (
            <details>
              <summary>{content.warnings.length} warning(s)</summary>
              <ul>
                {content.warnings.slice(0, 50).map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </main>
  );
}

function SourceRow({
  source,
  loaded,
  update,
  busy,
  actions,
}: {
  source: ConfiguredSource;
  loaded: { fileCount: number; elementCount: number; failed?: string } | undefined;
  update: UpdateStatus | undefined;
  busy: boolean;
  actions: SourcesActions;
}): React.JSX.Element {
  const [name, setName] = useState(source.name);

  return (
    <article className="source">
      <div className="source-head">
        <input
          value={name}
          aria-label={`Name for ${source.url}`}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => name !== source.name && void actions.rename(source.id, name)}
        />
        <label className="toggle">
          <input
            type="checkbox"
            checked={source.enabled}
            onChange={(event) => void actions.setEnabled(source.id, event.target.checked)}
          />
          Enabled
        </label>
        <select
          value={source.mode}
          aria-label={`Mode for ${source.name}`}
          onChange={(event) => void actions.setMode(source.id, event.target.value as SourceMode)}
        >
          <option value="stream">Stream</option>
          <option value="download">Download</option>
        </select>
      </div>

      <p className="card-meta">
        <code>{source.url}</code>
      </p>
      <p className="card-meta">
        {source.version ? `version ${source.version}` : 'no version declared'}
        {/* What it contributes, which is the question "see what each source contributes" asks. */}
        {loaded && !loaded.failed
          ? ` · ${loaded.elementCount.toLocaleString()} elements from ${loaded.fileCount} files`
          : loaded?.failed
            ? ' · did not load'
            : ' · not loaded in this session'}
      </p>

      {update && <UpdateNote status={update} />}

      <div className="row">
        <button type="button" onClick={() => void actions.checkForUpdates(source.id)} disabled={busy}>
          Check for updates
        </button>
        <button
          type="button"
          onClick={() => void actions.refresh(source.id)}
          disabled={busy}
          title="Throw away this source's cached copy and fetch it again"
        >
          Refresh
        </button>
        <button type="button" onClick={() => void actions.remove(source.id)} disabled={busy}>
          Remove
        </button>
      </div>
    </article>
  );
}

/** Reporting, never acting. A check that quietly refreshed would be the silent update ADR 0012 refuses. */
function UpdateNote({ status }: { status: UpdateStatus }): React.JSX.Element {
  if (status.state === 'current') {
    return <p className="card-note">Up to date{status.version ? ` at ${status.version}` : ''}.</p>;
  }
  if (status.state === 'outdated') {
    return (
      <p className="card-note">
        Updated upstream: you have {status.local ?? 'an unknown version'}, the index now says{' '}
        {status.remote ?? 'something newer'}. <strong>Refresh</strong> fetches it.
      </p>
    );
  }
  return <p className="card-note">Could not tell: {status.reason}</p>;
}
