/**
 * Differential verification: Incudo's derivation vs the one Aurora already did.
 *
 * This is the reason the save importer is worth building at all (ADR 0008, ROADMAP Phase 1).
 * Aurora wrote its own answer into every save it ever produced — `<sum>` is every element its
 * engine ended up with, `<magic>` is the spell slots, save DC and attack bonus it computed —
 * and those answers were checked, for ten years, by people whose characters would have been
 * wrong if they were not. Nothing else this project can get for free is worth as much.
 *
 * A difference is not automatically an Incudo bug. It is one of four things, and the report
 * says which so the reader does not have to guess:
 *
 *  - **an engine or content bug** — the useful case, and the reason to run this;
 *  - **an Aurora-app behaviour Incudo has not modelled** — Aurora computes multiclass spell
 *    slots in code, expands a cleric's whole spell list in code, and has an inventory that
 *    Incudo does not have yet;
 *  - **a source that is not enabled** — the character used a book this run did not load;
 *  - **content drift** — the corpus moved since the save was written, which is exactly what
 *    Aurora's per-choice `checksum` was for.
 *
 * The middle two are reported as `not-modelled` and `content-missing` and do **not** count as
 * mismatches. Counting them would make the exit code useless: it could never be zero, and
 * nobody reads a check that always fails. Drift does count, because from here it is
 * indistinguishable from a gate that fired when it should not have — the difference is a
 * judgement about upstream history, and this file does not get to make it.
 */

import type { DerivedCharacter, Element, ElementId, ElementIndex } from '@incudo/core';
import type { AuroraSave, AuroraSpellcasting } from './parse-save.ts';

export type DifferenceKind =
  /** Aurora's derivation has an element Incudo's does not. */
  | 'element-missing'
  /** Incudo's derivation has an element Aurora's does not. */
  | 'element-extra'
  /** A spell Aurora listed under a spellcasting block that Incudo did not derive. */
  | 'spell-missing'
  /** A number both sides computed, differently. */
  | 'stat-mismatch'
  /**
   * Aurora used an element that is not in the loaded content at all. A statement about which
   * sources are enabled, not about the engine, so it is reported and not counted.
   */
  | 'content-missing'
  /** Aurora computed something no loaded system definition declares. Not a failure. */
  | 'not-modelled';

export interface AuroraDifference {
  kind: DifferenceKind;
  message: string;
  elementId?: ElementId;
  /** What Aurora said, then what Incudo said. Numbers where both are numbers. */
  expected?: number | string;
  actual?: number | string;
}

export interface AuroraComparison {
  /** Element ids Aurora derived, deduplicated. */
  auroraElements: number;
  incudoElements: number;
  differences: AuroraDifference[];
  /** Differences that are real disagreements — everything except `not-modelled`. */
  mismatches: number;
  /** True when the two derivations agree on everything both sides model. */
  agrees: boolean;
}

export interface CompareOptions {
  /**
   * The content the character was derived against. Optional, and worth passing: it is what
   * separates "the engine disagrees" from "that book is not enabled" and from "that came
   * from an item in the character's bag".
   */
  index?: ElementIndex;
  /**
   * How the loaded system names the things Aurora's `<magic>` block reports. Defaults match
   * `systems/dnd5e/system.json`; a fork that renames `proficiency` passes its own.
   *
   * There is no D&D knowledge below this object — it is the one place a rule of the game is
   * spelled out, and it is spelled out as configuration.
   */
  stats?: {
    /** Stat holding the proficiency bonus. */
    proficiency?: string;
    /** `"intelligence"` -> the stat holding its modifier. */
    abilityModifier?: (ability: string) => string;
    /** Spell save DC = this + proficiency + ability modifier. */
    saveDcBase?: number;
  };
  /**
   * Element types to ignore when diffing the element set. Aurora's `<sum>` records a few
   * things that are app furniture rather than content.
   */
  ignoreTypes?: string[];
}

const DEFAULT_STATS = {
  proficiency: 'proficiency',
  abilityModifier: (ability: string) => `${ability.toLowerCase()}:modifier`,
  saveDcBase: 8,
};

export function compareWithAurora(
  save: AuroraSave,
  derived: DerivedCharacter,
  options: CompareOptions = {},
): AuroraComparison {
  const stats = { ...DEFAULT_STATS, ...options.stats };
  const ignore = new Set(options.ignoreTypes ?? []);
  const differences: AuroraDifference[] = [];

  const auroraIds = new Set(save.sum);
  const incudoIds = new Set(derived.elementIds);
  const byId = new Map<ElementId, Element>(derived.elements.map((e) => [e.id, e]));

  const inventory = inventoryClosure(save, options.index);
  const parents = new Map<ElementId, ElementId | undefined>(
    save.grants.map((g) => [g.id, g.parentId]),
  );
  const fromInventory = statsFromInventory(inventory, options.index);

  compareElements(auroraIds, incudoIds, byId, ignore, inventory, parents, options.index, differences);
  for (const block of save.magic) {
    compareSpellcasting(block, derived, byId, stats, fromInventory, differences);
  }

  // Only genuine disagreements count. `not-modelled` and `content-missing` are facts about
  // the model and the source list, and a check whose exit code can never be zero is a check
  // nobody runs.
  const mismatches = differences.filter(
    (d) => d.kind !== 'not-modelled' && d.kind !== 'content-missing',
  ).length;
  return {
    auroraElements: auroraIds.size,
    incudoElements: incudoIds.size,
    differences,
    mismatches,
    agrees: mismatches === 0,
  };
}

// --- the element set -------------------------------------------------------

/**
 * Everything the character's inventory brings with it: the items themselves, whatever is
 * attached to them, and the transitive closure of what those grant.
 *
 * The closure matters more than the items. A suit of plate armour is one id in the bag and
 * pulls in a stealth-disadvantage marker; a Tome of Clear Thought pulls in an ability score
 * increase. Comparing only the item ids would leave those looking like grants Incudo failed
 * to fire, when the real answer is that Incudo has nowhere to put the armour yet.
 */
function inventoryClosure(save: AuroraSave, index: ElementIndex | undefined): Set<ElementId> {
  const ids = new Set<ElementId>();
  for (const item of save.equipment) {
    ids.add(item.id);
    for (const adorner of item.adorners) ids.add(adorner.id);
  }
  if (!index) return ids;

  let frontier = [...ids];
  while (frontier.length) {
    const next: ElementId[] = [];
    for (const id of frontier) {
      const element = index.get(id);
      if (!element) continue;
      for (const rule of element.rules) {
        if (rule.kind !== 'grant' || ids.has(rule.id)) continue;
        ids.add(rule.id);
        next.push(rule.id);
      }
    }
    frontier = next;
  }
  return ids;
}

/** Depth cap on the ancestor walk. A save's build tree is nine deep at most. */
const MAX_ANCESTRY = 32;

/**
 * Why Incudo does not have an element Aurora derived, when the reason is not the element.
 *
 * Walks the save's own grant tree upwards looking for a cause that is not an engine
 * disagreement: an ancestor in the character's bag, or one that is not in the loaded content
 * at all. Returns nothing when no such ancestor exists — which is the interesting case, and
 * the one that gets reported as a real difference.
 */
function explainAbsence(
  id: ElementId,
  parents: Map<ElementId, ElementId | undefined>,
  inventory: Set<ElementId>,
  index: ElementIndex | undefined,
): { kind: DifferenceKind; message: string } | undefined {
  let current: ElementId | undefined = id;
  const seen = new Set<ElementId>();

  for (let step = 0; current && step < MAX_ANCESTRY; step++) {
    if (seen.has(current)) break;
    seen.add(current);
    const via = current === id ? '' : ` (via "${current}")`;

    if (inventory.has(current)) {
      return {
        kind: 'not-modelled',
        message: `"${id}" comes from the character's inventory${via}. Incudo has no inventory yet (ROADMAP Phase 2), so it is not compared.`,
      };
    }
    if (index && !index.get(current)) {
      return {
        kind: 'content-missing',
        message: `Aurora derived "${id}"${via}, which is not in the loaded content at all. Enable the source it came from to compare it.`,
      };
    }
    current = parents.get(current);
  }
  return undefined;
}

/**
 * The big check: 951 element ids across the eight sample saves.
 *
 * Both directions matter and they fail differently. An element Aurora had and Incudo does not
 * is a grant that did not fire — a requirement read wrong, a level gate off by one, a select
 * whose key did not match. One Incudo has and Aurora does not is the opposite: a gate that
 * should have held and did not. The second is the quieter bug and the more dangerous one,
 * because the sheet looks *better* rather than broken.
 */
function compareElements(
  aurora: Set<ElementId>,
  incudo: Set<ElementId>,
  byId: Map<ElementId, Element>,
  ignore: Set<string>,
  inventory: Set<ElementId>,
  parents: Map<ElementId, ElementId | undefined>,
  index: ElementIndex | undefined,
  differences: AuroraDifference[],
): void {
  for (const id of [...aurora].sort()) {
    if (incudo.has(id)) continue;

    // Why an element is absent is nearly always an answer about an ancestor, not about the
    // element. A Half-Elf variant that is not in the loaded content takes its Keen Senses
    // and its Perception proficiency with it, and all three would otherwise be reported as
    // three separate engine failures. The save records the tree; walking it is free.
    const cause = explainAbsence(id, parents, inventory, index);
    if (cause) {
      differences.push({ kind: cause.kind, elementId: id, message: cause.message });
      continue;
    }

    differences.push({
      kind: 'element-missing',
      elementId: id,
      message: `Aurora derived "${id}"; Incudo did not.`,
    });
  }
  for (const id of [...incudo].sort()) {
    if (aurora.has(id)) continue;
    const element = byId.get(id);
    const type = element?.type;
    if (type && ignore.has(type)) continue;

    // The two engines spell a multiclassed class differently, and neither is wrong. Aurora
    // keeps class levels in application state and puts only the *multiclass* element in
    // `<sum>`; Incudo makes the class element itself the track the levels belong to
    // (ADR 0015), which is what lets its features derive at all. So an extra whose own
    // `<multiclass>` block is in Aurora's set is the same fact written twice, not a gate
    // that failed to hold.
    const multiclassId = element?.multiclass?.id;
    if (multiclassId && aurora.has(multiclassId)) {
      differences.push({
        kind: 'not-modelled',
        elementId: id,
        message: `Incudo derived "${id}"; Aurora recorded the same class as "${multiclassId}". Aurora keeps class levels in application state and Incudo makes the class a track (ADR 0015), so this is one fact in two shapes.`,
      });
      continue;
    }

    // Naming the granter is what makes this line actionable. Every extra on the eight
    // sample saves turned out to be a grant added to the corpus after the save was written,
    // and the way to tell is to look at the granting element's history. "Incudo derived X"
    // sends the reader hunting; "granted by ID_RACE_ELF" sends them to one file.
    const granter = [...incudo].find((held) =>
      byId.get(held)?.rules.some((r) => r.kind === 'grant' && r.id === id),
    );
    differences.push({
      kind: 'element-extra',
      elementId: id,
      message:
        `Incudo derived "${id}"${type ? ` (${type})` : ''}; Aurora did not.` +
        (granter ? ` Granted by "${granter}" — check whether that grant post-dates the save.` : ''),
    });
  }
}

// --- <magic> ---------------------------------------------------------------

/**
 * Aurora's spellcasting numbers, against ours.
 *
 * `dc` and `attack` differ by exactly the save-DC base in every sample, so they carry one
 * fact between them: the ability modifier plus the proficiency bonus. That single number is
 * still worth a great deal — it is the only place in the whole save format where Aurora
 * records a *derived* ability score, so it is the only way to check that racial bonuses,
 * ability score improvements and feats all landed. Nothing else in the file can catch a
 * character whose Intelligence came out one too low.
 */
/**
 * Stats the character's inventory contributes to, and which item does it.
 *
 * Aurora's spell save DC folds in whatever the character is carrying. One sample wizard has
 * a Tome of Clear Thought, worth +2 Intelligence and therefore +1 to a DC — and Incudo,
 * with no inventory, computes a DC one lower and is not wrong to. Knowing *which* stats the
 * bag touches is the difference between reporting that honestly and reporting it as an
 * engine bug.
 */
function statsFromInventory(
  inventory: Set<ElementId>,
  index: ElementIndex | undefined,
): Map<string, ElementId> {
  const touched = new Map<string, ElementId>();
  if (!index) return touched;
  for (const id of inventory) {
    for (const rule of index.get(id)?.rules ?? []) {
      if (rule.kind === 'stat' && !touched.has(rule.name.toLowerCase())) {
        touched.set(rule.name.toLowerCase(), id);
      }
    }
  }
  return touched;
}

function compareSpellcasting(
  block: AuroraSpellcasting,
  derived: DerivedCharacter,
  byId: Map<ElementId, Element>,
  stats: typeof DEFAULT_STATS,
  fromInventory: Map<string, ElementId>,
  differences: AuroraDifference[],
): void {
  const where = `spellcasting "${block.name}"`;

  // A class that prepares from its whole list — a cleric, a druid — declares
  // `<spellcasting all="true">`, and Aurora expands that into every spell of the class in
  // application code. No content file lists them, so there is nothing for the engine to
  // derive and nothing to disagree about: one note rather than sixty failures.
  const source = block.source ? byId.get(block.source) : undefined;
  const wholeList =
    source?.spellcasting?.some((s) => s.all || s.prepare === 'true') ?? false;

  const notDerived = [...block.cantrips, ...block.spells].filter((s) => !byId.has(s.id));
  if (wholeList && notDerived.length) {
    differences.push({
      kind: 'not-modelled',
      elementId: block.source,
      message: `${where}: prepares from its whole class list, which Aurora expands in application code. ${notDerived.length} spell(s) are not compared.`,
    });
  } else {
    for (const spell of notDerived) {
      differences.push({
        kind: 'spell-missing',
        elementId: spell.id,
        message: `Aurora has "${spell.name}" (${spell.id}) on ${where}; Incudo did not derive it.`,
      });
    }
  }

  if (block.slots.some((n) => n > 0)) {
    // Aurora's slot table lives in its app, not in any content file. Until a system
    // definition declares one there is nothing to disagree with, and pretending otherwise
    // would put a permanent failure in the report.
    differences.push({
      kind: 'not-modelled',
      message: `${where}: Aurora recorded spell slots ${block.slots.join('/')}. No loaded system declares a slot table, so this is not compared.`,
      expected: block.slots.join('/'),
    });
  }

  if (block.dc === undefined || !block.ability) return;

  const proficiency = derived.stats.get(stats.proficiency.toLowerCase())?.value;
  const modifierKey = stats.abilityModifier(block.ability).toLowerCase();
  const modifier = derived.stats.get(modifierKey)?.value;

  if (proficiency === undefined || modifier === undefined) {
    differences.push({
      kind: 'not-modelled',
      message: `${where}: Aurora recorded a save DC of ${block.dc}, but this system declares no "${proficiency === undefined ? stats.proficiency : modifierKey}" stat to rebuild it from.`,
      expected: block.dc,
    });
    return;
  }

  // The bag is not on the sheet yet. If it contributes to the very ability this DC is built
  // from, the two numbers are answering different questions and comparing them says nothing.
  const ability = block.ability.toLowerCase();
  const carried =
    fromInventory.get(ability) ??
    fromInventory.get(modifierKey) ??
    fromInventory.get(stats.proficiency.toLowerCase());
  if (carried) {
    differences.push({
      kind: 'not-modelled',
      elementId: carried,
      message: `${where}: Aurora's save DC of ${block.dc} includes "${carried}" from the character's inventory, which Incudo has no home for yet (ROADMAP Phase 2). Not compared.`,
      expected: block.dc,
    });
    return;
  }

  const expected = stats.saveDcBase + proficiency + modifier;
  if (expected !== block.dc) {
    differences.push({
      kind: 'stat-mismatch',
      message: `${where}: Aurora's save DC is ${block.dc}; ${stats.saveDcBase} + proficiency ${proficiency} + ${block.ability} modifier ${modifier} gives ${expected}.`,
      expected: block.dc,
      actual: expected,
    });
  }

  if (block.attack !== undefined) {
    const expectedAttack = proficiency + modifier;
    if (expectedAttack !== block.attack) {
      differences.push({
        kind: 'stat-mismatch',
        message: `${where}: Aurora's spell attack bonus is ${block.attack}; proficiency ${proficiency} + ${block.ability} modifier ${modifier} gives ${expectedAttack}.`,
        expected: block.attack,
        actual: expectedAttack,
      });
    }
  }
}

/** Group a comparison's differences by kind, for a report that leads with the counts. */
export function summarizeDifferences(comparison: AuroraComparison): Map<DifferenceKind, number> {
  const counts = new Map<DifferenceKind, number>();
  for (const difference of comparison.differences) {
    counts.set(difference.kind, (counts.get(difference.kind) ?? 0) + 1);
  }
  return counts;
}
