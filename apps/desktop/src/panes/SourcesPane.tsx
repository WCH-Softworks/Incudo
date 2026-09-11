/**
 * Adding a content source.
 *
 * ADR 0004's live-vs-downloaded question is not settled here: this loads an index over the
 * network and writes through to storage as it goes, which is the "download" half. The
 * enable/disable and streaming halves are ROADMAP Phase 2 and deliberately absent rather than
 * faked.
 */

import { useState } from 'react';
import { AURORA_LEGACY_INDEX, loadIndex, type LoadProgress, type LoadedContent } from '../content.ts';

export function SourcesPane({
  content,
  onLoaded,
}: {
  content: LoadedContent | null;
  onLoaded: (loaded: LoadedContent) => void;
}): React.JSX.Element {
  const [url, setUrl] = useState(AURORA_LEGACY_INDEX);
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    setBusy(true);
    setFailure(null);
    setProgress(null);
    try {
      onLoaded(await loadIndex(url, setProgress));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <main className="pane">
      <h2>Content sources</h2>
      <p className="lede">
        Incudo reads Aurora's content ecosystem as-is. Point it at an index and it loads every
        file that index references.
      </p>

      <div className="row">
        <input
          type="url"
          value={url}
          spellCheck={false}
          disabled={busy}
          onChange={(event) => setUrl(event.target.value)}
          aria-label="Index URL"
        />
        <button type="button" onClick={() => void load()} disabled={busy || !url.trim()}>
          {busy ? 'Loading…' : 'Load'}
        </button>
      </div>

      {progress && (
        <p className="progress">
          {progress.loaded} / {progress.total} — {progress.current}
        </p>
      )}

      {failure && (
        <div className="problem error">
          <strong>Could not load that index.</strong>
          <p>{failure}</p>
          <p className="hint">
            A browser `fetch` is subject to CORS, which is one of the reasons the desktop app is a
            Tauri shell rather than a web page — see <code>src/platform.ts</code>. Running under{' '}
            <code>npm run desktop:app</code> uses Tauri's HTTP plugin instead.
          </p>
        </div>
      )}

      {content && (
        <section className="result">
          <h3>Loaded</h3>
          <dl>
            <div>
              <dt>Elements</dt>
              <dd>{content.elementCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Files</dt>
              <dd>{content.fileCount}</dd>
            </div>
            <div>
              <dt>Warnings</dt>
              <dd>{content.warnings.length}</dd>
            </div>
            <div>
              <dt>Errors</dt>
              <dd>{content.errors.length}</dd>
            </div>
          </dl>

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
