/**
 * What the character is wearing, read through the system's own vocabulary — ADR 0025.
 *
 * The bag (ADR 0024) says *what* the character has. This says what is *in each slot*, which is
 * the question 78 rules in the Aurora corpus ask and which ADR 0021 parsed and could not answer.
 *
 * A slot publishes a **set of tags**, never one string. The corpus's twelve operands are three
 * different kinds of thing in one syntax:
 *
 *   [armor:heavy]                  the value of a setter the system names
 *   [primary:versatile]            the *presence* of one — the setter's value is a die
 *   [primary:double-bladed scimitar]   the element's own name
 *   [armor:any] / [armor:none]     occupied, or empty
 *
 * Nothing in this file is a suit of armour, a hand or a shield. Every one of those words is a
 * string the character kind supplies (ADR 0003).
 *
 * The whole thing is computed **once**, before the engine's fixed point starts, because slot
 * occupancy is a function of the character and the index and never of the derivation. That is
 * also why the tags do not live on a `ResolvedStat`: the stat map is rebuilt every pass, and a
 * condition reading it would be reading the pass before.
 */

import type { Character, InventoryEntry } from './character.ts';
import type { Element, ElementId, ElementIndex, StatKey } from './model.ts';
import type { InventoryDef, SlotDef } from './system.ts';

/** What occupies one published slot stat. */
export interface SlotOccupant {
  /** The bag entry that put it there. */
  instanceId: string;
  elementId: ElementId;
  /** The element's name, or the user's own name for this instance if it has one. */
  name: string;
  /** The slot id it was placed through — content's word, not the stat's. */
  slotId: string;
}

export type EquipmentIssueCode = 'slot-unknown' | 'slot-full' | 'unattuned';

export interface EquipmentIssue {
  code: EquipmentIssueCode;
  message: string;
  elementId?: ElementId;
  instanceId?: string;
}

/**
 * The resolved state of a character's slots, ready for the engine to read.
 *
 * A kind that declares no inventory produces {@link EMPTY_EQUIPMENT}: no tags, nothing
 * suppressed, and — the part that matters — `declared` false, which is what tells
 * `activeRules` to ignore `equipped=` instead of reading every condition as unmet.
 */
export interface EquipmentState {
  /** Whether the kind declared an inventory at all. */
  declared: boolean;
  /** Stat -> the tags it publishes. Lowercased keys; every declared slot stat has an entry. */
  tags: Map<StatKey, ReadonlySet<string>>;
  /** Stat -> what is in it, absent when the slot is empty. */
  occupants: Map<StatKey, SlotOccupant>;
  /** Elements whose rules do not apply for want of attunement — ADR 0023. */
  suppressed: Set<ElementId>;
  /**
   * How many attuned items the character is carrying — ADR 0023 decision 3.
   *
   * Counted per **entry**, not per element: Aurora carries one attunement flag per instance and
   * none per adorner (ADR 0024 decision 5), and that is also the rule. A Flame Tongue greatsword
   * is one attuned item, modelled here as a mundane host plus a magical adorner.
   */
  attunedCount: number;
  issues: EquipmentIssue[];
}

export const EMPTY_EQUIPMENT: EquipmentState = {
  declared: false,
  tags: new Map(),
  occupants: new Map(),
  suppressed: new Set(),
  attunedCount: 0,
  issues: [],
};

export interface ResolveEquipmentOptions {
  /**
   * Element ids the character has for a reason other than the bag — a choice, an advancement
   * entry, the kind's baseline. These are never suppressed.
   *
   * Nothing in the corpus needs this. It exists so that an id which happens to be both a class
   * feature and an unattuned magic item cannot silently delete the class feature.
   */
  exempt?: ReadonlySet<ElementId>;
}

/**
 * Read the bag through the kind's inventory declaration.
 *
 * Entries are walked in bag order, which is the order the user (or Aurora) put them in, and the
 * first item to reach a stat keeps it. Two things deliberately occupy nothing:
 *
 *  - **an item with no slot setter** — Aurora's three inventory proxies have none, and two of
 *    a set of real saves equip one, so this is a normal case and reports nothing;
 *  - **an adornment** — a Mithral Armor carries `slot="body"` of its own, and all 15 adornments
 *    across a set of real saves would otherwise have fought their hosts for a slot.
 */
export function resolveEquipment(
  character: Character,
  index: ElementIndex,
  declaration: InventoryDef | undefined,
  options: ResolveEquipmentOptions = {},
): EquipmentState {
  if (!declaration) return EMPTY_EQUIPMENT;

  const slots = new Map<string, SlotDef>();
  for (const slot of declaration.slots) slots.set(slot.id, slot);

  const occupants = new Map<StatKey, SlotOccupant>();
  const tags = new Map<StatKey, ReadonlySet<string>>();
  const issues: EquipmentIssue[] = [];

  // Every slot stat exists from the start, holding the empty tag. A slot nothing is in has to
  // answer `[armor:none]` with a yes, and a stat that simply is not there answers nothing.
  for (const slot of declaration.slots) {
    for (const stat of slot.stats ?? []) tags.set(stat.toLowerCase(), new Set([declaration.emptyTag.toLowerCase()]));
  }

  for (const entry of character.inventory ?? []) {
    if (!entry.equipped) continue;
    const element = index.get(entry.elementId);
    if (!element) continue; // Reported by the engine as an unresolved element.

    const slotId = entry.slot ?? element.setters[declaration.slotSetter]?.value.trim();
    if (!slotId) continue;

    const slot = slots.get(slotId);
    if (!slot) {
      issues.push({
        code: 'slot-unknown',
        message: `"${nameOf(entry, element)}" goes in the "${slotId}" slot, which this character kind does not declare. It is worn, and nothing reads it.`,
        elementId: element.id,
        instanceId: entry.instanceId,
      });
      continue;
    }

    // A slot that publishes nothing holds any number of things. That is not a shrug: 5e has no
    // rule about how many cloaks you may wear, and one of a set of real saves wears two.
    const candidates = (slot.stats ?? []).map((s) => s.toLowerCase());
    if (!candidates.length) continue;

    const stat = candidates.find((s) => !occupants.has(s));
    if (stat === undefined) {
      issues.push({
        code: 'slot-full',
        message: `"${nameOf(entry, element)}" wants the "${slot.id}" slot, and everything it could fill is already taken. Which one the character is really holding is not something the rules can work out.`,
        elementId: element.id,
        instanceId: entry.instanceId,
      });
      continue;
    }

    occupants.set(stat, {
      instanceId: entry.instanceId,
      elementId: element.id,
      name: nameOf(entry, element),
      slotId: slot.id,
    });
    tags.set(stat, tagsFor(element, declaration));
  }

  return {
    declared: true,
    tags,
    occupants,
    suppressed: suppressedByAttunement(character, index, declaration, issues, options.exempt),
    attunedCount: countAttuned(character, index, declaration),
    issues,
  };
}

/**
 * Equipped entries that are attuned and have something to be attuned *to*.
 *
 * The last clause is the one worth stating: a flag ticked on an item that needs no attunement is
 * not an attunement. It costs the character nothing under the limit, and counting it would make
 * a mundane rope eat one of three slots.
 */
function countAttuned(
  character: Character,
  index: ElementIndex,
  declaration: InventoryDef,
): number {
  const attunement = declaration.attunement;
  if (!attunement) return 0;
  const requires = attunement.requires.trim().toLowerCase();

  let count = 0;
  for (const entry of character.inventory ?? []) {
    if (!entry.equipped || !entry.attuned) continue;
    const ids = [entry.elementId, ...(entry.adorners ?? []).map((a) => a.elementId)];
    const needs = ids.some(
      (id) => index.get(id)?.setters[attunement.setter]?.value.trim().toLowerCase() === requires,
    );
    if (needs) count++;
  }
  return count;
}

/**
 * The tags one item publishes into the slot it occupies.
 *
 * The element's name is always one of them and needs no flag to turn on: an item's name is not
 * a game-specific noun, and `[primary:double-bladed scimitar]` is the corpus asking for it. The
 * *instance's* name is not, because a sword the user called "Swiftpursuit" is still a rapier.
 */
function tagsFor(element: Element, declaration: InventoryDef): ReadonlySet<string> {
  const tags = new Set<string>([declaration.occupiedTag.toLowerCase(), element.name.trim().toLowerCase()]);
  for (const setter of declaration.tagSetters ?? []) {
    const value = element.setters[setter]?.value.trim().toLowerCase();
    if (value) tags.add(value);
  }
  for (const setter of declaration.flagSetters ?? []) {
    if (element.setters[setter] !== undefined) tags.add(setter.trim().toLowerCase());
  }
  return tags;
}

/**
 * Elements the bag brings in whose rules do not apply for want of attunement — ADR 0023.
 *
 * A host and its adornment are gated separately and by the one flag, because Aurora has no
 * per-adorner attunement tag (ADR 0024 decision 5). That separation is what makes an unattuned
 * Flame Tongue greatsword a greatsword with no special case anywhere: the mundane weapon is a
 * different element and is never touched.
 *
 * An id that is attuned on *some* equipped instance is not suppressed on account of another —
 * a character carrying two of a thing has it working once.
 */
function suppressedByAttunement(
  character: Character,
  index: ElementIndex,
  declaration: InventoryDef,
  issues: EquipmentIssue[],
  exempt: ReadonlySet<ElementId> | undefined,
): Set<ElementId> {
  const attunement = declaration.attunement;
  if (!attunement) return new Set();

  const requires = attunement.requires.trim().toLowerCase();
  const needs = (element: Element | undefined): boolean =>
    element?.setters[attunement.setter]?.value.trim().toLowerCase() === requires;

  const attuned = new Set<ElementId>();
  const candidates = new Map<ElementId, { name: string; instanceId: string }>();

  for (const entry of character.inventory ?? []) {
    if (!entry.equipped) continue;
    for (const id of [entry.elementId, ...(entry.adorners ?? []).map((a) => a.elementId)]) {
      const element = index.get(id);
      if (!element || !needs(element)) continue;
      if (entry.attuned) attuned.add(id);
      else if (!candidates.has(id)) {
        candidates.set(id, { name: element.name, instanceId: entry.instanceId });
      }
    }
  }

  const suppressed = new Set<ElementId>();
  for (const [id, item] of candidates) {
    if (attuned.has(id) || exempt?.has(id)) continue;
    suppressed.add(id);
    issues.push({
      code: 'unattuned',
      message: `"${item.name}" requires attunement and is not attuned, so none of its rules apply. Attune to it, or expect the numbers it would have moved to be lower.`,
      elementId: id,
      instanceId: item.instanceId,
    });
  }
  return suppressed;
}

/** The user's own name for an instance, when they gave it one (ADR 0024 decision 6). */
function nameOf(entry: InventoryEntry, element: Element): string {
  return entry.name?.trim() || element.name;
}
