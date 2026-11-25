/**
 * "Change to Legendary Creature?" — what a library card's Change kind… asks before the character on screen becomes
 * another kind (ADR 0134).
 *
 * Renders `convertUnticking` and computes nothing: what is lost, what changes, which numbers could be typed and which
 * picks kept as added elements are the ui package's, and so is every sentence. Its boxes start ticked; unticking one asks
 * the conversion again without it. Cancel, and Escape, change nothing. The button hands the converted character to the
 * shell, which puts it on screen as an unsaved edit: the library file changes only on Save.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { Character, ElementId, ElementIndex, GameSystem, StatKey } from '@incudo/core';
import {
  CONVERSION_ADDITIONS_HEADING,
  CONVERSION_COPIES_HEADING,
  CONVERSION_UNSAVED_NOTE,
  conversionPrompt,
  convertUnticking,
  copyLine,
  kindConversionTargets,
} from '@incudo/ui';

export function ConvertKindDialog({
  open,
  character,
  system,
  elements,
  onConvert,
  onCancel,
}: {
  open: boolean;
  character: Character;
  system: GameSystem;
  elements: ElementIndex;
  onConvert: (converted: Character) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const targets = useMemo(() => kindConversionTargets(system, character.kind), [system, character.kind]);
  const [to, setTo] = useState<string | undefined>(undefined);
  const [skipCopies, setSkipCopies] = useState<StatKey[]>([]);
  const [skipAdditions, setSkipAdditions] = useState<ElementId[]>([]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setTo(targets[0]?.id);
      setSkipCopies([]);
      setSkipAdditions([]);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
    // Read once as it opens: a repaint behind the dialog must not reset what the user chose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const conversion = useMemo(
    () => (open && to ? convertUnticking(character, system, to, elements, { copies: skipCopies, additions: skipAdditions }) : undefined),
    [open, to, character, system, elements, skipCopies, skipAdditions],
  );
  const prompt = conversion ? conversionPrompt(conversion, character.name) : undefined;

  const toggle = <T,>(list: T[], item: T, ticked: boolean): T[] => (ticked ? list.filter((x) => x !== item) : [...list, item]);

  return (
    <dialog
      ref={ref}
      className="ask convert-kind"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      {open && conversion && prompt && (
        <form
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault();
            onConvert(conversion.character);
          }}
        >
          <h2>{prompt.title}</h2>
          {targets.length > 1 && (
            <label className="convert-target">
              Change to{' '}
              <select value={to} onChange={(event) => setTo(event.target.value)}>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="lede">{prompt.lead}</p>
          {conversion.lost.map((group) => (
            <section key={group.heading}>
              <h3>{group.heading}</h3>
              <ul>
                {group.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
          {conversion.copies.length > 0 && (
            <fieldset>
              <legend>{CONVERSION_COPIES_HEADING}</legend>
              {conversion.copies.map((copy) => (
                <label key={copy.stat}>
                  <input
                    type="checkbox"
                    checked={copy.copied}
                    onChange={(event) => setSkipCopies((list) => toggle(list, copy.stat, event.target.checked))}
                  />
                  {copyLine(copy)}
                </label>
              ))}
            </fieldset>
          )}
          {conversion.additions.length > 0 && (
            <fieldset>
              <legend>{CONVERSION_ADDITIONS_HEADING}</legend>
              {conversion.additions.map((addition) => (
                <label key={addition.elementId}>
                  <input
                    type="checkbox"
                    checked={addition.added}
                    onChange={(event) => setSkipAdditions((list) => toggle(list, addition.elementId, event.target.checked))}
                  />
                  {addition.name} <span className="hint">({addition.from})</span>
                </label>
              ))}
            </fieldset>
          )}
          {conversion.changed.length > 0 && (
            <section>
              <h3>Changed</h3>
              <ul>
                {conversion.changed.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>
          )}
          <p className="hint">{CONVERSION_UNSAVED_NOTE}</p>
          <div className="row">
            <button type="submit" className="on">
              {prompt.confirm}
            </button>
            <button type="button" onClick={onCancel} autoFocus>
              Cancel
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
