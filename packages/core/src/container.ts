/**
 * The `.incu` container (ADR 0012).
 *
 * The product requirement, in the owner's words: *a save file generated in an app that has
 * 200 books of sources should be openable in a fresh app with zero sources.* So a save is
 * not just the character — it carries the slice of content that character actually uses:
 *
 *     character.incu   (a zip; the same tree also lives unpacked as a folder)
 *     ├── manifest.json     formatVersion, systemId, kind, integrity, created/updated
 *     ├── character.json    choices, rolls, progress, freeform, overrides, source refs
 *     ├── content.json      the element subset this character references
 *     └── assets/
 *         └── portrait.png  real bytes, no base64
 *
 * This file knows the *tree*, not the zip. Everything below turns a character into a map of
 * path → bytes and back again, which is exactly the folder form; a zip is one encoding of
 * that map, and encoding it needs a compressor, which is platform-shaped and therefore
 * injected (see `platform.ts`, `ZipCodec`). The upshot is that the packed and unpacked forms
 * cannot drift apart, because there is only one of them here.
 *
 * The system definition is deliberately **not** embedded. That comes from the app: a save
 * carries the content a character depends on, not the rules-structure metadata (ADR 0012).
 */

import type { Character, SourceRef } from './character.ts';
import { advancementElementIds, chosenElementIds, inventoryElementIds } from './character.ts';
import type { Element, ElementId, ElementIndex } from './model.ts';
import { referencedElementIds } from './engine.ts';
import { baselineElementIds, type ResolvedCharacterKind } from './system.ts';
import { integrityOf } from './sha256.ts';

export const MANIFEST_PATH = 'manifest.json';
export const CHARACTER_PATH = 'character.json';
export const CONTENT_PATH = 'content.json';
export const ASSETS_PREFIX = 'assets/';

/** A container as a flat tree: path within the container → its bytes. */
export type ContainerFiles = Map<string, Uint8Array>;

export interface ContainerManifest {
  formatVersion: 1;
  kind: 'character' | 'content';
  systemId?: string;
  /** Which of the system's kinds, duplicated here so a reader need not unpack character.json. */
  characterKind?: string;
  characterId?: string;
  name?: string;
  elementCount?: number;
  assets?: string[];
  sources?: SourceRef[];
  /** `"sha256-<hex>"` per entry. A checksum, not a signature — see sha256.ts. */
  integrity?: Record<string, string>;
  generator?: string;
  created: string;
  updated?: string;
}

/** The body of `content.json`, and of a standalone `.incuset` content bundle. */
export interface ContentBundle {
  formatVersion: 1;
  elements: Element[];
  /**
   * Ids the character's content referenced that were not in any loaded source when this was
   * written. Recorded rather than dropped: on the corpus this is mostly Aurora's runtime-
   * generated `ID_INTERNAL_*`, and a reader that knows the difference between "missing" and
   * "never existed" can say something useful instead of showing a broken character.
   */
  unresolved?: ElementId[];
}

export interface CharacterContainer {
  manifest: ContainerManifest;
  character: Character;
  content: ContentBundle;
  /** Keyed by full container path, e.g. `assets/portrait.png`. */
  assets: ContainerFiles;
}

export interface ContainerProblem {
  level: 'error' | 'warning';
  path?: string;
  message: string;
}

// --- the content subset ----------------------------------------------------

export interface ContentSubset {
  elements: Element[];
  unresolved: ElementId[];
}

export interface CollectOptions {
  /**
   * The character's kind, so its baseline `grants` and one element per step of progression
   * are embedded too.
   *
   * Pass it. Those elements are part of every derivation and are reached through the system
   * definition rather than through a choice, so a save written without them derives
   * correctly against a corpus and reports them unresolved on its own — which is precisely
   * the failure ADR 0012 exists to prevent.
   */
  kind?: ResolvedCharacterKind;
  /**
   * Ids to include beyond what the character reaches on its own. The Aurora importer uses
   * this for the `<sum>` block: every element Aurora's own derivation ended up with.
   */
  extraIds?: Iterable<ElementId>;
  /** Guard against pathological content. Reaching it is reported, not silently truncated. */
  maxElements?: number;
}

const MAX_EMBEDDED_ELEMENTS = 20000;

/**
 * The transitive closure of everything a character references: chosen, granted, carried, and
 * named by requirements — plus, transitively, everything *those* reference.
 *
 * Two decisions worth stating, because both are easy to get subtly wrong:
 *
 * **Gates are ignored while collecting.** A grant behind `level="17"` is followed even for a
 * level 3 character. Collecting only what is currently active would produce a save whose
 * derivation is correct today and reports `unresolved-element` the moment anything changes —
 * a levelled-up character, a swapped choice, a requirement that flips. The fixed-point
 * derivation visits rules in an order that depends on state, so the safe closure is the
 * state-independent one.
 *
 * **Requirement targets are included.** `requirements="ID_X"` never resolves an element
 * during derivation — it is a membership test against what the character already has — but
 * embedding the target keeps the save readable and self-describing rather than full of ids
 * that mean nothing without a corpus.
 *
 * Typically 60–200 elements out of the 12,000 in a full corpus.
 */
export function collectCharacterContent(
  character: Character,
  index: ElementIndex,
  options: CollectOptions = {},
): ContentSubset {
  const limit = options.maxElements ?? MAX_EMBEDDED_ELEMENTS;
  const collected = new Map<ElementId, Element>();
  const unresolved = new Set<ElementId>();
  const seen = new Set<ElementId>();

  let frontier: ElementId[] = [
    ...chosenElementIds(character),
    // A second class is named only by `advancement` (ADR 0015) — no select chose it. Leaving
    // these out embeds half a multiclassed character, which is the ADR 0012 failure exactly.
    ...advancementElementIds(character),
    // The bag, entries and adornments alike, and deliberately **not** filtered to what is
    // equipped (ADR 0024). A carried Frost Brand is as much part of the character as a worn
    // one, and a save whose bag cannot be read is a broken save. Step 3's derivation will
    // read only the equipped ones; that asymmetry is the point, not an oversight.
    ...inventoryElementIds(character),
    ...(options.kind ? baselineElementIds(options.kind, character.progress) : []),
    ...(options.extraIds ?? []),
  ];
  for (const id of frontier) seen.add(id);

  while (frontier.length && collected.size < limit) {
    const next = new Set<ElementId>();
    for (const id of frontier) {
      const element = index.get(id);
      if (!element) {
        unresolved.add(id);
        continue;
      }
      collected.set(id, element);
      for (const referenced of referencedElementIds([element])) {
        if (seen.has(referenced)) continue;
        seen.add(referenced);
        next.add(referenced);
      }
    }
    frontier = [...next];
  }

  return {
    // Sorted so the same character always produces byte-identical content.json — a save
    // that changes checksum without changing meaning is a save nobody can diff.
    elements: [...collected.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    unresolved: [...unresolved].sort(),
  };
}

/** An ElementIndex over a bundle, so a derivation can run against a save's own content. */
export class BundleElementIndex implements ElementIndex {
  private readonly byId = new Map<ElementId, Element>();
  private readonly typeIdx = new Map<string, Element[]>();
  private readonly supportIdx = new Map<string, Element[]>();

  constructor(elements: Iterable<Element>) {
    for (const element of elements) {
      this.byId.set(element.id, element);
      pushInto(this.typeIdx, element.type, element);
      for (const tag of element.supports) pushInto(this.supportIdx, tag.toLowerCase(), element);
    }
  }

  get(id: ElementId): Element | undefined {
    return this.byId.get(id);
  }
  all(): Iterable<Element> {
    return this.byId.values();
  }
  byType(type: string): Element[] {
    return this.typeIdx.get(type) ?? [];
  }
  bySupport(tag: string): Element[] {
    return this.supportIdx.get(tag.toLowerCase()) ?? [];
  }
  get size(): number {
    return this.byId.size;
  }
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

// --- writing ---------------------------------------------------------------

export interface PackOptions {
  assets?: ContainerFiles;
  generator?: string;
  /** Overridable so a test can produce a byte-identical container twice. */
  now?: string;
}

/**
 * Build the container tree for a character. The result is the folder form; handing it to a
 * {@link ZipCodec} gives the `.incu` file. Nothing here touches a filesystem.
 */
export function packCharacterContainer(
  character: Character,
  content: ContentSubset,
  options: PackOptions = {},
): ContainerFiles {
  const now = options.now ?? new Date().toISOString();
  const files: ContainerFiles = new Map();

  const bundle: ContentBundle = { formatVersion: 1, elements: content.elements };
  if (content.unresolved.length) bundle.unresolved = content.unresolved;

  const characterBytes = encodeJson(character);
  const contentBytes = encodeJson(bundle);

  files.set(CHARACTER_PATH, characterBytes);
  files.set(CONTENT_PATH, contentBytes);

  const assetPaths: string[] = [];
  for (const [path, bytes] of options.assets ?? []) {
    const normalized = path.startsWith(ASSETS_PREFIX) ? path : `${ASSETS_PREFIX}${path}`;
    files.set(normalized, bytes);
    assetPaths.push(normalized);
  }
  assetPaths.sort();

  const integrity: Record<string, string> = {};
  for (const path of [CHARACTER_PATH, CONTENT_PATH, ...assetPaths]) {
    integrity[path] = integrityOf(files.get(path)!);
  }

  const manifest: ContainerManifest = {
    formatVersion: 1,
    kind: 'character',
    systemId: character.systemId,
    characterKind: character.kind,
    characterId: character.id,
    name: character.name,
    elementCount: content.elements.length,
    assets: assetPaths,
    sources: character.sources,
    integrity,
    generator: options.generator,
    created: character.createdAt ?? now,
    updated: character.updatedAt ?? now,
  };

  // Manifest last: it checksums everything else, so it cannot checksum itself.
  files.set(MANIFEST_PATH, encodeJson(manifest));
  return files;
}

/** The same tree for a standalone content bundle — a `.incuset`. */
export function packContentBundle(
  elements: Element[],
  options: PackOptions & { name?: string; sources?: SourceRef[] } = {},
): ContainerFiles {
  const now = options.now ?? new Date().toISOString();
  const files: ContainerFiles = new Map();
  const bundle: ContentBundle = { formatVersion: 1, elements };
  const contentBytes = encodeJson(bundle);
  files.set(CONTENT_PATH, contentBytes);

  const manifest: ContainerManifest = {
    formatVersion: 1,
    kind: 'content',
    name: options.name,
    elementCount: elements.length,
    sources: options.sources,
    integrity: { [CONTENT_PATH]: integrityOf(contentBytes) },
    generator: options.generator,
    created: now,
  };
  files.set(MANIFEST_PATH, encodeJson(manifest));
  return files;
}

// --- reading ---------------------------------------------------------------

export interface ReadResult {
  container: CharacterContainer | undefined;
  problems: ContainerProblem[];
}

/**
 * Read a container tree — from a zip a {@link ZipCodec} unpacked, or from a folder someone
 * kept in git. Same code either way, which is the point of ADR 0012's "both representations,
 * one layout".
 *
 * A missing or unparseable `manifest.json`, `character.json` or `content.json` is an error
 * and yields no container. A checksum mismatch is a *warning*: the file still opens, and the
 * user is told what looks edited. Refusing to open a save because a byte moved would be
 * choosing the checksum over the character, which is the wrong way round.
 */
export function readCharacterContainer(files: ContainerFiles): ReadResult {
  const problems: ContainerProblem[] = [];

  const manifest = parseEntry<ContainerManifest>(files, MANIFEST_PATH, problems);
  const character = parseEntry<Character>(files, CHARACTER_PATH, problems);
  const content = parseEntry<ContentBundle>(files, CONTENT_PATH, problems);
  if (!manifest || !character || !content) return { container: undefined, problems };

  if (manifest.kind !== 'character') {
    problems.push({
      level: 'error',
      path: MANIFEST_PATH,
      message: `is a "${manifest.kind}" container, not a character.`,
    });
    return { container: undefined, problems };
  }

  for (const [path, expected] of Object.entries(manifest.integrity ?? {})) {
    const bytes = files.get(path);
    if (!bytes) {
      problems.push({
        level: 'warning',
        path,
        message: 'is listed in the manifest but missing from the container.',
      });
      continue;
    }
    const actual = integrityOf(bytes);
    if (actual !== expected) {
      problems.push({
        level: 'warning',
        path,
        message: 'has changed since the container was written.',
      });
    }
  }

  const assets: ContainerFiles = new Map();
  for (const [path, bytes] of files) {
    if (path.startsWith(ASSETS_PREFIX)) assets.set(path, bytes);
  }

  // A referenced asset that is not in the container keeps its reference: the user renamed a
  // file or the container was assembled by hand, and losing the reference loses information
  // the app cannot get back (ADR 0007).
  for (const [name, path] of Object.entries(character.assets ?? {})) {
    if (!assets.has(path)) {
      problems.push({
        level: 'warning',
        path,
        message: `is referenced as "${name}" but is not in the container. Showing a placeholder.`,
      });
    }
  }

  return { container: { manifest, character, content, assets }, problems };
}

export interface ReadBundleResult {
  manifest: ContainerManifest | undefined;
  bundle: ContentBundle | undefined;
  problems: ContainerProblem[];
}

/**
 * Read a `.incuset` — a compiled content bundle, which is the same container with the
 * character left out.
 *
 * It is what an imported Aurora index becomes once normalized: the elements, already
 * parsed, with no XML left anywhere. A save embeds its own subset and does not need one
 * (ADR 0012); a bundle is for shipping *content*, which is a different job.
 */
export function readContentBundle(files: ContainerFiles): ReadBundleResult {
  const problems: ContainerProblem[] = [];
  const manifest = parseEntry<ContainerManifest>(files, MANIFEST_PATH, problems);
  const bundle = parseEntry<ContentBundle>(files, CONTENT_PATH, problems);
  if (!manifest || !bundle) return { manifest, bundle: undefined, problems };

  if (manifest.kind !== 'content') {
    problems.push({
      level: 'error',
      path: MANIFEST_PATH,
      message: `is a "${manifest.kind}" container, not a content bundle.`,
    });
    return { manifest, bundle: undefined, problems };
  }

  const expected = manifest.integrity?.[CONTENT_PATH];
  if (expected && integrityOf(files.get(CONTENT_PATH)!) !== expected) {
    problems.push({
      level: 'warning',
      path: CONTENT_PATH,
      message: 'has changed since the bundle was written.',
    });
  }

  return { manifest, bundle, problems };
}

/** An element index over a container's embedded content, ready to derive against. */
export function containerElementIndex(container: CharacterContainer): ElementIndex {
  return new BundleElementIndex(container.content.elements);
}

function parseEntry<T>(
  files: ContainerFiles,
  path: string,
  problems: ContainerProblem[],
): T | undefined {
  const bytes = files.get(path);
  if (!bytes) {
    problems.push({ level: 'error', path, message: 'is missing from the container.' });
    return undefined;
  }
  try {
    return JSON.parse(decodeText(bytes)) as T;
  } catch (error) {
    problems.push({
      level: 'error',
      path,
      message: `is not valid JSON: ${(error as Error).message}`,
    });
    return undefined;
  }
}

// --- bytes -----------------------------------------------------------------

/**
 * Two spaces and a trailing newline, so the unpacked folder form is genuinely reviewable in
 * a diff — that is the whole reason ADR 0012 keeps it. The zip compresses the whitespace
 * away, so the packed form pays nothing for it.
 */
export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
