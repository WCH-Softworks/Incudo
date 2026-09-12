/**
 * A budgeted build step, as a view can render it — ADR 0017.
 *
 * This is the whole of the ability score editor that is not a `<div>`. Everything that
 * computes an answer — what a score costs, whether the next point is affordable, which of six
 * rolled values is still unplaced, what happens when you drop a 15 on a target that already
 * holds one — is here, in a file that runs under `node --test`. The shells render numbers.
 *
 * That split is docs/CODE-REUSE-POLICY.md rule 2, and it has a stated test: if a bug is
 * "point buy let me spend 28 points" it must be fixable in a package. So the cost table is read
 * from `GenerationMethodDef` (declared data — `systems/dnd5e/system.json`), the affordability
 * question is answered here, and the shell's only job is to disable a button this file says is
 * disabled and call a write this file has already validated.
 *
 * Nothing in here is an ability score, a point buy or a standard array. It is "this step
 * distributes values across these stats, by one of these methods", and the 5e-ness is entirely
 * in the data (ADR 0003).
 */

import {
  type BuildStepDef,
  type Character,
  type DerivedCharacter,
  type GameSystem,
  type GenerationMethodDef,
  type ResolvedCharacterKind,
  type StatKey,
} from '@incudo/core';

import { parseDice, rollDice, type DiceRoll } from './dice.ts';

/**
 * Which kind of question a method asks. The three are genuinely different, which is why one
 * editor cannot be written for them and why `BudgetState` carries all three shapes.
 *
 *  - `points` — a pool and a cost table. You buy values.
 *  - `assignment` — a fixed set of values (declared, or rolled) handed out one per target.
 *  - `free` — you type numbers, bounded by whatever the method declares.
 */
export type BudgetMode = 'points' | 'assignment' | 'free';

/** One target stat of a budget, with everything a row of the editor needs. */
export interface BudgetRow {
  stat: StatKey;
  /**
   * The base the user set — `Character.baseStats` (ADR 0014). Undefined until they set one.
   *
   * A *base*, never a total: a racial +2 is not in here and must never be written here.
   */
  base?: number;
  /** What the derivation reads for this stat: the base plus everything content adds. */
  total: number;
  /**
   * What the derivation adds on top of the base — the racial +2, a feat's +1, an ASI.
   *
   * Shown because ADR 0014's trap is invisible otherwise: a user who types 15 and sees 17 has
   * been told the difference between a base and an override, in the only place it matters.
   */
  bonus: number;
  /** What this base cost, for a `points` method. 0 for every other mode. */
  cost: number;
  /** The next legal value up, what it would cost, and whether the pool covers it. */
  increase?: { value: number; cost: number; affordable: boolean };
  /** The next legal value down, and what it refunds. */
  decrease?: { value: number; refund: number };
  /** The lowest and highest base this method allows, where it declares them. */
  min?: number;
  max?: number;
}

/** One of the values an `assignment` method hands out, and where it went. */
export interface BudgetPoolValue {
  value: number;
  /** The target holding it, or undefined while it is still to be placed. */
  assignedTo?: StatKey;
}

/** A rolled method's dice, and how far through rolling them the character is. */
export interface BudgetDice {
  /** The notation as the system declared it, e.g. `"4d6dl1"`. */
  notation: string;
  /** How many values this method produces. */
  count: number;
  /** How many have been rolled and recorded so far. */
  rolled: number;
  /**
   * Why the notation could not be read, when it could not.
   *
   * Reported rather than guessed at (ADR 0005): a shell that silently rolled 1d6 for an
   * unreadable notation would hand the user six wrong scores and no way to know.
   */
  unreadable?: string;
}

/**
 * A points pool, as a view can render it — ADR 0017.
 *
 * `granted` is the budget stat, summed by the engine like any other, so whatever content adds
 * to it lands here without this file knowing what did. `spent` depends on the method, because
 * the methods are genuinely different questions: point buy spends from a pool, a standard
 * array assigns a fixed set, rolling assigns what you rolled, manual entry is neither.
 */
export interface BudgetState {
  stat: StatKey;
  targets: StatKey[];
  /** The methods this step offers, resolved from the system. */
  methods: GenerationMethodDef[];
  /** The method the character used, if one has been recorded. */
  methodId?: string;
  /** Which of the three questions the recorded method asks. `free` with no method chosen. */
  mode: BudgetMode;
  /** Points available: the method's own pool plus whatever content granted. */
  available: number;
  /** The part of `available` that came from content rather than from the method. */
  granted: number;
  spent: number;
  remaining: number;
  /** Targets with no value set yet. A budget is open while any of these remain. */
  unassigned: StatKey[];
  /** True when this method is a pool of points rather than a set of values to assign. */
  pooled: boolean;
  /** One row per target, in the order the budget declares them. */
  rows: BudgetRow[];
  /** The values an `assignment` method hands out. Empty in the other two modes. */
  pool: BudgetPoolValue[];
  /** Present when the method rolls for its values. */
  dice?: BudgetDice;
}

/**
 * The key a budget's nth rolled value is recorded under — `"abilities:roll:0"`.
 *
 * `Character.rolls` is the home for a recorded random result (ADR 0007) and the same shape
 * ADR 0019's `hp:level:3` already uses. It is keyed by the *step*, not by the target stat,
 * because a rolled set is produced before anybody knows which score it will become — that is
 * the whole of what assigning it means.
 */
export function budgetRollKey(stepId: string, index: number): string {
  return `${stepId}:roll:${index}`;
}

/** Values a method can produce, in ascending order. Empty when it declares no bounds at all. */
function attainableValues(method: GenerationMethodDef | undefined): number[] {
  if (!method) return [];
  if (method.costs) {
    return Object.keys(method.costs)
      .map(Number)
      .filter((value) => Number.isFinite(value))
      .filter((value) => (method.min === undefined || value >= method.min))
      .filter((value) => (method.max === undefined || value <= method.max))
      .sort((a, b) => a - b);
  }
  if (method.min !== undefined && method.max !== undefined) {
    const values: number[] = [];
    for (let value = method.min; value <= method.max; value += 1) values.push(value);
    return values;
  }
  return [];
}

function costOf(method: GenerationMethodDef | undefined, value: number | undefined): number {
  if (value === undefined || !method?.costs) return 0;
  return method.costs[String(value)] ?? 0;
}

/** Which of the three questions a method asks. */
export function modeOf(method: GenerationMethodDef | undefined): BudgetMode {
  if (!method) return 'free';
  if (method.costs !== undefined || method.pool !== undefined) return 'points';
  if (method.values !== undefined || method.dice !== undefined) return 'assignment';
  return 'free';
}

/** The values an assignment method hands out: the declared array, or whatever was rolled. */
function poolValuesFor(
  stepId: string,
  method: GenerationMethodDef | undefined,
  character: Character,
): number[] {
  if (!method) return [];
  if (method.values) return [...method.values];
  if (!method.dice) return [];
  const values: number[] = [];
  for (let i = 0; i < (method.count ?? 0); i += 1) {
    const recorded = character.rolls[budgetRollKey(stepId, i)];
    if (recorded !== undefined) values.push(recorded);
  }
  return values;
}

/**
 * Everything a budgeted step's editor needs, computed from the character and the system.
 *
 * Pure: it reads, it does not write, and calling it twice cannot change a score. That matters
 * most for the rolled method — see `rollBudgetValues`.
 */
export function computeBudgetState(
  step: BuildStepDef,
  character: Character,
  derived: DerivedCharacter,
  system: GameSystem,
  kind: ResolvedCharacterKind,
): BudgetState {
  const budget = step.budget!;
  const methods = (budget.methods ?? [])
    .map((id) => (system.generationMethods ?? []).find((m) => m.id === id))
    .filter((m): m is GenerationMethodDef => m !== undefined);
  const methodId = character.generation?.[step.id];
  const method = methods.find((m) => m.id === methodId);
  const mode = modeOf(method);

  const base = character.baseStats ?? {};
  const valueOf = (stat: StatKey): number | undefined => base[stat] ?? base[stat.toLowerCase()];

  const granted = derived.stats.get(budget.stat.toLowerCase())?.value ?? 0;
  // A points method is one that says what a value costs. Reporting a pool for a rolled set
  // would be a fiction — you did not buy those numbers, you rolled them.
  const pooled = mode === 'points';
  const available = (method?.pool ?? 0) + granted;

  let spent = 0;
  if (pooled) {
    for (const target of budget.targets) spent += costOf(method, valueOf(target));
  }
  const remaining = available - spent;

  const attainable = attainableValues(method);
  const rows: BudgetRow[] = budget.targets.map((stat) => {
    const current = valueOf(stat);
    const resolved = derived.stats.get(stat.toLowerCase());
    const declaredDefault = kind.stats.find((s) => s.name.toLowerCase() === stat.toLowerCase())
      ?.default;
    const fallback = typeof declaredDefault === 'number' ? declaredDefault : 0;
    const total = resolved?.value ?? current ?? fallback;
    const cost = costOf(method, current);

    let increase: BudgetRow['increase'];
    let decrease: BudgetRow['decrease'];
    if (mode !== 'assignment' && attainable.length) {
      const next = current === undefined
        ? attainable[0]
        : attainable.find((value) => value > current);
      if (next !== undefined) {
        const price = costOf(method, next) - cost;
        increase = { value: next, cost: price, affordable: !pooled || price <= remaining };
      }
      const below = current === undefined
        ? undefined
        : [...attainable].reverse().find((value) => value < current);
      if (below !== undefined) decrease = { value: below, refund: cost - costOf(method, below) };
    }

    return {
      stat,
      base: current,
      total,
      bonus: total - (current ?? fallback),
      cost,
      increase,
      decrease,
      min: method?.min,
      max: method?.max,
    };
  });

  // The pool, and which target holds each value. Matched as a multiset, one entry per target,
  // so two rolled 14s and two targets holding 14 account for each other exactly once.
  const pool: BudgetPoolValue[] = poolValuesFor(step.id, method, character).map((value) => ({
    value,
  }));
  if (mode === 'assignment') {
    for (const stat of budget.targets) {
      const held = valueOf(stat);
      if (held === undefined) continue;
      const slot = pool.find((entry) => entry.value === held && entry.assignedTo === undefined);
      if (slot) slot.assignedTo = stat;
    }
  }

  let dice: BudgetDice | undefined;
  if (method?.dice) {
    const parsed = parseDice(method.dice);
    const count = method.count ?? 1;
    let rolled = 0;
    for (let i = 0; i < count; i += 1) {
      if (character.rolls[budgetRollKey(step.id, i)] !== undefined) rolled += 1;
    }
    dice = {
      notation: method.dice,
      count,
      rolled,
      unreadable: parsed.ok ? undefined : parsed.reason,
    };
  }

  return {
    stat: budget.stat,
    targets: budget.targets,
    methods,
    methodId,
    mode,
    available,
    granted,
    spent,
    remaining,
    unassigned: budget.targets.filter((target) => valueOf(target) === undefined),
    pooled,
    rows,
    pool,
    dice,
  };
}

/** One base stat to write. `undefined` clears it, which is what "unassign this" means. */
export interface BudgetWrite {
  stat: StatKey;
  value: number | undefined;
}

/**
 * What setting a target to `value` should write — or nothing, when the budget refuses it.
 *
 * The refusals are the point of this function. A `points` method refuses a value it cannot
 * afford and one its cost table does not price; an `assignment` method refuses a value that is
 * not in the pool; a `free` method clamps to the declared bounds. None of that may live in a
 * shell, because "point buy let me spend 28 points" has to be fixable here.
 *
 * **An `assignment` method swaps rather than duplicating.** Six values, six targets, each used
 * once: dropping the 15 on a target while another already holds it hands that other target
 * whatever this one was holding. Silently allowing two 15s would let the user build a set the
 * method could never produce, and clearing the other target would lose a value out of the pool.
 */
export function planBudgetSet(
  state: BudgetState,
  stat: StatKey,
  value: number | undefined,
): BudgetWrite[] {
  if (!state.targets.some((target) => target.toLowerCase() === stat.toLowerCase())) return [];
  const row = state.rows.find((r) => r.stat === stat);
  if (!row) return [];
  if (value === undefined) return [{ stat, value: undefined }];

  if (state.mode === 'assignment') {
    const copies = state.pool.filter((entry) => entry.value === value).length;
    if (copies === 0) return [];
    const holders = state.rows.filter((r) => r.stat !== stat && r.base === value);
    // A spare copy of this value is still in the pool: nothing has to move.
    if (holders.length < copies) return [{ stat, value }];
    const swapWith = holders[0]!;
    return [
      { stat, value },
      { stat: swapWith.stat, value: row.base },
    ];
  }

  if (state.mode === 'points') {
    const method = state.methods.find((m) => m.id === state.methodId);
    if (method?.costs && method.costs[String(value)] === undefined) return [];
    if (method?.min !== undefined && value < method.min) return [];
    if (method?.max !== undefined && value > method.max) return [];
    const price = costOf(method, value) - row.cost;
    if (price > state.remaining) return [];
    return [{ stat, value }];
  }

  // Free entry: the method's bounds are the only rule, and they are a clamp rather than a
  // refusal — a user holding the up-arrow on a number field should stop at 30, not be ignored.
  const min = state.rows.find((r) => r.stat === stat)?.min;
  const max = state.rows.find((r) => r.stat === stat)?.max;
  let clamped = value;
  if (min !== undefined) clamped = Math.max(min, clamped);
  if (max !== undefined) clamped = Math.min(max, clamped);
  return [{ stat, value: clamped }];
}

/**
 * What moving a target one step up or down should write — the `+` and `−` of a point-buy row.
 *
 * A step is not always 1: the step up from a value the cost table skips is the next value it
 * prices. The row already carries where it would land and what it would cost, so this is that
 * decision applied rather than re-derived.
 */
export function planBudgetAdjust(
  state: BudgetState,
  stat: StatKey,
  delta: number,
): BudgetWrite[] {
  const row = state.rows.find((r) => r.stat === stat);
  if (!row || delta === 0) return [];
  if (delta > 0) {
    if (!row.increase?.affordable) return [];
    return planBudgetSet(state, stat, row.increase.value);
  }
  if (!row.decrease) return [];
  return planBudgetSet(state, stat, row.decrease.value);
}

/** One recorded roll: the key it goes under, and what came up. */
export interface BudgetRollResult {
  key: string;
  roll: DiceRoll;
}

/**
 * Roll the values a rolled method still owes, and nothing else.
 *
 * **Only the unrolled slots**, which is ADR 0007 enforced rather than hoped for: a recorded
 * result is an input and never silently disappears, so this can be called twice and the first
 * six numbers will still be the first six numbers. Re-rolling is a separate, explicit act that
 * clears them first — there is no path from a re-render to a new score, because re-rendering
 * calls `computeBudgetState`, which writes nothing.
 */
export function rollBudgetValues(
  stepId: string,
  state: BudgetState,
  character: Character,
  random: () => number,
): BudgetRollResult[] {
  const method = state.methods.find((m) => m.id === state.methodId);
  if (!method?.dice) return [];
  const parsed = parseDice(method.dice);
  if (!parsed.ok) return [];

  const results: BudgetRollResult[] = [];
  for (let i = 0; i < (method.count ?? 1); i += 1) {
    const key = budgetRollKey(stepId, i);
    if (character.rolls[key] !== undefined) continue;
    results.push({ key, roll: rollDice(parsed.spec, random) });
  }
  return results;
}

/**
 * The values a method should start its targets at, when picking it implies one.
 *
 * Point buy starts every score at its minimum, because that *is* the method: 8s across the
 * board is the zero-spend state, and without it the first `+` has nowhere to start from. The
 * other two modes start empty — a rolled set has no values until dice are thrown, and a
 * standard array's 15 belongs to whichever target the user drops it on.
 */
export function initialBudgetValues(
  targets: StatKey[],
  method: GenerationMethodDef | undefined,
  character: Character,
): BudgetWrite[] {
  if (modeOf(method) !== 'points') return [];
  const start = method?.min ?? attainableValues(method)[0];
  if (start === undefined) return [];
  const base = character.baseStats ?? {};
  return targets
    .filter((stat) => (base[stat] ?? base[stat.toLowerCase()]) === undefined)
    .map((stat) => ({ stat, value: start }));
}

/**
 * Whether a value already held is one the given method could have produced.
 *
 * The rule for what survives a change of method, and it is a rule about the *mode* rather than
 * about the number: **a method that hands out or prices values starts clean; a free method
 * keeps what it is given.**
 *
 * Both halves earn their place. Point buy and a standard array are authorities on their own
 * values — a rolled 9 that the cost table happens to price is not a bought 9, and keeping it
 * would leave one score as a leftover roll inside a spend nobody made. Free entry is a superset
 * of all of them, so it can hold what any of them produced, and a character imported from
 * Aurora — six real scores, no recorded method, which is all nine of the sample saves — keeps
 * them when the user picks "enter manually" to fine-tune.
 */
export function canExpressValue(
  method: GenerationMethodDef | undefined,
  value: number | undefined,
): boolean {
  if (value === undefined) return true;
  if (modeOf(method) !== 'free') return false;
  if (method?.min !== undefined && value < method.min) return false;
  if (method?.max !== undefined && value > method.max) return false;
  return true;
}
