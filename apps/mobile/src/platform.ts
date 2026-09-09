/**
 * The mobile implementations of Fetcher and Storage.
 *
 * The ONLY file in the mobile app allowed to know it is running in Expo.
 * Storage is backed by expo-file-system rather than AsyncStorage because downloaded
 * content is measured in megabytes, not kilobytes — mobile defaults to download mode
 * (ADR 0004), so this path carries real weight.
 */

import type { Fetcher, FetchOptions, FetchResult, Storage } from '@heroforge/core';

export class MobileFetcher implements Fetcher {
  async fetchText(url: string, opts?: FetchOptions): Promise<FetchResult> {
    const headers: Record<string, string> = {};
    if (opts?.etag) headers['If-None-Match'] = opts.etag;
    const response = await fetch(url, { headers, signal: opts?.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return { url, text: await response.text(), etag: response.headers.get('etag') ?? undefined };
  }
}

/**
 * Phase 4 fills this in with expo-file-system:
 *   import * as FileSystem from 'expo-file-system';
 *   const root = FileSystem.documentDirectory + 'heroforge/';
 * Left unimplemented rather than stubbed with AsyncStorage, so nobody ships the wrong
 * storage backend by accident.
 */
export class MobileStorage implements Storage {
  async read(_key: string): Promise<string | null> {
    throw new Error('MobileStorage is not implemented yet — ROADMAP Phase 4.');
  }
  async write(_key: string, _value: string): Promise<void> {
    throw new Error('MobileStorage is not implemented yet — ROADMAP Phase 4.');
  }
  async remove(_key: string): Promise<void> {
    throw new Error('MobileStorage is not implemented yet — ROADMAP Phase 4.');
  }
  async list(_prefix: string): Promise<string[]> {
    throw new Error('MobileStorage is not implemented yet — ROADMAP Phase 4.');
  }
}
