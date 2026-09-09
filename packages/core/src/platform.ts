/**
 * The only two things core and content need from the outside world.
 * Every shell (Tauri, Expo, CLI, tests) provides its own implementation and injects it.
 * See docs/CODE-REUSE-POLICY.md, rule 1.
 */

export interface FetchResult {
  url: string;
  text: string;
  /** Present when the transport exposes it; used for conditional requests. */
  etag?: string;
  /** True when the result came from a transport-level cache rather than the network. */
  fromCache?: boolean;
}

export interface FetchOptions {
  etag?: string;
  signal?: AbortSignal;
}

export interface Fetcher {
  fetchText(url: string, opts?: FetchOptions): Promise<FetchResult>;
}

export interface Storage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

/** An in-memory Storage. Useful for tests and for a "don't persist" mode. */
export class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async write(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
}
