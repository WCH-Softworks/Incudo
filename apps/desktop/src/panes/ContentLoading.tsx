import { useEffect, useState } from 'react';

import {
  contentLoadFailedView,
  contentLoadingView,
  contentLoadStallNote,
  type ContentLoadingPane,
  type ContentLoadProgress,
} from '@incudo/ui';

/**
 * Shown in place of Build or Browse while the system's sources load: what they would offer until it ends is whatever
 * was loaded before, or nothing. With `failed`, the load has ended and left nothing, and the panel says why. The words
 * are `content-loading.ts`'s; this computes nothing but how long it has been since the progress last moved.
 */
export function ContentLoading({
  pane,
  progress,
  startOptionsWaiting = false,
  failed,
  onOpenSources,
}: {
  pane: ContentLoadingPane;
  progress: ContentLoadProgress | null;
  startOptionsWaiting?: boolean;
  /** Present when the load has ended with nothing loaded: what went wrong, if anything says. */
  failed?: { note: string | undefined };
  onOpenSources: () => void;
}): React.JSX.Element {
  const stalled = useSecondsSince(failed ? null : `${progress?.source}|${progress?.loaded}|${progress?.current}`);
  const view = failed ? contentLoadFailedView(failed.note) : contentLoadingView(pane, progress, startOptionsWaiting);
  const stall = failed ? undefined : contentLoadStallNote(stalled);
  return (
    <main className="pane content-loading" aria-busy={failed ? undefined : true}>
      <h2>{view.heading}</h2>
      <p className={failed ? 'problem error' : 'progress'} role="status">
        {view.progress}
      </p>
      {stall && <p className="problem warning">{stall}</p>}
      <p className="lede">{view.note}</p>
      <div className="row">
        <button type="button" onClick={onOpenSources}>
          Go to Sources
        </button>
      </div>
    </main>
  );
}

/** Seconds since `key` last changed, ticking once a second; 0 while `key` is null. */
function useSecondsSince(key: string | null): number {
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const start = Date.now();
    setSince(start);
    setNow(start);
    if (key === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [key]);
  return key === null ? 0 : (now - since) / 1000;
}
