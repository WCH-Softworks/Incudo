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
 *    slots in code, expands a cleric's whole spell list in code, and cancels an armour's
 *    stealth-disadvantage grant when a mithral adornment is on it;
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
   * separates "the engine disagrees" from "that book is not enabled", and what lets an
   * absent element name the item in the bag that should have brought it.
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
    /**
     * How the loaded system names the save DC and attack bonus of one casting source —
     * ADR 0020. `"Bard"` -> `bard:spellcasting:dc`.
     *
     * These read a number Incudo *published*, which is the whole point of them existing.
     * This file used to compute `8 + proficiency + <ability>:modifier` itself and compare
     * it against Aurora's `8 + proficiency + <ability>:modifier`: the two agreed on all
     * nine saves and the agreement proved only that the modifier and the bonus were right,
     * because no stat held a DC and no sheet could have shown one. The 8 now lives in
     * `systems/dnd5e/system.json`, where the rest of 5e's arithmetic lives.
     */
    spellcasting?: {
      dc?: (blockName: string) => string;
      attack?: (blockName: string) => string;
    };
    /**
     * How the loaded system names spell slots — ADR 0018. Three questions, because 5e has
     * two pools and a way to tell them apart, and none of that knowledge belongs in code:
     *
     *  - `shared`  the pool a multiclassed caster draws from, level 1-9;
     *  - `own`     a single casting source's own table, which content declares per class;
     *  - `solo`    non-zero when this source keeps its own slots instead of joining the
     *              shared pool. Pact magic is the case; `systems/dnd5e` publishes it from
     *              a `trackStats` entry, and without it the two pools are indistinguishable.
     */
    slots?: {
      shared?: (level: number) => string;
      own?: (blockName: string, level: number) => string;
      solo?: (blockName: string) => string;
    };
  };
  /**
   * Element types to ignore when diffing the element set. Aurora's `<sum>` records a few
   * things that are app furniture rather than content.
   */
  ignoreTypes?: string[];
}

const DEFAULT_STATS = {
  spellcasting: {
    dc: (blockName: string) => `${blockName.trim().toLowerCase()}:spellcasting:dc`,
    attack: (blockName: string) => `${blockName.trim().toLowerCase()}:spellcasting:attack`,
  },
  slots: {
    shared: (level: number) => `spellcasting:slots:${level}`,
    own: (blockName: string, level: number) =>
      `${blockName.trim().toLowerCase()}:spellcasting:slots:${level}`,
    solo: (blockName: string) => `${blockName.trim().toLowerCase()}:spellcasting:solo`,
  },
};

export function compareWithAurora(
  save: AuroraSave,
  derived: DerivedCharacter,
  options: CompareOptions = {},
): AuroraComparison {
  // `slots` merges a level deeper than the rest, so a caller renaming one of the three
  // keeps the defaults for the other two.
  const stats = {
    ...DEFAULT_STATS,
    ...options.stats,
    spellcasting: { ...DEFAULT_STATS.spellcasting, ...options.stats?.spellcasting },
    slots: { ...DEFAULT_STATS.slots, ...options.stats?.slots },
  };
  const ignore = new Set(options.ignoreTypes ?? []);
  const differences: AuroraDifference[] = [];

  const auroraIds = new Set(save.sum);
  const incudoIds = new Set(derived.elementIds);
  const byId = new Map<ElementId, Element>(derived.elements.map((e) => [e.id, e]));

  const inventory = inventoryClosure(save, options.index);
  const parents = new Map<ElementId, ElementId | undefined>(
    save.grants.map((g) => [g.id, g.parentId]),
  );

  compareElements(auroraIds, incudoIds, byId, ignore, inventory, parents, options.index, differences);
  for (const block of save.magic) {
    compareSpellcasting(block, derived, byId, stats, differences);
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
 * What the bag brings with it, in two piles because the engine treats them differently.
 *
 * Since step 3 of docs/INVENTORY-AND-AC-PLAN.md an **equipped** entry and its adornments seed
 * the derivation and a **carried** one seeds nothing, so the bag has stopped being an excuse
 * for a difference and become the thing under test. These sets survive only to make an
 * absence actionable: "Aurora derived X; Incudo did not" sends the reader hunting, and naming
 * the plate armour that should have granted it does not.
 *
 * The closure matters more than the items. A suit of plate armour is one id in the bag and
 * pulls in a stealth-disadvantage marker; a Tome of Clear Thought pulls in an ability score
 * increase. Comparing only the item ids would miss both.
 */
interface InventoryClosure {
  equipped: Set<ElementId>;
  carried: Set<ElementId>;
}

function inventoryClosure(save: AuroraSave, index: ElementIndex | undefined): InventoryClosure {
  const close = (seeds: ElementId[]): Set<ElementId> => {
    const ids = new Set<ElementId>(seeds);
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
  };

  // `AuroraItem.equipped` is `true | undefined`, never `false` — the save writes no tag at
  // all for a carried item — so this normalises rather than comparing straight.
  const seeds = (equipped: boolean): ElementId[] => {
    const ids: ElementId[] = [];
    for (const item of save.equipment) {
      if ((item.equipped ?? false) !== equipped) continue;
      ids.push(item.id);
      for (const adorner of item.adorners) ids.push(adorner.id);
    }
    return ids;
  };

  return { equipped: close(seeds(true)), carried: close(seeds(false)) };
}

/** Depth cap on the ancestor walk. A save's build tree is nine deep at most. */
const MAX_ANCESTRY = 32;

/**
 * Why Incudo does not have an element Aurora derived, when the reason is not the element.
 *
 * Walks the save's own grant tree upwards looking for the one cause that is not an engine
 * disagreement: an ancestor that is not in the loaded content at all. Returns nothing when
 * no such ancestor exists — which is the interesting case, and the one that gets reported
 * as a real difference.
 *
 * Until step 3 of the inventory plan this also excused anything the bag brought, which was
 * 47 of the 51 notes across the nine saves. The bag derives now, so an element it should
 * have brought and did not is exactly what this check exists to surface.
 */
function explainAbsence(
  id: ElementId,
  parents: Map<ElementId, ElementId | undefined>,
  index: ElementIndex | undefined,
): { kind: DifferenceKind; message: string } | undefined {
  let current: ElementId | undefined = id;
  const seen = new Set<ElementId>();

  for (let step = 0; current && step < MAX_ANCESTRY; step++) {
    if (seen.has(current)) break;
    seen.add(current);
    const via = current === id ? '' : ` (via "${current}")`;

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
  inventory: InventoryClosure,
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
    const cause = explainAbsence(id, parents, index);
    if (cause) {
      differences.push({ kind: cause.kind, elementId: id, message: cause.message });
      continue;
    }

    // Naming the bag is a hint now, not an excuse. An equipped item's closure is seeded, so
    // a gap in it is an engine failure with a known starting point. A carried one is seeded
    // deliberately, and Aurora leaves 18 of 19 carried items out of its own `<sum>`, so
    // Aurora recording one is the half that needs explaining.
    const bag = inventory.equipped.has(id)
      ? " It is in the character's equipped inventory, which seeds the derivation."
      : inventory.carried.has(id)
        ? ' It comes from a *carried* item, which seeds nothing by design (ADR 0024) — Aurora recording it is the part to explain.'
        : '';

    differences.push({
      kind: 'element-missing',
      elementId: id,
      message: `Aurora derived "${id}"; Incudo did not.${bag}`,
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
 * Aurora's nine-number slot row, against the stats the system publishes — ADR 0018.
 *
 * Two pools and one flag to choose between them. A source that keeps its own slots — pact
 * magic — is compared against its own table however multiclassed the character is; anything
 * else joins the shared pool the moment that pool exists, because that is what having a
 * caster level *means*. When neither pool is declared the row goes back to being a note,
 * which is what every system that is not 5e will see.
 *
 * The two pools cannot simply be added or maxed: a Paladin 17 / Sorcerer 1 has a caster level
 * of 9 and *fewer* 4th-level slots than the paladin alone would, which is a real quirk of the
 * published rule and the reason this picks rather than combines.
 */
function compareSlots(
  block: AuroraSpellcasting,
  derived: DerivedCharacter,
  stats: typeof DEFAULT_STATS,
  where: string,
  differences: AuroraDifference[],
): void {
  const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const read = (key: string): number | undefined => derived.stats.get(key.toLowerCase())?.value;

  const own = levels.map((level) => read(stats.slots.own(block.name, level)));
  const shared = levels.map((level) => read(stats.slots.shared(level)));
  const solo = (read(stats.slots.solo(block.name)) ?? 0) > 0;

  const ownDeclared = own.some((value) => value !== undefined);
  const sharedDeclared = shared.some((value) => value !== undefined);
  if (!ownDeclared && !sharedDeclared) {
    if (!block.slots.some((n) => n > 0)) return;
    differences.push({
      kind: 'not-modelled',
      message: `${where}: Aurora recorded spell slots ${block.slots.join('/')}. No loaded system declares a slot table, so this is not compared.`,
      expected: block.slots.join('/'),
    });
    return;
  }

  const usesShared = !solo && sharedDeclared && shared.some((value) => (value ?? 0) > 0);
  const source = usesShared
    ? 'the multiclass table'
    : solo
      ? 'its own track, outside the multiclass table'
      : 'its own class table';
  const actual = (usesShared ? shared : own).map((value) => value ?? 0);

  if (actual.join('/') === block.slots.join('/')) return;
  differences.push({
    kind: 'stat-mismatch',
    elementId: block.source,
    message: `${where}: Aurora recorded spell slots ${block.slots.join('/')}; Incudo derives ${actual.join('/')} from ${source}.`,
    expected: block.slots.join('/'),
    actual: actual.join('/'),
  });
}

/**
 * Aurora's spellcasting numbers, against ours.
 *
 * `dc` and `attack` differ by exactly the save-DC base in every sample, so they carry one
 * fact between them: the ability modifier plus the proficiency bonus. That single number is
 * still worth a great deal — it is the only place in the whole save format where Aurora
 * records a *derived* ability score, so it is the only way to check that racial bonuses,
 * ability score improvements, feats and now **equipped items** all landed. Nothing else in
 * the file can catch a character whose Intelligence came out one too low.
 *
 * Until step 3 of the inventory plan this compared nothing when the bag touched the ability
 * the block is built from, because Incudo had nowhere to put the item and the two numbers
 * were honestly answering different questions. One of the nine saves is that case — a Wizard
 * 12 with a Tome of Clear Thought equipped — and it now agrees. See docs/AURORA-SAVE-FORMAT.md
 * for what that does and does not prove.
 */
function compareSpellcasting(
  block: AuroraSpellcasting,
  derived: DerivedCharacter,
  byId: Map<ElementId, Element>,
  stats: typeof DEFAULT_STATS,
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

  compareSlots(block, derived, stats, where, differences);

  if (block.dc === undefined && block.attack === undefined) return;
  if (!block.ability) return;

  const dcKey = stats.spellcasting.dc(block.name).toLowerCase();
  const attackKey = stats.spellcasting.attack(block.name).toLowerCase();
  const dc = derived.stats.get(dcKey)?.value;
  const attack = derived.stats.get(attackKey)?.value;

  // Nothing published means nothing to compare, and saying so is the honest answer for
  // every system that is not 5e. Until ADR 0020 this branch was the *only* possible one and
  // the file quietly took the other road: it rebuilt the DC from a base it carried itself.
  if (dc === undefined && attack === undefined) {
    differences.push({
      kind: 'not-modelled',
      message: `${where}: Aurora recorded a save DC of ${block.dc ?? '—'} and an attack bonus of ${block.attack ?? '—'}, but no loaded system publishes "${dcKey}" or "${attackKey}".`,
      expected: block.dc,
    });
    return;
  }

  if (block.dc !== undefined && dc !== undefined && dc !== block.dc) {
    differences.push({
      kind: 'stat-mismatch',
      message: `${where}: Aurora's save DC is ${block.dc}; Incudo publishes "${dcKey}" as ${dc}.`,
      expected: block.dc,
      actual: dc,
    });
  }

  if (block.attack !== undefined && attack !== undefined && attack !== block.attack) {
    differences.push({
      kind: 'stat-mismatch',
      message: `${where}: Aurora's spell attack bonus is ${block.attack}; Incudo publishes "${attackKey}" as ${attack}.`,
      expected: block.attack,
      actual: attack,
    });
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
