/**
 * A candidate's sanitized description, or a plain note that it has none. What the description embeds is put in place
 * from the same index it is read from (`expandDescription`, ADR 0069) before it is sanitized.
 *
 * An element that makes an attack is headed by what it states of the attack, its damage, other dice, range and
 * properties (`statedAttackLines`): most weapons write no description, and their preview named no die.
 */

import { createContext, useContext, useMemo } from 'react';
import { statedAttack, type AttacksDef, type ElementId, type ElementIndex } from '@incudo/core';
import { expandDescription, statedAttackLines } from '@incudo/ui';

import { sanitizeDescriptionHtml } from '../sanitize-html.ts';

/** The kind's attacks declaration, for the lines a weapon's preview leads with. Absent where nothing provides one. */
export const AttacksContext = createContext<AttacksDef | undefined>(undefined);

export function CandidateDescription({
  id,
  elements,
}: {
  id: ElementId;
  elements: ElementIndex;
}): React.JSX.Element {
  const element = elements.get(id);
  const attacks = useContext(AttacksContext);
  const html = useMemo(
    () => (element?.description ? sanitizeDescriptionHtml(expandDescription(element, elements)) : undefined),
    [element, elements],
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
