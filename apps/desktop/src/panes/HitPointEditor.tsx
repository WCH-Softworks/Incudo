/**
 * A `levelRoll` step's per-level rolls, on screen — 5e's hit points.
 *
 * Computes nothing, the same discipline `BudgetEditor.tsx` states for itself: every number
 * comes off `HitPointState`, and every button calls `recordHitPoints`, which
 * `packages/ui/src/hitpoints.ts` has already validated (idempotent, and the first level
 * always the maximum regardless of which button is clicked). If a die size or an average ever
 * needs computing in this file, that guarantee is gone.
 */

import { useState } from 'react';
import type { CharacterBuilder, HitPointState } from '@incudo/ui';

/**
 * A settled hit point table, collapsed to what a sheet would show — one line per level, or a
 * single "N hp" when there is only one. Same shape as `CompactBudget` in `BudgetEditor.tsx` and
 * for the same reason: the full per-level table with its Roll/Take the average buttons is right
 * for the one place a value is actually being recorded, wrong for a card sitting in "Values
 * already set" next to a settled Race that is one line. "Edit" swaps the full table back in.
 */
export function CompactHitPoints({
  stepId,
  state,
  builder,
}: {
  stepId: string;
  state: HitPointState;
  builder: CharacterBuilder;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="budget-compact-open">
        <HitPointEditor stepId={stepId} state={state} builder={builder} />
        <button type="button" className="link" onClick={() => setEditing(false)}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="budget-compact">
      <dl>
        {state.levels.map((level) => (
          <div key={level.level}>
            <dt>{state.levels.length > 1 ? `Level ${level.level}` : 'Hit points'}</dt>
            <dd>{level.recorded ?? '—'} hp</dd>
          </div>
        ))}
      </dl>
      <div className="decision-head">
        <button type="button" className="link" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    </div>
  );
}

export function HitPointEditor({
  stepId,
  state,
  builder,
}: {
  stepId: string;
  state: HitPointState;
  builder: CharacterBuilder;
}): React.JSX.Element {
  return (
    <table className="budget-rows hp-rows">
      <thead>
        <tr>
          <th>Level</th>
          <th>Class</th>
          <th className="numeric">Die</th>
          <th className="numeric">Hit points</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {state.levels.map((level) => (
          <tr key={level.level}>
            <th scope="row">{level.level}</th>
            <td>{level.className ?? '—'}</td>
            <td className="numeric muted">{level.dieSides ? `d${level.dieSides}` : '—'}</td>
            <td className="numeric total">{level.recorded ?? '—'}</td>
            <td className="hp-actions-cell">
              {level.recorded === undefined && level.dieSides !== undefined && (
                level.isFirst ? (
                  <button
                    type="button"
                    onClick={() => builder.recordHitPoints(stepId, level.level, 'average')}
                  >
                    Record the maximum ({level.dieSides})
                  </button>
                ) : (
                  <span className="hp-actions">
                    <button
                      type="button"
                      onClick={() => builder.recordHitPoints(stepId, level.level, 'roll')}
                    >
                      Roll a d{level.dieSides}
                    </button>
                    <button
                      type="button"
                      onClick={() => builder.recordHitPoints(stepId, level.level, 'average')}
                    >
                      Take the average ({level.average})
                    </button>
                  </span>
                )
              )}
              {level.recorded === undefined && level.unreadable && (
                // Reported rather than guessed at (ADR 0005): recording a wrong die's roll
                // would hand the user a wrong hit point total with no way to tell.
                <span className="hint">{level.unreadable}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
