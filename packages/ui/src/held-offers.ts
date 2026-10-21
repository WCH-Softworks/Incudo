/**
 * What a set offers when it offers only what concerns the character, and what the derivation withdrew — ADR 0081, ADR
 * 0129, ADR 0072 decision 5.
 *
 * A set step (ADR 0032) may declare `gatedOnHeld`: it then offers an element only when one of its grants is gated on
 * something the character has, so a Ranger is offered the Ranger's optional class features and a character with no class
 * none. Until ADR 0129 this was an `equip` step's, whose answers were equipped bag entries; they are choices now, and
 * the step is an ordinary set. Nothing here names a game.
 */

import {
  type GrantRule,
  type RequirementExpr,
  type DerivedCharacter,
  type Element,
  type ElementId,
  type ElementIndex,
  type RequirementContext,
} from '@incudo/core';

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
