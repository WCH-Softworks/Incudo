/**
 * The six short ability names 5e content reads — ADR 0036.
 *
 * Content writes `[cha:13]` seventy-two times and nothing published a stat called `cha`, so every
 * ability prerequisite in the corpus — all 28 multiclass gates, 24 feats, six rules — read false for
 * every character. `aurora verify` cannot see that: it compares the elements a character *chose*,
 * and came back byte-identical on all nine saves before and after the fix. The evidence is
 * perturbation, here: delete the six stats from `systems/dnd5e/system.json` and this fails.
 *
 * Lives in `tools/incudo` because every noun in it is 5e's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MapElementIndex,
  createCharacter,
  deriveCharacter,
  evaluateRequirements,
  parseRequirements,
  requirementContextFor,
  setBaseStat,
  validateGameSystem,
  type Character,
  type Element,
  type GameSystem,
} from '@incudo/core';

import { loadSchemas } from './node-system.ts';

async function fiveE(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

function element(id: string, type: string, rules: Element['rules'] = []): Element {
  return {
    id,
    type,
    name: id,
    source: 'test',
    setters: {},
    rules,
    supports: [],
    origin: { sourceId: 'test', format: 'incudo' },
  };
}

test('an ability prerequisite in content\'s own spelling reads the ability it names', async () => {
  const system = await fiveE();
  const index = new MapElementIndex();
  // A racial +2 arrives as an ordinary contribution, so the short name has to follow the full one
  // through the derivation and not just read the base score.
  index.addAll([
    element('RACE', 'Race', [
      { kind: 'stat', key: 'r', name: 'charisma', value: { kind: 'number', value: 2 } },
    ]),
  ]);

  const character = (charisma: number): Character => {
    let c = createCharacter('dnd5e', 'pc', { progress: 1 });
    c = setBaseStat(c, 'charisma', charisma);
    return { ...c, choices: [{ ruleKey: 'build/race', elementIds: ['RACE'] }] };
  };
  const reads = (c: Character, expression: string): boolean => {
    const derived = deriveCharacter(c, system, index);
    return evaluateRequirements(parseRequirements(expression), requirementContextFor(derived));
  };

  // 11 + the racial 2 = 13: exactly the threshold, which is where an off-by-one would show.
  assert.equal(reads(character(11), '[cha:13]'), true);
  assert.equal(reads(character(10), '[cha:13]'), false);
  assert.equal(reads(character(11), '[cha:14]'), false);

  const derived = deriveCharacter(character(11), system, index);
  for (const [short, full] of [
    ['str', 'strength'],
    ['dex', 'dexterity'],
    ['con', 'constitution'],
    ['int', 'intelligence'],
    ['wis', 'wisdom'],
    ['cha', 'charisma'],
  ] as const) {
    assert.equal(derived.stats.get(short)?.value, derived.stats.get(full)?.value, `${short} reads ${full}`);
  }

  // The composite shapes the corpus writes, in its own operators.
  const both = '([str:13],[cha:13])';
  assert.equal(reads(character(11), both), false, 'Strength is a default 10');
  assert.equal(reads(character(11), '([str:13]||[cha:13])'), true);
});

