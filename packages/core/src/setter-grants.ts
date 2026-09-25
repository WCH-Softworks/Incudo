/**
 * Elements a held element's setter names, which the kind says its holder has — ADR 0058.
 *
 * A creature names its traits and actions as comma-separated ids in a setter and grants none of them. A
 * kind's `setterGrants` says which setter, on which element types, is a grant; the engine reaches what it
 * names exactly as it reaches a `<grant>`, and `collectCharacterContent` embeds it. Both call this function,
 * so what a character derives and what its save holds cannot drift apart (ADR 0012).
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
 * Which of the ids the character removed this element names in its declared setters — ADR 0061.
 *
 * A removal cancels what the holder gives, however it gives it: the corpus has twelve creatures that also carry
 * a `<grant>` of an id their setter names, and a removal that stopped only the setter would leave those twelve
 * held. The engine and `collectCharacterContent` skip the holder's own grants of these ids, and nothing else's.
 */
export function withdrawnGrantIds(
  defs: readonly SetterGrantDef[],
  element: Element,
  removed: ReadonlySet<ElementId>,
): ReadonlySet<ElementId> {
  if (removed.size === 0) return NONE;
  const named = setterGrantIds(defs, element);
  const withdrawn = new Set(named.filter((id) => removed.has(id)));
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
