/**
 * The prepared list of each casting block, on screen.
 *
 * Computes nothing, like `ClassLevels.tsx` and for the same reason: the limit, what is always on the
 * list, what the player put on it, how far over that is and what could still be added all come off
 * `PreparationRow` and `CharacterBuilder.preparationOptionsFor` (`packages/ui/src/preparation.ts`),
 * and both writes go through `prepare` and `unprepare`, which validate against that same state.
 *
 * Going past the limit is shown, never prevented: the row says by how much and the character is
 * allowed to exist over it. What cannot be offered is what the block cannot prepare, and that is
 * decided in the package.
 */

import { useMemo, useState } from 'react';
import type { CharacterBuilder, PreparationRow, PreparedItem } from '@incudo/ui';
import type { ElementId, ElementIndex } from '@incudo/core';

import { CandidatePicker } from './CandidatePicker.tsx';

/** "Fireball (Level 3)": the item's name and the system's note, when there is one. */
function itemText(item: PreparedItem): string {
  return item.note ? `${item.name} (${item.note})` : item.name;
}

export function PreparedSpells({
  rows,
  builder,
  elements,
  candidateLabel,
  noun,
}: {
  rows: PreparationRow[];
  builder: CharacterBuilder;
  elements: ElementIndex;
  candidateLabel: (id: ElementId) => string;
  /** What is prepared, singular and lowercase, from the system: "spell". */
  noun: string;
}): React.JSX.Element {
  return (
    <div className="prepared">
      {rows.map((row) => (
        <PreparedBlockRow
          key={row.key}
          row={row}
          builder={builder}
          elements={elements}
          candidateLabel={candidateLabel}
          noun={noun}
          heading={rows.length > 1}
        />
      ))}
    </div>
  );
}

function PreparedBlockRow({
  row,
  builder,
  elements,
  candidateLabel,
  noun,
  heading,
}: {
  row: PreparationRow;
  builder: CharacterBuilder;
  elements: ElementIndex;
  candidateLabel: (id: ElementId) => string;
  noun: string;
  heading: boolean;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  // Computed only while the picker is open: a whole list is a couple of hundred entries for a high
  // level caster and nothing needs it until the player asks to add one. Recomputed when the count
  // moves, since adding one takes it out of what is offered.
  const options = useMemo(
    () => (adding ? builder.preparationOptionsFor(row.key).map((item) => item.id) : []),
    [adding, builder, row.key, row.count, row.always.length, row.unavailable.length],
  );

  return (
    <div className="prepared-block">
      {heading && <h3>{row.name}</h3>}
      <p className={row.over > 0 ? 'prepared-count over' : 'prepared-count'}>
        {row.count} of {row.limit} prepared
        {row.over > 0 && (
          <>
            {' — '}
            {row.over} over. Take {row.over === 1 ? 'one' : row.over} off, or keep {row.over === 1 ? 'it' : 'them'} if
            your table allows it.
          </>
        )}
      </p>
      <p className="hint">
        {row.mode === 'held'
          ? `You prepare from the ${noun}s you have learned for ${row.name}.`
          : `You can prepare any ${noun} on the ${row.name} list, up to a level you have slots for.`}
      </p>

      {row.always.length > 0 && (
        <div className="prepared-group">
          <span className="label">Always prepared</span>
          <p className="hint">These do not count against the limit.</p>
          <ul>
            {row.always.map((item) => (
              <li key={item.id}>{itemText(item)}</li>
            ))}
          </ul>
        </div>
      )}

      {row.chosen.length > 0 && (
        <ul className="prepared-list">
          {row.chosen.map((item) => (
            <li key={item.id}>
              <span>{itemText(item)}</span>
              <button type="button" onClick={() => builder.unprepare(row.key, item.id)}>
                Take off
              </button>
            </li>
          ))}
        </ul>
      )}

      {row.unavailable.length > 0 && (
        <div className="prepared-group">
          <p className="hint">
            {row.name} cannot prepare {row.unavailable.length === 1 ? 'this' : 'these'} now, and{' '}
            {row.unavailable.length === 1 ? 'it does' : 'they do'} not count.
          </p>
          <ul className="prepared-list">
            {row.unavailable.map((item) => (
              <li key={item.id}>
                <span>{itemText(item)}</span>
                <button type="button" onClick={() => builder.unprepare(row.key, item.id)}>
                  Take off
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adding ? (
        <div className="prepared-add">
          {options.length > 0 ? (
            <CandidatePicker
              key={`${row.key}:${row.count}`}
              candidates={options}
              elements={elements}
              candidateLabel={candidateLabel}
              onSelect={(id) => builder.prepare(row.key, id)}
            />
          ) : (
            <p className="hint">
              {row.mode === 'held'
                ? row.count + row.always.length + row.unavailable.length === 0
                  ? `You have not learned any ${noun}s for ${row.name} yet. Choose them under Open decisions first.`
                  : `Every ${noun} you have learned for ${row.name} is already prepared.`
                : `No more ${noun}s to add from the content loaded.`}
            </p>
          )}
          <button type="button" onClick={() => setAdding(false)}>
            Done adding
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}>
          Prepare a {noun}
        </button>
      )}
    </div>
  );
}
