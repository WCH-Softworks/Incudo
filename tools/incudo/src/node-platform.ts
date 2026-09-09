/**
 * Node implementations of the two injected interfaces. One file, as the policy requires.
 * The desktop and mobile shells each provide their own equivalent.
 */

import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Fetcher, FetchOptions, FetchResult, Storage } from '@incudo/core';

export class NodeFetcher implements Fetcher {
  async fetchText(url: string, opts?: FetchOptions): Promise<FetchResult> {
    // A plain path (or file: URL) reads from disk, so a local checkout of a content
    // repo can be validated with no network at all — which is how CI runs it.
    if (!/^https?:\/\//i.test(url)) {
      const path = url.startsWith('file://') ? new URL(url).pathname : url;
      return { url, text: await readFile(path, 'utf8') };
    }
    const headers: Record<string, string> = {};
    if (opts?.etag) headers['If-None-Match'] = opts.etag;
    const response = await fetch(url, { headers, signal: opts?.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return {
      url,
      text: await response.text(),
      etag: response.headers.get('etag') ?? undefined,
    };
  }
}

/**
 * Resolves remote content URLs against a local mirror of the same repository.
 *
 * Aurora indexes hard-code absolute raw.githubusercontent.com URLs, so pointing the
 * CLI at a local checkout still hits the network for every file. This maps each URL
 * back onto the mirror by taking the path after the git ref segment:
 *
 *   https://raw.githubusercontent.com/AuroraLegacy/elements/master/core/internal.xml
 *   -> <root>/core/internal.xml
 *
 * It is a heuristic, deliberately: if the mapped file is missing it falls through to
 * the network rather than failing, so a partial mirror still works. This is what makes
 * CI able to validate the whole corpus with no network at all.
 */
export class LocalMirrorFetcher implements Fetcher {
  private readonly root: string;
  private readonly fallback: Fetcher;

  constructor(root: string, fallback: Fetcher) {
    this.root = root;
    this.fallback = fallback;
  }

  async fetchText(url: string, opts?: FetchOptions): Promise<FetchResult> {
    const local = this.toLocalPath(url);
    if (local) {
      try {
        return { url, text: await readFile(local, 'utf8'), fromCache: true };
      } catch {
        // Fall through: a partial mirror is still useful.
      }
    }
    return this.fallback.fetchText(url, opts);
  }

  private toLocalPath(url: string): string | null {
    if (!/^https?:\/\//i.test(url)) return null;
    let path: string;
    try {
      path = new URL(url).pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
    // raw.githubusercontent.com/<owner>/<repo>/<ref>/<...>  -> drop the first three
    const segments = path.split('/');
    const rest = segments.length > 3 ? segments.slice(3) : segments;
    return join(this.root, ...rest);
  }
}

export class NodeStorage implements Storage {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private path(key: string): string {
    return join(this.root, key.replace(/[^A-Za-z0-9._/%-]/g, '_'));
  }

  async read(key: string): Promise<string | null> {
    try {
      return await readFile(this.path(key), 'utf8');
    } catch {
      return null;
    }
  }

  async write(key: string, value: string): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, value, 'utf8');
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async list(prefix: string): Promise<string[]> {
    try {
      const entries = await readdir(this.path(prefix), { recursive: true });
      return entries.map((e) => join(prefix, String(e)));
    } catch {
      return [];
    }
  }
}
