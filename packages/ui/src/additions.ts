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
  collectDeclaredBlocks,
  evaluateRequirements,
  requirementContextFor,
  type Character,
  type DerivedCharacter,
  type ElementId,
  type ElementIndex,
  type GameSystem,
  type ResolvedCharacterKind,
} from '@incudo/core';

import { PREREQUISITES_UNMET } from './sheet-document.ts';

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
  /**
   * Which block it is cast through, for an element of a type the kind casts through one (ADR 0097): the choice a row
   * offers, the blocks the character holds and none. Absent for any other row, and for one not held.
   */
  block?: AddedRowBlock;
}

/** A declared block the character holds, as a choice offers it. */
export interface BlockOption {
  /** The lowercased block name: what `setAdditionBlock` takes and `Character.additionBlocks` records. */
  key: string;
  /** Its name as content wrote it ("Wizard"). */
  name: string;
}

/** The choice of block on an added row — ADR 0097. */
export interface AddedRowBlock {
  /** The kind's heading for the choice ("Cast as"). */
  label: string;
  /** The recorded block's key, or '' for none. A recorded block the character no longer holds is still its value. */
  value: string;
  /** The blocks the character holds, in the order its elements declare them, then a recorded one it does not. */
  options: Array<BlockOption & { held: boolean; label: string }>;
  /** The kind's words for none, the choice's first option. */
  none: string;
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
  const missing = new Map(
    derived.problems.filter((p) => p.code === 'addition-block-missing' && p.elementId).map((p) => [p.elementId!, p.message]),
  );
  const casting = declared?.blocks;
  const blocks = casting ? heldBlocks(derived) : [];
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
    const held = derived.elementIds.has(id);
    const note =
      refused.get(id) ??
      missing.get(id) ??
      (met ? undefined : 'Its prerequisites are not met. It is on the character anyway.');
    const block = held && casting && casting.types.includes(element.type) ? rowBlock(casting, blocks, character.additionBlocks?.[id]) : undefined;
    return {
      elementId: id,
      name: element.name,
      type: element.type,
      known: true,
      held,
      prerequisitesMet: met,
      ...(note ? { note } : {}),
      ...(block ? { block } : {}),
    };
  });
  return {
    available: declared !== undefined,
    types,
    ...(declared?.description ? { description: declared.description } : {}),
    rows,
  };
}

/** The declared blocks the character holds, once each by lowercased name, in the order its elements declare them. */
export function heldBlocks(derived: Pick<DerivedCharacter, 'elements'>): BlockOption[] {
  const out = new Map<string, BlockOption>();
  for (const block of collectDeclaredBlocks(derived.elements)) {
    const key = block.name.trim().toLowerCase();
    if (!out.has(key)) out.set(key, { key, name: block.name });
  }
  return [...out.values()];
}

function rowBlock(
  casting: NonNullable<NonNullable<ResolvedCharacterKind['additions']>['blocks']>,
  blocks: BlockOption[],
  recorded: string | undefined,
): AddedRowBlock {
  const options = blocks.map((b) => ({ ...b, held: true, label: b.name }));
  // A recorded block the character no longer holds stays the value, so the choice shows what is recorded.
  if (recorded !== undefined && !blocks.some((b) => b.key === recorded)) {
    options.push({ key: recorded, name: recorded, held: false, label: `${recorded} (no longer on the character)` });
  }
  return { label: casting.label, value: recorded ?? '', options, none: casting.none };
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

/** The heading the section is shown under. */
export const ADDITIONS_HEADING = 'Added to this character';

/** What the add list says when a type has nothing left to offer. */
export const NO_ADDITION_OPTIONS = 'Nothing of this type is loaded that the character does not already have.';

/** The type choice that offers every type the kind lists at once. */
export const ALL_ADDITION_TYPES = 'All of these';

/** A group of added rows, under the label the system gives a list of that type. */
export interface AdditionGroup {
  label: string;
  rows: AddedRow[];
}

/**
 * What was added, grouped as a screen lists it: under each type the kind lists, in its order, then anything of another
 * type (not loaded, or no longer allowed) under "Other". Empty groups are left out.
 */
export function additionGroups(state: Pick<AdditionsState, 'types' | 'rows'>): AdditionGroup[] {
  const listed = new Set(state.types.map((t) => t.type));
  const groups: AdditionGroup[] = state.types.map((t) => ({
    label: t.label,
    rows: state.rows.filter((row) => row.type === t.type),
  }));
  groups.push({ label: 'Other', rows: state.rows.filter((row) => !listed.has(row.type)) });
  return groups.filter((group) => group.rows.length > 0);
}

/** An option's line in the add list: its label, and that its prerequisites do not hold when they do not. */
export function additionOptionLabel(label: string, option: Pick<AdditionOption, 'prerequisitesMet'>): string {
  return option.prerequisitesMet ? label : `${label} · ${PREREQUISITES_UNMET}`;
}
