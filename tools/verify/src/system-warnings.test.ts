/**
 * A stat name one slip from a declared one is a warning when a system loads (ADR 0105), against the real schema, the
 * shipped systems and the starter "New system…" writes.
 *
 * Perturbations, each run and failing here: the store not locating warnings (no line); the store not publishing them on load
 * (absent by id); an overlay's warning located in the system it made rather than traced to the overlay's text (wrong line).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryStorage, readJsonText, validateGameSystem } from '@incudo/core';
import { newSystemFile, systemProblemLine, systemWarningsNote, UserSystemStore } from '@incudo/ui';

import { loadSchemas, loadFixtureSystem, loadShippedSystem } from './node-system.ts';

const schemas = await loadSchemas();
const shipped = [await loadShippedSystem('dnd5e'), await loadFixtureSystem('cairn')];
const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The starter's file, with Might misspelled in its Health formula: the slip the guide's measurement found silent. */
function starterWithSlip(): string {
  const file = newSystemFile({ kind: 'starter' }, 'My Game', shipped.map((s) => s.id));
  assert.ok(file.ok);
  const text = file.text.replace('"stat": "might"', '"stat": "mght"');
  assert.notEqual(text, file.text);
  return text;
}

test('the shipped systems and the starter have no warning, though 5e names a hundred stats it does not declare', async () => {
  for (const system of shipped) {
    const result = validateGameSystem(system, schemas);
    assert.equal(result.valid, true, system.id);
    assert.deepEqual(result.warnings, [], system.id);
  }
  const file = newSystemFile({ kind: 'starter' }, 'My Game', []);
  assert.ok(file.ok);
  assert.deepEqual(validateGameSystem(JSON.parse(file.text), schemas).warnings, []);
});

test('a slip is added, named at its line on the add and on every load, and the system still loads', async () => {
  const text = starterWithSlip();
  const lines = text.split('\n');
  const line = lines.findIndex((l) => l.includes('"mght"')) + 1;
  const column = lines[line - 1]!.indexOf('"stat"') + 1; // A member is located at its name (ADR 0103).
  const store = new UserSystemStore(new MemoryStorage(), schemas, [], shipped);
  const added = await store.add({ name: 'my-game.json', bytes: encode(text) });
  assert.ok(added.ok);
  const expected = [
    `Line ${line}, column ${column}: characterKinds "character" › stats "health" › derive › left › stat: names "mght", which this ` +
      'system does not declare; did you mean "might"? A stat nothing declares reads as 0 unless content adds to it.',
  ];
  assert.deepEqual((added.warnings ?? []).map(systemProblemLine), expected);

  const loaded = await store.load();
  assert.deepEqual(loaded.failures, []);
  assert.deepEqual(loaded.systems.map((s) => s.id), ['my-game']);
  assert.deepEqual((loaded.warnings['my-game'] ?? []).map(systemProblemLine), expected);
  assert.equal(systemWarningsNote(1), 'This file loaded. One thing in it is worth checking:');
});

test("an overlay's slip is named at the overlay's own line", async () => {
  const overlay = [
    '{',
    '  "formatVersion": 1, "id": "house", "name": "House", "version": "0.1.0", "extends": "dnd5e",',
    '  "characterKinds": [',
    '    { "id": "pc", "stats": [',
    '      { "name": "grit", "label": "Grit", "derive": { "kind": "ref", "stat": "strenght" } }',
    '    ] }',
    '  ]',
    '}',
  ].join('\n');
  assert.ok(readJsonText(overlay).ok);
  const store = new UserSystemStore(new MemoryStorage(), schemas, [], shipped);
  const added = await store.add({ name: 'house.json', bytes: encode(overlay) });
  assert.ok(added.ok, !added.ok ? added.message : '');
  assert.deepEqual(
    (added.warnings ?? []).map((w) => [w.line, w.message.slice(0, 40)]),
    [[5, 'names "strenght", which this system does']],
  );
});
