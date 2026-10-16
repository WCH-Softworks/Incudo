/**
 * The character's level, and which class each level went to, on screen.
 *
 * Computes nothing, the same discipline `BudgetEditor.tsx` and `HitPointEditor.tsx` state for
 * themselves: every row, every class and every reason a class is unavailable comes off
 * `ClassLevelState` (`packages/ui/src/multiclass.ts`), and every write goes through
 * `setLevelClass`, `addLevel` or `applySplit`, which validate against that same state. If a
 * prerequisite, a level count or which class a level belongs to ever needs working out in this file,
 * a bug in it stops being fixable in a package.
 *
 * Level up and level down are buttons at the top of the build's main column, with the class the next
 * level goes to beside Level up. They used to be a typed number in the header and a separate Classes
 * panel in the settled column, where taking a second class was hard enough to find that it read as
 * missing. Below them, two more controls for the less usual moves: say the whole split at once
 * ("Fighter 12, Wizard 5" — ADR 0045), and change what a level already taken went to (the repair).
 *
 * An ability score minimum a class asks for is shown, never enforced (ADR 0045): the flag is data on
 * `ClassOption`, and the sentence around it is this file's.
 */

import { useState } from 'react';
import {
  LEVEL_HINT,
  LEVEL_MULTICLASS_HINT,
  LEVEL_ROWS_LABEL,
  SPLIT_INTERLEAVED,
  SPLIT_REFUSED,
  classOptionGroups,
  currentSplit,
  levelControlView,
  movedSplitRow,
  firstClassHint,
  multiclassOffNote,
  shortfallText,
  splitDraftView,
  splitWording,
  unavailableReason,
  withAddedSplitRow,
  withSplitRow,
  withoutSplitRow,
} from '@incudo/ui';
import type { ClassLevelState, ClassOption, ClassSegment, CharacterBuilder } from '@incudo/ui';
import type { ElementId, StatDef } from '@incudo/core';

import { InfoTip } from './InfoTip.tsx';

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
  const { taken, available, unavailable } = classOptionGroups(options);
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
  level,
  bounds,
  builder,
  nameOf,
  candidateLabel,
  stats,
}: {
  /** The class levels step and its state, when the kind has one; without them the panel only moves the level. */
  stepId?: string;
  state?: ClassLevelState;
  level: number;
  bounds: { min?: number; max?: number };
  builder: CharacterBuilder;
  nameOf: (id: ElementId) => string;
  candidateLabel: (id: ElementId) => string;
  stats: ReadonlyArray<StatDef>;
}): React.JSX.Element {
  const [next, setNext] = useState<ElementId | undefined>(undefined);
  const classes = state?.firstClassId !== undefined ? state : undefined;
  const view = levelControlView(level, bounds, classes, nameOf);

  // What was picked, unless it has since stopped being available — a score changed elsewhere can
  // take a class out from under a control that is still on screen.
  const target =
    classes && next !== undefined && classes.options.some((option) => option.id === next && option.eligible)
      ? next
      : view.nextClass;
  const offNote = classes ? multiclassOffNote(classes, nameOf) : undefined;
  const canAddClass = classes !== undefined && classOptionGroups(classes.options).available.length > 0;

  // A class picked for one level up is spent by it: afterwards the control follows the last level again, so
  // removing that level does not leave the class it was in waiting beside Level up.
  const up = (): void => {
    if (stepId !== undefined && classes && target !== undefined) builder.addLevel(stepId, target);
    else builder.setProgress(level + 1);
    setNext(undefined);
  };
  const down = (): void => {
    if (view.down) builder.setProgress(view.down.level);
    setNext(undefined);
  };

  return (
    <div className="class-levels">
      <div className="level-head">
        <span className="level-number">
          Level <strong>{view.level}</strong>
        </span>
        {view.summary && <span className="class-summary">{view.summary}</span>}
        {/* How levelling behaves, kept off the panel: what stays on screen below is only what asks for attention. */}
        <InfoTip label="About levelling">
          {canAddClass && view.up && <span className="info-tip-para">{LEVEL_MULTICLASS_HINT}</span>}
          <span className="info-tip-para">{LEVEL_HINT}</span>
        </InfoTip>
      </div>

      <div className="level-actions">
        <button type="button" className="primary" disabled={!view.up} onClick={up}>
          {view.up ? view.up.label : 'Highest level reached'}
        </button>
        {classes && view.choosesClass && (
          <label className="level-class">
            in
            <select
              value={target}
              disabled={!view.up}
              aria-label={view.up ? `Class for level ${view.up.level}` : 'Class for the next level'}
              onChange={(event) => setNext(event.target.value)}
            >
              <ClassOptions options={classes.options} candidateLabel={candidateLabel} stats={stats} />
            </select>
          </label>
        )}
        <button
          type="button"
          className="level-down"
          disabled={!view.down}
          onClick={down}
        >
          {view.down ? view.down.label : 'Remove a level'}
        </button>
      </div>

      {state && state.firstClassId === undefined && (
        <p className="hint">{firstClassHint(state)}</p>
      )}

      {offNote && <p className={classes!.classes.length > 1 ? 'class-flag' : 'hint'}>{offNote}</p>}

      {classes?.options
        .filter((option) => option.taken && option.flag)
        .map((option) => (
          <p key={option.id} className="class-flag">
            {nameOf(option.id)} usually needs {shortfallText(option.flag!, stats)}. It is allowed here, and
            this note goes away when the score is high enough.
          </p>
        ))}

      {classes && classes.unassigned.length > 0 && (
        <p className="hint">
          {classes.unassigned.length === 1
            ? `Level ${classes.unassigned[0]} has no class recorded.`
            : `Levels ${classes.unassigned.join(', ')} have no class recorded.`}{' '}
          Choose one under {LEVEL_ROWS_LABEL}.
        </p>
      )}

      {classes && stepId !== undefined && (
        <>
          <ClassSplit
            stepId={stepId}
            state={classes}
            builder={builder}
            candidateLabel={candidateLabel}
            stats={stats}
          />

          {(view.choosesClass || classes.unassigned.length > 0) && (
          <details open={classes.unassigned.length > 0}>
            <summary>{LEVEL_ROWS_LABEL}</summary>
            <div className="class-level-rows">
              {classes.levels.map((row) => (
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
                        <ClassOptions options={classes.options} candidateLabel={candidateLabel} stats={stats} />
                      </select>
                    </>
                  )}
                </div>
              ))}
            </div>
            <p className="hint">
              Ability score minimums a class asks for are shown, not enforced: the class can be taken and the
              minimum is listed until the score reaches it. Anything else a class requires, such as not
              combining it with another edition of a class you have, still applies and is checked against the
              character as it is now. Changing a level's class clears a hit point roll made on a different die.
            </p>
          </details>
          )}
        </>
      )}
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
  const [rows, setRows] = useState<ClassSegment[] | undefined>(undefined);
  const [refused, setRefused] = useState(false);
  const draft = splitDraftView(state, rows ?? currentSplit(state));
  const shown = draft.rows;
  const wording = splitWording(state);

  const edit = (next: ClassSegment[]): void => {
    setRows(next);
    setRefused(false);
  };

  return (
    <details>
      <summary>{wording.label}</summary>
      <div className="class-split">
        <p className="hint">{wording.hint}</p>
        {shown.map((row, index) => (
          <div key={index} className="class-split-row">
            <select
              aria-label={index === 0 ? 'First class' : `Class ${index + 1}`}
              value={row.classId}
              onChange={(event) => edit(withSplitRow(shown, index, { classId: event.target.value }))}
            >
              <ClassOptions options={state.options} candidateLabel={candidateLabel} stats={stats} />
            </select>
            <input
              type="number"
              min={1}
              max={state.maxLevel}
              aria-label={`Levels in class ${index + 1}`}
              value={Number.isFinite(row.levels) ? row.levels : ''}
              onChange={(event) => edit(withSplitRow(shown, index, { levels: event.target.valueAsNumber }))}
            />
            <span className="class-split-buttons">
              <button type="button" className="link" disabled={index === 0} onClick={() => edit(movedSplitRow(shown, index, -1))}>
                Up
              </button>
              <button
                type="button"
                className="link"
                disabled={index === shown.length - 1}
                onClick={() => edit(movedSplitRow(shown, index, 1))}
              >
                Down
              </button>
              <button
                type="button"
                className="link"
                disabled={shown.length === 1}
                onClick={() => edit(withoutSplitRow(shown, index))}
              >
                Remove
              </button>
            </span>
          </div>
        ))}
        <div className="class-split-actions">
          {wording.addsClass && (
            <button type="button" className="link" onClick={() => edit(withAddedSplitRow(shown, state))}>
              Add a class
            </button>
          )}
          <span className="hint">{draft.totalText}</span>
          <button
            type="button"
            disabled={!draft.valid}
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
        {refused && <p className="hint">{SPLIT_REFUSED}</p>}
        {state.interleaved && (
          <p className="hint">{SPLIT_INTERLEAVED}</p>
        )}
      </div>
    </details>
  );
}
