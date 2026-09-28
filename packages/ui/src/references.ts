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
 *
 * What content does state is where a text is printed: a summoning spell's description embeds its creature's stat block
 * (ADR 0069). So what the character's own elements print, of a type the kind keeps, is suggested first (ADR 0070): a
 * player character holding Summon Beast is offered the Bestial Spirit by name, beside the spell that prints it. A
 * suggestion is derived on every read and recorded nowhere; nothing is kept until the user keeps it.
 */

import {
  descriptionEmbeds,
  type Character,
  type Element,
  type ElementId,
  type ElementIndex,
  type ResolvedCharacterKind,
} from '@incudo/core';

import { expandDescription, MAX_EMBED_DEPTH } from './description.ts';

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
  /**
   * Its description, when it is shown, with what it embeds put in place from the same index (ADR 0069,
   * `expandDescription`). Not yet safe to render: the shell sanitizes it.
   */
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
  /** What its own elements print that it could keep and does not, by name. Empty for a kind that keeps none. */
  suggestions: ReferenceSuggestion[];
}

/** One element the character's own elements print, of a type the kind keeps, offered and not kept. */
export interface ReferenceSuggestion {
  elementId: ElementId;
  name: string;
  /** The book it names, when it names one. */
  source?: string;
  /** The names of the held elements whose text prints it, directly or inside something they print, in the order held. */
  printedIn: string[];
}

/** The heading references are shown under when the kind names none. */
export const DEFAULT_REFERENCES_LABEL = 'For reference';

/**
 * `held` is what the character holds, the derivation's elements: the suggestions are what their descriptions print.
 * Left out, there are none.
 */
export function referencesState(
  character: Character,
  kind: ResolvedCharacterKind,
  elements: ElementIndex,
  held: readonly Element[] = [],
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
        ? { description: expandDescription(element, elements) }
        : { note: `This kind of character does not keep a ${element.type} for reference, so it is not shown.` }),
    };
  });
  return {
    available: declared !== undefined,
    label: declared?.label ?? DEFAULT_REFERENCES_LABEL,
    ...(declared?.description ? { description: declared.description } : {}),
    rows,
    suggestions: referenceSuggestions(character, kind, elements, held),
  };
}

/**
 * What the held elements' descriptions embed, and what those embed in turn as far as a description is shown
 * (`MAX_EMBED_DEPTH`), of a type the kind keeps, offered to the character (`elements` is the offered view, ADR 0049)
 * and not already kept. Read with core's `descriptionEmbeds`, the one reader of the marker. By name, each once, with
 * every held element that prints it.
 */
export function referenceSuggestions(
  character: Character,
  kind: ResolvedCharacterKind,
  elements: ElementIndex,
  held: readonly Element[],
): ReferenceSuggestion[] {
  const types = kind.references?.types ?? [];
  if (!types.length || !held.length) return [];
  const offered = new Set(types.flatMap((type) => elements.byType(type)).map((element) => element.id));
  const kept = new Set(character.references ?? []);
  const found = new Map<ElementId, { element: Element; printedIn: string[] }>();

  // `depth` is how deep `from` is: an element a held one embeds is at 1, and `expandDescription` shows the text of
  // every embed down to `MAX_EMBED_DEPTH`. The limit also ends a circle, so none is looked for.
  const walk = (from: Pick<Element, 'description'>, holder: Element, depth: number): void => {
    if (depth >= MAX_EMBED_DEPTH) return;
    for (const { id } of descriptionEmbeds(from.description)) {
      const target = elements.get(id);
      if (!target) continue;
      if (offered.has(id) && !kept.has(id)) {
        const entry = found.get(id) ?? { element: target, printedIn: [] };
        if (!entry.printedIn.includes(holder.name)) entry.printedIn.push(holder.name);
        found.set(id, entry);
      }
      walk(target, holder, depth + 1);
    }
  };
  for (const element of held) walk(element, element, 0);

  return [...found.values()]
    .sort(
      (a, b) =>
        a.element.name.localeCompare(b.element.name) ||
        (a.element.source ?? '').localeCompare(b.element.source ?? '') ||
        a.element.id.localeCompare(b.element.id),
    )
    .map(({ element, printedIn }) => ({
      elementId: element.id,
      name: element.name,
      ...(element.source ? { source: element.source } : {}),
      printedIn,
    }));
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
