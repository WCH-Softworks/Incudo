/**
 * Loading the user's enabled content sources, through the injected platform I/O — the desktop's and the phone's.
 *
 * Moved here from `apps/desktop` when the phone came to build characters (ROADMAP Phase 6): both shells load the same
 * way, and nothing in it was ever the desktop's. The app never calls `fetch` and never touches storage directly; it hands the platform's
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

import type { ElementIndex, Fetcher, Storage } from '@incudo/core';

import { composeForLoad, writeVersionStamp, type ComposeOptions } from './compose.ts';
import { ContentLibrary, type MissingContent, type SourceOverlap } from './library.ts';
import { partsFilter } from './parts.ts';
import type { ConfiguredSource } from './profile.ts';

export interface LoadedSource {
  id: string;
  name: string;
  /** What this source contributed on its own, which is what the Sources pane reports. */
  fileCount: number;
  elementCount: number;
  version?: string;
  failed?: string;
  /**
   * What this source refers to that no enabled source declares (ADR 0052), absent when there is nothing. Worked out
   * once every enabled source has loaded, since what one refers to is often in the next.
   */
  missing?: MissingContent;
  /**
   * What this source defines that another enabled source also defines, and whose version is used (ADR 0054), absent
   * when there is nothing. Worked out once every enabled source has loaded, like `missing`.
   */
  overlaps?: SourceOverlap[];
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

/**
 * Load every enabled source into one index.
 *
 * `resolveByName` is left off: that is how Aurora's *downloader* lays files out on disk, and a
 * URL index is the repository layout instead. Getting this backwards silently fails to resolve
 * every file, so the two are never guessed between — see docs/AURORA-FORMAT.md.
 */
export async function loadSources(
  sources: readonly ConfiguredSource[],
  platform: ComposeOptions,
  onProgress?: (progress: LoadProgress) => void,
): Promise<LoadedContent> {
  const library = new ContentLibrary();
  const loaded: LoadedSource[] = [];

  // One library across all of them, so an <append> in a supplement can still reach an element
  // in the core book — which is the whole point of the construct.
  for (const source of sources) {
    try {
      const composed = composeForLoad(source, platform);
      const report = await library.loadSource(composed.source, source.url, {
        // The parts the user switched off are skipped wherever they are named (ADR 0055).
        include: partsFilter(source),
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
      // Converted once the load is in, from what it read (ADR 0085): the next load parses nothing.
      await composed.finish(report.index.version);
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

  // Reported, never acted on: a book enabled without the one it builds on is a choice (ADR 0052).
  const missing = library.missingContent();
  // The later source is used when two define the same id (ADR 0054): said on each line, never decided for the user.
  const overlaps = library.sourceOverlaps();
  for (const source of loaded) {
    const found = missing.get(source.id);
    if (found && !source.failed) source.missing = found;
    const shared = overlaps.get(source.id);
    if (shared && !source.failed) source.overlaps = shared;
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
