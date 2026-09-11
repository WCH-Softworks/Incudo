import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveEquipment, EMPTY_EQUIPMENT } from './equipment.ts';
import { createCharacter, type Character, type InventoryEntry } from './character.ts';
import { MapElementIndex, type Element, type Setter } from './model.ts';
import type { InventoryDef } from './system.ts';

// A fixture with no game in it. "torso", "grip" and "spare" are this fixture's words the way
// "body" and "onehand" are 5e's; core knows none of them.

function item(id: string, name: string, setters: Record<string, string> = {}): Element {
  const out: Record<string, Setter> = {};
  for (const [key, value] of Object.entries(setters)) out[key] = { value };
  return {
    id,
    type: 'Thing',
    name,
    source: 'test',
    setters: out,
    rules: [],
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

function declaration(): InventoryDef {
  return {
    slotSetter: 'worn',
    occupiedTag: 'any',
    emptyTag: 'none',
    tagSetters: ['weight class'],
    flagSetters: ['two-handed'],
    slots: [
      { id: 'torso', stats: ['plating'] },
      { id: 'grip,spare', stats: ['offhand'] },
      { id: 'grip', stats: ['held', 'offhand'] },
      { id: 'both hands', stats: ['held'] },
      { id: 'pocket' },
    ],
    attunement: { setter: 'bonded', requires: 'yes' },
  };
}

function bag(...entries: InventoryEntry[]): Character {
  return { ...createCharacter('test', 'kind'), inventory: entries };
}

function indexWith(...elements: Element[]): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll(elements);
  return index;
}

test('a kind with no declaration resolves to nothing, and says it declared nothing', () => {
  const state = resolveEquipment(bag(), indexWith(), undefined);
  assert.equal(state, EMPTY_EQUIPMENT);
  assert.equal(state.declared, false);
  assert.equal(state.tags.size, 0);
});

test('a declared slot with nothing in it publishes the empty tag, alone', () => {
  const state = resolveEquipment(bag(), indexWith(), declaration());
  assert.equal(state.declared, true);
  // A slot that answers nothing is worse than one that answers "empty": `[plating:none]` has
  // to come out true for a character wearing nothing, which is the case ADR 0021 got wrong.
  assert.deepEqual([...state.tags.get('plating')!], ['none']);
  assert.deepEqual([...state.tags.get('held')!], ['none']);
  assert.equal(state.tags.get('pocket'), undefined, 'a slot publishing no stat publishes nothing');
});

test("a slot's tags are the occupied tag, the element's name, setter values and setter presence", () => {
  const index = indexWith(
    item('PLATE', 'Field Plate', { worn: 'torso', 'weight class': 'Heavy', cost: '1500' }),
    item('STAFF', 'Long Staff', { worn: 'grip', 'two-handed': '1d8' }),
  );
  const state = resolveEquipment(
    bag(
      { instanceId: 'a', elementId: 'PLATE', equipped: true },
      { instanceId: 'b', elementId: 'STAFF', equipped: true },
    ),
    index,
    declaration(),
  );

  assert.deepEqual([...state.tags.get('plating')!].sort(), ['any', 'field plate', 'heavy']);
  // The flag setter contributes its *name*: the value is a die, and "[held:two-handed]" is
  // what content asks. The value setter contributes its value. Both lowercased.
  assert.deepEqual([...state.tags.get('held')!].sort(), ['any', 'long staff', 'two-handed']);
  assert.equal(state.tags.get('cost'), undefined, 'an unnamed setter publishes nothing');
});

test('the stats list is the capacity: two hands fill in order, a third reports', () => {
  const index = indexWith(
    item('SWORD', 'Sword', { worn: 'grip' }),
    item('DIRK', 'Dirk', { worn: 'grip' }),
    item('CLUB', 'Club', { worn: 'grip' }),
  );
  const state = resolveEquipment(
    bag(
      { instanceId: 'a', elementId: 'SWORD', equipped: true },
      { instanceId: 'b', elementId: 'DIRK', equipped: true },
      { instanceId: 'c', elementId: 'CLUB', equipped: true },
    ),
    index,
    declaration(),
  );

  assert.equal(state.occupants.get('held')?.name, 'Sword');
  assert.equal(state.occupants.get('offhand')?.name, 'Dirk');
  assert.deepEqual(
    state.issues.map((i) => [i.code, i.elementId]),
    [['slot-full', 'CLUB']],
  );
});

test('a two-handed slot fills only what it declares, and leaves the off hand empty', () => {
  const index = indexWith(item('MAUL', 'Maul', { worn: 'both hands' }));
  const state = resolveEquipment(
    bag({ instanceId: 'a', elementId: 'MAUL', equipped: true }),
    index,
    declaration(),
  );

  // The whole argument of ADR 0025 decision 3, in two assertions: content asks
  // "[held:<a two-handed weapon's name>]", and a rule wanting a weapon in each hand must not
  // see one here.
  assert.equal(state.occupants.get('held')?.name, 'Maul');
  assert.deepEqual([...state.tags.get('offhand')!], ['none']);
});

test('a compound slot id is matched verbatim, which is how a shield gets its own stat', () => {
  const index = indexWith(
    item('SHIELD', 'Shield', { worn: 'grip,spare' }),
    item('SWORD', 'Sword', { worn: 'grip' }),
  );
  const state = resolveEquipment(
    bag(
      { instanceId: 'a', elementId: 'SHIELD', equipped: true },
      { instanceId: 'b', elementId: 'SWORD', equipped: true },
    ),
    index,
    declaration(),
  );

  assert.equal(state.occupants.get('offhand')?.name, 'Shield');
  assert.equal(state.occupants.get('held')?.name, 'Sword');
  assert.equal(state.issues.length, 0);
});

test('an entry may override the element, and an undeclared slot is reported not guessed', () => {
  const index = indexWith(
    item('CUIRASS', 'Cuirass', { worn: 'armour' }), // one upstream element really does this
    item('BUCKLER', 'Buckler', { worn: 'grip,spare' }),
  );
  const state = resolveEquipment(
    bag(
      { instanceId: 'a', elementId: 'CUIRASS', equipped: true },
      { instanceId: 'b', elementId: 'BUCKLER', equipped: true, slot: 'torso' },
    ),
    index,
    declaration(),
  );

  assert.deepEqual(
    state.issues.map((i) => i.code),
    ['slot-unknown'],
  );
  assert.equal(state.occupants.get('plating')?.name, 'Buckler', 'the override wins');
});

test('carried entries, adornments and slotless items occupy nothing, and none of them report', () => {
  const index = indexWith(
    item('PLATE', 'Field Plate', { worn: 'torso', 'weight class': 'Heavy' }),
    item('RUNE', 'Rune of Warding', { worn: 'torso' }), // an adorner with a slot of its own
    item('PROXY', 'Bookkeeping Marker'), // no slot setter at all
    item('SPARE', 'Spare Plate', { worn: 'torso' }),
  );
  const state = resolveEquipment(
    bag(
      { instanceId: 'a', elementId: 'PLATE', equipped: true, adorners: [{ elementId: 'RUNE' }] },
      { instanceId: 'b', elementId: 'PROXY', equipped: true },
      { instanceId: 'c', elementId: 'SPARE' },
    ),
    index,
    declaration(),
  );

  assert.equal(state.occupants.get('plating')?.name, 'Field Plate');
  assert.equal(state.issues.length, 0, 'none of the three is a mistake the user made');
});

test('an unattuned item that wants attunement contributes nothing, and is named', () => {
  const index = indexWith(
    item('RING', 'Ring of Warding', { worn: 'pocket', bonded: 'yes' }),
    item('BAND', 'Plain Band', { worn: 'pocket', bonded: 'no' }),
  );
  const state = resolveEquipment(
    bag(
      { instanceId: 'a', elementId: 'RING', equipped: true },
      { instanceId: 'b', elementId: 'BAND', equipped: true },
    ),
    index,
    declaration(),
  );

  assert.deepEqual([...state.suppressed], ['RING']);
  const issue = state.issues.find((i) => i.code === 'unattuned')!;
  assert.equal(issue.elementId, 'RING');
  assert.match(issue.message, /Ring of Warding/, 'the warning has to name the item');
});

test('attuning it, or having it for another reason, stops the gate', () => {
  const index = indexWith(item('RING', 'Ring of Warding', { worn: 'pocket', bonded: 'yes' }));
  const declared = declaration();

  const attuned = resolveEquipment(
    bag({ instanceId: 'a', elementId: 'RING', equipped: true, attuned: true }),
    index,
    declared,
  );
  assert.equal(attuned.suppressed.size, 0);
  assert.equal(attuned.issues.length, 0);

  // The bag does not get to delete something the character has for another reason.
  const exempt = resolveEquipment(
    bag({ instanceId: 'a', elementId: 'RING', equipped: true }),
    index,
    declared,
    { exempt: new Set(['RING']) },
  );
  assert.equal(exempt.suppressed.size, 0);

  // Carried, so not in play at all, and not something to warn about either.
  const carried = resolveEquipment(bag({ instanceId: 'a', elementId: 'RING' }), index, declared);
  assert.equal(carried.suppressed.size, 0);
  assert.equal(carried.issues.length, 0);
});

test('the host and its adornment are gated separately, by the one flag', () => {
  // The whole reason ADR 0023 needs no special case: an unattuned magic sword is still a
  // sword, because the mundane half is a different element.
  const index = indexWith(
    item('SWORD', 'Sword', { worn: 'grip' }),
    item('FLAME', 'Flame Brand', { bonded: 'yes' }),
  );
  const state = resolveEquipment(
    bag({ instanceId: 'a', elementId: 'SWORD', equipped: true, adorners: [{ elementId: 'FLAME' }] }),
    index,
    declaration(),
  );

  assert.deepEqual([...state.suppressed], ['FLAME']);
  assert.equal(state.occupants.get('held')?.name, 'Sword', 'the sword is still in the hand');
});

test('a system with no attunement concept gates nothing', () => {
  const declared = { ...declaration(), attunement: undefined };
  const index = indexWith(item('RING', 'Ring of Warding', { worn: 'pocket', bonded: 'yes' }));
  const state = resolveEquipment(
    bag({ instanceId: 'a', elementId: 'RING', equipped: true }),
    index,
    declared,
  );
  assert.equal(state.suppressed.size, 0);
  assert.equal(state.issues.length, 0);
});

test("the user's own name for an instance is what a warning says, and never a tag", () => {
  const index = indexWith(item('SWORD', 'Sword', { worn: 'armour' }));
  const state = resolveEquipment(
    bag({ instanceId: 'a', elementId: 'SWORD', equipped: true, name: 'Swiftpursuit' }),
    index,
    declaration(),
  );
  assert.match(state.issues[0]!.message, /Swiftpursuit/);
});

test('quantity is not a multiplier: ten of a thing fill one slot', () => {
  const index = indexWith(item('DIRK', 'Dirk', { worn: 'grip' }));
  const state = resolveEquipment(
    bag({ instanceId: 'a', elementId: 'DIRK', equipped: true, quantity: 10 }),
    index,
    declaration(),
  );
  assert.equal(state.occupants.get('held')?.name, 'Dirk');
  assert.equal(state.occupants.get('offhand'), undefined);
});

test('attuned items are counted per entry, and only the ones with something to attune to', () => {
  // One attuned *entry* is one attunement. Aurora carries one flag per instance and none per
  // adorner (ADR 0024 decision 5), which is also the rule: a Flame Brand sword is one attuned
  // item, modelled as a mundane host plus a magical adorner.
  const index = indexWith(
    item('RING', 'Ring of Warding', { worn: 'pocket', bonded: 'yes' }),
    item('SWORD', 'Sword', { worn: 'grip' }),
    item('FLAME', 'Flame Brand', { bonded: 'yes' }),
    item('ROPE', 'Rope', { worn: 'pocket' }),
  );

  const state = resolveEquipment(
    bag(
      { instanceId: 'a', elementId: 'RING', equipped: true, attuned: true },
      { instanceId: 'b', elementId: 'SWORD', equipped: true, attuned: true, adorners: [{ elementId: 'FLAME' }] },
      // A flag ticked on something that needs no attunement is not an attunement.
      { instanceId: 'c', elementId: 'ROPE', equipped: true, attuned: true },
      // Not attuned, and not carried either: neither counts.
      { instanceId: 'd', elementId: 'RING', equipped: true },
      { instanceId: 'e', elementId: 'RING', attuned: true },
    ),
    index,
    declaration(),
  );

  assert.equal(state.attunedCount, 2, 'the ring and the branded sword, and nothing else');
  assert.equal(EMPTY_EQUIPMENT.attunedCount, 0);

  // A system with no attunement concept counts nothing, the same way it gates nothing.
  const none = resolveEquipment(
    bag({ instanceId: 'a', elementId: 'RING', equipped: true, attuned: true }),
    index,
    { ...declaration(), attunement: undefined },
  );
  assert.equal(none.attunedCount, 0);
});
