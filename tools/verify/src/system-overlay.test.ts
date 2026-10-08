/**
 * A house-rule overlay of the shipped 5e, through the store the app uses — ADR 0102.
 *
 * The first half needs no corpus: an overlay is added, kept as written, applied to 5e as 5e is on each load, and a fix to
 * 5e the overlay does not touch reaches it. The second half builds a character in the overlay with the real corpus, to
 * show the engine and the builder need nothing for it, and that what is kept beside 5e (starting equipment) serves it.
 * Each case names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, type GameSystem, type PickedFile } from '@incudo/core';
import { CharacterBuilder, USER_SYSTEM_PREFIX, UserSystemStore, newCharacterOfKind, overlayView } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import { loadSchemas, loadShippedStartingEquipment, loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements } from './real-data.ts';

const schemas = await loadSchemas();
const dnd5e = await loadShippedSystem('dnd5e');
const cairn = await loadShippedSystem('cairn');

/** ADR 0011's example, as ADR 0102 writes it. */
const HOUSE = {
  formatVersion: 1,
  id: 'dnd5e-house',
  name: '5e (our table)',
  version: '1.0.0',
  extends: 'dnd5e',
  stats: [{ name: 'sanity', label: 'Sanity', default: 10 }],
  characterKinds: [{ id: 'pc', progression: { max: 30 } }],
};

function file(name: string, body: unknown): PickedFile {
  return { name, bytes: new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body, null, 2)) };
}

function store(storage: MemoryStorage, bases: GameSystem[] = [dnd5e, cairn]): UserSystemStore {
  return new UserSystemStore(storage, schemas, [], bases);
}

const maxOf = (system: GameSystem, kind: string): number | undefined => {
  const progression = system.characterKinds.find((k) => k.id === kind)!.progression;
  return progression && 'max' in progression ? (progression.max as number) : undefined;
};

// Perturbation: UserSystemStore validating without a parent (the overlay is refused as having nothing to apply to).
test('an overlay of 5e is added, kept as written, and loads as 5e with its changes', async () => {
  const storage = new MemoryStorage();
  const added = await store(storage).add(file('house.json', HOUSE));
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.equal(await storage.read(`${USER_SYSTEM_PREFIX}dnd5e-house.json`), JSON.stringify(HOUSE, null, 2));

  const { systems, failures, overlays } = await store(storage).load();
  assert.deepEqual(failures, []);
  const house = systems.find((s) => s.id === 'dnd5e-house')!;
  assert.equal(house.extends, 'dnd5e');
  assert.equal(maxOf(house, 'pc'), 30);
  assert.equal(house.characterKinds.length, dnd5e.characterKinds.length);
  assert.equal(house.stats.length, dnd5e.stats.length + 1);
  assert.deepEqual(overlayView(house, overlays['dnd5e-house']!), {
    builtOn: 'Built on Dungeons & Dragons 5th Edition.',
    changes: ['Adds the stat Sanity', 'Changes the progression of the character kind Player Character'],
  });
});

// Perturbation: storing the applied system, or caching the first load's result (the fixed parent never reaches it).
test('a fix to 5e the overlay does not touch reaches it on the next load, and its own change stays', async () => {
  const storage = new MemoryStorage();
  await store(storage).add(file('house.json', HOUSE));
  const fixed = JSON.parse(JSON.stringify(dnd5e)) as GameSystem;
  const npc = fixed.characterKinds.find((k) => k.id === 'npc')!;
  npc.name = 'Non-Player Character (fixed)';

  const before = (await store(storage).load()).systems.find((s) => s.id === 'dnd5e-house')!;
  const after = (await store(storage, [fixed, cairn]).load()).systems.find((s) => s.id === 'dnd5e-house')!;
  assert.notEqual(before.characterKinds.find((k) => k.id === 'npc')!.name, 'Non-Player Character (fixed)');
  assert.equal(after.characterKinds.find((k) => k.id === 'npc')!.name, 'Non-Player Character (fixed)');
  assert.equal(maxOf(after, 'pc'), 30);
});

// Perturbation: a parent change that breaks the overlay half-loading it (it must be a named failure).
test('a change to 5e that breaks the overlay is named, not half-loaded', async () => {
  const storage = new MemoryStorage();
  // Shows the stat it adds on a sheet section of 5e's player character.
  const showing = { ...HOUSE, characterKinds: [{ id: 'pc', sheet: { sections: [{ id: 'senses', stats: ['sanity'] }] } }] };
  assert.equal((await store(storage).add(file('house.json', showing))).ok, true);
  const renamed = JSON.parse(JSON.stringify(dnd5e)) as GameSystem;
  const pc = renamed.characterKinds.find((k) => k.id === 'pc')!;
  pc.sheet!.sections = pc.sheet!.sections.filter((section) => section.id !== 'senses');

  const { systems, failures } = await store(storage, [renamed, cairn]).load();
  assert.equal(systems.some((s) => s.id === 'dnd5e-house'), false);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]!.id, 'dnd5e-house');
  assert.ok(failures[0]!.errors.length > 0);
  // ADR 0103: the section the overlay patched is now one it adds, and its error is at the overlay's own line.
  const text = JSON.stringify(showing, null, 2);
  const sensesLine = text.split('\n').findIndex((line) => line.includes('"senses"'));
  assert.deepEqual(
    failures[0]!.problems.map((p) => [p.where, p.line, p.fromParent]),
    failures[0]!.errors.map(() => ['characterKinds "pc" › sheet › sections "senses" › label', sensesLine, undefined]),
  );
});

// Perturbation: the store reading with JSON.parse again (V8's words, no line of its own).
test('a file that is not JSON is refused at its line, in words', async () => {
  const result = await store(new MemoryStorage()).add(file('house.json', '{\n  "id": "x",\n}'));
  assert.equal(result.ok, false);
  assert.deepEqual(result.ok ? undefined : result.problems, [
    { where: '', line: 2, column: 12, message: 'There is a comma after the last entry, before the }. JSON does not allow one: remove it.' },
  ]);
});

// Perturbation: loading the user's files in name order only (an overlay sorting before its parent finds nothing).
test("an overlay of the user's own system loads whatever the files are called", async () => {
  const storage = new MemoryStorage();
  const mine = { ...JSON.parse(JSON.stringify(cairn)), id: 'zz-my-cairn', name: 'My Cairn' };
  await store(storage).add(file('mine.json', mine));
  const added = await store(storage).add(file('house.json', { formatVersion: 1, id: 'aa-cairn-house', name: 'Our Cairn', version: '1', extends: 'zz-my-cairn', stats: [{ name: 'slots', default: 12 }] }));
  assert.equal(added.ok, true, JSON.stringify(added));
  const { systems, failures } = await store(storage).load();
  assert.deepEqual(failures, []);
  assert.equal(systems.find((s) => s.id === 'aa-cairn-house')!.stats.find((s) => s.name === 'slots')!.default, 12);
});

// Perturbation: letting an overlay's parent be another overlay, or a system nobody has.
test('an overlay of an overlay, or of nothing, is refused with a sentence', async () => {
  const storage = new MemoryStorage();
  await store(storage).add(file('house.json', HOUSE));
  const onTop = await store(storage).add(file('more.json', { ...HOUSE, id: 'dnd5e-more', extends: 'dnd5e-house' }));
  assert.equal(onTop.ok, false);
  assert.match(onTop.ok ? '' : onTop.errors![0]!.message, /changes another system itself/);
  const nowhere = await store(storage).add(file('gone.json', { ...HOUSE, id: 'gone', extends: 'pathfinder' }));
  assert.match(nowhere.ok ? '' : nowhere.errors![0]!.message, /names "pathfinder", which is not a system Incudo has/);
});

// Perturbation: reserving only the ids passed as `reserved` (a shipped base's id would be taken).
test("an overlay may not take a shipped system's id", async () => {
  const result = await store(new MemoryStorage()).add(file('cairn.json', { ...HOUSE, id: 'cairn' }));
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.message, /cannot share an id/);
  assert.doesNotMatch(result.ok ? '' : result.message, /ADR/);
});

// Perturbation: the builder matching starting equipment by `file.system === system.id` (the overlay is offered none).
test('a character built in an overlay derives as in 5e and is offered 5e starting equipment', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const storage = new MemoryStorage();
  await store(storage).add(file('house.json', HOUSE));
  const house = (await store(storage).load()).systems.find((s) => s.id === 'dnd5e-house')!;
  const elements = await realElements();
  const equipment = await loadShippedStartingEquipment('dnd5e');

  const build = (system: GameSystem): CharacterBuilder => {
    const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements, { startingEquipment: [equipment] });
    for (const [step, name] of [['race', 'Human'], ['class', 'Fighter'], ['background', 'Soldier']] as const) {
      const decision = b.getState().decisions.find((d) => d.stepId === step && d.kind === 'pick')!;
      const id = decision.candidates.find((c) => elements.get(c)?.name === name && elements.get(c)?.source === 'Player’s Handbook')!;
      b.choose(decision.id, [id]);
    }
    return b;
  };
  const base = build(dnd5e).getState();
  const mine = build(house).getState();
  assert.equal(mine.character.systemId, 'dnd5e-house');
  // The overlay adds a stat no formula reads: everything else is 5e's.
  const { ['sanity']: sanity, ...stats } = summarize(mine.derived).stats as Record<string, number>;
  assert.equal(sanity, 10);
  const { character: ours, ...derived } = { ...summarize(mine.derived), stats };
  const { character: theirs, ...expected } = summarize(base.derived);
  assert.deepEqual(derived, expected);
  assert.deepEqual({ ...ours, id: undefined, systemId: undefined }, { ...theirs, id: undefined, systemId: undefined });
  assert.deepEqual(
    mine.startingEquipment?.sources.map((s) => s.status),
    base.startingEquipment?.sources.map((s) => s.status),
  );
  assert.ok((mine.startingEquipment?.sources.length ?? 0) > 0);
});
