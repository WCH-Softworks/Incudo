/**
 * End-of-line handling (XML 1.0 §2.11): a file with CRLF line endings is the same document as
 * its LF twin. A Windows checkout made with `core.autocrlf=true` used to keep a `\r` in every
 * multi-line description, so the same content read from disk and over the network compared as
 * defined differently.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAuroraElements } from './parse-elements.ts';
import { parseXml } from './xml.ts';

const OPTIONS = { sourceId: 'test', fileUrl: 'test.xml' };

const LF = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<elements>',
  '  <element name="Thing" type="Feat" source="Test" id="ID_THING">',
  '    <description>',
  '      <p>First line',
  '      second line.</p>',
  '      <p>Another paragraph.</p>',
  '    </description>',
  '    <sheet>',
  '      <description>Shown',
  '      on the sheet.</description>',
  '    </sheet>',
  '    <setters>',
  '      <set name="short">A',
  '      setter.</set>',
  '    </setters>',
  '    <rules>',
  '      <grant type="Proficiency" id="ID_OTHER" />',
  '      <select type="List" name="Pick">',
  '        <item id="1">One',
  '        item.</item>',
  '      </select>',
  '    </rules>',
  '  </element>',
  '</elements>',
  '',
].join('\n');

test('a CRLF document parses to exactly the elements of its LF twin, descriptions included', () => {
  const lf = parseAuroraElements(LF, OPTIONS);
  const crlf = parseAuroraElements(LF.replace(/\n/g, '\r\n'), OPTIONS);
  assert.ok(lf.elements.length > 1, 'the fixture yields the element and its inline list item');
  assert.match(JSON.stringify(lf.elements), /second line/, 'the multi-line description is read');
  assert.deepEqual(crlf.elements, lf.elements);
  assert.deepEqual(crlf.diagnostics, lf.diagnostics);
  assert.doesNotMatch(JSON.stringify(crlf.elements), /\\r/);
});

test('a lone CR is a line ending too', () => {
  const lf = parseAuroraElements(LF, OPTIONS);
  const cr = parseAuroraElements(LF.replace(/\n/g, '\r'), OPTIONS);
  assert.deepEqual(cr.elements, lf.elements);
});

test('text, inner source and CDATA all read `\\n` for `\\r\\n` and `\\r`', () => {
  const doc = parseXml('<a>one\r\ntwo\rthree<b>x\r\ny</b><![CDATA[p\r\nq]]></a>');
  const a = doc.children[0]!;
  assert.equal(a.text, 'one\ntwo\nthreep\nq');
  assert.equal(a.innerXml, 'one\ntwo\nthree<b>x\ny</b><![CDATA[p\nq]]>');
  assert.equal(a.children[0]!.text, 'x\ny');
});

test('a CR written as a character reference is kept, as the spec says', () => {
  const doc = parseXml('<a>one&#13;two</a>');
  assert.equal(doc.children[0]!.text, 'one\rtwo');
});
