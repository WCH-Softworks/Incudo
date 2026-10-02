/**
 * The mobile implementations of the injected ports — ADR 0083.
 *
 * The ONLY file in the mobile app allowed to know it is running in Expo. Everything else receives these through
 * injection (docs/CODE-REUSE-POLICY.md, rule 1), exactly as the desktop's `platform.ts` hands out its own.
 *
 * | port             | phone                                                     |
 * |------------------|-----------------------------------------------------------|
 * | `Fetcher`        | React Native's `fetch` (no CORS, so conditional)          |
 * | `Storage`        | one SQLite table, through `expo-sqlite`                   |
 * | `CharacterStore` | a `library` folder in the app's own documents, `expo-file-system` |
 * | `FilePicker`     | the system's document picker, through `expo-file-system`  |
 * | `ZipCodec`       | fflate (`zip.ts`): Hermes has no `CompressionStream`      |
 *
 * Not here yet, and said so rather than stubbed: `FileSaver` (sharing a file out, ROADMAP Phase 6's import/export item),
 * `FileDrop`, `PdfWriter` and `CommandHost`, which a phone has no use for in a read-only sheet.
 *
 * **Why SQLite for `Storage`, measured** (`tools/verify`'s `mobile-runtime.test.ts`): a full AuroraLegacy download is
 * 800 values and 14.75 MB of text, the largest 585 KB, and twenty of its keys are longer than 255 bytes. A file per key
 * would need its key hashed into a name (and `list(prefix)` then reads every file's real key back); AsyncStorage on
 * Android is SQLite with a default cap of 6 MB. One table keyed on the string, scanned by range like the desktop's
 * IndexedDB, holds all of it with nothing invented.
 *
 * **Why the library is the app's own folder** (the maintainer's choice, ADR 0083): it is always there and needs no
 * permission. A file arrives through the picker and is copied in (`CharacterLibrary.add`); one leaves through an
 * export the user points at a place or a share, which is a later item. A folder the user picks (Android's Storage
 * Access Framework) is ADR 0027's library more literally, and is left for later rather than ruled out.
 */

import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';

import type {
  CharacterStore,
  Fetcher,
  FetchOptions,
  FetchResult,
  FilePickOptions,
  FilePicker,
  LibraryEntryRef,
  PickedFile,
  Storage,
  ZipCodec,
} from '@incudo/core';

/**
 * React Native's `fetch` is not a web page's: no origin, no CORS preflight, so `If-None-Match` may be sent and a 304
 * read (ADR 0050).
 */
export class MobileFetcher implements Fetcher {
  readonly conditional = true;

  async fetchText(url: string, opts?: FetchOptions): Promise<FetchResult> {
    const headers: Record<string, string> = {};
    if (opts?.etag) headers['If-None-Match'] = opts.etag;
    const response = await fetch(url, { headers, ...(opts?.signal ? { signal: opts.signal } : {}) });
    const etag = response.headers.get('etag') ?? undefined;
    if (response.status === 304 && opts?.etag) return { url, text: '', notModified: true, etag: opts.etag };
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return { url, text: await response.text(), ...(etag ? { etag } : {}) };
  }
}

/** The app's own key/value space: one SQLite table. Never the user's files. */
export class MobileStorage implements Storage {
  private database: Promise<SQLite.SQLiteDatabase> | undefined;

  private open(): Promise<SQLite.SQLiteDatabase> {
    this.database ??= SQLite.openDatabaseAsync('incudo.db').then(async (db) => {
      await db.execAsync('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;');
      return db;
    });
    return this.database;
  }

  async read(key: string): Promise<string | null> {
    const row = await (await this.open()).getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
    return row ? row.value : null;
  }

  async write(key: string, value: string): Promise<void> {
    await (await this.open()).runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, value);
  }

  async remove(key: string): Promise<void> {
    await (await this.open()).runAsync('DELETE FROM kv WHERE key = ?', key);
  }

  async list(prefix: string): Promise<string[]> {
    const db = await this.open();
    // The prefix as a range, as the desktop's IndexedDB reads it: `￿` sorts above every character a key holds, and
    // SQLite compares TEXT by its bytes, so no LIKE pattern (whose `%` and `_` a key may contain) is involved.
    const rows = prefix
      ? await db.getAllAsync<{ key: string }>('SELECT key FROM kv WHERE key >= ? AND key < ? ORDER BY key', prefix, `${prefix}￿`)
      : await db.getAllAsync<{ key: string }>('SELECT key FROM kv ORDER BY key');
    return rows.map((row) => row.key);
  }
}

/** A container is a `.incu` file, or a folder holding a `manifest.json` (ADR 0027). */
const CONTAINER_FILE = /\.incu$/i;

/**
 * The library as the `library` folder in the app's own documents.
 *
 * There is nothing to choose, so `location` always answers and `choose` answers the same. The words are for the user,
 * who sees them on the library screen.
 */
export class MobileCharacterStore implements CharacterStore {
  readonly available = true;
  private readonly zip: ZipCodec;

  constructor(zip: ZipCodec) {
    this.zip = zip;
  }

  private root(): Directory {
    const root = new Directory(Paths.document, 'library');
    if (!root.exists) root.create({ intermediates: true });
    return root;
  }

  async location(): Promise<string | null> {
    this.root();
    return "Incudo's own folder on this device";
  }

  async choose(): Promise<string | null> {
    return this.location();
  }

  async list(): Promise<LibraryEntryRef[]> {
    const entries: LibraryEntryRef[] = [];
    for (const item of this.root().list()) {
      if (item instanceof Directory) {
        if (new File(item, 'manifest.json').exists) entries.push({ name: item.name, form: 'folder' });
      } else if (CONTAINER_FILE.test(item.name)) {
        entries.push({ name: item.name, form: 'zip' });
      }
    }
    return entries;
  }

  async read(entry: LibraryEntryRef): Promise<Map<string, Uint8Array>> {
    if (entry.form === 'zip') return this.zip.unzip(await new File(this.root(), entry.name).bytes());
    const files = new Map<string, Uint8Array>();
    const walk = async (dir: Directory, prefix: string): Promise<void> => {
      for (const item of dir.list()) {
        if (item instanceof Directory) await walk(item, `${prefix}${item.name}/`);
        else files.set(`${prefix}${item.name}`, await item.bytes());
      }
    };
    await walk(new Directory(this.root(), entry.name), '');
    return files;
  }

  async write(entry: LibraryEntryRef, files: Map<string, Uint8Array>): Promise<void> {
    if (entry.form !== 'zip') throw new Error('A phone library keeps characters as .incu files.');
    const file = new File(this.root(), entry.name);
    if (!file.exists) file.create();
    file.write(await this.zip.zip(files));
  }

  async remove(entry: LibraryEntryRef): Promise<void> {
    const target = entry.form === 'zip' ? new File(this.root(), entry.name) : new Directory(this.root(), entry.name);
    if (target.exists) target.delete();
  }
}

/** One file from anywhere the system's document picker reaches, read once and forgotten. */
export class MobileFilePicker implements FilePicker {
  readonly available = true;

  async pick(options: FilePickOptions = {}): Promise<PickedFile[]> {
    // Android does not know a `.incu` or a `.dnd5e` by type, so the picker offers every file and the extension is
    // checked by whoever reads it.
    const picked = options.multiple
      ? await File.pickFileAsync({ multipleFiles: true })
      : await File.pickFileAsync({ multipleFiles: false });
    if (picked.canceled) return [];
    const files = Array.isArray(picked.result) ? picked.result : [picked.result];
    return Promise.all(files.map(async (file) => ({ name: file.name, bytes: await file.bytes() })));
  }
}
