/**
 * Where a system definition's error is, in words an author can follow — ADR 0103.
 *
 * The validator reports a path by position (`characterKinds[0].buildSteps[2].types`). Here each position in an array whose
 * entries have an identity is replaced by that identity as the file writes it (`characterKinds "pc" › buildSteps
 * "abilities" › types`), other positions are counted from 1 (`contributions #3`), and the error is given the line and
 * column where that value starts in the file. For an overlay (ADR 0102) the validator's errors are about the system it
 * made; each is followed back to the overlay's own text by identity, or said to be in the parent's part when the overlay
 * does not write it. The shells render `SystemProblem`s and compute nothing.
 */

import { OVERLAY_KEYED_ARRAYS, type GameSystem, type JsonPosition, type SchemaError } from '@incudo/core';

export interface SystemProblem {
  /** The path, ids in place of positions. Empty for a problem with the file as a whole (its JSON). */
  where: string;
  /** Where to look in the file, when the file says it. */
  line?: number;
  column?: number;
  message: string;
  /** For an overlay's error in a part it does not write: the parent system's name. */
  fromParent?: string;
}

/** What the errors are about, when it is not the file itself: the system an overlay made, and its parent. */
export interface AppliedOverlayContext {
  applied: GameSystem;
  parent: GameSystem;
}

type Segment = { field: string } | { index: number };

/**
 * Locate each error. `file` is the definition as written, `positions` where its values start (`readJsonText`); `overlay`
 * when the errors are about the system an overlay made rather than the file.
 */
export function describeSystemErrors(
  errors: readonly SchemaError[],
  file: unknown,
  positions: ReadonlyMap<string, JsonPosition> | undefined,
  overlay?: AppliedOverlayContext,
): SystemProblem[] {
  return errors.map((error) => {
    const segments = parsePath(error.path);
    const about = overlay ? overlay.applied : file;
    const where = describePath(about, segments);
    if (!overlay) return { where, message: error.message, ...lineOf(positions, segments) };

    const traced = traceIntoOverlay(segments, overlay.applied, file, overlay.parent);
    if (traced.fromParent) return { where, message: error.message, fromParent: overlay.parent.name };
    return { where, message: error.message, ...lineOf(positions, traced.segments) };
  });
}

/** One problem as one line: "Line 12, column 5: characterKinds "pc" › buildSteps "abilities": must not be empty". */
export function systemProblemLine(problem: SystemProblem): string {
  const at = problem.line !== undefined ? `Line ${problem.line}, column ${problem.column}: ` : '';
  const part = problem.fromParent
    ? `In ${problem.fromParent}'s part, which something this file changes or removes breaks: `
    : '';
  const where = problem.where ? `${problem.where}: ` : '';
  return `${at}${part}${where}${problem.message}`;
}

/** A file that is not JSON, as a problem: its line and column, and the reader's sentence. */
export function syntaxProblem(problem: { message: string; line: number; column: number }): SystemProblem {
  return { where: '', line: problem.line, column: problem.column, message: problem.message };
}

function parsePath(path: string): Segment[] {
  const out: Segment[] = [];
  for (const match of path.matchAll(/\[(\d+)\]|([^.[\]]+)/g)) {
    if (match[1] !== undefined) out.push({ index: Number(match[1]) });
    else out.push({ field: match[2]! });
  }
  return out;
}

function render(segments: readonly Segment[]): string {
  let out = '';
  for (const segment of segments) {
    if ('index' in segment) out += `[${segment.index}]`;
    else out += out === '' ? segment.field : `.${segment.field}`;
  }
  return out;
}

/** The table's key for an array reached by these segments, if its entries have an identity. */
function identityKey(segments: readonly Segment[]): string | undefined {
  const pattern = segments
    .map((segment) => ('index' in segment ? '[]' : segment.field))
    .join('.')
    .replace(/\.\[\]/g, '[]');
  return OVERLAY_KEYED_ARRAYS[pattern];
}

function describePath(document: unknown, segments: readonly Segment[]): string {
  const parts: string[] = [];
  let node: unknown = document;
  segments.forEach((segment, i) => {
    if ('field' in segment) {
      parts.push(segment.field);
      node = isObject(node) ? node[segment.field] : undefined;
      return;
    }
    const entry = Array.isArray(node) ? node[segment.index] : undefined;
    const key = identityKey(segments.slice(0, i));
    const identity = key && isObject(entry) && typeof entry[key] === 'string' ? (entry[key] as string) : undefined;
    const label = identity !== undefined ? JSON.stringify(identity) : `#${segment.index + 1}`;
    if (parts.length) parts[parts.length - 1] += ` ${label}`;
    else parts.push(label);
    node = entry;
  });
  return parts.join(' › ');
}

/** The line of the deepest of these segments the file has, or nothing when it has none of them. */
function lineOf(positions: ReadonlyMap<string, JsonPosition> | undefined, segments: readonly Segment[]): Partial<JsonPosition> {
  if (!positions) return {};
  for (let n = segments.length; n >= 0; n--) {
    const found = positions.get(render(segments.slice(0, n)));
    if (found) return { line: found.line, column: found.column };
  }
  return {};
}

/**
 * Follow a path in the applied system into the overlay's own text, by identity. The result is the overlay's path to the
 * deepest part of it the overlay writes; `fromParent` when the rest is the parent's, unchanged, which happens when the
 * overlay changed or removed something the parent's part depends on.
 */
function traceIntoOverlay(
  segments: readonly Segment[],
  applied: unknown,
  overlay: unknown,
  parent: unknown,
): { segments: Segment[]; fromParent: boolean } {
  const out: Segment[] = [];
  let inApplied: unknown = applied;
  let inOverlay: unknown = overlay;
  let inParent: unknown = parent;
  let i = 0;
  for (; i < segments.length; i++) {
    const segment = segments[i]!;
    if ('field' in segment) {
      if (!isObject(inOverlay) || !(segment.field in inOverlay)) break;
      out.push(segment);
      inApplied = isObject(inApplied) ? inApplied[segment.field] : undefined;
      inOverlay = inOverlay[segment.field];
      inParent = isObject(inParent) ? inParent[segment.field] : undefined;
      continue;
    }
    const key = identityKey(segments.slice(0, i));
    const entry = Array.isArray(inApplied) ? inApplied[segment.index] : undefined;
    if (key === undefined) {
      // Not merged by identity: the overlay replaced this array whole, so a position in it is the overlay's position.
      if (!Array.isArray(inOverlay) || segment.index >= inOverlay.length) break;
      out.push(segment);
      inApplied = entry;
      inOverlay = inOverlay[segment.index];
      inParent = undefined;
      continue;
    }
    const identity = isObject(entry) ? entry[key] : undefined;
    const at = Array.isArray(inOverlay) ? inOverlay.findIndex((item) => isObject(item) && item[key] === identity) : -1;
    const inParentNext = Array.isArray(inParent) ? inParent.find((item) => isObject(item) && item[key] === identity) : undefined;
    if (at < 0) {
      inParent = inParentNext;
      i++;
      // The overlay does not write this entry: it is the parent's, whatever is wrong further in.
      return { segments: out, fromParent: inParentNext !== undefined || out.length === 0 };
    }
    out.push({ index: at });
    inApplied = entry;
    inOverlay = (inOverlay as unknown[])[at];
    inParent = inParentNext;
  }
  if (i === segments.length) return { segments: out, fromParent: false };
  // The overlay writes the entry or object here but not what lies further in. If the parent has the rest unchanged, the
  // error is in the parent's text; otherwise (a field the overlay added an entry without, say) it is the overlay's.
  const rest = segments.slice(i);
  return { segments: out, fromParent: inParent !== undefined && reaches(inParent, rest) };
}

function reaches(node: unknown, segments: readonly Segment[]): boolean {
  let at = node;
  for (const segment of segments) {
    if ('field' in segment) {
      if (!isObject(at) || !(segment.field in at)) return false;
      at = at[segment.field];
    } else {
      if (!Array.isArray(at) || segment.index >= at.length) return false;
      at = at[segment.index];
    }
  }
  return true;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
