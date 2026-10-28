/**
 * Content sources: what the library is handed, and the converter that makes it.
 *
 * A source reaches the library as Incudo content (ADR 0119): a source at an address in another format is converted once,
 * when it is added, refreshed or the converter changes, and the conversion is kept as a file. This package converts
 * nothing itself and imports no converter: the app hands it one ({@link SourceConverter}), the way it hands it a
 * `Fetcher` and a `Storage`. Aurora's is `@incudo/aurora-import`'s `auroraConverter`.
 */

import type { ContentBundle, Fetcher } from '@incudo/core';

/** Read by nothing since ADR 0100, and kept because profiles carry it. */
export type SourceMode = 'stream' | 'download';

/** What a conversion did, for a refresh's report. */
export interface ConversionReport {
  /** Files and indexes that came over the network. */
  fetched: number;
  /** Ones a conditional request said were current. */
  unchanged: number;
  /** Ones that could not be fetched and were kept from the previous conversion, with why. */
  kept: Array<{ url: string; reason: string }>;
}

/** Turns a source in another format into Incudo content. */
export interface SourceConverter {
  /** What a conversion it wrote says it was converted from (`ContentSourceInfo.converted.from`). */
  readonly format: string;
  /** Its version: a conversion another version wrote is converted again, where the source can be read again. */
  readonly version: number;
  /** Convert a source at an address: its top index and everything it reaches. Throws when the top cannot be read. */
  convertSource(options: {
    fetcher: Fetcher;
    url: string;
    sourceId: string;
    resolveByName?: boolean;
    previous?: ContentBundle;
    onProgress?: (done: number, total: number, current: string) => void;
    at?: string;
  }): Promise<{ bundle: ContentBundle; report: ConversionReport }>;
  /** Convert one file a user added. Throws, with a sentence, when it holds nothing to add. */
  convertFile(text: string, options: { url: string; name: string; at?: string }): ContentBundle;
  /** The version the source at an address declares now, for an update check that cannot ask file by file. */
  latestVersion(fetcher: Fetcher, url: string, options?: { resolveByName?: boolean }): Promise<string | undefined>;
}

/**
 * What an update check found. `basis` says how it was found — ADR 0050: `files` asked every file the conversion fetched
 * whether it changed, and then `checked`, `changed` and `unanswered` count them; `version` compared the top index's
 * version, which is all a check can do without ETags and which a source may never bump.
 */
export type UpdateStatus =
  | { state: 'current'; version?: string; basis?: UpdateBasis; checked?: number; unanswered?: number }
  | {
      state: 'outdated';
      local?: string;
      remote?: string;
      basis?: UpdateBasis;
      checked?: number;
      changed?: number;
      unanswered?: number;
    }
  | { state: 'unknown'; reason: string };

export type UpdateBasis = 'files' | 'version';

/**
 * Compare two dotted version strings ("0.2.8"). Returns -1, 0 or 1.
 * Missing or unparseable versions sort as lowest, so an unknown local version reads
 * as outdated rather than as current.
 */
export function compareVersions(a: string | undefined, b: string | undefined): number {
  const pa = (a ?? '').split('.').map((n) => Number(n) || 0);
  const pb = (b ?? '').split('.').map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}
