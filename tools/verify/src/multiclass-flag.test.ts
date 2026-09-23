/**
 * An unmet ability score minimum is a flag, and nothing else about a multiclass gate is — ADR 0045.
 *
 * Against the whole official corpus rather than a fixture: 28 of its classes carry a `<multiclass>`
 * block, in shapes a hand-written one would not think of (`[str:13]||[dex:13]`, a pair of minimums, an
 * unlocker item, the other edition of the class). The invariant that holds against *any* corpus is a
 * relation between two runs of the same character, so nothing here pins a count:
 *
 * - **Scores never change what may be taken.** The set of classes the builder refuses is the same
 *   whether every score is 3 or 30; only the flags differ. Perturbation: make `atLeast` hard again in
 *   `multiclass.ts` and the low-score run refuses classes the high-score run takes.
 * - **The flag is the shortfall, exactly.** Every term names a score below what it asks, and at 30
 *   there are none, so it clears by itself.
 *
 * Lives in `tools/verify` because every noun in it is 5e's, and skips where no corpus is checked out.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCharacter, setBaseStat, validateGameSystem, type Character, type GameSystem } from '@incudo/core';
import { CharacterBuilder } from '@incudo/ui';

import { loadSchemas } from './node-system.ts';
import { corpusSkip, realElements, requireCorpus } from './real-data.ts';

async function fiveE(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

test('a short score flags a class and never refuses it, across every multiclass block in the corpus', { skip: corpusSkip }, async () => {
  requireCorpus();
  const system = await fiveE();
  const corpus = await realElements();

  const classes = corpus.byType('Class');
  // A first class with a block of its own, so the rest are the classes a second level could go to.
  const first = classes.find((element) => element.name === 'Fighter' && element.multiclass);
  assert.ok(first, 'the corpus has a Fighter with multiclass rules');

  const optionsAt = (score: number) => {
    let character: Character = createCharacter('dnd5e', 'pc', { progress: 3 });
    for (const ability of ABILITIES) character = setBaseStat(character, ability, score);
    const builder = new CharacterBuilder(character, system, corpus);
    builder.choose('build/class', [first.id]);
    return builder.classLevelsFor('levels')!.options;
  };

  const low = optionsAt(3);
  const high = optionsAt(30);
  assert.equal(low.length, high.length);

  const refusedLow = low.filter((o) => !o.eligible).map((o) => `${o.id}:${o.unavailable}`);
  const refusedHigh = high.filter((o) => !o.eligible).map((o) => `${o.id}:${o.unavailable}`);
  assert.deepEqual(refusedLow, refusedHigh, 'scores decide flags, never whether a class may be taken');

  const flagged = low.filter((o) => o.flag !== undefined);
  assert.ok(flagged.length > 0, 'a Charisma of 3 is short of some minimum in the corpus');
  for (const option of flagged) {
    assert.equal(option.eligible, true, `${option.id} is taken and flagged, not refused`);
    for (const alternative of option.flag!) {
      assert.ok(alternative.length > 0);
      for (const term of alternative) assert.ok(term.has < term.needs, `${option.id}: ${term.stat} ${term.has} < ${term.needs}`);
    }
  }
  assert.deepEqual(
    high.filter((o) => o.flag !== undefined).map((o) => o.id),
    [],
    'at 30 every minimum is met, so nothing is flagged',
  );

  // What refusing still means: the corpus's own reasons, none of them a score.
  for (const option of low.filter((o) => !o.eligible)) {
    assert.ok(
      option.unavailable === 'no-multiclass-rules' || option.unavailable === 'excluded' || option.unavailable === 'prerequisite',
    );
  }
  assert.ok(
    low.filter((o) => o.unavailable === 'prerequisite').length === 0 ||
      low.filter((o) => o.unavailable === 'prerequisite').every((o) => high.find((h) => h.id === o.id)?.eligible === false),
    'a class refused as a prerequisite is refused at 30 too, so it is not about scores',
  );
});
