/**
 * The print options step, before the platform's print dialog — ADR 0078.
 *
 * Renders `printOptionsView` (`packages/ui/src/print-options.ts`) and computes nothing: which parts are offered, their
 * labels, which one cannot be unticked and every sentence are decided there. Print hands the choices back and the shell
 * then opens the platform's dialog; Cancel, and Escape, close it and print nothing.
 */

import { useEffect, useRef } from 'react';

import type { PrintOptionsView, PrintPart } from '@incudo/ui';

export function PrintOptionsDialog({
  view,
  onPart,
  onPageNumbers,
  onRunningName,
  onPrint,
  onCancel,
}: {
  /** The step's view, or `null` while it is closed. */
  view: PrintOptionsView | null;
  onPart: (part: PrintPart, chosen: boolean) => void;
  onPageNumbers: (chosen: boolean) => void;
  onRunningName: (chosen: boolean) => void;
  onPrint: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const open = view !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="ask print-options"
      onCancel={(event) => {
        // Escape: closed by the shell, as Cancel is, so the dialog and the state cannot disagree.
        event.preventDefault();
        onCancel();
      }}
    >
      {view && (
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            onPrint();
          }}
        >
          <h2>{view.heading}</h2>
          <p className="lede">{view.lede}</p>
          {view.parts && (
            <fieldset>
              <legend>{view.parts.label}</legend>
              {view.parts.choices.map((choice) => (
                <label key={choice.part}>
                  <input
                    type="checkbox"
                    checked={choice.chosen}
                    disabled={choice.locked}
                    onChange={(event) => onPart(choice.part, event.target.checked)}
                  />
                  {choice.label}
                </label>
              ))}
            </fieldset>
          )}
          <fieldset>
            <label>
              <input type="checkbox" checked={view.pageNumbers.chosen} onChange={(event) => onPageNumbers(event.target.checked)} />
              {view.pageNumbers.label}
            </label>
            <label>
              <input type="checkbox" checked={view.runningName.chosen} onChange={(event) => onRunningName(event.target.checked)} />
              {view.runningName.label}
            </label>
          </fieldset>
          <div className="row">
            <button type="submit" className="on">
              Print…
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
