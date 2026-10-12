/**
 * Which held creature a holder's feature is about — ADR 0109, amending ADR 0073.
 *
 * Content writes a holder's feature that improves "your companion" as a rule on the holder's own element, in the one
 * namespace every creature's scope reads, so with two creatures held it reached both: a Battle Smith 15 holding a
 * Homunculus Servant too showed Improved Defender's +2 armour class on both, where the book says "your steel defender".
 * The link is in what content already records: the Battle Smith subclass grants Improved Defender and leads to the Steel
 * Defender, and leads nowhere near the infusion that holds the homunculus.
 *
 * So a held element is **about** a creature when it, or an element that gave it, is among what reached the creature (the
 * creature itself included): the elements whose recorded choice holds it or whose grant names it, back to the start. In
 * the scope of a creature it is not about, such an element's rules on the scope's stats are not applied, when it is about
 * some held creature; one about none applies everywhere, as before. Core names no namespace: the scope's stats are the
 * ones the kind's `companions` declaration names, and what their formulas read, less what the holder's kind declares.
 */

import { statReferences } from './expression.ts';
import type { Character } from './character.ts';
import type { Element, ElementId, StatKey } from './model.ts';
import type { ResolvedCharacterKind } from './system.ts';

/**
 * The stats a creature's scope has of its own: every stat the kind's `companions` declaration names (its stats, its
 * sheet's rows and their templates, its contributions and starts) and what their formulas read in turn, less every stat
 * the holder's kind declares. Lowercased. Empty for a kind with no declaration.
 */
export function scopeStatNames(kind: ResolvedCharacterKind): Set<StatKey> {
  const declaration = kind.companions;
  const names = new Set<StatKey>();
  if (!declaration) return names;
  const holder = new Set(kind.stats.map((stat) => stat.name.toLowerCase()));
  const formulas = new Map<StatKey, Parameters<typeof statReferences>[0]>();
  for (const stat of [...kind.stats, ...(declaration.stats ?? [])]) formulas.set(stat.name.toLowerCase(), stat.derive);

  const pending: string[] = [];
  const name = (stat: string | undefined): void => {
    if (stat) pending.push(stat.toLowerCase());
  };
  for (const stat of declaration.stats ?? []) name(stat.name);
  for (const start of declaration.setterStats ?? []) name(start.stat);
  for (const contribution of declaration.contributions ?? []) {
    name(contribution.stat);
    for (const read of statReferences(contribution.value)) name(read);
  }
  for (const section of declaration.sheet ?? []) {
    for (const row of section.stats ?? []) {
      name(row);
      for (const template of [section.showWhen, section.beside, section.mark?.stat, section.mark?.per]) {
        if (template) name(template.replaceAll('{stat}', row));
      }
    }
  }
  while (pending.length) {
    const stat = pending.pop()!;
    if (names.has(stat) || holder.has(stat)) continue;
    names.add(stat);
    for (const read of statReferences(formulas.get(stat))) pending.push(read);
  }
  return names;
}

/**
 * For each held creature, the held elements whose rules on the scope's stats are not applied in its scope: those about
 * another held creature and not about it. Keyed by the creature's id; a creature with nothing left out has no entry.
 */
export function foreignFeatures(
  character: Character,
  held: readonly Element[],
  creatures: readonly Element[],
  scopeStats: ReadonlySet<StatKey>,
): Map<ElementId, Set<ElementId>> {
  const out = new Map<ElementId, Set<ElementId>>();
  if (creatures.length < 2 || scopeStats.size === 0) return out;
  const creatureIds = new Set(creatures.map((c) => c.id));
  const heldIds = new Set(held.map((e) => e.id));

  // Who gave each held element: a held element whose recorded choice holds it, or whose grant names it.
  const givers = new Map<ElementId, Set<ElementId>>();
  const give = (giver: ElementId, given: ElementId): void => {
    if (giver === given || !heldIds.has(giver)) return;
    let set = givers.get(given);
    if (!set) givers.set(given, (set = new Set()));
    set.add(giver);
  };
  for (const choice of character.choices) {
    const at = choice.ruleKey.indexOf('/select:');
    if (at <= 0) continue;
    for (const id of choice.elementIds) give(choice.ruleKey.slice(0, at), id);
  }
  for (const element of held) {
    for (const rule of element.rules) if (rule.kind === 'grant') give(element.id, rule.id);
  }

  // What reached each creature, itself included.
  const reached = new Map<ElementId, Set<ElementId>>();
  for (const creature of creatures) {
    const seen = new Set<ElementId>([creature.id]);
    const queue = [creature.id];
    while (queue.length) {
      for (const giver of givers.get(queue.pop()!) ?? []) {
        if (seen.has(giver)) continue;
        seen.add(giver);
        queue.push(giver);
      }
    }
    reached.set(creature.id, seen);
  }

  for (const element of held) {
    if (creatureIds.has(element.id)) continue;
    if (!element.rules.some((rule) => rule.kind === 'stat' && scopeStats.has(rule.name.toLowerCase()))) continue;
    const ties = [element.id, ...(givers.get(element.id) ?? [])];
    const about = creatures.filter((creature) => ties.some((id) => reached.get(creature.id)!.has(id)));
    // About none of them: applied in every scope, as before (ADR 0109 decision 3).
    if (about.length === 0) continue;
    for (const creature of creatures) {
      if (about.includes(creature)) continue;
      let set = out.get(creature.id);
      if (!set) out.set(creature.id, (set = new Set()));
      set.add(element.id);
    }
  }
  return out;
}
