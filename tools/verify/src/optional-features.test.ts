/**
 * Tasha's optional class features, read from content and the samples before deciding how the app offers them.
 *
 * They are items. Each one names its feature in a `category` setter ("Optional Class Features"), sits in the `misc`
 * slot, carries `inventory-hidden`, and says in its own description that a character equips it to enable it. Six of them
 * replace a feature as well as add one: they grant an internal marker that the old feature's own requirements negate, and
 * since ADR 0071 the engine withdraws the old feature once the item is equipped. The app has no way to put an item in the
 * bag, so none of that can be reached from it yet.
 *
 * Reported, from content alone: the items, which class and level each one's grants are gated on and how that is
 * written, what they grant without a condition, whether anything offers, grants or names them, and what else in the
 * corpus is hidden from the inventory or shares the category. Then the thirty samples: what their bags carry of these
 * items, or of anything hidden. Then, for one character of each class the items name, at level 20 in each edition, how
 * many of the items would give it anything, which is the question a list offering all of them to everyone raises.
 *
 * Everything is reported as `ℹ` lines and nothing is asserted (ADR 0042). The items are found by their setter, the
 * classes by the stats their grants are gated on and by name, never by an id.
 *
 * **Written before ADR 0072 was built, and kept as its record.** Since it was, 5e's "Optional class features" step takes
 * these items into the bag; what that is held to is `optional-feature-step.test.ts` and `packages/ui/src/equip-step.test.ts`.
 */

import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

import { parseAuroraSave } from '@incudo/aurora-import';
import {
  deriveCharacter,
  evaluateRequirements,
  requirementContextFor,
  resolveCharacterKind,
  setChoice,
  setInventoryEntry,
  setProgress,
  type Element,
  type GrantRule,
  type RequirementExpr,
} from '@incudo/core';
import { newCharacterOfKind } from '@incudo/ui';

import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const CATEGORY = 'Optional Class Features';
const HIDDEN = 'inventory-hidden';

function tally(values: string[], limit = 12): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = sorted.slice(0, limit).map(([v, n]) => `${n} ${v}`);
  if (sorted.length > limit) shown.push(`${sorted.length - limit} more`);
  return shown.join(', ') || 'none';
}

/** Every leaf of an expression, as written: `level:ranger>=1`, `has ID_X`, `!has ID_Y`. */
function leaves(expr: RequirementExpr | undefined, negated = false, into: string[] = []): string[] {
  if (!expr) return into;
  switch (expr.kind) {
    case 'not':
      return leaves(expr.child, !negated, into);
    case 'and':
    case 'or':
      for (const child of expr.children) leaves(child, negated, into);
      return into;
    case 'has':
      into.push(`${negated ? '!' : ''}has`);
      return into;
    case 'atLeast':
      into.push(`${negated ? '!' : ''}${expr.stat}>=${expr.value}`);
      return into;
    case 'equals':
      into.push(`${negated ? '!' : ''}${expr.stat}=${expr.value}`);
      return into;
    default:
      into.push(expr.kind);
      return into;
  }
}

/** The ids an expression holds under a `not`. */
function negatedIds(expr: RequirementExpr | undefined, negated = false, into = new Set<string>()): Set<string> {
  if (!expr) return into;
  if (expr.kind === 'not') return negatedIds(expr.child, !negated, into);
  if (expr.kind === 'and' || expr.kind === 'or') for (const child of expr.children) negatedIds(child, negated, into);
  if (expr.kind === 'has' && negated) into.add(expr.id);
  return into;
}

/** Every id an expression names, negated or not. */
function namedIds(expr: RequirementExpr | undefined, into = new Set<string>()): Set<string> {
  if (!expr) return into;
  if (expr.kind === 'not') return namedIds(expr.child, into);
  if (expr.kind === 'and' || expr.kind === 'or') for (const child of expr.children) namedIds(child, into);
  if (expr.kind === 'has') into.add(expr.id);
  return into;
}

/** The class stats (`level:<class>`) an expression is gated on. */
function classStats(expr: RequirementExpr | undefined, into = new Set<string>()): Set<string> {
  for (const leaf of leaves(expr)) {
    const match = /^level:([^>]+)>=/.exec(leaf);
    if (match) into.add(match[1]!);
  }
  return into;
}

const grantsOf = (element: Element): GrantRule[] => element.rules.filter((r): r is GrantRule => r.kind === 'grant');
const isOptionalFeature = (element: Element): boolean => element.setters['category']?.value === CATEGORY;

test('the optional class feature items, and how their prerequisites are written', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const all = [...elements.all()];
  const items = all.filter(isOptionalFeature);
  t.diagnostic(`elements of category ${CATEGORY}: ${items.length}, of ${tally(items.map((e) => `${e.type} from ${e.source}`))}`);
  t.diagnostic(`  slot: ${tally(items.map((e) => e.setters['slot']?.value ?? '(none)'))}; ${HIDDEN}: ${tally(items.map((e) => e.setters[HIDDEN]?.value ?? '(none)'))}`);
  t.diagnostic(
    `  own requirements: ${items.filter((e) => e.requirements).length}; support tags: ${items.filter((e) => e.supports.length).length}; ` +
      `rules other than grants: ${items.filter((e) => e.rules.some((r) => r.kind !== 'grant')).length}`,
  );

  const grants = items.flatMap(grantsOf);
  const conditional = grants.filter((g) => g.requirements || g.level !== undefined || g.equipped);
  t.diagnostic(
    `  grants: ${grants.length}; with a condition: ${conditional.length} (a level= attribute: ${grants.filter((g) => g.level !== undefined).length}, ` +
      `an equipped= one: ${grants.filter((g) => g.equipped).length}); conditions as written: ${tally(conditional.flatMap((g) => leaves(g.requirements).map((l) => l.replace(/>=\d+$/, '>=N'))))}`,
  );
  const unconditional = grants.filter((g) => !conditional.includes(g));
  t.diagnostic(`  unconditional grants: ${unconditional.length}, of type ${tally(unconditional.map((g) => g.type))}`);

  const negatedAnywhere = new Set(all.flatMap((e) => [...negatedIds(e.requirements)]));
  const replacing = items.filter((e) => grantsOf(e).some((g) => negatedAnywhere.has(g.id)));
  t.diagnostic(`  replacing a feature (granting an id some element's own requirements negate): ${replacing.length}: ${replacing.map((e) => e.name).join('; ')}`);
  const withoutClass = items.filter((e) => grantsOf(e).every((g) => classStats(g.requirements).size === 0));
  t.diagnostic(`  gated on no class level at all: ${withoutClass.length}: ${withoutClass.map((e) => `${e.name} (${grantsOf(e).flatMap((g) => leaves(g.requirements)).join(', ') || 'nothing'})`).join('; ')}`);

  // By class and the lowest level any of its grants opens at: what a list grouped by class would show.
  const byClass = new Map<string, string[]>();
  for (const item of items) {
    const gates = grantsOf(item).flatMap((g) => leaves(g.requirements)).filter((l) => l.startsWith('level:'));
    const lowest = new Map<string, number>();
    for (const gate of gates) {
      const [stat, value] = gate.split('>=') as [string, string];
      const n = Number(value);
      lowest.set(stat, Math.min(lowest.get(stat) ?? n, n));
    }
    for (const [stat, level] of lowest) byClass.set(stat, [...(byClass.get(stat) ?? []), `${level}`]);
  }
  t.diagnostic(`  by the class stat gating a grant, and the lowest level each item gives something at:`);
  for (const [stat, levels] of [...byClass].sort()) t.diagnostic(`    ${stat}: ${levels.length} (${levels.sort((a, b) => +a - +b).join(', ')})`);
  const nameVsGate = items.filter((item) => {
    const lead = item.name.split(',')[0]!.trim().toLowerCase();
    return ![...grantsOf(item).flatMap((g) => [...classStats(g.requirements)])].includes(lead) && classStats(grantsOf(item)[0]?.requirements).size > 0;
  });
  t.diagnostic(`  whose name leads with a class its grants are not gated on: ${nameVsGate.length}`);

  // Whether anything in content offers, grants or names them: a select would say how Aurora offers them.
  const ids = new Set(items.map((e) => e.id));
  const grantedBy = all.filter((e) => grantsOf(e).some((g) => ids.has(g.id)));
  const requiredBy = all.filter((e) => [...namedIds(e.requirements)].some((id) => ids.has(id)) || e.rules.some((r) => [...namedIds(r.requirements)].some((id) => ids.has(id))));
  const selectsOfItem = all.flatMap((e) => e.rules.filter((r) => r.kind === 'select' && r.type === 'Item'));
  t.diagnostic(
    `  granted by anything: ${grantedBy.length}; named in a requirement by: ${requiredBy.length} (${tally(requiredBy.map((e) => `${e.type}: ${e.name}`), 6)}); ` +
      `selects of type Item in the corpus: ${selectsOfItem.length}, none able to match an item with no support tags unless it names ids`,
  );
});

test('what else is hidden from the inventory, and what else shares a category of hidden items', { skip: corpusSkip }, async (t) => {
  const elements = await realElements();
  const all = [...elements.all()];
  const hidden = all.filter((e) => e.setters[HIDDEN]);
  t.diagnostic(`elements carrying ${HIDDEN}: ${hidden.length}, valued ${tally(hidden.map((e) => e.setters[HIDDEN]!.value))}`);
  const categories = new Set(hidden.map((e) => e.setters['category']?.value ?? '(none)'));
  for (const category of [...categories].sort()) {
    const inCategory = all.filter((e) => (e.setters['category']?.value ?? '(none)') === category && e.type === 'Item');
    const hiddenHere = hidden.filter((e) => (e.setters['category']?.value ?? '(none)') === category);
    const withRules = hiddenHere.filter((e) => e.rules.length > 0);
    t.diagnostic(
      `  ${category}: ${hiddenHere.length} hidden of ${inCategory.length} items; slot ${tally(hiddenHere.map((e) => e.setters['slot']?.value ?? '(none)'), 4)}; ` +
        `with rules ${withRules.length} (${tally(withRules.flatMap((e) => e.rules.map((r) => r.kind)), 4)}); e.g. ${hiddenHere.slice(0, 4).map((e) => e.name).join('; ')}`,
    );
  }
  const equipToEnable = all.filter((e) => e.type === 'Item' && /equip this item to/i.test(e.description ?? ''));
  t.diagnostic(`items whose own description says to equip it to enable it: ${equipToEnable.length}, by category ${tally(equipToEnable.map((e) => e.setters['category']?.value ?? '(none)'))}`);
});

test('what the samples carry of these items, or of anything hidden', { skip: savesSkip }, async (t) => {
  const elements = await realElements();
  const rows: string[] = [];
  let entries = 0;
  let saves = 0;
  for (const sample of readManifest().samples) {
    const save = parseAuroraSave(await readFile(samplePath(sample), 'utf8'));
    if (save.equipment.length) saves++;
    for (const item of save.equipment) {
      entries++;
      const element = elements.get(item.id);
      if (!element) continue;
      if (isOptionalFeature(element) || element.setters[HIDDEN]) {
        rows.push(`${sample.id}: ${element.name} (${element.setters['category']?.value}; ${item.equipped ? `equipped at ${item.location ?? 'no location'}` : 'carried'})`);
      }
    }
  }
  t.diagnostic(`bag entries in the samples: ${entries}, in ${saves} saves; of category ${CATEGORY} or hidden: ${rows.length}`);
  for (const row of rows) t.diagnostic(`  ${row}`);
});

test('how many of the items give anything to a level 20 character of each class they name, by edition', { skip: corpusSkip }, async (t) => {
  // An item gives something when one of its conditional grants holds (its unconditional ones are the replacement
  // markers). Asked of a level 20 single-class character with the item's grants read against its derivation.
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const kind = resolveCharacterKind(system, 'pc');
  const items = [...elements.all()].filter(isOptionalFeature);
  const stats = new Set(items.flatMap((item) => grantsOf(item).flatMap((g) => [...classStats(g.requirements)])));
  const editions = [
    ['2014', 'Player’s Handbook'],
    ['2024', 'Player’s Handbook (2024)'],
  ] as const;
  for (const stat of [...stats].sort()) {
    const parts: string[] = [];
    for (const [edition, book] of editions) {
      const cls = elements.byType('Class').find((c) => c.name.toLowerCase() === stat && c.source === book);
      if (!cls) {
        parts.push(`${edition}: no such class`);
        continue;
      }
      const character = setProgress(setChoice(newCharacterOfKind(system, 'pc'), 'build/class', [cls.id]), 20);
      const context = requirementContextFor(deriveCharacter(character, system, elements, { kind }));
      const giving = items.filter((item) => grantsOf(item).some((g) => g.requirements && evaluateRequirements(g.requirements, context)));
      // And what equipping all of them at once withdraws: the replacement half, by edition.
      let equipped = character;
      items.forEach((item, i) => (equipped = setInventoryEntry(equipped, { instanceId: `ocf-${i}`, elementId: item.id, equipped: true })));
      const withdrawn = deriveCharacter(equipped, system, elements, { kind }).withdrawn.map((w) => elements.get(w.elementId)?.name ?? w.elementId);
      parts.push(`${edition}: ${giving.length} give something (${giving.map((i) => i.name.split(': ')[1] ?? i.name).join(', ')}); all equipped withdraw ${withdrawn.length ? withdrawn.join(', ') : 'nothing'}`);
    }
    t.diagnostic(`${stat}: ${parts.join(' | ')}`);
  }
});
