/**
 * The prepared-list view-model — ADR 0046.
 *
 * Everything a screen needs to let a player prepare and unprepare, and to say how many of how many, per
 * casting block: rows to render, the options to offer, and the two writes. It computes; the pane in
 * `apps/desktop` renders what this returns and works out nothing (CODE-REUSE-POLICY rule 2), the way
 * `multiclass.ts` does for classes.
 *
 * What is derived and what is written. The limit, what is always prepared, what counts and what is over
 * all come from the derivation (`DerivedCharacter.preparation`). The one thing written is the recorded
 * list, `Character.prepared`, and only two ways: put one on it, take one off. **Preparing refuses what the
 * block cannot prepare and does not refuse going past the limit** — the character is allowed to exist over
 * it and the row says by how much, the stance ADR 0045 took about ability scores, applied to a report.
 */

import {
  getPrepared,
  preparationPool,
  setPrepared,
  type Character,
  type DerivedCharacter,
  type Element,
  type ElementId,
  type ElementIndex,
  type PreparationMode,
  type PreparedBlock,
  type CandidateNoteDef,
} from '@incudo/core';
import { candidateNote } from './candidate-label.ts';

/** One element on or offered for a prepared list, with what a row prints for it. */
export interface PreparedItem {
  id: ElementId;
  name: string;
  /** The system's short fact about it (a spell's level), when a note applies. */
  note?: string;
  /** The book it came from, so two spells of one name from two editions can be told apart. */
  source?: string;
}

/** One casting block's prepared list, as a screen shows it. */
export interface PreparationRow {
  /** The key to pass to `prepare` and `unprepare`: the lowercased block name. */
  key: string;
  name: string;
  mode: PreparationMode;
  /** How many the player may prepare, not counting what is always prepared. */
  limit: number;
  /** How many the player has prepared that count. */
  count: number;
  /** `limit - count`, never below zero. */
  remaining: number;
  /** How many are past the limit. Zero at or under it; never a refusal. */
  over: number;
  /** Always prepared by content: shown, and not removable. */
  always: PreparedItem[];
  /** What the player prepared, in the order they added it. */
  chosen: PreparedItem[];
  /** Recorded on the list and not preparable by this block: shown so it can be taken off. */
  unavailable: PreparedItem[];
}

function itemFor(
  id: ElementId,
  derived: DerivedCharacter,
  elements: ElementIndex,
  notes: readonly CandidateNoteDef[],
): PreparedItem {
  const element: Element | undefined = derived.elements.find((e) => e.id === id) ?? elements.get(id);
  if (!element) return { id, name: id };
  return {
    id,
    name: element.name,
    note: candidateNote(element, notes),
    ...(element.source ? { source: element.source } : {}),
  };
}

/** Level-then-name order: the note reads "Level 1", "Level 2" and so on, and none is alphabetical trouble. */
function byNoteThenName(a: PreparedItem, b: PreparedItem): number {
  const note = (a.note ?? '').localeCompare(b.note ?? '', undefined, { numeric: true });
  return note !== 0 ? note : a.name.localeCompare(b.name);
}

/** One row per block that prepares, in the order the derivation found them. Empty for a kind with none. */
export function preparationRows(derived: DerivedCharacter, elements: ElementIndex): PreparationRow[] {
  const notes = derived.kind.candidateNotes;
  const items = (ids: ElementId[], sort: boolean): PreparedItem[] => {
    const out = ids.map((id) => itemFor(id, derived, elements, notes));
    return sort ? out.sort(byNoteThenName) : out;
  };
  return derived.preparation.map((block: PreparedBlock) => ({
    key: block.key,
    name: block.name,
    mode: block.mode,
    limit: block.limit,
    count: block.chosen.length,
    remaining: Math.max(0, block.limit - block.chosen.length),
    over: block.over,
    always: items(block.always, true),
    // The player's own order, so the list reads as it was made.
    chosen: items(block.chosen, false),
    unavailable: items(block.unavailable, false),
  }));
}

/**
 * What one block could still have prepared, level then name. Never something the character does not
 * have: a book offers what it holds, and a list offers what the block's filter admits from the content
 * loaded (or embedded in the save), less what is already on the list.
 */
export function preparationOptions(
  derived: DerivedCharacter,
  elements: ElementIndex,
  blockKey: string,
): PreparedItem[] {
  const notes = derived.kind.candidateNotes;
  return preparationPool(derived, elements, blockKey)
    .map((element) => itemFor(element.id, derived, elements, notes))
    .sort(byNoteThenName);
}

/**
 * The character with one more element on a block's list, or nothing when it is refused: no such
 * block, already on the list, or not something the block can prepare. Going past the limit is not a
 * refusal.
 */
export function planPrepare(
  character: Character,
  derived: DerivedCharacter,
  elements: ElementIndex,
  blockKey: string,
  id: ElementId,
): Character | undefined {
  const key = blockKey.trim().toLowerCase();
  const block = derived.preparation.find((b) => b.key === key);
  if (!block) return undefined;
  if (block.always.includes(id) || block.chosen.includes(id)) return undefined;
  if (!preparationPool(derived, elements, key).some((element) => element.id === id)) return undefined;
  return setPrepared(character, key, [...getPrepared(character, key), id]);
}

/**
 * The character with an element off a block's list. Taking off what is not on it changes nothing, and
 * what content makes always prepared is not on the recorded list to take off (`planUnprepare` leaves
 * the list alone, and `always` is not removable from a screen).
 */
export function planUnprepare(character: Character, blockKey: string, id: ElementId): Character {
  const key = blockKey.trim().toLowerCase();
  const list = getPrepared(character, key);
  if (!list.includes(id)) return character;
  return setPrepared(
    character,
    key,
    list.filter((entry) => entry !== id),
  );
}
