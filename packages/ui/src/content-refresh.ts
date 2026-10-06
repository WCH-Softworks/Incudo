/**
 * "Your sources have changed…": comparing what the open character carries with what its sources load, showing the sheet
 * a refresh would make, and making it — ADR 0082.
 *
 * A character opens from the copies of the elements it embeds (ADR 0012), in front of whatever its sources load. When a
 * source has changed an element since (a rule fixed, a grant added), the character keeps its copy, which is right until
 * the user asks for the change. The recorded source version says nothing about it (AuroraLegacy's index has been 0.0.1
 * since 2023), so the copies are compared with the loaded definitions themselves, id by id.
 *
 * Nothing here touches the shell's state: `contentChanges` says whether to offer, `refreshDocuments` and `refreshReview`
 * say what a refresh would change on the Sheet, and `refreshedElements` is the content the shell then puts in place of
 * the copies. A refresh is all or nothing, keeps every copy the sources no longer define, and changes no choice.
 */

import { BundleElementIndex, LayeredElementIndex, type Character, type Element, type ElementIndex, type GameSystem } from '@incudo/core';

import { listedName, rowAside, sheetDocument, type SheetDocument } from './sheet-document.ts';
import { CharacterBuilder } from './use-character-builder.ts';

/** The copies that differ from what the sources load, and those the sources no longer define. */
export interface ContentChanges {
  changed: Element[];
  kept: Element[];
}

/** A definition as two sources' are compared (ADR 0054): all of it, where it came from left out. */
function comparable(element: Element): string {
  return JSON.stringify({ ...element, origin: undefined });
}

/** The open character's copies against the loaded content. Only `changed` is news: a refresh changes nothing else. */
export function contentChanges(embedded: ElementIndex, loaded: ElementIndex): ContentChanges {
  const changed: Element[] = [];
  const kept: Element[] = [];
  for (const copy of embedded.all()) {
    const now = loaded.get(copy.id);
    if (!now) kept.push(copy);
    else if (comparable(now) !== comparable(copy)) changed.push(copy);
  }
  return { changed, kept };
}

/** The content a refresh leaves the character carrying: every loaded definition of a copy's id, and every other copy. */
export function refreshedElements(embedded: ElementIndex, loaded: ElementIndex): Element[] {
  return [...embedded.all()].map((copy) => loaded.get(copy.id) ?? copy);
}

/** The line that offers the review, or nothing when there is nothing to refresh. */
export function refreshNotice(changes: ContentChanges): string | undefined {
  const n = changes.changed.length;
  if (n === 0) return undefined;
  return `Your sources have changed ${n === 1 ? 'one of the elements' : `${n} of the elements`} this character was saved with.`;
}

/** The Sheet as the character opens now, and as it would after a refresh. */
export function refreshDocuments(
  character: Character,
  system: GameSystem,
  embedded: ElementIndex,
  loaded: ElementIndex,
): { before: SheetDocument; after: SheetDocument } {
  const sheet = (index: ElementIndex) => sheetDocument(new CharacterBuilder(character, system, index).getState());
  return {
    before: sheet(new LayeredElementIndex([embedded, loaded])),
    after: sheet(new LayeredElementIndex([new BundleElementIndex(refreshedElements(embedded, loaded)), loaded])),
  };
}

export interface RefreshReview {
  heading: string;
  lede: string;
  /** Names of the elements whose definitions a refresh takes up. */
  changed: string[];
  /** Names of the elements the sources no longer define, which a refresh keeps as saved. */
  kept: string[];
  /** Rows whose value would change, by section: "Armor Class: 15 → 16". */
  rows: Array<{ section: string; label: string; before: string; after: string }>;
  /** Elements a section would list or stop listing. */
  listed: Array<{ section: string; name: string; change: 'added' | 'removed' }>;
  /** Said when the Sheet would read the same. */
  sameSheet?: string;
  refresh: string;
  notNow: string;
}

const value = (row: { value: string; beside?: string; mark?: { label: string; count: number }; including?: string[] }): string => {
  const aside = rowAside(row);
  return aside ? `${row.value} (${aside})` : row.value;
};

/** What a refresh would change, in the Sheet's own words. */
export function refreshReview(before: SheetDocument, after: SheetDocument, changes: ContentChanges): RefreshReview {
  const byName = (elements: Element[]) => [...new Set(elements.map((e) => e.name))].sort((a, b) => a.localeCompare(b));
  const rows: RefreshReview['rows'] = [];
  const listed: RefreshReview['listed'] = [];
  const ids = [...new Set([...before.sections, ...after.sections].map((s) => s.id))];
  for (const id of ids) {
    const was = before.sections.find((s) => s.id === id);
    const will = after.sections.find((s) => s.id === id);
    const label = (will ?? was)!.label;
    const stats = [...new Set([...(was?.rows ?? []), ...(will?.rows ?? [])].map((r) => r.stat))];
    for (const stat of stats) {
      const a = was?.rows.find((r) => r.stat === stat);
      const b = will?.rows.find((r) => r.stat === stat);
      const from = a ? value(a) : '—';
      const to = b ? value(b) : '—';
      if (from !== to) rows.push({ section: label, label: (b ?? a)!.label, before: from, after: to });
    }
    const named = (s: typeof was) => new Map((s?.elements ?? []).map((e) => [e.elementId, listedName(e)]));
    const a = named(was);
    const b = named(will);
    for (const [elementId, name] of b) if (!a.has(elementId)) listed.push({ section: label, name, change: 'added' });
    for (const [elementId, name] of a) if (!b.has(elementId)) listed.push({ section: label, name, change: 'removed' });
  }
  return {
    heading: 'Content updates',
    lede:
      "This character carries its own copy of everything it uses, and your sources now define some of it differently. Refreshing takes up your sources' versions; the character's choices stay as they are. Nothing is written to its file until you save it.",
    changed: byName(changes.changed),
    kept: byName(changes.kept),
    rows,
    listed,
    ...(rows.length === 0 && listed.length === 0 ? { sameSheet: 'The Sheet would read the same; only the elements\' own text or rules change.' } : {}),
    refresh: 'Refresh',
    notNow: 'Not now',
  };
}
