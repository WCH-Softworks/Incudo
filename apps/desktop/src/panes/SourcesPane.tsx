/**
 * Content sources: add, name, remove, enable, stream or download, and check for updates.
 *
 * ADR 0004 designed all of this and the app shipped a single text box. ADR 0028 says what the
 * list *is* — the user's profile, which no character depends on — and ADR 0029 says what the
 * cache does underneath. This renders that and holds no policy of its own.
 *
 * Adding a source is a thing you come here and do. It is not a toll gate: the library screen
 * works with this list empty, which is the whole point of ADR 0012.
 *
 * ADR 0031 added two things. A source now belongs to a **system**, because nothing in a content
 * index says which game it is for and the app must not guess; the list here is this system's,
 * and sources belonging to another are counted rather than hidden. And the system definition
 * may **suggest** indexes, so the first thing a new user meets is a list to pick from instead
 * of an empty URL box — which is also how the tagging stays invisible in the common case.
 */

import { useState } from 'react';
import type { ConfiguredSource, RefreshReport, SourceMode, UpdateStatus } from '@incudo/content';
import type { GameSystem, SuggestedSource } from '@incudo/core';

import { type LoadProgress, type LoadedContent } from '../content.ts';

export interface SourcesActions {
  add: (url: string, mode: SourceMode, options?: Partial<ConfiguredSource>) => Promise<void>;
  /** Claim an untagged source for the system in view — ADR 0031. */
  assignToSystem: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  setMode: (id: string, mode: SourceMode) => Promise<void>;
  checkForUpdates: (id: string) => Promise<void>;
  refresh: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function SourcesPane({
  system,
  sources,
  unassigned,
  others,
  content,
  progress,
  busy,
  updates,
  refreshes,
  actions,
  shell,
}: {
  system: GameSystem;
  /** This system's sources. */
  sources: readonly ConfiguredSource[];
  /** Sources belonging to no system yet — offered, never hidden. */
  unassigned: readonly ConfiguredSource[];
  /**
   * Sources belonging to other systems. Not editable here, but not invisible either: a source
   * is keyed on its URL, so an index configured elsewhere cannot also be added here, and this
   * screen has to be able to say so rather than appearing to do nothing.
   */
  others: readonly ConfiguredSource[];
  content: LoadedContent | null;
  progress: LoadProgress | null;
  busy: boolean;
  updates: Record<string, UpdateStatus>;
  /** What the last refresh of each source did, or why it failed. */
  refreshes: Record<string, RefreshReport | { failed: string }>;
  actions: SourcesActions;
  shell: 'tauri' | 'browser';
}): React.JSX.Element {
  // Every URL the profile already holds, whatever system it is under. Offering "Add" for one
  // of these is what the running app showed: the same index appearing as a suggestion and as
  // an unassigned source, with an Add button that would have retagged it in place.
  const configured = new Map(
    [...sources, ...unassigned, ...others].map((source) => [source.url, source]),
  );
  const suggestions = (system.suggestedSources ?? []).map((suggestion) => ({
    suggestion,
    already: configured.get(suggestion.url),
  }));
  const offerable = suggestions.filter((entry) => entry.already === undefined);
  // Only a suggestion held by *another* system. One already configured here is simply
  // configured, and one held by nobody is offered above.
  const elsewhere = suggestions.filter(
    (entry) =>
      entry.already?.systemId !== undefined && entry.already.systemId !== system.id,
  );
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<SourceMode>('stream');
  const [failure, setFailure] = useState<string | null>(null);

  async function add(target: string, options?: Partial<ConfiguredSource>): Promise<void> {
    setFailure(null);
    try {
      await actions.add(target.trim(), mode, options);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }

  const loadedById = new Map((content?.sources ?? []).map((source) => [source.id, source]));

  return (
    <main className="pane">
      <h2>Content sources for {system.name}</h2>
      <p className="lede">
        Incudo reads Aurora's content ecosystem as-is. Point it at an index and it loads every
        file that index references. You need one of these to <em>build</em> a character; you
        never need one to <em>open</em> a saved one.
      </p>
      <p className="hint">
        A source belongs to the system you add it under. Nothing in an index says which game it
        is for — an Aurora <code>.index</code> has no field for one — so Incudo records what you
        said rather than guessing (ADR 0031).
        {others.length > 0 && ` ${others.length} source(s) belong to other systems and are not shown here.`}
      </p>

      {offerable.length > 0 && (
        <>
          <h3>Suggested for {system.name}</h3>
          <ul className="suggestions">
            {offerable.map(({ suggestion }) => (
              <li key={suggestion.url}>
                <Suggestion
                  suggestion={suggestion}
                  systemName={system.name}
                  busy={busy}
                  onAdd={() =>
                    void add(suggestion.url, {
                      name: suggestion.name,
                      official: suggestion.official,
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {/*
        A suggestion this system cannot take, because the profile is keyed on the URL and
        another system already holds it. Said out loud: an Add button that silently moved the
        source out from under the other system would be the quiet destructive thing.
      */}
      {elsewhere.length > 0 && (
        <p className="hint">
          {elsewhere
            .map(({ suggestion, already }) => `${suggestion.name} (configured for ${already!.systemId})`)
            .join(', ')}{' '}
          — suggested for {system.name}, but a source is identified by its URL, so it can only
          belong to one system at a time.
        </p>
      )}

      <h3>Add a source by URL</h3>
      <div className="row">
        <input
          type="url"
          value={url}
          spellCheck={false}
          disabled={busy}
          placeholder="https://example.com/content.index"
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
        <button type="button" onClick={() => void add(url)} disabled={busy || !url.trim()}>
          {busy ? 'Loading…' : 'Add'}
        </button>
      </div>
      {/* The two modes differ only in when (ADR 0029). This used to promise lazy per-file loading;
          ADR 0051 measured it and declined it, since a build is offered choices from half the corpus. */}
      <p className="hint">
        <strong>Download</strong> fetches everything now and keeps it, so the source works
        offline from here on. <strong>Stream</strong> fetches when the source is first used and
        keeps it the same way, so it is offline after that too. Both fetch every file the
        source lists, because building a character offers choices from all of them. Nothing is
        fetched again until you ask.
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

      <h3>Configured for {system.name}</h3>
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
              refreshed={refreshes[source.id]}
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

      {/*
        Sources from before ADR 0031, which recorded no system. Counting them as this one's
        would put another game's content into a character and freeze it there when the save is
        written (ADR 0012), so they are a question rather than an assumption — and a visible
        one, because a source that silently stopped loading is the worse failure.
      */}
      {unassigned.length > 0 && (
        <section className="warn">
          <h3>Not assigned to a system</h3>
          <p>
            These were added before Incudo asked which system a source serves, so it does not
            know — and will not guess. They load for nothing until you say.
          </p>
          <ul className="sources">
            {unassigned.map((source) => (
              <li key={source.id}>
                <article className="source">
                  <p className="card-meta">
                    <strong>{source.name}</strong> — <code>{source.url}</code>
                  </p>
                  <div className="row">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void actions.assignToSystem(source.id)}
                    >
                      This is {system.name} content
                    </button>
                    <button type="button" disabled={busy} onClick={() => void actions.remove(source.id)}>
                      Remove
                    </button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </section>
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

/**
 * One index the system definition points at.
 *
 * The badge says *who* is vouching, not that Incudo checked anything: `official` is a claim a
 * system definition's author writes about their own suggestion, and a user-authored system can
 * write it too (ADR 0031). It says nothing about the content's licence or affiliation — these
 * point at other people's projects (ADR 0010).
 */
function Suggestion({
  suggestion,
  systemName,
  busy,
  onAdd,
}: {
  suggestion: SuggestedSource;
  systemName: string;
  busy: boolean;
  onAdd: () => void;
}): React.JSX.Element {
  return (
    <article className="source suggestion">
      <p className="card-meta">
        <strong>{suggestion.name}</strong>
        {suggestion.official && (
          <span className="badge" title={`Vouched for by the ${systemName} system definition`}>
            official
          </span>
        )}
      </p>
      {suggestion.description && <p className="card-note">{suggestion.description}</p>}
      <p className="card-meta">
        <code>{suggestion.url}</code>
      </p>
      <div className="row">
        <button type="button" onClick={onAdd} disabled={busy}>
          {busy ? 'Loading…' : 'Add'}
        </button>
      </div>
    </article>
  );
}

function SourceRow({
  source,
  loaded,
  update,
  refreshed,
  busy,
  actions,
}: {
  source: ConfiguredSource;
  loaded: { fileCount: number; elementCount: number; failed?: string } | undefined;
  update: UpdateStatus | undefined;
  refreshed: RefreshReport | { failed: string } | undefined;
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
      {refreshed && <RefreshNote report={refreshed} />}

      <div className="row">
        <button type="button" onClick={() => void actions.checkForUpdates(source.id)} disabled={busy}>
          Check for updates
        </button>
        <button
          type="button"
          onClick={() => void actions.refresh(source.id)}
          disabled={busy}
          title="Fetch this source again. Anything that cannot be reached keeps its saved copy."
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
  const unreached =
    status.state !== 'unknown' && status.unanswered ? ` ${status.unanswered} could not be reached.` : '';
  if (status.state === 'current') {
    if (status.basis === 'files') {
      return <p className="card-note">Up to date: none of {status.checked} files has changed.{unreached}</p>;
    }
    return (
      <p className="card-note">
        The index still says {status.version ?? 'the same version'}. Only the index version could be compared
        here, and a source can change without it moving.
      </p>
    );
  }
  if (status.state === 'outdated') {
    if (status.basis === 'files') {
      return (
        <p className="card-note">
          Updated upstream: {status.changed} of {status.checked} files have changed.{unreached}{' '}
          <strong>Refresh</strong> fetches them.
        </p>
      );
    }
    return (
      <p className="card-note">
        Updated upstream: you have {status.local ?? 'an unknown version'}, the index now says{' '}
        {status.remote ?? 'something newer'}. <strong>Refresh</strong> fetches it.
      </p>
    );
  }
  return <p className="card-note">Could not tell: {status.reason}</p>;
}

/** What a refresh did, in numbers the user can check against what they expected. */
function RefreshNote({ report }: { report: RefreshReport | { failed: string } }): React.JSX.Element {
  if ('failed' in report) {
    return <p className="card-note">Refresh failed, and the saved copy was left as it was: {report.failed}</p>;
  }
  const parts = [`${report.fetched} downloaded`];
  if (report.unchanged) parts.push(`${report.unchanged} unchanged`);
  if (report.removed) parts.push(`${report.removed} no longer listed and removed`);
  return (
    <>
      <p className="card-note">Refreshed: {parts.join(', ')}.</p>
      {report.kept.length > 0 && (
        <details className="card-note">
          <summary>
            {report.kept.length} {report.kept.length === 1 ? 'file' : 'files'} could not be reached, so the saved
            copy was kept
          </summary>
          <ul>
            {report.kept.map((file) => (
              <li key={file.url}>
                <code>{file.url}</code>: {file.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
