/**
 * Which publications a character is offered — ADR 0049.
 *
 * A table says which books it plays with, and the builder offers from those. The one input is
 * `Character.publications`, an allowlist of names that is absent for "every publication". Everything here
 * is either the index view the builder offers from, or the list a screen renders; the pane in
 * `apps/desktop` computes nothing (CODE-REUSE-POLICY rule 2).
 *
 * **It narrows offers and never the character.** The view leaves elements out of `all`, `byType` and
 * `bySupport`, which is how every candidate list is built, and answers `get` for everything, which is the
 * only way the derivation reads content. So an element held from a book the character is no longer offered
 * stays, grants what it grants and derives as before; only the alternatives beside it narrow.
 */

import type {
  Character,
  Element,
  ElementId,
  ElementIndex,
  ElementType,
  GameSystem,
} from '@incudo/core';

/** The element types a system marks as publications. Most systems have one; a system with none has none. */
export function publicationTypes(system: GameSystem): ElementType[] {
  return system.elementTypes.filter((type) => type.publication).map((type) => type.name);
}

/**
 * The loaded publications by lowercased name, holding the name as the publication spells it.
 *
 * Lowercased because the join ignores case, which is how Aurora matches: seven elements in the official
 * corpus name "Van Richten's Guide to Ravenloft" and the book is "…Guide To Ravenloft". Nothing else is
 * folded, so a straight apostrophe where the book has a curly one names no book and is always offered.
 */
function loadedPublications(index: ElementIndex, system: GameSystem): Map<string, string> {
  const names = new Map<string, string>();
  for (const type of publicationTypes(system)) {
    for (const element of index.byType(type)) names.set(fold(element.name), element.name);
  }
  return names;
}

function fold(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * An index that offers only what a character's publications allow, and answers every id.
 *
 * `get` passes straight through on purpose: it is how the derivation, a recorded choice and an imported
 * save's answers are all read, and none of them may change because a book was switched off. The type and
 * support lists are filtered once per key and kept, since a candidate list asks for the same type once per
 * rule and the view is rebuilt whenever the list changes.
 */
export class PublicationIndex implements ElementIndex {
  private readonly inner: ElementIndex;
  private readonly offered: (element: Element) => boolean;
  private readonly types = new Map<ElementType, Element[]>();
  private readonly supports = new Map<string, Element[]>();

  constructor(inner: ElementIndex, offered: (element: Element) => boolean) {
    this.inner = inner;
    this.offered = offered;
  }

  get(id: ElementId): Element | undefined {
    return this.inner.get(id);
  }

  all(): Iterable<Element> {
    return [...this.inner.all()].filter(this.offered);
  }

  byType(type: ElementType): Element[] {
    let found = this.types.get(type);
    if (!found) {
      found = this.inner.byType(type).filter(this.offered);
      this.types.set(type, found);
    }
    return found;
  }

  bySupport(tag: string): Element[] {
    const key = tag.toLowerCase();
    let found = this.supports.get(key);
    if (!found) {
      found = this.inner.bySupport(tag).filter(this.offered);
      this.supports.set(key, found);
    }
    return found;
  }
}

/**
 * The index a builder offers from: `index` itself when the character is offered every publication, and a
 * {@link PublicationIndex} when it records a list.
 *
 * An element is offered when its `source` is one of the recorded names, or names no loaded publication at
 * all: `Internal` and `Core` in 5e are not books and cannot be switched off, and a misspelt source is better
 * offered than hidden by its spelling. An empty list is a real answer, "no books", and still offers those.
 */
export function offeredIndex(index: ElementIndex, system: GameSystem, character: Character): ElementIndex {
  const chosen = character.publications;
  if (!chosen) return index;
  const loaded = loadedPublications(index, system);
  if (!loaded.size) return index;
  const allowed = new Set(chosen.map(fold));
  return new PublicationIndex(index, (element) => {
    const source = fold(element.source);
    return !loaded.has(source) || allowed.has(source);
  });
}

/** One row of the list a screen renders. */
export interface PublicationRow {
  /** The name as the publication spells it, or as the character recorded it when it is not loaded. */
  name: string;
  /** How many loaded elements name it as their source, case ignored. */
  elements: number;
  offered: boolean;
  /** False for a name the character records that no loaded publication has. Kept, never dropped. */
  loaded: boolean;
}

export interface PublicationList {
  /** True when the character records no list and so is offered every publication. */
  everything: boolean;
  /** Loaded publications by name, then any recorded name that is not loaded. */
  rows: PublicationRow[];
  /** How many offered rows there are. */
  offered: number;
}

/**
 * What a screen shows: every loaded publication, whether this character is offered it, and how much content
 * it holds; then any name the character records that nothing loaded has, which is shown rather than lost.
 *
 * A publication no loaded element names (nine in the official corpus) is listed with a count of zero: it is
 * still a book the table may say it uses. `index` is the full index, never the character's offered view,
 * or a switched-off book would vanish from the list that switches it back on.
 */
export function publicationList(index: ElementIndex, system: GameSystem, character: Character): PublicationList {
  const loaded = loadedPublications(index, system);
  const counts = new Map<string, number>();
  if (loaded.size) {
    // A publication names itself as its source; it is not content the book holds.
    const own = new Set(publicationTypes(system));
    for (const element of index.all()) {
      if (own.has(element.type)) continue;
      const key = fold(element.source);
      if (loaded.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const chosen = character.publications;
  const allowed = new Set((chosen ?? []).map(fold));
  const rows: PublicationRow[] = [...loaded]
    .map(([key, name]) => ({
      name,
      elements: counts.get(key) ?? 0,
      offered: !chosen || allowed.has(key),
      loaded: true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const name of chosen ?? []) {
    if (!loaded.has(fold(name))) rows.push({ name, elements: 0, offered: true, loaded: false });
  }
  return { everything: !chosen, rows, offered: rows.filter((row) => row.offered).length };
}

/**
 * The list with one publication switched on or off, as the value to record.
 *
 * Switching one off from "every publication" writes every *other* loaded one, so the answer is exactly what
 * was on screen minus that book. A name is compared ignoring case, and a recorded name that is not loaded is
 * carried through untouched unless it is the one switched.
 */
export function togglePublication(
  index: ElementIndex,
  system: GameSystem,
  character: Character,
  name: string,
  offered: boolean,
): string[] {
  const key = fold(name);
  const current =
    character.publications ?? [...loadedPublications(index, system).values()].sort((a, b) => a.localeCompare(b));
  const without = current.filter((recorded) => fold(recorded) !== key);
  return offered ? [...without, name] : without;
}

/**
 * The character with its list replaced. `undefined` is "every publication" and removes the field, which is
 * how a character that never chose looks; an empty array is "no books" and is kept.
 */
export function setPublications(character: Character, publications: string[] | undefined): Character {
  if (!publications) {
    if (!('publications' in character)) return character;
    const { publications: _dropped, ...rest } = character;
    return rest;
  }
  return { ...character, publications: [...publications] };
}
