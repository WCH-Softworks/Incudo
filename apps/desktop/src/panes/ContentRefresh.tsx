/**
 * "Your sources have changed…": the line that offers a refresh, and the review that shows what it would change — ADR
 * 0082.
 *
 * Both render what `packages/ui/src/content-refresh.ts` decides and compute nothing: when to offer, every sentence, and
 * what the Sheet would show differently. Nothing changes until Refresh is pressed, and then only the character on screen;
 * its file changes on Save.
 */

import { useEffect, useRef } from 'react';

import type { RefreshReview } from '@incudo/ui';

/** The offer, under a pane's bar, while the open character's copies differ from what its sources load. */
export function RefreshLine({ notice, onReview, onDismiss }: { notice: string; onReview: () => void; onDismiss: () => void }): React.JSX.Element {
  return (
    <p className="problem warning refresh-line">
      {notice}{' '}
      <button type="button" className="link" onClick={onReview}>
        Review…
      </button>
      {' · '}
      <button type="button" className="link" onClick={onDismiss}>
        Not now
      </button>
    </p>
  );
}

export function RefreshDialog({
  review,
  onRefresh,
  onClose,
}: {
  /** The review, or `null` while it is closed. */
  review: RefreshReview | null;
  onRefresh: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const open = review !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="ask content-refresh"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {review && (
        <>
          <h2>{review.heading}</h2>
          <p>{review.lede}</p>
          {review.sameSheet && <p>{review.sameSheet}</p>}
          {review.rows.length > 0 && (
            <>
              <h3>On the Sheet</h3>
              <ul>
                {review.rows.map((row) => (
                  <li key={`${row.section}/${row.label}`}>
                    {row.section} · {row.label}: {row.before} → {row.after}
                  </li>
                ))}
              </ul>
            </>
          )}
          {review.listed.length > 0 && (
            <>
              <h3>Listed on the Sheet</h3>
              <ul>
                {review.listed.map((item) => (
                  <li key={`${item.section}/${item.name}/${item.change}`}>
                    {item.section} · {item.change === 'added' ? 'adds' : 'no longer lists'} {item.name}
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3>Changed in your sources</h3>
          <p>{review.changed.join(', ')}</p>
          {review.kept.length > 0 && (
            <>
              <h3>Kept as saved, since your sources do not have them</h3>
              <p>{review.kept.join(', ')}</p>
            </>
          )}
          <div className="row">
            <button type="button" className="on" onClick={onRefresh}>
              {review.refresh}
            </button>
            <button type="button" onClick={onClose}>
              {review.notNow}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
