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

import type { CandidateNoteDef, Element } from '@incudo/core';

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

/** "Fireball (Level 3) — Player's Handbook"; the note and the source each appear only if there is one. */
export function candidateLabel(element: Element, notes: readonly CandidateNoteDef[] = []): string {
  const note = candidateNote(element, notes);
  const name = note ? `${element.name} (${note})` : element.name;
  return element.source ? `${name} — ${element.source}` : name;
}
