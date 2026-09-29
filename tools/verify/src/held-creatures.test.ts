/**
 * What a creature a player character holds already derives, read from content and the samples, before deciding how it
 * is shown — the roadmap's "Companions and sidekicks".
 *
 * ADR 0070 measured that a player character already holds a creature wherever content gives one, that no sheet section
 * of its shows it, and that 29 creatures compute their numbers from whoever holds them. It left the design question: how
 * a held creature is shown with numbers derived from its holder. This measures what that stands on.
 *
 * Nothing is named here but the one way in that offers every creature: the player character's own element (found by
 * shape, an element of a type its build steps or sheet sections name) whose creature `select` has no filter. The creature
 * type is read off the NPC's Creature step; the namespace content writes a creature's numbers in is read off the NPC's
 * `startsFrom`s (ADR 0059), not spelled; the features a creature names are read off the NPC's `setterGrants` (ADR 0058).
 *
 * First, what content writes: every stat rule in that namespace, on creatures and on the holder's own elements; every
 * stat in it that content reads and nothing contributes to, which is what Aurora's app supplies; what creatures write
 * outside it; and how content's creature selects exclude one another. Then a player character holding each creature,
 * one at a time, against the NPC built on the same creature (ADR 0057 to 0062). Then one holding two. Then the samples
 * that hold one, against the stat block Aurora recorded for it in the save.
 *
 * All of it is reported as `ℹ` lines and none asserted (ADR 0042: a moving corpus fails only what must hold against any
 * corpus). What is asserted about a held creature since it is shown is in `companions.test.ts`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  deriveCharacter,
  matchesSupports,
  resolveCharacterKind,
  type Character,
  type DerivedCharacter,
  type Element,
  type ElementIndex,
  type GameSystem,
  type ResolvedCharacterKind,
  type SelectRule,
  type StatExpr,
} from '@incudo/core';
import { newCharacterOfKind } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
/** Which ability each skill Aurora records reads, to tell a proficient skill from the bare modifier in its block. */
const SKILL_ABILITY: Record<string, string> = {
  acrobatics: 'dexterity', 'animal handling': 'wisdom', arcana: 'intelligence', athletics: 'strength',
  deception: 'charisma', history: 'intelligence', insight: 'wisdom', intimidation: 'charisma',
  investigation: 'intelligence', medicine: 'wisdom', nature: 'intelligence', perception: 'wisdom',
  performance: 'charisma', persuasion: 'charisma', religion: 'intelligence', 'sleight of hand': 'dexterity',
  stealth: 'dexterity', survival: 'wisdom',
};

function tally(values: string[], limit = 12): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, limit).map(([v, n]) => `${n} ${v}`);
  if (sorted.length > limit) shown.push(`${sorted.length - limit} more`);
  return shown.join(', ') || 'none';
}

function statsReferred(value: StatExpr | undefined, into: string[] = []): string[] {
  if (!value || typeof value !== 'object') return into;
  const node = value as unknown as Record<string, unknown>;
  if (node['kind'] === 'ref' && typeof node['stat'] === 'string') into.push(node['stat']);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) for (const c of child) statsReferred(c as StatExpr, into);
    else if (child && typeof child === 'object') statsReferred(child as StatExpr, into);
  }
  return into;
}

interface Setting {
  system: GameSystem;
  pc: ResolvedCharacterKind;
  npc: ResolvedCharacterKind;
  creatureTypes: Set<string>;
  /** The namespace a creature's numbers are written in, read off the NPC's starts: `companion:`. */
  prefix: string;
  /** The NPC's stats that start from the namespace, and the stat each starts from. */
  starts: Array<{ stat: string; from: string }>;
}

async function setting(): Promise<Setting> {
  const system = await loadShippedSystem('dnd5e');
  const pc = resolveCharacterKind(system, 'pc');
  const npc = resolveCharacterKind(system, 'npc');
  const step = npc.buildSteps.find((s) => (s.required || s.pick) && s.types.length > 0 && !s.budget && !s.multiple);
  assert.ok(step, 'the NPC starts from a creature');
  const starts = npc.stats.flatMap((s) => (s.startsFrom ? [{ stat: s.name, from: s.startsFrom }] : []));
  const prefixes = new Set(starts.map((s) => s.from.slice(0, s.from.indexOf(':') + 1)));
  assert.equal(prefixes.size, 1, 'the NPC reads its creature from one namespace');
  return { system, pc, npc, creatureTypes: new Set(step.types), prefix: [...prefixes][0]!, starts };
}

function ownTypes(kind: ResolvedCharacterKind): Set<string> {
  return new Set([...kind.buildSteps.flatMap((s) => s.types), ...kind.sheet.sections.flatMap((s) => s.types ?? [])]);
}

/** The player character's own element whose creature select offers every creature: equipped, it lets one be chosen. */
function openingEverything(s: Setting, elements: ElementIndex): { element: Element; ruleKey: string } {
  const own = ownTypes(s.pc);
  for (const element of elements.all()) {
    if (!own.has(element.type)) continue;
    for (const rule of element.rules) {
      if (rule.kind === 'select' && s.creatureTypes.has(rule.type) && !rule.supports) {
        return { element, ruleKey: `${element.id}/select:${rule.name}` };
      }
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

function npcOn(s: Setting, elements: ElementIndex, creature: Element): DerivedCharacter {
  const character = { ...newCharacterOfKind(s.system, 'npc'), choices: [{ ruleKey: 'build/creature', elementIds: [creature.id] }] };
  return deriveCharacter(character, s.system, elements, { kind: s.npc });
}

const value = (d: DerivedCharacter, stat: string): number | undefined => d.stats.get(stat.toLowerCase())?.value;

test('what content writes for a creature, in its holder\'s derivation', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const s = await setting();
  const elements = await realElements();
  const all = [...elements.all()];
  const creatures = [...s.creatureTypes].flatMap((type) => elements.byType(type));
  const inNamespace = (name: string) => name.toLowerCase().startsWith(s.prefix);
  t.diagnostic(`the namespace a creature's numbers are written in, read off the NPC's starts: ${s.prefix}`);

  const rules = all.flatMap((e) => e.rules.flatMap((r) => (r.kind === 'stat' ? [{ e, r }] : [])));
  const onCreatures = rules.filter(({ e, r }) => s.creatureTypes.has(e.type) && inNamespace(r.name));
  const onOthers = rules.filter(({ e, r }) => !s.creatureTypes.has(e.type) && inNamespace(r.name));
  t.diagnostic(`stat rules in it on creatures: ${onCreatures.length}, on ${new Set(onCreatures.map((x) => x.e.id)).size} creatures, of ${new Set(onCreatures.map((x) => x.r.name.toLowerCase())).size} stats`);
  t.diagnostic(`stat rules in it on other elements: ${onOthers.length}, on ${new Set(onOthers.map((x) => x.e.id)).size} elements, of ${tally(onOthers.map((x) => x.e.type))}`);
  t.diagnostic(`  writing ${tally(onOthers.map((x) => x.r.name.toLowerCase()), 10)}`);
  const named = new Set(s.npc.setterGrants.map((g) => g.setter));
  const creatureFeatureTypes = new Set(
    creatures.flatMap((c) =>
      Object.entries(c.setters)
        .filter(([name]) => named.has(name))
        .flatMap(([, v]) => v.value.split(',').map((id) => elements.get(id.trim())?.type ?? '')),
    ),
  );
  creatureFeatureTypes.delete('');
  const holderSide = onOthers.filter((x) => !creatureFeatureTypes.has(x.e.type));
  t.diagnostic(`  of them on the holder's own elements (not a creature's named features): ${holderSide.length}, on ${tally(holderSide.map((x) => x.e.name), 8)}`);

  const contributed = new Set(rules.map(({ r }) => r.name.toLowerCase()));
  const read = rules.flatMap(({ r }) => statsReferred(r.value)).map((n) => n.toLowerCase()).filter(inNamespace);
  const unsupplied = read.filter((n) => !contributed.has(n));
  t.diagnostic(`stats in it content reads: ${new Set(read).size}; read and contributed by nothing, so Aurora's app supplies them: ${tally(unsupplied)}`);
  const outside = creatures.flatMap((c) => c.rules.flatMap((r) => (r.kind === 'stat' && !inNamespace(r.name) ? [r.name.toLowerCase()] : [])));
  t.diagnostic(`stats creatures write outside it: ${tally(outside)}`);
  // Which bucket a creature that supplies its own proficiency bonus writes it in, and whether it takes away "the app's"
  // 2: the one number content writes against a value it never states.
  const supplied = creatures.flatMap((c) => {
    const rules = c.rules.filter((r) => r.kind === 'stat' && r.name.toLowerCase() === `${s.prefix}proficiency`);
    if (!rules.length) return [];
    return [rules.map((r) => (r.kind === 'stat' ? `${r.bonus ?? 'unbucketed'} ${JSON.stringify(r.value).includes('"number"') ? 'a number' : 'a stat'}` : '')).join(' + ')];
  });
  t.diagnostic(`creatures supplying their own ${s.prefix}proficiency: ${supplied.length}, as ${tally(supplied)}`);
  t.diagnostic(`rules on creatures by kind: ${tally(creatures.flatMap((c) => c.rules.map((r) => r.kind)))}`);
  const grants = creatures.flatMap((c) => c.rules.flatMap((r) => (r.kind === 'grant' ? [elements.get(r.id)] : [])));
  t.diagnostic(`a creature's own grants: ${grants.length}, of ${tally(grants.map((g) => g?.type ?? '(nothing declared)'))}; those granting further: ${grants.filter((g) => g?.rules.some((r) => r.kind === 'grant')).length}`);
  const features = creatures.flatMap((c) =>
    Object.entries(c.setters).filter(([name]) => named.has(name)).flatMap(([, v]) => v.value.split(',').map((id) => elements.get(id.trim()))),
  );
  const withRules = features.filter((f) => f && f.rules.length);
  t.diagnostic(`features a creature names: ${features.length}, ${features.filter(Boolean).length} declared; carrying rules: ${withRules.length}, writing ${tally(withRules.flatMap((f) => f!.rules.map((r) => (r.kind === 'stat' ? r.name : r.kind))), 8)}`);

  // How content's creature selects keep a character to one: a select whose own requirements rule out an element that
  // opens another creature select.
  const own = ownTypes(s.pc);
  const selects = all
    .filter((e) => own.has(e.type))
    .flatMap((owner) => owner.rules.filter((r): r is SelectRule => r.kind === 'select' && s.creatureTypes.has(r.type)).map((rule) => ({ owner, rule })));
  const openers = new Set(selects.map((x) => x.owner.id));
  const excluding = selects.filter(({ rule }) => {
    const written = JSON.stringify(rule.requirements ?? null);
    return [...openers].some((id) => written.includes(`"${id}"`));
  });
  t.diagnostic(`creature selects in a player character's own content: ${selects.length}, on ${tally(selects.map((x) => x.owner.type))}`);
  t.diagnostic(`  whose own requirements name an element that opens another: ${excluding.length} (${excluding.map((x) => x.owner.name).join('; ')})`);
  t.diagnostic(`  opened by: ${selects.map((x) => `${x.owner.name} (${x.owner.type})`).join('; ')}`);
  const oneOnly = all.filter((e) => openers.has(e.id) && /only have one companion/i.test(e.description ?? ''));
  t.diagnostic(`  whose text says a character has only one companion (a lookup by text): ${oneOnly.length} (${oneOnly.map((e) => e.name).join(', ')})`);
  const sidekicks = all.filter((e) => /sidekick/i.test(e.name));
  t.diagnostic(`elements naming a sidekick (a lookup by name, the roadmap's other half): ${sidekicks.length}, of ${tally(sidekicks.map((e) => e.type))}`);
});

test('a player character holding each creature, against the NPC built on it', { skip: corpusSkip }, async (t) => {
  const s = await setting();
  const elements = await realElements();
  const creatures = [...s.creatureTypes].flatMap((type) => elements.byType(type));
  const way = openingEverything(s, elements);
  t.diagnostic(`held through ${way.element.name} (${way.element.type}), equipped, at level 5 with no class`);

  let held = 0;
  const scoresPublished: string[] = [];
  const agree = new Map<string, number>();
  const differ = new Map<string, string[]>();
  const proficiency: string[] = [];
  for (const creature of creatures) {
    const pc = holding(s, elements, [{ ruleKey: way.ruleKey, elementIds: [creature.id] }]);
    if (!pc.elementIds.has(creature.id)) continue;
    held++;
    if (ABILITIES.every((a) => value(pc, `${s.prefix}${a}`) !== undefined)) scoresPublished.push(creature.name);
    proficiency.push(String(value(pc, `${s.prefix}proficiency`) ?? 'none'));
    const npc = npcOn(s, elements, creature);
    for (const { stat, from } of s.starts) {
      const mine = value(pc, from) ?? 0;
      const theirs = value(npc, stat) ?? 0;
      if (mine === 0 && theirs === 0) continue;
      const family = /:proficiency$/.test(stat) ? 'proficiencies' : stat;
      if (mine === theirs) agree.set(family, (agree.get(family) ?? 0) + 1);
      else differ.set(family, [...(differ.get(family) ?? []), creature.name]);
    }
  }
  t.diagnostic(`creatures held: ${held} of ${creatures.length}`);
  t.diagnostic(`six scores published in the holder's derivation: ${scoresPublished.length} (a creature prints them only as setters)`);
  t.diagnostic(`${s.prefix}proficiency on the holder: ${tally(proficiency)}`);
  for (const family of new Set([...agree.keys(), ...differ.keys()])) {
    const names = differ.get(family) ?? [];
    t.diagnostic(`  ${family}: the holder's ${s.prefix}… agrees with the NPC on ${agree.get(family) ?? 0}, differs on ${names.length}${names.length ? ` (${tally(names, 6)})` : ''}`);
  }

  // The 29: what of the holder they read, and what that reads on a fresh holder and on one with a class.
  const scaling = creatures.filter((c) =>
    c.rules.some((r) => r.kind === 'stat' && statsReferred(r.value).some((n) => !n.toLowerCase().startsWith(s.prefix))),
  );
  const holderStats = [...new Set(scaling.flatMap((c) => c.rules.flatMap((r) => (r.kind === 'stat' ? statsReferred(r.value) : [])).filter((n) => !n.toLowerCase().startsWith(s.prefix))))];
  t.diagnostic(`creatures reading their holder: ${scaling.length}, reading ${tally(holderStats, 20)}`);
  const levels = holderStats.filter((n) => /^level:/i.test(n));
  t.diagnostic(`  of those a class level: ${levels.join(', ')}; a player character publishes one only for a class it has, so each reads 0 on any other`);
});

test('a player character holding two creatures', { skip: corpusSkip }, async (t) => {
  const s = await setting();
  const elements = await realElements();
  const way = openingEverything(s, elements);
  // A second way in: an element a player character may be given (ADR 0064) whose creature select has a filter.
  const spell = [...elements.all()].find(
    (e) => s.pc.additions?.types.includes(e.type) && e.rules.some((r) => r.kind === 'select' && s.creatureTypes.has(r.type) && r.supports),
  );
  assert.ok(spell, 'an element a player character may be given opens a creature select');
  const select = spell.rules.find((r): r is SelectRule => r.kind === 'select' && s.creatureTypes.has(r.type))!;
  const creatures = [...s.creatureTypes].flatMap((type) => elements.byType(type));
  const first = creatures.find((c) =>
    matchesSupports(select.supports, {
      tags: new Set(c.supports.map((tag) => tag.toLowerCase())),
      setterValues: new Set(Object.values(c.setters).map((v) => String(v.value).toLowerCase())),
      id: c.id,
      resolve: () => undefined,
    }),
  );
  const second = creatures.find((c) => c !== first && c.rules.some((r) => r.kind === 'stat' && statsReferred(r.value).some((n) => !n.toLowerCase().startsWith(s.prefix))));
  assert.ok(first && second);
  const both = holding(s, elements, [
    { ruleKey: way.ruleKey, elementIds: [second.id] },
    { ruleKey: `${spell.id}/select:${select.name}`, elementIds: [first.id] },
  ], { formatVersion: 5, additions: [spell.id] });
  const alone = (c: Element) =>
    c === second
      ? holding(s, elements, [{ ruleKey: way.ruleKey, elementIds: [c.id] }])
      : holding(s, elements, [{ ruleKey: `${spell.id}/select:${select.name}`, elementIds: [c.id] }], { formatVersion: 5, additions: [spell.id] });
  t.diagnostic(`${first.name} through ${spell.name}, and ${second.name} through ${way.element.name}: both held ${both.elementIds.has(first.id) && both.elementIds.has(second.id)}`);
  for (const { from } of s.starts.filter((x) => /^(ac|hp|speed)$/.test(x.stat))) {
    t.diagnostic(`  ${from}: ${value(both, from)} held together; ${value(alone(first), from)} and ${value(alone(second), from)} alone`);
  }
  t.diagnostic(`  problems on the holder: ${both.problems.map((p) => p.code).join(', ') || 'none'}`);
});

/** Aurora's `<companion>` block: the name, the six scores, the saves and the skills it recorded. */
function recordedCompanion(xml: string): { name: string; scores: number[]; saves: Record<string, number>; skills: Record<string, number> } | undefined {
  const block = /<companion name="([^"]*)">([\s\S]*?)<\/companion>/.exec(xml);
  if (!block) return undefined;
  const body = block[2]!;
  const scores = ABILITIES.map((a) => Number(new RegExp(`<${a}>(-?\\d+)</${a}>`).exec(body)?.[1]));
  const saves: Record<string, number> = {};
  for (const m of body.matchAll(/<save ability="([^"]+)">(-?\d+)<\/save>/g)) saves[m[1]!] = Number(m[2]);
  const skills: Record<string, number> = {};
  for (const m of body.matchAll(/<skill name="([^"]+)">(-?\d+)<\/skill>/g)) skills[m[1]!.toLowerCase()] = Number(m[2]);
  return { name: block[1]!, scores, saves, skills };
}

test('the samples that hold a creature, against the stat block Aurora recorded', { skip: savesSkip }, async (t) => {
  const s = await setting();
  const elements = await realElements();
  let holding = 0;
  let blocks = 0;
  const lines: string[] = [];
  for (const sample of readManifest().samples) {
    const path = samplePath(sample);
    const recorded = recordedCompanion(await readFile(path, 'utf8'));
    if (recorded) blocks++;
    const run = await runOracle(path, elements, 'sample');
    const creatures = run.derived.elements.filter((e) => s.creatureTypes.has(e.type));
    if (!creatures.length) continue;
    holding++;
    const creature = creatures[0]!;
    const printed = ABILITIES.map((a) => Number(creature.setters[a]?.value));
    // A skill Aurora recorded above its ability's modifier: the creature is proficient in it, at Aurora's bonus.
    const modifier = (ability: string) => Math.floor((printed[ABILITIES.indexOf(ability)]! - 10) / 2);
    const proficient = Object.entries(recorded?.skills ?? {}).filter(([name, v]) => v !== modifier(SKILL_ABILITY[name] ?? 'strength'));
    lines.push(
      `${sample.id}: holds ${creatures.map((c) => `${c.name} (${c.source})`).join(', ')}; Aurora recorded "${recorded?.name}" ` +
        `scores ${recorded?.scores.join('/')} (printed ${printed.join('/')}), ` +
        `skills above the modifier: ${proficient.map(([n, v]) => `${n} ${v}`).join(', ') || 'none'}; ` +
        `the holder's ${s.prefix}proficiency ${value(run.derived, `${s.prefix}proficiency`) ?? 'none'}, ` +
        `${s.prefix}perception:proficiency ${value(run.derived, `${s.prefix}perception:proficiency`) ?? 'none'}`,
    );
  }
  t.diagnostic(`samples with a companion block in the save: ${blocks}; holding a creature: ${holding}`);
  for (const line of lines) t.diagnostic(line);
});
