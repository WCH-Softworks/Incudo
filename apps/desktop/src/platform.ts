/**
 * The desktop implementations of the injected ports.
 *
 * This is the ONLY file in the desktop app allowed to know it is running in Tauri.
 * Everything else receives these through injection. See docs/CODE-REUSE-POLICY.md, rule 1 —
 * which is also why the folder picker and the directory scan are here rather than inside a
 * component that happens to need them.
 *
 * Four ports, and two implementations of each where the two builds genuinely differ:
 *
 * | port             | Tauri window                    | `npm run desktop` in a browser     |
 * |------------------|---------------------------------|------------------------------------|
 * | `Fetcher`        | `tauri-plugin-http` (no CORS)   | `window.fetch` (CORS applies)      |
 * | `Storage`        | IndexedDB                       | IndexedDB                          |
 * | `CharacterStore` | `dialog` + `fs` plugins         | File System Access API             |
 * | `ZipCodec`       | `CompressionStream`             | `CompressionStream`                |
 *
 * `Storage` is IndexedDB in **both**, deliberately. It holds the content cache and the
 * current draft — things the app manages and the user never opens — so it wants a large,
 * boring key/value store rather than real files. It used to be `localStorage`, which caps out
 * around 5 MB and would silently fail to cache a 15 MB corpus. Writing the cache as real
 * files was the other option and it loses on Windows: a cache key is a source URL and a file
 * URL, both percent-encoded, which makes paths around 290 characters and MAX_PATH is 260.
 *
 * A *library* is the opposite case and is never in here: it is the user's own folder, full of
 * files they can see, copy and put in git (ADR 0027).
 */

import type {
  CharacterStore,
  ContainerForm,
  Fetcher,
  FetchOptions,
  FetchResult,
  LibraryEntryRef,
  Storage,
  ZipCodec,
  ZipCompressor,
} from '@incudo/core';
import { createZipCodec } from '@incudo/core';

/**
 * Tauri sets this on the window before any application code runs. It is the one question
 * this file is allowed to ask, and the answer never leaves it.
 */
function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// --- fetching --------------------------------------------------------------

/**
 * Content over HTTP.
 *
 * Under Tauri this goes through the http plugin, which is not subject to CORS — the original
 * reason the desktop app is a Tauri shell and not a web page, and a claim `README.md` has
 * been making since before anything implemented it. In a browser it is `window.fetch`, where
 * CORS very much applies: `raw.githubusercontent.com` cooperates and plenty of hosts do not.
 */
export class DesktopFetcher implements Fetcher {
  async fetchText(url: string, opts?: FetchOptions): Promise<FetchResult> {
    const headers: Record<string, string> = {};
    if (opts?.etag) headers['If-None-Match'] = opts.etag;

    const request = inTauri()
      ? (await import('@tauri-apps/plugin-http')).fetch
      : globalThis.fetch.bind(globalThis);

    const response = await request(url, { headers, signal: opts?.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return { url, text: await response.text(), etag: response.headers.get('etag') ?? undefined };
  }
}

// --- storage ---------------------------------------------------------------

const DB_NAME = 'incudo';
const DB_VERSION = 1;
const KV_STORE = 'kv';
const HANDLE_STORE = 'handles';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local database.'));
  });
}

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error ?? new Error('The local database refused.'));
  });
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await request(body(db.transaction(name, mode).objectStore(name)));
  } finally {
    db.close();
  }
}

/** The app's own key/value space. Never the user's files — see the file header. */
export class DesktopStorage implements Storage {
  async read(key: string): Promise<string | null> {
    const value = await withStore<unknown>(KV_STORE, 'readonly', (store) => store.get(key));
    return typeof value === 'string' ? value : null;
  }

  async write(key: string, value: string): Promise<void> {
    await withStore(KV_STORE, 'readwrite', (store) => store.put(value, key));
  }

  async remove(key: string): Promise<void> {
    await withStore(KV_STORE, 'readwrite', (store) => store.delete(key));
  }

  async list(prefix: string): Promise<string[]> {
    // `￿` sorts above every character a key can hold, so this is the whole prefix range.
    const range = prefix ? IDBKeyRange.bound(prefix, `${prefix}￿`) : undefined;
    const keys = await withStore<IDBValidKey[]>(KV_STORE, 'readonly', (store) =>
      store.getAllKeys(range),
    );
    return keys.map(String);
  }
}

// --- the zip codec ---------------------------------------------------------

/**
 * DEFLATE, from the web platform.
 *
 * `deflate-raw` is what zip carries — no zlib and no gzip wrapper — and every engine that has
 * `CompressionStream` at all has had that format since it shipped. Where it is missing the
 * codec says so rather than writing a container nothing can read.
 */
const browserCompressor: ZipCompressor = {
  async deflateRaw(data) {
    return through(data, new CompressionStream('deflate-raw'));
  },
  async inflateRaw(data) {
    return through(data, new DecompressionStream('deflate-raw'));
  },
};

async function through(data: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  // Through a Blob rather than a hand-built ReadableStream: it is three fewer moving parts,
  // and `Response.arrayBuffer` does the reassembly that would otherwise be a reader loop.
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(transform as ReadableWritablePair);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function createDesktopZipCodec(): ZipCodec {
  if (typeof CompressionStream === 'undefined') {
    throw new Error(
      'This runtime has no CompressionStream, so Incudo cannot read or write .incu files here.',
    );
  }
  return createZipCodec(browserCompressor);
}

// --- the character library -------------------------------------------------

const LIBRARY_LOCATION_KEY = 'library/location';
const LIBRARY_HANDLE_KEY = 'library';

/** A container is a `.incu` file, or a folder holding a `manifest.json` (ADR 0027). */
const CONTAINER_FILE = /\.incu$/i;

/**
 * The library as a real folder, through Tauri's dialog and fs plugins.
 *
 * The fs capability grants the *commands* and no paths at all; the scope is widened at
 * runtime, by the `allow_library_folder` command in `src-tauri/src/lib.rs`, to exactly the
 * folder the user picked. That is the difference between an app that can read the machine and
 * one that can read the folder its user chose.
 */
class TauriCharacterStore implements CharacterStore {
  readonly available = true;
  private readonly storage: Storage;
  private readonly zip: ZipCodec;
  private root: string | null = null;

  constructor(storage: Storage, zip: ZipCodec) {
    this.storage = storage;
    this.zip = zip;
  }

  async location(): Promise<string | null> {
    if (this.root) return this.root;
    const remembered = await this.storage.read(LIBRARY_LOCATION_KEY);
    if (!remembered) return null;
    // Re-granting on every launch is the price of a scope that starts empty. If the folder
    // has gone, say nothing yet — the scan will report it in words the user can act on.
    try {
      await this.grant(remembered);
      this.root = remembered;
    } catch {
      this.root = remembered;
    }
    return this.root;
  }

  async choose(): Promise<string | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: false, title: 'Where do you keep your characters?' });
    if (typeof picked !== 'string') return null;
    await this.grant(picked);
    this.root = picked;
    await this.storage.write(LIBRARY_LOCATION_KEY, picked);
    return picked;
  }

  async list(): Promise<LibraryEntryRef[]> {
    const fs = await import('@tauri-apps/plugin-fs');
    const root = await this.require();
    const entries: LibraryEntryRef[] = [];
    for (const entry of await fs.readDir(root)) {
      if (entry.isDirectory) {
        // One level, and a folder is only a character if it says so. That is what keeps
        // "an unpacked character" and "a folder of characters" apart (ADR 0027).
        if (await fs.exists(join(root, entry.name, 'manifest.json'))) {
          entries.push({ name: entry.name, form: 'folder' });
        }
      } else if (CONTAINER_FILE.test(entry.name)) {
        entries.push({ name: entry.name, form: 'zip' });
      }
    }
    return entries;
  }

  async read(entry: LibraryEntryRef): Promise<Map<string, Uint8Array>> {
    const fs = await import('@tauri-apps/plugin-fs');
    const root = await this.require();
    const path = join(root, entry.name);
    if (entry.form === 'zip') return this.zip.unzip(await fs.readFile(path));

    const files = new Map<string, Uint8Array>();
    for (const relative of await walk(fs, path)) {
      files.set(relative, await fs.readFile(join(path, ...relative.split('/'))));
    }
    return files;
  }

  async write(entry: LibraryEntryRef, files: Map<string, Uint8Array>): Promise<void> {
    const fs = await import('@tauri-apps/plugin-fs');
    const root = await this.require();
    const path = join(root, entry.name);

    if (entry.form === 'zip') {
      await fs.writeFile(path, await this.zip.zip(files));
      return;
    }

    await fs.mkdir(path, { recursive: true });
    for (const [relative, bytes] of files) {
      const segments = relative.split('/');
      if (segments.length > 1) {
        await fs.mkdir(join(path, ...segments.slice(0, -1)), { recursive: true });
      }
      await fs.writeFile(join(path, ...segments), bytes);
    }
    // Files the container no longer holds have to leave, or the next write picks a deleted
    // portrait back up. Only the names the format owns are considered, so a README somebody
    // put beside their character survives. Same rule as the CLI's `writeFolder`.
    for (const relative of await walk(fs, path)) {
      if (files.has(relative) || !ownedByTheFormat(relative)) continue;
      await fs.remove(join(path, ...relative.split('/')));
    }
  }

  async remove(entry: LibraryEntryRef): Promise<void> {
    const fs = await import('@tauri-apps/plugin-fs');
    const root = await this.require();
    await fs.remove(join(root, entry.name), { recursive: entry.form === 'folder' });
  }

  private async grant(path: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('allow_library_folder', { path });
  }

  private async require(): Promise<string> {
    const root = await this.location();
    if (!root) throw new Error('No library folder has been chosen yet.');
    return root;
  }
}

type TauriFs = typeof import('@tauri-apps/plugin-fs');

/** Container-relative, forward-slashed paths for everything under a folder-form entry. */
async function walk(fs: TauriFs, root: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readDir(prefix ? join(root, ...prefix.split('/')) : root)) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory) found.push(...(await walk(fs, root, relative)));
    else found.push(relative);
  }
  return found;
}

function join(...parts: string[]): string {
  return parts.join('/');
}

function ownedByTheFormat(relative: string): boolean {
  return (
    relative === 'manifest.json' ||
    relative === 'character.json' ||
    relative === 'content.json' ||
    relative.startsWith('assets/')
  );
}

/**
 * The library in a browser, through the File System Access API.
 *
 * `npm run desktop` is where every piece of UI work happens, so it cannot be the build where
 * the library does not exist — and a library backed by `localStorage` would be a different
 * product wearing this one's UI (ADR 0027). This is a real directory handle with real bytes.
 *
 * The one honest difference from the Tauri build: a browser grants access to a directory
 * handle per session unless the user has said "allow on every visit", so reopening the page
 * may need one click on **Choose folder** to reconnect. The handle itself is remembered in
 * IndexedDB, so the picker opens where it left off.
 */
class FileSystemAccessCharacterStore implements CharacterStore {
  readonly available = true;
  private readonly zip: ZipCodec;
  private handle: FileSystemDirectoryHandle | undefined;

  constructor(zip: ZipCodec) {
    this.zip = zip;
  }

  async location(): Promise<string | null> {
    const handle = await this.remembered();
    return handle ? handle.name : null;
  }

  async choose(): Promise<string | null> {
    // Non-null because `createDesktopPlatform` only builds this store where it exists.
    const picked = await window.showDirectoryPicker!({
      id: 'incudo-library',
      mode: 'readwrite',
      startIn: await this.remembered(),
    });
    this.handle = picked;
    await withStore(HANDLE_STORE, 'readwrite', (store) => store.put(picked, LIBRARY_HANDLE_KEY));
    return picked.name;
  }

  async list(): Promise<LibraryEntryRef[]> {
    const root = await this.require();
    const entries: LibraryEntryRef[] = [];
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === 'directory') {
        try {
          await handle.getFileHandle('manifest.json');
          entries.push({ name, form: 'folder' });
        } catch {
          // Not a character. Left exactly as it was found.
        }
      } else if (CONTAINER_FILE.test(name)) {
        entries.push({ name, form: 'zip' });
      }
    }
    return entries;
  }

  async read(entry: LibraryEntryRef): Promise<Map<string, Uint8Array>> {
    const root = await this.require();
    if (entry.form === 'zip') {
      const file = await (await root.getFileHandle(entry.name)).getFile();
      return this.zip.unzip(new Uint8Array(await file.arrayBuffer()));
    }
    const files = new Map<string, Uint8Array>();
    await readInto(await root.getDirectoryHandle(entry.name), '', files);
    return files;
  }

  async write(entry: LibraryEntryRef, files: Map<string, Uint8Array>): Promise<void> {
    const root = await this.require();
    if (entry.form === 'zip') {
      await writeFileInto(root, entry.name, await this.zip.zip(files));
      return;
    }

    const folder = await root.getDirectoryHandle(entry.name, { create: true });
    for (const [relative, bytes] of files) {
      const segments = relative.split('/');
      let directory = folder;
      for (const segment of segments.slice(0, -1)) {
        directory = await directory.getDirectoryHandle(segment, { create: true });
      }
      await writeFileInto(directory, segments[segments.length - 1]!, bytes);
    }

    const existing = new Map<string, Uint8Array>();
    await readInto(folder, '', existing, { namesOnly: true });
    for (const relative of existing.keys()) {
      if (files.has(relative) || !ownedByTheFormat(relative)) continue;
      const segments = relative.split('/');
      let directory = folder;
      for (const segment of segments.slice(0, -1)) {
        directory = await directory.getDirectoryHandle(segment);
      }
      await directory.removeEntry(segments[segments.length - 1]!);
    }
  }

  async remove(entry: LibraryEntryRef): Promise<void> {
    const root = await this.require();
    await root.removeEntry(entry.name, { recursive: entry.form === 'folder' });
  }

  private async remembered(): Promise<FileSystemDirectoryHandle | undefined> {
    if (this.handle) return this.handle;
    const stored = await withStore<unknown>(HANDLE_STORE, 'readonly', (store) =>
      store.get(LIBRARY_HANDLE_KEY),
    ).catch(() => undefined);
    if (stored && (stored as FileSystemDirectoryHandle).kind === 'directory') {
      this.handle = stored as FileSystemDirectoryHandle;
    }
    return this.handle;
  }

  /**
   * The handle, with permission actually in hand.
   *
   * `requestPermission` needs a user gesture, so at app start this can only *query*. When the
   * answer is no, the message says what to click rather than reporting an empty library —
   * an empty library and an unreachable one are very different things to be told.
   */
  private async require(): Promise<FileSystemDirectoryHandle> {
    const handle = await this.remembered();
    if (!handle) throw new Error('No library folder has been chosen yet.');
    // The two permission methods are a WICG extension, not part of any standard, and a handle
    // that does not carry them was not gated behind a prompt in the first place.
    if (typeof handle.queryPermission !== 'function') return handle;
    if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return handle;
    if ((await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted') return handle;
    throw new Error(
      `This browser has not granted access to "${handle.name}" in this session. Click "Choose folder" and pick it again to reconnect.`,
    );
  }
}

async function readInto(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  into: Map<string, Uint8Array>,
  options: { namesOnly?: boolean } = {},
): Promise<void> {
  for await (const [name, handle] of directory.entries()) {
    const relative = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      await readInto(handle, relative, into, options);
    } else if (options.namesOnly) {
      into.set(relative, new Uint8Array());
    } else {
      into.set(relative, new Uint8Array(await (await handle.getFile()).arrayBuffer()));
    }
  }
}

async function writeFileInto(
  directory: FileSystemDirectoryHandle,
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(bytes as BufferSource);
  await writable.close();
}

/**
 * No library here, and it says why.
 *
 * Firefox and Safari have no File System Access API. Rather than fake a library out of
 * browser storage, the app reports this sentence and offers nothing — see ADR 0027.
 */
class UnavailableCharacterStore implements CharacterStore {
  readonly available = false;
  readonly unavailableReason =
    'This browser cannot open a folder on your computer, so there is no character library here. ' +
    'Use the desktop build (npm run desktop:app), or a Chromium-based browser.';
  async location(): Promise<string | null> {
    return null;
  }
  async choose(): Promise<string | null> {
    return null;
  }
  async list(): Promise<LibraryEntryRef[]> {
    throw new Error(this.unavailableReason);
  }
  async read(): Promise<Map<string, Uint8Array>> {
    throw new Error(this.unavailableReason);
  }
  async write(): Promise<void> {
    throw new Error(this.unavailableReason);
  }
  async remove(): Promise<void> {
    throw new Error(this.unavailableReason);
  }
}

export interface DesktopPlatform {
  fetcher: Fetcher;
  storage: Storage;
  characters: CharacterStore;
  zip: ZipCodec;
  /** Which build this is, for the one line of UI that has to admit the difference. */
  shell: 'tauri' | 'browser';
}

/** Built once, at startup, and injected from there. Nothing else calls `inTauri`. */
export function createDesktopPlatform(): DesktopPlatform {
  const storage = new DesktopStorage();
  const zip = createDesktopZipCodec();
  const tauri = inTauri();
  const characters = tauri
    ? new TauriCharacterStore(storage, zip)
    : typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
      ? new FileSystemAccessCharacterStore(zip)
      : new UnavailableCharacterStore();

  return { fetcher: new DesktopFetcher(), storage, characters, zip, shell: tauri ? 'tauri' : 'browser' };
}

export type { ContainerForm };
