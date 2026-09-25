/**
 * The sources the *user* has configured — ADR 0028.
 *
 * There are two lists of sources in this project and they are deliberately not the same list.
 * A character's `sources` is a record of what that character was built against, written into
 * its save and carried with it forever. This is the other one: which sources exist on this
 * machine, what the user calls them, whether they are enabled, and whether they stream or
 * download. It is never written into a character, and no character ever needs it to open
 * (ADR 0012).
 *
 * The two are allowed to disagree, and that disagreement is the whole feature:
 * {@link compareSourceRefs} turns it into the warning ADR 0004 promised and nothing had ever
 * implemented.
 */

import type { Element, SourceRef, Storage } from '@incudo/core';
import { compareVersions, type SourceMode } from './source.ts';

/** Where the profile lives in the injected Storage. One small JSON document. */
export const SOURCE_PROFILE_KEY = 'sources/profile.json';

export interface ConfiguredSource {
  /**
   * The index URL. It is the id because it is the only thing that is stable across renames
   * and the only thing a character's `SourceRef` can be matched against — the importer writes
   * Aurora's own source ids, and the app writes index URLs, so two URLs are two sources even
   * when they serve the same bytes (ADR 0028).
   */
  id: string;
  url: string;
  /** The user's name for it. Defaults to whatever the index calls itself. */
  name: string;
  /**
   * Which game system this source serves — ADR 0031.
   *
   * **Recorded, never inferred.** Nothing in a content index says what game it is for: an
   * Aurora `.index` has no field for one and never will (the format is frozen, ADR 0008), and
   * two indexes of different games are byte-shaped the same. Guessing from the element types a
   * source contributes would need it loaded first and would still be a guess, which is what
   * ADR 0005 rules out. So the app records what the user said when they added it — and for a
   * source picked from a system's own `suggestedSources` the user said it by picking it.
   *
   * Optional because a profile written before ADR 0031 has none, and because an entry with no
   * system is a real state rather than a defect. Such a source is **shown and never silently
   * hidden**: {@link unassignedSources} is what a view uses to offer "assign this to …".
   */
  systemId?: string;
  enabled: boolean;
  /** ADR 0029: `download` fetches when added, `stream` fetches when first used. */
  mode: SourceMode;
  /**
   * This came from the system definition's `suggestedSources` and that definition vouched
   * for it — carried so a view can show the badge without re-reading the system. A claim by
   * whoever wrote the system, not a check by Incudo; see `SuggestedSource.official`.
   */
  official?: boolean;
  /** The version last seen in the index. The cache's stamp, mirrored here for display. */
  version?: string;
  addedAt: string;
  lastLoadedAt?: string;
  /** What it contributed the last time it was loaded, so the UI can say. */
  fileCount?: number;
  elementCount?: number;
}

export interface SourceProfileData {
  formatVersion: 1;
  sources: ConfiguredSource[];
}

/**
 * A mutable list of configured sources, loaded from and saved to the injected Storage.
 *
 * Deliberately not a store with subscribers: it changes when the user changes it, which is
 * rare and always from one place. The view-model above it re-reads after each edit.
 */
export class SourceProfile {
  private entries: ConfiguredSource[];
  private readonly storage: Storage;

  constructor(storage: Storage, sources: ConfiguredSource[] = []) {
    this.storage = storage;
    this.entries = sources;
  }

  /**
   * Read the profile. A profile that will not parse is replaced by an empty one rather than
   * refusing to boot — it holds no irreplaceable data, unlike a character.
   */
  static async load(storage: Storage): Promise<SourceProfile> {
    try {
      const text = await storage.read(SOURCE_PROFILE_KEY);
      if (!text) return new SourceProfile(storage);
      const data = JSON.parse(text) as SourceProfileData;
      const sources = Array.isArray(data.sources) ? data.sources.filter(isConfigured) : [];
      return new SourceProfile(storage, sources);
    } catch {
      return new SourceProfile(storage);
    }
  }

  get sources(): readonly ConfiguredSource[] {
    return this.entries;
  }

  get enabled(): ConfiguredSource[] {
    return this.entries.filter((source) => source.enabled);
  }

  find(id: string): ConfiguredSource | undefined {
    return this.entries.find((source) => source.id === id);
  }

  /** Adding a source that is already there updates it rather than duplicating it. */
  add(url: string, options: Partial<ConfiguredSource> = {}): ConfiguredSource {
    const id = url;
    const existing = this.find(id);
    if (existing) {
      Object.assign(existing, options, { id, url });
      return existing;
    }
    const source: ConfiguredSource = {
      id,
      url,
      name: options.name ?? nameFromUrl(url),
      enabled: options.enabled ?? true,
      mode: options.mode ?? 'stream',
      version: options.version,
      systemId: options.systemId,
      official: options.official,
      addedAt: options.addedAt ?? new Date().toISOString(),
    };
    this.entries.push(source);
    return source;
  }

  update(id: string, patch: Partial<ConfiguredSource>): ConfiguredSource | undefined {
    const source = this.find(id);
    if (!source) return undefined;
    Object.assign(source, patch, { id: source.id });
    return source;
  }

  /**
   * Swap a source with its nearest neighbour above or below among the entries `among` accepts (a system's, ADR 0031),
   * leaving every other entry where it is. The order is which source is used when two define the same id: the later
   * one (ADR 0054). Returns false when there is no such neighbour.
   */
  move(id: string, direction: 'up' | 'down', among: (source: ConfiguredSource) => boolean = () => true): boolean {
    const from = this.entries.findIndex((source) => source.id === id);
    if (from < 0) return false;
    const step = direction === 'up' ? -1 : 1;
    for (let to = from + step; to >= 0 && to < this.entries.length; to += step) {
      if (!among(this.entries[to]!)) continue;
      const next = [...this.entries];
      [next[from], next[to]] = [next[to]!, next[from]!];
      this.entries = next;
      return true;
    }
    return false;
  }

  /** Removes it from the profile and changes no character (ADR 0028). */
  remove(id: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((source) => source.id !== id);
    return this.entries.length !== before;
  }

  async save(): Promise<void> {
    const data: SourceProfileData = { formatVersion: 1, sources: this.entries };
    await this.storage.write(SOURCE_PROFILE_KEY, JSON.stringify(data, null, 2) + '\n');
  }
}

/**
 * The sources that serve one system — ADR 0031.
 *
 * Untagged sources are **not** included. A source with no `systemId` is one the app has never
 * been told anything about, and quietly counting it as this system's would put a Pathfinder
 * index into a D&D character's content the first time someone kept two. They are surfaced by
 * {@link unassignedSources} instead, which is a question to put to the user rather than an
 * answer to invent.
 */
export function sourcesForSystem(
  profile: readonly ConfiguredSource[],
  systemId: string,
): ConfiguredSource[] {
  return profile.filter((source) => source.systemId === systemId);
}

/** Sources the user has never assigned to a system. Shown, never hidden. */
export function unassignedSources(profile: readonly ConfiguredSource[]): ConfiguredSource[] {
  return profile.filter((source) => source.systemId === undefined);
}

export type SourceRefState = 'present' | 'moved' | 'missing';

export interface SourceRefStatus {
  ref: SourceRef;
  state: SourceRefState;
  /** What the profile has, when it has anything. */
  configured?: ConfiguredSource;
}

/**
 * What a character's recorded sources look like against the profile — ADR 0028's three states.
 *
 * Nothing here changes anything. A `missing` source is not an error and must never read like
 * one: a character built from a homebrew index the user has since removed is a perfectly good
 * character that still opens and still derives, and the only thing it cannot do is offer new
 * choices from that source.
 */
export function compareSourceRefs(
  refs: readonly SourceRef[],
  profile: readonly ConfiguredSource[],
): SourceRefStatus[] {
  return refs.map((ref) => {
    const configured = profile.find((source) => source.id === ref.id || source.url === ref.id);
    if (!configured) return { ref, state: 'missing' as const };
    // An unknown version on either side is `present`, not `moved`. Plenty of homebrew indexes
    // carry no version at all, and reporting every one of them as changed would make the
    // warning noise rather than news.
    if (!ref.version || !configured.version) return { ref, state: 'present' as const, configured };
    const state = compareVersions(ref.version, configured.version) === 0 ? 'present' : 'moved';
    return { ref, state, configured };
  });
}

/**
 * What a character was built against, worked out from the content it actually embeds.
 *
 * ADR 0028 says a character's `sources` is written "only when a character is saved after
 * actually drawing on that source", and until this existed nothing wrote it at all outside the
 * Aurora importer — so a character built in the app recorded no sources, and the warning the
 * ADR designed could never fire for one. Every element carries `origin.sourceId`, which for a
 * configured source is its index URL, so the answer is derivable rather than guessable.
 *
 * **An existing ref is never modified.** Not its version, not its name. The recorded version
 * is what this character was built against, and re-stamping it with whatever the profile says
 * today is exactly the "makes the warning permanently impossible to fire" alternative ADR 0028
 * rejected. Moving one is what a deliberate refresh is for — and that flow does not exist yet,
 * so a character that outlives a source update keeps saying so until someone builds it.
 */
export function recordSourceRefs(
  existing: readonly SourceRef[],
  elements: Iterable<Element>,
  profile: readonly ConfiguredSource[],
): SourceRef[] {
  const known = new Set(existing.map((ref) => ref.id));
  const refs = [...existing];

  const contributed = new Set<string>();
  for (const element of elements) contributed.add(element.origin.sourceId);

  for (const source of profile) {
    if (!contributed.has(source.id) || known.has(source.id)) continue;
    known.add(source.id);
    refs.push({ id: source.id, name: source.name, version: source.version, mode: source.mode });
  }
  return refs;
}

function isConfigured(value: unknown): value is ConfiguredSource {
  const source = value as ConfiguredSource;
  return !!source && typeof source.id === 'string' && typeof source.url === 'string';
}

/** A first name for a source: the index's file name, which is what Aurora shows too. */
function nameFromUrl(url: string): string {
  const last = url.split(/[?#]/)[0]!.split('/').filter(Boolean).pop() ?? url;
  return last.replace(/\.(index|incuset|json|xml)$/i, '') || url;
}
