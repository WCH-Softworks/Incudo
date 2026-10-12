/**
 * A system overlay applied to its parent — ADR 0102.
 *
 * An overlay is a system definition with a root `extends`, written as a patch: objects merge key by key, an array whose
 * entries have an identity merges entry by entry, anything else is replaced. This file applies one and says what it
 * changed; it validates nothing. `validateGameSystem` (schema.ts) checks the overlay's shell, applies it here and checks
 * the result as a complete system, so nothing past the validator ever sees a patch.
 *
 * Nothing here names a game. The table below names fields of the system format, which is this package's own vocabulary.
 */

import type { GameSystem } from './system.ts';

/**
 * The arrays of the system format whose entries are merged by identity, and the field that is the identity. A path is
 * field names from the root, `[]` standing for "every entry of this array". Every other array is replaced whole.
 *
 * A guard test walks `system.schema.json` and fails on an array of objects whose entries require `id`, `name` or `key`
 * and that is not here, so a new one cannot quietly be replaced whole.
 */
export const OVERLAY_KEYED_ARRAYS: Readonly<Record<string, string>> = {
  elementTypes: 'name',
  stats: 'name',
  generationMethods: 'id',
  characterKinds: 'id',
  // ADR 0031 decision 4: a source is keyed on its URL, whatever it is called.
  suggestedSources: 'url',
  'characterKinds[].stats': 'name',
  'characterKinds[].buildSteps': 'id',
  'characterKinds[].sheet.sections': 'id',
  'characterKinds[].companions.stats': 'name',
  'characterKinds[].companions.sheet': 'id',
  'characterKinds[].inventory.slots': 'id',
  'characterKinds[].play.rests': 'id',
  'characterKinds[].play.trackers': 'id',
  'characterKinds[].blockFilters': 'key',
  'characterKinds[].freeform.fields': 'key',
  'characterKinds[].attacks.innate': 'name',
};

/** String lists written with ADR 0009's `+Type` / `-Type` delta, applied to the parent's list when they are one. */
export const OVERLAY_DELTA_LISTS: readonly string[] = ['characterKinds[].elementTypes'];

/** The overlay's own identity: what it is, not what it changes. Never reported as a change. */
export const OVERLAY_OWN_FIELDS: readonly string[] = ['$schema', 'formatVersion', 'id', 'name', 'version', 'extends', 'description', 'logo'];

/** The field set to `true` on an identified entry to remove the parent's entry of that identity. */
export const OVERLAY_REMOVE = 'remove';

/** One step of where a change is: a field, and for an identified entry, its identity and the label it shows under. */
export interface OverlayStep {
  field: string;
  /** The entry's identity, for an entry of an identified array. */
  entry?: string;
  /** The entry's `label`, else its `name`, as the applied system (or for a removal, the parent) has it. */
  label?: string;
}

export interface OverlayChange {
  /**
   * `changed`: a field took a different value. `added`: an identified entry the parent lacks. `removed`: an entry the
   * parent had, or a field set to `null`. `absent`: a removal naming nothing the parent has — reported, not refused,
   * since upstream may have removed it already.
   */
  action: 'changed' | 'added' | 'removed' | 'absent';
  path: OverlayStep[];
}

export interface AppliedOverlay {
  /** The complete system the overlay makes. Not validated: that is the caller's next step. */
  system: GameSystem;
  changes: OverlayChange[];
}

/**
 * Apply `overlay` to `parent`. Neither is modified. The result keeps the overlay's `id`, `name`, `version` and
 * `extends`; a field the overlay leaves out is the parent's, including its `description` and `logo`.
 */
export function applySystemOverlay(parent: GameSystem, overlay: Record<string, unknown>): AppliedOverlay {
  const changes: OverlayChange[] = [];
  const base = clone(parent) as unknown as Record<string, unknown>;
  const result = mergeObject(base, overlay, '', [], changes, true) as unknown as GameSystem;
  return { system: result, changes };
}

function mergeObject(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  pattern: string,
  path: OverlayStep[],
  changes: OverlayChange[],
  root = false,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [field, value] of Object.entries(patch)) {
    const fieldPattern = pattern ? `${pattern}.${field}` : field;
    const own = root && OVERLAY_OWN_FIELDS.includes(field);
    if (value === null) {
      if (field in out) {
        delete out[field];
        if (!own) changes.push({ action: 'removed', path: [...path, { field }] });
      }
      continue;
    }
    const before = out[field];
    const key = OVERLAY_KEYED_ARRAYS[fieldPattern];
    if (key !== undefined && Array.isArray(value)) {
      out[field] = mergeKeyed(Array.isArray(before) ? before : [], value, key, fieldPattern, [...path], field, changes);
      continue;
    }
    let next: unknown;
    if (OVERLAY_DELTA_LISTS.includes(fieldPattern) && Array.isArray(value) && isDelta(value)) {
      next = applyDelta(Array.isArray(before) ? (before as unknown[]) : [], value as string[]);
    } else if (isObject(value) && isObject(before)) {
      // Merged, but reported as one change of this field: "the progression changed", not each of its keys.
      next = mergeObject(before, value, fieldPattern, [...path, { field }], []);
    } else {
      next = clone(value);
    }
    out[field] = next;
    if (!own && !deepEqual(before, next)) changes.push({ action: 'changed', path: [...path, { field }] });
  }
  return out;
}

function mergeKeyed(
  base: unknown[],
  patch: unknown[],
  key: string,
  pattern: string,
  path: OverlayStep[],
  field: string,
  changes: OverlayChange[],
): unknown[] {
  const out = [...base];
  const entryPattern = `${pattern}[]`;
  for (const item of patch) {
    if (!isObject(item) || typeof item[key] !== 'string') {
      // Not an identified entry: appended as written, and the applied system's validation says what is wrong with it.
      out.push(clone(item));
      changes.push({ action: 'added', path: [...path, { field }] });
      continue;
    }
    const id = item[key] as string;
    const at = out.findIndex((existing) => isObject(existing) && existing[key] === id);
    const { [OVERLAY_REMOVE]: remove, ...rest } = item;
    if (remove === true) {
      if (at < 0) {
        changes.push({ action: 'absent', path: [...path, { field, entry: id }] });
      } else {
        changes.push({ action: 'removed', path: [...path, { field, entry: id, label: labelOf(out[at]) }] });
        out.splice(at, 1);
      }
      continue;
    }
    if (at < 0) {
      const added = mergeObject({}, rest, entryPattern, [], []);
      out.push(added);
      changes.push({ action: 'added', path: [...path, { field, entry: id, label: labelOf(added) }] });
      continue;
    }
    const existing = out[at] as Record<string, unknown>;
    const inner: OverlayChange[] = [];
    const merged = mergeObject(existing, rest, entryPattern, [], inner);
    out[at] = merged;
    const step: OverlayStep = { field, entry: id, label: labelOf(merged) };
    for (const change of inner) changes.push({ action: change.action, path: [...path, step, ...change.path] });
  }
  return out;
}

function labelOf(entry: unknown): string | undefined {
  if (!isObject(entry)) return undefined;
  for (const field of ['label', 'name']) if (typeof entry[field] === 'string') return entry[field] as string;
  return undefined;
}

function isDelta(list: unknown[]): boolean {
  return list.every((entry) => typeof entry === 'string') && list.some((entry) => /^[+-]/.test(entry as string));
}

/**
 * A delta over the parent's list. When the parent's own list is a delta too (a kind that `extends` another), the two are
 * one longer delta, which the kind's resolution applies in order; otherwise the delta is applied here.
 */
function applyDelta(before: unknown[], delta: string[]): string[] {
  const inherited = before.filter((entry): entry is string => typeof entry === 'string');
  if (isDelta(inherited)) return [...inherited, ...delta];
  const result = [...inherited];
  for (const entry of delta) {
    if (entry.startsWith('-')) {
      const at = result.indexOf(entry.slice(1));
      if (at >= 0) result.splice(at, 1);
      continue;
    }
    const added = entry.startsWith('+') ? entry.slice(1) : entry;
    if (!result.includes(added)) result.push(added);
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Where an identified array holds one identity twice — ADR 0103 decision 3. An overlay patches the first such entry and
 * never the second, and resolution keeps one of two stats of one name silently, so a duplicate is refused. Stat names are
 * compared ignoring case, as resolution compares them. `skip` is the arrays whose own check already says it in its words.
 */
export function duplicateIdentities(
  system: unknown,
  skip: ReadonlySet<string> = new Set(),
): Array<{ path: string; field: string; identity: string }> {
  const out: Array<{ path: string; field: string; identity: string }> = [];
  for (const [pattern, key] of Object.entries(OVERLAY_KEYED_ARRAYS)) {
    if (skip.has(pattern)) continue;
    const field = pattern.split('.').pop()!;
    for (const { path, value } of arraysAt(system, pattern)) {
      const seen = new Set<string>();
      value.forEach((entry, i) => {
        if (!isObject(entry) || typeof entry[key] !== 'string') return;
        const identity = entry[key] as string;
        const folded = key === 'name' && field === 'stats' ? identity.toLowerCase() : identity;
        if (seen.has(folded)) out.push({ path: `${path}[${i}].${key}`, field, identity });
        seen.add(folded);
      });
    }
  }
  return out;
}

/** Every array a table pattern names in a document, with the path the validator renders for it. */
function arraysAt(document: unknown, pattern: string): Array<{ path: string; value: unknown[] }> {
  let at: Array<{ path: string; value: unknown }> = [{ path: '', value: document }];
  for (const segment of pattern.split('.')) {
    const many = segment.endsWith('[]');
    const name = many ? segment.slice(0, -2) : segment;
    const next: Array<{ path: string; value: unknown }> = [];
    for (const { path, value } of at) {
      if (!isObject(value) || !(name in value)) continue;
      const child = value[name];
      const childPath = path ? `${path}.${name}` : name;
      if (many) {
        if (Array.isArray(child)) child.forEach((entry, i) => next.push({ path: `${childPath}[${i}]`, value: entry }));
      } else next.push({ path: childPath, value: child });
    }
    at = next;
  }
  return at.filter((entry): entry is { path: string; value: unknown[] } => Array.isArray(entry.value));
}
