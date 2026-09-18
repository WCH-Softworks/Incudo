/**
 * Which class each level went to, on screen.
 *
 * Computes nothing, the same discipline `BudgetEditor.tsx` and `HitPointEditor.tsx` state for
 * themselves: every row, every class and every reason a class is unavailable comes off
 * `ClassLevelState` (`packages/ui/src/multiclass.ts`), and every write goes through
 * `setLevelClass` or `addLevel`, which validate against that same state. If a prerequisite, a
 * level count or which class a level belongs to ever needs working out in this file, a bug in it
 * stops being fixable in a package.
 *
 * Two controls, because there are two things a player does: take one more level in some class
 * (the usual case, and the only one that grows the character), and change what a level already
 * taken went to (the repair, and how a character built level by level is corrected).
 */

import { useState } from 'react';
import type { ClassLevelState, ClassOption, CharacterBuilder } from '@incudo/ui';
import type { ElementId } from '@incudo/core';

/** What to say beside a class that cannot be taken. The wording is the shell's; the reason is data. */
function unavailableReason(
  option: ClassOption,
  candidateLabel: (id: ElementId) => string,
): string | undefined {
  if (option.eligible) return undefined;
  if (option.unavailable === 'no-multiclass-rules') return 'cannot be taken as an additional class';
  // Named, not "requirements not met": the ability score in the prerequisite text may be one the
  // character has, and reading it as the reason would be wrong.
  if (option.unavailable === 'excluded' && option.excludedBy) {
    return `cannot be combined with ${candidateLabel(option.excludedBy)}`;
  }
  return option.prerequisite ? `needs ${option.prerequisite}` : 'requirements not met';
}

/** `<option>`s in three groups, so a class you already have and one you may add read differently. */
function ClassOptions({
  options,
  candidateLabel,
}: {
  options: ClassOption[];
  candidateLabel: (id: ElementId) => string;
}): React.JSX.Element {
  const taken = options.filter((option) => option.taken);
  const available = options.filter((option) => !option.taken && option.eligible);
  const unavailable = options.filter((option) => !option.taken && !option.eligible);
  return (
    <>
      {taken.length > 0 && (
        <optgroup label="Your classes">
          {taken.map((option) => (
            <option key={option.id} value={option.id}>
              {candidateLabel(option.id)}
            </option>
          ))}
        </optgroup>
      )}
      {available.length > 0 && (
        <optgroup label="Can be added">
          {available.map((option) => (
            <option key={option.id} value={option.id}>
              {candidateLabel(option.id)}
            </option>
          ))}
        </optgroup>
      )}
      {unavailable.length > 0 && (
        <optgroup label="Not available">
          {unavailable.map((option) => (
            <option key={option.id} value={option.id} disabled>
              {candidateLabel(option.id)} — {unavailableReason(option, candidateLabel)}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

export function ClassLevels({
  stepId,
  state,
  builder,
  nameOf,
  candidateLabel,
}: {
  stepId: string;
  state: ClassLevelState;
  builder: CharacterBuilder;
  nameOf: (id: ElementId) => string;
  candidateLabel: (id: ElementId) => string;
}): React.JSX.Element {
  const [next, setNext] = useState<ElementId | undefined>(undefined);

  if (state.firstClassId === undefined) {
    return <p className="hint">Choose a class first. Further levels can then go to other classes.</p>;
  }

  const last = state.levels[state.levels.length - 1];
  const fallback = last?.classId ?? state.firstClassId;
  // What was picked, unless it has since stopped being available — a score changed elsewhere can
  // take a class out from under a control that is still on screen.
  const target =
    next !== undefined && state.options.some((option) => option.id === next && option.eligible)
      ? next
      : fallback;
  const nextLevel = state.levels.length + 1;

  return (
    <div className="class-levels">
      <p className="class-summary">
        {state.classes.map((held) => `${nameOf(held.id)} ${held.levels}`).join(' / ')}
      </p>

      {state.unassigned.length > 0 && (
        <p className="hint">
          {state.unassigned.length === 1
            ? `Level ${state.unassigned[0]} has no class recorded.`
            : `Levels ${state.unassigned.join(', ')} have no class recorded.`}{' '}
          Choose one below.
        </p>
      )}

      <div className="class-add">
        <label>
          {state.canAddLevel ? `Level ${nextLevel} goes to` : 'Highest level reached'}
          <select
            value={target}
            disabled={!state.canAddLevel}
            onChange={(event) => setNext(event.target.value)}
          >
            <ClassOptions options={state.options} candidateLabel={candidateLabel} />
          </select>
        </label>
        <button
          type="button"
          disabled={!state.canAddLevel}
          onClick={() => builder.addLevel(stepId, target)}
        >
          Add level {state.canAddLevel ? nextLevel : ''}
        </button>
      </div>

      <details open={state.classes.length > 1 || state.unassigned.length > 0}>
        <summary>Level by level</summary>
        <div className="class-level-rows">
          {state.levels.map((row) => (
            <div key={row.level} className="class-level-row">
              <span className="label">Level {row.level}</span>
              {row.first ? (
                <span className="hint">
                  {row.classId ? `${nameOf(row.classId)} 1 · your first class` : '—'}
                </span>
              ) : (
                <>
                  <span className="hint">
                    {row.classId ? `${nameOf(row.classId)} ${row.classLevel}` : 'no class'}
                  </span>
                  <select
                    aria-label={`Class for level ${row.level}`}
                    value={row.classId ?? ''}
                    onChange={(event) => builder.setLevelClass(stepId, row.level, event.target.value)}
                  >
                    {row.classId === undefined && (
                      <option value="" disabled>
                        Choose a class
                      </option>
                    )}
                    <ClassOptions options={state.options} candidateLabel={candidateLabel} />
                  </select>
                </>
              )}
            </div>
          ))}
        </div>
      </details>

      <p className="hint">
        A class you do not already have can name conditions to be taken, such as ability scores,
        and they are checked against the character as it is now. Changing a level's class clears a
        hit point roll made on a different die.
      </p>
    </div>
  );
}
