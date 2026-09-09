/**
 * A small XML reader.
 *
 * `core`, `content` and this package aim for zero runtime dependencies so the engine
 * keeps working on whatever runtime this project targets in five years
 * (docs/CODE-REUSE-POLICY.md, rule 4). Aurora's XML is a narrow dialect — elements,
 * attributes, text, CDATA, comments — so a full parser would be mostly unused surface.
 *
 * This handles that dialect and nothing more. It is *not* a general XML parser:
 * no namespaces, no DTDs, no entity declarations. If content in the wild breaks it,
 * the fix is to widen this file, not to reach for a dependency without an ADR.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated direct text content. */
  text: string;
  /** Raw inner source, kept because Aurora descriptions are HTML we pass through. */
  innerXml: string;
}

const VOID_SELF_CLOSING = /\/$/;

export function parseXml(source: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '', innerXml: source };
  const stack: XmlNode[] = [root];
  const contentStart = new Map<XmlNode, number>();

  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      appendText(stack[stack.length - 1]!, source.slice(i));
      break;
    }
    if (lt > i) appendText(stack[stack.length - 1]!, source.slice(i, lt));

    // Comments, declarations, CDATA
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt);
      const body = source.slice(lt + 9, end === -1 ? source.length : end);
      appendText(stack[stack.length - 1]!, body);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<?', lt) || source.startsWith('<!', lt)) {
      const end = source.indexOf('>', lt);
      i = end === -1 ? source.length : end + 1;
      continue;
    }

    const gt = findTagEnd(source, lt);
    if (gt === -1) break;
    const raw = source.slice(lt + 1, gt);

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      // Close up to and including the matching open tag; tolerate unclosed inline HTML.
      for (let depth = stack.length - 1; depth > 0; depth--) {
        const node = stack[depth]!;
        if (node.name === name) {
          const start = contentStart.get(node);
          if (start !== undefined) node.innerXml = source.slice(start, lt);
          stack.length = depth;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    const selfClosing = VOID_SELF_CLOSING.test(raw.trimEnd());
    const body = selfClosing ? raw.trimEnd().slice(0, -1) : raw;
    const node = parseTag(body);
    stack[stack.length - 1]!.children.push(node);
    if (!selfClosing) {
      stack.push(node);
      contentStart.set(node, gt + 1);
    }
    i = gt + 1;
  }

  return root;
}

/** Find the '>' that closes a tag, skipping any inside quoted attribute values. */
function findTagEnd(source: string, from: number): number {
  let quote: string | null = null;
  for (let i = from + 1; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

function parseTag(body: string): XmlNode {
  const match = /^([^\s/>]+)/.exec(body.trim());
  const name = match ? match[1]! : '';
  const attrs: Record<string, string> = {};
  const attrRe = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(body))) {
    attrs[m[1]!] = decodeEntities(m[3] ?? m[4] ?? '');
  }
  return { name, attrs, children: [], text: '', innerXml: '' };
}

function appendText(node: XmlNode, text: string): void {
  node.text += decodeEntities(text);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

// --- small helpers used by the two parsers -------------------------------------------

export function childrenNamed(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}

export function firstChild(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name);
}

/** Depth-first search for the first node with the given tag name. */
export function findFirst(node: XmlNode, name: string): XmlNode | undefined {
  for (const child of node.children) {
    if (child.name === name) return child;
    const nested = findFirst(child, name);
    if (nested) return nested;
  }
  return undefined;
}
