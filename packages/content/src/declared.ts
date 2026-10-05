/**
 * What each source declared the last time it was loaded, kept so that a source switched off can still be named as the
 * one that has what an enabled source refers to — ADR 0090, following ADR 0052.
 *
 * A switched-off source is not loaded, so nothing in a load says what it holds. This is a record of its last load:
 * the ids its files declared and the parts it had switched off then. It is a fact about that load, never a guess about
 * what a source "usually" provides, and it is read only to say something; nothing is enabled, blocked or added from it.
 *
 * Kept under `sources/declared/`, outside the source's cache prefix (`content/<id>/`): a refresh prunes what it did not
 * touch there and an eviction removes all of it, and neither changes what the source declared when it last loaded.
 * `removeSource` removes it with the profile entry.
 */

import { applyChanges, type Storage } from '@incudo/core';

import type { MissingContent } from './library.ts';
import type { ConfiguredSource } from './profile.ts';

/** The stored record. `formatVersion` so a later shape can refuse an earlier one rather than misread it. */
export interface DeclaredRecord {
  formatVersion: 1;
  /** The parts switched off when it was made (ADR 0055), sorted: a record made with other parts says nothing. */
  excluded: string[];
  /** The ids its files declared, sorted, each once. */
  ids: string[];
}

/**
 * What one switched-off source declares of what an enabled source is missing (ADR 0052's two kinds), each list a
 * subset of that source's `MissingContent`, in its order.
 */
export interface SwitchedOffSupply {
  sourceId: string;
  /** Ids the enabled source's grants and select defaults name, which this one declares. */
  references: string[];
  /** Targets of the enabled source's waiting additions which this one declares, each once. */
  additions: string[];
}

export function declaredKey(sourceId: string): string {
  return `sources/declared/${encodeURIComponent(sourceId)}`;
}

/**
 * A short signature of a record, kept beside it, so a load whose record has not changed writes nothing: the record of
 * AuroraLegacy is about 0.7 MB, and a phone's storage measured slow with large values (ADR 0085).
 */
export function declaredSignatureKey(sourceId: string): string {
  return `sources/declared-signature/${encodeURIComponent(sourceId)}`;
}

function sortedExcluded(source: Pick<ConfiguredSource, 'excluded'>): string[] {
  return [...new Set(source.excluded ?? [])].sort();
}

/** FNV-1a over the text, with its length: only ever compared with the signature of the record written before it. */
function signature(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

/** Write a source's record after a load that succeeded, unless it is the one already kept. */
export async function writeDeclared(
  storage: Storage,
  source: Pick<ConfiguredSource, 'id' | 'excluded'>,
  ids: readonly string[],
): Promise<boolean> {
  const record: DeclaredRecord = { formatVersion: 1, excluded: sortedExcluded(source), ids: [...ids] };
  const text = JSON.stringify(record);
  const sum = signature(text);
  if ((await storage.read(declaredSignatureKey(source.id))) === sum) return false;
  await applyChanges(storage, [
    [declaredKey(source.id), text],
    [declaredSignatureKey(source.id), sum],
  ]);
  return true;
}

/**
 * A source's record, when there is one it can be trusted for: made with the parts it has switched off now. One made
 * with other parts is not read (a part switched back on since would go unnamed, and one switched off would be named for
 * what it no longer loads), and neither is one that will not parse.
 */
export async function readDeclared(
  storage: Storage,
  source: Pick<ConfiguredSource, 'id' | 'excluded'>,
): Promise<DeclaredRecord | undefined> {
  const text = await storage.read(declaredKey(source.id));
  if (text === null) return undefined;
  try {
    const record = JSON.parse(text) as DeclaredRecord;
    if (record.formatVersion !== 1 || !Array.isArray(record.ids) || !Array.isArray(record.excluded)) return undefined;
    const now = sortedExcluded(source);
    if (record.excluded.length !== now.length || record.excluded.some((url, i) => url !== now[i])) return undefined;
    return record;
  } catch {
    return undefined;
  }
}

/** Remove a source's record, with the source. */
export async function removeDeclared(storage: Storage, sourceId: string): Promise<void> {
  await applyChanges(storage, [
    [declaredKey(sourceId), null],
    [declaredSignatureKey(sourceId), null],
  ]);
}

/**
 * Which of the switched-off sources declare what `missing` lists, in the order given (the profile's), each with only
 * what it declares. A source declaring none of it is left out; one id two of them declare is under both, because both
 * do (Core and the Player's Handbook index it lists, say), and which one to switch on is the user's to decide.
 */
export function switchedOffSupply(
  missing: MissingContent,
  records: ReadonlyArray<{ sourceId: string; record: DeclaredRecord }>,
): SwitchedOffSupply[] {
  const targets = [...new Set(missing.additions)];
  const out: SwitchedOffSupply[] = [];
  for (const { sourceId, record } of records) {
    const ids = new Set(record.ids);
    const references = missing.references.filter((id) => ids.has(id));
    const additions = targets.filter((id) => ids.has(id));
    if (references.length || additions.length) out.push({ sourceId, references, additions });
  }
  return out;
}
