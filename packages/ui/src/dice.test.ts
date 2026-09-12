/**
 * Dice notation. The corpus declares exactly one of these (`4d6dl1`), so the interesting
 * assertions are the ones about what happens to everything else.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDice, rollDice } from './dice.ts';

function spec(notation: string) {
  const parsed = parseDice(notation);
  assert.equal(parsed.ok, true, `expected "${notation}" to parse`);
  return parsed.ok ? parsed.spec : undefined!;
}

/** A random() that walks a chosen list, so a roll is a known number. */
function sequence(values: number[], sides: number): () => number {
  let i = 0;
  // random() is in [0, 1) and the roller does 1 + floor(r * sides), so this is the inverse.
  // Past the end every die comes up 1, deliberately: a set this did not intend to produce
  // (an unwanted reroll, say) reads as a 3 rather than quietly reproducing the same numbers.
  return () => ((values[i++] ?? 1) - 1) / sides;
}

test('the one notation the corpus uses', () => {
  assert.deepEqual(spec('4d6dl1'), {
    count: 4,
    sides: 6,
    dropLowest: 1,
    dropHighest: 0,
    modifier: 0,
  });
});

test('keeping the highest N is dropping the lowest, normalised', () => {
  // The same instruction counted from the other end: both are "the best three of four".
  assert.deepEqual(spec('4d6kh3'), spec('4d6dl1'));
});

test('a bare die, a modifier, and drop-highest', () => {
  assert.deepEqual(spec('d20'), { count: 1, sides: 20, dropLowest: 0, dropHighest: 0, modifier: 0 });
  assert.equal(spec('2d6+3').modifier, 3);
  assert.equal(spec('2d6-1').modifier, -1);
  assert.equal(spec('3d8dh1').dropHighest, 1);
});

test('an unreadable notation is reported, never guessed at', () => {
  for (const bad of ['', 'four d six', '4x6', '0d6', '4d1', '4d6dl4', 'd6+', '4d6dl']) {
    const parsed = parseDice(bad);
    assert.equal(parsed.ok, false, `"${bad}" should not parse`);
    if (!parsed.ok) assert.ok(parsed.reason.length > 0, 'and it says why');
  }
});

test('4d6dl1 drops the lowest die and sums the rest', () => {
  const roll = rollDice(spec('4d6dl1'), sequence([6, 1, 4, 3], 6));
  assert.deepEqual(roll.rolled, [6, 1, 4, 3]);
  assert.deepEqual(roll.dropped, [1]);
  assert.equal(roll.total, 13);
});

test('a duplicated lowest drops only as many as asked', () => {
  const roll = rollDice(spec('4d6dl1'), sequence([2, 2, 5, 5], 6));
  assert.deepEqual(roll.dropped, [2]);
  assert.equal(roll.total, 12, 'the second 2 is kept');
});

test('the modifier lands after the drop', () => {
  const roll = rollDice(spec('4d6dl1+2'), sequence([1, 1, 1, 1], 6));
  assert.equal(roll.total, 5);
});

test('rolling never returns a value outside the die', () => {
  // Both ends of random()'s range, which is where an off-by-one would show.
  let calls = 0;
  const roll = rollDice(spec('100d6'), () => (calls++ % 2 === 0 ? 0 : 0.999999));
  for (const die of roll.rolled) assert.ok(die >= 1 && die <= 6, `${die} is not a d6`);
  assert.ok(roll.rolled.includes(1) && roll.rolled.includes(6));
});
