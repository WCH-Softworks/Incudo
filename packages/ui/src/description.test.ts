/**
 * An element's description with what it embeds put in place — ADR 0069.
 *
 * The fixture has no game in it. Each test names the change that fails it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapElementIndex, type Element } from '@incudo/core';

import { MAX_EMBED_DEPTH, expandDescription, openSelfClosingTags } from './description.ts';

function element(id: string, name: string, description: string): Element {
  return {
    id,
    type: 'Note',
    name,
    source: 'test',
    setters: {},
    rules: [],
    supports: [],
    description,
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

function indexOf(...elements: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  for (const e of elements) index.add(e);
  return index;
}

test("an embed is the embedded element's name as a heading and its text, in place", () => {
  // Fails if the marker is left in place (the gap ADR 0068 found), if the text is put in without the name the
  // embedder never writes, or if what surrounds the marker moves.
  const scroll = element('SCROLL', 'Scroll', '<p>Read it.</p><div class="reference"><div element="BEAST" /></div><p>After.</p>');
  const index = indexOf(scroll, element('BEAST', 'Beast', '<p>AC 18</p>'));
  assert.equal(
    expandDescription(scroll, index),
    '<p>Read it.</p><div class="reference"><div><h5>Beast</h5><p>AC 18</p></div></div><p>After.</p>',
  );
});

test("an embedded element's own embeds are put in place too", () => {
  // Fails if expansion is one level only.
  const a = element('A', 'A', '<div element="B" />');
  const index = indexOf(a, element('B', 'B', '<p>b</p><div element="C" />'), element('C', 'C', '<p>c</p>'));
  assert.equal(expandDescription(a, index), '<div><h5>B</h5><p>b</p><div><h5>C</h5><p>c</p></div></div>');
});

test('an embed naming nothing says so, with the id, in place of the text', () => {
  // Fails if a missing element leaves the marker (an empty gap again) or is dropped without a word.
  const a = element('A', 'A', '<p>a</p><div element="ID_GONE" /><p>z</p>');
  assert.equal(
    expandDescription(a, indexOf(a)),
    '<p>a</p><p><em>ID_GONE: not in the loaded content, so its text is not shown here.</em></p><p>z</p>',
  );
});

test('a circle is shown once, and the embed that closes it says it is shown above', () => {
  // Fails without the path check: the expansion never ends (the stack overflows), or with the path check reading only
  // the parent, so a circle of two still runs away.
  const a = element('A', 'A', '<div element="B" />');
  const b = element('B', 'B', '<div element="A" />');
  const self = element('SELF', 'Self', '<p>s</p><div element="SELF" />');
  const index = indexOf(a, b, self);
  assert.equal(expandDescription(a, index), '<div><h5>B</h5><div><h5>A</h5><p><em>Already shown above.</em></p></div></div>');
  assert.equal(expandDescription(self, index), '<p>s</p><div><h5>Self</h5><p><em>Already shown above.</em></p></div>');
});

test('nesting is expanded to a fixed depth and says so beyond it', () => {
  // Fails if there is no depth limit (every level is expanded), or if the limit is off by one either way.
  const chain: Element[] = [];
  for (let i = 0; i <= MAX_EMBED_DEPTH + 1; i++) chain.push(element(`E${i}`, `E${i}`, `<p>${i}</p><div element="E${i + 1}" />`));
  const index = indexOf(...chain);
  const html = expandDescription(chain[0]!, index);
  for (let i = 1; i <= MAX_EMBED_DEPTH; i++) assert.ok(html.includes(`<p>${i}</p>`), `level ${i} is shown`);
  assert.ok(!html.includes(`<p>${MAX_EMBED_DEPTH + 1}</p>`), 'the level past the limit is not');
  assert.ok(html.includes(`<h5>E${MAX_EMBED_DEPTH + 1}</h5><p><em>Nested too deeply to show here.</em></p>`));
});

test('a name is escaped, a marker that does not close itself keeps its partner, and no embed leaves the text as it was', () => {
  // Fails if a name is spliced in raw (it is content and could carry markup), or if a non-self-closing marker's own
  // `</div>` is left without an opening tag.
  const a = element('A', 'A', '<div element="B">tail</div><p>x</p>');
  const index = indexOf(a, element('B', 'B <script>', '<p>b</p>'));
  assert.equal(expandDescription(a, index), '<div><h5>B &lt;script&gt;</h5><p>b</p>tail</div><p>x</p>');
  const missing = element('M', 'M', '<div element="GONE">tail</div>');
  assert.equal(
    expandDescription(missing, indexOf(missing)),
    '<p><em>GONE: not in the loaded content, so its text is not shown here.</em></p><div>tail</div>',
  );
  const plain = element('P', 'P', '<p>nothing embedded</p>');
  assert.equal(expandDescription(plain, indexOf(plain)), '<p>nothing embedded</p>');
  assert.equal(expandDescription({ id: 'X' }, indexOf()), '');
});

test('an empty element written as XML is opened and closed, and a void one is left alone', () => {
  // Fails if the rewrite is removed (an HTML parser leaves `<h4 />` open and a stat block renders inside its heading),
  // if it rewrites a void element (`<br></br>` is two line breaks to a parser), or if it drops an attribute.
  assert.equal(
    openSelfClosingTags('<h4 style="margin-top:0px" /><p>AC 18</p><td colspan="2"/><td>MOD</td><br /><hr/><div element="X" />'),
    '<h4 style="margin-top:0px"></h4><p>AC 18</p><td colspan="2"></td><td>MOD</td><br /><hr/><div element="X"></div>',
  );
  assert.equal(openSelfClosingTags('<p>a/b > c</p>'), '<p>a/b > c</p>');
});
