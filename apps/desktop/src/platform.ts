/**
 * The desktop implementations of Fetcher and Storage.
 *
 * This is the ONLY file in the desktop app allowed to know it is running in Tauri.
 * Everything else receives these through injection. See docs/CODE-REUSE-POLICY.md, rule 1.
 *
 * Phase 1 replaces the browser fallbacks below with Tauri's http and fs plugins, which
 * matters because the browser `fetch` here is subject to CORS and raw.githubusercontent.com
 * will not always cooperate — that is one of the reasons the desktop is a Tauri shell and
 * not a web page.
 */

import type { Fetcher, FetchOptions, FetchResult, Storage } from '@heroforge/core';

export class DesktopFetcher implements Fetcher {
  async fetchText(url: string, opts?: FetchOptions): Promise<FetchResult> {
    const headers: Record<string, string> = {};
    if (opts?.etag) headers['If-None-Match'] = opts.etag;
    const response = await fetch(url, { headers, signal: opts?.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return { url, text: await response.text(), etag: response.headers.get('etag') ?? undefined };
  }
}

/** Placeholder until the Tauri fs plugin is wired up in Phase 1. */
export class DesktopStorage implements Storage {
  private readonly prefix = 'heroforge:';

  async read(key: string): Promise<string | null> {
    return localStorage.getItem(this.prefix + key);
  }
  async write(key: string, value: string): Promise<void> {
    localStorage.setItem(this.prefix + key, value);
  }
  async remove(key: string): Promise<void> {
    localStorage.removeItem(this.prefix + key);
  }
  async list(prefix: string): Promise<string[]> {
    const full = this.prefix + prefix;
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(full))
      .map((k) => k.slice(this.prefix.length));
  }
}
