/**
 * The words on a source's line for what it refers to that no enabled source contains (ADR 0052), and which of the
 * sources the user switched off had it when they were last loaded (ADR 0090). The desktop's Sources pane renders this
 * and composes no sentence.
 *
 * Said, never acted on: nothing is switched on for the user and nothing is blocked. A switched-off source is named only
 * for what its record of its last load holds, never because it "usually" supplies something, and the sentence says it
 * is that load being described. An id no switched-off source declared (AuroraLegacy's one upstream misspelling) is in
 * the list and under no name.
 */

import type { MissingContent, SwitchedOffSupply } from '@incudo/content';

export interface SwitchedOffNote {
  sourceId: string;
  /** "Core, which is switched off, had 112 of them when it was last loaded." */
  sentence: string;
  /** What it had, references first and then addition targets, each once. */
  ids: string[];
}

export interface MissingNoteView {
  /** "Refers to 110 things none of your enabled sources contain, and 2 of its additions … have nothing to add to." */
  summary: string;
  /** Ids its grants and select defaults name that nothing enabled declares. */
  references: string[];
  /** What its waiting additions are for, each once. */
  additions: string[];
  /** The switched-off sources that had some of it, in the profile's order. */
  switchedOff: SwitchedOffNote[];
}

const count = (n: number, one: string, many: string): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The note for a source's line; `undefined` when it misses nothing. `nameOf` gives a source's name as the list shows it. */
export function missingNote(
  missing: MissingContent,
  switchedOff: readonly SwitchedOffSupply[] | undefined,
  nameOf: (sourceId: string) => string,
): MissingNoteView | undefined {
  const references = missing.references;
  const additions = [...new Set(missing.additions)];
  if (!references.length && !missing.additions.length) return undefined;

  const things = count(references.length, 'thing', 'things');
  const waiting = missing.additions.length;
  const adds = `${waiting.toLocaleString()} of its additions to other content ${waiting === 1 ? 'has' : 'have'} nothing to add to`;
  const summary = references.length
    ? `Refers to ${things} none of your enabled sources contain${waiting ? `, and ${adds}` : ''}.`
    : `${adds.charAt(0).toUpperCase()}${adds.slice(1)}.`;

  // An id can be both a reference and an addition's target (the 2014 Player's Handbook grants the armour proficiencies
  // it also appends to), and is one thing missing.
  const total = new Set([...references, ...additions]).size;
  const notes = (switchedOff ?? []).map((supply): SwitchedOffNote => {
    const ids = [...new Set([...supply.references, ...supply.additions])];
    const had = ids.length === total ? (total === 1 ? 'it' : 'all of them') : `${ids.length.toLocaleString()} of them`;
    return {
      sourceId: supply.sourceId,
      sentence: `${nameOf(supply.sourceId)}, which is switched off, had ${had} when it was last loaded.`,
      ids,
    };
  });
  return { summary, references, additions, switchedOff: notes };
}
