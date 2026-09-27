/**
 * What the user added to a character from loaded content, and what could be added — ADR 0064.
 *
 * A guard resistant to fire, or a feat given to a villain whatever its prerequisites. Everything the section shows is
 * worked out here, under `node --test`: which types the kind lets be added, what each added element is doing (held,
 * flagged, not loaded, not allowed), and what could still be added with whether its prerequisites hold. The pane
 * renders this and computes nothing.
 *
 * Whether an added element's prerequisites hold is read from the derivation's own `requirement-unmet` problem, not
 * asked again here, so the row and the problems list cannot disagree. An option not yet added is asked with the
 * engine's own requirement context, as every other offer is.
 */

import {
  evaluateRequirements,
  requirementContextFor,
  type Character,
  type DerivedCharacter,
  type ElementId,
  type ElementIndex,
  type GameSystem,
  type ResolvedCharacterKind,
} from '@incudo/core';

/** A type that may be added, named as the system names a list of them. */
export interface AdditionType {
  type: string;
  label: string;
}

/** One element the user added. */
export interface AddedRow {
  elementId: ElementId;
  /** Its name, or its id when nothing loaded or embedded declares it. */
  name: string;
  /** Its type, or '' when nothing declares it. */
  type: string;
  /** Whether loaded or embedded content declares it. */
  known: boolean;
  /** Whether the character holds it. Not when the kind does not let its type be added, or nothing declares it. */
  held: boolean;
  /** Whether its own prerequisites hold, asked as they would have been before it was added. */
  prerequisitesMet: boolean;
  /** A sentence for the row when it is not simply held. */
  note?: string;
}

export interface AdditionsState {
  /** Whether a character of this kind may have anything added. */
  available: boolean;
  /** What may be added, in the kind's order. */
  types: AdditionType[];
  /** The kind's own words on what adding means, where it has any. */
  description?: string;
  /** What was added, in the order added. */
  rows: AddedRow[];
}

/** Something that could be added. */
export interface AdditionOption {
  elementId: ElementId;
  type: string;
  /** Whether its own prerequisites hold for the character as it is. It is offered either way. */
  prerequisitesMet: boolean;
}

export function additionsState(
  character: Character,
  derived: DerivedCharacter,
  kind: ResolvedCharacterKind,
  system: GameSystem,
  elements: ElementIndex,
): AdditionsState {
  const declared = kind.additions;
  const types = (declared?.types ?? []).map((type): AdditionType => {
    const def = system.elementTypes.find((t) => t.name === type);
    return { type, label: def?.plural ?? def?.name ?? type };
  });
  const unmet = new Set(
    derived.problems.filter((p) => p.code === 'requirement-unmet' && p.elementId).map((p) => p.elementId!),
  );
  const refused = new Map(
    derived.problems.filter((p) => p.code === 'addition-not-allowed' && p.elementId).map((p) => [p.elementId!, p.message]),
  );
  const rows = [...new Set(character.additions ?? [])].map((id): AddedRow => {
    const element = elements.get(id);
    if (!element) {
      return {
        elementId: id,
        name: id,
        type: '',
        known: false,
        held: false,
        prerequisitesMet: true,
        note: 'Not in the loaded content. Load the content it came from to see it and use it.',
      };
    }
    const met = !unmet.has(id);
    const note = refused.get(id) ?? (met ? undefined : 'Its prerequisites are not met. It is on the character anyway.');
    return {
      elementId: id,
      name: element.name,
      type: element.type,
      known: true,
      held: derived.elementIds.has(id),
      prerequisitesMet: met,
      ...(note ? { note } : {}),
    };
  });
  return {
    available: declared !== undefined,
    types,
    ...(declared?.description ? { description: declared.description } : {}),
    rows,
  };
}

/**
 * What could still be added, of one declared type or of every one: every element of it the character is offered,
 * whatever its own requirements say, less what the character already holds (an addition it holds included). By name within a type, in
 * the kind's order of types. Empty for a type the kind does not list.
 *
 * `elements` is the offered view (ADR 0049): a book switched off for this character offers nothing here either.
 */
export function additionOptions(
  derived: DerivedCharacter,
  kind: ResolvedCharacterKind,
  elements: ElementIndex,
  type?: string,
): AdditionOption[] {
  const declared = kind.additions?.types ?? [];
  const types = type === undefined ? declared : declared.filter((t) => t === type);
  const context = requirementContextFor(derived);
  const out: AdditionOption[] = [];
  for (const t of types) {
    const offered = elements
      .byType(t)
      .filter((element) => !derived.elementIds.has(element.id))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    for (const element of offered) {
      out.push({
        elementId: element.id,
        type: t,
        prerequisitesMet: evaluateRequirements(element.requirements, context),
      });
    }
  }
  return out;
}
