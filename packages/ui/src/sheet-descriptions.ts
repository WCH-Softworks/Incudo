/**
 * The sheet's Descriptions part — ADR 0114: the whole text of every element a describing section lists, after the sheet.
 * A section says it describes (`describe`); what is listed, and which hidden elements are left out, is the section's own
 * listing. Read through the index the character is shown from, so a save reopened with no source shows what it embeds,
 * and expanded as Browse expands a description (ADR 0069). Names no game.
 */

import type { ElementId, ElementIndex } from '@incudo/core';

import type { CompanionsView } from './companions.ts';
import { expandDescription } from './description.ts';
import type { SheetSectionView } from './sheet.ts';

export interface SheetDescriptionEntry {
  elementId: ElementId;
  name: string;
  /** The description as content wrote it, embeds expanded; not safe HTML until the shell sanitizes it. */
  html: string;
}

export interface SheetDescriptionGroup {
  /** The section's label, or "<creature>: <section>" for a held creature's. */
  label: string;
  entries: SheetDescriptionEntry[];
}

export interface SheetDescriptions {
  label: string;
  groups: SheetDescriptionGroup[];
}

export const DESCRIPTIONS_LABEL = 'Descriptions';

/** The part, or undefined when no describing section lists an element with a description. */
export function sheetDescriptions(
  sections: readonly SheetSectionView[],
  companions: Pick<CompanionsView, 'creatures'> | undefined,
  elements: ElementIndex,
): SheetDescriptions | undefined {
  const seen = new Set<ElementId>();
  const groups: SheetDescriptionGroup[] = [];
  const add = (label: string, section: SheetSectionView): void => {
    if (!section.describe) return;
    const entries: SheetDescriptionEntry[] = [];
    // What the section folded into an entry (ADR 0126) is described beside it: the chooser it answers, then the entry,
    // then the answers and what it includes that the section listed on its own before.
    const named = section.elements.flatMap((listed) => [
      ...(listed.answering ? [listed.answering] : []),
      { elementId: listed.elementId, name: listed.name },
      ...(listed.answers ?? []).filter((answer) => answer.listed),
      ...(listed.includes ?? []),
    ]);
    for (const listed of named) {
      if (seen.has(listed.elementId)) continue;
      const element = elements.get(listed.elementId);
      const html = element ? expandDescription(element, elements).trim() : '';
      if (!html) continue;
      seen.add(listed.elementId);
      entries.push({ elementId: listed.elementId, name: element?.name ?? listed.name, html });
    }
    if (entries.length) groups.push({ label, entries });
  };
  for (const section of sections) add(section.label, section);
  for (const creature of companions?.creatures ?? []) {
    for (const section of creature.sections) add(`${creature.name}: ${section.label}`, section);
  }
  return groups.length ? { label: DESCRIPTIONS_LABEL, groups } : undefined;
}
