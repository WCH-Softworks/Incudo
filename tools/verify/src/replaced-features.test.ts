/**
 * What an element's own requirements do to it once it is held, read from content and the samples, before deciding.
 *
 * Tasha's optional class features come as items a character equips. Six of them replace a feature rather than add one:
 * the item grants the new feature and an internal marker, and the old feature carries `<requirements>!marker</requirements>`
 * on itself, not on the class's `<grant>` of it. The engine reads an element's own requirements when it offers the
 * element as a candidate and, since ADR 0064, as a warning on something the user added. An element reached by a grant
 * is held whatever they say, so a 2014 Ranger who takes Deft Explorer holds Natural Explorer as well, and nothing says so.
 *
 * Reported, from content alone: how many elements carry their own requirements, how many of those a `<grant>` reaches,
 * how many negate an id and how many of the negated ids anything grants, and what grants them. Then the thirty samples:
 * every held element whose own requirements are false in the finished derivation (the element itself counted as not
 * held, as ADR 0064 asks them), how it came to be held, and whether Aurora's own `<sum>` has it, which is the one
 * witness of what Aurora does with such an element. The same again with Aurora's `[character:N]` and `[type:X]` read as
 * their context says (the character's level, and holding an element of that type): both parse into stats nothing
 * publishes, so today they read false everywhere, which is also why a level 4 2024 Fighter, the last case here, is
 * offered none of the 2024 general feats. Then the Ranger, built here with and without Deft Explorer.
 *
 * Everything is reported as `ℹ` lines and nothing is asserted (ADR 0042). Elements are found by their rules, setters
 * and the samples' records, except the Ranger and the Deft Explorer item, looked up by name and id to build one case.
 *
 * **Written before ADR 0071 was built, and kept as its record.** Since it was, the engine reads both terms and withdraws
 * a granted element whose own requirements are false, so the sample rows here read 0 where they read 58 (and 26 with
 * both terms read), the 2024 Fighter is offered the feats, and the Ranger holds one explorer at a time. The figures from
 * before are in the ADR; what the change is held to is `own-requirements.test.ts` and the engine's `withdrawn.test.ts`.
 */

import { test } from 'node:test';

import {
  addedElementIds,
  chosenElementIds,
  deriveCharacter,
  evaluateRequirements,
  equippedElementIds,
  requirementContextFor,
  resolveCharacterKind,
  setChoice,
  setInventoryEntry,
  type Element,
  type RequirementExpr,
} from '@incudo/core';
import { CharacterBuilder, newCharacterOfKind } from '@incudo/ui';

import { differenceLines, runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

function tally(values: string[], limit = 10): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, limit).map(([v, n]) => `${n} ${v}`);
  if (sorted.length > limit) shown.push(`${sorted.length - limit} more`);
  return shown.join(', ') || 'none';
}

/** The ids an expression holds under a `not`: "unless the character has X". */
function negatedIds(expr: RequirementExpr | undefined, negated = false, into = new Set<string>()): Set<string> {
  if (!expr) return into;
  switch (expr.kind) {
    case 'not':
      return negatedIds(expr.child, !negated, into);
    case 'and':
    case 'or':
      for (const child of expr.children) negatedIds(child, negated, into);
      return into;
    case 'has':
      if (negated) into.add(expr.id);
      return into;
    default:
      return into;
  }
}

test('what content says with an element\'s own requirements, and what grants the ids they negate', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const all = [...elements.all()];
  const guarded = all.filter((e) => e.requirements);
  const granted = new Map<string, Element[]>();
  for (const element of all) {
    for (const rule of element.rules) {
      if (rule.kind !== 'grant') continue;
      const list = granted.get(rule.id) ?? [];
      list.push(element);
      granted.set(rule.id, list);
    }
  }
  t.diagnostic(`elements carrying their own requirements: ${guarded.length}, of ${tally(guarded.map((e) => e.type), 8)}`);
  const reached = guarded.filter((e) => granted.has(e.id));
  t.diagnostic(`of them reached by a <grant>: ${reached.length}, of ${tally(reached.map((e) => e.type), 8)}`);

  const negating = guarded.filter((e) => negatedIds(e.requirements).size > 0);
  const negated = new Set(negating.flatMap((e) => [...negatedIds(e.requirements)]));
  t.diagnostic(`negating an id ("unless the character has …"): ${negating.length} elements, ${negated.size} distinct ids`);
  const grantedNegated = [...negated].filter((id) => granted.has(id));
  t.diagnostic(`negated ids that something grants: ${grantedNegated.length}`);
  const replacers = grantedNegated.flatMap((id) => granted.get(id)!);
  t.diagnostic(
    `  granted by: ${tally(replacers.map((e) => `${e.type}${e.setters['category'] ? ` (${e.setters['category'].value})` : ''} from ${e.source}`))}`,
  );
  const replacedGranted = negating.filter((e) => granted.has(e.id) && [...negatedIds(e.requirements)].some((id) => granted.has(id)));
  t.diagnostic(
    `elements a grant reaches and a grant elsewhere can switch off: ${replacedGranted.length} (${replacedGranted.map((e) => e.name).join('; ')})`,
  );
  const optional = all.filter((e) => e.setters['category']?.value === 'Optional Class Features');
  const replacing = optional.filter((e) => e.rules.some((r) => r.kind === 'grant' && negated.has(r.id)));
  t.diagnostic(`items of category Optional Class Features: ${optional.length}; granting a negated id: ${replacing.length} (${replacing.map((e) => e.name).join('; ')})`);
});

test('what the samples hold whose own requirements are false, and whether Aurora holds it', { skip: savesSkip }, async (t) => {
  const elements = await realElements();
  let total = 0;
  const rows: string[] = [];
  const how: string[] = [];
  let auroraHas = 0;
  let auroraLacks = 0;
  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const ctx = requirementContextFor(run.derived);
    const extra = new Set(
      differenceLines(run)
        .filter((line) => line.startsWith('element-extra:'))
        .map((line) => line.slice('element-extra:'.length)),
    );
    const chosen = new Set(chosenElementIds(run.imported.character));
    const added = new Set(addedElementIds(run.imported.character));
    const equipped = new Set(equippedElementIds(run.imported.character));
    for (const element of run.derived.elements) {
      if (!element.requirements) continue;
      const before = { ...ctx, hasElement: (other: string) => other !== element.id && ctx.hasElement(other) };
      if (evaluateRequirements(element.requirements, before)) continue;
      total++;
      const way = chosen.has(element.id) ? 'chosen' : added.has(element.id) ? 'added' : equipped.has(element.id) ? 'equipped' : 'granted';
      how.push(way);
      const inAurora = !extra.has(element.id);
      if (inAurora) auroraHas++;
      else auroraLacks++;
      rows.push(`${sample.id} ${element.id} (${way}; Aurora ${inAurora ? 'has it' : 'does not'})`);
    }
  }
  t.diagnostic(`held elements whose own requirements are false: ${total}, ${tally(how)}`);
  t.diagnostic(`  in Aurora's <sum> too: ${auroraHas}; missing from it (an element-extra): ${auroraLacks}`);
  for (const row of rows) t.diagnostic(`  ${row}`);
});

test('read with Aurora\'s [character:N] and [type:X], which false own requirements Aurora holds', { skip: savesSkip }, async (t) => {
  // `[character:N]` (64 uses) and `[type:X]` (8) parse into stats nothing publishes, so they read false everywhere.
  // Read here as what their context says they mean: the character's level at least N, and holding an element of type
  // X. With them, the question the decision turns on: of the held elements whose own requirements are false, does
  // Aurora hold any, and does it lack any that was granted?
  const elements = await realElements();
  const rows = new Map<string, number>();
  const lines: string[] = [];
  for (const sample of readManifest().samples) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const base = requirementContextFor(run.derived);
    const types = new Set(run.derived.elements.map((e) => e.type.toLowerCase()));
    const ctx = {
      ...base,
      statNumber: (stat: string) => (stat === 'character' ? run.derived.progress.value : base.statNumber(stat)),
      statTags: (stat: string) => (stat === 'type' ? types : base.statTags?.(stat)),
    };
    const extra = new Set(differenceLines(run).filter((l) => l.startsWith('element-extra:')).map((l) => l.slice(14)));
    const chosen = new Set([...chosenElementIds(run.imported.character), ...addedElementIds(run.imported.character)]);
    for (const element of run.derived.elements) {
      if (!element.requirements) continue;
      const before = { ...ctx, hasElement: (other: string) => other !== element.id && ctx.hasElement(other) };
      if (evaluateRequirements(element.requirements, before)) continue;
      const key = `${chosen.has(element.id) ? 'chosen' : 'granted'}, Aurora ${extra.has(element.id) ? 'lacks it' : 'has it'}`;
      rows.set(key, (rows.get(key) ?? 0) + 1);
      lines.push(`${sample.id} ${element.id} (${key})`);
    }
  }
  t.diagnostic(`held with false own requirements, both terms read: ${[...rows].map(([k, n]) => `${n} ${k}`).join('; ') || 'none'}`);
  for (const line of lines) t.diagnostic(`  ${line}`);
});

test('what a level 4 2024 Fighter is offered of the 2024 general feats', { skip: corpusSkip }, async (t) => {
  // A case built by name: the 2024 Human and Fighter. Its level 4 feat choice is the decision offering the most feats.
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const b = new CharacterBuilder(newCharacterOfKind(system, 'pc'), system, elements);
  for (const [step, name] of [['race', 'Human'], ['class', 'Fighter']] as const) {
    const decision = b.getState().decisions.find((d) => d.stepId === step);
    const id = decision?.candidates.find((c) => elements.get(c)?.name === name && elements.get(c)?.source === 'Player’s Handbook (2024)');
    if (!decision || !id) return void t.diagnostic(`no 2024 ${name} in this corpus`);
    b.choose(decision.id, [id]);
  }
  b.setProgress(4);
  const general = elements.byType('Feat').filter((f) => f.source === 'Player’s Handbook (2024)' && f.supports.includes('General'));
  // The one offering the most feats: the level 4 improvement, not the origin feat or the fighting style.
  const feats = (d: { candidates: string[] }) => d.candidates.filter((c) => elements.get(c)?.type === 'Feat').length;
  const choice = [...b.getState().decisions].sort((x, y) => feats(y) - feats(x))[0];
  const offered = general.filter((f) => choice?.candidates.includes(f.id));
  const gated = general.filter((f) => JSON.stringify(f.requirements ?? null).includes('"stat":"character"'));
  t.diagnostic(
    `2024 General feats: ${general.length}; ${gated.length} of them require [character:N]; offered at level 4 (${choice?.label ?? 'no feat choice'}): ${offered.length}`,
  );
});

test('a 2014 Ranger with and without the Deft Explorer item', { skip: corpusSkip }, async (t) => {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const kind = resolveCharacterKind(system, 'pc');
  const ranger = elements.byType('Class').find((c) => c.name === 'Ranger' && c.source === 'Player’s Handbook');
  const item = elements.get('ID_WOTC_TCOE_ITEM_OCF_RANGER_DEFT_EXPLORER');
  if (!ranger || !item) {
    t.diagnostic('the 2014 Ranger or the Deft Explorer item is not in this corpus');
    return;
  }
  const replaced = item.rules.filter((r) => r.kind === 'grant').map((r) => r.id);
  const guarded = [...elements.all()].filter((e) => [...negatedIds(e.requirements)].some((id) => replaced.includes(id)));
  const base = setChoice(newCharacterOfKind(system, 'pc'), 'build/class', [ranger.id]);
  const withItem = setInventoryEntry(base, { instanceId: '1', elementId: item.id, equipped: true });
  for (const [label, character] of [['without', base], ['with', withItem]] as const) {
    const derived = deriveCharacter(character, system, elements, { kind });
    const held = (id: string) => (derived.elementIds.has(id) ? 'held' : 'not held');
    t.diagnostic(
      `${label} the item: ${guarded.map((e) => `${e.name} ${held(e.id)}`).join(', ')}; ` +
        `${replaced.map((id) => `${elements.get(id)?.name ?? id} ${held(id)}`).join(', ')}; ` +
        `problems naming the replaced feature: ${derived.problems.filter((p) => guarded.some((e) => p.elementId === e.id)).length}`,
    );
  }
});
