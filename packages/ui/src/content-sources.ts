/**
 * The content a shell builds with, for a shell that offers a system's suggested sources — the phone's, ADR 0086.
 *
 * Opening, reading and playing a character need no content (ADR 0012); building one does. This keeps the user's source
 * profile (ADR 0028, the same `SourceProfile` the desktop keeps), adds a system's suggested source in download mode or
 * an Aurora file the user picked (ADR 0056), switches one on or off, switches its parts off (ADR 0055), checks it for
 * updates (ADR 0050), moves it (ADR 0054), refreshes and removes one, and loads a system's enabled
 * sources through `loadSources` when something asks for them, at most once per set of sources: a build asks, the app's
 * start does not. Every source belongs to the system it was added under (ADR 0031); a load reads only that system's.
 *
 * A store with `subscribe` and `getState`, as `CharacterLibrary` is, so a screen renders it and computes nothing.
 */

import {
  SourceProfile,
  checkSourceForUpdates,
  loadSources,
  refreshSource,
  removeSource,
  sourceParts,
  sourcesForSystem,
  type ComposeOptions,
  type ConfiguredSource,
  type IndexTreeNode,
  type LoadProgress,
  type LoadedContent,
  type RefreshReport,
  type UpdateStatus,
} from '@incudo/content';
import type { GameSystem, PickedFile, SuggestedSource } from '@incudo/core';

import { addContentFiles, type ContentFileResult } from './content-files.ts';

import { SourceLoads, sourcesLoadKey } from './source-loads.ts';

export interface ContentSourcesState {
  /** False until the profile has been read. */
  ready: boolean;
  /** Every configured source, of every system, in the profile's order. */
  sources: readonly ConfiguredSource[];
  /** The last load of each system's enabled sources, by system id. */
  loaded: Readonly<Record<string, LoadedContent>>;
  /** A load in progress: which system's, and how far. */
  loading?: { systemId: string; progress?: LoadProgress };
  /** The last thing that went wrong, in a sentence, until the next action. */
  message?: string;
  /** What the last "Check for updates" of a source found, by source id (ADR 0050). */
  updates: Readonly<Record<string, UpdateStatus>>;
  /** What the last refresh of a source did, or why it failed, by source id. */
  refreshes: Readonly<Record<string, RefreshReport | { failed: string }>>;
  /** What the last files the user added came to, one line each (ADR 0056); until the next add. */
  files?: readonly ContentFileResult[];
  /** A check, a parts read or a file add in progress: the screen's buttons wait for it. */
  busy?: boolean;
}

export class ContentSources {
  private readonly platform: ComposeOptions;
  private readonly systems: readonly GameSystem[];
  private profile: SourceProfile | undefined;
  private state: ContentSourcesState = { ready: false, sources: [], loaded: {}, updates: {}, refreshes: {} };
  private readonly listeners = new Set<() => void>();
  private readonly keys = new Map<string, string>();
  private readonly pending = new Map<string, Promise<LoadedContent>>();
  private readonly loads = new SourceLoads();

  constructor(platform: ComposeOptions, systems: readonly GameSystem[]) {
    this.platform = platform;
    this.systems = systems;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): ContentSourcesState => this.state;

  private patch(next: Partial<ContentSourcesState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  /** Read the profile, once; later calls change nothing (and publish nothing). Loads no content. */
  restore = async (): Promise<void> => {
    if (this.profile) return;
    this.profile = await SourceProfile.load(this.platform.storage);
    this.patch({ ready: true, sources: [...this.profile.sources] });
  };

  private async current(): Promise<SourceProfile> {
    if (!this.profile) await this.restore();
    return this.profile!;
  }

  private async persist(): Promise<void> {
    const profile = await this.current();
    await profile.save();
    this.patch({ sources: [...profile.sources] });
  }

  /** A system's configured sources. */
  sourcesFor = (systemId: string): ConfiguredSource[] => sourcesForSystem(this.state.sources, systemId);

  /** What a system suggests and the profile does not hold yet, under any system (a source belongs to one, ADR 0031). */
  suggestionsFor = (systemId: string): SuggestedSource[] => {
    const system = this.systems.find((candidate) => candidate.id === systemId);
    return (system?.suggestedSources ?? []).filter((suggestion) => !this.state.sources.some((source) => source.url === suggestion.url));
  };

  /** Whether a system has any source switched on: with none, a build has nothing to offer. */
  hasEnabled = (systemId: string): boolean => this.sourcesFor(systemId).some((source) => source.enabled);

  /** Add a suggested source under a system, and load that system's sources: the load converts it (ADR 0119). */
  add = async (systemId: string, suggestion: SuggestedSource): Promise<void> => {
    const profile = await this.current();
    profile.add(suggestion.url, {
      name: suggestion.name,
      mode: 'download',
      systemId,
      ...(suggestion.official !== undefined ? { official: suggestion.official } : {}),
    });
    await this.persist();
    await this.load(systemId);
  };

  /**
   * Switch it on or off. A system that was loaded is loaded again at once, so every source's line says what it misses
   * now and which switched-off source had it (ADRs 0052, 0090), as the desktop's does; one nothing has loaded stays
   * unloaded, since the phone loads only when asked.
   */
  setEnabled = async (id: string, enabled: boolean): Promise<void> => {
    (await this.current()).update(id, { enabled });
    await this.persist();
    const systemId = this.state.sources.find((source) => source.id === id)?.systemId;
    const wasLoaded = systemId !== undefined && this.state.loaded[systemId] !== undefined;
    this.forget(id);
    if (wasLoaded) void this.load(systemId).catch(() => undefined);
  };

  /** Convert it again from the network (ADR 0119), and load its system's sources again. */
  refresh = async (id: string): Promise<void> => {
    const source = (await this.current()).find(id);
    if (!source) return;
    this.patch({ message: undefined, loading: { systemId: source.systemId ?? '' } });
    let report: RefreshReport;
    try {
      report = await refreshSource(source, this.platform);
    } catch (error) {
      // The saved copy is left as it was, and the source's line says so (`refreshNote`).
      this.patch({ loading: undefined, refreshes: { ...this.state.refreshes, [id]: { failed: messageOf(error) } } });
      return;
    }
    const { [id]: _checked, ...updates } = this.state.updates;
    this.patch({ loading: undefined, refreshes: { ...this.state.refreshes, [id]: report }, updates });
    const systemId = this.forget(id);
    if (systemId) await this.load(systemId);
  };

  /** Ask whether it changed upstream (ADR 0050). Never writes: the answer is reported on its line. */
  checkForUpdates = async (id: string): Promise<void> => {
    const source = (await this.current()).find(id);
    if (!source) return;
    this.patch({ busy: true, message: undefined });
    try {
      const status = await checkSourceForUpdates(source, this.platform);
      this.patch({ updates: { ...this.state.updates, [id]: status } });
    } finally {
      this.patch({ busy: false });
    }
  };

  /** Its parts tree, read from its conversion (converting it first if it has none), for choosing what to switch off. */
  readParts = async (id: string): Promise<IndexTreeNode> => {
    const source = (await this.current()).find(id);
    if (!source) throw new Error('That source is no longer in the list.');
    return sourceParts(source, this.platform);
  };

  /** Record the parts switched off (ADR 0055); the next load leaves them out. */
  setExcluded = async (id: string, excluded: readonly string[]): Promise<void> => {
    (await this.current()).update(id, { excluded: excluded.length ? [...excluded] : undefined });
    await this.persist();
    const systemId = this.forget(id);
    if (systemId) await this.load(systemId);
  };

  /**
   * Add Aurora files the user picked, each a source of its own under a system (ADR 0056), added last so their
   * definitions are used (ADR 0054), and load that system's sources when any was added.
   */
  addFiles = async (systemId: string, files: readonly PickedFile[]): Promise<void> => {
    if (!files.length) return;
    const profile = await this.current();
    this.patch({ busy: true, message: undefined });
    let results: ContentFileResult[];
    try {
      const nameOfSystem = (other: string): string => this.systems.find((system) => system.id === other)?.name ?? other;
      results = await addContentFiles(files, profile, this.platform, { systemId, nameOfSystem });
    } finally {
      this.patch({ busy: false });
    }
    this.patch({ files: results });
    if (!results.some((result) => result.added)) return;
    await this.persist();
    this.drop(systemId);
    await this.load(systemId);
  };

  /**
   * Move it one place among its system's sources (ADR 0054): of two that define the same id, the later is used. Loaded
   * again only when the order of the enabled ones changed, which is all a load reads.
   */
  move = async (id: string, direction: 'up' | 'down'): Promise<void> => {
    const profile = await this.current();
    const systemId = profile.find(id)?.systemId;
    if (!systemId) return;
    const order = (): string => this.sourcesFor(systemId).filter((source) => source.enabled).map((source) => source.id).join(' ');
    const before = order();
    if (!profile.move(id, direction, (source) => source.systemId === systemId)) return;
    await this.persist();
    if (order() !== before) {
      this.drop(systemId);
      await this.load(systemId);
    }
  };

  /**
   * Remove it, and the file it was kept as. A character that embeds its content keeps working (ADR 0028); the space is
   * the point on a phone, so the file goes with the entry.
   */
  remove = async (id: string): Promise<void> => {
    const profile = await this.current();
    const systemId = profile.find(id)?.systemId;
    await removeSource(profile, this.platform, id);
    await this.persist();
    if (systemId) this.drop(systemId);
  };

  /**
   * A system's enabled sources, loaded: the last load when the set has not changed since, else a new one. Two callers
   * asking at once share one load. A source that fails is reported in the result's `errors`, as the desktop's are.
   *
   * Loads of different sets may overlap (a source switched while one runs), and only one whose sources are still the
   * ones switched on when it ends publishes (`SourceLoads`); one that does not hands its caller the current set's load.
   */
  load = async (systemId: string): Promise<LoadedContent> => {
    const enabled = this.sourcesFor(systemId).filter((source) => source.enabled);
    const key = sourcesLoadKey(enabled);
    const done = this.state.loaded[systemId];
    if (done && this.keys.get(systemId) === key) return done;
    const running = this.pending.get(key);
    if (running) return running;

    const current = (): boolean => sourcesLoadKey(this.sourcesFor(systemId).filter((source) => source.enabled)) === key;
    const end = this.loads.begin(systemId);
    const loading = (async () => {
      this.patch({ loading: { systemId }, message: undefined });
      let loaded: LoadedContent | undefined;
      let failure: { error: unknown } | undefined;
      try {
        // Progress at most five times a second: every listener renders on a patch, and a load reports every file.
        let reported = 0;
        // What the switched-off ones declared at their last load names them on a line that misses it (ADR 0090).
        const switchedOff = this.sourcesFor(systemId).filter((source) => !source.enabled);
        loaded = await loadSources(enabled, this.platform, (progress) => {
          const now = Date.now();
          if (now - reported < 200 && progress.loaded < progress.total) return;
          if (!current()) return;
          reported = now;
          this.patch({ loading: { systemId, progress } });
        }, { switchedOff });
        const profile = await this.current();
        for (const source of loaded.sources) {
          if (source.failed) continue;
          profile.update(source.id, {
            version: source.version,
            fileCount: source.fileCount,
            elementCount: source.elementCount,
            lastLoadedAt: new Date().toISOString(),
          });
        }
        await this.persist();
      } catch (error) {
        failure = { error };
      } finally {
        this.pending.delete(key);
      }

      const { publish, idle } = end(current());
      if (publish && failure) {
        this.patch({ loading: undefined, message: `Could not load content: ${messageOf(failure.error)}` });
        throw failure.error;
      }
      if (publish) {
        this.keys.set(systemId, key);
        this.patch({ loaded: { ...this.state.loaded, [systemId]: loaded! }, loading: undefined });
        return loaded!;
      }
      if (idle) this.patch({ loading: undefined });
      return this.load(systemId);
    })();
    this.pending.set(key, loading);
    return loading;
  };

  /** Forget the load of the system `id` belongs to, so the next `load` is made again. The system's id, if any. */
  private forget(id: string): string | undefined {
    const systemId = this.state.sources.find((source) => source.id === id)?.systemId;
    if (systemId) this.drop(systemId);
    return systemId;
  }

  private drop(systemId: string): void {
    this.keys.delete(systemId);
    const { [systemId]: _gone, ...rest } = this.state.loaded;
    this.patch({ loaded: rest });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Keep a character library told the whole profile, now and whenever it changes (ADR 0028), so a Save records the sources
 * the character draws on and a card can say which of them moved or went. The desktop calls `setProfile` where it saves
 * the profile; the phone had no such call, and every character it saved recorded no sources (found on the emulator).
 * Returns what stops it.
 */
export function keepLibraryProfile(
  sources: Pick<ContentSources, 'subscribe' | 'getState'>,
  library: { setProfile(profile: readonly ConfiguredSource[]): void },
): () => void {
  let told: readonly ConfiguredSource[] | undefined;
  const tell = (): void => {
    const profile = sources.getState().sources;
    if (profile === told) return;
    told = profile;
    library.setProfile(profile);
  };
  tell();
  return sources.subscribe(tell);
}
