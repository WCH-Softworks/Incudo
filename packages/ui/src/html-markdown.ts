/**
 * A kept text's HTML, read into Markdown that reads as plain text — ADR 0075.
 *
 * A description is HTML as content wrote it, and the only thing that turns it into something shown is the shell's
 * sanitizer, which needs a DOM and cannot run here. A text export needs it as text. This is a small, tolerant reader of
 * the markup the corpus uses (measured by `tools/verify`'s `sheet-export.test.ts`: fifteen tags, every one on the
 * sanitizer's allowlist), written for what it measured rather than for HTML at large:
 *
 * - paragraphs, `div`s and headings are blocks, a blank line apart; a heading with no text is dropped (the corpus has a
 *   hundred, written `<h4 style="…" />`), and one with text sits under the caller's own heading, from `headingLevel`;
 * - lists are `- ` and `1. ` items, a list inside an item indented under it;
 * - a table is a pipe table whose first row is its header, as GFM requires, whether content wrote it as a `thead`, as
 *   `th`s or as the 2024 stat block's ability grid (whose first row is labels); a cell spanning columns is followed by
 *   empty ones, so every row has the table's width;
 * - `b`/`strong` and `i`/`em` are `**` and `*`, `a` a link when it points at http(s), `br` a hard line break;
 * - anything else is unwrapped, its text kept, as the sanitizer unwraps it, and the sanitizer's removed tags (`script`,
 *   `style`, …) go with their contents.
 *
 * It writes no HTML. Every `<` in the text is escaped, so a Markdown reader that renders raw HTML is never handed what
 * content wrote; everything else Markdown would misread is escaped too (`escapeMarkdown`), and nothing else is, so the
 * file still reads as text.
 */

import { openSelfClosingTags } from './description.ts';
import { attribute, BLOCKS, DROPPED, isBlock, parse, type ElementNode, type Node } from './html-tree.ts';

export interface HtmlMarkdownOptions {
  /** The level content's own headings start from: an `h1` to an `h4` are written at it, an `h5` and `h6` below it. */
  headingLevel?: number;
}

/** A kept text as Markdown blocks, a blank line apart, with no trailing newline. Empty when it has no text. */
export function htmlToMarkdown(html: string, options: HtmlMarkdownOptions = {}): string {
  const root = parse(openSelfClosingTags(html));
  const out: string[] = [];
  writeBlocks(root.children, out, { headingLevel: options.headingLevel ?? 4 });
  return out.join('\n\n');
}

// --- escaping ----------------------------------------------------------------------------------------------------

/**
 * Text as Markdown that means the text: a backslash, a backtick, `*`, `_` and `<` always, `&` where it would spell an
 * entity, and `]` where a link or a definition would follow it. Line starts are `escapeLineStart`'s.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_<]/g, (c) => `\\${c}`)
    .replace(/&(?=#?[a-zA-Z0-9]+;)/g, '\\&')
    .replace(/\](?=[([:])/g, '\\]');
}

/** A line that would begin a heading, a quote, a list, a rule or a table as text: its first character escaped. */
export function escapeLineStart(line: string): string {
  const numbered = /^(\s*\d+)([.)])(\s|$)/.exec(line);
  if (numbered) return `${numbered[1]}\\${numbered[2]}${line.slice(numbered[1]!.length + 1)}`;
  return /^\s*[#>+=|~-]/.test(line) ? line.replace(/^(\s*)/, '$1\\') : line;
}

// --- writing ----------------------------------------------------------------------------------------------------

interface Context {
  headingLevel: number;
}

/** Writes `nodes` as blocks: runs of inline content become paragraphs, block elements their own blocks. */
function writeBlocks(nodes: readonly Node[], out: string[], context: Context): void {
  let run: Node[] = [];
  const flush = (): void => {
    const text = paragraph(inline(run));
    if (text) out.push(text);
    run = [];
  };
  for (const node of nodes) {
    if (typeof node === 'string' || !isBlock(node)) {
      if (typeof node !== 'string' && DROPPED.has(node.tag)) continue;
      run.push(node);
      continue;
    }
    flush();
    writeBlock(node, out, context);
  }
  flush();
}

function writeBlock(node: ElementNode, out: string[], context: Context): void {
  const heading = /^h([1-6])$/.exec(node.tag);
  if (heading) {
    const text = collapse(inline(node.children));
    const level = Math.min(6, Math.max(context.headingLevel, Number(heading[1])));
    if (text) out.push(`${'#'.repeat(level)} ${text}`);
    return;
  }
  switch (node.tag) {
    case 'ul':
    case 'ol': {
      const items = listLines(node, '');
      if (items.length) out.push(items.join('\n'));
      return;
    }
    case 'table': {
      const table = tableLines(node);
      if (table.length) out.push(table.join('\n'));
      return;
    }
    case 'hr':
      out.push('---');
      return;
    case 'blockquote': {
      const inner: string[] = [];
      writeBlocks(node.children, inner, context);
      if (inner.length) out.push(inner.join('\n\n').split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n'));
      return;
    }
    default:
      writeBlocks(node.children, out, context);
  }
}

/** A list's items, each `- ` or `1. `, a list inside an item indented under it. */
function listLines(list: ElementNode, indent: string): string[] {
  const lines: string[] = [];
  let number = 1;
  for (const child of list.children) {
    if (typeof child === 'string' || child.tag !== 'li') {
      // Text or a stray element between items: an item of its own when it has any text.
      const text = collapse(inline(typeof child === 'string' ? [child] : child.children));
      if (text) lines.push(`${indent}- ${escapeLineStart(text)}`);
      continue;
    }
    const marker = list.tag === 'ol' ? `${number++}. ` : '- ';
    const nested = child.children.filter((n): n is ElementNode => typeof n !== 'string' && (n.tag === 'ul' || n.tag === 'ol'));
    const rest = child.children.filter((n) => !nested.includes(n as ElementNode));
    const text = collapse(inline(rest));
    lines.push(`${indent}${marker}${escapeLineStart(text)}`.trimEnd());
    for (const inner of nested) lines.push(...listLines(inner, `${indent}${' '.repeat(marker.length)}`));
  }
  return lines;
}

/** A table as a pipe table: its first row the header, every row as wide as the widest once spans are counted. */
function tableLines(table: ElementNode): string[] {
  const rows: string[][] = [];
  const collect = (node: ElementNode): void => {
    for (const child of node.children) {
      if (typeof child === 'string') continue;
      if (child.tag === 'tr') {
        const cells: string[] = [];
        for (const cell of child.children) {
          if (typeof cell === 'string' || (cell.tag !== 'td' && cell.tag !== 'th')) continue;
          cells.push(collapse(inline(cell.children)).replace(/\|/g, '\\|'));
          const span = Number(attribute(cell, 'colspan') ?? 1);
          for (let extra = 1; extra < (Number.isInteger(span) && span > 1 ? Math.min(span, 100) : 1); extra++) cells.push('');
        }
        rows.push(cells);
      } else if (child.tag !== 'table') {
        collect(child);
      }
    }
  };
  collect(table);
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (!width) return [];
  const line = (cells: string[]): string =>
    `|${Array.from({ length: width }, (_, at) => (cells[at] ? ` ${cells[at]} ` : ' ')).join('|')}|`;
  return [line(rows[0]!), `|${Array.from({ length: width }, () => ' --- ').join('|')}|`, ...rows.slice(1).map(line)];
}

/** A paragraph's text: whitespace collapsed on each line, and a first line that would read as markup escaped. */
function paragraph(text: string): string {
  const kept = text
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v]+/g, ' ').trim())
    .join('\n')
    // A hard break is a line ending in a backslash: one with nothing before or after it breaks nothing, and two in a
    // row are one.
    .replace(/\\\n(?:\s*\\\n)+/g, '\\\n')
    .replace(/^(?:\s*\\\n)+/, '')
    .replace(/(?:\\\n\s*)+$/, '')
    .trim();
  return kept ? kept.split('\n').map(escapeLineStart).join('\n') : '';
}

/** Inline text on one line: a hard break becomes a space. */
function collapse(text: string): string {
  return text.replace(/\\\n/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Inline nodes as Markdown text. A block met inside inline content (a paragraph in a cell) is a space either side. */
function inline(nodes: readonly Node[]): string {
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') {
      out += escapeMarkdown(node.replace(/\s+/g, ' '));
      continue;
    }
    if (DROPPED.has(node.tag)) continue;
    switch (node.tag) {
      case 'br':
        out += '\\\n';
        break;
      case 'b':
      case 'strong':
        out += wrap('**', inline(node.children));
        break;
      case 'i':
      case 'em':
        out += wrap('*', inline(node.children));
        break;
      case 'a': {
        const text = inline(node.children);
        const href = attribute(node, 'href') ?? '';
        // Only a web link is written as one, as the sanitizer keeps only those; its spaces, brackets and angle brackets
        // are percent-encoded so the link ends where it should.
        const url = href.replace(/[\s()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`);
        out += /^https?:\/\//i.test(href) && text.trim() ? `[${text.trim()}](${url})` : text;
        break;
      }
      default:
        out += BLOCKS.has(node.tag) ? ` ${inline(node.children)} ` : inline(node.children);
    }
  }
  return out;
}

/** Emphasis around text, its surrounding whitespace moved outside the markers (`**AC **` is not bold); none if empty. */
function wrap(marker: string, text: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  if (!match[2]) return text;
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}
