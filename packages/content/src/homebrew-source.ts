/**
 * A homebrew source: elements the user wrote in the app, kept in Incudo's own content format — ADR 0108.
 *
 * A line in the sources profile like any other (`kind: 'homebrew'`), addressed as `homebrew:<slug>`, loaded through the
 * same library. Its body is a `ContentBundle`, the shape a save's `content.json` already is, each element less its
 * `origin`, which the load supplies. Kept under `sources/homebrew/`, outside the `content/` cache prefix, because it is
 * the only copy the app has (ADR 0056's reason).
 */

import { checkContentBundle, type ContentBundle, type Element, type Storage } from '@incudo/core';
import type { ConfiguredSource, SourceProfile } from './profile.ts';

const SCHEME = 'homebrew:';

/** An element as a homebrew body keeps it: everything but where it was loaded from. */
export type HomebrewElement = Omit<Element, 'origin'>;

export interface HomebrewBundle extends Omit<ContentBundle, 'elements' | 'unresolved'> {
  elements: HomebrewElement[];
}

export const EMPTY_HOMEBREW: HomebrewBundle = { formatVersion: 1, elements: [] };

export function isHomebrewSource(source: Pick<ConfiguredSource, 'kind'>): boolean {
  return source.kind === 'homebrew';
}

/** The address of a homebrew source's one file, which its elements' origin names. */
export function homebrewFileUrl(sourceUrl: string): string {
  return `${sourceUrl}/elements.json`;
}

/** Where a homebrew source's body is kept. */
export function homebrewKey(sourceId: string): string {
  return `sources/homebrew/${encodeURIComponent(sourceId)}`;
}

/** Said when a homebrew source is asked something only a source at an address can answer. */
export const HOMEBREW_HAS_NO_UPSTREAM =
  'This is content you wrote in Incudo, so there is nowhere to check for a newer version.';

/** A slug of a name for an id: lowercase letters, digits and hyphens. */
function slug(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'homebrew';
}

/** A `homebrew:` id for a name that no source in the profile has, `-2`, `-3`… when it is taken. */
export function homebrewSourceId(profile: Pick<SourceProfile, 'find'>, name: string): string {
  const base = `${SCHEME}${slug(name)}`;
  let id = base;
  for (let n = 2; profile.find(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * A homebrew body is checked by the content format's one checker (ADR 0108 decision 2, ADR 0119 decision 4): the same
 * format a save's content and a converted source are. Returns the sentences that refuse it, none when it reads.
 */
export function checkHomebrewBundle(raw: unknown): { value?: HomebrewBundle; problems: string[] } {
  const { value, problems } = checkContentBundle(raw);
  return value ? { value: value as HomebrewBundle, problems } : { problems };
}

/** Read a homebrew source's body: none is an empty source; one that does not read or check is refused with a sentence. */
export async function readHomebrew(
  storage: Storage,
  sourceId: string,
): Promise<{ status: 'ready'; bundle: HomebrewBundle } | { status: 'unreadable'; reason: string }> {
  const text = await storage.read(homebrewKey(sourceId));
  if (text === null) return { status: 'ready', bundle: EMPTY_HOMEBREW };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { status: 'unreadable', reason: `Incudo's copy of this homebrew is not valid JSON: ${(error as Error).message}` };
  }
  const { value, problems } = checkHomebrewBundle(raw);
  if (!value) return { status: 'unreadable', reason: `Incudo's copy of this homebrew cannot be read. ${problems.join(' ')}` };
  return { status: 'ready', bundle: value };
}

/**
 * Write a homebrew source's body. Refuses a body the checker refuses, and never writes over one that does not read
 * (ADR 0108 decision 2): the caller reads first and writes only what it read and changed.
 */
export async function writeHomebrew(storage: Storage, sourceId: string, bundle: HomebrewBundle): Promise<void> {
  const { problems } = checkHomebrewBundle(bundle);
  if (problems.length) throw new Error(problems.join(' '));
  const current = await readHomebrew(storage, sourceId);
  if (current.status === 'unreadable') throw new Error(current.reason);
  await storage.write(homebrewKey(sourceId), `${JSON.stringify(bundle, null, 2)}\n`);
}

/** Make an empty homebrew source under a system, and its body. The caller saves the profile and reloads. */
export async function createHomebrewSource(
  profile: SourceProfile,
  storage: Storage,
  options: { name: string; systemId: string },
): Promise<ConfiguredSource> {
  const name = options.name.trim();
  if (!name) throw new Error('A homebrew source needs a name.');
  const id = homebrewSourceId(profile, name);
  await storage.write(homebrewKey(id), `${JSON.stringify(EMPTY_HOMEBREW, null, 2)}\n`);
  return profile.add(id, { kind: 'homebrew', name, systemId: options.systemId, mode: 'download' });
}
