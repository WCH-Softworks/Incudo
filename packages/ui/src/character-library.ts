/**
 * The character library, as a view-model — ADR 0027.
 *
 * "Which characters exist, which of them are broken, and which of their sources have moved"
 * is shared logic, not layout, so it lives here and is testable in Node against a fake store
 * (CODE-REUSE-POLICY rule 2). The React side is a `useSyncExternalStore` binding and some
 * markup; the mobile shell will want this identical object.
 *
 * **The property this whole file exists to protect:** listing and opening a character must
 * work with **zero content sources configured, no content loaded and no network**. A `.incu`
 * embeds the content its character uses (ADR 0012), so nothing here may reach for a
 * `ContentLibrary`, a `ContentSource` or a `Fetcher` — and nothing here does. If opening from
 * the library ever comes to need a source, the feature is wrong and ADR 0012 is quietly
 * broken. `character-library.test.ts` asserts exactly that, with no index in sight.
 */

import {
  ASSETS_PREFIX,
  BundleElementIndex,
  collectCharacterContent,
  packCharacterContainer,
  readCharacterContainer,
  resolveCharacterKind,
  type Character,
  type CharacterStore,
  type ContainerFiles,
  type ContainerForm,
  type ContainerManifest,
  type ContainerProblem,
  type ElementIndex,
  type GameSystem,
  type LibraryEntryRef,
  type SourceRef,
} from '@incudo/core';
import {
  compareSourceRefs,
  recordSourceRefs,
  type ConfiguredSource,
  type SourceRefStatus,
} from '@incudo/content';

/** One character, as the library found it on disk. */
export interface LibraryEntry {
  /** The file or folder name in the library. The identity here — see ADR 0027. */
  name: string;
  form: ContainerForm;
  /** The character's own name, or the file's when the container would not read. */
  title: string;
  systemId?: string;
  kind?: string;
  /** The character's progression point — a level, a challenge rating — where it has one. */
  progress?: number;
  updatedAt?: string;
  elementCount?: number;
  sources: SourceRef[];
  /** ADR 0028's three states, against whatever profile was passed in. */
  sourceStatuses: SourceRefStatus[];
  /**
   * The container's `assets/portrait.png`, as real bytes, or undefined.
   *
   * Undefined means **show a marked gap**. Never a generated silhouette, avatar, icon or
   * texture: that is a standing project commitment (see the README), and a grid of faces is
   * exactly where it is most tempting to break it.
   */
  portrait?: Uint8Array;
  /**
   * Where those bytes sit in the container — `assets/portrait.png`, or `.jpg`, or nothing.
   *
   * Carried because the extension *is* the media type, and a view needs one to build a blob
   * URL. Aurora's saves are not all PNGs: one of the nine real sample saves holds a JPEG,
   * which the importer sniffed and named correctly and which a card assuming PNG would hand
   * to the browser under the wrong type. Found by running this against the real saves.
   */
  portraitPath?: string;
  /**
   * Whatever `readCharacterContainer` had to say. Shown, never swallowed — a save that
   * half-opens is the case ADR 0005's "report it, don't guess" exists for.
   */
  problems: ContainerProblem[];
  /** True when the container could not be read at all. The entry is still listed. */
  broken: boolean;
}

export interface LibraryState {
  /**
   * `unavailable` — this platform has no filesystem the app may reach.
   * `no-location` — nobody has chosen a folder yet. The app's first-run state.
   * `scanning` / `ready` — self-explanatory.
   */
  status: 'unavailable' | 'no-location' | 'scanning' | 'ready';
  unavailableReason?: string;
  location: string | null;
  entries: LibraryEntry[];
  /** Something that went wrong with the scan itself, rather than with one character. */
  problems: string[];
  busy: boolean;
}

/** What opening an entry gives back: everything needed to derive, and nothing else. */
export interface OpenedCharacter {
  entry: LibraryEntry;
  character: Character;
  /** An index over the save's *own* embedded content. No sources involved. */
  elements: ElementIndex;
  problems: ContainerProblem[];
}

export interface SaveOptions {
  /** Overwrite this entry. Absent means "a new one, named after the character". */
  entry?: LibraryEntryRef;
  /**
   * The form for a *new* entry. An existing one keeps the form it has — the app never
   * silently converts between a zip and an unpacked folder (ADR 0027).
   */
  form?: ContainerForm;
  /**
   * What the app last saw as this entry's `updated`. When it does not match what is on disk
   * now, the write is refused rather than landing on top of someone else's edit. Omit only
   * when the entry is new.
   */
  expectUpdatedAt?: string;
  generator?: string;
  assets?: ContainerFiles;
}

export type SaveResult =
  | { ok: true; entry: LibraryEntryRef }
  | { ok: false; reason: 'conflict' | 'failed'; message: string };

export class CharacterLibrary {
  private readonly store: CharacterStore;
  private readonly listeners = new Set<() => void>();
  private state: LibraryState;
  private profile: readonly ConfiguredSource[] = [];

  constructor(store: CharacterStore) {
    this.store = store;
    this.state = {
      status: store.available ? 'no-location' : 'unavailable',
      unavailableReason: store.unavailableReason,
      location: null,
      entries: [],
      problems: [],
      busy: false,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): LibraryState => this.state;

  /**
   * Tell the library which sources the user has, so each entry can say which of *its* sources
   * have moved or gone (ADR 0028).
   *
   * Optional in the strongest sense: with no profile every recorded source reads `missing`,
   * and every character still lists, opens and derives. That is the point.
   */
  setProfile = (profile: readonly ConfiguredSource[]): void => {
    this.profile = profile;
    if (this.state.entries.length) {
      this.patch({
        entries: this.state.entries.map((entry) => ({
          ...entry,
          sourceStatuses: compareSourceRefs(entry.sources, this.profile),
        })),
      });
    }
  };

  /** Pick up a library chosen in an earlier session, and scan it. */
  restore = async (): Promise<void> => {
    if (!this.store.available) return;
    const location = await this.store.location();
    if (!location) {
      this.patch({ status: 'no-location', location: null });
      return;
    }
    this.patch({ location });
    await this.refresh();
  };

  /** "Where do you keep your characters?" Cancelling leaves everything as it was. */
  chooseLocation = async (): Promise<boolean> => {
    if (!this.store.available) return false;
    const location = await this.store.choose();
    if (!location) return false;
    this.patch({ location, entries: [], problems: [] });
    await this.refresh();
    return true;
  };

  /**
   * Read the folder again, from scratch.
   *
   * No incremental update and no cached listing: the folder is the list (ADR 0027), and it
   * is a folder the user may have edited, synced or checked out behind the app's back since
   * the last scan. Anything clever here would be a second source of truth.
   */
  refresh = async (): Promise<void> => {
    if (!this.store.available || !this.state.location) return;
    this.patch({ status: 'scanning', busy: true, problems: [] });

    let refs: LibraryEntryRef[];
    try {
      refs = await this.store.list();
    } catch (error) {
      this.patch({
        status: 'ready',
        busy: false,
        entries: [],
        problems: [`Could not read the library folder: ${messageOf(error)}`],
      });
      return;
    }

    const entries: LibraryEntry[] = [];
    const problems: string[] = [];
    for (const ref of refs) {
      try {
        entries.push(this.describe(ref, await this.store.read(ref)));
      } catch (error) {
        // A file that vanished between the scan and the read, or one that is not a container
        // at all. It is still something the user can see in their own file manager, so it is
        // listed and explained rather than quietly dropped.
        entries.push(brokenEntry(ref, messageOf(error)));
        problems.push(`${ref.name}: ${messageOf(error)}`);
      }
    }

    entries.sort(byRecency);
    this.patch({ status: 'ready', busy: false, entries, problems });
  };

  /**
   * Open one character, from its own container and nothing else.
   *
   * Note what this does not take: no `ElementIndex`, no `ContentSource`, no system. The index
   * it returns is over the save's embedded content, which is ADR 0012 working.
   */
  open = async (name: string): Promise<OpenedCharacter | undefined> => {
    const listed = this.state.entries.find((entry) => entry.name === name);
    if (!listed) return undefined;
    const files = await this.store.read({ name: listed.name, form: listed.form });
    const { container, problems } = readCharacterContainer(files);
    if (!container) {
      this.patch({
        entries: this.state.entries.map((entry) =>
          entry.name === name ? { ...entry, broken: true, problems } : entry,
        ),
      });
      return undefined;
    }
    return {
      entry: this.describe({ name: listed.name, form: listed.form }, files),
      character: container.character,
      elements: new BundleElementIndex(container.content.elements),
      problems,
    };
  };

  /**
   * Write a character into the library.
   *
   * The content subset comes from whatever index the caller derives against — the full corpus
   * when sources are loaded, the save's own embedded content when they are not. Either way
   * `collectCharacterContent` is given the kind, because a kind's baseline grants and its one
   * element per point of progression are reached through the system definition rather than
   * through a choice, and a save written without them is the ADR 0012 failure exactly.
   */
  save = async (
    character: Character,
    system: GameSystem,
    elements: ElementIndex,
    options: SaveOptions = {},
  ): Promise<SaveResult> => {
    if (!this.store.available) {
      return { ok: false, reason: 'failed', message: this.store.unavailableReason ?? 'No library.' };
    }
    if (!this.state.location) {
      return { ok: false, reason: 'failed', message: 'No library folder has been chosen yet.' };
    }

    const target: LibraryEntryRef = options.entry ?? {
      name: this.freeName(character.name, options.form ?? 'zip'),
      form: options.form ?? 'zip',
    };

    if (options.entry) {
      const conflict = await this.conflictOn(options.entry, options.expectUpdatedAt);
      if (conflict) return { ok: false, reason: 'conflict', message: conflict };
    }

    try {
      const kind = resolveCharacterKind(system, character.kind);
      const content = collectCharacterContent(character, elements, { kind });
      // Provenance, recorded from the content this character actually embeds (ADR 0028). It
      // only ever gains entries: a version already recorded is what the character was built
      // against and is never re-stamped from the profile.
      const sources = recordSourceRefs(character.sources ?? [], content.elements, this.profile);
      const recorded =
        sources.length === (character.sources?.length ?? 0) ? character : { ...character, sources };
      const files = packCharacterContainer(recorded, content, {
        assets: options.assets,
        generator: options.generator,
      });
      await this.store.write(target, files);
    } catch (error) {
      return { ok: false, reason: 'failed', message: messageOf(error) };
    }

    await this.refresh();
    return { ok: true, entry: target };
  };

  remove = async (entry: LibraryEntryRef): Promise<void> => {
    await this.store.remove(entry);
    await this.refresh();
  };

  /**
   * Has this entry changed on disk since the app read it?
   *
   * ADR 0027: a library folder is very possibly in git or in a sync folder, so the file
   * moving under the app is the normal case rather than an edge one. Re-reading one manifest
   * before a write is cheap, and it is the difference between "your co-player's edit was
   * overwritten" and a sentence saying what happened.
   */
  private async conflictOn(
    entry: LibraryEntryRef,
    expectUpdatedAt: string | undefined,
  ): Promise<string | undefined> {
    if (expectUpdatedAt === undefined) return undefined;
    let manifest: ContainerManifest | undefined;
    try {
      manifest = manifestOf(await this.store.read(entry));
    } catch {
      // Gone, or unreadable. Writing it fresh is the kinder outcome, and it is what the user
      // asked for.
      return undefined;
    }
    const onDisk = manifest?.updated ?? manifest?.created;
    if (!onDisk || onDisk === expectUpdatedAt) return undefined;
    return `"${entry.name}" was changed outside Incudo since it was opened (it now says ${onDisk}). Nothing was written.`;
  }

  /** A file name that is not taken. The suffix is the whole of the collision handling. */
  private freeName(characterName: string, form: ContainerForm): string {
    const base = slug(characterName) || 'character';
    const taken = new Set(this.state.entries.map((entry) => entry.name.toLowerCase()));
    const extension = form === 'zip' ? '.incu' : '';
    for (let n = 0; ; n++) {
      const candidate = `${base}${n ? `-${n + 1}` : ''}${extension}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private describe(ref: LibraryEntryRef, files: ContainerFiles): LibraryEntry {
    const { container, problems } = readCharacterContainer(files);
    if (!container) {
      return {
        ...brokenEntry(ref, 'This container did not read as a character.'),
        problems,
      };
    }
    const { manifest, character } = container;
    const portrait = portraitOf(container.assets, character.assets);
    const sources = character.sources ?? manifest.sources ?? [];
    return {
      name: ref.name,
      form: ref.form,
      title: character.name || manifest.name || ref.name,
      systemId: manifest.systemId ?? character.systemId,
      kind: manifest.characterKind ?? character.kind,
      progress: character.progress,
      updatedAt: manifest.updated ?? manifest.created,
      elementCount: manifest.elementCount ?? container.content.elements.length,
      sources,
      sourceStatuses: compareSourceRefs(sources, this.profile),
      portrait: portrait?.bytes,
      portraitPath: portrait?.path,
      problems,
      broken: false,
    };
  }

  private patch(next: Partial<LibraryState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
}

function brokenEntry(ref: LibraryEntryRef, message: string): LibraryEntry {
  return {
    name: ref.name,
    form: ref.form,
    title: ref.name,
    sources: [],
    sourceStatuses: [],
    problems: [{ level: 'error', path: ref.name, message }],
    broken: true,
  };
}

/**
 * The portrait, if the container has one.
 *
 * Prefers what the character actually references, and falls back to the conventional path so
 * a container assembled by hand still shows a face. Returns undefined rather than anything
 * else — the gap is the honest answer and the app renders it as one.
 */
function portraitOf(
  assets: ContainerFiles,
  referenced: Record<string, string> | undefined,
): { bytes: Uint8Array; path: string } | undefined {
  const named = referenced?.portrait;
  if (named && assets.has(named)) return { bytes: assets.get(named)!, path: named };
  // A container assembled by hand still shows a face. Every extension the importer can
  // produce, because a save may hold any of them — and it really does; see `portraitPath`.
  for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']) {
    const path = ASSETS_PREFIX + 'portrait.' + extension;
    const bytes = assets.get(path);
    if (bytes) return { bytes, path };
  }
  return undefined;
}

function manifestOf(files: ContainerFiles): ContainerManifest | undefined {
  const bytes = files.get('manifest.json');
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as ContainerManifest;
  } catch {
    return undefined;
  }
}

/** Most recently edited first, with anything undated after it and ties broken by name. */
function byRecency(a: LibraryEntry, b: LibraryEntry): number {
  if (a.updatedAt && b.updatedAt && a.updatedAt !== b.updatedAt) {
    return a.updatedAt < b.updatedAt ? 1 : -1;
  }
  if (!!a.updatedAt !== !!b.updatedAt) return a.updatedAt ? -1 : 1;
  return a.title.localeCompare(b.title);
}

function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
