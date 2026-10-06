import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveAttacks, type AttackReader } from './attacks.ts';
import { createCharacter, type Character, type InventoryEntry } from './character.ts';
import { MapElementIndex, type Element, type Setter } from './model.ts';
import type { AttacksDef, InventoryDef } from './system.ts';

// A fixture with no game in it: "Blade", "keen", "far" and "might" are this file's words the way "Weapon", "finesse",
// "ranged" and "strength" are 5e's; core knows none of them.

function thing(id: string, name: string, type: string, setters: Record<string, string | Setter> = {}, supports: string[] = []): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = typeof value === 'string' ? { value } : value;
  return { id, type, name, source: 'test', setters: out, rules: [], supports, origin: { sourceId: 'test', format: 'incudo' } };
}

const ref = (stat: string) => ({ kind: 'ref', stat }) as const;

function declaration(overrides: Partial<AttacksDef> = {}): AttacksDef {
  return {
    types: ['Blade'],
    tagStat: 'blade',
    bonus: 'strike:bonus',
    damage: 'strike:damage',
    dice: 'hurt',
    damageType: 'kind',
    alternatives: [{ setter: 'both hands', label: 'two-handed' }],
    range: 'reach',
    nameSetter: 'naming',
    properties: { types: ['Trait'], labels: { TAG_KEEN: 'Keen' } },
    stats: [
      { stat: 'strike:ability', value: ref('might'), requirements: '![blade:TAG_KEEN]' },
      { stat: 'strike:ability', value: ref('grace'), requirements: '[blade:TAG_KEEN]' },
      { stat: 'strike:magic', value: { kind: 'setter', name: 'plus', as: 'number' } },
      { stat: 'strike:bonus', value: ref('strike:ability') },
      { stat: 'strike:bonus', value: ref('skill'), requirements: '{training}' },
      { stat: 'strike:bonus', value: ref('strike:magic') },
      { stat: 'strike:bonus', value: ref('{name}:bonus') },
      { stat: 'strike:damage', value: ref('strike:ability') },
      { stat: 'strike:damage', value: ref('strike:magic') },
    ],
    ...overrides,
  };
}

const INVENTORY: InventoryDef = {
  slotSetter: 'worn',
  occupiedTag: 'any',
  emptyTag: 'none',
  slots: [],
  attunement: { setter: 'bond', requires: 'yes' },
};

function reader(stats: Record<string, number>, held: string[] = []): AttackReader {
  return {
    hasElement: (id) => held.includes(id),
    statNumber: (stat) => stats[stat.toLowerCase()] ?? 0,
    statString: () => undefined,
    hasFlag: () => false,
  };
}

function bag(...entries: InventoryEntry[]): Character {
  return { ...createCharacter('test', 'kind'), inventory: entries };
}

function index(...elements: Element[]): MapElementIndex {
  const out = new MapElementIndex();
  out.addAll(elements);
  return out;
}

const SWORD = thing('SWORD', 'Sword', 'Blade', { hurt: { value: '1d8', attrs: { kind: 'cutting' } }, 'both hands': '1d10', training: 'TRAINED_SWORD' });
const KNIFE = thing('KNIFE', 'Knife', 'Blade', { hurt: '1d4', reach: '20/60', training: 'TRAINED_KNIFE' }, ['TAG_KEEN', 'TRAIT_QUICK', 'TAG_UNNAMED']);
const QUICK = thing('TRAIT_QUICK', 'Quick', 'Trait');
const ROPE = thing('ROPE', 'Rope', 'Gear');
const PLUS_ONE = thing('PLUS_ONE', 'Blade, +1', 'Charm', { plus: '1', naming: '{{parent}} +{{plus}}' });
const BONDED = thing('BONDED', 'Bonded Edge', 'Charm', { plus: '3', bond: 'yes' });
const STATS = { might: 3, grace: 1, skill: 2 };

test('a kind declaring no attacks has none', () => {
  assert.deepEqual(deriveAttacks(bag({ instanceId: 'a', elementId: 'SWORD', equipped: true }), index(SWORD), undefined, reader(STATS), INVENTORY), []);
});

test('every entry of an attack type is an attack, carried or equipped, in bag order, and nothing else is', () => {
  const attacks = deriveAttacks(
    bag(
      { instanceId: 'r', elementId: 'ROPE', equipped: true },
      { instanceId: 'k', elementId: 'KNIFE' },
      { instanceId: 's', elementId: 'SWORD', equipped: true },
      { instanceId: 'x', elementId: 'GONE', equipped: true },
    ),
    index(SWORD, KNIFE, ROPE, QUICK),
    declaration(),
    reader(STATS),
    INVENTORY,
  );
  // Fails if a carried entry is left out, if another type is let in, or if an unresolved entry becomes an attack.
  assert.deepEqual(attacks.map((a) => [a.instanceId, a.equipped]), [['k', false], ['s', true]]);
});

test("an attack's requirements read its own tags under the kind's tag stat", () => {
  const [knife, sword] = deriveAttacks(
    bag({ instanceId: 'k', elementId: 'KNIFE' }, { instanceId: 's', elementId: 'SWORD' }),
    index(SWORD, KNIFE, QUICK),
    declaration(),
    reader(STATS),
    INVENTORY,
  );
  // Fails if the tags are not published under `blade`: every attack would read `might`.
  assert.equal(knife!.stats['strike:ability'], 1, 'the tagged one reads grace');
  assert.equal(sword!.stats['strike:ability'], 3, 'the other reads might');
});

test('a placeholder in a requirement is filled from the element, and one it does not answer drops the contribution', () => {
  const entries = bag({ instanceId: 's', elementId: 'SWORD' }, { instanceId: 'k', elementId: 'KNIFE' });
  const held = deriveAttacks(entries, index(SWORD, KNIFE, QUICK), declaration(), reader(STATS, ['TRAINED_SWORD']), INVENTORY);
  // Fails if `{training}` is not filled (the id is never held) or is filled lowercased (ids compare exactly).
  assert.equal(held[0]!.bonus, 3 + 2, 'held: the ability and the skill');
  assert.equal(held[1]!.bonus, 1, 'not held: the ability alone');
  const untrained = thing('CLUB', 'Club', 'Blade', { hurt: '1d6' });
  const [club] = deriveAttacks(bag({ instanceId: 'c', elementId: 'CLUB' }), index(untrained), declaration(), reader(STATS, ['TRAINED_SWORD']), INVENTORY);
  assert.equal(club!.bonus, 3, 'no training setter, no contribution');
});

test("a reference's placeholders are filled, so a stat named after the element adds to it alone", () => {
  const attacks = deriveAttacks(
    bag({ instanceId: 's', elementId: 'SWORD' }, { instanceId: 'k', elementId: 'KNIFE' }),
    index(SWORD, KNIFE, QUICK),
    declaration(),
    reader({ ...STATS, 'sword:bonus': 4 }),
    INVENTORY,
  );
  // Fails if `{name}` is not filled.
  assert.equal(attacks[0]!.bonus, 3 + 4);
  assert.equal(attacks[1]!.bonus, 1);
});

test('a reference reads an attack stat summed so far, else the character\'s', () => {
  const [sword] = deriveAttacks(
    bag({ instanceId: 's', elementId: 'SWORD' }),
    index(SWORD),
    declaration({
      stats: [
        { stat: 'might', value: { kind: 'number', value: 10 } },
        { stat: 'strike:bonus', value: ref('might') },
        { stat: 'strike:damage', value: ref('grace') },
      ],
    }),
    reader(STATS),
    INVENTORY,
  );
  assert.equal(sword!.bonus, 10, 'its own might, not the character\'s');
  assert.equal(sword!.damageBonus, 1, 'the character\'s grace');
});

test("a number setter is summed over the element and its adornments, and an unattuned one's is not read", () => {
  const attuned = deriveAttacks(
    bag(
      { instanceId: 'a', elementId: 'SWORD', adorners: [{ elementId: 'PLUS_ONE' }] },
      { instanceId: 'b', elementId: 'SWORD', adorners: [{ elementId: 'BONDED' }], attuned: true },
      { instanceId: 'c', elementId: 'SWORD', adorners: [{ elementId: 'BONDED' }] },
    ),
    index(SWORD, PLUS_ONE, BONDED),
    declaration(),
    reader(STATS),
    INVENTORY,
  );
  // Fails if adornments are not read (all 3), if an unattuned bond is read (the last 6), or if the sum is not added
  // to both numbers.
  assert.deepEqual(attuned.map((a) => [a.bonus, a.damageBonus]), [[4, 4], [6, 6], [3, 3]]);
});

test("an attack is called the user's name, else an adornment's naming setter filled, else the element's", () => {
  const attacks = deriveAttacks(
    bag(
      { instanceId: 'a', elementId: 'SWORD', name: 'Old Faithful', adorners: [{ elementId: 'PLUS_ONE' }] },
      { instanceId: 'b', elementId: 'SWORD', adorners: [{ elementId: 'PLUS_ONE' }] },
      { instanceId: 'c', elementId: 'SWORD', adorners: [{ elementId: 'BONDED' }], attuned: true },
    ),
    index(SWORD, PLUS_ONE, BONDED),
    declaration(),
    reader(STATS),
    INVENTORY,
  );
  assert.deepEqual(attacks.map((a) => a.name), ['Old Faithful', 'Sword +1', 'Sword']);
});

test('the die, its type, another die and the range are written as content writes them; the properties by name', () => {
  const [sword, knife] = deriveAttacks(
    bag({ instanceId: 's', elementId: 'SWORD' }, { instanceId: 'k', elementId: 'KNIFE' }),
    index(SWORD, KNIFE, QUICK),
    declaration(),
    reader(STATS),
    INVENTORY,
  );
  assert.equal(sword!.dice, '1d8');
  assert.equal(sword!.damageType, 'cutting');
  assert.deepEqual(sword!.alternatives, [{ label: 'two-handed', dice: '1d10' }]);
  assert.equal(sword!.range, undefined);
  assert.equal(knife!.range, '20/60');
  assert.equal(knife!.damageType, undefined);
  // An element of a property type by its name, a tag naming nothing by its label, and a tag neither answers left out;
  // sorted by name. Fails if the labels or the types are not read.
  assert.deepEqual(knife!.properties, ['Keen', 'Quick']);
  assert.deepEqual(sword!.properties, []);
});
