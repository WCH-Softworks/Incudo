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

/**
 * The character library: a folder the user chose, as a port (ADR 0027).
 *
 * A library is not `Storage`. `Storage` is the app's own scratch space — a draft, a content
 * cache, a settings blob — keyed by strings the user never sees. A library is *their* folder,
 * full of *their* files, very possibly in git or in a sync folder, and the app is a guest in
 * it. The two have different rules, so they are different ports.
 *
 * The entry name is the identity, because ADR 0027 says the folder is the list: there is no
 * index file and no database, so `aelin.incu` is what a library entry *is*. That keeps both
 * implementations honest — a path join on desktop, a `getFileHandle(name)` in a browser — and
 * it is why nothing here returns an opaque id.
 *
 * Every method may reasonably fail: the folder moved, permission lapsed, a file vanished
 * between the scan and the read. Throw; the view-model reports (ADR 0005).
 */
export interface CharacterStore {
  /**
   * False where this platform has no filesystem the app may reach. A library backed by
   * localStorage would be a different product wearing this one's UI, so there is no fallback
   * — the app says why instead.
   */
  readonly available: boolean;
  /** Why, when `available` is false. Shown to the user verbatim, so write it for them. */
  readonly unavailableReason?: string;
  /** Where the library is, in words the user recognises, or null when none is chosen yet. */
  location(): Promise<string | null>;
  /** Ask the user to pick a folder. Null when they cancel. The choice is remembered. */
  choose(): Promise<string | null>;
  /** Everything in the folder that looks like a container. Never recursive past one level. */
  list(): Promise<LibraryEntryRef[]>;
  read(entry: LibraryEntryRef): Promise<Map<string, Uint8Array>>;
  write(entry: LibraryEntryRef, files: Map<string, Uint8Array>): Promise<void>;
  remove(entry: LibraryEntryRef): Promise<void>;
}

export interface LibraryEntryRef {
  /**
   * The entry's name inside the library folder: `aelin.incu` for the zip form, `borin` for
   * the unpacked one. Never a path, never absolute, and never the character's own name — a
   * character renamed to Vigaro still lives in `aelin.incu` (ADR 0027).
   */
  name: string;
  form: ContainerForm;
}

/**
 * Zip or unpacked folder — ADR 0012's "both representations, one layout".
 *
 * Here rather than in the CLI because the library has to preserve the form an entry already
 * has, so both shells need the word.
 */
export type ContainerForm = 'zip' | 'folder';

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
