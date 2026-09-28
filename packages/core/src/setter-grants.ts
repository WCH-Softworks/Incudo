/**
 * Elements a held element's setter names, which the kind says its holder has — ADR 0058.
 *
 * A creature names its traits and actions as comma-separated ids in a setter and grants none of them. A
 * kind's `setterGrants` says which setter, on which element types, is a grant; the engine reaches what it
 * names exactly as it reaches a `<grant>`, and `collectCharacterContent` embeds it. Both call this function,
 * so what a character derives and what its save holds cannot drift apart (ADR 0012). The same kind declaration
 * says which elements are holders, whose gifts, named or granted, a user may take away (ADR 0061, ADR 0067).
 */

import type { Element, ElementId } from './model.ts';
import type { SetterGrantDef } from './system.ts';

/**
 * The ids an element's declared setters name, in the order written, each once.
 *
 * Split on commas and trimmed, nothing more: three ids upstream end in a stray `>` and are declared with
 * it, so a reader that matched an id pattern would drop three real attacks. Whether an id resolves is the
 * caller's question, answered the way a dangling `<grant>` is. What the character removed (ADR 0061) is left
 * out.
 */
export function setterGrantIds(
  defs: readonly SetterGrantDef[],
  element: Element,
  removed?: ReadonlySet<ElementId>,
): ElementId[] {
  if (defs.length === 0) return [];
  const ids: ElementId[] = [];
  const seen = new Set<ElementId>();
  for (const def of defs) {
    if (!def.types.includes(element.type)) continue;
    const text = findSetter(element, def.setter);
    if (text === undefined) continue;
    for (const part of text.split(',')) {
      const id = part.trim();
      if (id === '' || seen.has(id)) continue;
      seen.add(id);
      if (removed?.has(id)) continue;
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Whether the kind says this element is a holder: its type is one a declared setter is read on (ADR 0058). Only a
 * holder gives what a user may take away (ADR 0061, ADR 0067). A kind that declares no `setterGrants` has none, so
 * nothing a player character holds, a class or a class feature, is ever one.
 */
export function isGrantHolder(defs: readonly SetterGrantDef[], element: Element): boolean {
  return defs.some((def) => def.types.includes(element.type));
}

/**
 * Everything a holder gives: the ids its declared setters name, then the ids of its own `<grant>`s, each once, in
 * the order written — ADR 0067. Empty for an element that is not a holder. A grant is listed whether or not its level
 * or requirements hold today, since removing it is a statement about the creature, not about this moment; what a
 * removed one leaves out is the caller's (`removed`).
 */
export function holderGivenIds(
  defs: readonly SetterGrantDef[],
  element: Element,
  removed?: ReadonlySet<ElementId>,
): ElementId[] {
  if (!isGrantHolder(defs, element)) return [];
  const ids = setterGrantIds(defs, element);
  const seen = new Set(ids);
  for (const rule of element.rules) {
    if (rule.kind !== 'grant' || seen.has(rule.id)) continue;
    seen.add(rule.id);
    ids.push(rule.id);
  }
  return removed?.size ? ids.filter((id) => !removed.has(id)) : ids;
}

/**
 * Which of the ids the character removed this element gives — ADR 0061, widened by ADR 0067.
 *
 * A removal cancels what the holder gives, however it gives it: by naming it in a declared setter, or by a `<grant>`
 * of its own, which is how a user's file gives a creature its legendary actions and how twelve corpus creatures give
 * again what their setters name. The engine and `collectCharacterContent` skip the holder's own grants of these ids,
 * and nothing else's: an element that is not a holder withdraws nothing, whatever the character records.
 */
export function withdrawnGrantIds(
  defs: readonly SetterGrantDef[],
  element: Element,
  removed: ReadonlySet<ElementId>,
): ReadonlySet<ElementId> {
  if (removed.size === 0) return NONE;
  const withdrawn = new Set(holderGivenIds(defs, element).filter((id) => removed.has(id)));
  return withdrawn.size ? withdrawn : NONE;
}

const NONE: ReadonlySet<ElementId> = new Set();

/** A setter by name, compared without case, as every other setter name is read. */
function findSetter(element: Element, name: string): string | undefined {
  const exact = element.setters[name];
  if (exact) return exact.value;
  const lower = name.toLowerCase();
  for (const [key, setter] of Object.entries(element.setters)) {
    if (key.toLowerCase() === lower) return setter.value;
  }
  return undefined;
}
