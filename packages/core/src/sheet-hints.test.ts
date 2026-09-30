/**
 * The one reader of content's sheet text — ADR 0076. Each case names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { halfReference } from './expression.ts';
import type { SheetHints } from './model.ts';
import { sheetDescriptionAt, sheetDescriptions, sheetPlaceholders } from './sheet-hints.ts';

const RAGE: SheetHints = {
  action: 'Bonus Action',
  usage: '{{rage:count}}/Long Rest',
  description: 'At first.',
  descriptions: [
    { text: 'At first.' },
    { text: 'From nine.', level: 9 },
    { text: 'From twenty.', level: 20, usage: 'Unlimited' },
  ],
};

test('the description at a level is the highest gate at or below it, else the ungated one', () => {
  // Fails with the first description returned at every level (the importer's old reading), or with the gate compared
  // as `<` (level 9 reads "At first.").
  assert.equal(sheetDescriptionAt(RAGE, 1)?.text, 'At first.');
  assert.equal(sheetDescriptionAt(RAGE, 8)?.text, 'At first.');
  assert.equal(sheetDescriptionAt(RAGE, 9)?.text, 'From nine.');
  assert.equal(sheetDescriptionAt(RAGE, 19)?.text, 'From nine.');
  assert.equal(sheetDescriptionAt(RAGE, 20)?.usage, 'Unlimited');
});

test('order written does not decide the level, and of two at one level the later wins', () => {
  // Fails with "the last description at or below the level" in file order (level 12 reads "From three.").
  const hints: SheetHints = {
    descriptions: [{ text: 'From ten.', level: 10 }, { text: 'From three.', level: 3 }, { text: 'Also three.', level: 3 }],
  };
  assert.equal(sheetDescriptionAt(hints, 12)?.text, 'From ten.');
  assert.equal(sheetDescriptionAt(hints, 5)?.text, 'Also three.');
  assert.equal(sheetDescriptionAt(hints, 2), undefined, 'nothing applies below every gate');
});

test('hints saved before every description was kept read their one description at every level', () => {
  // Fails with `sheetDescriptions` reading `descriptions` only: a save written before ADR 0076 would show nothing.
  const old: SheetHints = { usage: '1/Long Rest', description: 'The first text.' };
  assert.deepEqual(sheetDescriptions(old), [{ text: 'The first text.' }]);
  assert.equal(sheetDescriptionAt(old, 1)?.text, 'The first text.');
  assert.equal(sheetDescriptionAt(old, 20)?.text, 'The first text.');
  assert.deepEqual(sheetDescriptions({ display: false }), []);
  assert.deepEqual(sheetDescriptions(undefined), []);
});

test('a placeholder is two braces around a name, trimmed; an empty pair is not one', () => {
  // Fails with the name left untrimmed (`" proficiency "`), or with `{{}}` read as naming the empty stat.
  const text = 'Deal +{{ barbarian rage:damage }} damage, {{proficiency}}/day, {{level:wizard:half:up}} and {{}}.';
  assert.deepEqual(
    sheetPlaceholders(text).map((p) => [p.stat, text.slice(p.start, p.end)]),
    [
      ['barbarian rage:damage', '{{ barbarian rage:damage }}'],
      ['proficiency', '{{proficiency}}'],
      ['level:wizard:half:up', '{{level:wizard:half:up}}'],
    ],
  );
  assert.deepEqual(sheetPlaceholders(undefined), []);
  assert.deepEqual(sheetPlaceholders('No braces, {one} only.'), []);
});

test('the `:half` suffix is read once, for an expression and for a sheet alike', () => {
  // Fails with `halfReference` keeping the case written (a sheet would look up `Level:Wizard`), or reading `:half` as up.
  assert.deepEqual(halfReference('Level:Wizard:half:up'), { base: 'level:wizard', up: true });
  assert.deepEqual(halfReference('proficiency:half'), { base: 'proficiency', up: false });
  assert.equal(halfReference('proficiency'), undefined);
  assert.equal(halfReference(':half'), undefined);
});
