/**
 * The sets a system asks when a character is started (ADR 0123): campaign options, which shape what everything after them
 * offers. Opened by New character once the character exists, ticked as the step's `initial` wrote it, and again from the
 * options' line among the choices already made.
 *
 * Renders `BuilderState.startOptions` and computes nothing: what each set offers and holds is the builder's, and every
 * sentence is `build-view.ts`'s. Its button writes each set whole through `chooseAtStart`; Cancel, and Escape, change
 * nothing, which after New character leaves the defaults.
 */

import { useEffect, useRef, useState } from 'react';

import type { ElementId } from '@incudo/core';
import {
  START_OPTIONS_BEGIN,
  START_OPTIONS_HINT,
  START_OPTIONS_SAVE,
  type CharacterBuilder,
  type StartOptionsQuestion,
} from '@incudo/ui';

export function StartOptionsDialog({
  open,
  beginning,
  questions,
  builder,
  candidateLabel,
  onClose,
}: {
  open: boolean;
  /** Opened by New character, so its button starts the build rather than closing an edit. */
  beginning: boolean;
  questions: readonly StartOptionsQuestion[];
  builder: CharacterBuilder;
  candidateLabel: (id: ElementId) => string;
  onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  // What is ticked, per step, until the button writes it: Cancel leaves the character as it was.
  const [draft, setDraft] = useState<Record<string, ElementId[]>>({});

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setDraft(Object.fromEntries(questions.map((question) => [question.stepId, [...question.chosen]])));
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
    // Read once as it opens: a repaint behind the dialog must not untick what the user ticked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (stepId: string, id: ElementId, chosen: boolean): void =>
    setDraft((current) => {
      const held = current[stepId] ?? [];
      return { ...current, [stepId]: chosen ? [...held.filter((other) => other !== id), id] : held.filter((other) => other !== id) };
    });

  return (
    <dialog
      ref={ref}
      className="ask start-options"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open && (
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            for (const question of questions) builder.chooseAtStart(question.stepId, draft[question.stepId] ?? []);
            onClose();
          }}
        >
          {questions.map((question) => (
            <fieldset key={question.stepId}>
              <legend>{question.label}</legend>
              {question.description && <p className="hint">{question.description}</p>}
              {question.candidates.map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={(draft[question.stepId] ?? []).includes(id)}
                    onChange={(event) => toggle(question.stepId, id, event.target.checked)}
                  />
                  {candidateLabel(id)}
                </label>
              ))}
            </fieldset>
          ))}
          <p className="hint">{START_OPTIONS_HINT}</p>
          <div className="row">
            <button type="submit" className="on">
              {beginning ? START_OPTIONS_BEGIN : START_OPTIONS_SAVE}
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
