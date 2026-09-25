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

import type { Element, ElementId, StatKey } from './model.ts';
import type { SetterStatDef } from './system.ts';

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
