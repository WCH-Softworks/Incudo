/**
 * A candidate's sanitized description, or a plain note that it has none. What the description embeds is put in place
 * from the same index it is read from (`expandDescription`, ADR 0069) before it is sanitized.
 *
 * An element that makes an attack is headed by what it states of the attack, its damage, other dice, range and
 * properties (`statedAttackLines`): most weapons write no description, and their preview named no die.
 *
 * What the element and each element it embeds ask the character to choose is written after that element's own text,
 * each option's name over its text (`expandDescriptionWithChoices`): a description often says its options are
 * "detailed below", and in content they are the choice's options, each an element of its own.
 */

import { createContext, useContext, useMemo } from 'react';
import { statedAttack, type AttacksDef, type ElementId, type ElementIndex } from '@incudo/core';
import { expandDescriptionWithChoices, statedAttackLines } from '@incudo/ui';

import { sanitizeDescriptionHtml } from '../sanitize-html.ts';

/** The kind's attacks declaration, for the lines a weapon's preview leads with. Absent where nothing provides one. */
export const AttacksContext = createContext<AttacksDef | undefined>(undefined);

/** The types the system names a thing by (`printingTypes`): a choice of them is listed by name, not written out. */
export const NamedTypesContext = createContext<ReadonlySet<string>>(new Set());

export function CandidateDescription({
  id,
  elements,
}: {
  id: ElementId;
  elements: ElementIndex;
}): React.JSX.Element {
  const element = elements.get(id);
  const attacks = useContext(AttacksContext);
  const namedTypes = useContext(NamedTypesContext);
  const html = useMemo(
    () => (element ? sanitizeDescriptionHtml(expandDescriptionWithChoices(element, elements, namedTypes)) : undefined),
    [element, elements, namedTypes],
  );
  const facts = useMemo(() => (element ? statedAttackLines(statedAttack(element, attacks, elements)) : []), [element, attacks, elements]);
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
    </>
  );
}
