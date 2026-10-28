/**
 * The inventory editor through the builder, on the official corpus — ADR 0098, and the roadmap item's exit criterion.
 *
 * A 2014 Fighter built from nothing takes its starting wealth instead of its package, then buys chain mail, a shield and
 * a longsword, equips them, adds a Ring of Protection (no price in content) and attunes to it, attaches Mithral Armor to
 * the mail, opens an explorer's pack and exchanges coins; its armour class, speed and attunement follow. The file the
 * desktop writes is read with the phone's own zip and reopens, with no source, to the same derivation, bag, purse and
 * sheet. Items are found by name and book, never by an id.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BundleElementIndex, readCharacterContainer, validateCharacter, type ElementIndex } from '@incudo/core';
import { createMobileZipCodec } from '@incudo/mobile/zip';
import { CharacterBuilder, newCharacterOfKind, packCharacter, sheetDocument, sheetMarkdown, type BuilderState } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import { loadSchemas, loadShippedSystem } from './node-system.ts';
import { nodeZipCodec } from './node-zip.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

const PHB = 'Player’s Handbook';
const DMG = 'Dungeon Master’s Guide';

function byName(elements: ElementIndex, ids: readonly string[], name: string, book: string): string {
  const id = ids.find((candidate) => elements.get(candidate)?.name === name && elements.get(candidate)?.source === book);
  assert.ok(id, `${name} (${book}) is offered`);
  return id;
}

const row = (state: BuilderState, name: string) => {
  const found = state.inventory!.rows.find((r) => r.name === name);
  assert.ok(found, `the bag lists ${name}: ${state.inventory!.rows.map((r) => r.name).join(', ')}`);
  return found;
};

const stat = (state: BuilderState, key: string) => state.derived.stats.get(key)?.value;

test('a Fighter built from nothing takes its gold, then buys, equips and attunes, and the phone reopens the file the same', { skip: corpusSkip }, async (t) => {
  // Fails if Buy does not pay in the item's coin, if equipping moves no armour class (the slots unread), if attuning is
  // refused or counts nothing, if an adornment does not lift the mail's Strength requirement, if Open drops a pack's
  // amounts, or if the file the desktop writes does not reopen on the phone's zip, with no source, to the same character.
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements, { random: () => 0.99 });
  const pick = (stepId: string, name: string, book: string): string => {
    const decision = b.getState().decisions.find((d) => d.stepId === stepId && d.kind === 'pick');
    assert.ok(decision, `the ${stepId} step is open`);
    const id = byName(elements, decision.candidates, name, book);
    b.choose(decision.id, [id]);
    return id;
  };
  pick('race', 'Human', PHB);
  const fighter = pick('class', 'Fighter', PHB);
  // A 2014 class's wealth is not rolled (ADR 0119): the purse is set by hand.
  assert.deepEqual(b.getState().startingEquipment!.sources.find((s) => s.forId === fighter)!.options.map((o) => o.id), ['equipment']);
  assert.equal(b.setCoins('gp', 200), undefined);
  assert.deepEqual(b.getState().character.money, { gp: 200 });

  const offer = b.inventoryOptionsFor();
  t.diagnostic(`the editor offers ${offer.length} items`);
  const buy = (name: string, book = PHB): void => assert.equal(b.addItem(byName(elements, offer, name, book), true), undefined, `buy ${name}`);
  buy('Chain Mail');
  buy('Shield');
  buy('Longsword');
  assert.deepEqual(b.getState().character.money, { gp: 100 }, '75 + 10 + 15 gp paid in gold');
  assert.equal(stat(b.getState(), 'ac'), 10, 'carried, nothing is worn');

  for (const name of ['Chain Mail', 'Shield', 'Longsword']) assert.equal(b.equipItem(row(b.getState(), name).instanceId, true), undefined);
  let state = b.getState();
  assert.equal(stat(state, 'ac'), 18, 'chain mail 16 and a shield 2');
  assert.equal(stat(state, 'speed'), 20, 'chain mail wants Strength 13, and the character has 10');
  assert.equal(row(state, 'Chain Mail').where, 'Armor');
  assert.match(row(state, 'Chain Mail').gives, /^Moves Armor Class and Speed\./);
  assert.match(row(state, 'Longsword').gives, /An attack, under Attacks\./);

  // A Ring of Protection has no price in content: added, not bought.
  const ring = byName(elements, offer, 'Ring of Protection', DMG);
  assert.match(b.addItem(ring, true)!, /no price/);
  assert.equal(b.addItem(ring), undefined);
  b.equipItem(row(b.getState(), 'Ring of Protection').instanceId, true);
  state = b.getState();
  assert.equal(row(state, 'Ring of Protection').gives, 'Gives nothing until attuned.');
  assert.equal(stat(state, 'ac'), 18);
  assert.equal(b.attuneItem(row(state, 'Ring of Protection').instanceId, true), undefined);
  state = b.getState();
  assert.equal(stat(state, 'ac'), 19, 'the ring adds 1 once attuned');
  assert.equal(stat(state, 'attunement:current'), 1);
  assert.equal(state.inventory!.attunement!.text, 'Attuned to 1 of 3 items.');
  assert.match(row(state, 'Ring of Protection').gives, /^Moves Armor Class; Saving Throws: /);

  // Mithral lifts the mail's Strength requirement; the entry is named as content's name-format writes it.
  const mail = row(state, 'Chain Mail').instanceId;
  const mithral = byName(elements, b.adornmentOptionsFor(mail), 'Mithral Armor', DMG);
  assert.equal(b.attachItem(mail, mithral), undefined);
  state = b.getState();
  assert.equal(row(state, 'Mithral Chain Mail').adornment?.name, 'Mithral Armor');
  assert.equal(stat(state, 'speed'), 30);
  assert.equal(stat(state, 'ac'), 19);

  // A pack opens into what <extract> lists, with its amounts.
  assert.equal(b.addItem(byName(elements, offer, 'Explorer’s Pack', PHB)), undefined);
  assert.equal(b.openItem(row(b.getState(), 'Explorer’s Pack').instanceId), undefined);
  state = b.getState();
  const opened = state.inventory!.rows.slice(4).map((r) => `${r.name} ×${r.quantity}`);
  t.diagnostic(`the explorer's pack held: ${opened.join(', ')}`);
  assert.ok(opened.includes('Torch ×10') && !state.inventory!.rows.some((r) => r.name === 'Explorer’s Pack'), opened.join(', '));

  assert.match(b.exchangeCoins('gp', 15, 'pp')!, /multiple of 10 gp/);
  assert.equal(b.exchangeCoins('gp', 50, 'pp'), undefined);
  state = b.getState();
  assert.deepEqual(state.character.money, { gp: 50, pp: 5 });
  assert.equal(state.character.formatVersion, 11);
  assert.deepEqual(validateCharacter(state.character, await loadSchemas(), system).errors, []);

  const markdown = sheetMarkdown(sheetDocument({ ...state, freeform: state.freeform }));
  assert.match(markdown, /- Mithral Chain Mail \(equipped\)\n- Shield \(equipped\)\n- Longsword \(equipped\)\n- Ring of Protection \(equipped, attuned\)\n/);
  assert.match(markdown, /- Money: 5 pp, 50 gp\n/);

  // The desktop writes the file; the phone's zip reads it; it reopens with no source.
  const packed = packCharacter(state.character, system, elements, { generator: 'test' });
  const bytes = await nodeZipCodec.zip(packed.files);
  const { container } = readCharacterContainer(await createMobileZipCodec().unzip(bytes));
  const reopened = new CharacterBuilder(container!.character, system, new BundleElementIndex(container!.content.elements)).getState();
  assert.deepEqual(summarize(reopened.derived), summarize(state.derived), 'the save derives the same with no source');
  assert.deepEqual(reopened.character.inventory, state.character.inventory);
  assert.deepEqual(reopened.character.money, state.character.money);
  assert.equal(sheetMarkdown(sheetDocument({ ...reopened, freeform: reopened.freeform })), markdown);
  assert.deepEqual(
    reopened.inventory!.rows.map((r) => [r.name, r.gives]),
    state.inventory!.rows.map((r) => [r.name, r.gives]),
    'what each item gives reads the same with no source',
  );
});
