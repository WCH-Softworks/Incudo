/**
 * The desktop implementations of the injected ports.
 *
 * This is the ONLY file in the desktop app allowed to know it is running in Tauri.
 * Everything else receives these through injection. See docs/CODE-REUSE-POLICY.md, rule 1 —
 * which is also why the folder picker and the directory scan are here rather than inside a
 * component that happens to need them.
 *
 * Seven ports, and two implementations of each where the two builds genuinely differ:
 *
 * | port             | Tauri window                    | `npm run desktop` in a browser     |
 * |------------------|---------------------------------|------------------------------------|
 * | `Fetcher`        | `fetch_content_text` (no CORS)  | `window.fetch` (CORS applies)      |
 * | `Storage`        | IndexedDB                       | IndexedDB                          |
 * | `CharacterStore` | `dialog` + `fs` plugins         | File System Access API             |
 * | `FilePicker`     | `dialog` + `fs` plugins         | `showOpenFilePicker`               |
 * | `FileSaver`      | `dialog` + `fs` plugins         | `showSaveFilePicker`               |
 * | `ZipCodec`       | `CompressionStream`             | `CompressionStream`                |
 * | `CommandHost`    | a native menu (mouse only)      | none                               |
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
 *
 * `FilePicker` is neither. It is one file, outside both, read once and forgotten — the
 * Aurora import, and adding a game system. `FileSaver` is its write half: one file, wherever the
 * user says, written once and forgotten — "Save a copy…" (ADR 0038).
 */

import type {
  CharacterStore,
  ContainerForm,
  Fetcher,
  FetchOptions,
  FetchResult,
  FilePickOptions,
  FilePicker,
  FileSaveOptions,
  FileSaver,
  LibraryEntryRef,
  PickedFile,
  SavedFile,
  Storage,
  ZipCodec,
  ZipCompressor,
} from '@incudo/core';
import { createZipCodec } from '@incudo/core';
import { menuModel } from '@incudo/ui';
import type { CommandHost, CommandId, InstalledMenu, Os, ResolvedCommand } from '@incudo/ui';
import type { MenuItem as TauriMenuItem, Submenu as TauriSubmenu } from '@tauri-apps/api/menu';

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
 * Under Tauri this goes through the shell's own `fetch_content_text` command, which is not subject
 * to CORS — the original reason the desktop app is a Tauri shell and not a web page. It was
 * `tauri-plugin-http` until ADR 0050: the plugin opened a new connection for every request, and 800
 * of them stalled against a host that throttles new connections. In a browser it is `window.fetch`,
 * where CORS very much applies: `raw.githubusercontent.com` cooperates and plenty of hosts do not.
 */
export class DesktopFetcher implements Fetcher {
  /**
   * Conditional requests only under Tauri (ADR 0050). In a browser, `If-None-Match` makes a cross-origin
   * request need a preflight, and raw.githubusercontent.com answers that preflight with a 403, so every fetch
   * carrying one would fail; nor may a page read the `ETag` of a response the host did not expose.
   */
  readonly conditional = inTauri();

  async fetchText(url: string, opts?: FetchOptions): Promise<FetchResult> {
    if (this.conditional) {
      // The shell's own command, over one shared client (ADR 0050): `src-tauri/src/lib.rs`.
      const { invoke } = await import('@tauri-apps/api/core');
      const reply = await invoke<{ status: number; text: string; etag: string | null }>('fetch_content_text', {
        url,
        etag: opts?.etag ?? null,
      });
      if (reply.status === 304) return { url, text: '', notModified: true };
      if (reply.status < 200 || reply.status > 299) throw new Error(`HTTP ${reply.status} for ${url}`);
      return { url, text: reply.text, etag: reply.etag ?? undefined };
    }

    const response = await globalThis.fetch(url, { signal: opts?.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return { url, text: await response.text() };
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
      // No `CompressionStream` in this runtime, and a .incu is a zip.
      'This browser cannot read or write .incu files. Use the desktop app, or a current browser.',
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
    // put beside their character survives. Same rule as `writeFolder` in `tools/verify/src/node-save.ts`.
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
    let picked: FileSystemDirectoryHandle;
    try {
      // Non-null because `createDesktopPlatform` only builds this store where it exists.
      picked = await window.showDirectoryPicker!({
        id: 'incudo-library',
        mode: 'readwrite',
        startIn: await this.remembered(),
      });
    } catch (error) {
      // Cancelling throws `AbortError` here and returns null under Tauri — the same split
      // `BrowserFilePicker.pick` already handles. One port, one meaning: cancelling is an
      // answer, so both come back as "no folder chosen". Without this the rejection escaped
      // `CharacterLibrary.chooseLocation`, which is written expecting a null, and every
      // cancel logged an unhandled rejection — taking any *real* picker failure with it,
      // so the user saw nothing at all when one happened.
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw error;
    }
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
    'Use the desktop app, or a Chromium-based browser.';
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

// --- picking a file from outside the library -------------------------------

/**
 * The file picker, which exists for exactly one thing: importing an Aurora `.dnd5e`.
 *
 * A separate port from `CharacterStore` (see `FilePicker` in `packages/core/src/platform.ts`)
 * and, in the Tauri build, a happier one than expected. `dialog.open` already widens the fs
 * scope to each *file* it returns — `tauri-plugin-dialog`'s open command calls `allow_file`
 * on the fs scope for every path it hands back — so an import needs no new Rust at all.
 * `allow_library_folder` is still there because the *folder* case genuinely needs it: the
 * dialog grants a picked directory non-recursively, an unpacked container has an `assets/`
 * subfolder, and a remembered folder has to be re-granted on the next launch because the
 * scope is not persisted. A file picked now and read now has neither problem.
 */
class TauriFilePicker implements FilePicker {
  readonly available = true;

  async pick(options: FilePickOptions = {}): Promise<PickedFile[]> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    // Cast because the plugin's return type keys off a *literal* `multiple`, and this one is
    // a variable: as `boolean` it resolves to the single-file branch and would be a lie.
    const picked = (await open({
      directory: false,
      multiple: options.multiple ?? false,
      title: options.title,
      filters: options.extensions?.length
        ? [{ name: options.label ?? 'Supported files', extensions: options.extensions }]
        : undefined,
    })) as string | string[] | null;

    if (picked === null) return [];
    const paths = Array.isArray(picked) ? picked : [picked];

    const fs = await import('@tauri-apps/plugin-fs');
    const files: PickedFile[] = [];
    for (const path of paths) {
      files.push({ name: baseNameOf(path), bytes: await fs.readFile(path) });
    }
    return files;
  }
}

/**
 * The same in a browser, through `showOpenFilePicker`.
 *
 * An `<input type="file">` would work in every browser and this deliberately does not use
 * one: where `showOpenFilePicker` is missing so is the rest of the File System Access API,
 * so there is no library for an import to land in, and a picker that can only ever end in
 * "no library folder has been chosen" is worse than saying so up front.
 */
class BrowserFilePicker implements FilePicker {
  readonly available = true;

  async pick(options: FilePickOptions = {}): Promise<PickedFile[]> {
    let handles: FileSystemFileHandle[];
    try {
      // Non-null because `createDesktopPlatform` only builds this where it exists.
      handles = await window.showOpenFilePicker!({
        id: 'incudo-import',
        multiple: options.multiple ?? false,
        ...(options.extensions?.length
          ? {
              types: [
                {
                  description: options.label ?? 'Supported files',
                  // A media type is required and no registry has one for `.dnd5e`. The
                  // extension is what actually filters; this is the key it hangs on.
                  accept: { 'application/octet-stream': options.extensions.map((e) => `.${e}`) },
                },
              ],
            }
          : {}),
      });
    } catch (error) {
      // Cancelling throws `AbortError` here and returns null under Tauri. One port, one
      // meaning: cancelling is an answer, so both come back as an empty list.
      if (error instanceof DOMException && error.name === 'AbortError') return [];
      throw error;
    }

    const files: PickedFile[] = [];
    for (const handle of handles) {
      const file = await handle.getFile();
      files.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
    return files;
  }
}

/** No picker here, and it says why — the same posture as `UnavailableCharacterStore`. */
class UnavailableFilePicker implements FilePicker {
  readonly available = false;
  readonly unavailableReason =
    'This browser cannot open a file from your computer, so there is nothing to import from. ' +
    'Use the desktop app, or a Chromium-based browser.';
  async pick(): Promise<PickedFile[]> {
    throw new Error(this.unavailableReason);
  }
}

// --- writing a file somewhere the user chooses -----------------------------------------------

/**
 * The save dialog, for "Save a copy…" and nothing else so far (ADR 0038).
 *
 * Needs one permission and no Rust. `tauri-plugin-dialog`'s `save` command calls `allow_file` on
 * the fs scope for the path it returns, exactly as `open` does for the import, so the file the
 * user just named is writable and no other path is (read from the plugin's source under
 * `~/.cargo/registry`, then checked by saving through the real dialog). `fs.writeFile` creates
 * the file and truncates one that exists, and the dialog has already asked about replacing it.
 *
 * `null` from `save` is a cancel, which is the port's answer for one.
 */
class TauriFileSaver implements FileSaver {
  readonly available = true;

  async save(bytes: Uint8Array, options: FileSaveOptions): Promise<SavedFile | null> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      title: options.title,
      defaultPath: options.suggestedName,
      filters: options.extensions?.length
        ? [{ name: options.label ?? 'Supported files', extensions: options.extensions }]
        : undefined,
    });
    if (path === null) return null;
    const fs = await import('@tauri-apps/plugin-fs');
    await fs.writeFile(path, bytes);
    return { name: baseNameOf(path) };
  }
}

/**
 * The same in a browser, through `showSaveFilePicker`.
 *
 * The browser writes to a swap file and only replaces the destination when the stream closes, so
 * a write that fails half way leaves an existing file as it was. Cancelling throws `AbortError`
 * here and returns null under Tauri; one port, one meaning, so it comes back as null.
 */
class BrowserFileSaver implements FileSaver {
  readonly available = true;

  async save(bytes: Uint8Array, options: FileSaveOptions): Promise<SavedFile | null> {
    let handle: FileSystemFileHandle;
    try {
      // Non-null because `createDesktopPlatform` only builds this where it exists.
      handle = await window.showSaveFilePicker!({
        // Its own id, so the dialog remembers where copies go apart from where imports come from.
        id: 'incudo-copy',
        suggestedName: options.suggestedName,
        ...(options.extensions?.length
          ? {
              types: [
                {
                  description: options.label ?? 'Supported files',
                  // A media type is required and none is registered for `.incu`. The extension
                  // is what filters; this is the key it hangs on.
                  accept: { 'application/octet-stream': options.extensions.map((e) => `.${e}`) },
                },
              ],
            }
          : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw error;
    }
    const writable = await handle.createWritable();
    try {
      await writable.write(bytes as BufferSource);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
    return { name: handle.name };
  }
}

/** No save dialog here, and it says why — the same posture as `UnavailableFilePicker`. */
class UnavailableFileSaver implements FileSaver {
  readonly available = false;
  readonly unavailableReason =
    'This browser cannot save a file to your computer, so a copy cannot be made. ' +
    'Use the desktop app, or a Chromium-based browser.';
  async save(): Promise<SavedFile | null> {
    throw new Error(this.unavailableReason);
  }
}

/** The last segment of a path, whichever separator the platform used. */
function baseNameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut < 0 ? path : path.slice(cut + 1);
}

// --- the menu --------------------------------------------------------------------------------

/**
 * Which keyboard this is, for the one thing that differs: whether the primary modifier is Cmd.
 *
 * `userAgentData` is the modern answer and Chromium-only; `platform` is deprecated and
 * everywhere. Both are consulted because a WebKit webview on macOS has only the second.
 */
function detectOs(): Os {
  if (typeof navigator === 'undefined') return 'other';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const name = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac/i.test(name) ? 'mac' : 'other';
}

/**
 * The native menu, built from `packages/ui`'s list — every label, shortcut text and separator
 * comes from `menuModel()`, and this class only turns each entry into a widget.
 *
 * It is built from JavaScript on purpose. The alternative was a menu written in Rust, which
 * would be a second copy of the list that has to be kept in step by hand, and would put the
 * project's second piece of application-shaped Rust into a file ADR 0001 wants to stay small.
 *
 * **This menu is for the mouse, and registers no accelerator.** The first version did, expecting
 * the menu to own the keys, and on Windows it was found by pressing them that WebView2 hands
 * the page the keystroke and the host's accelerator table never runs the item: Ctrl+2 reached
 * the page, matched nothing there, and did nothing. So the page listens for the keyboard in
 * every build (`use-commands.ts`), and the shortcut appears here only as text after a tab, which
 * a Windows menu right-aligns as it would an accelerator. See ADR 0037. If installing fails the
 * caller gets `null`, and a broken menu costs the menu and not the shortcuts.
 */
class TauriCommandHost implements CommandHost {
  readonly os: Os = detectOs();

  async install(run: (id: CommandId) => void): Promise<InstalledMenu | null> {
    try {
      const { Menu, MenuItem, PredefinedMenuItem, Submenu } = await import('@tauri-apps/api/menu');
      const items = new Map<CommandId, TauriMenuItem>();

      const submenus: TauriSubmenu[] = [];
      for (const menu of menuModel(this.os)) {
        const entries = [];
        for (const entry of menu.entries) {
          if (entry.kind === 'separator') {
            entries.push(await PredefinedMenuItem.new({ item: 'Separator' }));
            continue;
          }
          const item = await MenuItem.new({
            id: entry.id,
            text: entry.shortcut ? `${entry.label}\t${entry.shortcut}` : entry.label,
            // Enabled flags arrive with the first `sync`, straight after install. Until then
            // nothing is available, which is also the truth on the launcher.
            enabled: false,
            action: () => run(entry.id),
          });
          items.set(entry.id, item);
          entries.push(item);
        }
        submenus.push(await Submenu.new({ text: menu.label, items: entries }));
      }

      // macOS has one menu bar for the whole app and no default to fall back on once this
      // replaces Tauri's: without an application menu there is no Quit, and without an Edit
      // menu Cmd+C, Cmd+V and Cmd+A stop working in every text field. Windows and Linux must
      // NOT get an Edit menu: muda draws the items there but implements none of them, so they
      // would be entries that do nothing.
      // (Unverified: written against muda's macOS behaviour, and no Mac was available.)
      const macOnly: TauriSubmenu[] = [];
      if (this.os === 'mac') {
        macOnly.push(
          await Submenu.new({
            text: 'Incudo',
            items: [
              await PredefinedMenuItem.new({ item: 'Hide' }),
              await PredefinedMenuItem.new({ item: 'HideOthers' }),
              await PredefinedMenuItem.new({ item: 'ShowAll' }),
              await PredefinedMenuItem.new({ item: 'Separator' }),
              await PredefinedMenuItem.new({ item: 'Quit' }),
            ],
          }),
          await Submenu.new({
            text: 'Edit',
            items: [
              await PredefinedMenuItem.new({ item: 'Undo' }),
              await PredefinedMenuItem.new({ item: 'Redo' }),
              await PredefinedMenuItem.new({ item: 'Separator' }),
              await PredefinedMenuItem.new({ item: 'Cut' }),
              await PredefinedMenuItem.new({ item: 'Copy' }),
              await PredefinedMenuItem.new({ item: 'Paste' }),
              await PredefinedMenuItem.new({ item: 'SelectAll' }),
            ],
          }),
        );
      }
      const [file, ...rest] = submenus;
      const menu = await Menu.new({
        items: this.os === 'mac' ? [macOnly[0]!, file!, macOnly[1]!, ...rest] : submenus,
      });
      await menu.setAsAppMenu();

      // What was last sent, so a sync that changes one flag makes one call across the bridge.
      const sent = new Map<CommandId, boolean>();
      return {
        sync(resolved: readonly ResolvedCommand[]): void {
          for (const command of resolved) {
            if (sent.get(command.id) === command.enabled) continue;
            sent.set(command.id, command.enabled);
            void items.get(command.id)?.setEnabled(command.enabled);
          }
        },
      };
    } catch (error) {
      console.error('The native menu could not be installed. Keyboard shortcuts are unaffected.', error);
      return null;
    }
  }
}

/** A browser tab has no menu of its own to fill, and the page handles the keyboard. */
class BrowserCommandHost implements CommandHost {
  readonly os: Os = detectOs();

  async install(): Promise<InstalledMenu | null> {
    return null;
  }
}

export interface DesktopPlatform {
  fetcher: Fetcher;
  storage: Storage;
  characters: CharacterStore;
  /** Reading one file from outside the library — the Aurora import, and nothing else yet. */
  files: FilePicker;
  /** Writing one file somewhere the user chooses — "Save a copy…". */
  saver: FileSaver;
  zip: ZipCodec;
  /** The menu, where there is one. See `CommandHost`. */
  commands: CommandHost;
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
  const files = tauri
    ? new TauriFilePicker()
    : typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'
      ? new BrowserFilePicker()
      : new UnavailableFilePicker();
  const saver = tauri
    ? new TauriFileSaver()
    : typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
      ? new BrowserFileSaver()
      : new UnavailableFileSaver();

  return {
    fetcher: new DesktopFetcher(),
    storage,
    characters,
    files,
    saver,
    zip,
    commands: tauri ? new TauriCommandHost() : new BrowserCommandHost(),
    shell: tauri ? 'tauri' : 'browser',
  };
}

export type { ContainerForm };
