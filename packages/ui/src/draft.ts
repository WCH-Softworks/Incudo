/**
 * What the shell was editing besides the character, kept beside the draft (ADR 0066).
 *
 * The draft is the shell's autosave: `character.json`, written on every change under
 * `character:current`. A character opened from the library is more than that. It came with the
 * save's embedded content, which is what lets it derive with no source enabled (ADR 0012), its
 * asset bytes, and the library entry the next Save writes back to. The draft kept none of them, so
 * a reload with no source enabled showed an NPC with no creature, and Save then wrote a *second*
 * file under a fresh name with nothing embedded. Found by running the browser build, not by a test.
 *
 * So the rest of the working state is kept too, under its own key and written only when it changes
 * (an open, a new character, a save): never on a keystroke, because the embedded content of a real
 * save is hundreds of elements. It is tied to the draft by the character's id, since two keys
 * cannot be written together: a record whose id is not the draft's belongs to some earlier
 * character and is ignored. Anything that does not read is ignored too, as a corrupt draft is.
 *
 * What it keeps is exactly what the session held, not what the character reaches: an element taken
 * from a source after the file was opened is not kept, because the session before the reload did
 * not have it with that source off either. A reload changes nothing; that is the whole claim.
 */

import {
  BundleElementIndex,
  type Character,
  type ContainerFiles,
  type Element,
  type ElementIndex,
  type LibraryEntryRef,
  type Storage,
} from '@incudo/core';
import { decodeBase64 } from '@incudo/aurora-import';

/** Beside `character:current`, the draft's own key, which the shell's boot code owns. */
export const DRAFT_ORIGIN_KEY = 'character:current:origin';

/** Where the character being edited came from, and what that brought with it. */
export interface DraftOrigin {
  /** The save's own embedded content, when this character was opened from a file. */
  embedded?: ElementIndex;
  /**
   * The save's asset files, when it was opened from one. Held so the next Save and any copy
   * write the portrait back out: a character records only where it is, not what it holds.
   */
  assets?: ContainerFiles;
  entry?: LibraryEntryRef;
  /** What the manifest said when it was read — the conflict check compares this. */
  readAt?: string;
  /**
   * `character.name` as of the last successful save (or the open that gave us `entry`).
   * `LibraryEntryRef.name` is never derived from this — a character renamed to something else still
   * lives in `aelin.incu` (ADR 0027) — so this is the one place that remembers what the name
   * *was*, which is what lets the next save notice it changed and ask about the file too.
   * Always set together with `entry`; undefined exactly when `entry` is.
   */
  savedName?: string;
}

/** The character being edited, and everything else the shell holds about it. */
export interface WorkingCharacter extends DraftOrigin {
  character: Character;
}

/** The stored shape. Assets are base64, because `Storage` holds text. */
interface StoredOrigin {
  formatVersion: 1;
  /** The draft character this belongs to. */
  characterId: string;
  elements?: Element[];
  assets?: Record<string, string>;
  entry?: LibraryEntryRef;
  readAt?: string;
  savedName?: string;
}

/** The record for `origin`, or undefined when there is nothing to keep (a new character). */
export function encodeDraftOrigin(characterId: string, origin: DraftOrigin): string | undefined {
  const stored: StoredOrigin = { formatVersion: 1, characterId };
  if (origin.embedded) stored.elements = [...origin.embedded.all()];
  if (origin.assets?.size) {
    stored.assets = {};
    for (const [path, bytes] of origin.assets) stored.assets[path] = encodeBase64(bytes);
  }
  if (origin.entry) {
    stored.entry = { name: origin.entry.name, form: origin.entry.form };
    if (origin.readAt !== undefined) stored.readAt = origin.readAt;
    if (origin.savedName !== undefined) stored.savedName = origin.savedName;
  }
  if (!stored.elements && !stored.assets && !stored.entry) return undefined;
  return JSON.stringify(stored);
}

/**
 * What `text` kept for the draft character `characterId`, or nothing.
 *
 * Nothing when the record is absent, belongs to another character, or does not read: all of it or
 * none, because half a working state (an entry without the content it was opened with) would save
 * over the file with less than it held.
 */
export function decodeDraftOrigin(text: string | null, characterId: string): DraftOrigin {
  if (!text) return {};
  try {
    const stored = JSON.parse(text) as Partial<StoredOrigin> | null;
    if (!isObject(stored) || stored.formatVersion !== 1 || stored.characterId !== characterId) return {};

    const origin: DraftOrigin = {};
    if (stored.elements !== undefined) {
      if (!Array.isArray(stored.elements) || !stored.elements.every(isElementShaped)) return {};
      origin.embedded = new BundleElementIndex(stored.elements);
    }
    if (stored.assets !== undefined) {
      if (!isObject(stored.assets)) return {};
      const assets: ContainerFiles = new Map();
      for (const [path, text] of Object.entries(stored.assets)) {
        if (!path.startsWith('assets/') || typeof text !== 'string') return {};
        const { bytes, skipped } = decodeBase64(text);
        if (skipped) return {};
        assets.set(path, bytes);
      }
      origin.assets = assets;
    }
    if (stored.entry !== undefined) {
      const { entry } = stored;
      if (!isObject(entry) || typeof entry.name !== 'string' || !entry.name) return {};
      if (entry.form !== 'zip' && entry.form !== 'folder') return {};
      if (typeof stored.savedName !== 'string') return {};
      if (stored.readAt !== undefined && typeof stored.readAt !== 'string') return {};
      origin.entry = { name: entry.name, form: entry.form };
      origin.savedName = stored.savedName;
      if (stored.readAt !== undefined) origin.readAt = stored.readAt;
    }
    return origin;
  } catch {
    return {};
  }
}

/** Keep `origin` for the draft character, or remove the record when there is nothing to keep. */
export async function writeDraftOrigin(
  storage: Storage,
  characterId: string,
  origin: DraftOrigin,
): Promise<void> {
  const text = encodeDraftOrigin(characterId, origin);
  if (text === undefined) await storage.remove(DRAFT_ORIGIN_KEY);
  else await storage.write(DRAFT_ORIGIN_KEY, text);
}

/** What was kept for the draft character `characterId`. A storage that throws keeps nothing. */
export async function readDraftOrigin(storage: Storage, characterId: string): Promise<DraftOrigin> {
  try {
    return decodeDraftOrigin(await storage.read(DRAFT_ORIGIN_KEY), characterId);
  } catch {
    return {};
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Enough of an element that indexing it cannot throw. The rest is trusted as a container's
 * `content.json` is: a save's elements are not validated on open either.
 */
function isElementShaped(value: unknown): value is Element {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.type === 'string' &&
    Array.isArray(value.supports) &&
    value.supports.every((tag) => typeof tag === 'string')
  );
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Standard base64 with padding. `btoa` takes a string of code units, not bytes, and is a web API;
 * this is the other half of the importer's `decodeBase64`, which reads it back.
 */
function encodeBase64(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out.push(ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out.push(`${ALPHABET[(n >> 18) & 63]!}${ALPHABET[(n >> 12) & 63]!}==`);
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out.push(`${ALPHABET[(n >> 18) & 63]!}${ALPHABET[(n >> 12) & 63]!}${ALPHABET[(n >> 6) & 63]!}=`);
  }
  return out.join('');
}
