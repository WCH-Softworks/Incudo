/**
 * "New system…" (ADR 0104), against the real schema and the shipped systems: every start the launcher offers writes a file
 * that `UserSystemStore` adds and loads back; the starter builds a character with no content; a copy of 5e keeps 5e's
 * sources, starting equipment and form, and an overlay of the copy does too.
 *
 * Perturbations, each run and failing here: the starter's scores step without its budget (a decision stays open); its
 * health formula naming a stat nothing declares (it validates, and Health reads wrong: ADR 0105 makes a near miss a warning); the overlay written without `version` (refused); a copy written
 * with `extends` (refused, it names its own origin's id and is no overlay of it… it is applied, and its fields are written
 * twice); `copiedFrom` left out of the lineage (the copy loads no 5e source and is offered no starting equipment); a copy
 * written without `copiedFrom`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BundleElementIndex, MemoryStorage, systemLineage, type Element, type GameSystem } from '@incudo/core';
import { sourcesForSystem, type ConfiguredSource } from '@incudo/content';
import { CharacterBuilder, newCharacterOfKind, newSystemChoices, newSystemFile, UserSystemStore, type NewSystemStart } from '@incudo/ui';

import { loadSchemas, loadShippedStartingEquipment, loadFixtureSystem, loadShippedSystem } from './node-system.ts';

const schemas = await loadSchemas();
const shipped = [await loadShippedSystem('dnd5e'), await loadFixtureSystem('cairn')];
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

async function made(start: NewSystemStart, name: string, storage = new MemoryStorage()): Promise<{ system: GameSystem; store: UserSystemStore }> {
  const store = new UserSystemStore(storage, schemas, [], shipped);
  const file = newSystemFile(start, name, shipped.map((s) => s.id));
  assert.ok(file.ok, !file.ok ? file.message : '');
  const added = await store.add({ name: file.fileName, bytes: encode(file.text) });
  assert.ok(added.ok, !added.ok ? `${added.message}\n${(added.errors ?? []).map((e) => `${e.path}: ${e.message}`).join('\n')}` : '');
  return { system: added.system, store };
}

test('every start the launcher offers is added, and loads back, through the same validation as any file', async () => {
  for (const choice of newSystemChoices(shipped)) {
    const storage = new MemoryStorage();
    const { system, store } = await made(choice.start, `New ${choice.key}`, storage);
    const loaded = await store.load();
    assert.deepEqual(loaded.failures, [], choice.key);
    assert.deepEqual(loaded.systems.map((s) => s.id), [system.id], choice.key);
    if (choice.start.kind === 'changes') {
      // Nothing changed: its own id, name, description and version are not changes to the game.
      assert.deepEqual(loaded.overlays[system.id]!.changes, [], choice.key);
    }
  }
});

test('the starter builds a character with no content: scores entered, a derived stat on the sheet, nothing open', async () => {
  const { system } = await made({ kind: 'starter' }, 'My Game');
  const kind = system.characterKinds.find((k) => k.default)!;
  const builder = new CharacterBuilder(newCharacterOfKind(system, kind.id), system, new BundleElementIndex([]));
  assert.deepEqual(builder.getState().decisions.map((d) => d.stepId ?? d.id), ['scores']);
  builder.setBudgetStat('scores', 'might', 14);
  builder.setBudgetStat('scores', 'agility', 9);
  builder.setBudgetStat('scores', 'wits', 12);
  builder.confirmBudget('scores');
  const state = builder.getState();
  assert.deepEqual(state.decisions, []);
  assert.deepEqual(state.derived.problems, []);
  assert.deepEqual(
    state.sheet.sections.map((section) => [section.id, section.rows.map((row) => `${row.label} ${row.value}`)]),
    [
      ['scores', ['Might 14', 'Agility 9', 'Wits 12']],
      ['condition', ['Level 1', 'Health 16']],
    ],
  );
});

// Perturbation: the starter's Traits and Gear steps without `multiple` offer none of the traits and items loaded.
test("the starter offers the author's own traits and items, and lists what is taken on the sheet", async () => {
  const { system } = await made({ kind: 'starter' }, 'My Game');
  const element = (id: string, type: string, name: string): Element => ({
    id, type, name, source: 'Mine', setters: {}, rules: [], supports: [], origin: { sourceId: 'mine', format: 'incudo' },
  });
  const content = new BundleElementIndex([element('BRAVE', 'Trait', 'Brave'), element('KEEN', 'Trait', 'Keen'), element('ROPE', 'Item', 'Rope')]);
  const builder = new CharacterBuilder(newCharacterOfKind(system, 'character'), system, content);
  const offered = (step: string) => builder.getState().decisions.find((d) => d.stepId === step);
  assert.deepEqual(offered('traits')?.candidates, ['BRAVE', 'KEEN']);
  assert.deepEqual(offered('gear')?.candidates, ['ROPE']);
  builder.choose(offered('traits')!.id, ['KEEN']);
  const sheet = builder.getState().sheet.sections.find((section) => section.id === 'traits');
  assert.deepEqual(sheet?.elements.map((e) => e.name), ['Keen']);
});

test('a copy of 5e answers to 5e: its sources, its starting equipment and its form', async () => {
  const dnd5e = shipped[0]!;
  const { system: copy, store } = await made({ kind: 'copy', of: dnd5e }, 'Our 5e');
  assert.equal(copy.copiedFrom, 'dnd5e');
  assert.deepEqual(systemLineage(copy), ['our-5e', 'dnd5e']);

  const source = { id: 'core', url: 'https://example.invalid/core.index', enabled: true, systemId: 'dnd5e' } as ConfiguredSource;
  assert.deepEqual(sourcesForSystem([source], systemLineage(copy)).map((s) => s.id), ['core']);

  const equipment = await loadShippedStartingEquipment('dnd5e');
  const builder = new CharacterBuilder(newCharacterOfKind(copy, 'pc'), copy, new BundleElementIndex([]), { startingEquipment: [equipment] });
  assert.ok(builder.getState().startingEquipment, 'the copy is offered 5e\'s starting equipment');

  // An overlay of the copy inherits copiedFrom when it is applied, so it reaches 5e's content too.
  const overlay = newSystemFile({ kind: 'changes', of: copy }, 'Our 5e, Changed', ['dnd5e', 'cairn', copy.id]);
  assert.ok(overlay.ok);
  const added = await store.add({ name: overlay.fileName, bytes: encode(overlay.text) });
  assert.ok(added.ok);
  assert.deepEqual(systemLineage(added.system), ['our-5e-changed', 'our-5e', 'dnd5e']);
});

test('a new system never takes an id in use, so it never replaces one', async () => {
  const storage = new MemoryStorage();
  const first = await made({ kind: 'starter' }, 'Cairn', storage);
  assert.equal(first.system.id, 'cairn-2');
  const taken = ['dnd5e', 'cairn', first.system.id];
  const second = newSystemFile({ kind: 'starter' }, 'Cairn', taken);
  assert.ok(second.ok);
  assert.equal(second.id, 'cairn-3');
});
