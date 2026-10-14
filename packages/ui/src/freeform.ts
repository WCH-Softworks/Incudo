/**
 * The text a user writes about a character — ADR 0092.
 *
 * A kind declares its fields (`ResolvedCharacterKind.freeform`), each by the `Character.freeform` key it is kept under;
 * the keys are the ones the Aurora importer already writes, so an imported character's backstory is here with no change
 * to the importer. This is the editor's state and the sheet's part, both read from the kind and the character only:
 * nothing is derived, and an edit (`setFreeform`, core) re-derives nothing.
 *
 * A key the kind does not declare is never shown: an import also writes coins, an experience total and the row numbers of
 * list picks there, none of it for a page.
 */

import type { Character, ElementId, ResolvedCharacterKind } from '@incudo/core';

export interface FreeformFieldState {
  key: string;
  label: string;
  multiline: boolean;
  /** What is written, as typed; '' when nothing is. */
  value: string;
  /**
   * What stands in while nothing is typed: the chosen elements of the selects the field names (`suggestedBy`), one per
   * line. Absent when the field names none or none is chosen. Not stored: typing replaces it, and an editor shows it
   * as the field's text until then.
   */
  suggested?: string;
}

export interface FreeformGroupState {
  /** Undefined for fields the kind puts in no group. */
  label?: string;
  fields: FreeformFieldState[];
}

export interface FreeformState {
  /** False for a kind that declares no fields: there is nothing to write. */
  available: boolean;
  label: string;
  description?: string;
  groups: FreeformGroupState[];
}

/**
 * What a select's chosen elements read as, by the select's name: the names of the held elements recorded under any
 * `…/select:<name>` key, in the order chosen. Only held ones, so a pick that no longer counts (its background changed)
 * suggests nothing.
 */
export function chosenUnderSelect(
  character: Pick<Character, 'choices'>,
  held: ReadonlySet<ElementId>,
  nameOf: (id: ElementId) => string | undefined,
): (select: string) => string[] {
  return (select) => {
    const suffix = `/select:${select}`;
    const names: string[] = [];
    for (const choice of character.choices) {
      if (!choice.ruleKey.endsWith(suffix)) continue;
      for (const id of choice.elementIds) {
        const name = held.has(id) ? nameOf(id) : undefined;
        if (name !== undefined && !names.includes(name)) names.push(name);
      }
    }
    return names;
  };
}

/** The editor's state: every declared field, written or not, grouped as the kind groups them. */
export function freeformState(
  character: Pick<Character, 'freeform'>,
  kind: Pick<ResolvedCharacterKind, 'freeform'>,
  /** The names chosen under a select (`chosenUnderSelect`), for a field that declares `suggestedBy`. */
  chosen?: (select: string) => string[],
): FreeformState {
  const def = kind.freeform;
  if (!def) return { available: false, label: '', groups: [] };
  const groups: FreeformGroupState[] = [];
  for (const field of def.fields) {
    const state: FreeformFieldState = {
      key: field.key,
      label: field.label,
      multiline: field.multiline ?? false,
      value: character.freeform[field.key] ?? '',
    };
    const suggested = chosen && field.suggestedBy ? field.suggestedBy.flatMap(chosen).join('\n') : '';
    if (suggested !== '') state.suggested = suggested;
    const last = groups[groups.length - 1];
    if (last && last.label === field.group) last.fields.push(state);
    else groups.push({ ...(field.group !== undefined ? { label: field.group } : {}), fields: [state] });
  }
  return { available: true, label: def.label, ...(def.description !== undefined ? { description: def.description } : {}), groups };
}

/** One written field as a sheet shows it: its text trimmed, its line breaks kept. */
export interface SheetFreeformEntry {
  key: string;
  label: string;
  multiline: boolean;
  text: string;
}

export interface SheetFreeformGroup {
  label?: string;
  entries: SheetFreeformEntry[];
}

/** What a sheet shows of it: the fields with text, in the kind's order, empty groups left out. Undefined when none. */
export interface SheetFreeform {
  label: string;
  groups: SheetFreeformGroup[];
}

export function sheetFreeform(state: FreeformState): SheetFreeform | undefined {
  if (!state.available) return undefined;
  const groups: SheetFreeformGroup[] = [];
  for (const group of state.groups) {
    const entries = group.fields
      .map((field) => ({
        key: field.key,
        label: field.label,
        multiline: field.multiline,
        // What is typed, else what the character chose from its suggestions.
        text: writtenText(field.value) || writtenText(field.suggested ?? ''),
      }))
      .filter((entry) => entry.text !== '');
    if (entries.length) groups.push({ ...(group.label !== undefined ? { label: group.label } : {}), entries });
  }
  return groups.length ? { label: state.label, groups } : undefined;
}

/** Text as a sheet writes it: each line's trailing space gone, blank lines at either end gone, `\r` gone. */
function writtenText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}
