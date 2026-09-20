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
  type ContentSubset,
  type ElementId,
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

/** Characters in the folder that belong to a system other than the one in view — ADR 0031. */
export interface ElsewhereCount {
  /** Undefined for a container whose manifest names no system at all. */
  systemId?: string;
  count: number;
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
  /**
   * The characters of the system in view, or every character when no system is set.
   *
   * Filtered rather than flagged, because the user's model is that choosing D&D means seeing
   * D&D characters and nothing else (ADR 0031). What must not follow from that is a folder
   * that looks empty when it is not — see {@link elsewhere}.
   */
  entries: LibraryEntry[];
  /**
   * What the filter is hiding, counted by system. Empty when nothing is hidden.
   *
   * A library folder holds whatever the user put in it, and "you have no characters" and "you
   * have nine, in another system" are different sentences. This is the second one, and a view
   * that drops it turns a filter into a disappearance.
   */
  elsewhere: ElsewhereCount[];
  /** Something that went wrong with the scan itself, rather than with one character. */
  problems: string[];
  busy: boolean;
}

/** What opening an entry gives back: everything needed to derive, and to write it out again. */
export interface OpenedCharacter {
  entry: LibraryEntry;
  character: Character;
  /** An index over the save's *own* embedded content. No sources involved. */
  elements: ElementIndex;
  /**
   * The container's asset files, by container path (`assets/portrait.png`), as real bytes.
   *
   * Not needed to derive anything, and here for the write back out: a `Character` records only
   * *where* its portrait is, and `packCharacter` embeds only the assets it is handed. A shell that
   * opens a character and later saves it has to pass these to `save` or `saveCopy`, or the file it
   * writes still names a portrait it no longer holds. Every one of the nine real saves lost its
   * portrait this way before it was returned.
   */
  assets: ContainerFiles;
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
  /**
   * Ids to embed on top of what the character reaches on its own — `collectCharacterContent`'s
   * `extraIds`.
   *
   * Here for the Aurora import, whose source of these is Aurora's own `<sum>`: every element
   * *its* derivation ended up with. Embedding that set is what keeps the Aurora oracle
   * meaningful after the original `.dnd5e` is gone. It is a fact about the character being
   * written rather than about the packing, which is why it rides with the other save options
   * instead of forking a second packing path.
   */
  extraIds?: ElementId[];
}

export type SaveResult =
  | {
      ok: true;
      entry: LibraryEntryRef;
      /** How many elements the container ended up embedding. */
      elementCount: number;
      /**
       * Ids the character names that the index it was packed against does not declare.
       *
       * Recorded in the container either way (`collectCharacterContent` reports rather than
       * guessing — ADR 0005) and handed back here so a caller can say so. The Aurora import
       * is where this matters: a save built with a book the user has not loaded still
       * imports, and this is the only place that says which parts of it will be missing.
       */
      unresolved: ElementId[];
    }
  | { ok: false; reason: 'conflict' | 'failed'; message: string };

export interface PackOptions {
  /**
   * The configured sources, which is what turns an element's origin into the version a
   * character records having been built against (ADR 0028). Absent reads as no sources, and
   * every source the character embeds content from is then recorded without a version.
   */
  profile?: readonly ConfiguredSource[];
  assets?: ContainerFiles;
  generator?: string;
  extraIds?: ElementId[];
}

export interface PackedCharacter {
  /** The container tree: the folder form, which a `ZipCodec` turns into a `.incu`. */
  files: ContainerFiles;
  /** What was embedded, and what the character names that the index could not supply. */
  content: ContentSubset;
}

/**
 * Turn a character and the index it derives against into a self-contained container tree.
 *
 * **The one packing function.** The library's Save and a copy written anywhere else (ADR 0038)
 * both call it, so what "Save a copy" puts in a file is by construction what Save puts in the
 * library, and a rule added here — a new thing every save must embed — reaches both. It touches
 * no store and no picker.
 *
 * The content subset comes from whatever index the caller derives against: the full corpus when
 * sources are loaded, the save's own embedded content when they are not. Either way
 * `collectCharacterContent` is given the kind, because a kind's baseline grants and its one
 * element per point of progression are reached through the system definition rather than through
 * a choice, and a save written without them is the ADR 0012 failure exactly.
 */
export function packCharacter(
  character: Character,
  system: GameSystem,
  elements: ElementIndex,
  options: PackOptions = {},
): PackedCharacter {
  const kind = resolveCharacterKind(system, character.kind);
  const content = collectCharacterContent(character, elements, {
    kind,
    extraIds: options.extraIds,
  });
  // Provenance, recorded from the content this character actually embeds (ADR 0028). It only
  // ever gains entries: a version already recorded is what the character was built against and
  // is never re-stamped from the profile.
  const sources = recordSourceRefs(character.sources ?? [], content.elements, options.profile ?? []);
  const recorded =
    sources.length === (character.sources?.length ?? 0) ? character : { ...character, sources };
  const files = packCharacterContainer(recorded, content, {
    assets: options.assets,
    generator: options.generator,
  });
  return { files, content };
}

/**
 * The file name a character is offered under: its name reduced to what every filesystem
 * accepts, plus `.incu`.
 */
export function suggestedFileName(characterName: string): string {
  return `${slug(characterName) || 'character'}.incu`;
}

export class CharacterLibrary {
  private readonly store: CharacterStore;
  private readonly listeners = new Set<() => void>();
  private state: LibraryState;
  private profile: readonly ConfiguredSource[] = [];
  /**
   * Every container the last scan found, before the system filter.
   *
   * Kept separately from `state.entries` for a reason that is not tidiness: `freeName` picks a
   * filename that nothing on disk is using, and asking the *filtered* list would let a new D&D
   * character be written straight over a Cairn one with the same name. The folder is the list
   * (ADR 0027) and the whole folder is what a name has to be free of.
   */
  private scanned: LibraryEntry[] = [];
  private systemId: string | undefined;

  constructor(store: CharacterStore) {
    this.store = store;
    this.state = {
      status: store.available ? 'no-location' : 'unavailable',
      unavailableReason: store.unavailableReason,
      location: null,
      entries: [],
      elsewhere: [],
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
    if (!this.scanned.length) return;
    // Restated across the whole scan, not just the visible slice: a source status that went
    // stale while its character was filtered out would come back wrong when the user switched
    // systems, and nothing would rescan in between.
    this.scanned = this.scanned.map((entry) => ({
      ...entry,
      sourceStatuses: compareSourceRefs(entry.sources, this.profile),
    }));
    this.patch(this.partition(this.scanned));
  };

  /**
   * Show only the characters of this system — ADR 0031.
   *
   * Passing `undefined` shows everything, which is what the tests want: the filter
   * is a property of a shell that has asked the user which game they are playing, not of the
   * library itself. No rescan; the folder was already read.
   */
  setSystem = (systemId: string | undefined): void => {
    if (this.systemId === systemId) return;
    this.systemId = systemId;
    this.patch(this.partition(this.scanned));
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
      this.scanned = [];
      this.patch({
        status: 'ready',
        busy: false,
        entries: [],
        elsewhere: [],
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
    this.scanned = entries;
    this.patch({ status: 'ready', busy: false, problems, ...this.partition(entries) });
  };

  /** Split a scan into what this system shows and what it is hiding. */
  private partition(scanned: LibraryEntry[]): Pick<LibraryState, 'entries' | 'elsewhere'> {
    if (this.systemId === undefined) return { entries: scanned, elsewhere: [] };
    const entries: LibraryEntry[] = [];
    const counts = new Map<string | undefined, number>();
    for (const entry of scanned) {
      // A broken container has no readable manifest and so no system to judge it by. It stays
      // visible in every system rather than vanishing from all of them: the user can see the
      // file in their own file manager, and "this one will not open" is the more useful thing
      // to say about it than nothing at all.
      if (entry.broken || entry.systemId === this.systemId) entries.push(entry);
      else counts.set(entry.systemId, (counts.get(entry.systemId) ?? 0) + 1);
    }
    const elsewhere = [...counts]
      .map(([systemId, count]) => ({ systemId, count }))
      .sort((a, b) => (a.systemId ?? '').localeCompare(b.systemId ?? ''));
    return { entries, elsewhere };
  }

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
      assets: container.assets,
      problems,
    };
  };

  /**
   * Write a character into the library. What is written is `packCharacter`'s: see there for what
   * the content subset is drawn from, and why the kind is passed.
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

    let packed: ContentSubset;
    try {
      const result = packCharacter(character, system, elements, {
        profile: this.profile,
        assets: options.assets,
        generator: options.generator,
        extraIds: options.extraIds,
      });
      await this.store.write(target, result.files);
      packed = result.content;
    } catch (error) {
      return { ok: false, reason: 'failed', message: messageOf(error) };
    }

    await this.refresh();
    return {
      ok: true,
      entry: target,
      elementCount: packed.elements.length,
      unresolved: packed.unresolved,
    };
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
    // Every container in the folder, not the filtered view: a name is free only if nothing on
    // disk holds it, and a Cairn character is very much on disk while a D&D one is being saved.
    const taken = new Set(this.scanned.map((entry) => entry.name.toLowerCase()));
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
