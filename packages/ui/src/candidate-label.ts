/**
 * The text a picker prints for one candidate: its name, a short note the system asks for, and the
 * book it came from.
 *
 * It was three lines in `BuilderPane.tsx` until a spell chooser needed to say what level each
 * spell is. The note is data (`candidateNotes` on a character kind), not something this file
 * knows: which setter carries a spell's level, and that level 0 reads "Cantrip", are the
 * system's to say (ADR 0003). It lives here rather than in the pane because a mobile shell will
 * print the same label (CODE-REUSE-POLICY rule 2), and because it is what a search matches — the
 * note is part of the label, so typing "cantrip" narrows a spell list to cantrips.
 *
 * The book is not decoration. The Class list offers every class twice, once from the Player's
 * Handbook and once from its 2024 revision, and Aasimar four times; names alone do not tell them
 * apart. The note goes between the two so the name and its source stay readable as before.
 */

import type { CandidateNoteDef, Element, ElementId, ElementIndex } from '@incudo/core';
import type { OfferGroup } from './inventory.ts';

/** The note for one element, or nothing when no declared note applies to it. */
export function candidateNote(
  element: Element,
  notes: readonly CandidateNoteDef[],
): string | undefined {
  for (const note of notes) {
    if (!note.types.includes(element.type)) continue;
    const value = element.setters[note.setter]?.value.trim();
    if (!value) continue;
    return note.labels?.[value] ?? note.label.replaceAll('{value}', value);
  }
  return undefined;
}

/** What a picker calls the candidates no grouping note reaches, listed after the groups. */
export const OTHER_CANDIDATES_LABEL = 'Other';
/** Where a picker that shows one group at a time (the phone's) lists every candidate, for a search across the groups. */
export const ALL_CANDIDATES_LABEL = 'All options';

/**
 * A list of candidates in groups, by the first note the kind declares with `groups` for each one's type: a spell list by
 * level, "Cantrip", "Level 1", "Level 2"… One group per value, in the values' order with their digits read as numbers,
 * each keeping the order it was given; what no such note reaches is "Other", last. Undefined when no note groups any of
 * them, or when they would all be in one group, which a heading would only repeat. The note's labels are the system's.
 */
export function candidateGroups(
  ids: readonly ElementId[],
  notes: readonly CandidateNoteDef[],
  index: ElementIndex,
): OfferGroup[] | undefined {
  const grouping = notes.filter((note) => note.groups);
  if (!grouping.length) return undefined;
  const groups = new Map<string, { value: string; label: string; options: ElementId[] }>();
  const other: ElementId[] = [];
  let grouped = false;
  for (const id of ids) {
    const element = index.get(id);
    const note = element ? grouping.find((each) => each.types.includes(element.type)) : undefined;
    const value = note ? element!.setters[note.setter]?.value.trim() : undefined;
    if (!note || !value) {
      other.push(id);
      continue;
    }
    grouped = true;
    const group = groups.get(value) ?? { value, label: note.labels?.[value] ?? note.label.replaceAll('{value}', value), options: [] };
    group.options.push(id);
    groups.set(value, group);
  }
  if (!grouped) return undefined;
  const ordered: OfferGroup[] = [...groups.values()]
    .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }))
    .map(({ label, options }) => ({ label, options }));
  if (other.length) ordered.push({ label: OTHER_CANDIDATES_LABEL, options: other });
  return ordered.length > 1 ? ordered : undefined;
}

/**
 * Decisions in the order of the lowest group their candidates fall in (ADR 0128): on the Spells tab a Wizard's cantrip
 * pool before its spellbook, though the cantrip pool opened at a later level. Stable, so decisions whose lowest group is
 * the same, or that no grouping note reaches (listed after the rest), keep the order the builder gave them; only the
 * candidates are read, so what must be answered still comes first when the caller splits the list afterwards.
 */
export function byLowestCandidateGroup<T extends { candidates: readonly ElementId[] }>(
  decisions: readonly T[],
  notes: readonly CandidateNoteDef[],
  index: ElementIndex,
): T[] {
  const grouping = notes.filter((note) => note.groups);
  if (!grouping.length) return [...decisions];
  const lowest = (decision: T): string | undefined => {
    let best: string | undefined;
    for (const id of decision.candidates) {
      const element = index.get(id);
      const note = element ? grouping.find((each) => each.types.includes(element.type)) : undefined;
      const value = note ? element!.setters[note.setter]?.value.trim() : undefined;
      if (value && (best === undefined || value.localeCompare(best, undefined, { numeric: true }) < 0)) best = value;
    }
    return best;
  };
  const keyed = decisions.map((decision, at) => ({ decision, at, value: lowest(decision) }));
  keyed.sort((a, b) => {
    if (a.value === undefined || b.value === undefined) return a.value !== undefined ? -1 : b.value !== undefined ? 1 : a.at - b.at;
    return a.value.localeCompare(b.value, undefined, { numeric: true }) || a.at - b.at;
  });
  return keyed.map((entry) => entry.decision);
}

/**
 * "Fireball (Level 3) — Player's Handbook"; the note and the source each appear only if there is one.
 *
 * Given the index, an element another of its type shares a name and a book with is told apart by what gives it (ADR
 * 0125): the Monster Manual (2025) prints a deer's Agile and a rat's, and "Agile (from Deer)" and "Agile (from Rat)"
 * are two rows a user can choose between where "Agile — Monster Manual (2025)" twice was not.
 */
export function candidateLabel(element: Element, notes: readonly CandidateNoteDef[] = [], index?: ElementIndex): string {
  const parts = [candidateNote(element, notes), index ? candidateGiver(element, index) : undefined].filter(
    (part): part is string => part !== undefined,
  );
  const name = parts.length ? `${element.name} (${parts.join('; ')})` : element.name;
  return element.source ? `${name} — ${element.source}` : name;
}

interface Givers {
  /** How many elements share each type, name and book. */
  shared: Map<string, number>;
  /** The name of the first element whose grant or setter names each id. */
  givenBy: Map<ElementId, string>;
}

const giversOf = new WeakMap<ElementIndex, Givers>();

const sharedKey = (element: Element): string =>
  `${element.type}\u0000${element.name.trim().toLowerCase()}\u0000${element.source.trim().toLowerCase()}`;

/**
 * "from Deer": what gives an element, when another element of its type, name and book exists and the row would read the
 * same as it. What gives it is the first element whose `<grant>` names it or whose setter lists its id (a creature's
 * traits); undefined when nothing does, or when the element is the only one of its name in its book. Built once per index.
 */
export function candidateGiver(element: Element, index: ElementIndex): string | undefined {
  let givers = giversOf.get(index);
  if (!givers) {
    givers = { shared: new Map(), givenBy: new Map() };
    for (const each of index.all()) {
      const key = sharedKey(each);
      givers.shared.set(key, (givers.shared.get(key) ?? 0) + 1);
    }
    for (const each of index.all()) {
      const named: ElementId[] = [];
      for (const rule of each.rules) if (rule.kind === 'grant') named.push(rule.id);
      for (const setter of Object.values(each.setters)) {
        for (const part of setter.value.split(',')) {
          const id = part.trim();
          if (id && id !== each.id && index.get(id)) named.push(id);
        }
      }
      for (const id of named) if (id !== each.id && !givers.givenBy.has(id)) givers.givenBy.set(id, each.name);
    }
    giversOf.set(index, givers);
  }
  if ((givers.shared.get(sharedKey(element)) ?? 0) < 2) return undefined;
  const giver = givers.givenBy.get(element.id);
  return giver ? `from ${giver}` : undefined;
}
