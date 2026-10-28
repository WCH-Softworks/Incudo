/**
 * Loading the user's enabled content sources, through the injected platform I/O — the desktop's and the phone's.
 *
 * Moved here from `apps/desktop` when the phone came to build characters (ROADMAP Phase 6): both shells load the same
 * way, and nothing in it was ever the desktop's. The app never calls `fetch` and never touches storage directly; it hands the platform's
 * `Fetcher` and `Storage` to `@incudo/content` and reads back an `ElementIndex`
 * (CODE-REUSE-POLICY rule 1). That indirection is what lets the identical code run under Node
 * in `tools/verify`'s tests.
 *
 * What changed with ADR 0119: a source reaches the library as Incudo content, the file it is kept as, converted once
 * and loaded from that afterwards (`sourceContent`).
 *
 * And what is *not* here: nothing in this file is needed to open a character. A save embeds
 * its own content (ADR 0012), so the library screen loads with none of this having run.
 */

import type { ElementIndex } from '@incudo/core';

import { sourceContent, type ComposeOptions } from './compose.ts';
import { readDeclared, switchedOffSupply, writeDeclared, type DeclaredRecord, type SwitchedOffSupply } from './declared.ts';
import { ContentLibrary, type MissingContent, type SourceOverlap } from './library.ts';
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
   * Which switched-off sources declared some of `missing` when they were last loaded, in the profile's order, each with
   * what it declares (ADR 0090). Absent when none does, or when nothing is missing. Said, never acted on.
   */
  switchedOff?: SwitchedOffSupply[];
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

export interface LoadSourcesOptions {
  /**
   * The sources the user configured for this system and switched off, in the profile's order. Not loaded: their records
   * from their last loads are read, only when an enabled source is missing something, to say which of them declares it
   * (ADR 0090). Left out, nothing is read and no line names one.
   */
  switchedOff?: readonly ConfiguredSource[];
}

export interface LoadProgress {
  loaded: number;
  total: number;
  current: string;
  /** Which source is being loaded, when more than one is enabled. */
  source: string;
}

/**
 * Load every enabled source into one index, converting any that has not been converted yet.
 */
export async function loadSources(
  sources: readonly ConfiguredSource[],
  platform: ComposeOptions,
  onProgress?: (progress: LoadProgress) => void,
  options: LoadSourcesOptions = {},
): Promise<LoadedContent> {
  const library = new ContentLibrary();
  const loaded: LoadedSource[] = [];

  // One library across all of them, so an <append> in a supplement can still reach an element
  // in the core book — which is the whole point of the construct.
  for (const source of sources) {
    try {
      // The source's file, converted first when it has none yet (ADR 0119): the one time a load reads the network.
      const bundle = await sourceContent(source, platform, (count, total, current) =>
        onProgress?.({ loaded: count, total, current, source: source.name }),
      );
      // The parts the user switched off are left out wherever they are named (ADR 0055).
      const report = library.loadBundle(source.id, bundle, { excluded: source.excluded });
      loaded.push({
        id: source.id,
        name: report.info.name || source.name,
        fileCount: report.filesLoaded,
        elementCount: report.elementsLoaded,
        version: report.info.version,
      });
      // What it declared, kept for when it is switched off (ADR 0090). Written only when it changed.
      await writeDeclared(platform.storage, source, report.declared);
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

  // Which switched-off source has what is missing, from what each declared when it was last loaded (ADR 0090). Read
  // only when something is missing: AuroraLegacy's record is about 0.7 MB.
  const withMissing = loaded.filter((source) => source.missing);
  if (withMissing.length && options.switchedOff?.length) {
    const records: { sourceId: string; record: DeclaredRecord }[] = [];
    for (const source of options.switchedOff) {
      if (source.enabled) continue;
      const record = await readDeclared(platform.storage, source);
      if (record) records.push({ sourceId: source.id, record });
    }
    for (const source of withMissing) {
      const supply = switchedOffSupply(source.missing!, records);
      if (supply.length) source.switchedOff = supply;
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
