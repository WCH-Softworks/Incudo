/**
 * The content a shell builds with, for a shell that offers a system's suggested sources — the phone's, ADR 0086.
 *
 * Opening, reading and playing a character need no content (ADR 0012); building one does. This keeps the user's source
 * profile (ADR 0028, the same `SourceProfile` the desktop keeps), adds a system's suggested source in download mode,
 * switches one on or off, refreshes and removes one, and loads a system's enabled
 * sources through `loadSources` when something asks for them, at most once per set of sources: a build asks, the app's
 * start does not. Every source belongs to the system it was added under (ADR 0031); a load reads only that system's.
 *
 * A store with `subscribe` and `getState`, as `CharacterLibrary` is, so a screen renders it and computes nothing.
 */

import {
  SourceProfile,
  loadSources,
  refreshSource,
  removeSource,
  sourcesForSystem,
  type ComposeOptions,
  type ConfiguredSource,
  type LoadProgress,
  type LoadedContent,
} from '@incudo/content';
import type { GameSystem, SuggestedSource } from '@incudo/core';

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
}

export class ContentSources {
  private readonly platform: ComposeOptions;
  private readonly systems: readonly GameSystem[];
  private profile: SourceProfile | undefined;
  private state: ContentSourcesState = { ready: false, sources: [], loaded: {} };
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

  setEnabled = async (id: string, enabled: boolean): Promise<void> => {
    (await this.current()).update(id, { enabled });
    await this.persist();
    this.forget(id);
  };

  /** Convert it again from the network (ADR 0119), and load its system's sources again. */
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
        loaded = await loadSources(enabled, this.platform, (progress) => {
          const now = Date.now();
          if (now - reported < 200 && progress.loaded < progress.total) return;
          if (!current()) return;
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
