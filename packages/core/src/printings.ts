/**
 * Two elements that are one thing printed in two books — ADR 0125.
 *
 * An element's id is its printing: the Player's Handbook's Acid Splash and the 2024 one are two elements, and either
 * may differ from the other, so a list shows both. What is the same is the thing itself: a character who knows Acid
 * Splash does not learn it again from another book. Content says so only for some feats, languages and proficiencies
 * (an element's own requirement that the character not hold the other printing) and never for a spell, so the system
 * says which types are one thing by name: an element type declaring `identifiedByName`. Two elements of such a type are
 * printings of one thing when their names match, ignoring case and surrounding space, and their books differ. Within one
 * book a name repeated is never a reprint: the Player's Handbook prints Elemental Adept five times on purpose, so it can
 * be taken five times.
 *
 * Nothing here names a game. What reads it decides what follows: a pool does not offer another printing of what the
 * character holds, and a character holding two is warned, never changed.
 */

import type { Element, ElementType } from './model.ts';
import type { GameSystem } from './system.ts';

/** The element types the system says are one thing by name, across books. */
export function printingTypes(system: Pick<GameSystem, 'elementTypes'>): ReadonlySet<ElementType> {
  return new Set(system.elementTypes.filter((type) => type.identifiedByName).map((type) => type.name));
}

/** What every printing of one thing shares, or undefined for an element of a type not identified by name. */
export function printingKey(element: Element, types: ReadonlySet<ElementType>): string | undefined {
  if (!types.has(element.type)) return undefined;
  const name = element.name.trim().toLowerCase();
  return name ? `${element.type}\u0000${name}` : undefined;
}

const book = (element: Element): string => element.source.trim().toLowerCase();

/** Whether two elements are two printings of one thing: two ids, one key, two books. */
export function isOtherPrinting(a: Element, b: Element, types: ReadonlySet<ElementType>): boolean {
  if (a.id === b.id || book(a) === book(b)) return false;
  const key = printingKey(a, types);
  return key !== undefined && key === printingKey(b, types);
}

/** What a set of elements holds, asked by printing. */
export class HeldPrintings {
  private readonly byKey = new Map<string, Element[]>();
  readonly types: ReadonlySet<ElementType>;

  constructor(held: Iterable<Element>, types: ReadonlySet<ElementType>) {
    this.types = types;
    if (!types.size) return;
    for (const element of held) {
      const key = printingKey(element, types);
      if (key === undefined) continue;
      const group = this.byKey.get(key);
      if (group) group.push(element);
      else this.byKey.set(key, [element]);
    }
  }

  /** The held elements that are another printing of `element`; empty when none is, or its type is not identified. */
  otherPrintings(element: Element): Element[] {
    const key = printingKey(element, this.types);
    if (key === undefined) return [];
    return (this.byKey.get(key) ?? []).filter((held) => isOtherPrinting(held, element, this.types));
  }

  /** Every thing held from more than one book, its printings in the order held. */
  heldTwice(): Element[][] {
    const out: Element[][] = [];
    for (const group of this.byKey.values()) {
      if (new Set(group.map(book)).size > 1) out.push(group);
    }
    return out;
  }
}
