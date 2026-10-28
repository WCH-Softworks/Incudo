/**
 * What a section writes of each listed element beside its name — ADR 0126 decision 6. No game in the fixture: a charm's
 * reach and wording as setters, and three flags that share one label. Each test names the change that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { SheetFactDef } from '@incudo/core';

import { listedAside, listedFacts } from './sheet-document.ts';
import { sheetFacts } from './sheet.ts';

const DEFS: SheetFactDef[] = [
  { label: 'Reach', setter: 'reach' },
  { label: 'Words', setter: 'Words' },
  { label: 'Marks', flag: 'hasRed', text: 'R' },
  { label: 'Marks', flag: 'hasBlue', text: 'B' },
  { label: 'Marks', flag: 'hasGreen', text: 'G' },
];
const setters = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }]));

test('a setter is written as plain text, a flag only when true, and facts sharing a label are one', () => {
  // Fails if a setter is matched by exact case (Words), its HTML or its spacing is kept, a flag reading "false" writes its
  // text, or two flags of one label make two facts.
  const facts = sheetFacts({ setters: setters({ reach: ' 30  feet ', words: 'a <i>loud</i>\n shout', hasRed: 'true', hasBlue: 'false', hasGreen: 'TRUE' }) }, DEFS);
  assert.deepEqual(facts, [
    { label: 'Reach', text: '30 feet' },
    { label: 'Words', text: 'a loud shout' },
    { label: 'Marks', text: 'R, G' },
  ]);
  // What an element does not say is not written.
  assert.deepEqual(sheetFacts({ setters: setters({ hasBlue: 'false' }) }, DEFS), []);
});

test('on paper the facts follow the aside, each its own part, and a screen can leave them out', () => {
  // Fails if listedAside drops the facts, joins them with the commas a fact holds, or writes them when asked not to.
  const element = { group: { value: '1', label: 'Level 1' }, facts: [{ label: 'Reach', text: '30 feet' }, { label: 'Marks', text: 'R, G' }] };
  assert.equal(listedFacts(element), '30 feet; R, G');
  assert.equal(listedAside(element), 'Level 1; 30 feet; R, G');
  assert.equal(listedAside(element, false), 'Level 1');
  assert.equal(listedAside({ facts: element.facts }), '30 feet; R, G');
});
