/**
 * What an offered or chosen candidate lacks of the prerequisites its kind makes soft — ADR 0124.
 *
 * A kind's `softRequirements` lists types (5e: Spell) whose requirement terms do not keep a candidate out of a choice:
 * an Eldritch Invocation that needs the Eldritch Blast cantrip is offered to a warlock who has not taken it, and the
 * picker says what is missing. The engine offers it (`candidatesFor`); this words the warning, read off the derivation
 * and never stored. A chosen one is asked as it was before it was held, as the engine's `requirement-unmet` asks it.
 */

import {
  requirementContextFor,
  softRequirementTerms,
  softShortfalls,
  type DerivedCharacter,
  type ElementId,
  type ElementIndex,
  type ResolvedCharacterKind,
} from '@incudo/core';

/**
 * Each candidate short of a soft prerequisite, with the ways it could be met: one list of the missing elements per way,
 * the shortest first. A candidate that lacks nothing soft is left out.
 */
export function softShortfallsOf(
  ids: readonly ElementId[],
  derived: DerivedCharacter,
  kind: ResolvedCharacterKind,
  elements: ElementIndex,
): Map<ElementId, ElementId[][]> {
  const out = new Map<ElementId, ElementId[][]>();
  const soft = softRequirementTerms(kind, elements);
  if (!soft || !ids.length) return out;
  const context = requirementContextFor(derived);
  for (const id of ids) {
    const element = elements.get(id);
    if (!element?.requirements) continue;
    // Asked as before it was held: "does not already have this" must not fail because a chosen one now is.
    const before = { ...context, hasElement: (other: string) => other !== id && context.hasElement(other) };
    const ways = softShortfalls(element.requirements, before, soft).filter((way) => way.length > 0);
    if (ways.length) out.set(id, ways);
  }
  return out;
}

/** "Needs Eldritch Blast, which this character does not have": one way's names joined by "and", the ways by "or". */
export function softShortfallNote(ways: readonly (readonly ElementId[])[], elements: ElementIndex): string {
  const nameOf = (id: ElementId): string => elements.get(id)?.name ?? id;
  const worded = [...new Set(ways.map((way) => join([...new Set(way.map(nameOf))], 'and')))];
  return `Needs ${join(worded, 'or')}, which this character does not have`;
}

/** Every warned candidate's line, for a picker to show under its name. */
export function softShortfallNotes(
  ids: readonly ElementId[],
  derived: DerivedCharacter,
  kind: ResolvedCharacterKind,
  elements: ElementIndex,
): Map<ElementId, string> {
  const notes = new Map<ElementId, string>();
  for (const [id, ways] of softShortfallsOf(ids, derived, kind, elements)) notes.set(id, softShortfallNote(ways, elements));
  return notes;
}

function join(parts: readonly string[], word: 'and' | 'or'): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} ${word} ${parts.at(-1)}`;
}
