/**
 * What an element asks the character to choose, shown after its description. No game in the fixture; the corpus case
 * that found it (a feature whose options are "detailed below") is measured in
 * `tools/verify/src/description-pointers.test.ts`.
 *
 * Each test names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MapElementIndex, parseSupports, type Element, type Rule } from '@incudo/core';

import { elementChoiceLine, elementChoices, expandDescriptionWithChoices, OPTIONS_WRITTEN_OUT } from './element-choices.ts';

function element(id: string, type: string, name: string, extra: Partial<Element> = {}): Element {
  return {
    id,
    type,
    name,
    source: 'The Book',
    setters: {},
    rules: [],
    supports: [],
    origin: { sourceId: 'one', format: 'incudo' },
    ...extra,
  };
}

function select(name: string, type: string, number: number, supports?: string, level?: number): Rule {
  return {
    kind: 'select',
    key: `select:${name}`,
    type,
    name,
    number,
    ...(supports ? { supports: parseSupports(supports)! } : {}),
    ...(level === undefined ? {} : { level }),
  } as Rule;
}

const TRICKS = [
  element('T_B', 'Trick', 'Bounce', { supports: ['Trick'] }),
  element('T_A', 'Trick', 'Aim', { supports: ['Trick'] }),
  element('T_A2', 'Trick', 'Aim', { supports: ['Trick'], source: 'The Other Book' }),
  element('T_X', 'Trick', 'Other', { supports: ['Not a trick'] }),
];

test("a select's options are what its filter matches, by name, a shared name told apart by its book", () => {
  // Fails if the filter is not applied (Other is listed) or the options are not sorted.
  const feature = element('F', 'Feature', 'Tricks', { rules: [select('Tricks', 'Trick', 2, 'Trick')] });
  const [choice] = elementChoices(feature, indexOf(feature, ...TRICKS));
  assert.deepEqual(
    choice!.options.map((o) => o.label),
    ['Aim (The Book)', 'Aim (The Other Book)', 'Bounce'],
  );
  assert.equal(elementChoiceLine(choice!), 'Choose 2 of 3 options:');
});

test('selects offering the same options are one choice, their picks by level and their names without the "(…)"', () => {
  // Fails if selects are not grouped (four choices) or the label keeps "(Level 3)".
  const feature = element('F', 'Feature', 'Tricks', {
    rules: [
      select('Tricks (Level 3)', 'Trick', 3, 'Trick', 3),
      select('Tricks (Level 7)', 'Trick', 2, 'Trick', 7),
      select('Tricks (Level 10)', 'Trick', 2, 'Trick', 10),
      select('Gear', 'Gadget', 1),
    ],
  });
  const choices = elementChoices(feature, indexOf(feature, ...TRICKS));
  assert.deepEqual(
    choices.map((c) => c.label),
    ['Tricks', 'Gear'],
  );
  assert.equal(elementChoiceLine(choices[0]!), 'Choose 3 at level 3, then 2 more at level 7 and 2 more at level 10, from 3 options:');
  assert.equal(elementChoiceLine(choices[1]!), 'Choose 1. Nothing loaded matches this choice.');
});

test('a filter naming what only a character publishes depends on the character, never offers nothing', () => {
  // Fails if an unresolved $(…) is evaluated (the line would say nothing matches).
  const feature = element('F', 'Feature', 'Spells', { rules: [select('Spells', 'Trick', 1, '$(list)')] });
  const [choice] = elementChoices(feature, indexOf(feature, ...TRICKS));
  assert.equal(choice!.dependsOnCharacter, true);
  assert.equal(elementChoiceLine(choice!), 'Choose 1. The options depend on the character.');
});

test('an element with no select has no choices', () => {
  // Fails if a grant is read as a choice.
  const feature = element('F', 'Feature', 'Plain', { rules: [{ kind: 'grant', key: 'g', type: 'Trick', id: 'T_A' } as Rule] });
  assert.deepEqual(elementChoices(feature, indexOf(feature, ...TRICKS)), []);
});

test("a choice is written after the text of the element that opens it, embedded or not, each option's name over its text", () => {
  // Fails if embeds' choices are not written (no Bounce), if they are written at the end rather than inside the embed
  // (the Aim text after "Closing"), or if an option's text is left out.
  const tricks = [
    element('T_A', 'Feature', 'Aim', { supports: ['Trick'], description: '<p>Aim well.</p>' }),
    element('T_B', 'Feature', 'Bounce', { supports: ['Trick'], description: '<p>Bounce off.</p>' }),
  ];
  const feature = element('F', 'Feature', 'Tricks', {
    description: '<p>Learn tricks.</p>',
    rules: [select('Tricks (Level 3)', 'Feature', 2, 'Trick', 3), select('Tricks (Level 7)', 'Feature', 1, 'Trick', 7)],
  });
  const path = element('P', 'Path', 'Trickster', { description: '<p>A path.</p><div element="F"/><p>Closing.</p>' });
  const html = expandDescriptionWithChoices(path, indexOf(path, feature, ...tricks));
  assert.equal(
    html,
    '<p>A path.</p><div><h5>Tricks</h5><p>Learn tricks.</p><div><p><em>Choose 2 at level 3, then 1 more at level 7, from 2 options:</em></p>' +
      '<div><h6>Aim</h6><p>Aim well.</p></div><div><h6>Bounce</h6><p>Bounce off.</p></div></div></div><p>Closing.</p>',
  );
});

test('a choice of which an option embeds two or more elements is names: a class lists its subclasses, not their chapters', () => {
  // Fails if an option's embeds are not counted (the subclass is written out under the class), or if one embed is
  // enough to list names (the boon, which embeds one spell, is not written out).
  const sub = element('S', 'Path', 'Trickster', { supports: ['Path'], description: '<p>A path.</p><div element="X"/><div element="Y"/>' });
  const other = element('S2', 'Path', 'Warden', { supports: ['Path'], description: '<p>Another.</p>' });
  const cls = element('C', 'Class', 'Rogue', { rules: [select('Path', 'Path', 1, 'Path')] });
  const html = expandDescriptionWithChoices(cls, indexOf(cls, sub, other, element('X', 'Feature', 'Sneak'), element('Y', 'Feature', 'Hide')));
  assert.ok(html.endsWith('<p>Trickster, Warden.</p></div>'), html);
  const boon = element('B', 'Path', 'Boon', { supports: ['Boon'], description: '<p>A boon.</p><div element="X"/>' });
  const pact = element('P', 'Path', 'Pact', { rules: [select('Boon', 'Path', 1, 'Boon')] });
  assert.ok(expandDescriptionWithChoices(pact, indexOf(pact, boon, element('X', 'Feature', 'Sneak'))).includes('<h6>Boon</h6>'));
});

test('a choice of a type named by name, or of too many options to write out, is their names', () => {
  // Fails if the tools (a named type, with text) are written out, or the long list is not cut.
  const many = Array.from({ length: OPTIONS_WRITTEN_OUT + 5 }, (_, at) =>
    element(`M_${String(at).padStart(3, '0')}`, 'Feature', `Trick ${String(at).padStart(3, '0')}`, { supports: ['Trick'], description: '<p>Text.</p>' }),
  );
  const feature = element('F', 'Feature', 'Tools', { rules: [select('Tool', 'Tool', 1), select('Many', 'Feature', 1, 'Trick')] });
  const html = expandDescriptionWithChoices(
    feature,
    indexOf(feature, element('X', 'Tool', 'Hammer', { description: '<p>Hits nails.</p>' }), element('Y', 'Tool', 'Saw'), ...many),
    new Set(['Tool']),
  );
  assert.ok(html.includes('<p><em>Tool. Choose 1 of 2 options:</em></p><p>Hammer, Saw.</p>'), html);
  assert.ok(html.includes('Trick 039, and 65 more.</p>'), html);
  assert.ok(!html.includes('<h6>'), html);
});

function indexOf(...elements: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  for (const e of elements) index.add(e);
  return index;
}
