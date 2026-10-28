/**
 * Every system definition, shipped or the user's, read by one function: ADR 0011's "official and user systems load
 * through exactly the same code path", and ADR 0107's measurement of where they did not.
 *
 * A definition is read from its text when there is text (`readJsonText`, so a problem has a line), validated by
 * `validateGameSystem` with every complete system loaded before it as a possible parent, and its warnings and errors
 * located by `describeSystemErrors`. The only thing that differs between a shipped definition and a stored one is
 * where it came from, `origin`, and that is what a view labels it by.
 *
 * Starting equipment that ships beside a system (ADR 0087) is checked against the shipped system it names, and then
 * against every system that would be offered it through its lineage (ADR 0104): a user's version of a game receives the
 * file only when it fits that version, and the card says why when it does not.
 */

import {
  readJsonText,
  validateGameSystem,
  type GameSystem,
  type JsonPosition,
  type OverlayChange,
  type SchemaBundle,
  type SchemaError,
} from '@incudo/core';

import { describeSystemErrors, syntaxProblem, type SystemProblem } from './system-problems.ts';

/** Where a definition came from: with the app, or added by the user. The one difference ADR 0011 allows. */
export type SystemOrigin = 'shipped' | 'user';

/** A definition to read: its text when the caller has it (then problems carry lines), else the parsed value. */
export type SystemDefinitionSource = { text: string; key?: string } | { value: unknown; key?: string };

/** What an overlay was applied to and what it changed (ADR 0102), as `validateGameSystem` reported it. */
export interface UserOverlay {
  parent: GameSystem;
  changes: OverlayChange[];
}

/** A definition that would not validate, named so a view can say which, why, and whose it is. */
export interface SystemLoadFailure {
  /** Whatever the file called itself, when it got far enough to say. */
  id: string;
  /** Where it came from, for a user system: the storage key. */
  key?: string;
  errors: SchemaError[];
  /** The same errors, each with where it is in the file, by line and by the ids written there (ADR 0103). */
  problems: SystemProblem[];
  /** Shipped with the app or added by the user. Absent only where a caller has not said. */
  origin?: SystemOrigin;
}

/** One definition read. */
export type SystemDefinitionResult =
  | { ok: true; system: GameSystem; overlay?: UserOverlay; warnings: SystemProblem[] }
  | { ok: false; id?: string; syntax: boolean; errors: SchemaError[]; problems: SystemProblem[] };

/**
 * Read one definition: parse its text, validate it (an overlay against the parent `parent` finds), locate what is wrong
 * and what is worth checking. The function `UserSystemStore` and `loadSystemDefinitions` both call, for every file.
 */
export function readSystemDefinition(
  source: SystemDefinitionSource,
  schemas: SchemaBundle,
  parent: (id: string) => GameSystem | undefined = () => undefined,
): SystemDefinitionResult {
  const parsed = parseDefinition(source);
  return parsed.ok ? validateParsed(parsed.value, parsed.positions, schemas, parent) : parsed;
}

type Parsed = { ok: true; value: unknown; positions?: ReadonlyMap<string, JsonPosition> };
type Failed = Extract<SystemDefinitionResult, { ok: false }>;

function parseDefinition(source: SystemDefinitionSource): Parsed | Failed {
  if (!('text' in source)) return { ok: true, value: source.value };
  const parsed = readJsonText(source.text);
  if (!parsed.ok) return { ok: false, syntax: true, errors: [{ path: '', message: parsed.message }], problems: [syntaxProblem(parsed)] };
  return { ok: true, value: parsed.value, positions: parsed.positions };
}

function validateParsed(
  value: unknown,
  positions: ReadonlyMap<string, JsonPosition> | undefined,
  schemas: SchemaBundle,
  parent: (id: string) => GameSystem | undefined,
): SystemDefinitionResult {
  const result = validateGameSystem(value, schemas, { parent });
  if (!result.value) {
    const id = idOf(value);
    return {
      ok: false,
      ...(id !== undefined ? { id } : {}),
      syntax: false,
      errors: result.errors,
      problems: describeSystemErrors(result.errors, value, positions, result.overlay),
    };
  }
  return {
    ok: true,
    system: result.value,
    ...(result.overlay ? { overlay: { parent: result.overlay.parent, changes: result.overlay.changes } } : {}),
    warnings: result.warnings.length ? describeSystemErrors(result.warnings, value, positions, result.overlay) : [],
  };
}

/** Definitions read together: what loaded, what did not, and for each that loaded what it is built on and is worth checking. */
export interface LoadedDefinitions {
  systems: GameSystem[];
  failures: SystemLoadFailure[];
  /** For each system that is an overlay, by id: its parent and its changes, as applied on this load. */
  overlays: Record<string, UserOverlay>;
  /** For each system with something worth checking, by id (ADR 0105), located as a problem is. A system with none is absent. */
  warnings: Record<string, SystemProblem[]>;
}

/**
 * Read a set of definitions, complete systems before overlays (so an overlay finds its parent whatever order the files
 * come in), each overlay applied to its parent as the parent is on this load. `bases` are systems already loaded that an
 * overlay may name: none for the shipped set, the shipped systems for the user's.
 */
export function loadSystemDefinitions(
  sources: readonly SystemDefinitionSource[],
  schemas: SchemaBundle,
  bases: readonly GameSystem[] = [],
  origin?: SystemOrigin,
): LoadedDefinitions {
  const systems: GameSystem[] = [];
  const failures: SystemLoadFailure[] = [];
  const overlays: Record<string, UserOverlay> = {};
  const warnings: Record<string, SystemProblem[]> = {};
  const fail = (source: SystemDefinitionSource, failed: Failed): void => {
    failures.push({
      id: failed.id ?? (source.key !== undefined ? idFromKey(source.key) : 'unknown'),
      ...(source.key !== undefined ? { key: source.key } : {}),
      errors: failed.errors,
      problems: failed.problems,
      ...(origin ? { origin } : {}),
    });
  };
  // Parsed once, then complete systems before overlays.
  const read: Array<{ source: SystemDefinitionSource; parsed: Parsed }> = [];
  for (const source of sources) {
    const parsed = parseDefinition(source);
    if (parsed.ok) read.push({ source, parsed });
    else fail(source, parsed);
  }
  const ordered = [...read.filter((e) => !isOverlay(e.parsed.value)), ...read.filter((e) => isOverlay(e.parsed.value))];
  const parent = (id: string): GameSystem | undefined => {
    const lower = id.toLowerCase();
    return bases.find((s) => s.id.toLowerCase() === lower) ?? systems.find((s) => s.id.toLowerCase() === lower);
  };
  for (const { source, parsed } of ordered) {
    const result = validateParsed(parsed.value, parsed.positions, schemas, parent);
    if (!result.ok) {
      fail(source, result);
      continue;
    }
    systems.push(result.system);
    if (result.overlay) overlays[result.system.id] = result.overlay;
    if (result.warnings.length) warnings[result.system.id] = result.warnings;
  }
  return { systems, failures, overlays, warnings };
}

/** Every system the app can offer, shipped and the user's, as one list a launcher renders. */
export interface SystemCatalog {
  /** Shipped and the user's together, in that order. */
  systems: GameSystem[];
  failures: SystemLoadFailure[];
  /** Where each system came from, by id. */
  origins: Record<string, SystemOrigin>;
  overlays: Record<string, UserOverlay>;
  /** What is worth checking in each system that loaded, by id, shipped or the user's. */
  warnings: Record<string, SystemProblem[]>;
}

/**
 * The shipped set, read: the half of a catalog that needs no storage, so a shell can have it before anything is awaited.
 * Nothing ships beside a system any more: starting equipment is content's (ADR 0119), and a system ships no data of
 * one book's.
 */
export type ShippedCatalog = LoadedDefinitions;

/** Read the shipped definitions. */
export function loadShippedCatalog(sources: readonly SystemDefinitionSource[], schemas: SchemaBundle): ShippedCatalog {
  return loadSystemDefinitions(sources, schemas, [], 'shipped');
}

/** The shipped set and the user's together, labelled by origin. */
export function systemCatalog(shipped: ShippedCatalog, user?: LoadedDefinitions): SystemCatalog {
  const systems = [...shipped.systems, ...(user?.systems ?? [])];
  const origins: Record<string, SystemOrigin> = {};
  for (const system of shipped.systems) origins[system.id] = 'shipped';
  for (const system of user?.systems ?? []) origins[system.id] = 'user';
  const warnings: Record<string, SystemProblem[]> = { ...shipped.warnings, ...(user?.warnings ?? {}) };
  return {
    systems,
    failures: [
      ...shipped.failures.map((f) => ({ ...f, origin: 'shipped' as const })),
      ...(user?.failures ?? []).map((f) => ({ ...f, origin: 'user' as const })),
    ],
    origins,
    overlays: { ...shipped.overlays, ...(user?.overlays ?? {}) },
    warnings,
  };
}

/** Where a definition came from, as a card or a failure line says it. */
export function systemOriginLabel(origin: SystemOrigin): string {
  return origin === 'user' ? 'yours' : 'comes with Incudo';
}

/** What a definition that did not load needs, worded by whose file it is. */
export function systemFailureNote(origin: SystemOrigin | undefined): string {
  return origin === 'shipped'
    ? 'this definition comes with Incudo and does not match the system format, so Incudo does not load it. This copy of the app is faulty; installing it again should mend it.'
    : 'this definition does not match the system format, so Incudo does not load it. Fix what is listed and add the file again.';
}

function isOverlay(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'extends' in value;
}

function idOf(value: unknown): string | undefined {
  const id = (value as { id?: unknown })?.id;
  return typeof id === 'string' ? id : undefined;
}

/** A user system's storage key back to the id it was stored under. */
export function idFromKey(key: string): string {
  const last = key.slice(key.lastIndexOf('/') + 1).replace(/\.json$/i, '');
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}
