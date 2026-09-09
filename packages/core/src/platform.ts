/**
 * The few things core and content need from the outside world.
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

/**
 * Zip encoding for the `.incu` container (ADR 0012).
 *
 * A port rather than an implementation in `core` because DEFLATE needs a compressor, and
 * every platform brings its own: `node:zlib` on the CLI and in Tauri's sidecar,
 * `CompressionStream` in a browser, a native module on mobile. `core` owns the container
 * *tree* (see container.ts); this turns that tree into one file and back.
 *
 * Paths are container-relative and always use forward slashes — `assets/portrait.png`, never
 * a backslash and never absolute. An implementation that reads an archive from outside must
 * reject entries escaping the container root; a save is a file people email each other.
 */
export interface ZipCodec {
  zip(files: Map<string, Uint8Array>): Promise<Uint8Array>;
  unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>>;
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
