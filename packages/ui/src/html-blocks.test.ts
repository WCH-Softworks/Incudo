/**
 * A kept text's HTML read into blocks of styled runs — ADR 0083.
 *
 * The fixtures are `html-markdown.test.ts`'s, the shapes the corpus's kept texts are made of, so the two readers are held
 * to the same decisions: the export writes these as Markdown, a phone draws these blocks. Each test names the change
 * that fails it. `tools/verify`'s `html-blocks.test.ts` compares the two over every kept text in the corpus.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { htmlToBlocks, htmlToRuns, runsText, type TextBlock } from './html-blocks.ts';

const GRID =
  '<table style="text-align:center"><tr style="font-size:8px"><td colspan="2" /><td>MOD</td><td>SAVE</td><td colspan="2" /><td>MOD</td><td>SAVE</td></tr>' +
  '<tr><td><b>STR</b></td><td>14</td><td>+2</td><td>+2</td><td><b>DEX</b></td><td>14</td><td>+2</td><td>+2</td></tr></table>';

test('the 2024 ability grid: every row as wide as the table, spans as empty cells, bold kept', () => {
  // Fails if a spanning cell is not followed by empty ones (the first row is 6 wide against 8), or if `b` is dropped.
  const [table] = htmlToBlocks(GRID);
  assert.equal(table?.kind, 'table');
  const rows = (table as Extract<TextBlock, { kind: 'table' }>).rows;
  assert.deepEqual(rows.map((row) => row.map(runsText)), [
    ['', '', 'MOD', 'SAVE', '', '', 'MOD', 'SAVE'],
    ['STR', '14', '+2', '+2', 'DEX', '14', '+2', '+2'],
  ]);
  assert.deepEqual(rows[1]![0], [{ text: 'STR', bold: true }]);
});

test('a table with a thead is read, and a pipe in a cell is only text', () => {
  const [table] = htmlToBlocks('<table><thead><tr><td>STR</td><td>DEX</td></tr></thead><tr><td>16 (+3)</td><td>a | b</td></tr></table>');
  // Fails if a `thead` is walked past (no rows).
  assert.deepEqual((table as Extract<TextBlock, { kind: 'table' }>).rows.map((row) => row.map(runsText)), [
    ['STR', 'DEX'],
    ['16 (+3)', 'a | b'],
  ]);
});

test('an empty self-closing heading is dropped, and one with text sits at the level asked', () => {
  const html = '<h4 style="margin-top:0px" /><p style="margin-bottom:5px"><em>Medium Beast, Neutral</em></p><h4>Traits</h4><h5 class="caption">ACTIONS</h5>';
  // Fails if an empty heading is kept, or if a heading is not held to the level asked.
  assert.deepEqual(htmlToBlocks(html), [
    { kind: 'paragraph', lines: [[{ text: 'Medium Beast, Neutral', italic: true }]] },
    { kind: 'heading', level: 4, runs: [{ text: 'Traits' }] },
    { kind: 'heading', level: 5, runs: [{ text: 'ACTIONS' }] },
  ]);
  assert.deepEqual(
    htmlToBlocks('<h1>Top</h1><h6>Low</h6>', { headingLevel: 3 }).map((b) => (b.kind === 'heading' ? b.level : 0)),
    [3, 6],
  );
});

test('lists keep their markers and depth, and a space inside a bold tag is not bold', () => {
  const html =
    '<ul class="unstyled"><li><strong>AC </strong>13 plus your Wisdom modifier</li><li><strong>HP</strong> 5</li></ul>' +
    '<ol><li>First<ul><li>inner</li></ul></li><li>Second</li></ol>';
  // Fails if a nested list is flattened (depth 0) or an ordered list loses its numbers.
  assert.deepEqual(htmlToBlocks(html), [
    {
      kind: 'list',
      items: [
        { marker: '-', depth: 0, runs: [{ text: 'AC ', bold: true }, { text: '13 plus your Wisdom modifier' }] },
        { marker: '-', depth: 0, runs: [{ text: 'HP', bold: true }, { text: ' 5' }] },
      ],
    },
    {
      kind: 'list',
      items: [
        { marker: '1.', depth: 0, runs: [{ text: 'First' }] },
        { marker: '-', depth: 1, runs: [{ text: 'inner' }] },
        { marker: '2.', depth: 0, runs: [{ text: 'Second' }] },
      ],
    },
  ]);
});

test('whitespace collapses across runs, entities decode, and inline text around a block is its own paragraph', () => {
  const html = '\n\t\t<p><strong><em>Primal Bond.</em></strong>  Add your\n\t\tbonus &amp; more.</p>Loose text<div>In a div</div>';
  // Fails if an entity is left encoded, if two spaces survive between runs, or if text beside a block runs into it.
  assert.deepEqual(htmlToBlocks(html), [
    { kind: 'paragraph', lines: [[{ text: 'Primal Bond.', bold: true, italic: true }, { text: ' Add your bonus & more.' }]] },
    { kind: 'paragraph', lines: [[{ text: 'Loose text' }]] },
    { kind: 'paragraph', lines: [[{ text: 'In a div' }]] },
  ]);
});

test('a br breaks a line, and breaks with nothing between them are one', () => {
  // Fails if a `br` is read as a space, or if an empty line is kept.
  assert.deepEqual(htmlToBlocks('<p><br/>One<br><br />Two<br/></p>'), [
    { kind: 'paragraph', lines: [[{ text: 'One' }], [{ text: 'Two' }]] },
  ]);
});

test('a link is kept only when it points at the web and has text, and script goes with its contents', () => {
  const html = '<p><a href="https://example.org/x">site</a> <a href="javascript:alert(1)">bad</a> <a href="https://e.org"></a><script>no</script></p>';
  // Fails if a non-web address becomes a link, or if a dropped tag's contents leak into the text.
  assert.deepEqual(htmlToBlocks(html), [
    { kind: 'paragraph', lines: [[{ text: 'site', href: 'https://example.org/x' }, { text: ' bad' }]] },
  ]);
});

test('a short text as one line of runs: blocks a space apart', () => {
  // Fails if two paragraphs run together with no space, or if bold is lost.
  assert.deepEqual(htmlToRuns('<p>You gain <b>2</b> uses.</p><p>Again.</p>'), [
    { text: 'You gain ' },
    { text: '2', bold: true },
    { text: ' uses. Again.' },
  ]);
  assert.deepEqual(htmlToRuns('Plain line with no markup'), [{ text: 'Plain line with no markup' }]);
  assert.deepEqual(htmlToRuns('<h4 />'), []);
});
