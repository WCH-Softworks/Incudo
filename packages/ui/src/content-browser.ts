/**
 * Looking through everything the enabled sources hold — ADR 0053.
 *
 * The builder shows what one decision may hold and the sheet what one character has. This answers the
 * question neither can: what is loaded. It is a view-model (CODE-REUSE-POLICY rule 2): the pane in
 * `apps/desktop` renders a {@link BrowserResult} and an {@link ElementDetail} and computes nothing.
 *
 * Four things decided rather than fallen into:
 *
 *  - **It reads the index the load produced, never a character's view of it.** No `Character` comes in, so
 *    a book switched off for one table (ADR 0049) is still here to be looked at, and a save's embedded
 *    content (ADR 0012) is not: that is one character's frozen copy, not something a source holds.
 *  - **It never reorders what the index hands back.** Entries are copied and sorted here; `byType` arrays
 *    are the builder's candidate lists, in the builder's order, and sorting one in place would change what
 *    the builder shows first. A test holds that.
 *  - **Types are the system's.** A category is a type the system marks `browsable`, a label is its `plural`,
 *    and a type the system does not declare is still found, under the name content gave it. Nothing here
 *    names a game's type (ADR 0003).
 *  - **A plain scan, no index.** Measured over the official corpus's 14,545 elements: under 8 ms per query
 *    in the Tauri window with the lowercased text built once (ADR 0053's table). An index would be a second
 *    structure to rebuild on every load and to keep in step with the matching rules below.
 */

import type { Element, ElementId, ElementIndex, ElementType, GameSystem } from '@incudo/core';

import { publicationNames } from './publications.ts';

/** How many rows a page holds when the caller does not say. */
export const BROWSER_PAGE = 100;

/** Where a query matched, best first. The number is the rank; lower sorts first. */
export type MatchedBy = 'name' | 'id' | 'description';

export interface BrowserQuery {
  /** What the user typed. Empty with no type and no book is the idle state: nothing is listed. */
  text: string;
  /** Only elements of this type. */
  type?: ElementType;
  /** Only elements naming this book, by {@link BookCount.key}. */
  book?: string;
  /** Also match description text. On unless the caller turns it off. */
  descriptions?: boolean;
  /** How many rows to return. {@link BROWSER_PAGE} when absent. */
  limit?: number;
}

export interface BrowserRow {
  id: ElementId;
  name: string;
  type: ElementType;
  typeLabel: string;
  /** The book's name, or the `source` as written when it names no loaded book. Empty when there is none. */
  book: string;
  /** Absent when nothing was typed. */
  matched?: MatchedBy;
  /** For a description match: the text around the first word found. */
  excerpt?: string;
}

/** Which of three groups a type falls into, in the order a filter lists them. */
export type TypeGroup = 'browsable' | 'declared' | 'undeclared';

export interface TypeCount {
  type: ElementType;
  label: string;
  group: TypeGroup;
  /** How many elements of this type match the text and book, whatever type is chosen. */
  count: number;
}

export interface BookCount {
  /** What {@link BrowserQuery.book} takes. The `source` lowercased; empty for elements with none. */
  key: string;
  /** The book's own spelling, or the first `source` seen for a key no loaded book has. */
  name: string;
  /** How many elements naming it match the text and type, whatever book is chosen. */
  count: number;
}

export interface BrowserResult {
  /** Nothing typed, no type and no book chosen. `rows` is empty and `types` is every type's size. */
  idle: boolean;
  /** At most `limit`, best first. */
  rows: BrowserRow[];
  /** How many matched before the page was cut. */
  count: number;
  /** Every type with a match, then any chosen type without one, grouped and then by label. */
  types: TypeCount[];
  /** Every book with a match, then any chosen book without one, by name. */
  books: BookCount[];
}

/** A select that offers an element, by filtering on exactly one plain tag the element carries. */
export interface OfferingSelect {
  /** The element whose rule it is. */
  ownerId: ElementId;
  ownerName: string;
  /** The select's own name, as content wrote it. */
  select: string;
}

export interface ElementDetail {
  element: Element;
  typeLabel: string;
  group: TypeGroup;
  book: string;
  /** The content source it was loaded from, by id. */
  sourceId: string;
  /** The file it was read from. Absent for an element generated at load, which has none. */
  fileUrl?: string;
  /** Sorted by owner name, then select. Every one found; a screen decides how many to show. */
  offeredBy: OfferingSelect[];
}

interface Entry {
  element: Element;
  /** The name as a query is compared with it: see `normalize`. */
  name: string;
  /** Lowercased. */
  id: string;
  bookKey: string;
  type: ElementType;
  /** {@link GROUP_ORDER} of the element's type: within a rank, what the system says is worth browsing first. */
  group: number;
}

/**
 * Everything loaded, ready to search.
 *
 * Built once per index: the constructor copies and sorts (tens of milliseconds for the official corpus);
 * description text is built the first time a query reaches it, since a browser opened only to pick a
 * category never needs it; the "offered by" lookup the first time an element is described.
 */
export class ContentCatalog {
  private readonly index: ElementIndex;
  private readonly entries: Entry[];
  private readonly labels = new Map<ElementType, { label: string; group: TypeGroup; order: number }>();
  private readonly bookNames = new Map<string, string>();
  private text: string[] | undefined;
  private offering: Map<string, { ownerId: ElementId; select: string }[]> | undefined;

  constructor(index: ElementIndex, system: GameSystem) {
    this.index = index;
    system.elementTypes.forEach((type, order) => {
      this.labels.set(type.name, {
        label: type.plural ?? type.name,
        group: type.browsable ? 'browsable' : 'declared',
        order,
      });
    });

    // The loaded books' own spellings first, so an element whose `source` differs only by case shows
    // the book's name (ADR 0049's join); anything else keeps the first spelling seen.
    for (const [key, name] of publicationNames(index, system)) this.bookNames.set(key, name);

    // A copy, always: `all()` may be the index's own storage.
    this.entries = [...index.all()].map((element) => {
      const bookKey = element.source.trim().toLowerCase();
      if (!this.bookNames.has(bookKey)) this.bookNames.set(bookKey, element.source.trim());
      return {
        element,
        name: normalize(element.name),
        id: element.id.toLowerCase(),
        bookKey,
        type: element.type,
        group: GROUP_ORDER[this.typeGroup(element.type)],
      };
    });
    this.entries.sort(
      (a, b) =>
        a.element.name.localeCompare(b.element.name) ||
        this.typeLabel(a.type).localeCompare(this.typeLabel(b.type)) ||
        a.element.id.localeCompare(b.element.id),
    );
  }

  /** How many elements are loaded. */
  get size(): number {
    return this.entries.length;
  }

  /** The system's label for a type, or the type itself when the system does not declare it. */
  typeLabel(type: ElementType): string {
    return this.labels.get(type)?.label ?? type;
  }

  typeGroup(type: ElementType): TypeGroup {
    return this.labels.get(type)?.group ?? 'undeclared';
  }

  search(query: BrowserQuery): BrowserResult {
    const phrase = normalize(query.text);
    const words = phrase ? phrase.split(' ') : [];
    const descriptions = query.descriptions ?? true;
    const limit = query.limit ?? BROWSER_PAGE;
    const idle = !phrase && query.type === undefined && query.book === undefined;

    const text = phrase && descriptions ? this.descriptionTexts() : undefined;
    const typeCounts = new Map<ElementType, number>();
    const bookCounts = new Map<string, number>();
    // One bucket per rank and type group, each already in name order because the entries are: concatenating
    // them is the ranked list with no sort per keystroke. The group splits a rank so that "elf" lists the Elf
    // race before a background's table row that is also called "Elf", which it did not at first.
    const ranked: Array<Array<{ at: number; matched?: MatchedBy }>> = Array.from({ length: MATCHED.length * 3 }, () => []);

    this.entries.forEach((entry, at) => {
      let rank = 0;
      if (phrase) {
        rank = rankOf(entry, phrase, words, text?.[at]);
        if (rank < 0) return;
      }
      const typeOk = query.type === undefined || entry.type === query.type;
      const bookOk = query.book === undefined || entry.bookKey === query.book;
      if (bookOk) typeCounts.set(entry.type, (typeCounts.get(entry.type) ?? 0) + 1);
      if (typeOk) bookCounts.set(entry.bookKey, (bookCounts.get(entry.bookKey) ?? 0) + 1);
      if (idle || !typeOk || !bookOk) return;
      ranked[rank * 3 + entry.group]!.push({ at, matched: phrase ? MATCHED[rank] : undefined });
    });

    const all = ranked.flat();
    const rows = all.slice(0, limit).map(({ at, matched }) => this.row(this.entries[at]!, matched, words));

    const types: TypeCount[] = [...typeCounts].map(([type, count]) => this.typeCount(type, count));
    if (query.type !== undefined && !typeCounts.has(query.type)) types.push(this.typeCount(query.type, 0));
    types.sort(
      (a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.label.localeCompare(b.label) || a.type.localeCompare(b.type),
    );

    const books: BookCount[] = [...bookCounts].map(([key, count]) => ({ key, name: this.bookNames.get(key) ?? key, count }));
    if (query.book !== undefined && !bookCounts.has(query.book)) {
      books.push({ key: query.book, name: this.bookNames.get(query.book) ?? query.book, count: 0 });
    }
    books.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

    return { idle, rows, count: all.length, types, books };
  }

  /** What a screen shows for one element, or nothing when it is not loaded. */
  describe(id: ElementId): ElementDetail | undefined {
    const element = this.index.get(id);
    if (!element) return undefined;
    const bookKey = element.source.trim().toLowerCase();
    const offering = this.offeringSelects();
    const seen = new Set<string>();
    const offeredBy: OfferingSelect[] = [];
    for (const tag of element.supports) {
      for (const offer of offering.get(tag.toLowerCase()) ?? []) {
        const key = `${offer.ownerId}\n${offer.select}`;
        if (seen.has(key)) continue;
        seen.add(key);
        offeredBy.push({ ...offer, ownerName: this.index.get(offer.ownerId)?.name ?? offer.ownerId });
      }
    }
    offeredBy.sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.select.localeCompare(b.select));
    return {
      element,
      typeLabel: this.typeLabel(element.type),
      group: this.typeGroup(element.type),
      book: this.bookNames.get(bookKey) ?? element.source,
      sourceId: element.origin.sourceId,
      fileUrl: element.origin.fileUrl,
      offeredBy,
    };
  }

  private typeCount(type: ElementType, count: number): TypeCount {
    return { type, label: this.typeLabel(type), group: this.typeGroup(type), count };
  }

  private row(entry: Entry, matched: MatchedBy | undefined, words: string[]): BrowserRow {
    const { element } = entry;
    const row: BrowserRow = {
      id: element.id,
      name: element.name,
      type: element.type,
      typeLabel: this.typeLabel(element.type),
      book: this.bookNames.get(entry.bookKey) ?? element.source,
    };
    if (matched) row.matched = matched;
    // Only for the rows on the page: the excerpt is cut from text built again for this one element, which
    // is cheaper than holding a second, original-case copy of every description.
    if (matched === 'description' && element.description) {
      row.excerpt = excerpt(descriptionText(element.description), words);
    }
    return row;
  }

  private descriptionTexts(): string[] {
    this.text ??= this.entries.map((entry) =>
      entry.element.description ? normalize(descriptionText(entry.element.description)) : '',
    );
    return this.text;
  }

  /**
   * Every select whose filter is one plain tag, by that tag.
   *
   * This is how an inline list item says where it is offered (ADR 0053, decision 4): the importer gives each
   * one a tag scoped to its owner's select, and that select filters on exactly it. Read from the rules and
   * never from an id's shape, so it answers for any element and any format. A filter built any other way
   * (`and`, `or`, `$(…)`, a negation) names its candidates only once evaluated for a character, and is not
   * followed.
   */
  private offeringSelects(): Map<string, { ownerId: ElementId; select: string }[]> {
    if (this.offering) return this.offering;
    const found = new Map<string, { ownerId: ElementId; select: string }[]>();
    for (const { element } of this.entries) {
      for (const rule of element.rules) {
        if (rule.kind !== 'select' || rule.supports?.kind !== 'tag') continue;
        const tag = rule.supports.tag.trim().toLowerCase();
        if (!tag || tag.startsWith('!') || tag.includes('$(')) continue;
        const list = found.get(tag);
        const offer = { ownerId: element.id, select: rule.name };
        if (list) list.push(offer);
        else found.set(tag, [offer]);
      }
    }
    this.offering = found;
    return found;
  }
}

const MATCHED: MatchedBy[] = ['name', 'name', 'name', 'name', 'id', 'description'];

const GROUP_ORDER: Record<TypeGroup, number> = { browsable: 0, declared: 1, undeclared: 2 };

/**
 * The rank of one element for a query, or -1 when it does not match. See ADR 0053, decision 2:
 *
 * 0 the name is the query; 1 it starts with it; 2 a word in it starts with it; 3 it holds every word;
 * 4 the id starts with it; 5 the description holds every word.
 */
function rankOf(entry: Entry, phrase: string, words: string[], text: string | undefined): number {
  const name = entry.name;
  if (name === phrase) return 0;
  if (name.startsWith(phrase)) return 1;
  if (startsAWord(name, phrase)) return 2;
  if (words.every((word) => name.includes(word))) return 3;
  // An id has no spaces, so it is compared with what was typed, spaces and all.
  if (entry.id.startsWith(phrase)) return 4;
  if (text && words.every((word) => text.includes(word))) return 5;
  return -1;
}

/** Whether `phrase` occurs in `name` at the start of a word: after anything that is not a letter or digit. */
function startsAWord(name: string, phrase: string): boolean {
  for (let at = name.indexOf(phrase, 1); at > 0; at = name.indexOf(phrase, at + 1)) {
    if (!/[\p{L}\p{N}]/u.test(name[at - 1]!)) return true;
  }
  return false;
}

/** Lowercased, curly quotes made straight, and runs of whitespace one space. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * A description as plain text: tags removed, entities decoded, whitespace collapsed.
 *
 * For searching and for an excerpt, never for display — the pane shows the sanitized HTML. No DOM, so it runs
 * the same in Node and a phone. A tag becomes a space, so text a tag split still reads as words ("shield
 * master" is found in markup that wraps one word); the one entity the official corpus uses is `&amp;`, and the
 * others that can matter are decoded too, with numeric ones.
 */
export function descriptionText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** About this many characters either side of the first word found. */
const EXCERPT_REACH = 60;

/** The text around the first of `words` found in it, with an ellipsis where it was cut. */
export function excerpt(text: string, words: string[]): string {
  const lower = normalize(text);
  // Normalizing can change the length (a character whose lowercase is two code units); an offset into one
  // would then point elsewhere in the other, so such a text is cut from its start.
  const sameLength = lower.length === text.length;
  let at = -1;
  for (const word of words) {
    const found = lower.indexOf(word);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0 || !sameLength) at = 0;
  const start = Math.max(0, at - EXCERPT_REACH);
  const end = Math.min(text.length, at + EXCERPT_REACH * 2);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * A file's address as a path within the source it came from, when it sits under the source's index; the whole
 * address otherwise. "core/players-handbook/spells.xml" reads better than a raw host URL, and a file outside
 * the index's folder is shown in full rather than guessed at.
 */
export function fileWithinSource(fileUrl: string, indexUrl: string | undefined): string {
  if (!indexUrl) return fileUrl;
  const slash = Math.max(indexUrl.lastIndexOf('/'), indexUrl.lastIndexOf('\\'));
  const folder = indexUrl.slice(0, slash + 1);
  return folder && fileUrl.startsWith(folder) && fileUrl.length > folder.length ? fileUrl.slice(folder.length) : fileUrl;
}

/**
 * The catalog for an index, built once and kept while the index lives.
 *
 * A pane that unmounts when the user looks elsewhere would otherwise rebuild it on every visit. Keyed by the
 * index object, which a reload replaces, so a new load gets a new catalog and the old one goes with its index.
 */
const catalogs = new WeakMap<ElementIndex, { system: GameSystem; catalog: ContentCatalog }>();

export function contentCatalog(index: ElementIndex, system: GameSystem): ContentCatalog {
  const known = catalogs.get(index);
  if (known && known.system === system) return known.catalog;
  const catalog = new ContentCatalog(index, system);
  catalogs.set(index, { system, catalog });
  return catalog;
}
