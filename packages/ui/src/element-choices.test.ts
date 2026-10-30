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

import { elementChoiceLine, elementChoices } from './element-choices.ts';

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

function indexOf(...elements: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  for (const e of elements) index.add(e);
  return index;
}
