/**
 * What a player character might keep beside it for reference, read from content alone, before deciding whether it may.
 *
 * ADR 0068 let an NPC keep elements beside it, shown and saved and never held, and left the player character keeping
 * none: "a druid's beast or a summoned spirit is a plausible use and undecided". This measures what that use stands on.
 *
 * A player character's own content is read off the kind, not named: the elements of every type its build steps and its
 * sheet sections name. From them, what their descriptions embed with `<div element="…">` (core's `descriptionEmbeds`,
 * nested as `expandDescription` nests them), of what types, and how many of the embedded elements are of a type the NPC
 * keeps as a reference; and which of those print a stat block, in ADR 0068's shape (the six abilities as bold table
 * cells) and in a looser one (the six abilities as table cells, bold or not), which also finds the 2020 summons.
 *
 * Then the structured creatures: the `<select>`s of a creature type in a player character's own content (the type is
 * read off the NPC's Creature step), how many creatures they can offer (tags, ids and setter values, with no `$(…)`),
 * whether a creature carries a text to show, what its stat block is made of, and how many read a number of the
 * character that holds them (a rule referring to a stat outside its own `companion:` namespace, read off the rules).
 *
 * Then the thirty samples: how many hold a creature, whether any sheet section of theirs lists one, and what their held
 * elements' texts print of a type the NPC keeps.
 *
 * Everything is reported as `ℹ` lines and nothing is asserted (ADR 0042: a moving corpus fails only what must hold
 * against any corpus). The one lookup by name is Wild Shape's, reported as such: content ties no creature to it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  descriptionEmbeds,
  matchesSupports,
  resolveCharacterKind,
  type Element,
  type ElementIndex,
  type ResolvedCharacterKind,
  type SelectRule,
  type StatExpr,
} from '@incudo/core';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

/** ADR 0068's shape: the six abilities as bold table cells. */
function isBoldStatBlock(element: Element): boolean {
  const text = element.description ?? '';
  return /<table/i.test(text) && ABILITIES.every((cell) => new RegExp(`<(b|strong)>${cell}</(b|strong)>`).test(text));
}

/** A looser one: the six abilities as table cells, bold or not. */
function isStatBlock(element: Element): boolean {
  const text = element.description ?? '';
  return /<table/i.test(text) && ABILITIES.every((cell) => new RegExp(`<t[dh][^>]*>\\s*(<(b|strong)>)?${cell}(</(b|strong)>)?\\s*</t[dh]>`).test(text));
}

function tally(values: string[], limit = 12): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, limit).map(([v, n]) => `${n} ${v}`);
  if (sorted.length > limit) shown.push(`${sorted.length - limit} more`);
  return shown.join(', ') || 'none';
}

/** The types a character of this kind holds as its own: what its build steps and sheet sections name. */
function ownTypes(kind: ResolvedCharacterKind): Set<string> {
  return new Set([...kind.buildSteps.flatMap((s) => s.types), ...kind.sheet.sections.flatMap((s) => s.types ?? [])]);
}

/** Every element an element's text reaches by embedding, nested, each once, with no limit but a circle. */
function reachedByText(element: Element, elements: ElementIndex): Element[] {
  const seen = new Set([element.id]);
  const out: Element[] = [];
  const walk = (from: Element) => {
    for (const { id } of descriptionEmbeds(from.description)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const target = elements.get(id);
      if (!target) continue;
      out.push(target);
      walk(target);
    }
  };
  walk(element);
  return out;
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

async function kinds() {
  const system = await loadShippedSystem('dnd5e');
  const pc = resolveCharacterKind(system, 'pc');
  const npc = resolveCharacterKind(system, 'npc');
  const creatureStep = npc.buildSteps.find((s) => (s.required || s.pick) && s.types.length > 0 && !s.budget && !s.multiple);
  assert.ok(creatureStep, 'the NPC starts from a creature');
  return { pc, npc, creatureTypes: new Set(creatureStep.types), kept: new Set(npc.references?.types ?? []) };
}

test('what a player character\'s own content prints of what an NPC keeps for reference', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const { pc, kept } = await kinds();
  const own = ownTypes(pc);
  const all = [...elements.all()];
  const embedders = all.filter((e) => own.has(e.type));
  t.diagnostic(`a player character's own types (its build steps' and sheet sections'): ${[...own].join(', ')}`);

  const direct = embedders.flatMap((from) =>
    descriptionEmbeds(from.description).map(({ id }) => ({ from, to: elements.get(id) })),
  );
  t.diagnostic(`embeds in their descriptions: ${direct.length}, of ${tally(direct.map((d) => d.to?.type ?? '(nothing declared)'))}`);

  const keptTypes = [...kept].join(', ');
  const toKept = direct.filter((d) => d.to && kept.has(d.to.type));
  t.diagnostic(`of a type an NPC keeps (${keptTypes}): ${toKept.length} embeds of ${new Set(toKept.map((d) => d.to!.id)).size} elements, from ${tally(toKept.map((d) => d.from.type))}`);
  t.diagnostic(
    `  printing a stat block: ${toKept.filter((d) => isBoldStatBlock(d.to!)).length} in ADR 0068's bold shape, ` +
      `${toKept.filter((d) => isStatBlock(d.to!)).length} with plain cells counted too, ` +
      `of ${new Set(toKept.filter((d) => isStatBlock(d.to!)).map((d) => d.to!.id)).size} elements`,
  );
  const reached = new Map<string, Element>();
  for (const from of embedders) for (const to of reachedByText(from, elements)) if (kept.has(to.type)) reached.set(to.id, to);
  const keptAll = [...kept].flatMap((type) => elements.byType(type));
  t.diagnostic(`  reached by the text of a player character's own element, nested: ${reached.size} of the ${keptAll.length} elements of those types`);
  t.diagnostic(
    `  of all ${keptAll.length}, printing a stat block: ${keptAll.filter(isBoldStatBlock).length} in the bold shape, ` +
      `${keptAll.filter(isStatBlock).length} with plain cells counted too`,
  );
  t.diagnostic(`  stat blocks printed by: ${tally(toKept.filter((d) => isStatBlock(d.to!)).map((d) => `${d.from.type} (${d.from.source})`))}`);
  t.diagnostic(
    `  of them not a stat block: ${tally(toKept.filter((d) => !isStatBlock(d.to!)).map((d) => d.to!.name), 8)}`,
  );

  const wildShape = all.filter((e) => /^(level \d+: )?wild shape$/i.test(e.name) && own.has(e.type));
  t.diagnostic(
    `named Wild Shape (a lookup by name; nothing else ties a creature to it): ${wildShape.length}, ` +
      `embedding ${wildShape.reduce((n, e) => n + descriptionEmbeds(e.description).length, 0)}, ` +
      `with ${wildShape.reduce((n, e) => n + e.rules.filter((r) => r.kind === 'select').length, 0)} selects`,
  );
});

test('the creatures a player character\'s own content offers, and what one would show as a reference', { skip: corpusSkip }, async (t) => {
  const elements = await realElements();
  const { pc, creatureTypes } = await kinds();
  const own = ownTypes(pc);
  const all = [...elements.all()];
  const creatures = [...creatureTypes].flatMap((type) => elements.byType(type));
  t.diagnostic(`creatures an NPC starts from (${[...creatureTypes].join(', ')}): ${creatures.length}`);

  const selects = all
    .filter((e) => own.has(e.type))
    .flatMap((owner) =>
      owner.rules
        .filter((r): r is SelectRule => r.kind === 'select' && creatureTypes.has(r.type))
        .map((rule) => ({ owner, rule })),
    );
  const offered = new Set<string>();
  for (const { rule } of selects) {
    for (const creature of creatures.filter((c) => c.type === rule.type)) {
      const ctx = {
        tags: new Set(creature.supports.map((s) => s.toLowerCase())),
        setterValues: new Set(Object.values(creature.setters).map((s) => String(s.value).toLowerCase())),
        id: creature.id,
        resolve: () => undefined,
      };
      if (matchesSupports(rule.supports, ctx)) offered.add(creature.id);
    }
  }
  t.diagnostic(`selects of a creature in a player character's own content: ${selects.length}, on ${tally(selects.map((s) => s.owner.type))}`);
  t.diagnostic(`creatures they can offer: ${offered.size} of ${creatures.length}`);
  const granted = all.filter((e) => own.has(e.type)).flatMap((e) => e.rules.filter((r) => r.kind === 'grant' && creatureTypes.has(r.type)));
  t.diagnostic(`creatures a player character's own content grants: ${granted.length}`);

  const described = creatures.filter((c) => (c.description ?? '').trim());
  t.diagnostic(
    `creatures with a description: ${described.length} of ${creatures.length}; printing a stat block in it: ${creatures.filter(isStatBlock).length}`,
  );
  t.diagnostic(`what a creature's stat block is made of, its setters: ${tally(creatures.flatMap((c) => Object.keys(c.setters)), 20)}`);
  const namedIds = creatures.flatMap((c) =>
    ['traits', 'actions', 'reactions'].flatMap((name) => String(c.setters[name]?.value ?? '').split(',').map((id) => id.trim()).filter(Boolean)),
  );
  const named = namedIds.map((id) => elements.get(id));
  t.diagnostic(
    `ids named by their traits, actions and reactions setters: ${namedIds.length}, ${named.filter(Boolean).length} declared, ` +
      `${named.filter((e) => (e?.description ?? '').trim()).length} with a text`,
  );
  const scaling = creatures.filter((c) =>
    c.rules.some((r) => r.kind === 'stat' && statsReferred(r.value).some((stat) => !stat.startsWith('companion:'))),
  );
  t.diagnostic(
    `creatures a rule of which reads a stat of whoever holds them (outside companion:): ${scaling.length}, reading ` +
      tally(scaling.flatMap((c) => [...new Set(c.rules.flatMap((r) => (r.kind === 'stat' ? statsReferred(r.value) : [])).filter((s) => !s.startsWith('companion:')))]), 8),
  );
  t.diagnostic(`of those, offered to a player character by its own content: ${scaling.filter((c) => offered.has(c.id)).length}`);
  const beasts = creatures.filter((c) => /^beast$/i.test(String(c.setters['type']?.value ?? '').trim()));
  t.diagnostic(`creatures whose type setter is Beast: ${beasts.length}, by book ${tally(beasts.map((b) => b.source), 6)}`);
});

test('what the samples hold of creatures, and what their elements print of what an NPC keeps', { skip: savesSkip }, async (t) => {
  const elements = await realElements();
  const { pc, creatureTypes, kept } = await kinds();
  const listed = new Set(pc.sheet.sections.flatMap((s) => s.types ?? []));
  let holding = 0;
  let printing = 0;
  const creatureNames: string[] = [];
  const printed: string[] = [];
  const samples = readManifest().samples;
  for (const sample of samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const held = run.derived.elements;
    const creatures = held.filter((e) => creatureTypes.has(e.type));
    if (creatures.length) holding++;
    creatureNames.push(...creatures.map((c) => c.name));
    const reached = new Set<string>();
    for (const element of held) for (const to of reachedByText(element, run.elements)) if (kept.has(to.type)) reached.add(to.name);
    if (reached.size) printing++;
    printed.push(...reached);
  }
  t.diagnostic(`samples holding a creature: ${holding} of ${samples.length} (${tally(creatureNames)})`);
  t.diagnostic(`a player character's sheet section listing a creature type: ${[...creatureTypes].filter((type) => listed.has(type)).length}`);
  t.diagnostic(`samples whose held elements print an element of a type an NPC keeps: ${printing} (${tally(printed)})`);
});
