/**
 * Money: a system's coinage and a character's purse — ADR 0087 decision 5.
 *
 * The fixture's coins are no game's: beads, shells, pearls and an awkward knot worth half a pearl or three shells. Each
 * test names the change that fails it, and each was run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addMoney, createCharacter, setMoney, setStartingEquipmentTaken } from './character.ts';
import { currencyProblems, currencyWorths, type CurrencyUnitDef } from './system.ts';

const COINS: Record<string, CurrencyUnitDef> = {
  bead: { label: 'Bead' },
  shell: { label: 'Shell', exchangeRate: { bead: 10 } },
  knot: { label: 'Knot', exchangeRate: { shell: 5 } },
  pearl: { label: 'Pearl', exchangeRate: { shell: 10, knot: 2 } },
};

// Fails if a second route is taken rather than compared, or a rate is read the wrong way round.
test('rates that agree pass, and each unit is worth what the rates make it', () => {
  assert.deepEqual(currencyProblems(COINS), []);
  assert.deepEqual(Object.fromEntries(currencyWorths(COINS)!), { bead: 1, shell: 10, knot: 50, pearl: 100 });
  assert.deepEqual(currencyProblems(undefined), []);
  assert.equal(currencyWorths(undefined), undefined);
});

// Fails if only one route to a unit is ever followed: knot → shell says 50 beads, knot → pearl says 30.
test('two routes that disagree are refused, with both named', () => {
  const problems = currencyProblems({ ...COINS, pearl: { label: 'Pearl', exchangeRate: { shell: 10, knot: 2 } }, knot: { label: 'Knot', exchangeRate: { shell: 3 } } });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /two routes to .* disagree/);
  assert.match(problems[0]!, /1 knot = 3 shell/);
  assert.match(problems[0]!, /1 pearl = 2 knot/);
  assert.equal(currencyWorths({ ...COINS, knot: { label: 'Knot', exchangeRate: { shell: 3 } } }), undefined);
});

// Fails if a unit no rate touches is let through, or a rate naming an undeclared unit is read.
test('a unit nothing reaches, an undeclared unit and a rate that is not positive are refused', () => {
  assert.deepEqual(currencyProblems({ ...COINS, stone: { label: 'Stone' } }), ['stone cannot be reached from bead through any rate']);
  assert.deepEqual(currencyProblems({ bead: { label: 'Bead', exchangeRate: { gem: 2 } } }), [
    'bead is worth 2 gem, and "gem" is not a unit this system declares',
  ]);
  assert.deepEqual(currencyProblems({ bead: { label: 'Bead' }, shell: { label: 'Shell', exchangeRate: { bead: 0 } } }), [
    'shell is worth 0 bead, and a rate must be a positive number',
  ]);
});

// Fails if zeros are written, a fraction or a negative count is kept, or the version moves for an empty purse.
test('a purse records only what is non-zero, whole counts, and raises the format to 11', () => {
  const fresh = createCharacter('test', 'hero');
  assert.equal(setMoney(fresh, { bead: 0 }), fresh);
  const held = setMoney(fresh, { bead: 3.7, shell: 0, pearl: -2 });
  assert.deepEqual(held.money, { bead: 3 });
  assert.equal(held.formatVersion, 11);
  const emptied = setMoney(held, {});
  assert.equal(emptied.money, undefined);
  assert.equal(emptied.formatVersion, 11);
  assert.deepEqual(addMoney(held, { bead: -10, pearl: 2 }).money, { pearl: 2 });
});

// Fails if a second record for one class is appended rather than replacing, or forgetting the last leaves `[]`.
test('a taken package is recorded once per class or background, and forgetting the last leaves no field', () => {
  const fresh = createCharacter('test', 'hero');
  const one = setStartingEquipmentTaken(fresh, 'ID_X', { for: 'ID_X', option: 'a' });
  assert.equal(one.formatVersion, 11);
  const two = setStartingEquipmentTaken(one, 'ID_X', { for: 'ID_X', option: 'b' });
  assert.deepEqual(two.startingEquipment, [{ for: 'ID_X', option: 'b' }]);
  assert.equal(setStartingEquipmentTaken(two, 'ID_X', undefined).startingEquipment, undefined);
  assert.equal(setStartingEquipmentTaken(fresh, 'ID_Y', undefined), fresh);
});
