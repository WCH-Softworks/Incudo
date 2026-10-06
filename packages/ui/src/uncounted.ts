/**
 * Picks that no longer count, for a screen — ADR 0096.
 *
 * The engine keeps a pick in `character.choices` and stops seeding it when nothing the character holds opens its pool
 * any more (a class whose levels went to another, a level lowered below the one that opened it), or when the pool has
 * fewer slots than picks. Build lists them under one heading so the change is seen rather than silent, and the user may
 * forget them; nothing here forgets one on its own.
 *
 * Wording both shells share is here; the panes compute nothing.
 */

import { setChoice, type Character, type DerivedCharacter, type ElementId, type ElementIndex } from '@incudo/core';

/** One recorded pick that does not count. */
export interface UncountedItem {
  elementId: ElementId;
  /** Its name, or its id when nothing loaded declares it. */
  name: string;
  /** Where it sits in its record. */
  position: number;
}

/** The uncounted picks of one pool, named, with the sentence that says why. */
export interface UncountedRow {
  /** The record's key — pass it to `forgetUncounted`. */
  ruleKey: string;
  /** The choice's own name, from the key: "Cantrip (Wizard)". */
  label: string;
  /** The element whose choice it is, by name. */
  from: string;
  reason: 'closed' | 'over';
  /** Why, in a sentence. */
  note: string;
  items: UncountedItem[];
}

/** The heading and the line under it, worded once for both shells. */
export const UNCOUNTED_HEADING = 'Not counting';
export const UNCOUNTED_HINT =
  'Chosen earlier for something this character no longer has, or for more slots than a choice has now. ' +
  'They stay recorded and count again if that comes back. Forget one to remove it.';

/** What follows the label of a select key: `<owner>/select:<name>` → `<name>`. */
function labelOf(ruleKey: string): string {
  const at = ruleKey.indexOf('/select:');
  return at < 0 ? ruleKey : ruleKey.slice(at + '/select:'.length);
}

/**
 * Every pool with an uncounted pick, in the order the records are kept. The sentence says which of three things
 * happened: nothing held offers the choice, the element that offers it does not at this point, or it offers fewer.
 */
export function uncountedRows(derived: DerivedCharacter, elements: ElementIndex): UncountedRow[] {
  const nameOf = (id: ElementId): string => elements.get(id)?.name ?? id;
  const rows = new Map<string, UncountedRow>();
  for (const pick of derived.uncounted) {
    let row = rows.get(pick.ruleKey);
    if (!row) {
      const from = nameOf(pick.from);
      const label = labelOf(pick.ruleKey);
      const room =
        derived.answeredChoices.find((c) => c.ruleKey === pick.ruleKey)?.chosen.length ??
        derived.pendingChoices.find((c) => c.ruleKey === pick.ruleKey)?.number;
      const note =
        pick.reason === 'over'
          ? `${label} has room for ${room ?? 'fewer'} now; these are past it.`
          : derived.elementIds.has(pick.from)
            ? `${from} does not offer ${label} at this point.`
            : // Not "<from> is not on this character": the element is often a feature many classes share by name
              // (every caster's "Spellcasting"), and a character holding another of them would read it as false.
              'Nothing on this character offers this choice now.';
      row = { ruleKey: pick.ruleKey, label, from, reason: pick.reason, note, items: [] };
      rows.set(pick.ruleKey, row);
    }
    row.items.push({ elementId: pick.elementId, name: nameOf(pick.elementId), position: pick.position });
  }
  return [...rows.values()];
}

/**
 * The character with uncounted picks of one record forgotten: every one, or the one at `position`. What counts is
 * untouched; a record left empty goes. The user's action, never the builder's own.
 */
export function forgetUncounted(
  character: Character,
  derived: DerivedCharacter,
  ruleKey: string,
  position?: number,
): Character {
  const positions = new Set(
    derived.uncounted
      .filter((pick) => pick.ruleKey === ruleKey && (position === undefined || pick.position === position))
      .map((pick) => pick.position),
  );
  if (!positions.size) return character;
  const record = character.choices.find((choice) => choice.ruleKey === ruleKey);
  if (!record) return character;
  return setChoice(
    character,
    ruleKey,
    record.elementIds.filter((_, at) => !positions.has(at)),
  );
}

/** A record's picks that count, in record order: what a pool's decision shows as chosen. */
export function countedPicks(character: Character, derived: DerivedCharacter, ruleKey: string): ElementId[] {
  const record = character.choices.find((choice) => choice.ruleKey === ruleKey)?.elementIds ?? [];
  const skipped = new Set(derived.uncounted.filter((pick) => pick.ruleKey === ruleKey).map((pick) => pick.position));
  return record.filter((_, at) => !skipped.has(at));
}

/**
 * What a pool's record becomes when a screen answers it with `elementIds`, the picks that count: those, then the
 * record's uncounted picks, kept at the end where they wait for a slot. A screen never sees an uncounted pick as a slot,
 * so an edit of the pool must not drop one it did not show — only `forgetUncounted` does. One the screen passed back
 * itself is not kept twice.
 */
export function withUncounted(
  character: Character,
  derived: DerivedCharacter,
  ruleKey: string,
  elementIds: readonly ElementId[],
): ElementId[] {
  const record = character.choices.find((choice) => choice.ruleKey === ruleKey)?.elementIds ?? [];
  const waiting = derived.uncounted
    .filter((pick) => pick.ruleKey === ruleKey && record[pick.position] === pick.elementId)
    .map((pick) => pick.elementId)
    .filter((id) => !elementIds.includes(id));
  return [...elementIds, ...waiting];
}

/** The words beside a slot whose answer fits none of the choice's slots. */
export function unplacedNote(name: string): string {
  return `${name} is not something this choice offers this character now.`;
}
