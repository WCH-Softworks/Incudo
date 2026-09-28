/**
 * What a character keeps beside it as a reference, and what it could keep — ADR 0068.
 *
 * A DM building an NPC by hand next to a stat block that exists only as prose (the 2025 Monster Manual's Kraken, say):
 * the text is shown beside the character and saved with it, and nothing is worked out from it. Everything the section
 * shows is decided here, under `node --test`: which types the kind keeps, what each kept element is (shown, not
 * loaded, not a type this kind keeps), and what could still be kept. The pane renders this and computes nothing but
 * making the description safe to show.
 *
 * Nothing here recognises a stat block. The corpus states none as such: they are elements of a type that also holds
 * rules text, set apart only by the shape of their prose (the measurement is `tools/verify`'s
 * `stat-block-references.test.ts`), so every element of the kind's types is offered and the user searches.
 */

import type { Character, ElementId, ElementIndex, GameSystem, ResolvedCharacterKind } from '@incudo/core';

/** One element the character keeps beside it. */
export interface ReferenceRow {
  elementId: ElementId;
  /** Its name, or its id when nothing loaded or embedded declares it. */
  name: string;
  /** The book it names, when it names one. */
  source?: string;
  /** Its type, or '' when nothing declares it. */
  type: string;
  /** Whether loaded or embedded content declares it. */
  known: boolean;
  /** Whether it is shown: known, and of a type the kind keeps. */
  shown: boolean;
  /** Its description as content wrote it, when it is shown. Not yet safe to render: the shell sanitizes it. */
  description?: string;
  /** A sentence for the row when it is not shown. */
  note?: string;
}

export interface ReferencesState {
  /** Whether a character of this kind keeps references at all. */
  available: boolean;
  /** The heading they are shown under. */
  label: string;
  /** The kind's own words on what keeping one means, where it has any. */
  description?: string;
  /** What the character keeps, in the order chosen. */
  rows: ReferenceRow[];
}

const DEFAULT_LABEL = 'For reference';

export function referencesState(
  character: Character,
  kind: ResolvedCharacterKind,
  elements: ElementIndex,
): ReferencesState {
  const declared = kind.references;
  const types = new Set(declared?.types ?? []);
  const rows = [...new Set(character.references ?? [])].map((id): ReferenceRow => {
    const element = elements.get(id);
    if (!element) {
      return {
        elementId: id,
        name: id,
        type: '',
        known: false,
        shown: false,
        note: 'Not in the loaded content. Load the content it came from to see it.',
      };
    }
    const allowed = types.has(element.type);
    return {
      elementId: id,
      name: element.name,
      ...(element.source ? { source: element.source } : {}),
      type: element.type,
      known: true,
      shown: allowed,
      ...(allowed
        ? { description: element.description ?? '' }
        : { note: `This kind of character does not keep a ${element.type} for reference, so it is not shown.` }),
    };
  });
  return {
    available: declared !== undefined,
    label: declared?.label ?? DEFAULT_LABEL,
    ...(declared?.description ? { description: declared.description } : {}),
    rows,
  };
}

/**
 * What could still be kept: every element of the kind's types the character is offered, less what it keeps, by name.
 * Empty for a kind that keeps none.
 *
 * `elements` is the offered view (ADR 0049): a book switched off for this character offers nothing here either.
 */
export function referenceOptions(
  character: Character,
  kind: ResolvedCharacterKind,
  elements: ElementIndex,
): ElementId[] {
  const kept = new Set(character.references ?? []);
  return (kind.references?.types ?? [])
    .flatMap((type) => elements.byType(type))
    .filter((element) => !kept.has(element.id))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.source ?? '').localeCompare(b.source ?? '') || a.id.localeCompare(b.id))
    .map((element) => element.id);
}
