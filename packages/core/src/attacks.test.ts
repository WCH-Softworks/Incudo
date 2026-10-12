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

// --- ADR 0110: rows no item gives, another row of a held attack, and a range an element does not write ---------------

const INNATE: AttacksDef['innate'] = [
  {
    name: 'Fist',
    stats: [
      { stat: 'strike:ability', value: ref('might') },
      { stat: 'strike:bonus', value: ref('strike:ability') },
      { stat: 'strike:bonus', value: ref('{name}:bonus') },
      { stat: 'strike:damage', value: ref('strike:ability') },
    ],
    sides: ref('fist:die'),
    flat: '1',
    damageType: 'crushing',
    range: 'touch',
  },
];

test('a row the kind always has adds up its own stats, its die from a stat or its flat text', () => {
  // Fails if innate rows are not derived, if `{name}` is not filled with the row's name, or if `sides` or `flat` is
  // not read.
  const [bare] = deriveAttacks(bag(), index(), declaration({ innate: INNATE }), reader({ might: 3, 'fist:bonus': 1 }), INVENTORY);
  assert.equal(bare?.innate, true);
  assert.equal(bare?.instanceId, undefined);
  assert.deepEqual([bare?.name, bare?.bonus, bare?.damageBonus, bare?.dice, bare?.damageType, bare?.range], ['Fist', 4, 3, '1', 'crushing', 'touch']);
  const [trained] = deriveAttacks(bag(), index(), declaration({ innate: INNATE }), reader({ might: 3, 'fist:die': 6 }), INVENTORY);
  assert.equal(trained?.dice, '1d6');
});

const OFF_HAND: AttacksDef['variants'] = [{ label: 'other hand', requirements: '[blade:TAG_KEEN],[left:TAG_KEEN]', damage: 'strike:other' }];

test('a variant is another row of a held attack, with damage of its own, while its condition holds', () => {
  // Fails if a variant is shown on a carried entry, when its condition is false, or adds the attack's damage.
  const stats = [...declaration().stats, { stat: 'strike:other', value: { kind: 'number', value: 0 } as const }];
  const held = { ...reader(STATS), statTags: (stat: string) => (stat === 'left' ? new Set(['tag_keen']) : undefined) };
  const def = declaration({ variants: OFF_HAND, stats });
  const [carried, equipped, sword] = deriveAttacks(
    bag({ instanceId: 'c', elementId: 'KNIFE' }, { instanceId: 'e', elementId: 'KNIFE', equipped: true }, { instanceId: 's', elementId: 'SWORD', equipped: true }),
    index(SWORD, KNIFE, QUICK),
    def,
    held,
    INVENTORY,
  );
  assert.deepEqual(carried?.alternatives, []);
  assert.deepEqual(equipped?.alternatives, [{ label: 'other hand', dice: '1d4', damageBonus: 0 }]);
  assert.deepEqual(sword?.alternatives.map((a) => a.label), ['two-handed'], 'the sword is not keen');
  const [, emptyHand] = deriveAttacks(bag({ instanceId: 'c', elementId: 'KNIFE' }, { instanceId: 'e', elementId: 'KNIFE', equipped: true }), index(KNIFE, QUICK), def, reader(STATS), INVENTORY);
  assert.deepEqual(emptyHand?.alternatives, [], 'nothing keen in the other hand');
});

test('an element writing no range takes the first reach whose condition holds', () => {
  // Fails if reach overrides a range the element writes, or the first holding entry is not the one taken.
  const def = declaration({ range: 'reach', reach: [{ text: 'far', requirements: '[blade:TAG_KEEN]' }, { text: 'near' }] });
  const [knife, sword] = deriveAttacks(bag({ instanceId: 'k', elementId: 'KNIFE' }, { instanceId: 's', elementId: 'SWORD' }), index(SWORD, KNIFE, QUICK), def, reader(STATS), INVENTORY);
  assert.equal(knife?.range, '20/60', 'its own range');
  assert.equal(sword?.range, 'near');
});
