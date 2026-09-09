/**
 * Node implementations of the two injected interfaces. One file, as the policy requires.
 * The desktop and mobile shells each provide their own equivalent.
 */

import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Fetcher, FetchOptions, FetchResult, Storage } from '@heroforge/core';

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
