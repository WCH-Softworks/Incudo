/**
 * The starting equipment step — ADR 0087.
 *
 * No game in the fixture. A hero picks a Calling (the first class, by a pick step) and a Past (a background); a file
 * beside the system gives a Calling a kit of Gear (Garb worn on the body, Tools held in two hands) or a roll of beads,
 * and a Past a bundle and coins. Beads, shells and pearls are the money. Each test names the perturbation that fails it.
 * The real corpus and file are held by `tools/verify/src/starting-equipment.test.ts` and `starting-equipment-build.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCharacter,
  MapElementIndex,
  removeInventoryEntry,
  setInventoryEntry,
  setMoney,
  type Character,
  type Element,
  type GameSystem,
  type JsonSchema,
} from '@incudo/core';
import { CharacterBuilder } from './use-character-builder.ts';
import { checkStartingEquipment, startingKey, wealthRollKey, type StartingEquipmentFile } from './starting-equipment.ts';
import { readFileSync } from 'node:fs';

function element(id: string, type: string, extra: Partial<Element> = {}): Element {
  return { id, type, name: id, source: 'Core', setters: {}, rules: [], supports: [], origin: { sourceId: 'test', format: 'incudo' }, ...extra };
}

function system(): GameSystem {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    version: '1.0.0',
    elementTypes: [{ name: 'Calling' }, { name: 'Past' }, { name: 'Gear' }, { name: 'Garb' }, { name: 'Trinket' }],
    stats: [{ name: 'vigour', default: 10 }],
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
        elementTypes: ['Calling', 'Past', 'Gear', 'Garb', 'Trinket'],
        buildSteps: [
          { id: 'calling', label: 'Calling', types: ['Calling'], required: true },
          { id: 'past', label: 'Past', types: ['Past'], required: true },
          { id: 'kit', label: 'Kit', types: ['Gear', 'Garb', 'Trinket'] },
        ],
        inventory: {
          slotSetter: 'slot',
          occupiedTag: 'any',
          emptyTag: 'none',
          tagSetters: [],
          slots: [
            { id: 'body', label: 'Body', stats: ['body'] },
            { id: 'hands', label: 'Hands', stats: ['main', 'off'] },
            { id: 'both', label: 'Both hands', stats: ['main'] },
          ],
        },
        sheet: { sections: [{ id: 's', label: 'S', stats: ['vigour'] }] },
      },
    ],
  };
}

const slot = (value: string) => ({ slot: { value } });

function corpus(): MapElementIndex {
  const index = new MapElementIndex();
  index.addAll([
    element('SMITH', 'Calling', { name: 'Smith' }),
    element('POET', 'Calling', { name: 'Poet' }),
    element('DRIFTER', 'Past', { name: 'Drifter' }),
    element('APRON', 'Garb', { name: 'Apron', setters: slot('body') }),
    element('HAMMER', 'Gear', { name: 'Hammer', setters: slot('hands'), supports: ['Tool'] }),
    element('TONGS', 'Gear', { name: 'Tongs', setters: slot('hands'), supports: ['Tool'] }),
    element('BELLOWS', 'Gear', { name: 'Bellows', setters: slot('both'), supports: ['Tool'] }),
    element('OTHER_TOOL', 'Gear', { name: 'Chisel', setters: slot('hands'), supports: ['Tool'], source: 'Other Book' }),
    element('NAILS', 'Trinket', { name: 'Nail' }),
    element('CHARM', 'Trinket', { name: 'Charm' }),
  ]);
  return index;
}

const FILE: StartingEquipmentFile = {
  formatVersion: 1,
  system: 'test',
  kind: 'pc',
  step: 'kit',
  from: ['calling', 'past'],
  equip: ['Garb', 'Gear'],
  packages: [
    {
      for: 'SMITH',
      options: [
        {
          id: 'kit',
          label: 'Smith’s kit',
          lines: [
            { items: [{ id: 'APRON' }] },
            { choose: [{ items: [{ id: 'HAMMER' }, { id: 'TONGS' }] }, { picks: [{ label: 'two tools', count: 2, types: ['Gear'], supports: 'Tool', publications: ['Core'] }] }] },
            { items: [{ id: 'BELLOWS' }, { id: 'NAILS', quantity: 20 }] },
          ],
          coins: { shell: 3 },
          unlisted: ['a soot-black handkerchief'],
        },
        { id: 'wealth', label: 'Beads instead', wealth: { dice: '2d4', multiplier: 10, unit: 'bead' } },
      ],
    },
    { for: 'DRIFTER', options: [{ id: 'bundle', label: 'Bundle', lines: [{ picks: [{ label: 'a keepsake', from: ['CHARM', 'NAILS'] }] }], coins: { pearl: 1 } }] },
  ],
};

const fresh = (): Character => createCharacter('test', 'pc', { progress: 1 });
function builder(character: Character = fresh(), random = () => 0.5): CharacterBuilder {
  const b = new CharacterBuilder(character, system(), corpus(), { startingEquipment: [FILE], random });
  if (!b.getState().picks.some((p) => p.stepId === 'calling')) b.choose('build/calling', ['SMITH']);
  if (!b.getState().picks.some((p) => p.stepId === 'past')) b.choose('build/past', ['DRIFTER']);
  return b;
}
const source = (b: CharacterBuilder, forId: string) => b.getState().startingEquipment!.sources.find((s) => s.forId === forId)!;
const entryOf = (c: Character, id: string) => (c.inventory ?? []).filter((e) => e.elementId === id);

test('the step offers each source its options, as a decision that never blocks', () => {
  // Perturbation: drop the decisions loop and there is none; make it blocking and the step reads incomplete; read the
  // class from the first held element of the type rather than the pick's answer and a multiclass character gets two.
  const b = new CharacterBuilder(fresh(), system(), corpus(), { startingEquipment: [FILE] });
  const before = b.getState().startingEquipment!.sources;
  assert.deepEqual(before.map((s) => s.status), ['unanswered', 'unanswered']);
  b.choose('build/calling', ['SMITH']);
  b.choose('build/past', ['DRIFTER']);
  const state = b.getState();
  const decisions = state.decisions.filter((d) => d.kind === 'equipment');
  assert.deepEqual(decisions.map((d) => [d.id, d.blocking, d.from]), [
    [startingKey('SMITH'), false, 'SMITH'],
    [startingKey('DRIFTER'), false, 'DRIFTER'],
  ]);
  assert.equal(state.steps.find((s) => s.id === 'kit')!.complete, true);
  const smith = source(b, 'SMITH');
  assert.deepEqual(smith.options.map((o) => [o.id, o.owed, o.ready]), [['kit', 1, false], ['wealth', 0, true]]);
  assert.deepEqual(smith.options[0]!.unlisted, ['a soot-black handkerchief']);
  assert.equal(smith.options[0]!.coins, '3 shell');
  assert.equal(smith.options[1]!.wealth!.text, '2d4 × 10 bead');
  // The purse lists every unit, most worth first.
  assert.deepEqual(state.startingEquipment!.purse.map((r) => r.unit), ['pearl', 'shell', 'bead']);
});

test('a pick offers what its filter and books admit, and a choice offers its picks only once chosen', () => {
  // Perturbation: ignore `publications` and the Chisel from the other book is offered; ignore `supports` and the apron.
  const b = builder();
  b.chooseStartingAlternative('SMITH', 'kit', '1', 1);
  const line = source(b, 'SMITH').options[0]!.lines[1]!;
  assert.equal(line.kind, 'choose');
  assert.equal(line.kind === 'choose' && line.chosen, 1);
  assert.deepEqual(line.picks.map((p) => [p.label, p.count, p.candidates]), [['two tools', 2, ['BELLOWS', 'HAMMER', 'TONGS']]]);
  assert.equal(source(b, 'SMITH').options[0]!.owed, 2);
});

test('taking writes the bag and the purse once, equipping what a free slot takes, and records what it wrote', () => {
  // Perturbation: equip every item of an equipped type and the bellows takes a hand the hammer holds; equip nothing and
  // the apron is carried; skip the record and nothing can be taken back.
  const b = builder();
  b.chooseStartingAlternative('SMITH', 'kit', '1', 0);
  assert.equal(b.takeStartingOption('SMITH', 'kit'), undefined);
  const c = b.getState().character;
  assert.deepEqual(
    (c.inventory ?? []).map((e) => [e.elementId, e.equipped ?? false, e.quantity ?? 1]),
    [['APRON', true, 1], ['HAMMER', true, 1], ['TONGS', true, 1], ['BELLOWS', false, 1], ['NAILS', false, 20]],
  );
  assert.deepEqual(c.money, { shell: 3 });
  assert.equal(c.formatVersion, 11);
  assert.deepEqual(c.startingEquipment!.map((r) => [r.for, r.option, r.entries!.length, r.coins]), [['SMITH', 'kit', 5, { shell: 3 }]]);
  // Equipped gear joins the derivation; carried does not.
  assert.equal(b.getState().derived.elementIds.has('HAMMER'), true);
  assert.equal(b.getState().derived.elementIds.has('BELLOWS'), false);
  const smith = source(b, 'SMITH');
  assert.equal(smith.status, 'taken');
  assert.deepEqual(smith.taken!.entries, ['Apron', 'Hammer', 'Tongs', 'Bellows', 'Nail ×20']);
  assert.equal(b.getState().decisions.some((d) => d.id === startingKey('SMITH')), false);
});

test('an option is refused while it owes answers, and writes nothing', () => {
  // Perturbation: drop the `owed` check and a kit with no tools is taken.
  const b = builder();
  const before = b.getState().character;
  assert.match(b.takeStartingOption('SMITH', 'kit')!, /still has 1 choice to make/);
  b.chooseStartingAlternative('SMITH', 'kit', '1', 1);
  b.pickStartingItem('SMITH', 'kit', '1.1/0', 0, 'HAMMER');
  assert.match(b.takeStartingOption('SMITH', 'kit')!, /still has 1 choice/);
  b.pickStartingItem('SMITH', 'kit', '1.1/0', 1, 'HAMMER');
  assert.equal(b.takeStartingOption('SMITH', 'kit'), undefined);
  assert.equal(entryOf(b.getState().character, 'HAMMER').length, 2);
  assert.equal(before.inventory, undefined);
});

test('a wealth roll is rolled once, recorded, and read again when the option is taken again', () => {
  // Perturbation: roll on every take and the second take differs; forget the roll on take back and it can be rerolled.
  let n = 0;
  const rolls = [0.99, 0.99, 0, 0];
  const b = builder(fresh(), () => rolls[n++ % rolls.length]!);
  assert.equal(b.takeStartingOption('SMITH', 'wealth'), undefined);
  const rolled = b.getState().character.rolls[wealthRollKey('SMITH')]!;
  assert.equal(rolled, 8);
  assert.deepEqual(b.getState().character.money, { bead: 80 });
  assert.equal(b.returnStartingOption('SMITH'), true);
  assert.equal(b.getState().character.money, undefined);
  assert.equal(b.getState().character.rolls[wealthRollKey('SMITH')], 8);
  b.takeStartingOption('SMITH', 'wealth');
  assert.deepEqual(b.getState().character.money, { bead: 80 });
  assert.equal(source(b, 'SMITH').taken!.rolled, 8);
});

test('taking back removes exactly what was written, and only while all of it is there', () => {
  // Perturbation: take back by element id and the drifter's own Nail goes too; skip the untouched check and a spent
  // purse goes negative.
  const b = builder();
  b.chooseStartingAlternative('SMITH', 'kit', '1', 0);
  b.takeStartingOption('SMITH', 'kit');
  b.pickStartingItem('DRIFTER', 'bundle', '0/0', 0, 'NAILS');
  b.takeStartingOption('DRIFTER', 'bundle');
  assert.deepEqual(b.getState().character.money, { shell: 3, pearl: 1 });
  assert.equal(b.returnStartingOption('SMITH'), true);
  const c = b.getState().character;
  assert.deepEqual((c.inventory ?? []).map((e) => e.elementId), ['NAILS']);
  assert.deepEqual(c.money, { pearl: 1 });
  assert.equal(source(b, 'SMITH').status, 'open');

  // Spending a coin uses the package: it stays, and says so.
  const spent = builder(setMoney(c, {}));
  assert.equal(source(spent, 'DRIFTER').status, 'used');
  assert.equal(spent.returnStartingOption('DRIFTER'), false);
  assert.match(source(spent, 'DRIFTER').note!, /has been used/);
});

test('a removed entry or a changed quantity counts as used, and taking another option is refused then', () => {
  // Perturbation: check only that the entries exist and twenty arrows down to five still read untouched.
  const b = builder();
  b.chooseStartingAlternative('SMITH', 'kit', '1', 0);
  b.takeStartingOption('SMITH', 'kit');
  const c = b.getState().character;
  const nails = entryOf(c, 'NAILS')[0]!;
  const fewer = builder(setInventoryEntry(c, { ...nails, quantity: 5 }));
  assert.equal(source(fewer, 'SMITH').status, 'used');
  assert.match(fewer.takeStartingOption('SMITH', 'wealth')!, /has been used/);
  const dropped = builder(removeInventoryEntry(c, entryOf(c, 'APRON')[0]!.instanceId));
  assert.equal(source(dropped, 'SMITH').status, 'used');
  assert.deepEqual(source(dropped, 'SMITH').taken!.entries[0], 'an item no longer in the bag');
  // Untouched, taking the other option takes this one back first.
  assert.equal(b.takeStartingOption('SMITH', 'wealth'), undefined);
  assert.deepEqual(b.getState().character.inventory, undefined);
  assert.deepEqual(b.getState().character.startingEquipment!.map((r) => r.option), ['wealth']);
});

test('a package taken for an earlier class stays listed to take back, and the new class is offered its own', () => {
  // Perturbation: list only the current answers and the smith's kit can never be taken back.
  const b = builder();
  b.takeStartingOption('SMITH', 'wealth');
  b.choose('build/calling', ['POET']);
  const sources = b.getState().startingEquipment!.sources;
  assert.deepEqual(sources.map((s) => [s.forId, s.status, s.current]), [
    ['POET', 'none', true],
    ['DRIFTER', 'open', true],
    ['SMITH', 'taken', false],
  ]);
  assert.match(sources[0]!.note!, /No starting equipment is written for Poet/);
  assert.match(sources[2]!.note!, /no longer has/);
  assert.equal(b.returnStartingOption('SMITH'), true);
});

test('no file for the kind means no step state and no decision', () => {
  // Perturbation: match a file by system only and another kind's packages are offered.
  const b = new CharacterBuilder(fresh(), system(), corpus(), { startingEquipment: [{ ...FILE, kind: 'npc' }] });
  b.choose('build/calling', ['SMITH']);
  assert.equal(b.getState().startingEquipment, undefined);
  assert.equal(b.getState().decisions.some((d) => d.kind === 'equipment'), false);
});

test('the checker refuses what a schema cannot say', () => {
  // Perturbation: drop any one check and its line goes.
  const schema = JSON.parse(readFileSync(new URL('../../../schemas/starting-equipment.schema.json', import.meta.url), 'utf8')) as JsonSchema;
  assert.deepEqual(checkStartingEquipment(FILE, schema, system()).errors, []);
  const broken: StartingEquipmentFile = {
    ...FILE,
    step: 'nowhere',
    packages: [
      ...FILE.packages,
      { for: 'SMITH', options: [{ id: 'a', label: 'A' }] },
      {
        for: 'POET',
        options: [
          { id: 'a', label: 'A', coins: { doubloon: 2 }, wealth: { dice: 'lots', unit: 'bead' } },
          { id: 'a', label: 'B', lines: [{ picks: [{ label: 'x', from: ['CHARM'], types: ['Gear'] }, { label: 'y', types: ['Gear'], supports: '((' }] }] },
        ],
      },
    ],
  };
  assert.deepEqual(
    checkStartingEquipment(broken, schema, system()).errors.map((e) => e.path),
    [
      'step',
      'packages[2].for',
      'packages[2].options[0]',
      'packages[3].options[0]',
      'packages[3].options[0].wealth.dice',
      'packages[3].options[0].coins.doubloon',
      'packages[3].options[1].id',
      'packages[3].options[1].lines[0].picks[0]',
      'packages[3].options[1].lines[0].picks[1].supports',
    ],
  );
});
