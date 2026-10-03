/**
 * What a build screen shows beside the builder's own state, worded once for every shell — ROADMAP Phase 6's build flow.
 *
 * The desktop's panes had kept a few of these to themselves: which options one slot of an answered select may change to,
 * which steps count as settled, how a decision's tags and a class option's reason read. The phone draws the same build,
 * so they moved here (CODE-REUSE-POLICY rule 2): two copies of a sentence drift, and one of these is a rule (two slots
 * never agreeing on one answer unless it repeats). Nothing here names a game.
 */

import type { ElementId, StatDef } from '@incudo/core';

import { scoreLabel, type ClassOption, type ScoreShortfall } from './multiclass.ts';
import type { PreparedItem } from './preparation.ts';
import type { BuilderState, BuilderStep, OpenDecision, SettledPick } from './use-character-builder.ts';

/**
 * What slot `index` of an answered decision may hold instead: its own answer, anything no other slot holds, and anything
 * that may be taken twice (ADR 0035: a +1 chosen in both slots is a +2). `pick.candidates` covers every slot; keeping two
 * slots from agreeing is this.
 */
export function slotOptions(pick: SettledPick, index: number): ElementId[] {
  const own = pick.chosen[index];
  return pick.candidates.filter(
    (candidate) => candidate === own || !pick.chosen.includes(candidate) || pick.repeatable.includes(candidate),
  );
}

/** `choose`'s answer when slot `index` changes to `next`. */
export function withSlot(pick: SettledPick, index: number, next: ElementId): ElementId[] {
  const chosen = [...pick.chosen];
  chosen[index] = next;
  return chosen;
}

/** `choose`'s answer when slot `index` of a set is taken back. Only a set (`pick.multiple`) may be emptied. */
export function withoutSlot(pick: SettledPick, index: number): ElementId[] {
  return pick.chosen.filter((_, at) => at !== index);
}

/**
 * Steps whose values are set and still editable: a budget nothing is outstanding on, and a step's per-level hit points
 * once nothing is left to record. A finished budget leaves `decisions`, and would take its editor with it otherwise.
 */
export function settledSteps(state: Pick<BuilderState, 'steps' | 'decisions'>): BuilderStep[] {
  const open = (kind: OpenDecision['kind'], stepId: string): boolean =>
    state.decisions.some((decision) => decision.kind === kind && decision.stepId === stepId);
  return state.steps.filter(
    (step) =>
      (step.budget !== undefined && !open('budget', step.id)) ||
      (step.hitPoints !== undefined && step.hitPoints.levels.length > 0 && !open('hitpoints', step.id)),
  );
}

/**
 * The tags beside an open decision's label, in the order a screen shows them: "optional", "2 left" (never for a set,
 * which has no count to run down), "opened at 4" (in the granting element's own track, ADR 0015).
 */
export function decisionTags(decision: OpenDecision): string[] {
  const tags: string[] = [];
  if (!decision.blocking) tags.push('optional');
  if (!decision.multiple) tags.push(decision.remaining > 0 ? `${decision.remaining} left` : 'all recorded');
  if (decision.openedAt !== undefined) tags.push(`opened at ${decision.openedAt}`);
  return tags;
}

/** What a step's line says of it: "complete", "2 open", or what it waits for. */
export function stepStatus(step: BuilderStep, labelOf: (stepId: string) => string = (id) => id): string {
  if (!step.available) return `needs ${step.blockedBy.map(labelOf).join(', ')}`;
  return step.complete ? 'complete' : `${step.openCount} open`;
}

/** The scores a class asks for and the character lacks: "Strength 13 (you have 10) or Dexterity 13 (you have 8)". */
export function shortfallText(flag: ScoreShortfall[][], stats: ReadonlyArray<StatDef>): string {
  return flag
    .map((terms) => terms.map((term) => `${scoreLabel(stats, term.stat)} ${term.needs} (you have ${term.has})`).join(' and '))
    .join(' or ');
}

/** Why a class may not be taken, or nothing when it may (ADR 0045: a score minimum alone does not stop it). */
export function unavailableReason(option: ClassOption, labelOf: (id: ElementId) => string): string | undefined {
  if (option.eligible) return undefined;
  if (option.unavailable === 'no-multiclass-rules') return 'cannot be taken as an additional class';
  if (option.unavailable === 'excluded' && option.excludedBy) return `cannot be combined with ${labelOf(option.excludedBy)}`;
  return option.prerequisite ? `needs ${option.prerequisite}` : 'requirements not met';
}

/** A class level's options as a screen groups them: the character's classes, those it may add, those it may not. */
export function classOptionGroups(options: readonly ClassOption[]): {
  taken: ClassOption[];
  available: ClassOption[];
  unavailable: ClassOption[];
} {
  return {
    taken: options.filter((option) => option.taken),
    available: options.filter((option) => !option.taken && option.eligible),
    unavailable: options.filter((option) => !option.taken && !option.eligible),
  };
}

/** A prepared list's line for one spell: "Shield (Level 1)". */
export function preparedItemText(item: PreparedItem): string {
  return item.note ? `${item.name} (${item.note})` : item.name;
}
