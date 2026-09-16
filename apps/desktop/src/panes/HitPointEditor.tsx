/**
 * A `levelRoll` step's per-level rolls, on screen — 5e's hit points.
 *
 * Computes nothing, the same discipline `BudgetEditor.tsx` states for itself: every number
 * comes off `HitPointState`, and every button calls `recordHitPoints`, which
 * `packages/ui/src/hitpoints.ts` has already validated (idempotent, and the first level
 * always the maximum regardless of which button is clicked). If a die size or an average ever
 * needs computing in this file, that guarantee is gone.
 */

import type { CharacterBuilder, HitPointState } from '@incudo/ui';

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
    <table className="budget-rows">
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
            <td>
              {level.recorded === undefined && level.dieSides !== undefined && (
                level.isFirst ? (
                  <button
                    type="button"
                    onClick={() => builder.recordHitPoints(stepId, level.level, 'average')}
                  >
                    Record the maximum ({level.dieSides})
                  </button>
                ) : (
                  <span className="stepper">
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
