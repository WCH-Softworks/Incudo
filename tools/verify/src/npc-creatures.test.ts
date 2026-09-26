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
  collectDeclaredBlocks,
  customFeatureStats,
  deriveCharacter,
  readCharacterContainer,
  readSetterNumber,
  renderSheetSection,
  resolveCharacterKind,
  sheetSectionIsEmpty,
  validateGameSystem,
  type DerivedCharacter,
  type Element,
  type ElementIndex,
  type GameSystem,
  type ResolvedCharacterKind,
  type SheetSectionRendering,
  type StatDef,
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
    if (printsAll && state.decisions.some((d) => d.stepId === 'abilities')) stillOpen.push(creature.id);
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
  const budget = b.getState().decisions.find((d) => d.stepId === 'abilities');
  assert.ok(budget, 'the Ability Scores decision is open');
  assert.equal(budget.blocking, true);
  assert.equal(budget.remaining, 6);
  for (const [n, score] of SCORES.entries()) b.setBudgetStat('abilities', score, 10 + n);
  assert.equal(b.getState().decisions.some((d) => d.stepId === 'abilities'), false);
  assert.equal(b.getState().derived.stats.get('charisma')?.value, 15);
});

const COMBAT = ['ac', 'hp', 'speed'];
/** The creature's own rule each of the three starts from, read off the kind rather than spelled here. */
function startsFrom(system: GameSystem): Map<string, string> {
  const npc = system.characterKinds.find((k) => k.id === 'npc')!;
  return new Map(COMBAT.map((stat) => [stat, npc.stats!.find((s) => s.name === stat)!.startsFrom!]));
}

test("every creature's armour class, hit points and speed start where its rules put them, and ask for nothing", { skip }, async (t) => {
  // ADR 0059. Fails if the kind's `startsFrom` is removed (every creature reads 0 and the step opens), or
  // the engine stops publishing `starts` (the step's rows count nothing as stated and it opens).
  const system = await fiveE();
  const elements = await realElements();
  const creatures = creatureStep(system).types.flatMap((type) => elements.byType(type));
  const from = startsFrom(system);
  const wrong: string[] = [];
  const stillOpen: string[] = [];
  let stated = 0;
  for (const creature of creatures) {
    const state = npcOn(system, elements, creature).getState();
    let all = true;
    for (const stat of COMBAT) {
      const rule = state.derived.stats.get(from.get(stat)!);
      if (!rule || rule.contributions.length === 0) {
        all = false;
        continue;
      }
      const actual = state.derived.stats.get(stat)?.value;
      if (actual !== rule.value) wrong.push(`${creature.id} ${stat}: its rule says ${rule.value}, derives ${actual}`);
    }
    if (all) stated++;
    if (all && state.decisions.some((d) => d.stepId === 'combat')) stillOpen.push(creature.id);
  }
  t.diagnostic(`${creatures.length} creatures; ${stated} state all three by their own rules`);
  assert.ok(stated > 0, 'the corpus has creatures that state them');
  assert.deepEqual(wrong, [], 'each of the three is what the creature states');
  assert.deepEqual(stillOpen, [], 'a creature that states all three leaves nothing to enter');
});

test('an NPC from nothing enters armour class, hit points and speed, and a creature picked later does not add to them', { skip }, async () => {
  // Fails if a typed value is added to the creature's (reads 697 + the creature's hit points), if the step
  // is capped at an ability score's 30 (a Tarrasque's 697 would be refused), or if clearing does not go back.
  const system = await fiveE();
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, elements);
  const open = b.getState().decisions.find((d) => d.stepId === 'combat');
  assert.ok(open, 'the step is open for an NPC with no creature');
  assert.equal(open.blocking, true);
  assert.equal(open.remaining, 3);
  for (const stat of COMBAT) assert.equal(b.getState().derived.stats.get(stat)?.value, 0, `${stat} with no creature`);

  b.setBudgetStat('combat', 'ac', 25);
  b.setBudgetStat('combat', 'hp', 697);
  b.setBudgetStat('combat', 'speed', 40);
  assert.equal(b.getState().decisions.some((d) => d.stepId === 'combat'), false, 'entered, the step closes');
  assert.equal(b.getState().derived.stats.get('hp')?.value, 697);

  const creatures = creatureStep(system).types.flatMap((type) => elements.byType(type));
  const offered = new Set(b.getState().decisions.find((d) => d.stepId === 'creature')!.candidates);
  // One whose hit points are a plain positive number, so a sum would show: a class summon's rule reads a
  // summoner's level an NPC does not have, and states 0.
  const creature = creatures.find((c) => offered.has(c.id) && (readSetterNumber(c.setters['hp']?.value) ?? 0) > 0)!;
  b.choose('build/creature', [creature.id]);
  const stated = b.getState().derived.stats.get(startsFrom(system).get('hp')!)!.value;
  assert.equal(b.getState().derived.stats.get('hp')?.value, 697, "the typed value replaces the creature's");
  b.setBudgetStat('combat', 'hp', undefined);
  assert.equal(b.getState().derived.stats.get('hp')?.value, stated, "clearing it goes back to the creature's");
  const row = b.getState().steps.find((s) => s.id === 'combat')!.budget!.rows.find((r) => r.stat === 'hp')!;
  assert.equal(row.printed, stated);

  const character = b.getState().character;
  const packed = packCharacter(character, system, elements, { generator: 'test' });
  const { container } = readCharacterContainer(packed.files);
  const reopened = deriveCharacter(container!.character, system, new BundleElementIndex(container!.content.elements));
  for (const stat of COMBAT) {
    assert.equal(reopened.stats.get(stat)?.value, b.getState().derived.stats.get(stat)?.value, `${stat} after reopening with no source`);
  }
});

test("every creature's NPC starts at the challenge rating it prints, and a typed one replaces it", { skip }, async (t) => {
  // ADR 0060. Fails if the kind's `setterStats` has no entry for `challenge` (every NPC reads 0 and the two
  // creatures above CR 4 have a proficiency bonus of +2), or if the engine reads `character.progress` alone.
  const system = await fiveE();
  const elements = await realElements();
  const creatures = creatureStep(system).types.flatMap((type) => elements.byType(type));
  const wrong: string[] = [];
  const unnoted: string[] = [];
  let printed = 0;
  let above = 0;
  for (const creature of creatures) {
    const state = npcOn(system, elements, creature).getState();
    assert.equal(state.character.progress, undefined, 'a new NPC records no rating');
    const rating = readSetterNumber(creature.setters['challenge']?.value);
    const challenge = state.derived.stats.get('challenge')?.value;
    const proficiency = state.derived.stats.get('proficiency')?.value;
    if (rating === undefined) {
      if (challenge !== 0) wrong.push(`${creature.id}: prints no rating, reads ${challenge}`);
      const noted = state.derived.problems.some((p) => p.code === 'setter-not-a-number' && p.elementId === creature.id);
      if (creature.setters['challenge'] !== undefined && !noted) unnoted.push(creature.id);
      continue;
    }
    printed++;
    // The Monster Manual's table, as the kind's own derivation states it: +2 to CR 4, one more per four.
    const expected = 2 + Math.max(0, Math.ceil((rating - 4) / 4));
    if (challenge !== rating || proficiency !== expected) {
      wrong.push(`${creature.id}: prints ${rating}, reads ${challenge} with proficiency ${proficiency}`);
    }
    if (expected > 2) above++;
  }
  t.diagnostic(`${printed} of ${creatures.length} print a rating as a number; ${above} of them have a proficiency bonus above +2`);
  assert.deepEqual(wrong, [], 'every printed rating is the rating');
  assert.deepEqual(unnoted, [], 'a rating that is not a number is reported, not read as 0 in silence');

  // A typed rating replaces the print, clearing it goes back, and a save keeps "the creature's" rather than a copy.
  const creature = creatures.find((c) => (readSetterNumber(c.setters['challenge']?.value) ?? 0) > 0)!;
  const rating = readSetterNumber(creature.setters['challenge']!.value)!;
  const b = npcOn(system, elements, creature);
  b.setProgress(rating + 3);
  assert.equal(b.getState().derived.stats.get('challenge')?.value, rating + 3);
  b.setProgress(undefined);
  assert.equal(b.getState().derived.stats.get('challenge')?.value, rating);
  const character = b.getState().character;
  const { container } = readCharacterContainer(packCharacter(character, system, elements, { generator: 'test' }).files);
  assert.equal(container!.character.progress, undefined);
  assert.equal(container!.character.formatVersion, 3);
  const reopened = deriveCharacter(container!.character, system, new BundleElementIndex(container!.content.elements));
  assert.equal(reopened.stats.get('challenge')?.value, rating, 'reopened with no source');
});

test("every creature's named traits, actions and reactions reach its NPC, and its save keeps them", { skip }, async (t) => {
  // ADR 0058. The ids are read here by a split of this test's own, not by the engine's function, so a
  // reader that dropped an id (the three Tasha's attacks that end in ">") would fail this. Fails if the
  // kind's `setterGrants` is removed (nothing named is held) or `collectCharacterContent` stops reading
  // them (the reopened NPC holds none).
  const system = await fiveE();
  const elements = await realElements();
  const creatures = creatureStep(system).types.flatMap((type) => elements.byType(type));
  const missing: string[] = [];
  const lostOnReopen: string[] = [];
  const unresolved = new Set<string>();
  let named = 0;
  for (const creature of creatures) {
    const ids = ['traits', 'actions', 'reactions'].flatMap((setter) =>
      (creature.setters[setter]?.value ?? '').split(',').map((id) => id.trim()).filter((id) => id !== ''),
    );
    const character = npcOn(system, elements, creature).getState().character;
    const derived = deriveCharacter(character, system, elements);
    for (const id of ids) {
      named++;
      if (!elements.get(id)) {
        unresolved.add(id);
        assert.ok(
          derived.problems.some((p) => p.code === 'unresolved-element' && p.elementId === id),
          `${id} is reported unresolved`,
        );
        continue;
      }
      if (!derived.elementIds.has(id)) missing.push(`${creature.id} -> ${id}`);
    }
    if (!ids.length) continue;
    const packed = packCharacter(character, system, elements, { generator: 'test' });
    const { container } = readCharacterContainer(packed.files);
    const reopened = deriveCharacter(container!.character, system, new BundleElementIndex(container!.content.elements));
    for (const id of ids) if (elements.get(id) && !reopened.elementIds.has(id)) lostOnReopen.push(`${creature.id} -> ${id}`);
  }
  t.diagnostic(`${named} traits, actions and reactions named; ${unresolved.size} name nothing loaded${unresolved.size ? `: ${[...unresolved].join(', ')}` : ''}`);
  assert.deepEqual(missing, [], 'every resolving id a creature names is held by its NPC');
  assert.deepEqual(lostOnReopen, [], 'and by the NPC reopened from its save with no source');
});

test("every creature's named traits, actions and reactions can be removed, and its save leaves them out", { skip }, async (t) => {
  // ADR 0061. Removes everything each creature names, including the twelve its own `<grant>` also gives. Fails
  // if the engine skips only the setter (those twelve stay held), or if `collectCharacterContent` still follows
  // a removed id from its holder (the save embeds what the NPC no longer has).
  const system = await fiveE();
  const elements = await realElements();
  const creatures = creatureStep(system).types.flatMap((type) => elements.byType(type));
  const stillHeld: string[] = [];
  const embedded: string[] = [];
  const reopenedDiffers: string[] = [];
  let removed = 0;
  let alsoGranted = 0;
  for (const creature of creatures) {
    const b = npcOn(system, elements, creature);
    const named = b.getState().holderGrants.filter((g) => g.held).map((g) => g.elementId);
    if (!named.length) continue;
    const granted = new Set(creature.rules.flatMap((r) => (r.kind === 'grant' ? [r.id] : [])));
    for (const id of named) b.removeGranted(id);
    removed += named.length;
    alsoGranted += named.filter((id) => granted.has(id)).length;
    const state = b.getState();
    for (const id of named) if (state.derived.elementIds.has(id)) stillHeld.push(`${creature.id} ${id}`);
    const { container } = readCharacterContainer(packCharacter(state.character, system, elements, { generator: 'test' }).files);
    const saved = new Set(container!.content.elements.map((e) => e.id));
    for (const id of named) if (saved.has(id)) embedded.push(`${creature.id} ${id}`);
    const reopened = deriveCharacter(container!.character, system, new BundleElementIndex(container!.content.elements));
    if ([...reopened.elementIds].sort().join() !== [...state.derived.elementIds].sort().join()) reopenedDiffers.push(creature.id);
  }
  t.diagnostic(`${removed} named elements removed across ${creatures.length} creatures, ${alsoGranted} of them also granted by their creature's own rule`);
  assert.ok(alsoGranted > 0, "the corpus has a creature that also grants what it names, and it was exercised");
  assert.deepEqual(stillHeld, [], 'a removed element is not held');
  assert.deepEqual(embedded, [], 'a removed element is not embedded');
  assert.deepEqual(reopenedDiffers, [], 'the save derives what the builder did');
});

// ADR 0062: a creature's other speeds, saving throws and skills, stated as its own `companion:*` rules, under
// the NPC's own names; its senses, defences and languages as the text it prints.

/** The NPC's stats that start where a creature's rule is, keyed by the rule they start from. */
function startsFromAll(system: GameSystem): Map<string, StatDef> {
  const npc = resolveCharacterKind(system, 'npc');
  return new Map(npc.stats.filter((s) => s.startsFrom !== undefined).map((s) => [s.startsFrom!.toLowerCase(), s]));
}

/** Every rendering of an NPC's sheet, keyed by section id, as the sheet pane draws it. */
function sheetOf(state: { derived: DerivedCharacter; kind: ResolvedCharacterKind }): Map<string, SheetSectionRendering> {
  const { derived, kind } = state;
  const reader = { statValue: (key: string) => derived.stats.get(key.toLowerCase())?.value, elements: derived.elements };
  const blocks = collectDeclaredBlocks(derived.elements);
  return new Map(kind.sheet.sections.flatMap((s) => renderSheetSection(s, blocks, reader)).map((r) => [r.id, r]));
}

/** A section's stats before `showWhen` chose among them: every row it could show. */
function sectionStats(kind: ResolvedCharacterKind, id: string): string[] {
  return kind.sheet.sections.find((s) => s.id === id)!.stats!;
}

test("every creature's other speeds, saving throws and skills are what its own rules state, under the NPC's names", { skip }, async (t) => {
  // The NPC's name for a creature's `companion:<name>` rule is `<name>`, and that is what is held here, from
  // content's side: a rule the kind has no starting stat for is reported, one it has must read the same. Fails if a
  // stat loses its `startsFrom` (the creature's climb speed reads 0), if the kind stops contributing
  // `companion:proficiency` (every skill and save the creature is proficient in reads a bonus of 0), or if a
  // skill's derivation stops reading its proficiency (the rule and the NPC's stat still agree; the bonus does not).
  const system = await fiveE();
  const elements = await realElements();
  const creatures = creatureStep(system).types.flatMap((type) => elements.byType(type));
  const read = startsFromAll(system);
  // Only stats that start somewhere: `initiative` is the system's Dexterity modifier and reads no rule, so a
  // creature's `companion:initiative` is reported with the rest nothing reads.
  const declared = new Map(kind(system).stats.filter((s) => s.startsFrom).map((s) => [s.name.toLowerCase(), s]));
  const own = (rule: string) => declared.get(rule.replace(/^companion:/, ''));
  // What the kind supplies to the creature's rules rather than reads from them: its proficiency bonus.
  const supplied = new Set(kind(system).contributions.map((c) => c.stat.toLowerCase()));
  assert.ok(supplied.size > 0, 'the kind supplies what the creature calls its proficiency bonus');
  const wrong: string[] = [];
  const noBonus: string[] = [];
  const unread = new Map<string, number>();
  const stating = new Map<string, number>();
  for (const creature of creatures) {
    const derived = npcOn(system, elements, creature).getState().derived;
    const proficiency = derived.stats.get('proficiency')!.value;
    // What the creature states: its own rules and those of what it grants (a 2024 Primal Companion's bond
    // adds proficiency to every save and skill), as the derivation collected them.
    const stated = new Set(
      [...derived.stats.values()]
        .filter((s) => s.name.toLowerCase().startsWith('companion:') && s.contributions.length > 0)
        .map((s) => s.name.toLowerCase()),
    );
    for (const name of stated) {
      if (supplied.has(name)) continue;
      const stat = own(name);
      if (!stat) {
        unread.set(name, (unread.get(name) ?? 0) + 1);
        continue;
      }
      stating.set(stat.name, (stating.get(stat.name) ?? 0) + 1);
      const rule = derived.stats.get(name)!;
      const actual = derived.stats.get(stat.name)?.value;
      if (actual !== rule.value) wrong.push(`${creature.id} ${stat.name}: its rule says ${rule.value}, derives ${actual}`);
    }
    for (const [name, stat] of read) {
      if (stated.has(name)) continue;
      const actual = derived.stats.get(stat.name)?.value ?? 0;
      if (actual !== (stat.default ?? 0)) wrong.push(`${creature.id} ${stat.name}: states nothing, derives ${actual}`);
    }
    // What the creature's own rules call its proficiency bonus is its NPC's, from the challenge rating.
    for (const rule of creature.rules) {
      if (rule.kind !== 'stat' || rule.value.kind !== 'ref' || rule.value.stat.toLowerCase() !== 'companion:proficiency') continue;
      const stat = own(rule.name.toLowerCase());
      if (!stat) continue;
      const value = derived.stats.get(stat.name)?.value ?? 0;
      if (value < proficiency) noBonus.push(`${creature.id} ${stat.name}: ${value} with a proficiency bonus of ${proficiency}`);
    }
  }
  const tally = (pattern: RegExp) =>
    [...stating].filter(([name]) => pattern.test(name)).map(([name, n]) => `${name} ${n}`).join(', ');
  t.diagnostic(`other speeds stated: ${tally(/^speed:/)}`);
  t.diagnostic(`saving throw proficiencies stated: ${tally(/:save:proficiency$/)}`);
  t.diagnostic(`skill proficiencies stated: ${tally(/^(?!.*:save:).*:proficiency$/)}`);
  t.diagnostic(`creature rules no NPC stat reads: ${[...unread].map(([name, n]) => `${name} (${n})`).join(', ')}`);
  assert.ok([...stating.keys()].some((name) => name.startsWith('speed:')), 'the corpus has a creature with another speed');
  assert.ok([...stating.keys()].some((name) => name.endsWith(':save:proficiency')), 'and one with a saving throw');
  assert.deepEqual(wrong, [], 'each is what the creature states, and 0 where it states nothing');
  assert.deepEqual(noBonus, [], "a creature's proficiency is at least its NPC's proficiency bonus");
});

test("a creature's printed speeds, saving throws, skills and passive Perception are compared with what its NPC derives", { skip }, async (t) => {
  // Reported, not asserted beyond "mostly": the rules are content's statement and the print is display text,
  // parsed here only to count agreement; the kind never reads it. A kind that stopped reading the rules, or
  // read a skill against the wrong ability, would agree with almost none.
  const system = await fiveE();
  const elements = await realElements();
  const creatures = creatureStep(system).types.flatMap((type) => elements.byType(type));
  const kind = resolveCharacterKind(system, 'npc');
  const byLabel = new Map(kind.stats.filter((s) => s.label).map((s) => [s.label!.toLowerCase(), s.name]));
  const speeds = new Set(sectionStats(kind, 'speeds'));
  const saves = new Map(sectionStats(kind, 'saves').map((stat) => [stat.slice(0, 3), stat]));
  const skills = new Set(sectionStats(kind, 'skills'));
  const tally = new Map<string, { agree: number; differ: string[]; unread: number }>();
  const compare = (family: string, creature: Element, derived: DerivedCharacter, stat: string | undefined, printed: number) => {
    const row = tally.get(family) ?? { agree: 0, differ: [], unread: 0 };
    tally.set(family, row);
    if (stat === undefined) {
      row.unread++;
      return;
    }
    const value = derived.stats.get(stat)?.value ?? 0;
    if (value === printed) row.agree++;
    else row.differ.push(`${creature.id} ${stat} (${printed} printed, ${value} derived)`);
  };
  for (const creature of creatures) {
    const derived = npcOn(system, elements, creature).getState().derived;
    for (const match of (creature.setters['speed']?.value ?? '').matchAll(/(?:^|[,;])\s*([a-z]+)\s+(\d+)\s*ft/gi)) {
      const stat = `speed:${match[1]!.toLowerCase()}`;
      compare('other speeds', creature, derived, speeds.has(stat) ? stat : undefined, Number(match[2]));
    }
    for (const match of (creature.setters['skills']?.value ?? '').matchAll(/([A-Za-z][A-Za-z ]*?)\s*([+-])\s*(\d+)\s*(?=,|;|$)/g)) {
      const stat = byLabel.get(match[1]!.trim().toLowerCase());
      compare('skills', creature, derived, stat && skills.has(stat) ? stat : undefined, Number(match[2]! + match[3]!));
    }
    for (const match of (creature.setters['saves']?.value ?? '').matchAll(/\b([A-Za-z]{3})\s*([+-])\s*(\d+)\s*(?=,|;|$)/g)) {
      compare('saving throws', creature, derived, saves.get(match[1]!.toLowerCase()), Number(match[2]! + match[3]!));
    }
    const passive = /passive perception\s+(\d+)\s*(?=,|;|$)/i.exec(creature.setters['senses']?.value ?? '');
    if (passive) compare('passive Perception', creature, derived, 'perception:passive', Number(passive[1]));
  }
  for (const [family, row] of tally) {
    const detail = row.differ.length ? ` — ${row.differ.join('; ')}` : '';
    t.diagnostic(`${family}: ${row.agree} agree with the print, ${row.differ.length} differ, ${row.unread} printed that no NPC stat reads${detail}`);
  }
  for (const [family, row] of tally) assert.ok(row.agree > row.differ.length, `${family} mostly agrees with the print`);
});

test("an NPC's sheet shows its creature's other speeds, proficient saves and skills, and what it prints", { skip }, async (t) => {
  // Fails if a section loses `showWhen` (a creature with no fly speed lists one of 0, and all eighteen skills),
  // if `{stat}` stops being substituted (every skill is left out), or if `printed` stops reading the creature.
  const system = await fiveE();
  const elements = await realElements();
  const creatures = creatureStep(system).types.flatMap((type) => elements.byType(type));
  const wrong: string[] = [];
  const printedTotals = new Map<string, number>();
  for (const creature of creatures) {
    const state = npcOn(system, elements, creature).getState();
    const { derived, kind } = state;
    const sheet = sheetOf(state);
    const nonZero = (stat: string) => (derived.stats.get(stat)?.value ?? 0) !== 0;
    const expected: Record<string, string[]> = {
      speeds: sectionStats(kind, 'speeds').filter(nonZero),
      saves: sectionStats(kind, 'saves').filter((s) => nonZero(`${s}:proficiency`)),
      skills: sectionStats(kind, 'skills').filter((s) => nonZero(`${s}:proficiency`)),
    };
    for (const [id, stats] of Object.entries(expected)) {
      const shown = sheet.get(id)!.stats;
      if (shown.join() !== stats.join()) wrong.push(`${creature.id} ${id}: shows ${shown.join()}, holds ${stats.join()}`);
    }
    for (const id of ['senses', 'defences']) {
      const declared = kind.sheet.sections.find((s) => s.id === id)!.printed!;
      const lines = declared.flatMap((p) => {
        const setter = Object.entries(creature.setters).find(([name]) => name.toLowerCase() === p.setter.toLowerCase());
        const text = setter?.[1].value.trim();
        return text ? [`${p.label}: ${text}`] : [];
      });
      const shown = sheet.get(id)!.printed.map((line) => `${line.label}: ${line.text}`);
      if (shown.join('\n') !== lines.join('\n')) wrong.push(`${creature.id} ${id}: shows ${shown.join(' | ')}`);
      for (const line of sheet.get(id)!.printed) printedTotals.set(line.label, (printedTotals.get(line.label) ?? 0) + 1);
    }
  }
  t.diagnostic(`printed lines across ${creatures.length} creatures: ${[...printedTotals].map(([label, n]) => `${label} ${n}`).join(', ')}`);
  assert.ok((printedTotals.get(kind(system).sheet.sections.find((s) => s.id === 'senses')!.printed![0]!.label) ?? 0) > 0, 'some creature prints its senses');
  assert.deepEqual(wrong, [], 'each section shows what the NPC holds, and each printed line is the text as written');

  // An NPC from nothing has no other speed, no proficiency and prints nothing: those sections are empty and
  // not drawn, and its passive Perception is still 10 plus its Wisdom modifier.
  const blank = new CharacterBuilder(newCharacterOfKind(system, 'npc'), system, elements).getState();
  const sheet = sheetOf(blank);
  for (const id of ['speeds', 'saves', 'skills', 'defences']) {
    assert.equal(sheetSectionIsEmpty(sheet.get(id)!, blank.derived.elements), true, `${id} is empty for an NPC from nothing`);
  }
  assert.deepEqual(sheet.get('senses')!.stats, ['perception:passive']);
  assert.equal(blank.derived.stats.get('perception:passive')?.value, 10);

  // A legendary creature is an NPC with more steps, and shows the same.
  const creature = creatures.find((c) => sheetOf(npcOn(system, elements, c).getState()).get('skills')!.stats.length > 0)!;
  const legendary = new CharacterBuilder(newCharacterOfKind(system, 'legendary'), system, elements);
  legendary.choose('build/creature', [creature.id]);
  const legendarySheet = sheetOf(legendary.getState());
  const npcSheet = sheetOf(npcOn(system, elements, creature).getState());
  for (const id of ['speeds', 'saves', 'skills', 'senses', 'defences']) {
    assert.deepEqual(legendarySheet.get(id), npcSheet.get(id), `a legendary creature's ${id} are an NPC's`);
  }
});

test("a typed speed or proficiency replaces the creature's, and the NPC reopens with the same sheet and no source", { skip }, async () => {
  // Fails if a typed value adds to the creature's (the speed reads the two summed), or if the save does not
  // embed what the sheet prints (the reopened NPC prints nothing).
  const system = await fiveE();
  const elements = await realElements();
  const creatures = creatureStep(system).types.flatMap((type) => elements.byType(type));
  const npc = kind(system);
  const speeds = sectionStats(npc, 'speeds');
  const skills = sectionStats(npc, 'skills');
  const holds = (derived: DerivedCharacter, stat: string) => (derived.stats.get(stat)?.value ?? 0) > 0;
  // Any creature with another speed and a skill, found by what it derives.
  const creature = creatures.find((c) => {
    const derived = npcOn(system, elements, c).getState().derived;
    return speeds.some((s) => holds(derived, s)) && skills.some((s) => holds(derived, `${s}:proficiency`));
  })!;
  const b = npcOn(system, elements, creature);
  const before = b.getState().derived;
  const speed = speeds.find((s) => holds(before, s))!;
  const skill = skills.find((s) => holds(before, `${s}:proficiency`))!;
  const stated = before.stats.get(speed)!.value;

  b.setBaseStat(speed, stated + 15);
  assert.equal(b.getState().derived.stats.get(speed)?.value, stated + 15, "a typed speed replaces the creature's");
  b.setBaseStat(`${skill}:proficiency`, 0);
  assert.equal(b.getState().derived.stats.get(`${skill}:proficiency`)?.value, 0, 'a typed 0 takes the proficiency away');
  assert.equal(sheetOf(b.getState()).get('skills')!.stats.includes(skill), false, 'and the sheet stops listing it');

  const character = b.getState().character;
  const { container } = readCharacterContainer(packCharacter(character, system, elements, { generator: 'test' }).files);
  const offline = new BundleElementIndex(container!.content.elements);
  const reopened = new CharacterBuilder(container!.character, system, offline).getState();
  const original = b.getState();
  const reopenedSheet = sheetOf(reopened);
  for (const [id, rendering] of sheetOf(original)) {
    assert.deepEqual(reopenedSheet.get(id), rendering, `${id} after reopening with no source`);
    for (const stat of rendering.stats) {
      assert.equal(reopened.derived.stats.get(stat)?.value, original.derived.stats.get(stat)?.value, `${stat} after reopening`);
    }
  }
});

function kind(system: GameSystem): ResolvedCharacterKind {
  return resolveCharacterKind(system, 'npc');
}

test("a feature the DM writes sets or adds to every creature's numbers, a typed value replaces a set, and the save keeps it", { skip }, async (t) => {
  // ADR 0063, over every creature. A feature sets the walking speed and adds to every other speed the creature has.
  // Fails if a set is applied under the creature's own rule (the creature's speed wins), if an add is not the
  // feature's rule (the other speeds do not move), if a typed value is added to the set or replaces it silently, or
  // if the feature is not in the save (the reopened NPC reads the creature's speed).
  const system = await fiveE();
  const elements = await realElements();
  const creatures = creatureStep(system).types.flatMap((type) => elements.byType(type));
  const npc = kind(system);
  assert.ok(npc.customFeatures, 'the 5e NPC may carry features its DM writes');
  // Not the ability scores, for any kind: they are the character's own inputs, with an editor of their own. Read off
  // the kind's Ability Scores step rather than spelled here. Fails if the kind's `sections` stops leaving them out.
  const scores = new Set(npc.buildSteps.find((s) => s.id === 'abilities')!.budget!.targets.map((s) => s.toLowerCase()));
  const offered = customFeatureStats(npc).map((s) => s.stat.toLowerCase());
  assert.deepEqual(offered.filter((s) => scores.has(s)), [], 'no ability score is offered');
  assert.ok(offered.includes('speed'), 'the stat block is');
  const otherSpeeds = sectionStats(npc, 'speeds');
  const wrong: string[] = [];
  let moved = 0;
  for (const creature of creatures) {
    const b = npcOn(system, elements, creature);
    const before = b.getState().derived;
    const others = otherSpeeds.filter((s) => (before.stats.get(s)?.value ?? 0) > 0);
    const id = b.addCustomFeature('Godspeed')!;
    b.updateCustomFeature(id, {
      stats: [{ stat: 'speed', mode: 'set', value: 60 }, ...others.map((stat) => ({ stat, mode: 'add' as const, value: 10 }))],
    });
    let state = b.getState();
    if (state.derived.stats.get('speed')?.value !== 60) wrong.push(`${creature.id} speed: ${state.derived.stats.get('speed')?.value}`);
    for (const stat of others) {
      const expected = before.stats.get(stat)!.value + 10;
      if (state.derived.stats.get(stat)?.value !== expected) wrong.push(`${creature.id} ${stat}: ${state.derived.stats.get(stat)?.value}`);
      moved++;
    }
    if (!state.derived.elements.some((e) => e.name === 'Godspeed' && e.type === npc.customFeatures!.type)) {
      wrong.push(`${creature.id}: the feature is not held`);
    }
    if (state.derived.problems.some((p) => p.code.startsWith('custom-feature'))) wrong.push(`${creature.id}: a problem with no cause`);

    const { container } = readCharacterContainer(packCharacter(state.character, system, elements, { generator: 'test' }).files);
    const reopened = deriveCharacter(container!.character, system, new BundleElementIndex(container!.content.elements));
    for (const stat of ['speed', ...others]) {
      if (reopened.stats.get(stat)?.value !== state.derived.stats.get(stat)?.value) wrong.push(`${creature.id} ${stat} after reopening`);
    }

    b.setBudgetStat('combat', 'speed', 45);
    state = b.getState();
    if (state.derived.stats.get('speed')?.value !== 45) wrong.push(`${creature.id} typed speed: ${state.derived.stats.get('speed')?.value}`);
    if (!state.derived.problems.some((p) => p.code === 'custom-feature-replaced')) wrong.push(`${creature.id}: replaced in silence`);
    if (state.customFeatures.features[0]!.lines[0]!.status !== 'replaced') wrong.push(`${creature.id}: the line does not say so`);
  }
  t.diagnostic(`${creatures.length} creatures given a written feature; ${moved} other speeds added to`);
  assert.ok(moved > 0, 'the corpus has a creature with another speed, and it was exercised');
  assert.deepEqual(wrong, []);
});
