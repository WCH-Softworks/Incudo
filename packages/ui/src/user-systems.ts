/**
 * The systems a user added themselves — [ADR 0011](../../../docs/adr/0011-user-systems.md),
 * finally reachable.
 *
 * ADR 0011 says users can fork an official system and author entirely new ones, and the format
 * has been a public API since ADR 0007. What was missing was any way to *get one into the app*:
 * `boot.ts` imported the shipped definitions at build time and that was the whole of it. This is
 * the other half — read a `system.json` the user picked, validate it with the **same**
 * `validateGameSystem` the tests and the shipped definitions go through, and keep it.
 *
 * It lives here rather than in the desktop shell because nothing about it is layout: the mobile
 * shell will want the identical object, and this is testable in Node against a `MemoryStorage`
 * (CODE-REUSE-POLICY rule 2).
 *
 * **A stored system is validated on every load, not only when it was added.** The definition on
 * disk was written against whatever the format was that day, and Incudo's copy of the schema
 * moves underneath it. Trusting the add-time verdict forever is how a system that no longer
 * validates ends up half-loaded, which is exactly what ADR 0011 promises will not happen.
 */

import {
  readJsonText,
  validateGameSystem,
  type JsonPosition,
  type GameSystem,
  type OverlayChange,
  type PickedFile,
  type SchemaBundle,
  type SchemaError,
  type Storage,
} from '@incudo/core';

import { describeSystemErrors, syntaxProblem, type SystemProblem } from './system-problems.ts';

/** Where user systems live in the injected Storage. One document per system. */
export const USER_SYSTEM_PREFIX = 'systems/user/';

/** A definition that would not validate, named so a view can say which and why. */
export interface SystemLoadFailure {
  /** Whatever the file called itself, when it got far enough to say. */
  id: string;
  /** Where it came from, for a user system: the storage key. */
  key?: string;
  errors: SchemaError[];
  /** The same errors, each with where it is in the file, by line and by the ids written there (ADR 0103). */
  problems: SystemProblem[];
}

/** What an overlay was applied to and what it changed (ADR 0102), as `validateGameSystem` reported it. */
export interface UserOverlay {
  parent: GameSystem;
  changes: OverlayChange[];
}

export interface LoadedUserSystems {
  systems: GameSystem[];
  failures: SystemLoadFailure[];
  /** For each system that is an overlay, by id: its parent and its changes, as applied on this load. */
  overlays: Record<string, UserOverlay>;
  /**
   * For each system that loaded with something worth checking, by id (ADR 0105): each warning with where it is in the file,
   * as a problem is. A system with none is absent.
   */
  warnings: Record<string, SystemProblem[]>;
}

export type AddSystemResult =
  | { ok: true; system: GameSystem; replaced: boolean; overlay?: UserOverlay; warnings?: SystemProblem[] }
  | { ok: false; message: string; errors?: SchemaError[]; problems?: SystemProblem[] };

/**
 * Read, add and remove the user's own system definitions.
 *
 * `reserved` is the ids the app already ships. A user definition claiming one of those is
 * refused rather than shadowing it: two systems with one id makes "which system is this
 * character's?" unanswerable, and a character records only the id (ADR 0012). Overlaying an
 * official system is what ADR 0011's `extends` is for, and that keeps its own id.
 */
export class UserSystemStore {
  private readonly storage: Storage;
  private readonly schemas: SchemaBundle;
  private readonly reserved: ReadonlySet<string>;
  private readonly bases: readonly GameSystem[];

  /**
   * `bases` are the shipped systems an overlay may name in `extends` (ADR 0102), beside the user's own complete ones.
   * Their ids are reserved too.
   */
  constructor(storage: Storage, schemas: SchemaBundle, reserved: Iterable<string> = [], bases: readonly GameSystem[] = []) {
    this.storage = storage;
    this.schemas = schemas;
    this.bases = bases;
    this.reserved = new Set([...reserved, ...bases.map((system) => system.id)].map((id) => id.toLowerCase()));
  }

  /**
   * Every stored definition, validated now. Complete systems first, then overlays, each applied to its parent as the
   * parent is today: that is how a fix to the parent reaches an overlay written before it (ADR 0102).
   */
  async load(): Promise<LoadedUserSystems> {
    const systems: GameSystem[] = [];
    const failures: SystemLoadFailure[] = [];
    const overlays: Record<string, UserOverlay> = {};
    const warnings: Record<string, SystemProblem[]> = {};
    let keys: string[];
    try {
      keys = await this.storage.list(USER_SYSTEM_PREFIX);
    } catch {
      return { systems, failures, overlays, warnings };
    }
    const read: Array<{ key: string; value: unknown; positions: ReadonlyMap<string, JsonPosition> }> = [];
    for (const key of keys.sort()) {
      const text = await this.storage.read(key).catch(() => null);
      if (text === null) continue;
      const parsed = readJsonText(text);
      if (!parsed.ok) {
        failures.push({ id: idFromKey(key), key, errors: [{ path: '', message: parsed.message }], problems: [syntaxProblem(parsed)] });
        continue;
      }
      read.push({ key, value: parsed.value, positions: parsed.positions });
    }
    // Complete systems before overlays, so an overlay of the user's own system finds it whatever the file names sort as.
    const ordered = [...read.filter((entry) => !isOverlay(entry.value)), ...read.filter((entry) => isOverlay(entry.value))];
    for (const { key, value, positions } of ordered) {
      const result = validateGameSystem(value, this.schemas, { parent: (id) => this.parentAmong(systems, id) });
      if (result.value) {
        systems.push(result.value);
        if (result.overlay) overlays[result.value.id] = result.overlay;
        if (result.warnings.length) warnings[result.value.id] = describeSystemErrors(result.warnings, value, positions, result.overlay);
      } else {
        const problems = describeSystemErrors(result.errors, value, positions, result.overlay);
        failures.push({ id: idOf(value) ?? idFromKey(key), key, errors: result.errors, problems });
      }
    }
    return { systems, failures, overlays, warnings };
  }

  /**
   * The system an overlay names: shipped, or the user's own. An overlay found here is refused by the validator with a
   * sentence saying so, which reads better than "not a system Incudo has" about a system the user can see.
   */
  private parentAmong(user: readonly GameSystem[], id: string): GameSystem | undefined {
    const lower = id.toLowerCase();
    return this.bases.find((system) => system.id.toLowerCase() === lower) ?? user.find((system) => system.id.toLowerCase() === lower);
  }

  /**
   * Validate a picked file and keep it.
   *
   * Adding a system whose id is already yours **replaces** it, which is the normal case: the
   * user edited their file and wants the new one. Adding one whose id the app ships is refused.
   */
  async add(file: PickedFile): Promise<AddSystemResult> {
    let text: string;
    try {
      text = new TextDecoder().decode(file.bytes);
    } catch {
      return { ok: false, message: `"${file.name}" is not text.` };
    }
    const parsed = readJsonText(text);
    if (!parsed.ok) {
      return {
        ok: false,
        message: `"${file.name}" is not valid JSON.`,
        errors: [{ path: '', message: parsed.message }],
        problems: [syntaxProblem(parsed)],
      };
    }

    const user = isOverlay(parsed.value) ? (await this.load()).systems : [];
    const result = validateGameSystem(parsed.value, this.schemas, { parent: (id) => this.parentAmong(user, id) });
    if (!result.value) {
      return {
        ok: false,
        message: `"${file.name}" is not a valid system definition.`,
        errors: result.errors,
        problems: describeSystemErrors(result.errors, parsed.value, parsed.positions, result.overlay),
      };
    }
    if (this.reserved.has(result.value.id.toLowerCase())) {
      return {
        ok: false,
        message:
          `"${result.value.id}" is a system Incudo ships, and two systems cannot share an id — ` +
          `a character records only the id. To change an official system, give yours its own id ` +
          `and name the official one in "extends".`,
      };
    }

    const key = keyFor(result.value.id);
    const replaced = (await this.storage.read(key).catch(() => null)) !== null;
    // Stored verbatim rather than re-serialised, so what is re-validated on the next load is
    // the file the user actually wrote — comments they cannot have, but key order and spacing
    // are theirs, and a round trip through JSON.stringify is a change nobody asked for.
    await this.storage.write(key, text);
    return {
      ok: true,
      system: result.value,
      replaced,
      ...(result.overlay ? { overlay: result.overlay } : {}),
      ...(result.warnings.length
        ? { warnings: describeSystemErrors(result.warnings, parsed.value, parsed.positions, result.overlay) }
        : {}),
    };
  }

  async remove(id: string): Promise<void> {
    await this.storage.remove(keyFor(id));
  }

  /** True when this id came from the user rather than from the app. */
  async has(id: string): Promise<boolean> {
    return (await this.storage.read(keyFor(id)).catch(() => null)) !== null;
  }
}

function keyFor(id: string): string {
  // The id is the filename, so it has to be one. Every character outside the set is collapsed
  // rather than dropped, so two ids cannot quietly become one key.
  return `${USER_SYSTEM_PREFIX}${encodeURIComponent(id.toLowerCase())}.json`;
}

function idFromKey(key: string): string {
  const last = key.slice(USER_SYSTEM_PREFIX.length).replace(/\.json$/i, '');
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function isOverlay(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'extends' in value;
}

function idOf(value: unknown): string | undefined {
  const id = (value as { id?: unknown })?.id;
  return typeof id === 'string' ? id : undefined;
}

