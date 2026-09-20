/**
 * 5e's armour class, against the real `systems/dnd5e/system.json` — ADR 0026.
 *
 * **Nothing verifies these numbers except this file.** No `.dnd5e` save records an armour
 * class, so `aurora verify` has no comparison to make and never will; `ac` is in hit points'
 * position (ADR 0019), derived from a published rule and checked by reading. What is here is
 * therefore the arithmetic worked by hand against the Player's Handbook, and — more
 * usefully — **perturbation**: force a slot and watch the base, the cap and the floor change.
 * A formula that agrees with a character it cannot disagree with has proved nothing, and the
 * nine sample saves are full of those: both characters in heavy armour have a Dexterity
 * modifier of exactly 0, and both in medium armour have exactly +2.
 *
 * It lives here rather than in `packages/core` because every noun in it is 5e's. Core's half
 * of the same mechanism is `packages/core/src/contributions.test.ts`, where the words are
 * made up on purpose.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  MapElementIndex,
  createCharacter,
  deriveCharacter,
  resolveCharacterKind,
  validateGameSystem,
  type Character,
  type Element,
  type GameSystem,
  type InventoryEntry,
  type ResolvedCharacterKind,
  type Rule,
  type Setter,
} from '@incudo/core';

import { loadSchemas, systemsDirectory } from './node-system.ts';

let cached: { system: GameSystem; kind: ResolvedCharacterKind } | undefined;

async function fiveE(): Promise<{ system: GameSystem; kind: ResolvedCharacterKind }> {
  if (cached) return cached;
  const path = join(systemsDirectory(), 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  cached = { system: result.value!, kind: resolveCharacterKind(result.value!, 'pc') };
  return cached;
}

/**
 * Stand-ins for the corpus's own elements, written from what it actually says.
 *
 * Plate really is `slot="body"`, `armor="Heavy"`, `<stat name="ac:armored:armor" value="18"/>`
 * with no bonus bucket — see the table in ADR 0026. These are hand-made so the test runs
 * without a 740-file licensed corpus on the machine, not because the real ones differ.
 */
function item(
  id: string,
  name: string,
  setters: Record<string, string>,
  rules: Rule[] = [],
): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return { id, type: 'Armor', name, source: 'test', setters: out, rules, supports: [], origin: { sourceId: 'test', format: 'incudo' } };
}

function armourStat(name: string, value: number, bonus?: string): Rule {
  return { kind: 'stat', key: `r:${name}:${value}`, name, value: { kind: 'number', value }, ...(bonus ? { bonus } : {}) };
}

const PLATE = item('PLATE', 'Plate', { slot: 'body', armor: 'Heavy' }, [armourStat('ac:armored:armor', 18)]);
const HALF_PLATE = item('HALF_PLATE', 'Half Plate', { slot: 'body', armor: 'Medium' }, [armourStat('ac:armored:armor', 15)]);
const BREASTPLATE = item('BREASTPLATE', 'Breastplate', { slot: 'body', armor: 'Medium' }, [armourStat('ac:armored:armor', 14)]);
const STUDDED = item('STUDDED', 'Studded Leather', { slot: 'body', armor: 'Light' }, [armourStat('ac:armored:armor', 12)]);
const SHIELD = item('SHIELD', 'Shield', { slot: 'onehand,secondary', armor: 'Shield' }, [armourStat('ac:shield', 2, 'shield')]);
const ROBE = item('ROBE', 'Robe of Useful Items', { slot: 'body' }, []);
const PLUS_ONE = item('PLUS_ONE', 'Armor, +1', {}, [armourStat('ac:armored:enhancement', 1, 'enhancement')]);
const CLOAK = item('CLOAK', 'Cloak of Protection', { slot: 'shoulders' }, [armourStat('ac:misc', 1)]);
const MEDIUM_ARMOR_MASTER = item('MAM', 'Medium Armor Master', {}, [armourStat('ac:armored:dexterity:cap', 3, 'base')]);
const UNARMOURED_DEFENCE = item('UD', 'Unarmored Defense', {}, [
  {
    kind: 'stat',
    key: 'r:ud',
    name: 'ac:calculation',
    bonus: 'calculation',
    value: { kind: 'number', value: 18 },
    equipped: { kind: 'and', children: [{ kind: 'equals', stat: 'armor', value: 'none' }, { kind: 'equals', stat: 'shield', value: 'none' }] },
  },
]);

const CONTENT = [PLATE, HALF_PLATE, BREASTPLATE, STUDDED, SHIELD, ROBE, PLUS_ONE, CLOAK, MEDIUM_ARMOR_MASTER, UNARMOURED_DEFENCE];

function indexWith(...extra: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll([...CONTENT, ...extra]);
  return index;
}

interface Build {
  dexterity?: number;
  wearing?: string[];
  carrying?: string[];
  choices?: string[];
}

function character(build: Build = {}): Character {
  const base = createCharacter('dnd5e', 'pc', { progress: 5 });
  const entries: InventoryEntry[] = [
    ...(build.wearing ?? []).map((elementId, i) => ({ instanceId: `w${i}`, elementId, equipped: true })),
    ...(build.carrying ?? []).map((elementId, i) => ({ instanceId: `c${i}`, elementId, equipped: false })),
  ];
  return {
    ...base,
    baseStats: { dexterity: build.dexterity ?? 10 },
    inventory: entries,
    choices: build.choices?.length ? [{ ruleKey: 'build/test', elementIds: build.choices }] : [],
  };
}

async function ac(build: Build = {}, extra: Element[] = []): Promise<number> {
  const { system, kind } = await fiveE();
  return deriveCharacter(character(build), system, indexWith(...extra), { kind }).stats.get('ac')!.value;
}

async function statsOf(build: Build = {}): Promise<(key: string) => number> {
  const { system, kind } = await fiveE();
  const derived = deriveCharacter(character(build), system, indexWith(), { kind });
  return (key: string) => derived.stats.get(key)?.value ?? 0;
}

// --- the nine sample saves, worked by hand -----------------------------------

test('the nine sample saves, reproduced from their armour and their Dexterity', async () => {
  // The inputs are the ones the real saves produce (ADR 0026's table); the sums are the ones
  // this formula produces. The saves record no armour class, so the right column is checked
  // against the Player's Handbook and against nothing else.
  const rows: [string, Build, number][] = [
    ['Bran Brightwood — plate, Dex 10', { dexterity: 10, wearing: ['PLATE'] }, 18],
    ['Hexadin — breastplate, Dex 14, +1 fighting style', { dexterity: 14, wearing: ['BREASTPLATE', 'CLOAK'] }, 17],
    ['Krusk Oathfang — studded leather +1, Dex 20', { dexterity: 20, wearing: ['STUDDED', 'PLUS_ONE'] }, 18],
    ['Merilio — half plate, Dex 14, +1 cloak', { dexterity: 14, wearing: ['HALF_PLATE', 'CLOAK'] }, 18],
    ['Theren Liadon — studded leather, Dex 18', { dexterity: 18, wearing: ['STUDDED'] }, 16],
    ['Paelias Amakiir — unarmoured, Dex 14, +1', { dexterity: 14, wearing: ['CLOAK'] }, 13],
    ['arturo — unarmoured, Dex 20, +1', { dexterity: 20, wearing: ['CLOAK'] }, 16],
    ['Vigaro Safeguard — plate +1, Dex 10, +1', { dexterity: 10, wearing: ['PLATE', 'PLUS_ONE', 'CLOAK'] }, 20],
    // Deusinaldo the monk: Unarmoured Defence publishes a complete 18, and the armoured
    // branch offers 10 + 4. `max` takes the calculation, which is what "you may use" means.
    ['Deusinaldo — monk, Dex 18, Unarmoured Defence 18', { dexterity: 18, choices: ['UD'] }, 18],
  ];

  for (const [label, build, expected] of rows) {
    assert.equal(await ac(build), expected, label);
  }
});

test('a bare character, with no content at all, is armour class 10', async () => {
  const { system, kind } = await fiveE();
  const bare = deriveCharacter(createCharacter('dnd5e', 'pc'), system, new MapElementIndex(), { kind });
  assert.equal(bare.stats.get('ac')?.value, 10);
  // And the 10 comes from the kind's contribution, not from a StatDef default: keeping both
  // would have read 20. The `pc` kind's `ac` deliberately replaces the system's defaulted one.
  assert.equal(bare.stats.get('ac:armored:armor')?.value, 10);
});

// --- perturbation: the part that is actually evidence -------------------------

test('putting armour on moves the base, the cap and the floor together', async () => {
  const unarmoured = await statsOf({ dexterity: 14 });
  assert.deepEqual(
    ['ac:armored:armor', 'ac:armored:dexterity:cap', 'ac:armored:dexterity:floor'].map(unarmoured),
    [10, 99, -99],
  );

  const light = await statsOf({ dexterity: 14, wearing: ['STUDDED'] });
  assert.deepEqual(
    ['ac:armored:armor', 'ac:armored:dexterity:cap', 'ac:armored:dexterity:floor'].map(light),
    [12, 99, -99],
    'light armour supplies its own base and caps nothing',
  );

  const medium = await statsOf({ dexterity: 14, wearing: ['HALF_PLATE'] });
  assert.deepEqual(
    ['ac:armored:armor', 'ac:armored:dexterity:cap', 'ac:armored:dexterity:floor'].map(medium),
    [15, 2, -99],
  );

  const heavy = await statsOf({ dexterity: 14, wearing: ['PLATE'] });
  assert.deepEqual(
    ['ac:armored:armor', 'ac:armored:dexterity:cap', 'ac:armored:dexterity:floor'].map(heavy),
    [18, 0, 0],
    'heavy armour is the only row that raises the floor',
  );

  // The system's base of 10 never lands beside an armour's own, which is the reason that one
  // contribution asks `[armor:none]` exactly while the bounds ask their questions loosely.
  assert.equal(light('ac:armored:armor'), 12, 'not 22');
});

test('the medium cap bites at a Dexterity the sample saves do not have', async () => {
  // Both medium-armoured saves have a Dexterity modifier of exactly +2, where min(2, 2) and
  // min(2, 99) agree. This is the case that tells them apart: half plate 15 plus at most 2.
  assert.equal(await ac({ dexterity: 18, wearing: ['HALF_PLATE'] }), 17);
  assert.equal(await ac({ dexterity: 14, wearing: ['HALF_PLATE'] }), 17);
  // Light armour of the same Dexterity is not capped, so the two diverge.
  assert.equal(await ac({ dexterity: 18, wearing: ['STUDDED'] }), 16);
  assert.equal(await ac({ dexterity: 14, wearing: ['STUDDED'] }), 14);
});

test('Medium Armor Master raises a cap the system wrote, rather than adding to it', async () => {
  // `bonus="base"` and largest-wins: the feat's 3 replaces the kind's 2. Summed, the cap
  // would be 5 and half plate with Dexterity 18 would read 19 instead of 18.
  const feat = await statsOf({ dexterity: 18, wearing: ['HALF_PLATE'], choices: ['MAM'] });
  assert.equal(feat('ac:armored:dexterity:cap'), 3);
  assert.equal(await ac({ dexterity: 18, wearing: ['HALF_PLATE'], choices: ['MAM'] }), 18);
});

test('heavy armour does not penalise a negative Dexterity modifier', async () => {
  // The PHB sentence the plan's four-row table could not express, and the reason ADR 0026 has
  // six rows. A cap of 0 alone would read 17 here.
  assert.equal(await ac({ dexterity: 8, wearing: ['PLATE'] }), 18);
  // Light and medium armour do apply it, which is why the floor cannot simply be 0 everywhere.
  assert.equal(await ac({ dexterity: 8, wearing: ['STUDDED'] }), 11);
  assert.equal(await ac({ dexterity: 8, wearing: ['HALF_PLATE'] }), 14);
  assert.equal(await ac({ dexterity: 8, wearing: [] }), 9);
});

test('a shield adds to whichever calculation won, and nobody in the nine carries one', async () => {
  // `ac:shield` is 0 on all nine sample saves, so this term has never been exercised by a real
  // character. Forcing it is the only evidence there is.
  assert.equal(await ac({ dexterity: 14, wearing: ['PLATE'] }), 18);
  assert.equal(await ac({ dexterity: 14, wearing: ['PLATE', 'SHIELD'] }), 20);

  // And a shield turns Unarmoured Defence off, because content gates it on `[shield:none]` —
  // so the monk falls back to the armoured branch of 10 + Dexterity.
  assert.equal(await ac({ dexterity: 18, choices: ['UD'] }), 18);
  assert.equal(await ac({ dexterity: 18, wearing: ['SHIELD'], choices: ['UD'] }), 16);
});

test('a carried suit of armour is not a worn one', async () => {
  assert.equal(await ac({ dexterity: 14, carrying: ['PLATE'] }), 12, '10 + 2, not 18');
  assert.equal(await ac({ dexterity: 14, wearing: ['PLATE'] }), 18);
});

test('a body-slot item that is not armour keeps its Dexterity, and loses the base', async () => {
  // 103 of the corpus's 127 body-slot elements are adorners with no armour category. They
  // occupy nothing when worn on a host, but a user can equip one alone, and this is what that
  // reads: the permissive bounds keep the Dexterity bonus, and the exact base is gone.
  // Recorded as the measured behaviour, not as a claim that it is right (ADR 0026).
  const worn = await statsOf({ dexterity: 18, wearing: ['ROBE'] });
  assert.equal(worn('ac:armored:dexterity:cap'), 99);
  assert.equal(worn('ac:armored:dexterity:floor'), -99);
  assert.equal(worn('ac:armored:armor'), 0);
  assert.equal(await ac({ dexterity: 18, wearing: ['ROBE'] }), 4);
});

test('a monster keeps the armour class its stat block says, and derives nothing', async () => {
  const { system } = await fiveE();
  for (const kindId of ['npc', 'legendary']) {
    const kind = resolveCharacterKind(system, kindId);
    const monster = createCharacter('dnd5e', kindId);
    const derived = deriveCharacter(monster, system, new MapElementIndex(), { kind });
    assert.equal(derived.stats.get('ac')?.value, 10, `${kindId} keeps the system default`);
    // No inventory, so no slot to ask about, and no contribution to make one up.
    assert.equal(kind.inventory, undefined);
    assert.deepEqual(kind.contributions, []);
    assert.equal(derived.stats.get('ac:armored:armor'), undefined);
  }
});

test('the attunement limit is 3, and it is contributed rather than defaulted', async () => {
  const { system, kind } = await fiveE();
  const relic = item('RELIC', 'Ring of Protection', { slot: 'ring', attunement: 'true' }, [armourStat('ac:misc', 1)]);
  const index = indexWith(relic);

  const one = deriveCharacter(
    { ...character(), inventory: [{ instanceId: 'a', elementId: 'RELIC', equipped: true, attuned: true }] },
    system,
    index,
    { kind },
  );
  assert.equal(one.stats.get('attunement:max')?.value, 3);
  assert.equal(one.stats.get('attunement:current')?.value, 1);
  assert.deepEqual(one.problems.filter((p) => p.code === 'over-attuned'), []);

  const four = deriveCharacter(
    {
      ...character(),
      inventory: Array.from({ length: 4 }, (_, i) => ({
        instanceId: `a${i}`,
        elementId: 'RELIC',
        equipped: true,
        attuned: true,
      })),
    },
    system,
    index,
    { kind },
  );
  assert.equal(four.stats.get('attunement:current')?.value, 4);
  assert.equal(four.problems.filter((p) => p.code === 'over-attuned').length, 1);
});
