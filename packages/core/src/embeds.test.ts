/**
 * What a description embeds, read and saved — ADR 0069.
 *
 * The fixture has no game in it. A chosen Knack's description embeds a Note, which carries a grant of its own and
 * embeds a second Note: a save must carry both Notes for their text and not what the first one grants, because an
 * element reached only through a description is shown and never held. Each test names the change that fails it, and
 * each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectCharacterContent } from './container.ts';
import { createCharacter, setChoice } from './character.ts';
import { descriptionEmbeds, embeddedElementIds } from './embeds.ts';
import { MapElementIndex, type Element, type Rule } from './model.ts';

function element(id: string, type: string, description: string, rules: Rule[] = []): Element {
  return {
    id,
    type,
    name: id,
    source: 'test',
    setters: {},
    rules,
    supports: [],
    description,
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

const grant = (id: string): Rule => ({ kind: 'grant', key: `grant:${id}`, type: 'Knack', id });

test('the marker is read in every shape a div with an element attribute can take, and nothing else', () => {
  // Fails if the self-closing slash is not recorded, if single quotes or a second attribute are not read, if an empty
  // id is kept, if the attribute match drops its leading space and reads `data-element` as the marker, or if a marker
  // inside a comment (an embed content switched off) is read.
  const text =
    `<p>Before.</p><!-- <div element="ID_OFF" /> --><div element="ID_A" />` +
    `<div element='ID_B'/>` +
    `<DIV class="reference" element="ID_C">inside</DIV>` +
    `<div element="" />` +
    `<div data-element="ID_NOT" />` +
    `<span element="ID_NOT_A_DIV" />`;
  const embeds = descriptionEmbeds(text);
  assert.deepEqual(
    embeds.map((e) => [e.id, e.selfClosing]),
    [
      ['ID_A', true],
      ['ID_B', true],
      ['ID_C', false],
    ],
  );
  // Positions are the opening tag's, exactly.
  assert.equal(text.slice(embeds[0]!.start, embeds[0]!.end), '<div element="ID_A" />');
  assert.equal(text.slice(embeds[2]!.start, embeds[2]!.end), '<DIV class="reference" element="ID_C">');
  assert.deepEqual(descriptionEmbeds(undefined), []);
  assert.deepEqual(descriptionEmbeds('<!-- unclosed <div element="ID_X" />'), [], 'an unclosed comment runs to the end');
  // Each id once, in the order first written.
  assert.deepEqual(embeddedElementIds({ description: '<div element="X" /><div element="Y" /><div element="X" />' }), [
    'X',
    'Y',
  ]);
});

const index = new MapElementIndex();
for (const e of [
  element('KNACK', 'Knack', '<p>A knack.</p><div class="reference"><div element="NOTE" /></div>'),
  element('NOTE', 'Note', '<p>A note.</p><div element="INNER_NOTE" />', [grant('GRANTED_BY_NOTE')]),
  element('INNER_NOTE', 'Note', '<p>Nested.</p>'),
  element('GRANTED_BY_NOTE', 'Knack', '<p>Only the note grants this.</p>'),
  // Embeds NOTE and grants BRIDGE, which grants NOTE: reached for its text first and by a rule after.
  element('BOTH', 'Knack', '<div element="NOTE" />', [grant('BRIDGE')]),
  element('BRIDGE', 'Knack', '', [grant('NOTE')]),
  element('DANGLING', 'Knack', '<div element="NOTHING_DECLARES_THIS" />'),
]) {
  index.add(e);
}

function chosen(...ids: string[]) {
  return setChoice(createCharacter('test', 'hero', { progress: 1 }), 'build/knack', ids);
}

test("a save carries what a held element's description embeds, nested, for its text only", () => {
  // Fails if collectCharacterContent does not follow embeds (NOTE is missing), if it does not follow an embedded
  // element's own embeds (INNER_NOTE is missing), or if it follows an embedded element's rules (GRANTED_BY_NOTE is
  // there: nothing holds NOTE, so nothing it grants is reached).
  const subset = collectCharacterContent(chosen('KNACK'), index);
  assert.deepEqual(
    subset.elements.map((e) => e.id),
    ['INNER_NOTE', 'KNACK', 'NOTE'],
  );
  assert.deepEqual(subset.unresolved, []);
});

test('an element reached for its text and then by a rule is followed in full', () => {
  // Fails if an element already collected for its text is skipped when a rule reaches it later (GRANTED_BY_NOTE is
  // missing), which is a save that opens without something a derivation reaches.
  const subset = collectCharacterContent(chosen('BOTH'), index);
  assert.deepEqual(
    subset.elements.map((e) => e.id),
    ['BOTH', 'BRIDGE', 'GRANTED_BY_NOTE', 'INNER_NOTE', 'NOTE'],
  );
});

test('an embed naming nothing is a gap in a text, not something the character uses', () => {
  // Fails if an embed that resolves to nothing is reported in `unresolved`, which the library reads as "this save uses
  // something that is not in your content".
  const subset = collectCharacterContent(chosen('DANGLING'), index);
  assert.deepEqual(subset.elements.map((e) => e.id), ['DANGLING']);
  assert.deepEqual(subset.unresolved, []);
});
