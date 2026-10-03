/**
 * Elements the user adds to this character from loaded content — ADR 0064.
 *
 * A condition on an NPC, a feat given whatever its prerequisites, a language learned in play. Not an open decision:
 * nothing is owed, and a list of every feat, spell and condition loaded would sit in Open decisions forever. What each
 * added element is doing, and what could be added with whether its prerequisites hold, is worked out in
 * `packages/ui/src/additions.ts`; this renders it. Nothing here names a type.
 */

import { useMemo, useState } from 'react';
import {
  additionGroups,
  additionOptionLabel,
  PREREQUISITES_UNMET,
  ALL_ADDITION_TYPES,
  NO_ADDITION_OPTIONS,
  type BuilderState,
  type CharacterBuilder,
} from '@incudo/ui';
import type { ElementId, ElementIndex } from '@incudo/core';

import { CandidatePicker, ChosenCandidate } from './CandidatePicker.tsx';

export function Additions({
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
  const { additions } = state;
  const [type, setType] = useState(additions.types[0]?.type ?? '');
  const [adding, setAdding] = useState(false);

  // Asked of the builder only while the picker is open: it is every element of the type, and the state changes on
  // every keystroke elsewhere in the pane.
  const options = useMemo(
    () => (adding ? builder.additionOptionsFor(type || undefined) : []),
    [adding, type, builder, state],
  );
  const byId = useMemo(() => new Map(options.map((o) => [o.elementId, o])), [options]);
  const optionLabel = (id: ElementId): string => {
    const option = byId.get(id);
    return option ? additionOptionLabel(candidateLabel(id), option) : candidateLabel(id);
  };

  return (
    <>
      {additions.description && <p className="hint">{additions.description}</p>}

      {/* Grouped under the types as the system names a list of them; anything of another type (not loaded, or no
          longer allowed) last (`additionGroups`). */}
      {additionGroups(additions).map((group) => (
        <div key={group.label} className="settled">
          <div className="decision-head">
            <span className="label">{group.label}</span>
          </div>
        <ul className="additions">
          {group.rows.map((row) => (
            <li key={row.elementId} className={row.held ? '' : 'not-held'}>
              {row.known ? (
                <ChosenCandidate
                  id={row.elementId}
                  elements={elements}
                  candidateLabel={candidateLabel}
                  options={[row.elementId]}
                  onRemove={() => builder.removeAddition(row.elementId)}
                />
              ) : (
                <div className="picker-chosen">
                  <div className="picker-row-head">
                    <span className="picker-name">{row.name}</span>
                    <button type="button" className="link" onClick={() => builder.removeAddition(row.elementId)}>
                      Remove
                    </button>
                  </div>
                </div>
              )}
              {!row.prerequisitesMet && <span className="tag open">{PREREQUISITES_UNMET}</span>}
              {row.note && <p className="hint">{row.note}</p>}
            </li>
          ))}
        </ul>
        </div>
      ))}

      {adding ? (
        <div className="settled">
          <div className="decision-head">
            <label>
              Type{' '}
              <select value={type} onChange={(event) => setType(event.target.value)}>
                {additions.types.map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.label}
                  </option>
                ))}
                <option value="">{ALL_ADDITION_TYPES}</option>
              </select>
            </label>
            <button type="button" className="link" onClick={() => setAdding(false)}>
              Done
            </button>
          </div>
          {options.length === 0 ? (
            <p className="hint">{NO_ADDITION_OPTIONS}</p>
          ) : (
            <CandidatePicker
              // Keyed on the type so the search box starts empty for each list.
              key={type}
              candidates={options.map((o) => o.elementId)}
              elements={elements}
              candidateLabel={optionLabel}
              onSelect={(id) => builder.addElement(id)}
            />
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}>
          Add from your content
        </button>
      )}
    </>
  );
}
