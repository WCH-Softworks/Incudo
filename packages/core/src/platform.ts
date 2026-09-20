/**
 * The few things core and content need from the outside world.
 * Every shell (Tauri, Expo, tests) provides its own implementation and injects it.
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
 * every platform brings its own: `node:zlib` in tests and in Tauri's sidecar,
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
 * Here rather than in a shell because the library has to preserve the form an entry already
 * has, so both shells need the word.
 */
export type ContainerForm = 'zip' | 'folder';

/**
 * One file the user pointed at, from anywhere on their machine (ADR 0027's library is the
 * only folder the app otherwise reaches).
 *
 * A separate port from `CharacterStore` rather than a method on it, and the reason is a
 * lifetime rather than tidiness. A `CharacterStore` is *one folder*, chosen once, remembered
 * between launches, read and written repeatedly, and addressed by entry name — every method
 * on it takes a `LibraryEntryRef` and means "inside there". Importing is the opposite shape:
 * a file outside that folder, read once, in full, and then forgotten. Folding it in would
 * give the library port a method with none of its invariants, which every implementation
 * would then have to hold two contracts for.
 *
 * It hands back **bytes, not a handle**, because that is the whole of what an import needs
 * and it is what keeps the grant momentary: nothing retains a path, and nothing can come
 * back to the file later.
 */
export interface PickedFile {
  /** The file's own name with its extension — `Aelin.dnd5e`. Never a path, never absolute. */
  name: string;
  bytes: Uint8Array;
}

export interface FilePickOptions {
  /** Dialog title, where the platform shows one. */
  title?: string;
  /** Extensions without the dot: `['dnd5e']`. Absent or empty offers every file. */
  extensions?: string[];
  /** What to call that set in the picker's filter — "Aurora character". */
  label?: string;
  multiple?: boolean;
}

export interface FilePicker {
  /** False where this platform cannot show the user a file picker at all. */
  readonly available: boolean;
  /** Why, when `available` is false. Shown verbatim, so write it for the user. */
  readonly unavailableReason?: string;
  /** Empty when the user cancels — which is an answer, not a failure. Throws when a read does. */
  pick(options?: FilePickOptions): Promise<PickedFile[]>;
}

/** What the user chose to write to. */
export interface SavedFile {
  /**
   * The name the file was written under, with its extension — what the user typed, which may
   * differ from the name offered. Never a path, never absolute, like {@link PickedFile}.
   *
   * A platform that cannot say where a share went (a share sheet reports the app the user picked
   * and rarely the name) returns the name it offered instead.
   */
  name: string;
}

export interface FileSaveOptions {
  /** The name to offer, with its extension: `nyx.incu`. */
  suggestedName: string;
  /** Dialog title, where the platform shows one. */
  title?: string;
  /** Extensions without the dot: `['incu']`. Absent or empty offers every file. */
  extensions?: string[];
  /** What to call that set in the dialog's filter — "Incudo character". */
  label?: string;
}

/**
 * One file the user chose a place for: the write half of {@link FilePicker} (ADR 0038).
 *
 * A sibling port rather than a method on `FilePicker` or on `CharacterStore`. `FilePicker` reads
 * and forgets; this hands bytes to the user and forgets, and an implementation that can do one
 * (a phone can share a file and cannot pick one from a path) is not obliged to do the other.
 * `CharacterStore` is out for the reason `FilePicker` gave: every method there means "inside the
 * folder the user chose", and this is the one write that deliberately goes somewhere else.
 *
 * It takes **bytes, not a character**. What is inside a `.incu` is the packing function's
 * business and a platform needs no opinion on it. It is also what a share sheet wants: a file to
 * offer, and no path to promise.
 *
 * Choosing where to write is part of the call and cannot be separated from it, on purpose. A
 * `pickDestination()` that returned a handle would leave a grant open between two calls; here the
 * destination exists only while the bytes are going into it.
 *
 * **Replacing a file is the platform's own dialog's question.** Every implementation goes through
 * a save dialog or a share sheet that already asks, and none may write to a path it built itself.
 */
export interface FileSaver {
  /** False where this platform cannot show the user a save dialog at all. */
  readonly available: boolean;
  /** Why, when `available` is false. Shown verbatim, so write it for the user. */
  readonly unavailableReason?: string;
  /**
   * Ask where, and write `bytes` there. **Null when the user cancels — which is an answer, not a
   * failure**, and nothing has been written. It is the same answer `FilePicker.pick` gives as an
   * empty list and `CharacterStore.choose` gives as null, and an implementation whose platform
   * reports a cancel by throwing (a browser's `AbortError`) turns it into this. Throws when the
   * write itself fails.
   */
  save(bytes: Uint8Array, options: FileSaveOptions): Promise<SavedFile | null>;
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
