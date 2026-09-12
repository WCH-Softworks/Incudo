/**
 * A budgeted build step, on screen — 5e's ability scores, and anything shaped like them.
 *
 * **This file computes nothing.** Every number below comes off `BudgetState`, every control is
 * enabled or disabled by a flag `packages/ui` set, and every click calls a write that
 * `planBudgetSet` has already validated. That is deliberate and it is testable:
 * docs/CODE-REUSE-POLICY.md rule 2 says a bug like "point buy let me spend 28 points" must be
 * fixable in a package, and it is — `packages/ui/src/budget.ts`, with assertions in Node. If a
 * cost table, a die, a pool or a bound ever appears in this file, that guarantee is gone.
 *
 * Nothing here says "ability score", "Strength" or "27" either. The three modes come from the
 * method the system declared (`points` / `assignment` / `free`), the labels come from the
 * kind's stat list, and a system with a wholly different budget gets this editor for free
 * (ADR 0003, ADR 0011).
 *
 * The one thing worth looking at twice is the **base / bonus / total** triple on each row.
 * ADR 0014's trap is that `baseStats` is a base and not an override, so a racial +2 lands on
 * top of what you entered — and a user who types 15 and sees 17 has no way to know that unless
 * the screen shows both halves. It shows both halves.
 */

import type { BudgetRow, BudgetState, CharacterBuilder } from '@incudo/ui';
import type { ResolvedCharacterKind, StatKey } from '@incudo/core';

export function BudgetEditor({
  stepId,
  budget,
  builder,
  kind,
}: {
  stepId: string;
  budget: BudgetState;
  builder: CharacterBuilder;
  kind: ResolvedCharacterKind;
}): React.JSX.Element {
  const labelOf = (stat: StatKey): string =>
    kind.stats.find((s) => s.name.toLowerCase() === stat.toLowerCase())?.label ?? stat;

  return (
    <div className="budget">
      <div className="budget-methods">
        {budget.methods.map((method) => (
          <label key={method.id} className={budget.methodId === method.id ? 'on' : ''}>
            <input
              type="radio"
              name={`method:${stepId}`}
              checked={budget.methodId === method.id}
              onChange={() => builder.setGenerationMethod(stepId, method.id)}
            />
            {method.label ?? method.id}
          </label>
        ))}
      </div>

      {budget.methodId === undefined && (
        // The rows below are shown anyway, and that is not laziness. Every character imported
        // from Aurora lands in this state — six real scores and no recorded method, because
        // Aurora records none — so hiding the editor until a method is picked would make those
        // six unreadable, and picking one to see them is how a user would have lost them.
        <p className="hint">
          No method recorded, so these are free entry. Choosing one below is optional and is
          recorded on the character, so reopening this at level 4 knows whether it is adding to
          a spend or to a rolled set (ADR 0017). Point buy and the standard array start clean,
          because they are authorities on their own values; manual entry keeps what is here.
        </p>
      )}

      {budget.pooled && (
        <p className="budget-pool">
          <strong>
            {budget.remaining} of {budget.available}
          </strong>{' '}
          {labelOf(budget.stat).toLowerCase()} left
          {budget.granted > 0 && (
            // ADR 0017's headline case: something later in the build handed you points, and
            // they arrive here rather than behind a Back button.
            <span className="hint"> — {budget.granted} of them granted by what you chose</span>
          )}
        </p>
      )}

      {budget.dice && <Dice stepId={stepId} budget={budget} builder={builder} />}

      {budget.mode === 'assignment' && budget.pool.length > 0 && (
        <Pool budget={budget} labelOf={labelOf} />
      )}

      <table className="budget-rows">
        <thead>
          <tr>
            <th>{/* the stat's own name is in the row; a header would only repeat it */}</th>
            <th className="numeric">Base</th>
            <th className="numeric">From elsewhere</th>
            <th className="numeric">Total</th>
            {budget.pooled && <th className="numeric">Cost</th>}
          </tr>
        </thead>
        <tbody>
          {budget.rows.map((row) => (
            <tr key={row.stat}>
              <th scope="row">{labelOf(row.stat)}</th>
              <td className="numeric">
                <Base stepId={stepId} budget={budget} row={row} builder={builder} />
              </td>
              <td className="numeric muted">{row.bonus === 0 ? '—' : signed(row.bonus)}</td>
              <td className="numeric total">{row.total}</td>
              {budget.pooled && <td className="numeric muted">{row.cost}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="hint">
        <strong>Base</strong> is what you chose, and the only thing stored (ADR 0014).
        <strong> From elsewhere</strong> is what your race, class, feats and items add on top of
        it — a base is not an override, so nothing here replaces what you entered.
        <strong> Total</strong> is what the sheet reads, and every number derived from it follows.
        A negative figure in the middle column means a limit the system declares has clipped your
        base — 5e caps an ability score at 20 unless something raises the cap (ADR 0016).
      </p>
    </div>
  );
}

/** One target's base value: a pool picker, a stepper, or a number field. */
function Base({
  stepId,
  budget,
  row,
  builder,
}: {
  stepId: string;
  budget: BudgetState;
  row: BudgetRow;
  builder: CharacterBuilder;
}): React.JSX.Element {
  const set = (raw: string): void =>
    builder.setBudgetStat(stepId, row.stat, raw === '' ? undefined : Number(raw));

  if (budget.mode === 'assignment') {
    return (
      <select value={row.base ?? ''} onChange={(event) => set(event.target.value)}>
        <option value="">—</option>
        {/*
          Every value in the pool, whoever currently holds it: choosing one another row holds
          swaps the two, which is `planBudgetSet`'s decision and not this select's. Repeated
          values collapse to one option, because picking "the other 14" is not a choice.
        */}
        {[...new Set(budget.pool.map((entry) => entry.value))]
          .sort((a, b) => b - a)
          .map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
      </select>
    );
  }

  if (budget.pooled) {
    return (
      <span className="stepper">
        <button
          type="button"
          disabled={!row.decrease}
          title={row.decrease && `down to ${row.decrease.value}, refunding ${row.decrease.refund}`}
          onClick={() => builder.adjustBudgetStat(stepId, row.stat, -1)}
        >
          −
        </button>
        <b>{row.base ?? '—'}</b>
        <button
          type="button"
          disabled={!row.increase?.affordable}
          title={
            row.increase
              ? `up to ${row.increase.value}, costing ${row.increase.cost}` +
                (row.increase.affordable ? '' : ' — more than is left')
              : 'this method offers no higher value'
          }
          onClick={() => builder.adjustBudgetStat(stepId, row.stat, +1)}
        >
          +
        </button>
      </span>
    );
  }

  return (
    <input
      type="number"
      value={row.base ?? ''}
      min={row.min}
      max={row.max}
      onChange={(event) => set(event.target.value)}
    />
  );
}

function Dice({
  stepId,
  budget,
  builder,
}: {
  stepId: string;
  budget: BudgetState;
  builder: CharacterBuilder;
}): React.JSX.Element {
  const dice = budget.dice!;

  if (dice.unreadable) {
    // Reported rather than guessed at (ADR 0005). Rolling a d6 six times for a notation nobody
    // could read would hand the user six wrong scores and no way to tell.
    return (
      <div className="problem error">
        <strong>This method's dice cannot be read.</strong>
        <p>
          {dice.unreadable} — the system definition declares <code>{dice.notation}</code>. Nothing
          was rolled, because a guess would produce scores that look exactly like yours.
        </p>
      </div>
    );
  }

  return (
    <p className="budget-dice">
      {/* Gone rather than disabled once everything is rolled: a greyed-out "Roll 0 × 4d6dl1"
          is what it said on the first run, and it reads like a bug. */}
      {dice.rolled < dice.count && (
        <button type="button" onClick={() => builder.rollBudget(stepId)}>
          Roll {dice.count - dice.rolled} × <code>{dice.notation}</code>
        </button>
      )}
      {dice.rolled > 0 && (
        <button type="button" onClick={() => builder.clearBudgetRolls(stepId)}>
          Discard and roll again
        </button>
      )}
      <span className="hint">
        {dice.rolled} of {dice.count} rolled. A roll is recorded, never recomputed (ADR 0019) —
        nothing on this screen rerolls one, and discarding is something you have to ask for.
      </span>
    </p>
  );
}

/** The values an assignment method handed out, and where each one went. */
function Pool({
  budget,
  labelOf,
}: {
  budget: BudgetState;
  labelOf: (stat: StatKey) => string;
}): React.JSX.Element {
  return (
    <p className="budget-values">
      {budget.pool.map((entry, i) => (
        <span key={i} className={entry.assignedTo ? 'value taken' : 'value'}>
          {entry.value}
          {entry.assignedTo && <small>{labelOf(entry.assignedTo)}</small>}
        </span>
      ))}
    </p>
  );
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
