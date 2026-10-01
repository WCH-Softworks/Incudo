/**
 * A build step whose answers are equipped bag entries — ADR 0072.
 *
 * Some content is taken by equipping it: 5e's optional class features are items a character equips to enable them, and
 * Aurora records one as it records a sword, an item in the bag. A step that declares `equip` offers the elements of its
 * types whose setter reads one of its values, and what it has taken is read back from the bag, so an imported character
 * that equips one has it taken and a character built here saves the record an import would have made.
 *
 * Everything is worked out here, under `node --test`: what the step offers, what it has taken, and the two writes. The
 * builder publishes the step as a set (ADR 0032) and routes `choose` for its key here; the pane renders a set as it
 * renders any other and computes nothing. Nothing here names a game: the setter and its values are the system's.
 */

import {
  evaluateRequirements,
  type GrantRule,
  type RequirementExpr,
  newInstanceId,
  removeInventoryEntry,
  setInventoryEntry,
  type BuildStepDef,
  type Character,
  type DerivedCharacter,
  type Element,
  type ElementId,
  type ElementIndex,
  type InventoryEntry,
  type RequirementContext,
} from '@incudo/core';

/** Whether a build step's answers are equipped bag entries. */
export function isEquipStep(step: BuildStepDef): boolean {
  return step.equip !== undefined;
}

/** Whether an element is one the step offers to equip: of its types, and its setter reads one of its values. */
export function equipAdmits(step: BuildStepDef, element: Element): boolean {
  const def = step.equip;
  if (!def || !step.types.includes(element.type)) return false;
  const setter = def.setter.toLowerCase();
  const found = Object.entries(element.setters).find(([name]) => name.toLowerCase() === setter)?.[1];
  if (!found) return false;
  const value = found.value.trim().toLowerCase();
  return def.values.some((v) => v.trim().toLowerCase() === value);
}

/**
 * Whether a term of a requirement, not under a `not`, names something the character has: a stat it publishes above
 * zero, or an element it holds — ADR 0081. Not whether the requirement holds: a Fighter 1 has `level:fighter`, so a
 * feature gated on `level:fighter >= 4` concerns it now and gives it something at 4.
 */
export function requirementConcerns(expr: RequirementExpr | undefined, context: RequirementContext): boolean {
  if (!expr) return false;
  switch (expr.kind) {
    case 'and':
    case 'or':
      return expr.children.some((child) => requirementConcerns(child, context));
    case 'has':
      return context.hasElement(expr.id);
    case 'atLeast':
      return context.statNumber(expr.stat) > 0;
    default:
      return false;
  }
}

/** Whether one of an element's grants is gated on something the character has (`gatedOnHeld`, ADR 0081). */
export function grantsConcern(element: Element, context: RequirementContext): boolean {
  return element.rules.some((rule): boolean => rule.kind === 'grant' && requirementConcerns((rule as GrantRule).requirements, context));
}

/**
 * What the step could put on the character: every element it admits, from `elements` (the offered view, ADR 0049, so a
 * book switched off offers nothing), whose own requirements hold, as any step's offer is filtered, and, when the step
 * says so, one of whose grants concerns the character (ADR 0081). By name. What the character already holds is the
 * caller's to leave out, as it is for a set of choices.
 */
export function equipOffer(step: BuildStepDef, elements: ElementIndex, context: RequirementContext): ElementId[] {
  const gated = step.equip?.gatedOnHeld === true;
  return step.types
    .flatMap((type) => elements.byType(type))
    .filter(
      (element) =>
        equipAdmits(step, element) && evaluateRequirements(element.requirements, context) && (!gated || grantsConcern(element, context)),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((element) => element.id);
}

/**
 * What the step has taken: the elements of the equipped bag entries it admits, once each, in bag order. An entry whose
 * element nothing loaded or embedded declares cannot be read and is not listed, and neither is a carried one: carried,
 * the item does nothing (ADR 0024 decision 7).
 */
export function equipTaken(character: Character, step: BuildStepDef, elements: ElementIndex): ElementId[] {
  const taken: ElementId[] = [];
  for (const entry of character.inventory ?? []) {
    if (!entry.equipped || taken.includes(entry.elementId)) continue;
    const element = elements.get(entry.elementId);
    if (element && equipAdmits(step, element)) taken.push(entry.elementId);
  }
  return taken;
}

/** Whether an entry records nothing but the element and that it is equipped: removing it loses nothing anyone wrote. */
function isBare(entry: InventoryEntry): boolean {
  return (
    (entry.quantity === undefined || entry.quantity === 1) &&
    entry.slot === undefined &&
    !entry.attuned &&
    !entry.adorners?.length &&
    !entry.name?.trim() &&
    !entry.notes?.trim()
  );
}

/**
 * Take elements back: every equipped entry of each is removed when it records nothing else, and only unequipped when it
 * does (a quantity, a slot, attunement, an adornment, a name or notes), so nothing a user or an import wrote is lost.
 */
export function planEquipRemove(character: Character, ids: readonly ElementId[]): Character {
  let next = character;
  for (const entry of character.inventory ?? []) {
    if (!entry.equipped || !ids.includes(entry.elementId)) continue;
    next = isBare(entry) ? removeInventoryEntry(next, entry.instanceId) : setInventoryEntry(next, { ...entry, equipped: false });
  }
  return next;
}

/**
 * Take elements: a carried entry of one is equipped if the bag has one, and otherwise a new entry is added, equipped,
 * at the end of the bag. `newId` mints the entry's id and is injected for a test; the builder uses core's.
 */
export function planEquipAdd(
  character: Character,
  ids: readonly ElementId[],
  newId: () => string = newInstanceId,
): Character {
  let next = character;
  for (const id of ids) {
    const carried = next.inventory?.find((entry) => entry.elementId === id && !entry.equipped);
    next = setInventoryEntry(next, carried ? { ...carried, equipped: true } : { instanceId: newId(), elementId: id, equipped: true });
  }
  return next;
}

/** One element the derivation withdrew because its own requirements are false (ADR 0071), named for a screen. */
export interface WithdrawnRow {
  elementId: ElementId;
  /** Its name, or its id when nothing declares it. */
  name: string;
  /** What granted it, by name, in the order the derivation found them. */
  grantedBy: string[];
}

/**
 * What the derivation withdrew, named — ADR 0072 decision 5. Taking a feature that replaces another withdraws the other,
 * and this is how Build says so rather than letting it disappear. Every withdrawal, not only a replaced feature's.
 */
export function withdrawnRows(derived: DerivedCharacter, elements: ElementIndex): WithdrawnRow[] {
  const nameOf = (id: ElementId): string => elements.get(id)?.name ?? id;
  return derived.withdrawn.map((w) => ({ elementId: w.elementId, name: nameOf(w.elementId), grantedBy: w.grantedBy.map(nameOf) }));
}
