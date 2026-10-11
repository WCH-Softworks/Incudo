/**
 * Shipped and user systems load through exactly the same path (ADR 0011, ADR 0107), against the real schema and the
 * shipped definitions' own text.
 *
 * Perturbations, each run and failing here: the shipped set validated without locating its warnings (5e with a slip loads
 * with none); a definition validated without its text's positions (its problems and warnings have no line); the shipped
 * set loaded with no parent for an overlay (a shipped overlay of 5e is refused); `systemCatalog` not labelling by origin;
 * the builder choosing starting equipment by lineage alone (a version of 5e with no gold is offered 5e's wealth roll in
 * gold, and the character it writes does not validate); the catalog not saying why a user's system is offered none.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BundleElementIndex, MemoryStorage, validateCharacter, type Element } from '@incudo/core';
import {
  CharacterBuilder,
  loadShippedCatalog,
  newCharacterOfKind,
  systemCatalog,
  systemFailureNote,
  systemOriginLabel,
  UserSystemStore,
  type SystemDefinitionSource,
} from '@incudo/ui';

import { loadSchemas, loadShippedStartingEquipment, systemsDirectory } from './node-system.ts';

const schemas = await loadSchemas();
const text = async (id: string): Promise<string> => readFile(join(systemsDirectory(), id, 'system.json'), 'utf8');
const dnd5eText = await text('dnd5e');
const cairnText = await text('cairn');
const startingEquipment = await loadShippedStartingEquipment('dnd5e');
const startingSchema = JSON.parse(await readFile(join(systemsDirectory(), '..', 'schemas', 'starting-equipment.schema.json'), 'utf8'));
const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

/** 5e's text, with one stat a formula reads misspelled: a warning (ADR 0105), wherever the file comes from. */
function withSlip(definition: string, id?: string): string {
  const slipped = definition.replace('"left": { "kind": "ref", "stat": "strength" }', '"left": { "kind": "ref", "stat": "strenght" }');
  assert.notEqual(slipped, definition);
  return id ? slipped.replace('"id": "dnd5e"', `"id": "${id}"`) : slipped;
}

const shipped = (sources: SystemDefinitionSource[] = [{ text: dnd5eText }, { text: cairnText }]) =>
  loadShippedCatalog(sources, schemas, { files: [startingEquipment], schema: startingSchema });

test('the shipped definitions load from their text through the loader a user file goes through, with nothing to check', () => {
  const loaded = shipped();
  assert.deepEqual(loaded.systems.map((s) => s.id), ['dnd5e', 'cairn']);
  assert.deepEqual(loaded.failures, []);
  assert.deepEqual(loaded.warnings, {});
  assert.deepEqual(loaded.startingEquipment.map((f) => f.system), ['dnd5e']);
  assert.deepEqual(loaded.startingEquipmentFailures, []);
});

test('a shipped definition and a user one, of the same text, get the same warnings at the same lines', async () => {
  const asShipped = shipped([{ text: withSlip(dnd5eText) }]);
  const store = new UserSystemStore(new MemoryStorage(), schemas, [], shipped().systems);
  const added = await store.add({ name: 'mine.json', bytes: encode(withSlip(dnd5eText, 'mine')) });
  assert.ok(added.ok);
  const asUser = await store.load();

  const shippedWarnings = asShipped.warnings['dnd5e'];
  assert.ok(shippedWarnings && shippedWarnings.length > 0, 'the shipped set publishes its warnings');
  assert.ok(shippedWarnings.every((w) => w.line !== undefined), 'each with a line');
  assert.deepEqual(asUser.warnings['mine'], shippedWarnings);
  assert.deepEqual(added.warnings, shippedWarnings);
});

test("a broken shipped definition is named with its lines and as the app's, a user's as the user's", async () => {
  const broken = dnd5eText.replace('"label": "Strength", "default": 10', '"label": 7, "default": 10');
  assert.notEqual(broken, dnd5eText);
  const catalogue = systemCatalog(shipped([{ text: broken }, { text: cairnText }]));
  const failure = catalogue.failures.find((f) => f.id === 'dnd5e');
  assert.ok(failure);
  assert.equal(failure.origin, 'shipped');
  assert.ok(failure.problems.length > 0 && failure.problems.every((p) => p.line !== undefined), 'located by line');
  assert.match(systemFailureNote(failure.origin), /comes with Incudo/);
  assert.doesNotMatch(systemFailureNote(failure.origin), /add the file again/);
  assert.match(systemFailureNote('user'), /add the file again/);

  const storage = new MemoryStorage();
  await storage.write('systems/user/mine.json', withSlip(broken, 'mine'));
  const user = await new UserSystemStore(storage, schemas, [], shipped().systems).load();
  const both = systemCatalog(shipped(), user);
  assert.deepEqual(both.failures.map((f) => [f.id, f.origin]), [['mine', 'user']]);
  assert.deepEqual(both.failures[0]!.problems, failure.problems);
});

test('a shipped overlay is applied to a shipped parent, as a user overlay is', () => {
  const overlay = JSON.stringify({ id: 'house', name: 'House rules', version: '0.1.0', formatVersion: 1, extends: 'dnd5e' });
  // The overlay first: complete systems are loaded before overlays whatever order the files come in.
  const loaded = shipped([{ text: overlay }, { text: dnd5eText }]);
  assert.deepEqual(loaded.failures, []);
  assert.deepEqual(loaded.systems.map((s) => s.id), ['dnd5e', 'house']);
  assert.equal(loaded.overlays['house']?.parent.id, 'dnd5e');
});

test('the catalogue labels every system by where it came from, and that is all that differs', async () => {
  const storage = new MemoryStorage();
  const store = new UserSystemStore(storage, schemas, [], shipped().systems);
  const added = await store.add({ name: 'mine.json', bytes: encode(dnd5eText.replace('"id": "dnd5e"', '"id": "mine"')) });
  assert.ok(added.ok);
  const catalogue = systemCatalog(shipped(), await store.load());
  assert.deepEqual(catalogue.origins, { dnd5e: 'shipped', cairn: 'shipped', mine: 'user' });
  assert.equal(systemOriginLabel('user'), 'yours');
  const [theirs, mine] = [catalogue.systems.find((s) => s.id === 'dnd5e')!, catalogue.systems.find((s) => s.id === 'mine')!];
  assert.deepEqual({ ...mine, id: 'dnd5e' }, theirs);
});

const fighter: Element = {
  id: 'ID_WOTC_PHB_CLASS_FIGHTER', type: 'Class', name: 'Fighter', source: 'Test', setters: {}, rules: [], supports: [],
  origin: { sourceId: 'test', format: 'incudo' },
};

/** 5e with silver as its standard: no gold, and platinum worth a hundred silver. */
const silver = JSON.stringify({
  id: 'silver', name: 'Silver standard', version: '0.1.0', formatVersion: 1, extends: 'dnd5e',
  currency: { gp: null, pp: { label: 'Platinum', exchangeRate: { gp: null, sp: 100 } } },
});

async function userSystem(definition: string) {
  const store = new UserSystemStore(new MemoryStorage(), schemas, [], shipped().systems);
  const added = await store.add({ name: 'mine.json', bytes: encode(definition) });
  assert.ok(added.ok, !added.ok ? added.message : '');
  return { system: added.system, catalogue: systemCatalog(shipped(), await store.load()) };
}

function fighterBuilder(system: Parameters<typeof newCharacterOfKind>[0], files = shipped().startingEquipment): CharacterBuilder {
  const builder = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, new BundleElementIndex([fighter]), {
    startingEquipment: files,
    random: () => 0.5,
  });
  const step = builder.getState().decisions.find((d) => d.stepId === 'class');
  assert.ok(step);
  builder.choose(step.id, [fighter.id]);
  return builder;
}

test("a user's version of 5e is offered 5e's starting equipment when it fits, and none when it does not", async () => {
  const fits = await userSystem(JSON.stringify({ id: 'house', name: 'House rules', version: '0.1.0', formatVersion: 1, extends: 'dnd5e' }));
  assert.equal(fits.catalogue.warnings['house'], undefined);
  const offered = fighterBuilder(fits.system).getState().startingEquipment?.sources.find((s) => s.forId === fighter.id);
  assert.deepEqual(offered?.options?.map((o) => o.id), ['equipment', 'wealth']);

  const { system, catalogue } = await userSystem(silver);
  const builder = fighterBuilder(system);
  assert.equal(builder.getState().startingEquipment, undefined, 'no starting equipment is offered');
  // What the old choice by lineage alone did: a wealth roll in gold, which this system does not count.
  assert.equal(builder.takeStartingOption(fighter.id, 'wealth'), 'This character has no starting equipment.');
  assert.equal(builder.getState().character.money, undefined);
  assert.deepEqual(validateCharacter(builder.getState().character, schemas, system).errors, []);

  const warnings = catalogue.warnings['silver'] ?? [];
  assert.deepEqual(
    warnings.map((w) => w.message),
    [
      'The starting equipment that comes with Dungeons & Dragons 5th Edition does not fit this system, so none is offered: ' +
        '"gp" is not a unit of money the system declares.',
    ],
  );
  assert.equal(catalogue.warnings['dnd5e'], undefined, '5e itself is not warned about');
});
