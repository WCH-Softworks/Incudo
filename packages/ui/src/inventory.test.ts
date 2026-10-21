/**
 * The inventory editor — ADR 0098.
 *
 * No game in the fixture. A wanderer carries Gear and Garb; a Relic is made from a piece of Garb (its `form` setter names
 * the type, its `garb` setter the hosts, by name) and may want a bond; a Kit lists what it holds; a Boon is taken by an
 * equip step and is not the editor's. Guard is the one row of the sheet, derived from what is worn. Beads, shells and
 * pearls are the money. Each test names the perturbation that fails it. The real corpus is held by
 * `tools/verify/src/inventory-editor-build.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter, MapElementIndex, setMoney, type Character, type Element, type GameSystem } from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';
import {
  adornmentAdmits,
  adornmentOffer,
  entryName,
  inventoryOffer,
  inventoryOfferNote,
  itemPrice,
  planAddItem,
  planAttachItem,
  planOpenItem,
  planSetQuantity,
} from './inventory.ts';
import { planExchangeCoins, planSpendCoins } from './money.ts';
import { resolveCharacterKind } from '@incudo/core';

function element(id: string, type: string, extra: Partial<Element> = {}): Element {
  return { id, type, name: id, source: 'Core', setters: {}, rules: [], supports: [], origin: { sourceId: 'test', format: 'incudo' }, ...extra };
}

const price = (value: string, unit?: string) => ({ value, ...(unit ? { attrs: { coin: unit } } : {}) });

function system(options: { saves?: boolean } = {}): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Gear' }, { name: 'Garb' }, { name: 'Relic' }, { name: 'Kit' }, { name: 'Sign' }],
    stats: [
      { name: 'guard', label: 'Guard', derive: { kind: 'binary', op: '+', left: { kind: 'number', value: 10 }, right: { kind: 'ref', stat: 'guard:worn' } } },
      { name: 'guard:worn', default: 0 },
      { name: 'guard:save', label: 'Guard', derive: { kind: 'ref', stat: 'guard:worn' } },
      { name: 'reach', label: 'Reach', derive: { kind: 'ref', stat: 'guard:worn' } },
      { name: 'bonds', default: 0 },
      { name: 'bonds:max', default: 1 },
    ],
    currency: {
      bead: { label: 'Bead' },
      shell: { label: 'Shell', exchangeRate: { bead: 10 } },
      pearl: { label: 'Pearl', exchangeRate: { shell: 10 } },
    },
    characterKinds: [
      {
        id: 'pc',
        name: 'PC',
        default: true,
        progression: { kind: 'level', min: 1, max: 20, stat: 'level' },
        elementTypes: ['Gear', 'Garb', 'Relic', 'Kit', 'Sign'],
        buildSteps: [],
        inventory: {
          slotSetter: 'slot',
          occupiedTag: 'any',
          emptyTag: 'none',
          slots: [
            { id: 'body', label: 'Body', stats: ['body'] },
            { id: 'hands', label: 'Hands', stats: ['main', 'off'] },
            { id: 'neck', label: 'Neck' },
          ],
          attunement: { setter: 'bond', requires: 'yes', countStat: 'bonds', maxStat: 'bonds:max' },
          types: ['Gear', 'Garb', 'Relic', 'Kit'],
          adornSetter: 'form',
          price: { setter: 'worth', unitAttribute: 'coin' },
        },
        sheet: {
          sections: [
            { id: 'stats', label: 'Stats', stats: options.saves ? ['guard', 'reach'] : ['guard'] },
            ...(options.saves ? [{ id: 'saves', label: 'Saves', stats: ['guard:save'] }] : []),
            { id: 'signs', label: 'Signs', types: ['Sign'] },
            { id: 'bag', label: 'Bag', types: ['Gear', 'Garb', 'Relic', 'Kit'], bag: true },
          ],
        },
      },
    ],
  };
}

const guard = (value: number) => ({ kind: 'stat' as const, key: 'g', name: 'guard:worn', value: { kind: 'number' as const, value } });

function corpus(): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll([
    element('COAT', 'Garb', { name: 'Coat', setters: { slot: { value: 'body' }, worth: price('5', 'shell') }, rules: [guard(2)] }),
    element('CLOAK', 'Garb', { name: 'Cloak', setters: { slot: { value: 'body' }, worth: price('0', 'shell') } }),
    element('STAFF', 'Gear', { name: 'Staff', setters: { slot: { value: 'hands' }, worth: price('3', 'bead') } }),
    element('ROPE', 'Gear', { name: 'Rope', setters: { worth: price('—') } }),
    element('LAMP', 'Gear', { name: 'Lamp', setters: { worth: price('2') } }),
    element('SIGN', 'Sign', { name: 'Mark of the Road' }),
    element('GILDED', 'Relic', {
      name: 'Gilded Garb',
      setters: { form: { value: 'Garb' }, garb: { value: 'Coat' }, bond: { value: 'yes' }, label: { value: 'Gilded {{parent}}' } },
      rules: [guard(1), { kind: 'grant', key: 'r', type: 'Sign', id: 'SIGN' }],
    }),
    element('ANY_GARB', 'Relic', { name: 'Charm of Garb', setters: { form: { value: 'Garb' } } }),
    element('AMULET', 'Relic', { name: 'Amulet', setters: { slot: { value: 'neck' }, bond: { value: 'yes' } }, rules: [guard(1)] }),
    element('SATCHEL', 'Kit', { name: 'Satchel', contents: [{ id: 'ROPE' }, { id: 'LAMP', quantity: 2 }, { id: 'GHOST' }] }),
  ]);
  return index;
}

function builder(character?: Character, options: { saves?: boolean } = {}): CharacterBuilder {
  const s = system(options);
  return new CharacterBuilder(character ?? createCharacter('test', 'pc', { name: 'W' }), s, corpus());
}

let ids = 0;
const newId = () => `e${++ids}`;

test('the offer is every item of the inventory types', () => {
  // Fails if the offer reads the sheet's types instead (the sign is offered).
  const kind = resolveCharacterKind(system(), 'pc');
  const offer = inventoryOffer(kind, corpus());
  assert.ok(!offer.includes('SIGN'));
  assert.deepEqual(offer, ['AMULET', 'ANY_GARB', 'CLOAK', 'COAT', 'GILDED', 'LAMP', 'ROPE', 'SATCHEL', 'STAFF']);
  // A kind naming no types offers nothing, and its bag is still edited.
  assert.deepEqual(inventoryOffer({ ...kind, inventory: { ...kind.inventory!, types: undefined } }, corpus()), []);
});

test('a price is a whole amount above 0 in a unit the system counts; a dash, 0 and no unit are none', () => {
  // Fails if 0 is read as a price (a free Cloak), or a price with no unit is taken in some default coin.
  const kind = resolveCharacterKind(system(), 'pc');
  const index = corpus();
  assert.deepEqual(itemPrice(index.get('COAT')!, kind, system()), { amount: 5, unit: 'shell' });
  for (const id of ['CLOAK', 'ROPE', 'LAMP']) assert.equal(itemPrice(index.get(id)!, kind, system()), undefined, id);
  assert.equal(inventoryOfferNote(index.get('GILDED')!, kind, system()), 'no price · requires attunement · attached to a garb');
  assert.equal(inventoryOfferNote(index.get('STAFF')!, kind, system()), '3 bead');
});

test('buying pays in the price\'s own coin, and change is never made for it', () => {
  // Fails if Buy takes coins of another unit (a pearl for a 5-shell coat), or adds the item when the payment is refused.
  const kind = resolveCharacterKind(system(), 'pc');
  const base = setMoney(createCharacter('test', 'pc', { name: 'W' }), { pearl: 1, shell: 2 });
  const context = { kind, steps: kind.buildSteps, elements: corpus(), system: system(), character: base };
  const refused = planAddItem(context, 'COAT', { buy: true, newId });
  assert.ok('refused' in refused && /costs 5 shell/.test(refused.refused) && /holds 2 shell/.test(refused.refused), JSON.stringify(refused));
  const exchanged = planExchangeCoins(base, system(), 'pearl', 1, 'shell');
  assert.ok('character' in exchanged);
  assert.deepEqual(exchanged.character.money, { shell: 12 });
  const bought = planAddItem({ ...context, character: exchanged.character }, 'COAT', { buy: true, newId });
  assert.ok('character' in bought);
  assert.deepEqual(bought.character.money, { shell: 7 });
  assert.equal(bought.character.inventory!.at(-1)!.elementId, 'COAT');
  assert.equal(bought.character.inventory!.at(-1)!.equipped, undefined, 'added carried');
  // An item with no price is added, never bought.
  assert.ok('refused' in planAddItem(context, 'CLOAK', { buy: true }));
  assert.ok('character' in planAddItem(context, 'CLOAK'));
  // What is not of a type the bag carries (an option a character takes on Build, ADR 0129) is refused even by id.
  assert.ok('refused' in planAddItem(context, 'SIGN'));
});

test('an exchange is made only when it comes out whole, and says how many would', () => {
  // Fails if 15 beads become one shell and five beads are lost, or if the worths are not read from the rates.
  const base = setMoney(createCharacter('test', 'pc', { name: 'W' }), { bead: 15 });
  const odd = planExchangeCoins(base, system(), 'bead', 15, 'shell');
  assert.ok('refused' in odd && /multiple of 10 bead/.test(odd.refused), JSON.stringify(odd));
  const down = planExchangeCoins(setMoney(base, { pearl: 1 }), system(), 'pearl', 1, 'bead');
  assert.ok('character' in down);
  assert.deepEqual(down.character.money, { bead: 100 });
  assert.ok('refused' in planSpendCoins(base, system(), 'shell', 1), 'spending a coin the purse lacks');
});

test('an adornment admits a host by its own name, and only a host of the type it is made from', () => {
  // Fails if the host's name is not an operand (the Coat is admitted by nothing), or if any Garb admits it.
  const kind = resolveCharacterKind(system(), 'pc');
  const index = corpus();
  assert.equal(adornmentAdmits(index.get('GILDED')!, index.get('COAT')!, kind), true);
  assert.equal(adornmentAdmits(index.get('GILDED')!, index.get('CLOAK')!, kind), false);
  assert.equal(adornmentAdmits(index.get('ANY_GARB')!, index.get('CLOAK')!, kind), true, 'no filter: any host of the type');
  assert.equal(adornmentAdmits(index.get('GILDED')!, index.get('STAFF')!, kind), false, 'a Gear is not a Garb');
  const character: Character = { ...createCharacter('test', 'pc', { name: 'W' }), inventory: [{ instanceId: 'c', elementId: 'COAT' }], formatVersion: 2 };
  assert.deepEqual(adornmentOffer({ kind, elements: index, character }, 'c'), ['ANY_GARB', 'GILDED']);
});

test('attaching names the entry by the adornment, moves a bare loose one, and refuses a second', () => {
  // Fails if the loose Gilded Garb stays in the bag beside the attached one, or a host takes two adornments.
  const kind = resolveCharacterKind(system(), 'pc');
  const index = corpus();
  const character: Character = {
    ...createCharacter('test', 'pc', { name: 'W' }),
    formatVersion: 2,
    inventory: [{ instanceId: 'c', elementId: 'COAT' }, { instanceId: 'g', elementId: 'GILDED' }],
  };
  const attached = planAttachItem({ kind, elements: index, character }, 'c', 'GILDED');
  assert.ok('character' in attached);
  assert.deepEqual(attached.character.inventory, [{ instanceId: 'c', elementId: 'COAT', adorners: [{ elementId: 'GILDED' }] }]);
  const withLabel = { ...kind, attacks: { nameSetter: 'label' } as never };
  assert.equal(entryName(attached.character.inventory![0]!, index, withLabel), 'Gilded Coat');
  assert.equal(entryName(attached.character.inventory![0]!, index, kind), 'Coat (Gilded Garb)');
  assert.ok('refused' in planAttachItem({ kind, elements: index, character: attached.character }, 'c', 'ANY_GARB'));
});

test('opening a pack lays out what it holds, and names what nothing declares', () => {
  // Fails if the contents' amounts are dropped, if the pack is kept whole, or if an undeclared line is added anyway.
  const index = corpus();
  const character: Character = { ...createCharacter('test', 'pc', { name: 'W' }), formatVersion: 2, inventory: [{ instanceId: 's', elementId: 'SATCHEL', quantity: 2 }] };
  const opened = planOpenItem({ elements: index, character }, 's', newId);
  assert.ok('character' in opened);
  assert.deepEqual(opened.missing, ['GHOST']);
  assert.deepEqual(
    opened.character.inventory!.map((e) => [e.elementId, e.quantity ?? 1]),
    [['SATCHEL', 1], ['ROPE', 1], ['LAMP', 2]],
  );
  assert.ok('refused' in planOpenItem({ elements: index, character }, 'nope'));
  assert.ok('refused' in planSetQuantity(character, 's', 0));
});

test('what an item gives is read off the derivation: the rows it moves, what it grants, and why it gives nothing', () => {
  // Fails if a stat an item moves is named by its key and not by the row that reads it (guard:worn for Guard), if a
  // carried item says it moves anything, or if an unattuned adornment's grant is named.
  const b = builder();
  b.addItem('COAT');
  const coat = b.getState().inventory!.rows[0]!;
  assert.equal(coat.where, 'Carried');
  assert.equal(coat.gives, 'Gives nothing until equipped.');
  assert.equal(b.equipItem(coat.instanceId, true), undefined);
  let row = b.getState().inventory!.rows[0]!;
  assert.equal(row.where, 'Body');
  assert.equal(row.gives, 'Moves Guard.');
  assert.equal(b.getState().derived.stats.get('guard')!.value, 12);

  assert.equal(b.attachItem(row.instanceId, 'GILDED'), undefined);
  row = b.getState().inventory!.rows[0]!;
  assert.deepEqual(row.attunement, { attuned: false });
  assert.equal(row.gives, 'Moves Guard. Its magic gives nothing until attuned.');
  assert.equal(b.getState().derived.stats.get('guard')!.value, 12);
  b.attuneItem(row.instanceId, true);
  row = b.getState().inventory!.rows[0]!;
  assert.equal(row.gives, 'Moves Guard. Gives Mark of the Road.');
  assert.equal(b.getState().derived.stats.get('guard')!.value, 13);

  // An equipped item with no rules gives nothing, and says so; one with no rules carried says nothing at all.
  b.addItem('CLOAK');
  assert.equal(b.getState().inventory!.rows[1]!.gives, '');
});

test('a row whose label two sections show is named with its section', () => {
  // Fails if the save row reads as a bare "Guard", the same words as the stat it is not.
  const b = builder(undefined, { saves: true });
  b.addItem('COAT');
  const id = b.getState().inventory!.rows[0]!.instanceId;
  b.equipItem(id, true);
  assert.equal(b.getState().inventory!.rows[0]!.gives, 'Moves Stats: Guard and Reach; Saves: Guard.');
});

test('the limit is shown and never refused, and attuning a carried item counts nothing', () => {
  // Fails if a second attunement over a limit of one is refused, or a carried attuned item is counted.
  const b = builder();
  b.addItem('AMULET');
  b.addItem('COAT');
  const [amulet, coat] = b.getState().inventory!.rows;
  b.attachItem(coat!.instanceId, 'GILDED');
  b.attuneItem(amulet!.instanceId, true);
  assert.equal(b.getState().inventory!.rows[0]!.attunement!.note, 'Attuned, and counts only while equipped.');
  assert.deepEqual(b.getState().inventory!.attunement, { text: 'Attuned to 0 of 1 item.', over: false });
  b.equipItem(amulet!.instanceId, true);
  b.equipItem(coat!.instanceId, true);
  assert.equal(b.attuneItem(coat!.instanceId, true), undefined);
  assert.deepEqual(b.getState().inventory!.attunement, { text: 'Attuned to 2 of 1 item: over the limit.', over: true });
  assert.ok(b.getState().derived.problems.some((p) => p.code === 'over-attuned'));
});

test('an entry a starting package added says what editing it does, until the package is used', () => {
  // Fails if the note is shown on an entry no package added, or kept once the package can no longer be taken back.
  const character: Character = {
    ...createCharacter('test', 'pc', { name: 'W' }),
    formatVersion: 11,
    inventory: [{ instanceId: 'p', elementId: 'STAFF' }, { instanceId: 'q', elementId: 'ROPE' }],
    money: { shell: 3 },
    startingEquipment: [{ for: 'COAT', option: 'kit', entries: [{ instanceId: 'p' }], coins: { shell: 3 } }],
  };
  const b = builder(character);
  const state = b.getState().inventory!;
  assert.match(state.rows[0]!.fromPackage!, /^From Coat's starting equipment\. Removing it/);
  assert.equal(state.rows[1]!.fromPackage, undefined);
  assert.match(state.purseNote!, /Spending below them/);
  // Equipping does not use it; spending a coin does.
  b.equipItem('p', true);
  assert.ok(b.getState().inventory!.rows[0]!.fromPackage);
  b.spendCoins('shell', 1);
  assert.equal(b.getState().inventory!.rows[0]!.fromPackage, undefined);
  assert.equal(b.getState().inventory!.purseNote, undefined);
});

test('names, notes and quantities are written as given and cleared by blanks', () => {
  // Fails if a blank name is kept as "" (an entry that records a name it does not have), or a quantity of 1 is written.
  const b = builder();
  b.addItem('STAFF');
  const id = b.getState().inventory!.rows[0]!.instanceId;
  b.renameItem(id, 'Old Ash');
  b.setItemNotes(id, 'From the grove.');
  b.setItemQuantity(id, 3);
  assert.deepEqual(b.getState().character.inventory![0], { instanceId: id, elementId: 'STAFF', name: 'Old Ash', notes: 'From the grove.', quantity: 3 });
  assert.equal(b.getState().inventory!.rows[0]!.name, 'Old Ash');
  b.renameItem(id, '  ');
  b.setItemNotes(id, '');
  b.setItemQuantity(id, 1);
  assert.deepEqual(b.getState().character.inventory![0], { instanceId: id, elementId: 'STAFF' });
  assert.equal(b.removeItem(id), undefined);
  assert.equal(b.getState().character.inventory, undefined);
});

test('the sheet lists the bag and the purse, and its types only what no entry names', async () => {
  // Fails if a section declaring `bag` lists only what is held (a carried Staff missing), lists an equipped item twice
  // (once as a held element, once as an entry), or the Markdown or the form leave either out.
  const { sheetDocument } = await import('./sheet-document.ts');
  const { sheetMarkdown } = await import('./sheet-markdown.ts');
  const { formValues } = await import('./form-fill.ts');
  const character: Character = {
    ...setMoney(createCharacter('test', 'pc', { name: 'W' }), { shell: 3, bead: 12 }),
    formatVersion: 11,
    inventory: [
      { instanceId: 'c', elementId: 'COAT', equipped: true, adorners: [{ elementId: 'GILDED' }], attuned: true },
      { instanceId: 's', elementId: 'STAFF', quantity: 2 },
    ],
  };
  const state = builder(character).getState();
  const bag = state.sheet.sections.find((s) => s.section === 'bag')!;
  assert.deepEqual(bag.elements, [], 'an equipped Coat is an entry, not a held element besides');
  assert.deepEqual(
    bag.bag!.map((e) => [e.name, e.quantity, e.equipped, e.attuned]),
    [['Coat (Gilded Garb)', 1, true, true], ['Staff', 2, false, false]],
  );
  assert.deepEqual(bag.purse!.map((r) => [r.unit, r.count]), [['shell', 3], ['bead', 12]]);
  const document = sheetDocument({ ...state, freeform: state.freeform });
  const markdown = sheetMarkdown(document);
  assert.match(markdown, /- Coat \(Gilded Garb\) \(equipped, attuned\)\n- Staff ×2\n- Money: 3 shell, 12 bead\n/);
  const values = formValues(document, {
    formatVersion: 1, id: 'f', name: 'F', publisher: 'P', download: 'https://example.org', system: 'test', kinds: ['pc'], encoding: 'WinAnsi',
    fields: { Gear: 'text', Shells: 'text', Pearls: 'text' },
    fill: [
      { flow: { fields: ['Gear'], capacity: [{ lines: 5, perLine: 40, fontSize: 7 }] }, list: { section: 'bag', join: ', ' } },
      { field: 'Shells', money: { section: 'bag', unit: 'shell' } },
      { field: 'Pearls', money: { section: 'bag', unit: 'pearl' } },
    ],
  });
  assert.equal(values.text['Gear'], 'Coat (Gilded Garb) (equipped, attuned), Staff ×2');
  assert.equal(values.text['Shells'], '3');
  assert.equal(values.text['Pearls'], undefined, 'a unit the purse holds none of fills nothing');
});
