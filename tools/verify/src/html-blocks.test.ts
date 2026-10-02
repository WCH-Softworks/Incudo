/**
 * The phone's reading of content's HTML says what the export's says — ADR 0083.
 *
 * `htmlToBlocks` (what a renderer with no DOM draws) and `htmlToMarkdown` (the text export) read the same tree
 * (`html-tree.ts`), and this holds them to the same words over every description and every sheet line the corpus
 * writes: the words of the blocks, in order, are the words of the HTML with its tags taken out, and so are the words of
 * the Markdown. A reader that dropped a cell, a list item or the text after an empty heading would read short here.
 *
 * A word is a run of letters and digits, so a table's pipes do not count, and an entity is decoded before it is compared.
 * An inline tag joins what is either side of it, as a browser shows it: content writes "the<em>gaseous form</em>", which
 * reads "thegaseous" on every screen. Markdown's emphasis markers, escapes and link targets are taken out of the export
 * before its words are read, for the same reason.
 *
 * Found by this and not fixed: three `Source` descriptions carry a literal `<![CDATA[`, which both readers show as text.
 * No sheet shows a `Source`, and where the marker comes from is the importer's question, so those texts are counted and
 * left out.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sheetDescriptions } from '@incudo/core';
import { htmlToBlocks, htmlToMarkdown, runsText, type TextBlock } from '@incudo/ui';

import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

function words(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** The HTML's own words: comments, dropped tags with their contents, and every other tag taken out, entities decoded. */
function htmlWords(html: string): string[] {
  const text = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style|iframe|object|svg|math|form|button)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
    .replace(/<\/?(?:b|strong|i|em|a|span|u|small|sub|sup|font|code)\b[^>]*>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[name.toLowerCase()] ?? whole;
    });
  return words(text);
}

/** The export's words: its emphasis markers, escapes and link targets out, so "the*gaseous form*" reads as shown. */
function markdownWords(markdown: string): string[] {
  return words(markdown.replace(/\]\([^)]*\)/g, ']').replace(/\\(.)/g, '$1').replace(/\*/g, ''));
}

function blockWords(blocks: readonly TextBlock[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'paragraph') for (const line of block.lines) out.push(...words(runsText(line)));
    else if (block.kind === 'heading') out.push(...words(runsText(block.runs)));
    else if (block.kind === 'list') for (const item of block.items) out.push(...words(runsText(item.runs)));
    else if (block.kind === 'table') for (const row of block.rows) for (const cell of row) out.push(...words(runsText(cell)));
    else if (block.kind === 'quote') out.push(...blockWords(block.blocks));
  }
  return out;
}

test('every description and sheet line reads to the same words as blocks, as Markdown and as HTML', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  let texts = 0;
  let withTable = 0;
  let withList = 0;
  let cdata = 0;
  const differ: string[] = [];
  for (const element of elements.all()) {
    const html = [element.description ?? '', ...sheetDescriptions(element.sheet).map((d) => d.text)].filter(Boolean);
    for (const text of html) {
      texts++;
      if (text.includes('<![CDATA[')) {
        cdata++;
        continue;
      }
      const blocks = htmlToBlocks(text);
      if (blocks.some((b) => b.kind === 'table')) withTable++;
      if (blocks.some((b) => b.kind === 'list')) withList++;
      const expected = htmlWords(text).join(' ');
      if (blockWords(blocks).join(' ') !== expected || markdownWords(htmlToMarkdown(text)).join(' ') !== expected) differ.push(element.id);
    }
  }
  t.diagnostic(`texts read: ${texts}; with a table: ${withTable}; with a list: ${withList}; left out for a CDATA marker: ${cdata}`);
  t.diagnostic(`reading to different words: ${differ.length}${differ.length ? ` (${differ.slice(0, 5).join(', ')})` : ''}`);
  assert.ok(texts > 0, 'the corpus has descriptions');
  assert.deepEqual(differ, []);
});
