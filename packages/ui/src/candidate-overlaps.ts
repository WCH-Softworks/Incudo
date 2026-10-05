/**
 * What a candidate would give that the character already has: a background's Perception for an Elf who has it from
 * Keen Senses. A pool never offers what the character holds (the engine leaves it out); this is the step after, what
 * an offered candidate grants in turn, so a picker can mark the redundant ones before the player chooses.
 *
 * Read from content, not derived: deriving the character once per candidate would cost a derivation for each of a
 * race list's 139 rows. The walk follows a candidate's own `<grant>`s, and the grants of what they grant, as far as
 * they go, and what a kind's setters give (`setterGrantIds`, a creature's traits). A grant gated on a level above the
 * one the candidate would be taken at is not followed, and one whose requirements are false against the character as it
 * stands is not either; a requirement naming something only the candidate brings reads false there, which can only
 * leave a mark out, never add a wrong one. `tools/verify`'s `candidate-overlaps.test.ts` measures how often that matters.
 *
 * Which types are worth naming is the system's (`candidateOverlaps` on a kind): an element nobody chooses and nobody
 * reads on its own (an internal marker) is held twice harmlessly. A kind declaring none marks nothing. Core is not asked
 * anything new: this reads the derivation's held set, its requirement context and the content index.
 */

import {
  evaluateRequirements,
  requirementContextFor,
  setterGrantIds,
  type DerivedCharacter,
  type Element,
  type ElementId,
  type ElementIndex,
  type ResolvedCharacterKind,
} from '@incudo/core';

/** What one candidate would give that is already held, of the types the kind names, in the order the walk met them. */
export type CandidateOverlaps = ReadonlyMap<ElementId, readonly ElementId[]>;

export interface OverlapOptions {
  /**
   * The level a gated grant is compared with: the level the candidate would be taken at. A grant gated above it is not
   * followed. Absent, every grant is followed whatever its level.
   */
  level?: number;
  /** The types worth naming. Absent, the kind's `candidateOverlaps`; an explicit list is for measuring. */
  types?: readonly string[];
  /** Read grants' requirements against the character (the default). False follows every grant; for measuring. */
  requirements?: boolean;
}

/**
 * For each candidate that would give something `held` already holds, what that is. A candidate giving nothing held is
 * not in the map. `held` is the character the candidate is offered to: for a slot being changed, the character with
 * that slot's answer taken out, or everything the current answer gives would read as redundant.
 */
export function candidateOverlaps(
  candidates: readonly ElementId[],
  held: DerivedCharacter,
  kind: ResolvedCharacterKind,
  elements: ElementIndex,
  options: OverlapOptions = {},
): CandidateOverlaps {
  const types = new Set(options.types ?? kind.candidateOverlaps?.types ?? []);
  const result = new Map<ElementId, ElementId[]>();
  if (types.size === 0 || candidates.length === 0) return result;
  const context = options.requirements === false ? undefined : requirementContextFor(held);
  for (const candidate of candidates) {
    const found = reachedHeld(candidate, held, kind, elements, types, options.level, context);
    if (found.length) result.set(candidate, found);
  }
  return result;
}

function reachedHeld(
  candidate: ElementId,
  held: DerivedCharacter,
  kind: ResolvedCharacterKind,
  elements: ElementIndex,
  types: ReadonlySet<string>,
  level: number | undefined,
  context: ReturnType<typeof requirementContextFor> | undefined,
): ElementId[] {
  const found: ElementId[] = [];
  const seen = new Set<ElementId>([candidate]);
  const queue: ElementId[] = [candidate];
  while (queue.length) {
    const element = elements.get(queue.shift()!);
    if (!element) continue;
    for (const id of givenIds(element, kind, level, context)) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (held.elementIds.has(id)) {
        // Held, so what it gives is held too (or withdrawn for the character's own reasons): the walk stops here.
        const type = elements.get(id)?.type;
        if (type !== undefined && types.has(type)) found.push(id);
        continue;
      }
      queue.push(id);
    }
  }
  return found;
}

/** What an element would give: its `<grant>`s that apply at `level` and whose requirements hold, then its setter grants. */
function givenIds(
  element: Element,
  kind: ResolvedCharacterKind,
  level: number | undefined,
  context: ReturnType<typeof requirementContextFor> | undefined,
): ElementId[] {
  const ids: ElementId[] = [];
  for (const rule of element.rules) {
    if (rule.kind !== 'grant') continue;
    if (level !== undefined && rule.level !== undefined && rule.level > level) continue;
    if (context && !evaluateRequirements(rule.requirements, context)) continue;
    ids.push(rule.id);
  }
  ids.push(...setterGrantIds(kind.setterGrants, element));
  return ids;
}

/** How many names a note spells out before "and N more". */
const NAMED = 3;

/**
 * The words beside a marked candidate: "The character already has Perception", "… has Light Armor, Shields and Simple
 * Weapons", "… has A, B, C and 2 more". Names only, as the character's own elements are named, and no game's word for
 * what they are. Undefined when there is nothing to say.
 */
export function overlapNote(ids: readonly ElementId[] | undefined, elements: ElementIndex): string | undefined {
  if (!ids?.length) return undefined;
  const names = ids.map((id) => elements.get(id)?.name ?? id);
  if (names.length === 1) return `The character already has ${names[0]}`;
  if (names.length <= NAMED) return `The character already has ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `The character already has ${names.slice(0, NAMED).join(', ')} and ${names.length - NAMED} more`;
}

/** Every marked candidate's note, for a picker to show under its name. */
export function overlapNotes(marks: CandidateOverlaps, elements: ElementIndex): Map<ElementId, string> {
  const notes = new Map<ElementId, string>();
  for (const [candidate, ids] of marks) {
    const note = overlapNote(ids, elements);
    if (note) notes.set(candidate, note);
  }
  return notes;
}
