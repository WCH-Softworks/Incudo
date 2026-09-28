/**
 * What a description embeds — ADR 0069.
 *
 * Content writes `<div element="ID_…" />` inside a description where another element's text belongs: a subclass's
 * features, a summoning spell's creature, a scroll's stat block. That marker is a reference to an element, like a
 * grant is, and this is the one place that reads it: `collectCharacterContent` follows it so a save carries the text
 * it points at (ADR 0012), and `packages/ui`'s `expandDescription` puts the text in place for the shell to show.
 *
 * Nothing here renders HTML or decides what an embed looks like. It finds the marker and says where it is and what it
 * names. The marker is read where a description is used, never when content is parsed: a `.incu` embeds parsed
 * elements, and a field filled at parse time would be empty on every save written before it (the lesson of ADR 0046
 * and ADR 0048).
 */

import type { Element, ElementId } from './model.ts';

/** One embedding marker in a description. */
export interface DescriptionEmbed {
  /** The element it names. */
  id: ElementId;
  /** Where the marker's opening tag starts, and where it ends (exclusive), in the description. */
  start: number;
  end: number;
  /**
   * Whether the tag closes itself (`<div element="…" />`), which is every one of the corpus's. One that does not is
   * followed by its own content and `</div>`, and whoever splices text in its place must leave that closing tag a
   * partner.
   */
  selfClosing: boolean;
}

/**
 * A `div` with an `element` attribute, whatever else it carries, in either quote. The corpus writes one shape
 * (`tools/verify`'s `description-embeds.test.ts` measures it), and reading any attribute order costs nothing.
 */
const EMBED = /<div\b[^<>]*?\selement\s*=\s*(?:"([^"]*)"|'([^']*)')[^<>]*?(\/?)>/gi;

/** An XML comment, which content uses to switch an embed off (`<!-- <div element="…" /> -->`, once in the corpus). */
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;

/**
 * Every embedding marker in a description, in the order written. An empty id is not a marker, and neither is one inside
 * a comment: that is an embed content switched off, and a renderer drops the comment whole.
 */
export function descriptionEmbeds(description: string | undefined): DescriptionEmbed[] {
  if (!description) return [];
  const comments = [...description.matchAll(COMMENT)].map((m) => [m.index, m.index + m[0].length] as const);
  const out: DescriptionEmbed[] = [];
  for (const match of description.matchAll(EMBED)) {
    const id = (match[1] ?? match[2] ?? '').trim();
    if (!id) continue;
    if (comments.some(([from, to]) => match.index >= from && match.index < to)) continue;
    out.push({ id, start: match.index, end: match.index + match[0].length, selfClosing: match[3] === '/' });
  }
  return out;
}

/** The ids an element's description embeds, each once, in the order first written. */
export function embeddedElementIds(element: Pick<Element, 'description'>): ElementId[] {
  return [...new Set(descriptionEmbeds(element.description).map((embed) => embed.id))];
}
