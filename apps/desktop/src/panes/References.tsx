/**
 * What the character keeps beside it for reference — ADR 0068.
 *
 * A stat block printed only as prose, kept beside the NPC the DM builds from it by hand, or beside a player character
 * whose spell summons the creature (ADR 0070). Not a decision: nothing is owed, and nothing is worked out from the text. What each kept element is and what could be kept is decided in
 * `packages/ui/src/references.ts`; this renders it and makes the text safe to show. Nothing here names a type.
 */

import { useMemo, useState } from 'react';
import { referenceEntry, type BuilderState, type CharacterBuilder, type SheetDocumentReference } from '@incudo/ui';
import type { ElementId, ElementIndex } from '@incudo/core';

import { sanitizeDescriptionHtml } from '../sanitize-html.ts';
import { CandidatePicker } from './CandidatePicker.tsx';

/**
 * A kept element's text, sanitized as every description is, or the sentence `packages/ui` wrote in its place
 * (`referenceEntry`, ADR 0075): the Sheet, the Build pane and the text export say the same.
 */
export function ReferenceText({ entry }: { entry: SheetDocumentReference }): React.JSX.Element {
  const html = useMemo(() => (entry.html ? sanitizeDescriptionHtml(entry.html) : ''), [entry.html]);
  return html ? (
    <div className="picker-description reference-text" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <p className="hint">{entry.note}</p>
  );
}

export function References({
  state,
  builder,
  elements,
  candidateLabel,
}: {
  state: BuilderState;
  builder: CharacterBuilder;
  elements: ElementIndex;
  candidateLabel: (id: ElementId) => string;
}): React.JSX.Element {
  const { references } = state;
  const [choosing, setChoosing] = useState(false);
  // Asked of the builder only while the picker is open.
  const options = useMemo(() => (choosing ? builder.referenceOptionsFor() : []), [choosing, builder, state]);

  return (
    <>
      {references.description && <p className="hint">{references.description}</p>}

      {references.rows.length > 0 && (
        <ul className="references">
          {references.rows.map((row) => (
            <li key={row.elementId}>
              <div className="picker-row-head">
                <span className="picker-name">{row.known ? candidateLabel(row.elementId) : row.name}</span>
                <button type="button" className="link" onClick={() => builder.removeReference(row.elementId)}>
                  Remove
                </button>
              </div>
              <ReferenceText entry={referenceEntry(row)} />
            </li>
          ))}
        </ul>
      )}

      {/* What the character's own elements print that it could keep (ADR 0070), decided in packages/ui. */}
      {references.suggestions.length > 0 && (
        <div className="reference-suggestions">
          <p className="hint">Printed in what this character has:</p>
          <ul className="references">
            {references.suggestions.map((suggestion) => (
              <li key={suggestion.elementId}>
                <div className="picker-row-head">
                  <span className="picker-name">{candidateLabel(suggestion.elementId)}</span>
                  <button type="button" className="link" onClick={() => builder.addReference(suggestion.elementId)}>
                    Keep
                  </button>
                </div>
                <p className="hint">In {suggestion.printedIn.join(', ')}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {choosing ? (
        <div className="settled">
          <div className="decision-head">
            <span className="label">Choose one to keep beside it</span>
            <button type="button" className="link" onClick={() => setChoosing(false)}>
              Done
            </button>
          </div>
          {options.length === 0 ? (
            <p className="hint">Nothing loaded can be kept here that the character does not already keep.</p>
          ) : (
            <CandidatePicker
              candidates={options}
              elements={elements}
              candidateLabel={candidateLabel}
              onSelect={(id) => {
                if (builder.addReference(id)) setChoosing(false);
              }}
            />
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setChoosing(true)}>
          Choose from your content
        </button>
      )}
    </>
  );
}
