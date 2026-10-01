/**
 * The print options step, before the platform's print dialog (ADR 0078) or a PDF written with no dialog (ADR 0079).
 *
 * Renders `printOptionsView` (`packages/ui/src/print-options.ts`) and computes nothing: which parts are offered, their
 * labels, which one cannot be unticked, whether a paper is offered and every sentence are decided there. Its button hands
 * the choices back and the shell then opens the platform's dialog or writes the PDF; Cancel, and Escape, close it and do
 * nothing.
 */

import { useEffect, useRef } from 'react';

import type { Paper, PrintOptionsView, PrintPart } from '@incudo/ui';

export function PrintOptionsDialog({
  view,
  onPart,
  onPageNumbers,
  onRunningName,
  onPaper,
  onPrint,
  onCancel,
}: {
  /** The step's view, or `null` while it is closed. */
  view: PrintOptionsView | null;
  onPart: (part: PrintPart, chosen: boolean) => void;
  onPageNumbers: (chosen: boolean) => void;
  onRunningName: (chosen: boolean) => void;
  onPaper: (paper: Paper) => void;
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
          {view.paper && (
            <fieldset>
              <legend>{view.paper.label}</legend>
              {view.paper.choices.map((choice) => (
                <label key={choice.paper}>
                  <input type="radio" name="paper" checked={choice.chosen} onChange={() => onPaper(choice.paper)} />
                  {choice.label}
                </label>
              ))}
            </fieldset>
          )}
          <div className="row">
            <button type="submit" className="on">
              {view.submit}
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
