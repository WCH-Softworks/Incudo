/**
 * Content sources.
 *
 * One interface, several implementations, composed rather than chosen once. The
 * user-facing setting is per source — *stream* or *download* — and live mode still
 * writes through to the cache, so going offline degrades to "what you last saw"
 * rather than failing. See docs/adr/0004.
 */

import type { Element } from '@incudo/core';

export type SourceMode = 'stream' | 'download';

export interface FileRef {
  name: string;
  url: string;
  isIndex: boolean;
}

export interface ContentIndex {
  url: string;
  name: string;
  description?: string;
  author?: string;
  version?: string;
  files: FileRef[];
  /** Which nested indexes this one pulls in, resolved lazily. */
  format: 'aurora' | 'incudo';
}

export interface ElementFile {
  url: string;
  name?: string;
  version?: string;
  elements: Element[];
  diagnostics: SourceDiagnostic[];
}

export interface SourceDiagnostic {
  level: 'error' | 'warning';
  message: string;
  elementId?: string;
  fileUrl?: string;
}

export type UpdateStatus =
  | { state: 'current'; version?: string }
  | { state: 'outdated'; local?: string; remote?: string }
  | { state: 'unknown'; reason: string };

export interface ContentSource {
  readonly id: string;
  loadIndex(url: string): Promise<ContentIndex>;
  loadFile(ref: FileRef): Promise<ElementFile>;
  checkForUpdates(index: ContentIndex): Promise<UpdateStatus>;
}

/** Detect the content format from a URL. Aurora is the only one that exists today. */
export function detectFormat(url: string): 'aurora' | 'incudo' {
  return url.toLowerCase().endsWith('.incuc') || url.toLowerCase().endsWith('.json')
    ? 'incudo'
    : 'aurora';
}

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
