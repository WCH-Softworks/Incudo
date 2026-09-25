/**
 * Where a stat starts when an element the character holds prints it — ADR 0057.
 *
 * Some content states a number only as display text on a setter: a creature prints its six ability
 * scores as `<set name="strength">12</set>`, and no rule anywhere contributes them. A kind's
 * `setterStats` says which setters of which element types are where a stat *starts*: the value lands
 * where a declared default lands, a base the user set replaces it (ADR 0014), and every contribution
 * adds to whichever of the two is in force. Core names no setter, stat or type.
 *
 * One function answers it for the engine and for the builder, so an editor shows the starting value
 * the derivation used rather than a copy of the rule that might drift from it.
 */

import { chosenElementIds, type Character } from './character.ts';
import type { Element, ElementId, ElementIndex, StatKey } from './model.ts';
import {
  clampProgress,
  initialProgress,
  progressionStat,
  type ResolvedCharacterKind,
  type SetterStatDef,
} from './system.ts';

/** A stat's starting value, and the element and setter it was read from. */
export interface SetterStart {
  /** The stat as the kind declared it. */
  stat: StatKey;
  value: number;
  from: ElementId;
  setter: string;
}

/** Why a declared setter supplied nothing, or supplied something another element also supplied. */
export interface SetterStartNote {
  kind: 'not-a-number' | 'two-suppliers';
  stat: StatKey;
  setter: string;
  elementId: ElementId;
  /** The setter's text, for `not-a-number`. */
  text?: string;
  /** The element whose value is used instead, for `two-suppliers`. */
  usedFrom?: ElementId;
}

export interface SetterStarts {
  /** Keyed by the stat's lowercased name. */
  values: Map<StatKey, SetterStart>;
  notes: SetterStartNote[];
}

const PRINTED_NUMBER = /^\s*(\d+)(?:\s*\/\s*(\d+))?\s*(?:\([^()]*\))?\s*$/;

/**
 * A setter's text as a number, or undefined when it is not one.
 *
 * A whole number or a fraction, optionally followed by one parenthesised note: `12`, `1/4`,
 * `13 (natural armor)`, `2 (1d4)`. Nothing else — `14 + PB (natural armor)` is not 14, it is 14 plus
 * something, and reading the leading digits would publish a confident wrong number (ADR 0005).
 */
export function readSetterNumber(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const match = PRINTED_NUMBER.exec(text);
  if (!match) return undefined;
  const whole = Number(match[1]);
  if (match[2] === undefined) return whole;
  const denominator = Number(match[2]);
  return denominator === 0 ? undefined : whole / denominator;
}

/**
 * The starting value each declared stat takes from the elements the character holds.
 *
 * Elements are read in the order given, which for the engine is derivation order. When two elements
 * supply one stat the first is used and a note names both, rather than one silently winning. An
 * element that lacks the setter supplies nothing and says nothing: most elements of a type are not
 * required to print every stat. One that carries it with text that is not a number is noted.
 */
export function setterStartingValues(
  defs: readonly SetterStatDef[],
  elements: Iterable<Element>,
): SetterStarts {
  const values = new Map<StatKey, SetterStart>();
  const notes: SetterStartNote[] = [];
  if (defs.length === 0) return { values, notes };

  for (const element of elements) {
    for (const def of defs) {
      if (!def.types.includes(element.type)) continue;
      const setter = findSetter(element, def.setter);
      if (setter === undefined) continue;
      const key = def.stat.toLowerCase();
      const value = readSetterNumber(setter);
      if (value === undefined) {
        notes.push({ kind: 'not-a-number', stat: def.stat, setter: def.setter, elementId: element.id, text: setter });
        continue;
      }
      const existing = values.get(key);
      if (existing) {
        if (existing.from !== element.id) {
          notes.push({ kind: 'two-suppliers', stat: def.stat, setter: def.setter, elementId: element.id, usedFrom: existing.from });
        }
        continue;
      }
      values.set(key, { stat: def.stat, value, from: element.id, setter: def.setter });
    }
  }
  return { values, notes };
}

/** A setter by name, compared without case, as every other setter name is read. */
function findSetter(element: Element, name: string): string | undefined {
  const exact = element.setters[name];
  if (exact) return exact.value;
  const lower = name.toLowerCase();
  for (const [key, setter] of Object.entries(element.setters)) {
    if (key.toLowerCase() === lower) return setter.value;
  }
  return undefined;
}

/** Where a character is on its progression, and why — ADR 0060. */
export interface CharacterProgress {
  /** The number the derivation reads: a level, a challenge rating. */
  value: number;
  /** Whether the character records it (`Character.progress`), rather than starting where content prints it. */
  recorded: boolean;
  /** What an element the character chose prints for it, whether or not a recorded value replaces it. */
  printed?: SetterStart;
  /** Why a chosen element's print supplied nothing, or supplied the same stat twice. */
  notes: SetterStartNote[];
}

/**
 * The progression number a character is at — ADR 0060.
 *
 * What the character records, when it records one. Otherwise where an element it **chose** prints the
 * progression's stat, as the kind's `setterStats` says (a creature's challenge rating), and otherwise where
 * the kind's progression starts. The print is read from what the character chose and nothing it was granted,
 * because a grant may sit behind a gate that reads this very number; reading only the choices keeps the
 * answer free of that loop. The engine, the save and the builder all ask here, so the number a sheet shows,
 * the elements a save embeds and the value an editor offers to go back to are one answer.
 */
export function characterProgress(
  character: Character,
  kind: ResolvedCharacterKind,
  index: ElementIndex,
): CharacterProgress {
  const { printed, notes } = printedProgress(
    kind,
    chosenElementIds(character).flatMap((id) => index.get(id) ?? []),
  );
  if (character.progress !== undefined) return { value: character.progress, recorded: true, printed, notes };
  const value = clampProgress(kind.progression, printed?.value ?? initialProgress(kind.progression));
  return { value, recorded: false, printed, notes };
}

/**
 * What the given elements print for the kind's progression stat, as its `setterStats` says, and why any
 * supplied nothing — ADR 0060. `characterProgress` passes the elements a character chose; a library card
 * that kept only those passes them too.
 */
export function printedProgress(
  kind: ResolvedCharacterKind,
  elements: Iterable<Element>,
): { printed?: SetterStart; notes: SetterStartNote[] } {
  const stat = progressionStat(kind.progression)?.toLowerCase();
  if (stat === undefined) return { notes: [] };
  const defs = kind.setterStats.filter((def) => def.stat.toLowerCase() === stat);
  if (!defs.length) return { notes: [] };
  const starts = setterStartingValues(defs, elements);
  return { printed: starts.values.get(stat), notes: starts.notes };
}

/** Whether a kind's progression can start where a chosen element prints it — ADR 0060. */
export function progressCanBePrinted(kind: ResolvedCharacterKind): boolean {
  const stat = progressionStat(kind.progression)?.toLowerCase();
  return stat !== undefined && kind.setterStats.some((def) => def.stat.toLowerCase() === stat);
}
