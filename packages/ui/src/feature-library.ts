/**
 * The user's feature library — ADR 0106.
 *
 * One file in the character library folder, `incudo-features.json`, holding features of every system. A feature is a
 * character's custom feature (ADR 0063) plus the system whose stats it names and a revision. Giving one to a character
 * copies it there, and the copy records which feature and revision it came from (`CustomFeature.library`), so a newer
 * revision can be offered and never applied unasked. Everything a pane shows is worked out here; the panes compute
 * nothing.
 */

import {
  customFeatureTypes,
  validateJson,
  type CharacterStore,
  type CustomFeature,
  type CustomStatLine,
  type JsonSchema,
  type ResolvedCharacterKind,
  type SchemaError,
} from '@incudo/core';

/** The file's name in the library folder. */
export const FEATURE_LIBRARY_FILE = 'incudo-features.json';

export interface LibraryFeature {
  id: string;
  /** The system whose stats the lines name, by id. */
  system: string;
  /** Raised by every change. */
  revision: number;
  name: string;
  description?: string;
  /** Where it is listed when given, if the character's kind lists it. */
  type?: string;
  stats: CustomStatLine[];
}

export interface FeatureLibraryFile {
  formatVersion: 1;
  features: LibraryFeature[];
}

export const EMPTY_FEATURE_LIBRARY: FeatureLibraryFile = { formatVersion: 1, features: [] };

/** The schema's verdict and what no schema can say: an id twice. The one checker of the file. */
export function checkFeatureLibrary(raw: unknown, schema: JsonSchema): { value?: FeatureLibraryFile; errors: SchemaError[] } {
  const errors = validateJson(raw, schema);
  if (errors.length) return { errors };
  const file = raw as FeatureLibraryFile;
  const seen = new Set<string>();
  file.features.forEach((feature, i) => {
    if (seen.has(feature.id)) errors.push({ path: `features[${i}].id`, message: `"${feature.id}" is already used by another feature` });
    seen.add(feature.id);
  });
  return errors.length ? { errors } : { value: file, errors };
}

export type FeatureLibraryRead = { status: 'ready'; file: FeatureLibraryFile } | { status: 'unreadable'; reason: string };

/**
 * Read the file's bytes: none is an empty library; a file that does not read or check is unreadable, and is never
 * written over (ADR 0106 decision 1), so a hand edit gone wrong costs the edit and not the library.
 */
export function readFeatureLibrary(bytes: Uint8Array | null, schema: JsonSchema): FeatureLibraryRead {
  if (bytes === null) return { status: 'ready', file: EMPTY_FEATURE_LIBRARY };
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes).replace(/^﻿/, ''));
  } catch (error) {
    return { status: 'unreadable', reason: `${FEATURE_LIBRARY_FILE} is not valid JSON: ${(error as Error).message}` };
  }
  const { value, errors } = checkFeatureLibrary(raw, schema);
  if (!value) {
    const first = errors[0]!;
    const more = errors.length > 1 ? ` (and ${errors.length - 1} more)` : '';
    return { status: 'unreadable', reason: `${FEATURE_LIBRARY_FILE} cannot be read: ${first.path ? `${first.path}: ` : ''}${first.message}${more}` };
  }
  return { status: 'ready', file: value };
}

export function encodeFeatureLibrary(file: FeatureLibraryFile): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`);
}

/** A feature's text and lines, which is what a copy and its original are compared by. The type is the character's. */
function sameContent(a: Pick<CustomFeature, 'name' | 'description' | 'stats'>, b: Pick<CustomFeature, 'name' | 'description' | 'stats'>): boolean {
  const lines = (s: readonly CustomStatLine[]) => s.map((l) => [l.stat, l.mode, l.value]);
  return (
    a.name === b.name &&
    (a.description?.trim() ?? '') === (b.description?.trim() ?? '') &&
    JSON.stringify(lines(a.stats)) === JSON.stringify(lines(b.stats))
  );
}

function newLibraryFeatureId(file: FeatureLibraryFile): string {
  const taken = new Set(file.features.map((f) => f.id));
  let id = '';
  do id = `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  while (taken.has(id));
  return id;
}

/** The library with a character's feature added as a new feature of `system`, revision 1. */
export function addToLibrary(
  file: FeatureLibraryFile,
  feature: CustomFeature,
  system: string,
  id: string = newLibraryFeatureId(file),
): { file: FeatureLibraryFile; entry: LibraryFeature } {
  const entry: LibraryFeature = {
    id,
    system,
    revision: 1,
    name: feature.name,
    ...(feature.description?.trim() ? { description: feature.description } : {}),
    ...(feature.type !== undefined ? { type: feature.type } : {}),
    stats: feature.stats.map((l) => ({ ...l })),
  };
  return { file: { ...file, features: [...file.features, entry] }, entry };
}

/**
 * The library with its feature `id` replaced by a character's copy: name, description, lines and type, the revision
 * one above the library's. Undefined when the library has no such feature.
 */
export function saveChangesToLibrary(
  file: FeatureLibraryFile,
  id: string,
  feature: CustomFeature,
): { file: FeatureLibraryFile; entry: LibraryFeature } | undefined {
  const current = file.features.find((f) => f.id === id);
  if (!current) return undefined;
  const { description: _d, type: _t, ...rest } = current;
  const entry: LibraryFeature = {
    ...rest,
    revision: current.revision + 1,
    name: feature.name,
    ...(feature.description?.trim() ? { description: feature.description } : {}),
    ...(feature.type !== undefined ? { type: feature.type } : {}),
    stats: feature.stats.map((l) => ({ ...l })),
  };
  return { file: { ...file, features: file.features.map((f) => (f.id === id ? entry : f)) }, entry };
}

export function removeFromLibrary(file: FeatureLibraryFile, id: string): FeatureLibraryFile {
  return { ...file, features: file.features.filter((f) => f.id !== id) };
}

/**
 * What a character receives when a library feature is given to it, less its own id: the text and lines, the link, and
 * the library's type when the kind lists it other than as its default. A line the kind cannot use is kept: the
 * engine reports it and changes nothing, as for one written there.
 */
export function givenFeature(entry: LibraryFeature, kind: ResolvedCharacterKind): Omit<CustomFeature, 'id'> {
  const listed = entry.type !== undefined && customFeatureTypes(kind).includes(entry.type) && entry.type !== kind.customFeatures?.type;
  return {
    name: entry.name,
    ...(entry.description?.trim() ? { description: entry.description } : {}),
    ...(listed ? { type: entry.type } : {}),
    stats: entry.stats.map((l) => ({ ...l })),
    library: { id: entry.id, revision: entry.revision },
  };
}

/** A character's feature taking its original's text and lines again; its type stays the character's. */
export function updatedFromLibrary(feature: CustomFeature, entry: LibraryFeature): CustomFeature {
  const { description: _d, library: _l, ...rest } = feature;
  return {
    ...rest,
    name: entry.name,
    ...(entry.description?.trim() ? { description: entry.description } : {}),
    stats: entry.stats.map((l) => ({ ...l })),
    library: { id: entry.id, revision: entry.revision },
  };
}

/**
 * Where a character's feature stands against the library:
 * `none` it came from nowhere; `current` the library has nothing newer; `edited` changed on the character since;
 * `update` the library has a newer revision that differs (`edited` too when the character's changes would be
 * replaced); `gone` the library no longer has it. With no library read, a copy is `current`: nothing is claimed.
 */
export type FeatureLinkStatus = 'none' | 'current' | 'edited' | 'update' | 'gone';

export interface FeatureLinkView {
  status: FeatureLinkStatus;
  /** True when Update would replace changes made on the character. */
  edited: boolean;
  /** A sentence for the user, when there is something to say. */
  note?: string;
  /** The label of the button that writes this feature to the library, absent when nothing can be written. */
  save?: string;
  /** The library's newer feature, for `update`. */
  entry?: LibraryFeature;
}

export function featureLinkView(feature: CustomFeature, library: FeatureLibraryRead | undefined): FeatureLinkView {
  const ready = library?.status === 'ready' ? library.file : undefined;
  const link = feature.library;
  const name = feature.name.trim() || 'This feature';
  if (!link) return { status: 'none', edited: false, ...(ready ? { save: 'Save to your feature library' } : {}) };
  const edited = link.edited === true;
  if (!ready) return { status: edited ? 'edited' : 'current', edited };
  const entry = ready.features.find((f) => f.id === link.id);
  if (!entry) {
    return { status: 'gone', edited, note: 'Not in your feature library any more.', save: 'Save to your feature library' };
  }
  if (entry.revision > link.revision && !sameContent(feature, entry)) {
    return {
      status: 'update',
      edited,
      entry,
      note: edited
        ? `${name} has changed in your feature library. Updating replaces the changes made to it here.`
        : `${name} has changed in your feature library.`,
      ...(edited ? { save: 'Save changes to your feature library, replacing its newer version' } : {}),
    };
  }
  return { status: edited ? 'edited' : 'current', edited, ...(edited ? { save: 'Save changes to your feature library' } : {}) };
}

export interface LibraryOffer {
  entry: LibraryFeature;
  /** True when the character already holds a copy of it: it is not given twice. */
  given: boolean;
}

/** The library's features of a system, by name, each saying whether the character already holds a copy. */
export function libraryOffers(library: FeatureLibraryRead | undefined, system: string, held: readonly CustomFeature[]): LibraryOffer[] {
  if (library?.status !== 'ready') return [];
  const linked = new Set(held.flatMap((f) => (f.library ? [f.library.id] : [])));
  return library.file.features
    .filter((f) => f.system === system)
    .map((entry) => ({ entry, given: linked.has(entry.id) }))
    .sort((a, b) => a.entry.name.localeCompare(b.entry.name));
}

export const FEATURE_LIBRARY_HEADING = 'From your feature library';
export const FEATURE_LIBRARY_EMPTY = 'Your feature library has nothing for this game yet. Save a feature to it from any character.';
export const FEATURE_LIBRARY_NO_FOLDER = 'Choose a library folder to keep features for reuse.';

export interface FeatureLibraryState {
  /** `unavailable` with no folder or no way to read one; `loading` until the first read. */
  status: 'unavailable' | 'loading' | 'ready' | 'unreadable';
  read?: FeatureLibraryRead;
  /** The last write's failure, in words. */
  problem?: string;
}

/**
 * The file, read through the folder port and written back one change at a time: every write reads the file first and
 * applies the change to what it read, so a feature added elsewhere since is kept (ADR 0106 decision 2).
 */
export class FeatureLibrary {
  private readonly store: CharacterStore;
  private readonly schema: JsonSchema;
  private readonly listeners = new Set<() => void>();
  private state: FeatureLibraryState;

  constructor(store: CharacterStore, schema: JsonSchema) {
    this.store = store;
    this.schema = schema;
    this.state = { status: this.reachable ? 'loading' : 'unavailable' };
  }

  private get reachable(): boolean {
    return this.store.available && this.store.readFile !== undefined && this.store.writeFile !== undefined;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): FeatureLibraryState => this.state;

  private set(next: FeatureLibraryState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private async readNow(): Promise<FeatureLibraryRead | undefined> {
    if (!this.reachable || (await this.store.location()) === null) return undefined;
    return readFeatureLibrary(await this.store.readFile!(FEATURE_LIBRARY_FILE), this.schema);
  }

  /** Read the file again, as when Build opens or the folder changes. */
  load = async (): Promise<void> => {
    try {
      const read = await this.readNow();
      this.set(read ? { status: read.status, read } : { status: 'unavailable' });
    } catch (error) {
      this.set({ status: 'unavailable', problem: `${FEATURE_LIBRARY_FILE} could not be read: ${(error as Error).message}` });
    }
  };

  private async change<T>(apply: (file: FeatureLibraryFile) => { file: FeatureLibraryFile; result: T } | undefined): Promise<T | undefined> {
    try {
      const read = await this.readNow();
      if (!read) return undefined;
      if (read.status !== 'ready') {
        this.set({ status: 'unreadable', read });
        return undefined;
      }
      const changed = apply(read.file);
      if (!changed) {
        this.set({ status: 'ready', read });
        return undefined;
      }
      await this.store.writeFile!(FEATURE_LIBRARY_FILE, encodeFeatureLibrary(changed.file));
      this.set({ status: 'ready', read: { status: 'ready', file: changed.file } });
      return changed.result;
    } catch (error) {
      this.set({ ...this.state, problem: `${FEATURE_LIBRARY_FILE} could not be written: ${(error as Error).message}` });
      return undefined;
    }
  }

  /**
   * Write a character's feature to the library: a new feature of `system` when it records no link or its original is
   * gone, else its original replaced. Returns the link the character's copy should record, or undefined when nothing
   * was written.
   */
  save = async (feature: CustomFeature, system: string): Promise<{ id: string; revision: number } | undefined> =>
    this.change((file) => {
      const replaced = feature.library ? saveChangesToLibrary(file, feature.library.id, feature) : undefined;
      const { file: next, entry } = replaced ?? addToLibrary(file, feature, system);
      return { file: next, result: { id: entry.id, revision: entry.revision } };
    });

  remove = async (id: string): Promise<boolean> =>
    (await this.change((file) => (file.features.some((f) => f.id === id) ? { file: removeFromLibrary(file, id), result: true } : undefined))) ?? false;
}

export interface FeatureLibraryView {
  /** A sentence where there is no list to show: no folder, an empty library for this system, an unreadable file. */
  message?: string;
  /** The library's features of the character's system, which a user may give. */
  offers: LibraryOffer[];
  /** Each of the character's features against the library, by feature id. */
  links: Map<string, FeatureLinkView>;
  /** A failed read or write, in words. */
  problem?: string;
}

/** Everything the feature editor shows of the library, for one character. */
export function featureLibraryView(state: FeatureLibraryState, character: { systemId: string; customFeatures?: CustomFeature[] }): FeatureLibraryView {
  const held = character.customFeatures ?? [];
  const read = state.status === 'ready' || state.status === 'unreadable' ? state.read : undefined;
  const links = new Map(held.map((f) => [f.id, featureLinkView(f, read)]));
  const offers = libraryOffers(read, character.systemId, held);
  const message =
    state.status === 'unavailable'
      ? FEATURE_LIBRARY_NO_FOLDER
      : read?.status === 'unreadable'
        ? read.reason
        : state.status === 'ready' && !offers.length
          ? FEATURE_LIBRARY_EMPTY
          : undefined;
  return { ...(message ? { message } : {}), offers, links, ...(state.problem ? { problem: state.problem } : {}) };
}
