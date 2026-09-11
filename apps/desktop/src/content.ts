/**
 * Loading content sources, through the injected platform I/O — CODE-REUSE-POLICY rule 1.
 *
 * The app never calls `fetch` and never touches storage directly; it hands `DesktopFetcher` and
 * `DesktopStorage` to `@incudo/content` and reads back an `ElementIndex`. That indirection is
 * what lets the identical code run under Node in the CLI's tests, and it is the reason
 * `src/platform.ts` is the only file in this app allowed to know it is running in Tauri.
 */

import { ContentLibrary, HttpContentSource } from '@incudo/content';
import type { ElementIndex } from '@incudo/core';

import { DesktopFetcher, DesktopStorage } from './platform.ts';

/** The AuroraLegacy index, offered as a starting point because it is the corpus Incudo replaces. */
export const AURORA_LEGACY_INDEX =
  'https://raw.githubusercontent.com/AuroraLegacy/elements/master/core.index';

export interface LoadedContent {
  elements: ElementIndex;
  /** Element count, files loaded, and anything the sources complained about. */
  elementCount: number;
  fileCount: number;
  warnings: string[];
  errors: string[];
}

export interface LoadProgress {
  loaded: number;
  total: number;
  current: string;
}

/**
 * Load one index and everything it references.
 *
 * `resolveByName` is left off: that is how Aurora's *downloader* lays files out on disk, and a
 * URL index is the repository layout instead. Getting this backwards silently fails to resolve
 * every file, so the two are never guessed between — see docs/AURORA-FORMAT.md.
 */
export async function loadIndex(
  indexUrl: string,
  onProgress?: (progress: LoadProgress) => void,
): Promise<LoadedContent> {
  const library = new ContentLibrary();
  const source = new HttpContentSource({
    id: indexUrl,
    fetcher: new DesktopFetcher(),
    writeThrough: new DesktopStorage(),
  });

  const report = await library.loadSource(source, indexUrl, {
    onProgress: (loaded, total, current) => onProgress?.({ loaded, total, current }),
  });

  const warnings: string[] = [];
  const errors: string[] = [];
  for (const diagnostic of library.diagnostics) {
    (diagnostic.level === 'error' ? errors : warnings).push(diagnostic.message);
  }

  return {
    elements: library.elements,
    elementCount: report.elementsLoaded,
    fileCount: report.filesLoaded,
    warnings,
    errors,
  };
}
