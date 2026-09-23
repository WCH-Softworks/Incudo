/**
 * A class split through the builder, against the official corpus — ADR 0045 decision 1.
 *
 * `applySplit` is the fast path to a multiclass character, so its proof is that it is not a second
 * model: the same levels said as totals are the same character as the same levels taken one at a time,
 * and the order the totals are given in is the order the levels were taken.
 *
 * Lives in `tools/verify` because every noun in it is 5e's, and skips where no corpus is checked out.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BundleElementIndex,
  createCharacter,
  deriveCharacter,
  readCharacterContainer,
  setBaseStat,
  validateGameSystem,
  type Character,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import { CharacterBuilder, packCharacter } from '@incudo/ui';

import { summarize } from './derived-summary.ts';
import { loadSchemas } from './node-system.ts';
import { corpusSkip, realElements, requireCorpus } from './real-data.ts';

async function fiveE(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

function classNamed(corpus: ElementIndex, name: string): string {
  const found = corpus.byType('Class').find((element) => element.name === name && element.multiclass);
  assert.ok(found, `the corpus has a ${name} with multiclass rules`);
  return found.id;
}

function fresh(system: GameSystem, corpus: ElementIndex, first: string, score = 14): CharacterBuilder {
  let character: Character = createCharacter('dnd5e', 'pc', { progress: 1 });
  for (const ability of ABILITIES) character = setBaseStat(character, ability, score);
  const builder = new CharacterBuilder(character, system, corpus);
  builder.choose('build/class', [first]);
  return builder;
}

const shape = (builder: CharacterBuilder, system: GameSystem, corpus: ElementIndex) => {
  const character = builder.getState().character;
  return {
    progress: character.progress,
    advancement: character.advancement,
    records: character.choices.filter((c) => c.ruleKey.includes('select:Multiclass')),
    // The character's own id is minted per builder; everything else about the derivation is compared.
    derived: { ...summarize(deriveCharacter(character, system, corpus)), character: undefined },
  };
};

test('a Fighter 12 / Wizard 5 said as a split is the character built one level at a time', { skip: corpusSkip }, async () => {
  requireCorpus();
  const system = await fiveE();
  const corpus = await realElements();
  const fighter = classNamed(corpus, 'Fighter');
  const wizard = classNamed(corpus, 'Wizard');

  const byLevel = fresh(system, corpus, fighter);
  for (let n = 2; n <= 12; n += 1) assert.equal(byLevel.addLevel('levels', fighter), true);
  for (let n = 13; n <= 17; n += 1) assert.equal(byLevel.addLevel('levels', wizard), true);

  const bySplit = fresh(system, corpus, fighter);
  assert.equal(bySplit.applySplit('levels', [{ classId: fighter, levels: 12 }, { classId: wizard, levels: 5 }]), true);

  assert.equal(bySplit.getState().character.progress, 17);
  assert.equal(bySplit.getState().character.advancement!.length, 17);
  assert.deepEqual(shape(bySplit, system, corpus), shape(byLevel, system, corpus));
  assert.equal(shape(bySplit, system, corpus).records.length, 1, 'the Wizard is written as a second class');
});

test('the order of a split is observable: the first class is the one the character started as', { skip: corpusSkip }, async () => {
  requireCorpus();
  const system = await fiveE();
  const corpus = await realElements();
  const rogue = classNamed(corpus, 'Rogue');
  const wizard = classNamed(corpus, 'Wizard');

  const rogueFirst = fresh(system, corpus, rogue);
  assert.equal(rogueFirst.applySplit('levels', [{ classId: rogue, levels: 4 }, { classId: wizard, levels: 4 }]), true);
  const wizardFirst = fresh(system, corpus, rogue);
  assert.equal(wizardFirst.applySplit('levels', [{ classId: wizard, levels: 4 }, { classId: rogue, levels: 4 }]), true);

  const a = shape(rogueFirst, system, corpus);
  const b = shape(wizardFirst, system, corpus);
  assert.equal(a.advancement![0]!.elementId, rogue);
  assert.equal(b.advancement![0]!.elementId, wizard);
  assert.notDeepEqual(a.derived, b.derived, 'the starting class carries its full proficiencies, the other its multiclass set');
  assert.equal(a.records.length, 1);
  assert.equal(b.records.length, 1);
  assert.notDeepEqual(a.records[0]!.elementIds, b.records[0]!.elementIds, 'the second class is the one with a record');

  // And an interleaved split is one input too.
  const interleaved = fresh(system, corpus, rogue);
  assert.equal(
    interleaved.applySplit('levels', [
      { classId: rogue, levels: 1 }, { classId: wizard, levels: 1 }, { classId: rogue, levels: 1 }, { classId: wizard, levels: 1 },
    ]),
    true,
  );
  assert.deepEqual(interleaved.getState().character.advancement!.map((e) => e.elementId), [rogue, wizard, rogue, wizard]);
});

test('a split whose scores are short is taken and flagged, and the flag survives the split', { skip: corpusSkip }, async () => {
  requireCorpus();
  const system = await fiveE();
  const corpus = await realElements();
  const fighter = classNamed(corpus, 'Fighter');
  const wizard = classNamed(corpus, 'Wizard');

  const builder = fresh(system, corpus, fighter, 8);
  assert.equal(builder.applySplit('levels', [{ classId: fighter, levels: 3 }, { classId: wizard, levels: 3 }]), true);
  const option = builder.classLevelsFor('levels')!.options.find((o) => o.id === wizard)!;
  assert.equal(option.taken, true);
  assert.ok(option.flag?.some((terms) => terms.some((t) => t.stat === 'int' && t.needs === 13 && t.has === 8)));
});

test('a flagged split is saved and opened with zero sources, and the flag is re-derived (ADR 0012, ADR 0045)', { skip: corpusSkip }, async () => {
  requireCorpus();
  const system = await fiveE();
  const corpus = await realElements();
  const fighter = classNamed(corpus, 'Fighter');
  const wizard = classNamed(corpus, 'Wizard');

  // Intelligence 8 is short of the Wizard's multiclass minimum of 13.
  const builder = fresh(system, corpus, fighter, 8);
  assert.equal(builder.applySplit('levels', [{ classId: fighter, levels: 5 }, { classId: wizard, levels: 3 }]), true);
  const character = builder.getState().character;
  const before = builder.classLevelsFor('levels')!.options.find((o) => o.id === wizard)!.flag;
  assert.ok(before?.length, 'the split is flagged');

  // Save it, forget the corpus entirely, and open it against nothing but what the save embeds.
  const packed = packCharacter(character, system, corpus, { generator: 'test' });
  const { container, problems } = readCharacterContainer(packed.files);
  assert.deepEqual(problems.filter((p) => p.level === 'error'), []);
  const offline: ElementIndex = new BundleElementIndex(container!.content.elements);

  assert.deepEqual(
    { ...summarize(deriveCharacter(container!.character, system, offline)), character: undefined },
    { ...summarize(deriveCharacter(character, system, corpus)), character: undefined },
    'the same character with no source configured',
  );

  const reopened = new CharacterBuilder(container!.character, system, offline);
  const after = reopened.classLevelsFor('levels')!.options.find((o) => o.id === wizard)!.flag;
  assert.deepEqual(after, before, 'the flag comes back from the embedded class elements and the saved scores');

  // And it clears the moment the score is raised, on the reopened character, still with no corpus.
  reopened.setBaseStat('intelligence', 13);
  assert.equal(reopened.classLevelsFor('levels')!.options.find((o) => o.id === wizard)!.flag, undefined);
});
