/**
 * Where a system definition's error is — ADR 0103. Each case names the perturbation that fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { readJsonText, validateGameSystem, type GameSystem, type JsonSchema, type SchemaBundle } from '@incudo/core';

import { describeSystemErrors, systemProblemLine, type SystemProblem } from './system-problems.ts';

const system = JSON.parse(readFileSync(new URL('../../../schemas/system.schema.json', import.meta.url), 'utf8')) as JsonSchema;
const schemas = { system, character: true, manifest: true } as SchemaBundle;

const PARENT: GameSystem = {
  formatVersion: 1,
  id: 'base',
  name: 'Base Game',
  version: '1.0.0',
  elementTypes: [{ name: 'Class' }],
  stats: [
    { name: 'might', label: 'Might', default: 10 },
    { name: 'wits', label: 'Wits', default: 10 },
  ],
  characterKinds: [
    {
      id: 'pc',
      name: 'Player Character',
      progression: { kind: 'level', min: 1, max: 20 },
      elementTypes: ['Class'],
      buildSteps: [{ id: 'class', label: 'Class', types: ['Class'], required: true }],
      sheet: { sections: [{ id: 'scores', label: 'Scores', stats: ['might', 'wits'] }] },
    },
  ],
} as GameSystem;

/** Validate a file's text as the store does, and locate what is wrong. */
function problems(text: string, parent?: GameSystem): SystemProblem[] {
  const read = readJsonText(text);
  assert.ok(read.ok, 'the test text is JSON');
  const result = validateGameSystem(read.value, schemas, { parent: (id) => (parent && id === parent.id ? parent : undefined) });
  return describeSystemErrors(result.errors, read.value, read.positions, result.overlay);
}

const lines = (found: SystemProblem[]): string[] => found.map(systemProblemLine);

// Perturbation: describing an identified entry by its position ("characterKinds #1"), or reading lines off the wrong
// path (a missing field placed at line 1 rather than at the object that should hold it).
test('a structural error names the entries by the ids written there, at the line of the object that lacks the field', () => {
  const definition = JSON.parse(JSON.stringify(PARENT)) as Record<string, any>;
  definition.characterKinds[0].buildSteps.push({ id: 'feats', types: ['Class'] });
  const text = JSON.stringify(definition, null, 2);
  const found = problems(text);
  assert.equal(found.length, 1);
  const stepLine = text.split('\n').findIndex((line) => line.includes('"feats"'));
  assert.deepEqual(found[0], {
    where: 'characterKinds "pc" › buildSteps "feats" › label',
    message: 'is required',
    // The `{` opening the step is the line before its "id".
    line: stepLine,
    column: 9,
  });
  assert.equal(lines(found)[0], `Line ${stepLine}, column 9: characterKinds "pc" › buildSteps "feats" › label: is required`);
});

// Perturbation: numbering an unidentified array from 0.
test('an entry with no identity is counted from 1', () => {
  const definition = JSON.parse(JSON.stringify(PARENT)) as Record<string, any>;
  definition.characterKinds[0].contributions = [{ stat: 'might', value: { kind: 'number', value: 1 } }, { stat: 'wits' }];
  const found = problems(JSON.stringify(definition, null, 2));
  assert.equal(found[0]!.where, 'characterKinds "pc" › contributions #2 › value');
  assert.equal(found[0]!.message, 'is required');
});

test("a reference check's container is named, and the entry is in its words", () => {
  const definition = JSON.parse(JSON.stringify(PARENT)) as Record<string, any>;
  definition.characterKinds[0].sheet.sections[0].stats.push('luck');
  const text = JSON.stringify(definition, null, 2);
  const found = problems(text);
  assert.deepEqual(found.map((p) => p.where), ['characterKinds "pc" › sheet']);
  assert.match(found[0]!.message, /section "scores" shows the stat "luck"/);
  assert.equal(found[0]!.line, text.split('\n').findIndex((line) => line.includes('"sheet"')) + 1);
});

// Perturbation: locating an overlay's error on the applied system's positions (the line would be the parent's, or none).
test("an overlay's error is placed at the overlay's own line, its entries found by id", () => {
  const overlay = {
    formatVersion: 1,
    id: 'house',
    name: 'House',
    version: '1',
    extends: 'base',
    stats: [{ name: 'luck', default: 1 }],
    characterKinds: [{ id: 'pc', buildSteps: [{ id: 'boons', types: ['Class'] }] }],
  };
  const text = JSON.stringify(overlay, null, 2);
  const found = problems(text, PARENT);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.where, 'characterKinds "pc" › buildSteps "boons" › label');
  assert.equal(found[0]!.fromParent, undefined);
  // In the applied system the step is the second; in the overlay it is the first, on the line of its `{`.
  assert.equal(found[0]!.line, text.split('\n').findIndex((line) => line.includes('"boons"')));
});

// Perturbation: giving an error in the parent's unchanged part the overlay's nearest line, as if the overlay wrote it.
test("an error in a part the overlay does not write is said to be the parent's", () => {
  const overlay = { formatVersion: 1, id: 'house', name: 'House', version: '1', extends: 'base', stats: [{ name: 'wits', remove: true }] };
  const found = problems(JSON.stringify(overlay, null, 2), PARENT);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.fromParent, 'Base Game');
  assert.equal(found[0]!.line, undefined);
  assert.match(
    systemProblemLine(found[0]!),
    /^In Base Game's part, which something this file changes or removes breaks: characterKinds "pc" › sheet: section "scores" shows the stat "wits"/,
  );
});

// Perturbation: describing an overlay's shell error against an applied system that does not exist.
test("an overlay's own shell is located in its own text", () => {
  const text = '{\n  "formatVersion": 1,\n  "id": "house",\n  "name": "House",\n  "version": "1",\n  "extends": "base",\n  "stats": {}\n}';
  assert.deepEqual(lines(problems(text, PARENT)), ['Line 7, column 3: stats: must be an array, not an object']);
});
