/**
 * The creatures a character holds, each as its own stat block — ADR 0073.
 *
 * The engine derives each held creature in a scope of its own (`DerivedCharacter.companions`); this reads the kind's
 * `companions` sections against that scope with the sheet's own `sheetSections` (ADR 0074), so a creature's rows are
 * labelled, written and shown beside one another exactly as the character's are, and the Sheet pane renders rows and
 * computes nothing. Kind-agnostic: every label, stat and type comes from the system.
 */

import {
  type CompanionDerivation,
  type DerivedCharacter,
  type ElementId,
  type ElementIndex,
  type ResolvedCharacterKind,
  type SheetSectionDef,
} from '@incudo/core';

import { sheetSections, unfilledIn, type SheetRow, type SheetSectionView, type SheetVocabulary } from './sheet.ts';

/** A stat row, labelled and valued as the sheet shows it. */
export type CompanionStatRow = SheetRow;

/** One section of a creature's stat block, with nothing left to decide. */
export type CompanionSection = SheetSectionView;

/** One held creature. */
export interface CompanionView {
  elementId: ElementId;
  name: string;
  source?: string;
  /** What the character holds that gave it: the element whose choice holds it, or whose grant names it. */
  heldBy: string[];
  /** Its sections, in the kind's order, empty ones left out. */
  sections: CompanionSection[];
  /** What its stat block could not show, in plain words. */
  notes: string[];
  /** How many placeholders its sections' sheet lines name that nothing in its scope publishes (ADR 0076). */
  unfilled: number;
}

export interface CompanionsView {
  label: string;
  description?: string;
  creatures: CompanionView[];
}

/**
 * The held creatures' stat blocks, or undefined when the kind declares none or the character holds none.
 */
export function companionsView(
  derived: DerivedCharacter,
  kind: ResolvedCharacterKind,
  index: ElementIndex,
): CompanionsView | undefined {
  const declaration = kind.companions;
  if (!declaration || derived.companions.length === 0) return undefined;
  // A scope's stats are the kind's and the declaration's (ADR 0073), and a creature's sections iterate no blocks.
  const vocabulary: SheetVocabulary = { stats: [...kind.stats, ...(declaration.stats ?? [])], blockStats: [] };
  const creatures = derived.companions.map((scope) => creatureView(scope, derived, declaration.sheet ?? [], vocabulary, index));
  return {
    label: declaration.label ?? 'Companions',
    ...(declaration.description !== undefined ? { description: declaration.description } : {}),
    creatures,
  };
}

function creatureView(
  scope: CompanionDerivation,
  derived: DerivedCharacter,
  sheet: readonly SheetSectionDef[],
  vocabulary: SheetVocabulary,
  index: ElementIndex,
): CompanionView {
  const creature = scope.elements.find((e) => e.id === scope.elementId) ?? index.get(scope.elementId);
  // No blocks: a creature's sections are refused `perBlock` by the validator, so a scope's declared blocks are unread.
  const sections = sheetSections(sheet, { stats: scope.stats, elements: scope.elements, gateLevels: scope.gateLevels }, vocabulary);
  return {
    elementId: scope.elementId,
    name: creature?.name ?? scope.elementId,
    ...(creature?.source ? { source: creature.source } : {}),
    heldBy: heldBy(scope.elementId, derived),
    sections,
    notes: notesOf(scope),
    unfilled: unfilledIn(sections),
  };
}

/** The held elements that gave this creature: a recorded choice under one of their selects, or a grant of theirs. */
function heldBy(creatureId: ElementId, derived: DerivedCharacter): string[] {
  const held = new Map(derived.elements.map((e) => [e.id, e]));
  const names: string[] = [];
  const add = (id: ElementId): void => {
    const name = held.get(id)?.name;
    if (name !== undefined && !names.includes(name)) names.push(name);
  };
  for (const choice of derived.character.choices) {
    if (!choice.elementIds.includes(creatureId)) continue;
    const at = choice.ruleKey.indexOf('/select:');
    if (at > 0) add(choice.ruleKey.slice(0, at));
  }
  for (const element of derived.elements) {
    if (element.rules.some((rule) => rule.kind === 'grant' && rule.id === creatureId)) add(element.id);
  }
  return names;
}

/** What the scope found, said without ids: a feature it names that nothing loaded declares is the one the corpus has. */
function notesOf(scope: CompanionDerivation): string[] {
  const missing = scope.problems.filter((p) => p.code === 'unresolved-element').length;
  const notes: string[] = [];
  if (missing === 1) notes.push('One feature this creature names is not in any loaded source.');
  else if (missing > 1) notes.push(`${missing} features this creature names are not in any loaded source.`);
  for (const problem of scope.problems) if (problem.code !== 'unresolved-element') notes.push(problem.message);
  return notes;
}
