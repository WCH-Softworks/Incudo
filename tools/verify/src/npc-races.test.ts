/**
 * An NPC built on a race — ADR 0122.
 *
 * The official content writes 141 creatures as data, every one a beast, a familiar or a class summon, so a goblin, an
 * elf guard or a human bandit captain could only be built from nothing. 5e's NPC and legendary creature now offer a
 * race beside the creature. Measured here first, and then held:
 *
 * - **What a race gives a character held by an NPC**: its stat rules (the six scores, `innate speed` and the other
 *   innate speeds, per-feature numbers), the elements it grants (racial traits, languages, proficiencies, a size, a
 *   vision, spells) and the selects it opens (a subrace, languages, a cantrip, ability score increases). Each race is
 *   built twice, as an NPC and as a level 1 player character, both with every score at 10, its first subrace taken, and
 *   what differs is reported: that is what the NPC's kind reads differently, not what the race says.
 * - **What holds against any corpus**: every race content does not reserve is offered; on a race alone the NPC derives
 *   the player character's six scores and five speeds; every vision it holds is listed under Senses and every race,
 *   subrace and size under Creature; and it opens again with no source to the same sheet.
 * - **With a creature as well**: the creature's speed is used and the race's is not (both state where speed starts),
 *   while the race's increases add to the creature's printed scores. Reported: how many creatures print a humanoid type.
 *
 * Perturbations that fail this file, each checked: removing the NPC's race step (nothing offered), its five gated
 * contributions (every speed reads 0), `Vision` from its Senses section, `Race` from its Creature section, and the
 * `![type:companion]` term of those contributions (a creature's speed and its race's are summed).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BundleElementIndex,
  readCharacterContainer,
  validateGameSystem,
  type Element,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, packCharacter, sheetDocument, sheetMarkdown, type BuilderState } from '@incudo/ui';

import { loadSchemas } from './node-system.ts';
import { corpusSkip, realElements } from './real-data.ts';

const skip = corpusSkip;
const SCORES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const SPEEDS = ['speed', 'speed:burrow', 'speed:climb', 'speed:fly', 'speed:swim'];

async function fiveE(): Promise<GameSystem> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'systems', 'dnd5e', 'system.json');
  const result = validateGameSystem(JSON.parse(await readFile(path, 'utf8')), await loadSchemas());
  assert.deepEqual(result.errors, [], 'systems/dnd5e should validate');
  return result.value!;
}

/** The race step of a kind, read off the kind rather than spelled here. */
function raceStep(system: GameSystem, kind: string) {
  const def = system.characterKinds.find((k) => k.id === kind)!;
  const own = def.buildSteps?.find((s) => s.id === 'race');
  return own;
}

/** A character of `kind` holding `race` and, when the race opens a subrace, the first one offered. Every score 10. */
function onRace(system: GameSystem, elements: ElementIndex, kind: string, race: Element, creature?: Element): CharacterBuilder {
  const character = newCharacterOfKind(system, kind);
  if (kind === 'pc') character.baseStats = Object.fromEntries(SCORES.map((s) => [s, 10]));
  const b = new CharacterBuilder(character, system, elements);
  if (creature) b.choose('build/creature', [creature.id]);
  b.choose('build/race', [race.id]);
  const sub = b.getState().decisions.find((d) => d.kind === 'select' && d.candidates.some((id) => elements.get(id)?.type === 'Sub Race'));
  if (sub) b.choose(sub.id, [sub.candidates[0]!]);
  return b;
}

function stat(state: BuilderState, name: string): number {
  return state.derived.stats.get(name)?.value ?? 0;
}

function listed(state: BuilderState, section: string): Set<string> {
  const view = state.sheet.sections.find((s) => s.id === section);
  return new Set((view?.elements ?? []).map((e) => e.elementId));
}

async function offeredRaces(system: GameSystem, elements: ElementIndex): Promise<Element[]> {
  const decision = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, elements)
    .getState()
    .decisions.find((d) => d.stepId === 'race');
  assert.ok(decision, 'a fresh NPC is asked for a race');
  return decision.candidates.map((id) => elements.get(id)!);
}

test('the NPC and the legendary creature offer every race content does not reserve, and neither must take one', { skip }, async (t) => {
  const system = await fiveE();
  const elements = await realElements();
  for (const kind of ['npc', 'legendary']) {
    const step = raceStep(system, kind);
    assert.ok(step, `${kind} declares a race step`);
    assert.equal(step.required ?? false, false, `${kind}'s race step is not required`);
    const decision = new CharacterBuilder(newCharacterOfKind(system, kind), system, elements)
      .getState()
      .decisions.find((d) => d.stepId === 'race');
    assert.ok(decision, `a fresh ${kind} is asked for a race`);
    assert.equal(decision.blocking, false, `${kind}'s race never blocks`);
    const offered = new Set(decision.candidates);
    const races = step.types.flatMap((type) => elements.byType(type));
    const unreserved = races.filter((r) => r.requirements === undefined);
    assert.deepEqual(unreserved.filter((r) => !offered.has(r.id)).map((r) => r.id), [], `${kind}: every unreserved race is offered`);
    t.diagnostic(`${kind}: ${offered.size} of ${races.length} races offered; ${races.length - offered.size} carry requirements of their own`);
  }
});

test('on a race alone an NPC derives what a player character derives from it, and its sheet names it', { skip }, async (t) => {
  const system = await fiveE();
  const elements = await realElements();
  const races = await offeredRaces(system, elements);

  const wrong: string[] = [];
  const unlistedVision: string[] = [];
  const unnamed: string[] = [];
  const differ = new Map<string, number>();
  const grants = new Map<string, number>();
  const opens = new Map<string, number>();
  let withVision = 0;
  let withSize = 0;
  for (const race of races) {
    const npc = onRace(system, elements, 'npc', race).getState();
    const pc = onRace(system, elements, 'pc', race).getState();
    for (const name of [...SCORES, ...SPEEDS]) {
      if (stat(npc, name) !== stat(pc, name)) wrong.push(`${race.id} ${name}: NPC ${stat(npc, name)}, player character ${stat(pc, name)}`);
    }
    // What the NPC's kind reads differently: every other stat the race family moves on the player character.
    for (const [name, value] of pc.derived.stats) {
      if (SCORES.includes(name) || SPEEDS.includes(name)) continue;
      const contributed = value.contributions.some((c) => c.from !== undefined && npc.derived.elements.some((e) => e.id === c.from));
      if (!contributed) continue;
      if ((npc.derived.stats.get(name)?.value ?? 0) !== value.value) differ.set(name, (differ.get(name) ?? 0) + 1);
    }
    const held = npc.derived.elements;
    for (const e of held) if (e.id !== race.id) grants.set(e.type, (grants.get(e.type) ?? 0) + 1);
    for (const d of npc.decisions) {
      if (d.kind !== 'select' || d.stepId === 'creature' || d.stepId === 'race' || d.stepId === 'traits' || d.stepId === 'actions') continue;
      const type = elements.get(d.candidates[0] ?? '')?.type ?? 'nothing';
      opens.set(type, (opens.get(type) ?? 0) + 1);
    }
    const senses = listed(npc, 'senses');
    const visions = held.filter((e) => e.type === 'Vision');
    if (visions.length > 0) withVision++;
    for (const v of visions) if (!senses.has(v.id)) unlistedVision.push(`${race.id}: ${v.id}`);
    const creature = listed(npc, 'creature');
    for (const e of held.filter((x) => x.type === 'Race' || x.type === 'Sub Race' || x.type === 'Size')) {
      if (!creature.has(e.id)) unnamed.push(`${race.id}: ${e.id}`);
    }
    if (held.some((e) => e.type === 'Size')) withSize++;
  }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
  t.diagnostic(`${races.length} races built as an NPC and as a player character`);
  t.diagnostic(`elements the race gives an NPC, by type: ${top(grants)}`);
  t.diagnostic(`decisions it opens, by what they offer: ${top(opens)}`);
  t.diagnostic(`${withVision} hold a vision and ${withSize} a size`);
  t.diagnostic(`other stats the player character reads differently (races): ${top(differ) || 'none'}`);
  assert.deepEqual(wrong, [], 'the six scores and five speeds are the same on an NPC as on a player character');
  assert.deepEqual(unlistedVision, [], 'every vision the race gives is listed under Senses');
  assert.deepEqual(unnamed, [], 'the race, its subrace and its size are named under Creature');
});

test('an NPC built on a race opens with no source to the same sheet', { skip }, async () => {
  const system = await fiveE();
  const elements = await realElements();
  const races = await offeredRaces(system, elements);
  const differ: string[] = [];
  for (const race of races) {
    const state = onRace(system, elements, 'npc', race).getState();
    const before = sheetMarkdown(sheetDocument(state));
    const { container } = readCharacterContainer(packCharacter(state.character, system, elements, { generator: 'test' }).files);
    const reopened = new CharacterBuilder(container!.character, system, new BundleElementIndex(container!.content.elements)).getState();
    if (sheetMarkdown(sheetDocument(reopened)) !== before) differ.push(race.id);
  }
  assert.deepEqual(differ, [], 'every race-built NPC reads the same with its sources off');
});

test("with a creature as well, the creature's speed is used and the race's increases add to its scores", { skip }, async (t) => {
  const system = await fiveE();
  const elements = await realElements();
  const races = await offeredRaces(system, elements);
  const creatures = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, elements)
    .getState()
    .decisions.find((d) => d.stepId === 'creature')!
    .candidates.map((id) => elements.get(id)!);
  const humanoid = creatures.filter((c) => /humanoid/i.test(c.setters['type']?.value ?? ''));
  t.diagnostic(`${humanoid.length} of ${creatures.length} offered creatures print a humanoid type`);

  // A creature that states a walking speed, and a race whose speed differs from it, so a sum would show.
  const creature = creatures.find((c) => {
    const s = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, elements);
    s.choose('build/creature', [c.id]);
    return stat(s.getState(), 'speed') > 0;
  });
  assert.ok(creature, 'some creature states a speed');
  const alone = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, elements);
  alone.choose('build/creature', [creature.id]);
  const creatureOnly = alone.getState();
  const race = races.find((r) => stat(onRace(system, elements, 'npc', r).getState(), 'speed') > 0)!;
  const raceOnly = onRace(system, elements, 'npc', race).getState();
  const both = onRace(system, elements, 'npc', race, creature).getState();

  for (const name of SPEEDS) assert.equal(stat(both, name), stat(creatureOnly, name), `${name} is the creature's`);
  for (const score of SCORES) {
    assert.equal(stat(both, score) - stat(creatureOnly, score), stat(raceOnly, score) - 10, `${score}: the race's increase adds to the print`);
  }
});
