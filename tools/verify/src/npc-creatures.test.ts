/**
 * Every creature in the corpus, built as an NPC through the builder — ADR 0057.
 *
 * The corpus states a creature as a `Companion` element that prints its stat block as setters, and its
 * armour class, hit points and speed a second time as its own `companion:*` rules. The six printed
 * scores are where an NPC's scores start; a score the DM types replaces one. That is what is asserted,
 * for every creature the current corpus has, found by type and never by name or count.
 *
 * What is reported and not asserted (ADR 0042: a moving corpus fails only what must hold against any
 * corpus): how many creatures there are, and how often the rules for armour class, hit points and speed
 * agree with what the creature prints. Two armour classes and one hit point total disagree upstream at
 * c28ce6c, and are read as content states them.
 *
 * Perturbations that fail this file, each checked: removing the kind's `setterStats` (every score reads
 * 10), the `budget` on the `abilities` step (nothing to type into), and the kind's cap of 30 on the six
 * scores (the 2014 Triceratops and Tyrannosaurus print 22 and 25 Strength, and a player character's cap
 * of 20 clips both). The engine's order — the print before a typed base — is held in
 * `packages/core/src/setter-stats.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BundleElementIndex,
  deriveCharacter,
  readCharacterContainer,
  readSetterNumber,
  validateGameSystem,
  type Element,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, packCharacter } from '@incudo/ui';

import { loadSchemas } from './node-system.ts';
import { corpusSkip, realElements } from './real-data.ts';

const skip = corpusSkip;
const SCORES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

async function fiveE(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

/** The type a creature is, read off the kind's own creature step rather than spelled here. */
function creatureStep(system: GameSystem) {
  const npc = system.characterKinds.find((k) => k.id === 'npc')!;
  return npc.buildSteps!.find((s) => s.id === 'creature')!;
}

function npcOn(system: GameSystem, elements: ElementIndex, creature: Element): CharacterBuilder {
  const b = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, elements);
  b.choose('build/creature', [creature.id]);
  return b;
}

test('every creature, built as an NPC, starts at the six scores it prints and asks for none', { skip }, async (t) => {
  const system = await fiveE();
  const elements = await realElements();
  const creatures = creatureStep(system).types.flatMap((type) => elements.byType(type));
  assert.ok(creatures.length > 0, 'the corpus has creatures');

  const offered = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, elements)
    .getState()
    .decisions.find((d) => d.stepId === 'creature');
  assert.ok(offered, 'a fresh NPC is asked for a creature');
  // Offered every creature content does not reserve: a creature with its own requirements (a
  // subclass's summon, a feat's mascot, a drake that grows with the ranger's level) names something
  // a PC has, and an NPC is not offered it. Every one left out must be one of those.
  const offeredIds = new Set(offered.candidates);
  const unreserved = creatures.filter((c) => c.requirements === undefined);
  assert.deepEqual(unreserved.filter((c) => !offeredIds.has(c.id)).map((c) => c.id), [], 'every unreserved creature is offered');
  t.diagnostic(`${offeredIds.size} offered to a fresh NPC; ${creatures.length - offeredIds.size} reserved by their own requirements`);

  const wrong: string[] = [];
  const stillOpen: string[] = [];
  let printedAll = 0;
  for (const creature of creatures) {
    const b = npcOn(system, elements, creature);
    const state = b.getState();
    const printsAll = SCORES.every((s) => readSetterNumber(creature.setters[s]?.value) !== undefined);
    if (printsAll) printedAll++;
    for (const score of SCORES) {
      const printed = readSetterNumber(creature.setters[score]?.value);
      if (printed === undefined) continue;
      const actual = state.derived.stats.get(score)?.value;
      if (actual !== printed) wrong.push(`${creature.id} ${score}: prints ${printed}, derives ${actual}`);
    }
    if (printsAll && state.decisions.some((d) => d.kind === 'budget')) stillOpen.push(creature.id);
  }
  t.diagnostic(`${creatures.length} creatures; ${printedAll} print all six scores`);
  assert.deepEqual(wrong, [], 'every printed score is the score');
  assert.deepEqual(stillOpen, [], 'a creature that prints all six leaves nothing to enter');
});

test("a creature's armour class, hit points and speed come from its own rules, and are compared with its print", { skip }, async (t) => {
  // Reported, not asserted: the rules are content's statement and are what the kind reads; the print is
  // display text. A disagreement is upstream's, and this counts them.
  const system = await fiveE();
  const elements = await realElements();
  const creatures = creatureStep(system).types.flatMap((type) => elements.byType(type));
  const tally = new Map<string, { agree: number; differ: string[]; unreadable: number }>();
  for (const stat of ['ac', 'hp', 'speed']) tally.set(stat, { agree: 0, differ: [], unreadable: 0 });

  for (const creature of creatures) {
    const derived = npcOn(system, elements, creature).getState().derived;
    const prints: Record<string, number | undefined> = {
      ac: readSetterNumber(creature.setters['ac']?.value),
      hp: readSetterNumber(creature.setters['hp']?.value),
      // "40 ft., climb 30 ft.": the walking speed is the first number, and is what `speed` is.
      speed: /^\s*(\d+)\s*ft\.?(?:,|$)/i.exec(creature.setters['speed']?.value ?? '')?.[1] !== undefined
        ? Number(/^\s*(\d+)/.exec(creature.setters['speed']!.value)![1])
        : undefined,
    };
    for (const [stat, printed] of Object.entries(prints)) {
      const row = tally.get(stat)!;
      if (printed === undefined) {
        row.unreadable++;
        continue;
      }
      const derivedValue = derived.stats.get(stat)?.value;
      if (derivedValue === printed) row.agree++;
      else row.differ.push(`${creature.id} (${printed} printed, ${derivedValue} derived)`);
    }
  }
  for (const [stat, row] of tally) {
    t.diagnostic(
      `${stat}: ${row.agree} agree with the print, ${row.differ.length} differ, ${row.unreadable} print no plain number` +
        (row.differ.length ? ` — ${row.differ.join('; ')}` : ''),
    );
  }
  // What must hold against any corpus: most creatures are stated consistently. A kind that stopped
  // reading the rules would agree with none.
  for (const [stat, row] of tally) assert.ok(row.agree > row.differ.length, `${stat} mostly agrees with the print`);
});

test('a typed score replaces the print, clearing it goes back, and the NPC reopens with no source', { skip }, async () => {
  const system = await fiveE();
  const elements = await realElements();
  const creatures = creatureStep(system).types.flatMap((type) => elements.byType(type));
  // Any creature that prints a plain Strength will do; none is named.
  const creature = creatures.find((c) => readSetterNumber(c.setters['strength']?.value) !== undefined)!;
  const printed = readSetterNumber(creature.setters['strength']!.value)!;
  const typed = printed === 30 ? 29 : printed + 1;

  const b = npcOn(system, elements, creature);
  b.setBudgetStat('abilities', 'strength', typed);
  assert.equal(b.getState().derived.stats.get('strength')?.value, typed);
  b.setBudgetStat('abilities', 'strength', undefined);
  assert.equal(b.getState().derived.stats.get('strength')?.value, printed);
  assert.equal(b.getState().character.baseStats?.['strength'], undefined, 'the print is not copied into the character');

  b.setBudgetStat('abilities', 'dexterity', 3);
  const character = b.getState().character;
  const packed = packCharacter(character, system, elements, { generator: 'test' });
  const { container, problems } = readCharacterContainer(packed.files);
  assert.deepEqual(problems.filter((p) => p.level === 'error'), []);
  const offline = new BundleElementIndex(container!.content.elements);
  const reopened = deriveCharacter(container!.character, system, offline);
  const original = deriveCharacter(character, system, elements);
  for (const stat of [...SCORES, 'ac', 'hp', 'speed', 'challenge', 'proficiency']) {
    assert.equal(reopened.stats.get(stat)?.value, original.stats.get(stat)?.value, `${stat} after reopening with no source`);
  }
  assert.equal(reopened.stats.get('dexterity')?.value, 3);
});

test('an NPC built from nothing is asked for all six scores, and the step blocks until they are entered', { skip }, async () => {
  const system = await fiveE();
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, elements);
  const budget = b.getState().decisions.find((d) => d.kind === 'budget');
  assert.ok(budget, 'the Ability Scores decision is open');
  assert.equal(budget.blocking, true);
  assert.equal(budget.remaining, 6);
  for (const [n, score] of SCORES.entries()) b.setBudgetStat('abilities', score, 10 + n);
  assert.equal(b.getState().decisions.some((d) => d.kind === 'budget'), false);
  assert.equal(b.getState().derived.stats.get('charisma')?.value, 15);
});
