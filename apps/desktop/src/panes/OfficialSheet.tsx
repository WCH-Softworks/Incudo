/**
 * The "Fill the official sheet" step — ADR 0079 decision 3.
 *
 * Renders `officialSheetView` (`packages/ui/src/official-sheet.ts`) and computes nothing: every sentence, which buttons
 * are offered and when filling is possible are decided there. The download page is shown as text to copy, with a button
 * that copies it: the Tauri window has no way yet to open a page in the user's browser, and Incudo never fetches the form
 * itself. Escape and Close close it and do nothing.
 */

import { useEffect, useRef, useState } from 'react';

import type { OfficialSheetView } from '@incudo/ui';

export function OfficialSheetDialog({
  view,
  busy,
  onChoose,
  onRemove,
  onFill,
  onClose,
}: {
  /** The step's view, or `null` while it is closed. */
  view: OfficialSheetView | null;
  /** A copy is being read or a sheet filled: every button waits. */
  busy: boolean;
  onChoose: () => void;
  onRemove: () => void;
  onFill: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const open = view !== null;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) setCopied(false);
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="ask official-sheet"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {view && (
        <>
          <h2>{view.heading}</h2>
          {view.lede.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="official-download">
            {view.download.label}: <code>{view.download.url}</code>{' '}
            <button
              type="button"
              className="link"
              onClick={() => {
                void navigator.clipboard?.writeText(view.download.url).then(() => setCopied(true), () => setCopied(false));
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </p>
          <p>
            {view.copy}{' '}
            <button type="button" className="link" disabled={busy} onClick={onChoose}>
              {view.choose}
            </button>
            {view.remove && (
              <>
                {' · '}
                <button type="button" className="link" disabled={busy} onClick={onRemove}>
                  {view.remove}
                </button>
              </>
            )}
          </p>
          {view.problem && <p className="problem warning">{view.problem}</p>}
          <div className="row">
            <button type="button" className="on" disabled={busy || !view.fill.enabled} onClick={onFill}>
              {view.fill.label}
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
