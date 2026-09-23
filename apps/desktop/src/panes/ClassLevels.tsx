/**
 * Which class each level went to, on screen.
 *
 * Computes nothing, the same discipline `BudgetEditor.tsx` and `HitPointEditor.tsx` state for
 * themselves: every row, every class and every reason a class is unavailable comes off
 * `ClassLevelState` (`packages/ui/src/multiclass.ts`), and every write goes through
 * `setLevelClass`, `addLevel` or `applySplit`, which validate against that same state. If a
 * prerequisite, a level count or which class a level belongs to ever needs working out in this file,
 * a bug in it stops being fixable in a package.
 *
 * Three controls, because there are three things a player does: take one more level in some class
 * (the usual case), say the whole split at once ("Fighter 12, Wizard 5" — ADR 0045), and change what
 * a level already taken went to (the repair, and how a level-by-level build is corrected).
 *
 * An ability score minimum a class asks for is shown, never enforced (ADR 0045): the flag is data on
 * `ClassOption`, and the sentence around it is this file's.
 */

import { useState } from 'react';
import { scoreLabel } from '@incudo/ui';
import type { ClassLevelState, ClassOption, ClassSegment, CharacterBuilder, ScoreShortfall } from '@incudo/ui';
import type { ElementId, StatDef } from '@incudo/core';

/** "Charisma 13 (you have 10)", with "or" between the ways a block can be met. */
function shortfallText(flag: ScoreShortfall[][], stats: ReadonlyArray<StatDef>): string {
  return flag
    .map((terms) =>
      terms.map((term) => `${scoreLabel(stats, term.stat)} ${term.needs} (you have ${term.has})`).join(' and '),
    )
    .join(' or ');
}

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
  stats,
}: {
  options: ClassOption[];
  candidateLabel: (id: ElementId) => string;
  stats: ReadonlyArray<StatDef>;
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
              {option.flag ? ` — needs ${shortfallText(option.flag, stats)}` : ''}
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
  stats,
}: {
  stepId: string;
  state: ClassLevelState;
  builder: CharacterBuilder;
  nameOf: (id: ElementId) => string;
  candidateLabel: (id: ElementId) => string;
  stats: ReadonlyArray<StatDef>;
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

      {state.options
        .filter((option) => option.taken && option.flag)
        .map((option) => (
          <p key={option.id} className="class-flag">
            {nameOf(option.id)} usually needs {shortfallText(option.flag!, stats)}. It is allowed here, and
            this note goes away when the score is high enough.
          </p>
        ))}

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
            <ClassOptions options={state.options} candidateLabel={candidateLabel} stats={stats} />
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

      <ClassSplit
        stepId={stepId}
        state={state}
        builder={builder}
        candidateLabel={candidateLabel}
        stats={stats}
      />

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
                    <ClassOptions options={state.options} candidateLabel={candidateLabel} stats={stats} />
                  </select>
                </>
              )}
            </div>
          ))}
        </div>
      </details>

      <p className="hint">
        Ability score minimums a class asks for are shown, not enforced: the class can be taken and the
        minimum is listed until the score reaches it. Anything else a class requires, such as not
        combining it with another edition of a class you have, still applies and is checked against the
        character as it is now. Changing a level's class clears a hit point roll made on a different die.
      </p>
    </div>
  );
}

/**
 * The whole split as totals: rows of (class, levels), in the order the levels were taken, and one
 * Apply. Nothing is worked out here beyond the sum shown beside the button; whether the split is
 * allowed is `builder.applySplit`'s answer, and it writes nothing when it says no.
 */
function ClassSplit({
  stepId,
  state,
  builder,
  candidateLabel,
  stats,
}: {
  stepId: string;
  state: ClassLevelState;
  builder: CharacterBuilder;
  candidateLabel: (id: ElementId) => string;
  stats: ReadonlyArray<StatDef>;
}): React.JSX.Element {
  const current: ClassSegment[] = state.classes.map((held) => ({ classId: held.id, levels: held.levels }));
  const [rows, setRows] = useState<ClassSegment[] | undefined>(undefined);
  const [refused, setRefused] = useState(false);
  const shown = rows ?? current;
  const total = shown.reduce((sum, row) => sum + (Number.isFinite(row.levels) ? row.levels : 0), 0);
  const tooHigh = state.maxLevel !== undefined && total > state.maxLevel;
  const valid =
    shown.length > 0 && !tooHigh && shown.every((row) => Number.isInteger(row.levels) && row.levels >= 1);

  const edit = (next: ClassSegment[]): void => {
    setRows(next);
    setRefused(false);
  };
  const change = (index: number, patch: Partial<ClassSegment>): void =>
    edit(shown.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const move = (index: number, by: number): void => {
    const target = index + by;
    if (target < 0 || target >= shown.length) return;
    const next = [...shown];
    [next[index], next[target]] = [next[target]!, next[index]!];
    edit(next);
  };

  return (
    <details>
      <summary>Set the split</summary>
      <div className="class-split">
        <p className="hint">
          Say how many levels go to each class, in the order they were taken. The first row is the class
          the character started as, which decides its starting proficiencies and its highest hit die.
        </p>
        {shown.map((row, index) => (
          <div key={index} className="class-split-row">
            <select
              aria-label={index === 0 ? 'First class' : `Class ${index + 1}`}
              value={row.classId}
              onChange={(event) => change(index, { classId: event.target.value })}
            >
              <ClassOptions options={state.options} candidateLabel={candidateLabel} stats={stats} />
            </select>
            <input
              type="number"
              min={1}
              max={state.maxLevel}
              aria-label={`Levels in class ${index + 1}`}
              value={Number.isFinite(row.levels) ? row.levels : ''}
              onChange={(event) => change(index, { levels: event.target.valueAsNumber })}
            />
            <span className="class-split-buttons">
              <button type="button" className="link" disabled={index === 0} onClick={() => move(index, -1)}>
                Up
              </button>
              <button
                type="button"
                className="link"
                disabled={index === shown.length - 1}
                onClick={() => move(index, 1)}
              >
                Down
              </button>
              <button
                type="button"
                className="link"
                disabled={shown.length === 1}
                onClick={() => edit(shown.filter((_, at) => at !== index))}
              >
                Remove
              </button>
            </span>
          </div>
        ))}
        <div className="class-split-actions">
          <button
            type="button"
            className="link"
            onClick={() =>
              edit([...shown, { classId: shown[shown.length - 1]?.classId ?? state.firstClassId!, levels: 1 }])
            }
          >
            Add a class
          </button>
          <span className="hint">
            Character level {total}
            {tooHigh ? ` — the most is ${state.maxLevel}` : ''}
          </span>
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              if (builder.applySplit(stepId, shown)) {
                setRows(undefined);
                setRefused(false);
              } else {
                setRefused(true);
              }
            }}
          >
            Apply
          </button>
        </div>
        {refused && <p className="hint">These classes cannot be combined, so nothing was changed.</p>}
        {state.interleaved && (
          <p className="hint">
            The levels are not taken one class at a time right now. Applying replaces that order with the
            rows above.
          </p>
        )}
      </div>
    </details>
  );
}
