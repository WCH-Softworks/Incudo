/**
 * A per-level recorded roll, as a view can render it — ADR 0019's hit points, and anything
 * shaped like them.
 *
 * The engine already sums `character.rolls` through a `{ "kind": "rolls" }` derive, and has
 * done since ADR 0019 landed. What it does not and must not do is decide *what to roll*: a
 * die has no formula, and a derivation that could produce one could silently reroll it every
 * time it ran. So the die comes from content — the element that governs a level names its die
 * on a setter (`step.levelRoll.dieSetter`, Aurora's own convention is `hd`) — and the roll
 * itself comes from a user clicking a button, exactly as a budgeted step's dice do
 * (`packages/ui/src/dice.ts`, `budget.ts`'s `rollBudgetValues`).
 *
 * One rule the rulebook states and content does not: the first level of a track is always the
 * die's maximum, never a roll and never an average. That is not a choice to render, so
 * `HitPointLevel.isFirst` says so and `planHitPointRecord` enforces it regardless of what a
 * caller asks for.
 */

import {
  type BuildStepDef,
  type Character,
  type DerivedCharacter,
  type ElementId,
  type Progression,
} from '@incudo/core';

import { parseDice, rollDice } from './dice.ts';

/** One level's roll, and everything a view needs to offer or show it. */
export interface HitPointLevel {
  level: number;
  /** The element that governs this level — a class, in 5e. Undefined until one is chosen. */
  classElementId?: ElementId;
  className?: string;
  /** The die's face count, read off `classElementId`'s own setter. */
  dieSides?: number;
  /**
   * Why `dieSides` could not be read, when a governing element is known but its die is not.
   *
   * Reported rather than guessed at (ADR 0005): recording a wrong die's roll would hand the
   * user a wrong hit point total with no way to tell.
   */
  unreadable?: string;
  /** `character.rolls[…]` for this level, once recorded. */
  recorded?: number;
  /** The fixed value the rules allow taking instead of rolling — floor(sides / 2) + 1. */
  average?: number;
  /** The progression's first level. Always the die's maximum; never rolled, never averaged. */
  isFirst: boolean;
  /**
   * The die this level adds to the total, when it is not a recorded roll: the maximum for the
   * first level and the average for every other, while the step's `fixedWhen` element is in the
   * character (ADR 0044 decision 6). Undefined otherwise, and while the die is unknown.
   */
  fixedValue?: number;
}

export interface HitPointState {
  pattern: string;
  levels: HitPointLevel[];
  /** Levels whose die is known and have nothing recorded yet — what a decision offers. */
  pending: HitPointLevel[];
  /**
   * The user has recorded a level in this session and has not confirmed the set yet.
   *
   * Not a property of the character: a save with every level recorded is finished, and opening
   * it must not ask again. It exists so the last roll does not close the decision under the
   * user's cursor — they can still roll again, type a value, or take the average until they say
   * they are done.
   */
  reviewing: boolean;
  /**
   * The character has the step's `fixedWhen` element, so every level is fixed and nothing is
   * offered to roll. Recorded rolls stay on the character and are not read (ADR 0044).
   */
  fixed: boolean;
}

/** The key one level's roll is recorded under: `hitPointRollKey("hp:level:{n}", 3)` is `"hp:level:3"`. */
export function hitPointRollKey(pattern: string, level: number): string {
  return pattern.replace('{n}', String(level));
}

export function progressionMin(progression: Progression): number {
  return progression.kind === 'none' ? 0 : (progression.min ?? 0);
}

/**
 * Everything a `levelRoll` step's editor needs, computed from the character and its elements.
 *
 * Pure, like `computeBudgetState`: it reads, it does not write, so calling it twice cannot
 * change a score. Undefined when the step declares no `levelRoll` at all, which is most steps.
 */
export function computeHitPointState(
  step: BuildStepDef,
  character: Character,
  derived: DerivedCharacter,
  progression: Progression,
  reviewing = false,
): HitPointState | undefined {
  const config = step.levelRoll;
  if (!config) return undefined;

  // The fallback for a character with no recorded advancement: the single element of the
  // governing type the character has stands in for every level. The same rule the engine
  // itself uses for an element reached by no track (ADR 0015) — untracked means "the whole
  // progression", not "unknown".
  const fallback = derived.elements.find((element) => element.type === config.classType);

  const fixed =
    config.fixedWhen !== undefined && derived.elements.some((element) => element.id === config.fixedWhen);

  const min = progressionMin(progression);
  const levels: HitPointLevel[] = [];
  for (let level = min; level <= character.progress; level += 1) {
    const advanced = character.advancement?.find((entry) => entry.at === level);
    // Advancement recorded and this level is in it: that element, however its die reads.
    // Advancement recorded and this level is not: genuinely unknown, so no fallback.
    // No advancement at all: the single governing element stands in for every level.
    const element = advanced
      ? derived.elements.find((e) => e.id === advanced.elementId)
      : character.advancement?.length
        ? undefined
        : fallback;

    const dieNotation = element?.setters[config.dieSetter]?.value;
    const parsed = dieNotation !== undefined ? parseDice(dieNotation) : undefined;
    const dieSides = parsed?.ok ? parsed.spec.sides : undefined;
    const key = hitPointRollKey(config.pattern, level);

    levels.push({
      level,
      classElementId: element?.id,
      className: element?.name,
      dieSides,
      unreadable:
        element === undefined
          ? undefined
          : dieNotation === undefined
            ? `"${element.name}" names no hit die`
            : parsed && !parsed.ok
              ? parsed.reason
              : undefined,
      recorded: character.rolls[key],
      average: dieSides !== undefined ? Math.floor(dieSides / 2) + 1 : undefined,
      isFirst: level === min,
      fixedValue:
        fixed && dieSides !== undefined ? (level === min ? dieSides : Math.floor(dieSides / 2) + 1) : undefined,
    });
  }

  return {
    pattern: config.pattern,
    levels,
    // Nothing is outstanding while the levels are fixed: there is no die to roll.
    pending: fixed ? [] : levels.filter((l) => l.dieSides !== undefined && l.recorded === undefined),
    reviewing: fixed ? false : reviewing,
    fixed,
  };
}

/** One roll to record: the key it goes under, and the value. */
export interface HitPointRecord {
  key: string;
  value: number;
}

/**
 * How a level's value is produced. `rollRerollOnes` is the table rule most groups play with:
 * roll the die, and if it lands on 1 roll it once more and keep that second result, whatever it
 * is. Not the Player's Handbook's, which is why it is a separate method and not a change to
 * `roll`.
 */
export type HitPointMethod = 'average' | 'roll' | 'rollRerollOnes';

/** A method, or a value the user typed. */
export type HitPointChange = HitPointMethod | { value: number };

function rollOne(sides: number, random: () => number): number {
  return rollDice({ count: 1, sides, dropLowest: 0, dropHighest: 0, modifier: 0 }, random).total;
}

function valueFor(method: HitPointMethod, sides: number, average: number, random: () => number): number {
  if (method === 'average') return average;
  const first = rollOne(sides, random);
  // A one-faced die cannot roll anything else, so there is nothing to gain by asking again.
  return method === 'rollRerollOnes' && first === 1 && sides > 1 ? rollOne(sides, random) : first;
}

/**
 * What recording a level should write — or nothing, when it is already recorded or its die is
 * unknown.
 *
 * `isFirst` overrides whatever `method` asked for: a first level is always the maximum, which
 * is a rule the Player's Handbook states rather than a choice a screen should offer. Idempotent
 * in the sense `rollBudgetValues` is — a level already holding a value is left alone, so calling
 * this again cannot change a number the user has already seen.
 */
export function planHitPointRecord(
  pattern: string,
  level: HitPointLevel,
  method: HitPointMethod,
  random: () => number,
): HitPointRecord | undefined {
  if (level.dieSides === undefined || level.recorded !== undefined) return undefined;
  const key = hitPointRollKey(pattern, level.level);
  if (level.isFirst) return { key, value: level.dieSides };
  return { key, value: valueFor(method, level.dieSides, level.average!, random) };
}

/**
 * What overwriting a level should write, or nothing when it may not be changed.
 *
 * The explicit counterpart of `planHitPointRecord`: that one refuses a level that already holds
 * a value so a repaint cannot reroll it, this one exists for the user who asked to. The first
 * level is refused outright — it is always the maximum, and a screen offering to change it would
 * be lying about there being a choice. A typed value is rounded and held to the die's faces
 * rather than refused, since a 14 on a d10 is a slip and not an intent.
 */
export function planHitPointChange(
  pattern: string,
  level: HitPointLevel,
  change: HitPointChange,
  random: () => number,
): HitPointRecord | undefined {
  if (level.dieSides === undefined || level.isFirst) return undefined;
  const key = hitPointRollKey(pattern, level.level);
  if (typeof change === 'object') {
    if (!Number.isFinite(change.value)) return undefined;
    return { key, value: Math.min(level.dieSides, Math.max(1, Math.round(change.value))) };
  }
  return { key, value: valueFor(change, level.dieSides, level.average!, random) };
}
