/**
 * An item that sets an ability score is a lower bound on it — ADR 0044, decision 4.
 *
 * Content writes `<stat name="constitution:score:set" value="19" bonus="base" />` on an Amulet of
 * Health and 34 other rules like it, and nothing read the stat, so the wearer stayed at the score they had.
 * `aurora verify` cannot see it (it compares chosen elements, never a score), so the evidence is
 * perturbation, here: delete a `min` from `systems/dnd5e/system.json` and the matching case fails.
 * The oracle's hit point disagreement on the two samples wearing that amulet, exactly ten low, is what
 * showed it; those samples agree once this holds.
 *
 * A score an item sets may exceed the usual 20 (a Belt of Hill Giant Strength sets 21), so the maximum
 * is the larger of the usual cap and the set score, and a `max` that ignored it would clamp the belt.
 *
 * Lives in `tools/verify` because every noun in it is 5e's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MapElementIndex,
  createCharacter,
  deriveCharacter,
  setBaseStat,
  type Character,
  type Element,
  type GameSystem,
} from '@incudo/core';

import { loadShippedSystem } from './node-system.ts';

function item(id: string, rules: Element['rules']): Element {
  return {
    id,
    type: 'Race',
    name: id,
    source: 'test',
    setters: {},
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

const set = (stat: string, value: number, bonus?: string): Element['rules'][number] => ({
  kind: 'stat',
  key: `${stat}:${value}`,
  name: `${stat}:score:set`,
  value: { kind: 'number', value },
  ...(bonus ? { bonus } : {}),
});

function read(system: GameSystem, score: number, items: Element[], stat = 'constitution') {
  const index = new MapElementIndex();
  index.addAll(items);
  let c: Character = createCharacter('dnd5e', 'pc', { progress: 1 });
  c = setBaseStat(c, stat, score);
  c = { ...c, choices: [{ ruleKey: 'build/race', elementIds: items.map((i) => i.id) }] };
  const derived = deriveCharacter(c, system, index);
  return {
    score: derived.stats.get(stat)?.value,
    modifier: derived.stats.get(`${stat}:modifier`)?.value,
  };
}

test('an item that sets a score raises a lower one, and the modifier follows', async () => {
  const system = await loadShippedSystem('dnd5e');
  const amulet = item('AMULET', [set('constitution', 19, 'base')]);
  assert.deepEqual(read(system, 14, [amulet]), { score: 19, modifier: 4 });
});

test('it does nothing for a score already at or above the one it sets', async () => {
  const system = await loadShippedSystem('dnd5e');
  const amulet = item('AMULET', [set('constitution', 19, 'base')]);
  assert.equal(read(system, 19, [amulet]).score, 19);
  assert.equal(read(system, 20, [amulet]).score, 20);
});

test('two items in the same bucket do not stack: the higher one wins, even above 20', async () => {
  const system = await loadShippedSystem('dnd5e');
  const a = item('A', [set('strength', 19, 'base')]);
  const b = item('B', [set('strength', 21, 'base')]);
  assert.equal(read(system, 12, [a, b], 'strength').score, 21, 'above the usual 20: the item is what lifts the cap');
  const lower = item('C', [set('strength', 17, 'base')]);
  assert.equal(read(system, 12, [a, lower], 'strength').score, 19);
});

test('every ability reads its own set stat', async () => {
  const system = await loadShippedSystem('dnd5e');
  for (const stat of ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']) {
    const it = item('IT', [set(stat, 18, 'base')]);
    assert.equal(read(system, 8, [it], stat).score, 18, stat);
    // and it leaves the other five alone
    for (const other of ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']) {
      if (other !== stat) assert.equal(read(system, 8, [it], other).score, 8, `${stat} set leaves ${other}`);
    }
  }
});
