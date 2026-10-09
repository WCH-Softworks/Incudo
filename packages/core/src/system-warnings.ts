/**
 * What a system definition that validates may still have wrong — ADR 0105.
 *
 * A stat a system names without declaring reads as 0 until content adds to it, and that is how a system reads what content
 * supplies (5e names 72 such stats in its player character's formulas). So naming one is not an error. A name one slip from
 * a declared one (`mght` beside `might`) is almost always a typo, though, and it reads 0 with no problem anywhere: a
 * warning, never a refusal.
 */

import { editDistance, type SchemaError } from './json-schema.ts';
import type { StatExpr } from './expression.ts';
import {
  resolveCharacterKind,
  TRACK_FIRST_STAT,
  TRACK_PROGRESS_STAT,
  type GameSystem,
  type StatDef,
} from './system.ts';

/**
 * Every stat name a system writes, in the places the validator does not hold to a declaration, that nothing declares and
 * that is a near miss of a name that is declared. Paths are into the system as given (for an overlay, the system it made).
 */
export function systemWarnings(system: GameSystem): SchemaError[] {
  const warnings = new Map<string, SchemaError>();
  const kinds = system.characterKinds ?? [];

  const check = (declared: readonly string[], known: ReadonlySet<string>, name: string, path: string): void => {
    if (warnings.has(path) || name.includes('{')) return;
    const lower = name.toLowerCase();
    if (known.has(lower)) return;
    const near = nearMiss(lower, declared);
    if (near === undefined) return;
    warnings.set(path, {
      path,
      message: `names "${name}", which this system does not declare; did you mean "${near}"? A stat nothing declares reads as 0 unless content adds to it.`,
    });
  };

  kinds.forEach((written, k) => {
    let kind;
    try {
      kind = resolveCharacterKind(system, written.id);
    } catch {
      return; // An unknown or cyclic `extends` is the validator's error, not this.
    }
    const declared = kind.stats.map((stat) => stat.name);
    if (kind.progression.kind !== 'none' && kind.progression.stat) declared.push(kind.progression.stat);
    const known = new Set([...declared, TRACK_PROGRESS_STAT, TRACK_FIRST_STAT].map((name) => name.toLowerCase()));
    const at = (name: string, path: string): void => check(declared, known, name, path);
    const where = `characterKinds[${k}]`;

    // The system's own stats are read against every kind: one written once is reported once, under the first kind that misses it.
    (system.stats ?? []).forEach((stat, i) => statNames(stat, `stats[${i}]`, at));
    (written.stats ?? []).forEach((stat, i) => statNames(stat, `${where}.stats[${i}]`, at));
    (written.contributions ?? []).forEach((entry, i) => {
      at(entry.stat, `${where}.contributions[${i}].stat`);
      refs(entry.value, `${where}.contributions[${i}].value`, at);
    });
    (written.trackStats ?? []).forEach((entry, i) => {
      at(entry.stat, `${where}.trackStats[${i}].stat`);
      refs(entry.value, `${where}.trackStats[${i}].value`, at);
    });
    (written.buildSteps ?? []).forEach((step, i) => {
      step.budget?.targets.forEach((target, j) => at(target, `${where}.buildSteps[${i}].budget.targets[${j}]`));
    });
  });
  return [...warnings.values()];
}

function statNames(stat: StatDef, path: string, at: (name: string, path: string) => void): void {
  if (stat.startsFrom !== undefined) at(stat.startsFrom, `${path}.startsFrom`);
  if (stat.derive !== undefined) refs(stat.derive, `${path}.derive`, at);
}

/** Every `ref` in an expression, with the path to its `stat`. */
function refs(expr: StatExpr, path: string, at: (name: string, path: string) => void): void {
  switch (expr.kind) {
    case 'ref':
      at(expr.stat, `${path}.stat`);
      return;
    case 'binary':
      refs(expr.left, `${path}.left`, at);
      refs(expr.right, `${path}.right`, at);
      return;
    case 'call':
      expr.args.forEach((arg, i) => refs(arg, `${path}.args[${i}]`, at));
      return;
    case 'table':
      refs(expr.index, `${path}.index`, at);
      return;
    default:
      return;
  }
}

/**
 * The declared name closest to `name`, when it is one slip away: an edit distance of at most 1 when the shorter of the two
 * has four letters or fewer (so `hp` is not taken for `ac`), else 2. Ties go to the name declared first.
 */
function nearMiss(name: string, declared: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of declared) {
    const distance = editDistance(name, candidate.toLowerCase());
    const allowed = Math.min(name.length, candidate.length) <= 4 ? 1 : 2;
    if (distance <= allowed && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
