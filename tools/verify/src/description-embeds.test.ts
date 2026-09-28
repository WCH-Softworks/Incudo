/**
 * What an element's description embeds, and what showing and saving it would stand on.
 *
 * Aurora writes `<div element="ID_…" />` inside a description where another element's text belongs: a summoning
 * spell's creature, a subclass's features, a scroll's stat block. ADR 0068 found every prose stat block embedded this
 * way and Incudo showing nothing there. This measures, from content alone, what the embeds are before anything is
 * decided about them.
 *
 * What is reported and not asserted (ADR 0042: a moving corpus fails only what must hold against any corpus): how many
 * markers there are, in what shape, how many content switched off inside a comment; how many embeds, by the embedding
 * and the embedded element's type; how many resolve; how deep they nest and whether any is circular; how an embedded
 * description opens (with its own name or not) and whether the embedder writes a heading for it.
 */

import { test } from 'node:test';

import type { Element, ElementIndex } from '@incudo/core';

import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

/** Every embedding marker in a description, whatever its spacing or quotes: the shape is measured, not assumed. */
const ANY_EMBED = /<div\b[^>]*\belement\s*=\s*["']([^"']*)["'][^>]*>/g;
/** The one shape the corpus writes: empty, self-closing, double-quoted, no other attribute. */
const PLAIN_EMBED = /^<div element="[^"]+"\s*\/>$/;

/** The embeds of a description: every marker outside a comment, since a commented-out one is switched off. */
function embedsOf(element: Element): string[] {
  const live = (element.description ?? '').replace(/<!--[\s\S]*?-->/g, '');
  return [...live.matchAll(ANY_EMBED)].map((m) => m[1]!).filter((id) => id.trim());
}

function tally(values: string[], limit = 12): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, limit).map(([v, n]) => `${n} ${v}`);
  if (sorted.length > limit) shown.push(`${sorted.length - limit} more`);
  return shown.join(', ') || 'none';
}

/** How deep an element's embeds go (0 for none), and the cycles found on the way, each as the ids around it. */
function depthOf(
  id: string,
  elements: ElementIndex,
  path: string[],
  memo: Map<string, number>,
  cycles: string[][],
): number {
  const known = memo.get(id);
  if (known !== undefined) return known;
  const element = elements.get(id);
  if (!element) return 0;
  let deepest = 0;
  for (const child of embedsOf(element)) {
    const at = path.indexOf(child);
    if (at >= 0 || child === id) {
      cycles.push([...path.slice(at >= 0 ? at : path.length), id, child]);
      continue;
    }
    deepest = Math.max(deepest, 1 + depthOf(child, elements, [...path, id], memo, cycles));
  }
  memo.set(id, deepest);
  return deepest;
}

/** How a description opens: a heading naming the element, an empty heading, another heading, or no heading. */
function opening(element: Element): string {
  const text = (element.description ?? '').trimStart();
  if (/^<h\d[^>]*\/>/.test(text)) return 'an empty heading';
  const heading = /^<h\d[^>]*>([\s\S]*?)<\/h\d>/.exec(text);
  if (!heading) return 'no heading';
  const inner = heading[1]!.replace(/<[^>]+>/g, '').trim().toLowerCase();
  return inner === element.name.trim().toLowerCase() ? 'a heading with its own name' : 'another heading';
}

test('what descriptions embed, read from content alone', { skip: corpusSkip }, async (t) => {
  const elements = await realElements();
  t.diagnostic(corpusProvenance());
  const all = [...elements.all()];

  const markers = all.flatMap((e) => [...(e.description ?? '').matchAll(ANY_EMBED)].map((m) => m[0]));
  const commented = all.flatMap((e) => [...(e.description ?? '').matchAll(/<!--[\s\S]*?-->/g)].flatMap((c) => [...c[0].matchAll(ANY_EMBED)]));
  t.diagnostic(`markers inside a comment, which content switched off and are not embeds: ${commented.length}`);
  const embedding = all.filter((e) => embedsOf(e).length > 0);
  const pairs = embedding.flatMap((by) => embedsOf(by).map((id) => ({ by, id, target: elements.get(id) })));
  t.diagnostic(`embeds: ${pairs.length}, in ${embedding.length} descriptions, of ${new Set(pairs.map((p) => p.id)).size} distinct ids`);
  t.diagnostic(
    `in the plain shape <div element="…" />: ${markers.filter((m) => PLAIN_EMBED.test(m)).length}; any other: ${
      markers.filter((m) => !PLAIN_EMBED.test(m)).length
    }`,
  );
  t.diagnostic(`embedding types: ${tally(pairs.map((p) => p.by.type))}`);

  const resolved = pairs.filter((p) => p.target);
  const unresolved = pairs.filter((p) => !p.target);
  t.diagnostic(`resolve: ${resolved.length}; do not: ${unresolved.length} (${tally(unresolved.map((p) => p.id), 8)})`);
  t.diagnostic(`embedded types: ${tally(resolved.map((p) => p.target!.type))}`);
  const selfOrSame = resolved.filter((p) => p.target!.id === p.by.id);
  t.diagnostic(`embedding itself: ${selfOrSame.length}`);

  // Nesting and cycles, from every embedding element.
  const memo = new Map<string, number>();
  const cycles: string[][] = [];
  const depths = embedding.map((e) => depthOf(e.id, elements, [], memo, cycles));
  t.diagnostic(`nesting depth from an embedding description: ${tally(depths.map(String))}; deepest ${Math.max(0, ...depths)}`);
  const distinctCycles = new Set(cycles.map((c) => [...new Set(c)].sort().join(' → ')));
  t.diagnostic(`circular embeds: ${distinctCycles.size}${distinctCycles.size ? ` (${[...distinctCycles].slice(0, 5).join('; ')})` : ''}`);

  // What an embedded element is beyond its text.
  const targets = [...new Map(resolved.map((p) => [p.target!.id, p.target!])).values()];
  t.diagnostic(`embedded descriptions open with: ${tally(targets.map(opening))}`);
  t.diagnostic(`embedded elements with no description: ${targets.filter((e) => !(e.description ?? '').trim()).length}`);
  t.diagnostic(`embedded elements carrying rules: ${targets.filter((e) => e.rules.length > 0).length} of ${targets.length}`);
  const wrapped = all.flatMap((e) => [...(e.description ?? '').matchAll(/<div class="([^"]+)">\s*<div element=/g)].map((m) => m[1]!));
  t.diagnostic(`embeds directly inside a <div class>: ${tally(wrapped)}`);
  const afterHeading = all.flatMap((e) => [...(e.description ?? '').matchAll(/<\/h\d>\s*(?:<div[^>]*>\s*)?<div element=/g)]);
  t.diagnostic(`embeds right after a heading the embedder wrote: ${afterHeading.length}`);
});
