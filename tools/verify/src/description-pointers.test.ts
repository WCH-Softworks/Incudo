/**
 * Descriptions that point at text somewhere else: "detailed under “Maneuvers” below", "see the table below", "the
 * options above". Found on the Battle Master's Combat Superiority, whose maneuvers are "detailed below" and are below
 * nothing on screen: in the book they follow the subclass, and in Aurora they are the options of the feature's own
 * `select` (`supports="Maneuver,Battle Master"`), which its app shows as the choice.
 *
 * Report-only (ADR 0042: a moving corpus fails only what must hold against any corpus, and nothing here must). For every
 * description, every sentence carrying a pointer is sorted by what it can be pointing at, from content alone:
 *
 * - its own text: a table, a list, a heading or a paragraph opening with a bold or italic run-in ("Mask. …") follows
 *   (below) or comes before (above) in the same description;
 * - an embed Incudo shows: an embedded element (ADR 0069) follows in the same description and resolves;
 * - an embed naming nothing: one follows and resolves to nothing;
 * - the embedder's text: "above" in an element another description embeds, whose own text has nothing before it;
 * - the options of its own select: the element carries a `select` that offers something;
 * - another element by name: a quoted name (“…”) that a loaded element is called;
 * - another book: "in the Monster Manual", "in chapter 5";
 * - nothing findable.
 *
 * A pointer with a direction (below, above) is checked in the order above; one without ("detailed at the end of the class
 * description", "see the Sacred Oath class feature") is not answered by what happens to follow it, so it goes straight
 * to a name, then its own select, then a book. A pointer is counted in the first that answers. Every sentence outside
 * the first two and "another book" is named with its element's name and book, so the categories can be read and argued
 * with. The sorting is a heuristic over prose: read the names, not only the counts.
 */

import { test } from 'node:test';

import { descriptionEmbeds, matchesSupports, type Element, type ElementIndex, type SelectRule } from '@incudo/core';
import { descriptionText } from '@incudo/ui';

import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

/**
 * A pointer: "below" or "above" after a word that makes it one ("the table below", "described above", "see below") or
 * before a full stop, colon or bracket; "under “…”"; "see “…”", "see the …" or "see below" opening a sentence or a bracket (never "you can see the …"); "detailed
 * at the end of", "described later". Numbers and heights are left out: "a slot level above 1st", "a score above 20",
 * "below half its hit points" never match, since a digit, "half", "all" or a noun follows them.
 */
const POINTER = new RegExp(
  [
    String.raw`\b(?:described|detailed|listed|shown|specified|given|presented|explained|outlined|mentioned|noted|see|table|tables|list|options?|benefits?|effects?|description|block|features?|choices|abilities|properties|rules|ones|those|following|traits?|section|entry|entries)\s+(?:below|above)\b`,
    String.raw`[”"]\s*(?:below|above)\b`,
    String.raw`\b(?:below|above)\s*[:)]`,
    String.raw`\bunder\s+[“"]`,
    String.raw`(?:\(\s*|^|[.;:]\s+)see\s+(?:[“"]|the\s|also\b|below|above|chapter|appendix|page|sidebar)`,
    String.raw`\b(?:detailed|described|explained|presented|listed)\s+(?:at the end of|later|after|here(?:in)?\b|in the [“"])`,
  ].join('|'),
  'gi',
);

/** Another book or a chapter of one: the reference is to print, not to anything in a file. */
const OTHER_BOOK =
  /\b(?:chapter|appendix|page|Player[’']s Handbook|Dungeon Master[’']s Guide|Monster Manual|Guide|Tome|Compendium|Handbook|Bestiary|Manual|Codex|Cauldron|Mordenkainen|Volo|Xanathar|Tasha|Fizban|Bigby|Sword Coast|Eberron|Ravnica|Theros|Wildemount|Strixhaven|Spelljammer|Planescape|Unearthed Arcana)\b/i;

const EMBED = /<div\b[^>]*\belement\s*=\s*["']([^"']*)["'][^>]*\/?>(?:\s*<\/div>)?/gi;

/** A marker the plain text keeps where structure was, so a pointer can be read against what follows or precedes it. */
function textWithMarkers(html: string): string {
  return descriptionText(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(EMBED, (_whole, id: string) => ` ⟦embed:${id}⟧ `)
      .replace(/<table\b/gi, ' ⟦table⟧ <table')
      .replace(/<(?:ul|ol)\b/gi, ' ⟦list⟧ <ul')
      .replace(/<h\d\b/gi, ' ⟦heading⟧ <h')
      .replace(/<p\b[^>]*>\s*<(?:strong|b|em|i)>/gi, (whole) => ` ⟦run-in⟧ ${whole}`),
  );
}

function sentenceAround(text: string, at: number, length: number): string {
  const start = Math.max(text.lastIndexOf('. ', at) + 1, text.lastIndexOf('⟧', at) + 1, 0);
  const endDot = text.indexOf('. ', at + length);
  const endMark = text.indexOf('⟦', at + length);
  const ends = [endDot >= 0 ? endDot + 1 : text.length, endMark >= 0 ? endMark : text.length];
  return text.slice(start, Math.min(...ends)).trim();
}

function quotedNames(sentence: string): string[] {
  return [...sentence.matchAll(/[“"]([^”"]{2,60})[”"]/g)].map((m) => m[1]!.trim());
}

function fold(name: string): string {
  return name.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}

function selectOffers(rule: SelectRule, elements: ElementIndex): number {
  return elements.byType(rule.type).filter((candidate) =>
    matchesSupports(rule.supports, {
      tags: new Set(candidate.supports.map((tag) => tag.toLowerCase())),
      setterValues: new Set(Object.values(candidate.setters).map((s) => s.value.toLowerCase())),
      id: candidate.id,
      resolve: () => undefined,
    }),
  ).length;
}

type Category =
  | 'its own text'
  | 'an embed Incudo shows'
  | 'an embed naming nothing'
  | "the embedder's text"
  | 'the options of its own select'
  | 'another element by name'
  | 'another book'
  | 'nothing findable';

interface Pointer {
  element: Element;
  sentence: string;
  category: Category;
  detail?: string;
}

function classify(
  element: Element,
  text: string,
  at: number,
  match: string,
  elements: ElementIndex,
  byName: Map<string, Element[]>,
  embedded: Set<string>,
): { category: Category; detail?: string } {
  const sentence = sentenceAround(text, at, match.length);
  const after = text.slice(at + match.length);
  const before = text.slice(0, at);
  // The direction is the sentence's: "(see the table below)" matches at "see the", and the table is below.
  const direction = /\b(below|above)\b/i.exec(sentence)?.[1]?.toLowerCase();
  const above = direction === 'above';
  const quoted = quotedNames(sentence);
  // "See the Sacred Oath class feature": a name written without quotes, before a word saying what it is.
  const unquoted = [...sentence.matchAll(/\bsee the ([^.,;()]{3,60}?)(?:'s)? (?:class feature|feature|class|spell|section|description)\b/gi)].map(
    (m) => m[1]!.trim(),
  );
  const byNames = (): { category: Category; detail?: string } | undefined => {
    const named = [...quoted, ...unquoted].flatMap((name) => byName.get(fold(name)) ?? []).filter((e) => e.id !== element.id);
    if (!named.length) return undefined;
    return {
      category: 'another element by name',
      detail: [...new Set(named.map((e) => `${e.name} (${e.type}, ${e.source || 'no book'})`))].slice(0, 3).join('; '),
    };
  };

  // "Detailed at the end of the class description", "see the Monster Manual": no direction, so what follows in the
  // description is not what it points at.
  if (!direction) return byNames() ?? ownSelect(element, elements) ?? other(sentence);

  // An embed that follows (or, for "above", comes before) the pointer.
  const near = above ? before : after;
  const embeds = [...near.matchAll(/⟦embed:([^⟧]+)⟧/g)].map((m) => m[1]!);
  if (embeds.length) {
    const missing = embeds.filter((id) => !elements.get(id));
    if (missing.length === embeds.length) return { category: 'an embed naming nothing', detail: missing.join(', ') };
    return { category: 'an embed Incudo shows' };
  }
  // A quoted name is a heading of its own: only a heading or run-in that opens with it answers, wherever it is in the
  // description (Blackrazor's "see “Devour Soul” below" is a run-in above it). Combat Superiority's "detailed under
  // “Maneuvers” below" is followed by "Superiority Dice." and "Saving Throws.", which are not it.
  const headsIn = (part: string): string[] =>
    [...part.matchAll(/⟦(?:heading|run-in)⟧\s*([^.:⟦]{1,80})/g)].map((m) => fold(m[1]!));
  // Not the run-in opening the pointer's own paragraph: Combat Superiority's sentence sits under "Maneuvers." itself.
  const opens = text.lastIndexOf('⟦', at);
  const closes = text.indexOf('⟦', at);
  const elsewhere = text.slice(0, Math.max(opens, 0)) + (closes >= 0 ? text.slice(closes) : '');
  const ownText = quoted.length
    ? quoted.some((name) => headsIn(elsewhere).some((head) => head.startsWith(fold(name))))
    : headsIn(near).length > 0 || /⟦(?:table|list)⟧/.test(near);
  if (ownText) {
    return { category: 'its own text' };
  }

  if (above && embedded.has(element.id)) return { category: "the embedder's text" };
  return ownSelect(element, elements) ?? byNames() ?? other(sentence);
}

function ownSelect(element: Element, elements: ElementIndex): { category: Category; detail: string } | undefined {
  const selects = element.rules.filter((r): r is SelectRule => r.kind === 'select');
  const offering = selects.map((rule) => ({ rule, offers: selectOffers(rule, elements) })).filter((s) => s.offers > 0);
  if (!offering.length) return undefined;
  return {
    category: 'the options of its own select',
    detail: offering.map((s) => `“${s.rule.name}”, ${s.offers} ${s.rule.type}`).join('; '),
  };
}

function other(sentence: string): { category: Category } {
  return { category: OTHER_BOOK.test(sentence) ? 'another book' : 'nothing findable' };
}

test('descriptions that point at text elsewhere, and what they can be pointing at', { skip: corpusSkip }, async (t) => {
  const elements = await realElements();
  t.diagnostic(corpusProvenance());
  const all = [...elements.all()];

  const byName = new Map<string, Element[]>();
  for (const e of all) {
    const key = fold(e.name);
    byName.set(key, [...(byName.get(key) ?? []), e]);
  }
  const embedded = new Set(all.flatMap((e) => descriptionEmbeds(e.description).map((embed) => embed.id)));

  const pointers: Pointer[] = [];
  for (const element of all) {
    if (!element.description) continue;
    const text = textWithMarkers(element.description);
    const seen = new Set<string>();
    for (const m of text.matchAll(POINTER)) {
      const sentence = sentenceAround(text, m.index!, m[0].length);
      if (seen.has(sentence)) continue;
      seen.add(sentence);
      pointers.push({ element, sentence, ...classify(element, text, m.index!, m[0], elements, byName, embedded) });
    }
  }

  const order: Category[] = [
    'its own text',
    'an embed Incudo shows',
    'an embed naming nothing',
    "the embedder's text",
    'the options of its own select',
    'another element by name',
    'another book',
    'nothing findable',
  ];
  t.diagnostic(
    `pointers: ${pointers.length}, in ${new Set(pointers.map((p) => p.element.id)).size} descriptions; ${order
      .map((c) => `${c}: ${pointers.filter((p) => p.category === c).length}`)
      .join('; ')}`,
  );

  const named: Category[] = [
    "the embedder's text",
    'an embed naming nothing',
    'the options of its own select',
    'another element by name',
    'nothing findable',
  ];
  for (const category of named) {
    const rows = pointers
      .filter((p) => p.category === category)
      .sort((a, b) => a.element.source.localeCompare(b.element.source) || a.element.name.localeCompare(b.element.name));
    t.diagnostic(`— ${category}: ${rows.length}`);
    for (const row of rows) {
      const sentence = row.sentence.length > 180 ? `${row.sentence.slice(0, 177)}…` : row.sentence;
      t.diagnostic(
        `${row.element.name} (${row.element.type}, ${row.element.source || 'no book'})${row.detail ? ` → ${row.detail}` : ''}: ${sentence}`,
      );
    }
  }
});
