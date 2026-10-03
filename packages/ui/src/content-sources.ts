/**
 * The content a shell builds with, for a shell that offers a system's suggested sources — the phone's, ADR 0086.
 *
 * Opening, reading and playing a character need no content (ADR 0012); building one does. This keeps the user's source
 * profile (ADR 0028, the same `SourceProfile` the desktop keeps), adds a system's suggested source in download mode,
 * switches one on or off, chooses how it is kept (ADR 0085), refreshes and removes one, and loads a system's enabled
 * sources through `loadSources` when something asks for them, at most once per set of sources: a build asks, the app's
 * start does not. Every source belongs to the system it was added under (ADR 0031); a load reads only that system's.
 *
 * A store with `subscribe` and `getState`, as `CharacterLibrary` is, so a screen renders it and computes nothing.
 */

import {
  SourceProfile,
  evictSourceCache,
  keepsConverted,
  loadSources,
  refreshSource,
  removeSource,
  sourcesForSystem,
  type ComposeOptions,
  type ConfiguredSource,
  type LoadProgress,
  type LoadedContent,
  type SourceKeep,
} from '@incudo/content';
import type { GameSystem, SuggestedSource } from '@incudo/core';

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
}

/** A load's identity: which sources, in which order, kept which way. A load of the same set is not made again. */
function loadKey(sources: readonly ConfiguredSource[]): string {
  return JSON.stringify(sources.map((source) => [source.id, keepsConverted(source), source.excluded ?? []]));
}

export class ContentSources {
  private readonly platform: ComposeOptions;
  private readonly systems: readonly GameSystem[];
  private profile: SourceProfile | undefined;
  private state: ContentSourcesState = { ready: false, sources: [], loaded: {} };
  private readonly listeners = new Set<() => void>();
  private readonly keys = new Map<string, string>();
  private readonly pending = new Map<string, Promise<LoadedContent>>();

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

  /** Add a suggested source under a system, in download mode, kept as chosen, and load that system's sources. */
  add = async (systemId: string, suggestion: SuggestedSource, keep: SourceKeep): Promise<void> => {
    const profile = await this.current();
    profile.add(suggestion.url, {
      name: suggestion.name,
      mode: 'download',
      systemId,
      keep,
      ...(suggestion.official !== undefined ? { official: suggestion.official } : {}),
    });
    await this.persist();
    await this.load(systemId);
  };

  setEnabled = async (id: string, enabled: boolean): Promise<void> => {
    (await this.current()).update(id, { enabled });
    await this.persist();
    this.forget(id);
  };

  /** Converted or as files (ADR 0085), made so by loading again. */
  setKeep = async (id: string, keep: SourceKeep): Promise<void> => {
    (await this.current()).update(id, { keep });
    await this.persist();
    const systemId = this.forget(id);
    if (systemId) await this.load(systemId);
  };

  /** Fetch it again (ADR 0050), and load its system's sources again. */
  refresh = async (id: string): Promise<void> => {
    const source = (await this.current()).find(id);
    if (!source) return;
    this.patch({ message: undefined, loading: { systemId: source.systemId ?? '' } });
    try {
      await refreshSource(source, this.platform);
    } catch (error) {
      this.patch({ loading: undefined, message: `Could not refresh ${source.name}: ${messageOf(error)}` });
      return;
    }
    this.patch({ loading: undefined });
    const systemId = this.forget(id);
    if (systemId) await this.load(systemId);
  };

  /**
   * Remove it, and what it kept on this device. A character that embeds its content keeps working (ADR 0028); the space
   * is the point on a phone, so the cache goes with the entry.
   */
  remove = async (id: string): Promise<void> => {
    const profile = await this.current();
    const systemId = profile.find(id)?.systemId;
    await removeSource(profile, this.platform.storage, id);
    await evictSourceCache(this.platform.storage, id);
    await this.persist();
    if (systemId) this.drop(systemId);
  };

  /**
   * A system's enabled sources, loaded: the last load when the set has not changed since, else a new one. Two callers
   * asking at once share one load. A source that fails is reported in the result's `errors`, as the desktop's are.
   */
  load = async (systemId: string): Promise<LoadedContent> => {
    const enabled = this.sourcesFor(systemId).filter((source) => source.enabled);
    const key = loadKey(enabled);
    const done = this.state.loaded[systemId];
    if (done && this.keys.get(systemId) === key) return done;
    const running = this.pending.get(key);
    if (running) return running;

    const loading = (async () => {
      this.patch({ loading: { systemId }, message: undefined });
      try {
        // Progress at most five times a second: every listener renders on a patch, and a load reports every file.
        let reported = 0;
        const loaded = await loadSources(enabled, this.platform, (progress) => {
          const now = Date.now();
          if (now - reported < 200 && progress.loaded < progress.total) return;
          reported = now;
          this.patch({ loading: { systemId, progress } });
        });
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
        this.keys.set(systemId, key);
        this.patch({ loaded: { ...this.state.loaded, [systemId]: loaded }, loading: undefined });
        return loaded;
      } catch (error) {
        this.patch({ loading: undefined, message: `Could not load content: ${messageOf(error)}` });
        throw error;
      } finally {
        this.pending.delete(key);
      }
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
