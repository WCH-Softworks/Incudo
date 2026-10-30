/**
 * A candidate's sanitized description, or a plain note that it has none. What the description embeds is put in place
 * from the same index it is read from (`expandDescription`, ADR 0069) before it is sanitized.
 *
 * An element that makes an attack is headed by what it states of the attack, its damage, other dice, range and
 * properties (`statedAttackLines`): most weapons write no description, and their preview named no die.
 *
 * After it, what the element asks the character to choose (`elementChoices`): a description often says its options
 * are "detailed below", and they are the choice's options, not text.
 */

import { createContext, useContext, useMemo, useState } from 'react';
import { statedAttack, type AttacksDef, type ElementId, type ElementIndex } from '@incudo/core';
import {
  ELEMENT_CHOICES_LABEL,
  elementChoiceLine,
  elementChoices,
  expandDescription,
  statedAttackLines,
  type ElementChoiceOption,
} from '@incudo/ui';

import { sanitizeDescriptionHtml } from '../sanitize-html.ts';

/** The kind's attacks declaration, for the lines a weapon's preview leads with. Absent where nothing provides one. */
export const AttacksContext = createContext<AttacksDef | undefined>(undefined);

export function CandidateDescription({
  id,
  elements,
  onSelect,
}: {
  id: ElementId;
  elements: ElementIndex;
  /** Where an option's name leads, when the screen can show another element (Browse). */
  onSelect?: (id: ElementId) => void;
}): React.JSX.Element {
  const element = elements.get(id);
  const attacks = useContext(AttacksContext);
  const html = useMemo(
    () => (element?.description ? sanitizeDescriptionHtml(expandDescription(element, elements)) : undefined),
    [element, elements],
  );
  const facts = useMemo(() => (element ? statedAttackLines(statedAttack(element, attacks, elements)) : []), [element, attacks, elements]);
  const choices = useMemo(() => (element ? elementChoices(element, elements) : []), [element, elements]);
  // Content's own empty paragraph (`<p></p>`, every weapon) is no description.
  const described = html !== undefined && html.replace(/<[^>]*>/g, '').trim() !== '';
  return (
    <>
      {facts.length > 0 && (
        <ul className="picker-facts">
          {facts.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {described ? (
        <div className="picker-description" dangerouslySetInnerHTML={{ __html: html! }} />
      ) : facts.length === 0 ? (
        <p className="hint">No description available.</p>
      ) : null}
      {choices.length > 0 && (
        <section className="element-choices">
          <h4>{ELEMENT_CHOICES_LABEL}</h4>
          {choices.map((choice, at) => (
            <div key={`${id}/${at}`}>
              <p>
                <strong>{choice.label}.</strong> {elementChoiceLine(choice)}
              </p>
              {choice.options.length > 0 && (
                <ChoiceOptions options={choice.options} onSelect={onSelect} />
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

/** How many option names a choice shows before "Show all": a feat choice names about 800. */
const OPTIONS_SHOWN = 40;

function ChoiceOptions({
  options,
  onSelect,
}: {
  options: readonly ElementChoiceOption[];
  onSelect?: (id: ElementId) => void;
}): React.JSX.Element {
  const [all, setAll] = useState(false);
  const shown = all ? options : options.slice(0, OPTIONS_SHOWN);
  return (
    <p className="element-choice-options">
      {shown.map((option, index) => (
        <span key={option.id}>
          {index > 0 && ', '}
          {onSelect ? (
            <button type="button" className="link" onClick={() => onSelect(option.id)}>
              {option.label}
            </button>
          ) : (
            option.label
          )}
        </span>
      ))}
      {options.length > shown.length && (
        <>
          {' '}
          <button type="button" className="link" onClick={() => setAll(true)}>
            and {(options.length - shown.length).toLocaleString()} more
          </button>
        </>
      )}
    </p>
  );
}
