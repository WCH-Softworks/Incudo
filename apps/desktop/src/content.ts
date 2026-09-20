/**
 * Loading the user's enabled content sources, through the injected platform I/O.
 *
 * The app never calls `fetch` and never touches storage directly; it hands the platform's
 * `Fetcher` and `Storage` to `@incudo/content` and reads back an `ElementIndex`
 * (CODE-REUSE-POLICY rule 1). That indirection is what lets the identical code run under Node
 * in `tools/verify`'s tests.
 *
 * What changed here with ADR 0029: this used to build a bare `HttpContentSource` with
 * `writeThrough`, which wrote a cache **nothing ever read back** — so every reload re-fetched
 * all 238 files, about three quarters of a minute, every time. `composeSource` puts the cache
 * in front of the network, which is what ADR 0004 designed in the first place.
 *
 * And what is *not* here: nothing in this file is needed to open a character. A save embeds
 * its own content (ADR 0012), so the library screen loads with none of this having run.
 */

import {
  ContentLibrary,
  composeSource,
  writeVersionStamp,
  type ConfiguredSource,
} from '@incudo/content';
import { MapElementIndex, type ElementIndex, type Fetcher, type Storage } from '@incudo/core';

/** The AuroraLegacy index, offered as a starting point because it is the corpus Incudo replaces. */
export const AURORA_LEGACY_INDEX =
  'https://raw.githubusercontent.com/AuroraLegacy/elements/master/core.index';

export interface LoadedSource {
  id: string;
  name: string;
  /** What this source contributed on its own, which is what the Sources pane reports. */
  fileCount: number;
  elementCount: number;
  version?: string;
  failed?: string;
}

export interface LoadedContent {
  elements: ElementIndex;
  elementCount: number;
  fileCount: number;
  sources: LoadedSource[];
  warnings: string[];
  errors: string[];
}

export interface LoadProgress {
  loaded: number;
  total: number;
  current: string;
  /** Which source is being loaded, when more than one is enabled. */
  source: string;
}

export const EMPTY_CONTENT: LoadedContent = {
  elements: new MapElementIndex(),
  elementCount: 0,
  fileCount: 0,
  sources: [],
  warnings: [],
  errors: [],
};

/**
 * Load every enabled source into one index.
 *
 * `resolveByName` is left off: that is how Aurora's *downloader* lays files out on disk, and a
 * URL index is the repository layout instead. Getting this backwards silently fails to resolve
 * every file, so the two are never guessed between — see docs/AURORA-FORMAT.md.
 */
export async function loadSources(
  sources: readonly ConfiguredSource[],
  platform: { fetcher: Fetcher; storage: Storage },
  onProgress?: (progress: LoadProgress) => void,
): Promise<LoadedContent> {
  const library = new ContentLibrary();
  const loaded: LoadedSource[] = [];

  // One library across all of them, so an <append> in a supplement can still reach an element
  // in the core book — which is the whole point of the construct.
  for (const source of sources) {
    try {
      const report = await library.loadSource(composeSource(source, platform), source.url, {
        onProgress: (count, total, current) =>
          onProgress?.({ loaded: count, total, current, source: source.name }),
      });
      loaded.push({
        id: source.id,
        name: report.index.name || source.name,
        fileCount: report.filesLoaded,
        elementCount: report.elementsLoaded,
        version: report.index.version,
      });
      // The stamp an update check compares against (ADR 0029). Written after a successful
      // load, because a version nothing was fetched under would be a claim about a cache that
      // does not exist.
      await writeVersionStamp(platform.storage, source.id, report.index.version);
    } catch (error) {
      loaded.push({
        id: source.id,
        name: source.name,
        fileCount: 0,
        elementCount: 0,
        failed: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const warnings: string[] = [];
  const errors: string[] = [];
  for (const diagnostic of library.diagnostics) {
    (diagnostic.level === 'error' ? errors : warnings).push(diagnostic.message);
  }
  for (const source of loaded) {
    if (source.failed) errors.push(`${source.name}: ${source.failed}`);
  }

  return {
    elements: library.elements,
    elementCount: library.size,
    fileCount: loaded.reduce((total, source) => total + source.fileCount, 0),
    sources: loaded,
    warnings,
    errors,
  };
}
