/**
 * The update dialog — ADR 0133. Draws `updateDialog`'s view and computes nothing: what it says and which buttons it
 * offers are `packages/ui/src/app-update.ts`'s. Escape is "Not now" or "Close", and does nothing while a check or an
 * install runs, which has no button to stop it.
 */

import { useEffect, useRef } from 'react';
import type { UpdateAction, UpdateDialogView } from '@incudo/ui';

export function UpdateDialog({
  view,
  onAction,
  onOpenLink,
}: {
  view: UpdateDialogView | null;
  onAction: (action: UpdateAction) => void;
  onOpenLink: (url: string) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (view && !dialog.open) dialog.showModal();
    if (!view && dialog.open) dialog.close();
  }, [view]);

  const dismiss = view?.buttons.find((button) => button.action === 'later' || button.action === 'close');

  return (
    <dialog
      ref={ref}
      className="ask"
      aria-busy={view !== null && view.buttons.length === 0}
      onCancel={(event) => {
        // The browser would close the dialog itself and leave the state saying it is open.
        event.preventDefault();
        if (dismiss) onAction(dismiss.action);
      }}
    >
      {view && (
        <>
          <h2>{view.title}</h2>
          <p className="lede">{view.lede}</p>
          {view.notes.map((note) => (
            <p key={note} className="hint">
              {note}
            </p>
          ))}
          {view.link && (
            <p>
              <a
                href={view.link.url}
                onClick={(event) => {
                  // The window would follow the link itself and replace the app with the page.
                  event.preventDefault();
                  onOpenLink(view.link!.url);
                }}
              >
                {view.link.label}
              </a>
            </p>
          )}
          {view.progress && (
            <div>
              <progress max={1} value={view.progress.fraction} aria-label={view.progress.text} />
              <p className="card-meta">{view.progress.text}</p>
            </div>
          )}
          {view.buttons.length > 0 && (
            <div className="row">
              {view.buttons.map((button, index) => (
                <button
                  key={button.action}
                  type="button"
                  className={index === 0 ? 'on' : ''}
                  autoFocus={index === 0}
                  onClick={() => onAction(button.action)}
                >
                  {button.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </dialog>
  );
}
