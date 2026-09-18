/**
 * A `levelRoll` step's per-level rolls, on screen — 5e's hit points.
 *
 * Computes nothing, the same discipline `BudgetEditor.tsx` states for itself: every number
 * comes off `HitPointState`, and every write goes through `recordHitPoints` or
 * `changeHitPoints`, which `packages/ui/src/hitpoints.ts` has already validated (the first level
 * always the maximum regardless of which button is clicked, a typed value held to the die). If
 * a die size, an average or a reroll ever needs computing in this file, that guarantee is gone.
 */

import { useEffect, useState } from 'react';
import type { CharacterBuilder, HitPointLevel, HitPointState } from '@incudo/ui';

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
  const anyEditable = state.levels.some((level) => !level.isFirst && level.dieSides !== undefined);

  return (
    <>
      <div className="hp-levels">
        {state.levels.map((level) => (
          <div key={level.level} className="hp-level">
            <div className="hp-level-head">
              <span className="label">Level {level.level}</span>
              <span className="hint">
                {[level.className, level.dieSides ? `d${level.dieSides}` : undefined]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </span>
              <span className="hp-level-value">
                {level.isFirst || level.dieSides === undefined ? (
                  (level.recorded ?? '—')
                ) : (
                  <ManualValue stepId={stepId} level={level} builder={builder} />
                )}
                <span className="hint">hp</span>
              </span>
            </div>
            <LevelActions stepId={stepId} level={level} builder={builder} />
          </div>
        ))}
      </div>
      {anyEditable && (
        <p className="hint">
          Level 1 is always the maximum. Any later level can be rolled, rolled again, set to the
          average, or typed in.
        </p>
      )}
    </>
  );
}

/** The buttons for one level: the fixed maximum for the first, roll / reroll 1s / average after. */
function LevelActions({
  stepId,
  level,
  builder,
}: {
  stepId: string;
  level: HitPointLevel;
  builder: CharacterBuilder;
}): React.JSX.Element | null {
  if (level.dieSides === undefined) {
    // Reported rather than guessed at (ADR 0005): recording a wrong die's roll would hand the
    // user a wrong hit point total with no way to tell.
    return level.unreadable ? <span className="hint">{level.unreadable}</span> : null;
  }

  if (level.isFirst) {
    return level.recorded === undefined ? (
      <button
        type="button"
        onClick={() => builder.recordHitPoints(stepId, level.level, 'average')}
      >
        Record the maximum ({level.dieSides})
      </button>
    ) : (
      <span className="hint">Always the maximum</span>
    );
  }

  const again = level.recorded !== undefined;
  return (
    <span className="hp-actions">
      <button
        type="button"
        onClick={() => builder.changeHitPoints(stepId, level.level, 'roll')}
      >
        {again ? 'Roll again' : 'Roll'}
      </button>
      <button
        type="button"
        title="Roll the die. If it comes up 1, roll once more and keep that result."
        onClick={() => builder.changeHitPoints(stepId, level.level, 'rollRerollOnes')}
      >
        {again ? 'Roll again, rerolling 1s' : 'Roll, rerolling 1s'}
      </button>
      <button
        type="button"
        onClick={() => builder.changeHitPoints(stepId, level.level, 'average')}
      >
        Average ({level.average})
      </button>
    </span>
  );
}

/**
 * A number field for one level's value, written when the user leaves it or presses Enter.
 *
 * Not on every keystroke: typing "10" into a d10 passes through "1", and writing that would
 * record a 1 and, on a level with nothing recorded, open the review the moment the first digit
 * landed. What is written is whatever `changeHitPoints` says it stored, so a 14 typed into a
 * d10 comes back as 10 rather than sitting in the box as 14.
 */
function ManualValue({
  stepId,
  level,
  builder,
}: {
  stepId: string;
  level: HitPointLevel;
  builder: CharacterBuilder;
}): React.JSX.Element {
  const shown = level.recorded === undefined ? '' : String(level.recorded);
  const [draft, setDraft] = useState(shown);
  // A button elsewhere in the row changed the value; the box follows it.
  useEffect(() => setDraft(shown), [shown]);

  const commit = (): void => {
    if (draft === shown) return;
    if (draft.trim() === '') {
      setDraft(shown);
      return;
    }
    const stored = builder.changeHitPoints(stepId, level.level, { value: Number(draft) });
    setDraft(stored === undefined ? shown : String(stored));
  };

  return (
    <input
      type="number"
      min={1}
      max={level.dieSides}
      value={draft}
      placeholder="—"
      aria-label={`Level ${level.level} hit points`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
}
