/**
 * A JSON import is `unknown`, on purpose.
 *
 * `resolveJsonModule` would give `systems/dnd5e/system.json` a structural type inferred from
 * today's file, and that type would be a lie in the one way that matters: a system definition is
 * *data* whose contract is `schemas/system.schema.json`, checked at runtime by
 * `validateGameSystem` (ADR 0011). A compile-time shape would let the app read a field the
 * schema does not guarantee and skip the validation that is supposed to be the only gate.
 *
 * So the app receives `unknown` and has to validate before it can use anything — which is what
 * the tests already do with the same function. It also keeps these files out of `rootDir`, so
 * `tsc --build` never tries to compile the repo's data as app source.
 */
declare module '*.json' {
  const value: unknown;
  export default value;
}

/**
 * The File System Access API, which `lib.dom` does not yet describe in full.
 *
 * `showDirectoryPicker` and the async-iterable `entries()` are Chromium-only, and the two
 * permission methods are a WICG extension no standard library declares. The browser build's
 * character library is built on them (ADR 0027), and every call site feature-detects before
 * reaching for one — `createDesktopPlatform` falls back to a store that says it is
 * unavailable. These declarations only stop the compiler pretending they cannot exist.
 */
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: FileSystemHandle | string;
}

interface Window {
  showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}

/**
 * Opening a *file* the user points at, which is how an Aurora `.dnd5e` gets in.
 *
 * Same story as the directory picker above: Chromium-only, and `createDesktopPlatform`
 * hands back a picker that says it is unavailable where this is missing.
 */
interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  id?: string;
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  startIn?: FileSystemHandle | string;
  types?: FilePickerAcceptType[];
}

/**
 * Choosing where a file goes, which is how "Save a copy…" reaches the disk in a browser. Same
 * story again: Chromium-only, and `createDesktopPlatform` hands back a saver that says it is
 * unavailable where this is missing.
 */
interface SaveFilePickerOptions {
  id?: string;
  suggestedName?: string;
  excludeAcceptAllOption?: boolean;
  startIn?: FileSystemHandle | string;
  types?: FilePickerAcceptType[];
}
