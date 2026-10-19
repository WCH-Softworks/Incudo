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
