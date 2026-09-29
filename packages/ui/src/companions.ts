/**
 * The creatures a character holds, each as its own stat block — ADR 0073.
 *
 * The engine derives each held creature in a scope of its own (`DerivedCharacter.companions`); this reads the kind's
 * `companions` sections against that scope with core's `renderSheetSection`, so the Sheet pane renders rows and
 * computes nothing. Kind-agnostic: every label, stat and type comes from the system.
 */

import {
  renderSheetSection,
  type CompanionDerivation,
  type DerivedCharacter,
  type ElementId,
  type ElementIndex,
  type PrintedSheetLine,
  type ResolvedCharacterKind,
  type SheetReader,
  type SheetSectionDef,
} from '@incudo/core';

/** A stat row, labelled and valued as the sheet shows it. */
export interface CompanionStatRow {
  stat: string;
  label: string;
  value: string;
}

/** One section of a creature's stat block, with nothing left to decide. */
export interface CompanionSection {
  id: string;
  label: string;
  description?: string;
  rows: CompanionStatRow[];
  printed: PrintedSheetLine[];
  elements: Array<{ elementId: ElementId; name: string }>;
}

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
  const labels = new Map<string, string>();
  for (const def of [...kind.stats, ...(declaration.stats ?? [])]) {
    if (def.label !== undefined) labels.set(def.name.toLowerCase(), def.label);
  }
  const creatures = derived.companions.map((scope) => creatureView(scope, derived, declaration.sheet ?? [], labels, index));
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
  labels: Map<string, string>,
  index: ElementIndex,
): CompanionView {
  const creature = scope.elements.find((e) => e.id === scope.elementId) ?? index.get(scope.elementId);
  const reader: SheetReader = {
    statValue: (key) => scope.stats.get(key.toLowerCase())?.value,
    elements: scope.elements,
  };
  const valueOf = (key: string): string => {
    const stat = scope.stats.get(key.toLowerCase());
    return stat ? (stat.text ?? String(stat.value)) : '—';
  };
  const sections: CompanionSection[] = [];
  for (const section of sheet) {
    for (const rendering of renderSheetSection(section, [], reader)) {
      const elements = scope.elements
        .filter((e) => rendering.types.includes(e.type))
        .map((e) => ({ elementId: e.id, name: e.name }));
      const rows = rendering.stats.map((stat) => ({ stat, label: labels.get(stat.toLowerCase()) ?? stat, value: valueOf(stat) }));
      if (!rows.length && !rendering.printed.length && !elements.length) continue;
      sections.push({
        id: rendering.id,
        label: rendering.label,
        ...(rendering.description !== undefined ? { description: rendering.description } : {}),
        rows,
        printed: rendering.printed,
        elements,
      });
    }
  }
  return {
    elementId: scope.elementId,
    name: creature?.name ?? scope.elementId,
    ...(creature?.source ? { source: creature.source } : {}),
    heldBy: heldBy(scope.elementId, derived),
    sections,
    notes: notesOf(scope),
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
