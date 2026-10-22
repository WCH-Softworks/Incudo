import { contentLoadingView, type ContentLoadingPane, type ContentLoadProgress } from '@incudo/ui';

/**
 * Shown in place of Build or Browse while the system's sources load: what they would offer until it ends is whatever
 * was loaded before, or nothing. The words are `contentLoadingView`'s; this computes nothing.
 */
export function ContentLoading({
  pane,
  progress,
  startOptionsWaiting = false,
  onOpenSources,
}: {
  pane: ContentLoadingPane;
  progress: ContentLoadProgress | null;
  startOptionsWaiting?: boolean;
  onOpenSources: () => void;
}): React.JSX.Element {
  const view = contentLoadingView(pane, progress, startOptionsWaiting);
  return (
    <main className="pane content-loading" aria-busy="true">
      <h2>{view.heading}</h2>
      <p className="progress" role="status">
        {view.progress}
      </p>
      <p className="lede">{view.note}</p>
      <div className="row">
        <button type="button" onClick={onOpenSources}>
          Go to Sources
        </button>
      </div>
    </main>
  );
}
