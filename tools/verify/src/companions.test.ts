/**
 * A creature a player character holds, derived in its own scope and shown as its own stat block — ADR 0073.
 *
 * What is asserted holds against any corpus (ADR 0042), over every creature found by type: held by a player character
 * through the one element that offers every creature, a creature has one scope; its six scores are its print; its armour
 * class, hit points and speeds are what content's own rules make them in the holder's derivation, so the scope loses
 * nothing content says; what it names is held in its scope and never by the holder; and a proficiency it writes against
 * its own bonus is at least 2. Two creatures held together each read what they read alone, while the holder sums as
 * before. A 2014 Battle Smith built through the builder has a Steel Defender whose hit points and proficiency follow the
 * artificer, worked by hand from the stat block. Every sample holding a creature has its scope, and saved and reopened
 * with no source derives the same. What the samples' own stat blocks record in Aurora's save is reported beside it.
 *
 * Perturbations, each run and failing here: the player character's `companions` removed (no scope); its `setterStats`
 * removed (every score reads 10); its `companion:proficiency` contribution removed (the Owl's Perception reads +1, and
 * proficiencies read 0); the scope's `setterGrants` removed (nothing named is held); other creatures not left out of a
 * scope (the pair reads its sum); the collector not following the scope's setter grants (a sample reopened with no
 * source loses its creature's actions).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BundleElementIndex,
  deriveCharacter,
  readCharacterContainer,
  readSetterNumber,
  resolveCharacterKind,
  setterGrantIds,
  validateGameSystem,
  type Character,
  type CompanionDerivation,
  type DerivedCharacter,
  type Element,
  type ElementIndex,
  type GameSystem,
  type ResolvedCharacterKind,
  type SelectRule,
} from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind, packCharacter } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { summarize } from './derived-summary.ts';
import { loadSchemas, loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

interface Setting {
  system: GameSystem;
  pc: ResolvedCharacterKind;
  npc: ResolvedCharacterKind;
  types: Set<string>;
  /** The namespace the scope's stats are in, read off the scope's first stat. */
  prefix: string;
}

async function setting(): Promise<Setting> {
  const system = await loadShippedSystem('dnd5e');
  const pc = resolveCharacterKind(system, 'pc');
  assert.ok(pc.companions, 'a player character declares the creatures it holds');
  const first = pc.companions.stats![0]!.name;
  return { system, pc, npc: resolveCharacterKind(system, 'npc'), types: new Set(pc.companions.types), prefix: first.slice(0, first.indexOf(':') + 1) };
}

/** The player character's own element whose creature select has no filter: equipped, it lets any creature be chosen. */
function openingEverything(s: Setting, elements: ElementIndex): { element: Element; ruleKey: string } {
  const own = new Set([...s.pc.buildSteps.flatMap((x) => x.types), ...s.pc.sheet.sections.flatMap((x) => x.types ?? [])]);
  for (const element of elements.all()) {
    if (!own.has(element.type)) continue;
    for (const rule of element.rules) {
      if (rule.kind === 'select' && s.types.has(rule.type) && !rule.supports) return { element, ruleKey: `${element.id}/select:${rule.name}` };
    }
  }
  assert.fail('content offers every creature to a player character through one element');
}

function holding(s: Setting, elements: ElementIndex, choices: Character['choices'], extra: Partial<Character> = {}): DerivedCharacter {
  const way = openingEverything(s, elements);
  const character: Character = {
    ...newCharacterOfKind(s.system, 'pc'),
    progress: 5,
    inventory: [{ instanceId: 'holding', elementId: way.element.id, equipped: true }],
    choices,
    ...extra,
  };
  return deriveCharacter(character, s.system, elements, { kind: s.pc });
}

const read = (stats: Map<string, { value: number }>, stat: string): number | undefined => stats.get(stat.toLowerCase())?.value;

/** The scope's stats in the namespace, and its held elements' ids, for comparing two scopes. */
function scopeFacts(scope: CompanionDerivation, prefix: string) {
  return {
    stats: [...scope.stats].filter(([key]) => key.startsWith(prefix)).map(([key, stat]) => [key, stat.value]).sort(),
    named: scope.elements.map((e) => e.id).filter((id) => id !== scope.elementId).sort(),
  };
}

test('the player character\'s declaration validates, and a wrong one is refused', async () => {
  // Fails if either of the validator's companion checks is removed.
  const schemas = await loadSchemas();
  const system = await loadShippedSystem('dnd5e');
  assert.deepEqual(validateGameSystem(system, schemas).errors, []);
  const pc = system.characterKinds.find((k) => k.id === 'pc')!;
  const broken: GameSystem = {
    ...system,
    characterKinds: system.characterKinds.map((k) =>
      k === pc ? { ...k, companions: { ...k.companions!, types: ['Companion', 'Ghost'], setterGrants: [{ types: ['Spell'], setter: 'traits' }] } } : k,
    ),
  };
  const messages = validateGameSystem(broken, schemas).errors.map((e) => `${e.path}: ${e.message}`);
  assert.ok(messages.some((m) => m.includes('companions.types') && m.includes('Ghost')), messages.join('\n'));
  assert.ok(messages.some((m) => m.includes('companions.setterGrants') && m.includes('Spell')), messages.join('\n'));
});

test('every creature a player character holds has a scope with its print, its rules and its features', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const s = await setting();
  const elements = await realElements();
  const way = openingEverything(s, elements);
  const creatures = [...s.types].flatMap((type) => elements.byType(type));
  assert.ok(creatures.length > 0);
  const namespaced = [...new Set(creatures.flatMap((c) => c.rules.flatMap((r) => (r.kind === 'stat' && r.name.toLowerCase().startsWith(s.prefix) ? [r.name.toLowerCase()] : []))))];
  const numbers = namespaced.filter((n) => !n.endsWith(':proficiency'));
  // A creature whose own rules read a stat only the scope declares (its Constitution modifier) is right in its scope and
  // not in its holder, which reads 0 there: those are reported, not held to the holder.
  const declared = new Set((s.pc.companions!.stats ?? []).map((d) => d.name.toLowerCase()));
  const readsScope = (c: Element) => c.rules.some((r) => r.kind === 'stat' && JSON.stringify(r.value).toLowerCase().match(/"stat":"([^"]+)"/g)?.some((m) => declared.has(m.slice(8, -1))));
  const improved: string[] = [];
  let proficiencies = 0;
  for (const creature of creatures) {
    const derived = holding(s, elements, [{ ruleKey: way.ruleKey, elementIds: [creature.id] }]);
    if (!derived.elementIds.has(creature.id)) continue;
    assert.deepEqual(derived.companions.map((c) => c.elementId), [creature.id], `${creature.id}: one scope`);
    const scope = derived.companions[0]!;
    for (const ability of ABILITIES) {
      const printed = readSetterNumber(creature.setters[ability]?.value);
      if (printed !== undefined) assert.equal(read(scope.stats, `${s.prefix}${ability}`), printed, `${creature.id}: ${ability} is its print`);
    }
    // What content's rules make the creature's numbers in its holder, the scope keeps.
    for (const stat of numbers) {
      if (readsScope(creature)) {
        if (read(scope.stats, stat) !== read(derived.stats, stat)) improved.push(`${creature.name} ${stat} ${read(scope.stats, stat)} (holder ${read(derived.stats, stat)})`);
        continue;
      }
      assert.equal(read(scope.stats, stat), read(derived.stats, stat), `${creature.id}: ${stat} as content's rules make it`);
    }
    // What it names is its own: held in the scope, never by the holder (a creature's own <grant> is content's, and may
    // be). What a creature names is read off the NPC's declaration, not the one this tests.
    const own = new Set(creature.rules.flatMap((r) => (r.kind === 'grant' ? [r.id] : [])));
    for (const id of setterGrantIds(s.npc.setterGrants, creature)) {
      if (!elements.get(id)) continue;
      const withdrawn = scope.withdrawn.some((w) => w.elementId === id);
      assert.ok(withdrawn || scope.elements.some((e) => e.id === id), `${creature.id}: ${id} is held in its scope, or withdrawn there`);
      if (!own.has(id)) assert.equal(derived.elementIds.has(id), false, `${creature.id}: ${id} is not the holder's`);
    }
    // A proficiency written against the creature's own bonus is at least that bonus.
    for (const rule of creature.rules) {
      if (rule.kind !== 'stat' || !/:proficiency$/i.test(rule.name) || rule.value.kind !== 'ref') continue;
      if (rule.value.stat.toLowerCase() !== `${s.prefix}proficiency`) continue;
      proficiencies++;
      assert.ok((read(scope.stats, rule.name) ?? 0) >= 2, `${creature.id}: ${rule.name} is at least 2`);
    }
  }
  t.diagnostic(`reading a stat only the scope declares, and so different from the holder: ${improved.join('; ') || 'none'}`);
  t.diagnostic(`${creatures.length} creatures, each with a scope; ${numbers.length} of their stats kept as content makes them; ${proficiencies} proficiencies at least 2`);
});

test('two creatures held together each read what they read alone, and the holder sums as before', { skip: corpusSkip }, async (t) => {
  const s = await setting();
  const elements = await realElements();
  const way = openingEverything(s, elements);
  const opener = [...elements.all()].find(
    (e) => s.pc.additions?.types.includes(e.type) && e.rules.some((r) => r.kind === 'select' && s.types.has(r.type) && r.supports),
  );
  assert.ok(opener, 'an element a player character may be given opens a creature select');
  const select = opener.rules.find((r): r is SelectRule => r.kind === 'select' && s.types.has(r.type))!;
  const given = { formatVersion: 5, additions: [opener.id] };
  const openerKey = `${opener.id}/select:${select.name}`;
  // Its first candidate, as the builder offers it.
  const offered = new CharacterBuilder({ ...newCharacterOfKind(s.system, 'pc'), ...given }, s.system, elements)
    .getState()
    .decisions.find((d) => d.id === openerKey);
  const first = offered?.candidates[0];
  const second = [...s.types].flatMap((type) => elements.byType(type)).find((c) => c.id !== first && c.rules.some((r) => r.kind === 'stat' && r.name.toLowerCase() === `${s.prefix}ac`));
  assert.ok(first && second, 'two creatures to hold');

  const both = holding(s, elements, [{ ruleKey: way.ruleKey, elementIds: [second.id] }, { ruleKey: openerKey, elementIds: [first] }], given);
  const aloneFirst = holding(s, elements, [{ ruleKey: openerKey, elementIds: [first] }], given);
  // The same holder in all three, so only which creatures are held differs.
  const aloneSecond = holding(s, elements, [{ ruleKey: way.ruleKey, elementIds: [second.id] }], given);
  assert.deepEqual(both.companions.map((c) => c.elementId).sort(), [first, second.id].sort());
  const scope = (d: DerivedCharacter, id: string) => d.companions.find((c) => c.elementId === id)!;
  assert.deepEqual(scopeFacts(scope(both, first), s.prefix), scopeFacts(scope(aloneFirst, first), s.prefix), 'the first as alone');
  assert.deepEqual(scopeFacts(scope(both, second.id), s.prefix), scopeFacts(scope(aloneSecond, second.id), s.prefix), 'the second as alone');
  const ac = `${s.prefix}ac`;
  assert.equal(read(both.stats, ac), (read(aloneFirst.stats, ac) ?? 0) + (read(aloneSecond.stats, ac) ?? 0), 'the holder sums, as before');
  t.diagnostic(`${elements.get(first)?.name} and ${second.name}: armour class ${read(scope(both, first).stats, ac)} and ${read(scope(both, second.id).stats, ac)}, where the holder reads ${read(both.stats, ac)}`);
});

test('a Battle Smith\'s Steel Defender follows its artificer', { skip: corpusSkip }, async (t) => {
  // Built by name: the 2014 Human, Tasha's Artificer and its Battle Smith. The stat block prints the defender's hit
  // points as "2 + your Intelligence modifier + five times your artificer level" and its bonus as the artificer's.
  const s = await setting();
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(s.system, 'pc'), s.system, elements);
  const pick = (stepId: string, test: (e: Element) => boolean) => {
    const decision = b.getState().decisions.find((d) => d.stepId === stepId && d.kind === 'pick');
    const id = decision?.candidates.find((c) => test(elements.get(c)!));
    assert.ok(decision && id, `the ${stepId} step offers what is asked for`);
    b.choose(decision.id, [id]);
  };
  pick('race', (e) => e.name === 'Human' && e.source === 'Player’s Handbook');
  pick('class', (e) => e.name === 'Artificer' && e.source === 'Tasha’s Cauldron of Everything');
  b.setProgress(5);
  const subclass = b.getState().decisions.find((d) => d.candidates.some((c) => elements.get(c)?.name === 'Battle Smith'));
  assert.ok(subclass, 'a subclass is offered');
  b.choose(subclass.id, [subclass.candidates.find((c) => elements.get(c)?.name === 'Battle Smith')!]);
  const defenderSelect = b.getState().decisions.find((d) => d.candidates.some((c) => s.types.has(elements.get(c)?.type ?? '')));
  if (defenderSelect) b.choose(defenderSelect.id, [defenderSelect.candidates[0]!]);
  const derived = b.getState().derived;
  assert.equal(derived.companions.length, 1, 'the artificer holds one creature');
  const scope = derived.companions[0]!;
  const intelligence = read(derived.stats, 'intelligence:modifier') ?? 0;
  const level = read(derived.stats, 'level:artificer') ?? 0;
  assert.equal(level, 5);
  assert.equal(read(scope.stats, `${s.prefix}hp:max`), 2 + intelligence + 5 * level, 'hit points follow the artificer');
  assert.equal(read(scope.stats, `${s.prefix}proficiency`), read(derived.stats, 'proficiency'), 'its bonus is the artificer\'s');
  t.diagnostic(`${elements.get(scope.elementId)?.name} at artificer ${level}: hit points ${read(scope.stats, `${s.prefix}hp:max`)}, armour class ${read(scope.stats, `${s.prefix}ac`)}, proficiency +${read(scope.stats, `${s.prefix}proficiency`)}`);
});

/** Aurora's `<companion>` block: the six scores, saves and skills it recorded. */
function recordedCompanion(xml: string) {
  const block = /<companion name="([^"]*)">([\s\S]*?)<\/companion>/.exec(xml);
  if (!block) return undefined;
  const body = block[2]!;
  const saves: Record<string, number> = {};
  for (const m of body.matchAll(/<save ability="([^"]+)">(-?\d+)<\/save>/g)) saves[m[1]!.toLowerCase()] = Number(m[2]);
  const skills: Record<string, number> = {};
  for (const m of body.matchAll(/<skill name="([^"]+)">(-?\d+)<\/skill>/g)) skills[m[1]!.toLowerCase()] = Number(m[2]);
  return { scores: ABILITIES.map((a) => Number(new RegExp(`<${a}>(-?\\d+)</${a}>`).exec(body)?.[1])), saves, skills };
}

test('every sample holding a creature shows it, the same with no source, beside what Aurora recorded', { skip: savesSkip }, async (t) => {
  const s = await setting();
  const elements = await realElements();
  let holding = 0;
  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const creatures = run.derived.elements.filter((e) => s.types.has(e.type));
    const derived = deriveCharacter(run.imported.character, run.system, run.elements, { kind: s.pc });
    assert.deepEqual(derived.companions.map((c) => c.elementId), creatures.map((c) => c.id), `${sample.id}: a scope per creature`);
    if (!creatures.length) continue;
    holding++;
    const scope = derived.companions[0]!;
    const creature = creatures[0]!;
    for (const ability of ABILITIES) {
      assert.equal(read(scope.stats, `${s.prefix}${ability}`), readSetterNumber(creature.setters[ability]?.value), `${sample.id}: ${ability}`);
    }
    const packed = packCharacter(run.imported.character, run.system, run.elements, { generator: 'test', extraIds: run.imported.extraIds });
    const { container } = readCharacterContainer(packed.files);
    const reopened = deriveCharacter(container!.character, run.system, new BundleElementIndex(container!.content.elements), { kind: s.pc });
    assert.deepEqual(summarize(reopened).companions, summarize(derived).companions, `${sample.id}: the same with no source`);

    const recorded = recordedCompanion(await readFile(samplePath(sample), 'utf8'));
    const differ = (group: Record<string, number>, stat: (name: string) => string) =>
      Object.entries(group).filter(([name, v]) => read(scope.stats, stat(name)) !== v).map(([name, v]) => `${name} ${read(scope.stats, stat(name))} (Aurora ${v})`);
    const scores = recorded?.scores.join('/') === ABILITIES.map((a) => read(scope.stats, `${s.prefix}${a}`)).join('/');
    const saves = differ(recorded?.saves ?? {}, (n) => `${s.prefix}${n}:save`);
    const skills = differ(recorded?.skills ?? {}, (n) => `${s.prefix}${n}`);
    t.diagnostic(
      `${sample.id}, ${creature.name} (${creature.source}): against Aurora's block, scores ${scores ? 'agree' : 'differ'}, ` +
        `saves ${saves.length ? `differ on ${saves.join(', ')}` : 'agree'}, skills ${skills.length ? `differ on ${skills.join(', ')}` : 'agree'}`,
    );
  }
  t.diagnostic(`samples holding a creature: ${holding}`);
});
