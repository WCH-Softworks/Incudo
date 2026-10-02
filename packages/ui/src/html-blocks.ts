/**
 * A kept text's HTML as blocks of styled runs, for a renderer that has no DOM to sanitize it into — ADR 0083.
 *
 * The desktop shows content's HTML through its own sanitizer, and the text export writes it as Markdown
 * (`html-markdown.ts`). A phone has neither a DOM nor a reason to show Markdown's asterisks, so it draws the structure
 * itself: paragraphs, headings, lists, tables and a rule, each holding runs of text that are bold, italic or a link.
 * This reads the same tree as the export (`html-tree.ts`) and makes the same decisions in the same places, so the two
 * cannot disagree about what a text says:
 *
 * - a heading with no text is dropped, and one with text sits at `headingLevel` or below, as the export writes it;
 * - a list item is one line, a list inside it a level deeper;
 * - a table's rows are as wide as its widest once spans are counted, a spanning cell followed by empty ones, and its
 *   first row is its header, as the export's pipe table makes it;
 * - whitespace collapses, a `br` breaks a paragraph's line, and an empty line is no line;
 * - a link is a link only when it points at http(s) and has text; anything else is its text.
 *
 * Nothing is escaped, because nothing here is markup: a renderer draws `text` as text.
 */

import { openSelfClosingTags } from './description.ts';
import { attribute, BLOCKS, DROPPED, isBlock, parse, type ElementNode, type Node } from './html-tree.ts';

/** A stretch of text with one style. */
export interface TextRun {
  text: string;
  bold?: true;
  italic?: true;
  /** An http(s) address the text links to. */
  href?: string;
}

export type TextBlock =
  /** One or more lines, each a list of runs; a `br` starts a line. */
  | { kind: 'paragraph'; lines: TextRun[][] }
  | { kind: 'heading'; level: number; runs: TextRun[] }
  /** `depth` 0 is the outermost list; `marker` is "-" or the item's number with its dot, "1.". */
  | { kind: 'list'; items: { marker: string; depth: number; runs: TextRun[] }[] }
  /** Every row as wide as the widest; the first row is the header. */
  | { kind: 'table'; rows: TextRun[][][] }
  | { kind: 'rule' }
  | { kind: 'quote'; blocks: TextBlock[] };

export interface HtmlBlocksOptions {
  /** The level content's own headings start from, as `htmlToMarkdown`'s option: 4 unless said. */
  headingLevel?: number;
}

/** A kept text as blocks. Empty when it has no text. */
export function htmlToBlocks(html: string, options: HtmlBlocksOptions = {}): TextBlock[] {
  const out: TextBlock[] = [];
  readBlocks(parse(openSelfClosingTags(html)).children, out, options.headingLevel ?? 4);
  return out;
}

/**
 * A short text (a feature's sheet line) as the runs of one line: every block's runs in order, a space apart. What the
 * export does to the same line, which writes it as one Markdown line.
 */
export function htmlToRuns(html: string): TextRun[] {
  const runs: TextRun[] = [];
  const add = (line: TextRun[]): void => {
    if (!line.length) return;
    if (runs.length) runs.push({ text: ' ' });
    runs.push(...line);
  };
  const walk = (blocks: TextBlock[]): void => {
    for (const block of blocks) {
      if (block.kind === 'paragraph') block.lines.forEach(add);
      else if (block.kind === 'heading') add(block.runs);
      else if (block.kind === 'list') block.items.forEach((item) => add(item.runs));
      else if (block.kind === 'table') block.rows.forEach((row) => row.forEach(add));
      else if (block.kind === 'quote') walk(block.blocks);
    }
  };
  walk(htmlToBlocks(html));
  return merge(runs);
}

/** The plain text of runs, as a renderer with no styles would show it. */
export function runsText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join('');
}

// --- reading ----------------------------------------------------------------------------------------------------

function readBlocks(nodes: readonly Node[], out: TextBlock[], headingLevel: number): void {
  let run: Node[] = [];
  const flush = (): void => {
    const lines = tidyLines(inline(run, {}));
    if (lines.length) out.push({ kind: 'paragraph', lines });
    run = [];
  };
  for (const node of nodes) {
    if (typeof node === 'string' || !isBlock(node)) {
      if (typeof node !== 'string' && DROPPED.has(node.tag)) continue;
      run.push(node);
      continue;
    }
    flush();
    readBlock(node, out, headingLevel);
  }
  flush();
}

function readBlock(node: ElementNode, out: TextBlock[], headingLevel: number): void {
  const heading = /^h([1-6])$/.exec(node.tag);
  if (heading) {
    const runs = oneLine(inline(node.children, {}));
    if (runs.length) out.push({ kind: 'heading', level: Math.min(6, Math.max(headingLevel, Number(heading[1]))), runs });
    return;
  }
  switch (node.tag) {
    case 'ul':
    case 'ol': {
      const items = listItems(node, 0);
      if (items.length) out.push({ kind: 'list', items });
      return;
    }
    case 'table': {
      const rows = tableRows(node);
      if (rows.length) out.push({ kind: 'table', rows });
      return;
    }
    case 'hr':
      out.push({ kind: 'rule' });
      return;
    case 'blockquote': {
      const blocks: TextBlock[] = [];
      readBlocks(node.children, blocks, headingLevel);
      if (blocks.length) out.push({ kind: 'quote', blocks });
      return;
    }
    default:
      readBlocks(node.children, out, headingLevel);
  }
}

function listItems(list: ElementNode, depth: number): { marker: string; depth: number; runs: TextRun[] }[] {
  const items: { marker: string; depth: number; runs: TextRun[] }[] = [];
  let number = 1;
  for (const child of list.children) {
    if (typeof child === 'string' || child.tag !== 'li') {
      const runs = oneLine(inline(typeof child === 'string' ? [child] : child.children, {}));
      if (runs.length) items.push({ marker: '-', depth, runs });
      continue;
    }
    const marker = list.tag === 'ol' ? `${number++}.` : '-';
    const nested = child.children.filter((n): n is ElementNode => typeof n !== 'string' && (n.tag === 'ul' || n.tag === 'ol'));
    const rest = child.children.filter((n) => !nested.includes(n as ElementNode));
    items.push({ marker, depth, runs: oneLine(inline(rest, {})) });
    for (const inner of nested) items.push(...listItems(inner, depth + 1));
  }
  return items;
}

function tableRows(table: ElementNode): TextRun[][][] {
  const rows: TextRun[][][] = [];
  const collect = (node: ElementNode): void => {
    for (const child of node.children) {
      if (typeof child === 'string') continue;
      if (child.tag === 'tr') {
        const cells: TextRun[][] = [];
        for (const cell of child.children) {
          if (typeof cell === 'string' || (cell.tag !== 'td' && cell.tag !== 'th')) continue;
          cells.push(oneLine(inline(cell.children, {})));
          const span = Number(attribute(cell, 'colspan') ?? 1);
          for (let extra = 1; extra < (Number.isInteger(span) && span > 1 ? Math.min(span, 100) : 1); extra++) cells.push([]);
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
  return rows.map((row) => Array.from({ length: width }, (_, at) => row[at] ?? []));
}

/** A line break inside inline content. */
const BREAK: TextRun = { text: '\n' };

interface Style {
  bold?: true;
  italic?: true;
  href?: string;
}

/** Inline nodes as runs, whitespace collapsed to single spaces and a `br` as {@link BREAK}. */
function inline(nodes: readonly Node[], style: Style): TextRun[] {
  const out: TextRun[] = [];
  for (const node of nodes) {
    if (typeof node === 'string') {
      out.push({ ...style, text: node.replace(/\s+/g, ' ') });
      continue;
    }
    if (DROPPED.has(node.tag)) continue;
    switch (node.tag) {
      case 'br':
        out.push(BREAK);
        break;
      case 'b':
      case 'strong':
        out.push(...inline(node.children, { ...style, bold: true }));
        break;
      case 'i':
      case 'em':
        out.push(...inline(node.children, { ...style, italic: true }));
        break;
      case 'a': {
        const href = attribute(node, 'href') ?? '';
        const runs = inline(node.children, /^https?:\/\//i.test(href) ? { ...style, href } : style);
        // A link with no text is no link, as the export writes it.
        out.push(...(runs.some((run) => run.text.trim()) ? runs : inline(node.children, style)));
        break;
      }
      default:
        if (BLOCKS.has(node.tag)) out.push({ ...style, text: ' ' }, ...inline(node.children, style), { ...style, text: ' ' });
        else out.push(...inline(node.children, style));
    }
  }
  return out;
}

/** Runs split at their breaks into lines, each tidied, empty lines dropped. */
function tidyLines(runs: readonly TextRun[]): TextRun[][] {
  const lines: TextRun[][] = [[]];
  for (const run of runs) {
    if (run === BREAK) lines.push([]);
    else lines[lines.length - 1]!.push(run);
  }
  return lines.map(tidy).filter((line) => line.length);
}

/** Runs on one line: a break is a space. */
function oneLine(runs: readonly TextRun[]): TextRun[] {
  return tidy(runs.map((run) => (run === BREAK ? { text: ' ' } : run)));
}

/** Spaces collapsed across runs, the ends trimmed, empty runs dropped and neighbours with one style joined. */
function tidy(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  let previousEndsInSpace = true;
  for (const run of runs) {
    let text = run.text.replace(/\s+/g, ' ');
    if (previousEndsInSpace) text = text.replace(/^ /, '');
    if (!text) continue;
    previousEndsInSpace = text.endsWith(' ');
    out.push({ ...run, text });
  }
  while (out.length) {
    const last = out[out.length - 1]!;
    last.text = last.text.replace(/ $/, '');
    if (last.text) break;
    out.pop();
  }
  return merge(out);
}

function sameStyle(a: TextRun, b: TextRun): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.href === b.href;
}

/** Neighbouring runs of one style joined. */
function merge(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    const previous = out[out.length - 1];
    if (previous && sameStyle(previous, run)) previous.text += run.text;
    else out.push({ ...run });
  }
  return out;
}
