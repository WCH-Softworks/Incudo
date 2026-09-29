/**
 * A kept text's HTML read into Markdown — ADR 0075.
 *
 * The fixtures are the shapes the corpus's kept texts are made of (`tools/verify`'s `sheet-export.test.ts` measures
 * them): a stat block's ability grid with spanning empty cells and no header row, one with a `thead`, an empty
 * self-closing heading, lists with a class, bold and italic runs with a space inside the tag, an entity. Each test names
 * the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeLineStart, escapeMarkdown, htmlToMarkdown } from './html-markdown.ts';

const GRID =
  '<table style="text-align:center"><tr style="font-size:8px"><td colspan="2" /><td>MOD</td><td>SAVE</td><td colspan="2" /><td>MOD</td><td>SAVE</td></tr>' +
  '<tr><td><b>STR</b></td><td>14</td><td>+2</td><td>+2</td><td><b>DEX</b></td><td>14</td><td>+2</td><td>+2</td></tr></table>';

test('the 2024 ability grid: every row as wide as the table, the first row the header, spans as empty cells', () => {
  // Fails if a spanning cell is not followed by empty ones (the header row is 6 wide against 8), or if the first row is
  // not the header (no delimiter row after it).
  assert.equal(
    htmlToMarkdown(GRID),
    [
      '| | | MOD | SAVE | | | MOD | SAVE |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      '| **STR** | 14 | +2 | +2 | **DEX** | 14 | +2 | +2 |',
    ].join('\n'),
  );
});

test('a table with a thead: its row is the header, and a pipe in a cell is escaped', () => {
  const html = '<table><thead><tr><td>STR</td><td>DEX</td></tr></thead><tr><td>16 (+3)</td><td>a | b</td></tr></table>';
  // Fails if a `thead` is walked past (no rows), or a cell's pipe is left to split it.
  assert.equal(htmlToMarkdown(html), ['| STR | DEX |', '| --- | --- |', '| 16 (+3) | a \\| b |'].join('\n'));
});

test('an empty self-closing heading is dropped, and one with text sits at the level asked', () => {
  const html = '<h4 style="margin-top:0px" /><p style="margin-bottom:5px"><em>Medium Beast, Neutral</em></p><h4>Traits</h4><h5 class="caption">ACTIONS</h5>';
  // Fails without `openSelfClosingTags` (the heading swallows everything after it), or if an empty heading is written.
  assert.equal(htmlToMarkdown(html), '*Medium Beast, Neutral*\n\n#### Traits\n\n##### ACTIONS');
  assert.equal(htmlToMarkdown('<h1>Top</h1><h6>Low</h6>', { headingLevel: 3 }), '### Top\n\n###### Low');
});

test('lists, bold and italic with the spaces moved outside the markers, and nested lists indented', () => {
  const html =
    '<ul class="unstyled"><li><strong>AC </strong>13 plus your Wisdom modifier</li><li><strong>HP</strong> 5</li></ul>' +
    '<ol><li>First<ul><li>inner</li></ul></li><li>Second</li></ol>';
  // Fails if emphasis keeps its inner space (`**AC **` is not bold in Markdown), or if a nested list is flattened.
  assert.equal(
    htmlToMarkdown(html),
    ['- **AC** 13 plus your Wisdom modifier', '- **HP** 5', '', '1. First', '   - inner', '2. Second'].join('\n'),
  );
});

test('whitespace collapses, entities decode, and inline text around a block is its own paragraph', () => {
  const html = '\n\t\t<p><strong><em>Primal Bond.</em></strong>  Add your\n\t\tbonus &amp; more.</p>Loose text<div>In a div</div>';
  // Fails if an entity is left encoded, or if text beside a block runs into it.
  assert.equal(htmlToMarkdown(html), '***Primal Bond.*** Add your bonus & more.\n\nLoose text\n\nIn a div');
});

test('it writes no HTML: a tag in the text is escaped, and script and style go with their contents', () => {
  const html = '<p>Hit Dice [d8s] &lt;script&gt;alert(1)&lt;/script&gt; 5 * 2_x `y`</p><script>alert(2)</script><style>p{}</style><font>kept</font>';
  const markdown = htmlToMarkdown(html);
  // Fails with `escapeMarkdown` made the identity: the decoded `<script>` would reach a Markdown reader as a tag.
  assert.equal(markdown, 'Hit Dice [d8s] \\<script>alert(1)\\</script> 5 \\* 2\\_x \\`y\\`\n\nkept');
  assert.doesNotMatch(markdown, /(^|[^\\])</);
  assert.doesNotMatch(markdown, /alert\(2\)|p\{\}/);
});

test('a link is written only for a web address, and its parentheses cannot end it early', () => {
  // Fails if any href is written as a link (`javascript:` would be), or a bracket in the address is left bare.
  assert.equal(htmlToMarkdown('<a href="javascript:alert(1)">no</a> <a href="https://example.org/a_(b)">yes</a>'), 'no [yes](https://example.org/a_%28b%29)');
});

test('a hard break is a backslash line end, and one at either end of a paragraph breaks nothing', () => {
  // Fails if a leading or trailing break is kept (a stray backslash at the end of a paragraph is shown as one).
  assert.equal(htmlToMarkdown('<p><br/>One<br/><br />Two<br/></p>'), 'One\\\nTwo');
});

test('what Markdown would misread is escaped, and nothing else', () => {
  assert.equal(escapeMarkdown('a [b] c'), 'a [b] c');
  assert.equal(escapeMarkdown('[b](c) [d]: e &amp; & f'), '[b\\](c) [d\\]: e \\&amp; & f');
  assert.equal(escapeLineStart('# not a heading'), '\\# not a heading');
  assert.equal(escapeLineStart('- not an item'), '\\- not an item');
  assert.equal(escapeLineStart('12. not a list'), '12\\. not a list');
  assert.equal(escapeLineStart('> not a quote'), '\\> not a quote');
  assert.equal(escapeLineStart('+2 to hit'), '\\+2 to hit');
  assert.equal(escapeLineStart('Plain, with - and 1. inside'), 'Plain, with - and 1. inside');
  // A paragraph that starts like a list is escaped where it starts. Fails if `paragraph` skips `escapeLineStart`.
  assert.equal(htmlToMarkdown('<p>1. Roll a d6.</p>'), '1\\. Roll a d6.');
});

test('a closing tag with no partner is ignored, and what is left open is closed at the end', () => {
  assert.equal(htmlToMarkdown('</b><p>Open <b>bold'), 'Open **bold**');
  assert.equal(htmlToMarkdown(''), '');
  assert.equal(htmlToMarkdown('<h4 /><p> </p>'), '');
});
