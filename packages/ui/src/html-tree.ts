/**
 * The tolerant reader of a kept text's HTML that `html-markdown.ts` and `html-blocks.ts` share — ADR 0075, ADR 0083.
 *
 * Written for the markup the corpus uses, not for HTML at large (`html-markdown.ts` says what was measured). A shell
 * with a DOM shows content's HTML through its own sanitizer; a renderer with none (a text export, a phone) reads it
 * through this, so what counts as a block, what is dropped with its contents and how entities decode is decided once.
 */

// --- reading ----------------------------------------------------------------------------------------------------

export interface ElementNode {
  tag: string;
  attributes: string;
  children: Node[];
}
export type Node = ElementNode | string;

/** Elements that never have content. */
export const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** Removed with their contents, as the shell's sanitizer removes them: none of them holds prose. */
export const DROPPED = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'svg', 'math']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/**
 * The markup as a tree. Tolerant: a closing tag with no open partner is ignored, one that closes an outer element
 * closes what is inside it, and whatever is open at the end is closed there. Comments are dropped.
 */
export function parse(html: string): ElementNode {
  const root: ElementNode = { tag: '', attributes: '', children: [] };
  const stack: ElementNode[] = [root];
  const token = /<!--[\s\S]*?(?:-->|$)|<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^<>]*?)?)(\/?)>|[^<]+|</g;
  for (const match of html.matchAll(token)) {
    const [whole, closing, opening, attributes, selfClosing] = match;
    const top = stack[stack.length - 1]!;
    if (whole.startsWith('<!--')) continue;
    if (closing !== undefined) {
      const tag = closing.toLowerCase();
      let at = stack.length - 1;
      while (at > 0 && stack[at]!.tag !== tag) at--;
      if (at > 0) stack.length = at;
    } else if (opening !== undefined) {
      const node: ElementNode = { tag: opening.toLowerCase(), attributes: attributes ?? '', children: [] };
      top.children.push(node);
      if (!VOID.has(node.tag) && !selfClosing) stack.push(node);
    } else {
      top.children.push(decodeEntities(whole));
    }
  }
  return root;
}

export function attribute(node: ElementNode, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(node.attributes);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? '') : undefined;
}

// --- blocks and inline ----------------------------------------------------------------------------------------

export const BLOCKS = new Set([
  'p', 'div', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'td', 'th', 'hr', 'section', 'article', 'header', 'footer', 'dl', 'dt', 'dd', 'pre',
]);

/** Whether a node is or holds a block, so a run of inline nodes around it is its own paragraph. */
export function isBlock(node: Node): boolean {
  return typeof node !== 'string' && (BLOCKS.has(node.tag) || (!DROPPED.has(node.tag) && !INLINE.has(node.tag) && node.children.some(isBlock)));
}

export const INLINE = new Set(['b', 'strong', 'i', 'em', 'a', 'br', 'span', 'u', 'small', 'sub', 'sup', 'font', 'code', 'img']);
