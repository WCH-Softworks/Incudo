/**
 * An element's description with what it embeds put in place — ADR 0069.
 *
 * Content writes `<div element="ID_…" />` where another element's text belongs: a subclass lists its features that
 * way, a summoning spell its creature's stat block, a scroll the creature it calls. The marker carries no text, and
 * the embedder writes no heading for it (`tools/verify`'s `description-embeds.test.ts`: every one of the corpus's
 * embedded descriptions opens without its own name), so an embed is shown as the embedded element's name as a heading
 * and its description, its own embeds put in place the same way.
 *
 * Everything that decides what an embed shows is here, under `node --test`; `packages/core`'s `descriptionEmbeds` is
 * the one reader of the marker, and the shell sanitizes what this returns and computes nothing. The result is HTML as
 * content wrote it plus a few tags of this module's, **not yet safe to render**: everything in it, the embedded text
 * included, goes through the shell's sanitizer.
 *
 * What an embed shows when it cannot show its text, each a sentence in place of the marker:
 * - naming nothing in `elements`: says so, with the id, which is all that is known of it;
 * - naming an element already being shown on the way to it (a circle, none in the corpus): says it is shown above;
 * - deeper than `MAX_EMBED_DEPTH` (the corpus nests two deep): says so, rather than growing without bound.
 */

import { descriptionEmbeds, type Element, type ElementId, type ElementIndex } from '@incudo/core';

/** How many embeds deep a description is expanded. The corpus nests two. */
export const MAX_EMBED_DEPTH = 4;

/**
 * `element`'s description with each embed replaced by the embedded element's name and text, looked up in `elements`
 * (the index the caller shows content from: everything loaded for Browse, the character's view for a picker or a kept
 * reference). Empty when the element has no description.
 */
export function expandDescription(element: Pick<Element, 'id' | 'description'>, elements: ElementIndex): string {
  return expand(element.description ?? '', elements, [element.id]);
}

function expand(description: string, elements: ElementIndex, path: ElementId[]): string {
  const embeds = descriptionEmbeds(description);
  if (!embeds.length) return description;
  let out = '';
  let at = 0;
  for (const embed of embeds) {
    out += description.slice(at, embed.start);
    at = embed.end;
    out += shown(embed.id, embed.selfClosing, elements, path);
  }
  return out + description.slice(at);
}

/** What stands in place of one marker. A marker that does not close itself keeps its own `</div>` as the partner. */
function shown(id: ElementId, selfClosing: boolean, elements: ElementIndex, path: ElementId[]): string {
  const close = selfClosing ? '</div>' : '';
  const target = elements.get(id);
  if (!target) return note(`${id}: not in the loaded content, so its text is not shown here.`) + (selfClosing ? '' : '<div>');
  const heading = `<h5>${escapeHtml(target.name)}</h5>`;
  if (path.includes(id)) return `<div>${heading}${note('Already shown above.')}${close}`;
  if (path.length > MAX_EMBED_DEPTH) return `<div>${heading}${note('Nested too deeply to show here.')}${close}`;
  return `<div>${heading}${expand(target.description ?? '', elements, [...path, id])}${close}`;
}

function note(text: string): string {
  return `<p><em>${escapeHtml(text)}</em></p>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The HTML elements that never have content, where `<br />` means what it says. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/**
 * A description with every empty element that is not a void one written open and closed: `<h4 />` as `<h4></h4>`.
 *
 * A description is a fragment of an XML file, where `<h4 style="…" />` is an empty heading. An HTML parser ignores the
 * slash on anything but a void element and leaves the heading open, so everything after it lands inside it: every one
 * of the corpus's 63 prose stat blocks opens that way and rendered as one bold heading, and a table's `<td colspan="2"
 * />` swallowed the cell after it. The shell runs this before it parses a description to sanitize it.
 */
export function openSelfClosingTags(html: string): string {
  return html.replace(/<([a-zA-Z][a-zA-Z0-9-]*)(\s[^<>]*?)?\s*\/>/g, (whole, tag: string, attributes: string | undefined) =>
    VOID_ELEMENTS.has(tag.toLowerCase()) ? whole : `<${tag}${attributes ?? ''}></${tag}>`,
  );
}
