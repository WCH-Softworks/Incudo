/**
 * Starting equipment taken through the builder, on the official corpus — ADR 0087.
 *
 * A 2014 Fighter takes the Player's Handbook's package, answering each (a) / (b) and its martial weapon, and the
 * Soldier's; its armour class follows the chain mail and shield the package equipped, and the save reopens with no
 * source to the same bag, purse and derivation. A 2024 Fighter takes option C, gold alone, and a 2014 Monk rolls its
 * wealth, which has no multiplier. Classes and backgrounds are found by name and book, never by an id.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BundleElementIndex, readCharacterContainer, validateCharacter, type ElementIndex } from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, packCharacter, wealthRollKey } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import { loadSchemas, loadShippedStartingEquipment, loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

const PHB = 'Player’s Handbook';
const PHB24 = 'Player’s Handbook (2024)';

async function start(random?: () => number) {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const file = await loadShippedStartingEquipment('dnd5e');
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements, { startingEquipment: [file], ...(random ? { random } : {}) });
  const pick = (stepId: string, name: string, book: string): string => {
    const decision = b.getState().decisions.find((d) => d.stepId === stepId && d.kind === 'pick');
    const id = decision?.candidates.find((c) => elements.get(c)?.name === name && elements.get(c)?.source === book);
    assert.ok(decision && id, `the ${stepId} step offers ${name} (${book})`);
    b.choose(decision.id, [id]);
    return id;
  };
  return { system, elements, b, pick };
}

const named = (elements: ElementIndex, ids: Array<string | undefined>) => ids.map((id) => (id ? elements.get(id)?.name : undefined));

test('a 2014 Fighter takes its package and the Soldier’s, wears them, and reopens with no source', { skip: corpusSkip }, async (t) => {
  // Fails if the step offers nothing for a real class, if a choice or pick is read under the wrong key, if armour and a
  // shield are not equipped (armour class 10 + Dexterity rather than 18), if the purse is not written, or if the save does
  // not reopen to the same bag, purse and derivation.
  t.diagnostic(corpusProvenance());
  const { system, elements, b, pick } = await start();
  pick('race', 'Human', PHB);
  const fighter = pick('class', 'Fighter', PHB);
  const soldier = pick('background', 'Soldier', PHB);

  const decisions = b.getState().decisions.filter((d) => d.kind === 'equipment');
  assert.deepEqual(decisions.map((d) => d.from), [fighter, soldier]);
  const source = b.getState().startingEquipment!.sources.find((s) => s.forId === fighter)!;
  const pkg = source.options.find((o) => o.id === 'equipment')!;
  t.diagnostic(`the Fighter's package: ${pkg.lines.map((l) => (l.kind === 'choose' ? l.alternatives.map((a) => a.text).join(' | ') : l.text)).join(' / ')}`);
  assert.deepEqual(source.options.map((o) => o.id), ['equipment', 'wealth']);

  // (a) chain mail; (a) a martial weapon and a shield, the weapon a longsword; (b) two handaxes; (a) a dungeoneer's pack.
  b.chooseStartingAlternative(fighter, 'equipment', '0', 0);
  b.chooseStartingAlternative(fighter, 'equipment', '1', 0);
  const weapon = b.getState().startingEquipment!.sources.find((s) => s.forId === fighter)!.options[0]!.lines[1]!;
  assert.equal(weapon.kind, 'choose');
  const longsword = weapon.picks[0]!.candidates.find((id) => elements.get(id)?.name === 'Longsword');
  assert.ok(longsword, 'a martial weapon may be a longsword');
  t.diagnostic(`"a martial weapon" offers ${weapon.picks[0]!.candidates.length}`);
  b.pickStartingItem(fighter, 'equipment', weapon.picks[0]!.key, 0, longsword);
  b.chooseStartingAlternative(fighter, 'equipment', '2', 1);
  b.chooseStartingAlternative(fighter, 'equipment', '3', 0);
  assert.equal(b.takeStartingOption(fighter, 'equipment'), undefined);

  b.chooseStartingAlternative(soldier, 'equipment', '0', 0);
  assert.equal(b.takeStartingOption(soldier, 'equipment'), undefined);

  const state = b.getState();
  const bag = state.character.inventory ?? [];
  assert.deepEqual(
    bag.map((e) => [elements.get(e.elementId)?.name, e.equipped ?? false, e.quantity ?? 1]),
    [
      ['Chain Mail', true, 1],
      // A bundle writes its fixed items before its picks: the shield, then the martial weapon chosen.
      ['Shield', true, 1],
      ['Longsword', true, 1],
      ['Handaxe', true, 2],
      ['Dungeoneer’s Pack', false, 1],
      ['Dice Set', false, 1],
      ['Clothes, Common', false, 1],
      ['Pouch', false, 1],
    ],
  );
  assert.deepEqual(state.character.money, { gp: 10 });
  assert.equal(state.derived.stats.get('ac')?.value, 18, 'chain mail 16 and a shield 2');
  assert.deepEqual(state.decisions.filter((d) => d.kind === 'equipment'), []);
  assert.deepEqual(state.startingEquipment!.sources.map((s) => s.status), ['taken', 'taken']);
  assert.deepEqual(validateCharacter(state.character, await loadSchemas(), system).errors, []);

  const packed = packCharacter(state.character, system, elements, { generator: 'test' });
  const { container } = readCharacterContainer(packed.files);
  const reopened = new CharacterBuilder(container!.character, system, new BundleElementIndex(container!.content.elements));
  assert.deepEqual(summarize(reopened.getState().derived), summarize(state.derived), 'the save derives the same with no source');
  assert.deepEqual(reopened.getState().character.inventory, state.character.inventory);
  assert.deepEqual(reopened.getState().character.money, { gp: 10 });
  assert.deepEqual(named(elements, reopened.getState().character.startingEquipment!.map((r) => r.for)), ['Fighter', 'Soldier']);
});

test('a 2024 Fighter may take gold alone, and a 2014 Monk rolls its wealth with no multiplier', { skip: corpusSkip }, async () => {
  // Fails if option C is not offered or writes items, or if the Monk's wealth is multiplied by ten.
  const fighter24 = await start();
  fighter24.pick('class', 'Fighter', PHB24);
  const f = fighter24.b.getState().startingEquipment!.sources[0]!;
  assert.deepEqual(f.options.map((o) => [o.label, o.coins]), [['Option A', '4 gp'], ['Option B', '11 gp'], ['Option C', '155 gp']]);
  assert.equal(fighter24.b.takeStartingOption(f.forId!, 'c'), undefined);
  assert.deepEqual(fighter24.b.getState().character.money, { gp: 155 });
  assert.equal(fighter24.b.getState().character.inventory, undefined);

  const monk = await start(() => 0.99);
  const id = monk.pick('class', 'Monk', PHB);
  assert.equal(monk.b.takeStartingOption(id, 'wealth'), undefined);
  assert.equal(monk.b.getState().character.rolls[wealthRollKey(id)], 20);
  assert.deepEqual(monk.b.getState().character.money, { gp: 20 });
});
