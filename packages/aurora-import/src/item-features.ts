/**
 * Options Aurora's content writes as items, converted into what they are — ADR 0129.
 *
 * Aurora's app cannot switch a rule on for one character, so its content does it with an item the user equips "to enable
 * it" and that the inventory hides: Tasha's optional class features, and Aurora's own additional features and ability
 * score adjustments. Incudo can, so the converter gives each its own type, named in Incudo's words, and drops what only
 * the workaround needed: the `slot` and `inventory-hidden` setters and the paragraph telling the user to equip it. Ids and
 * names stay (ADR 0119 decision 2). Found by `category`, the one thing that sets these apart; nothing in content names any
 * of them.
 *
 * The importer records a save's equipped entry of one as a choice under the step key below, the way campaign options are
 * recorded under `build/options`. The keys are the 5e system definition's step ids for these types.
 */

import type { Element, ElementId } from '@incudo/core';

export interface ItemFeatureFamily {
  /** The `category` value Aurora's content writes on the item. */
  category: string;
  /** The element type the converter gives it. */
  type: string;
  /** The rule key an imported save's equipped one is recorded under. */
  ruleKey: string;
}

export const ITEM_FEATURE_FAMILIES: readonly ItemFeatureFamily[] = [
  { category: 'Optional Class Features', type: 'Optional Class Feature', ruleKey: 'build/optional-features' },
  { category: 'Additional Feature', type: 'Additional Feature', ruleKey: 'build/additional-features' },
  { category: 'Additional Ability Score Improvement', type: 'Ability Score Adjustment', ruleKey: 'build/ability-adjustments' },
];

/** The family an element of a converted type belongs to, or undefined. */
export function itemFeatureFamilyOf(type: string): ItemFeatureFamily | undefined {
  return ITEM_FEATURE_FAMILIES.find((family) => family.type === type);
}

/** Setters that only said "an item, hidden, in no real slot". */
const WORKAROUND_SETTERS = new Set(['slot', 'inventory-hidden']);

/** Aurora's opening paragraph, "You can equip this item to “enable” it. It remains hidden from the inventory…". */
const EQUIP_PARAGRAPH = /^\s*<p>\s*<i>\s*You can equip this item to[\s\S]*?<\/p>\s*/i;

/**
 * The element as an option, when it is an `Item` of one of the families; otherwise the element itself, untouched. A
 * family is matched by `category`, ignoring case and surrounding space.
 */
export function asItemFeature(element: Element): Element {
  if (element.type !== 'Item') return element;
  const category = Object.entries(element.setters).find(([name]) => name.toLowerCase() === 'category')?.[1]?.value;
  const family = category && ITEM_FEATURE_FAMILIES.find((f) => f.category.toLowerCase() === category.trim().toLowerCase());
  if (!family) return element;
  const setters = Object.fromEntries(Object.entries(element.setters).filter(([name]) => !WORKAROUND_SETTERS.has(name.toLowerCase())));
  const description = element.description?.replace(EQUIP_PARAGRAPH, '').trim();
  const converted: Element = { ...element, type: family.type, setters, description: description || undefined };
  if (converted.description === undefined) delete converted.description;
  return converted;
}

/**
 * What Aurora's app put in a save's bag for something a character was simply given, and what Incudo records instead —
 * ADR 0129 decision 6. The app materializes these and no file declares them; content says the Intelligence one is the
 * same as its own `ID_INTERNAL_ITEM_ASI_INTELLIGENCE_INCREASE_1`, so it is that, taken as an ability score adjustment. A
 * language is added to the character as the language itself (ADR 0064).
 */
export const ITEM_PROXY_REPLACEMENTS: ReadonlyMap<ElementId, { kind: 'choice'; ruleKey: string; id: ElementId } | { kind: 'addition'; id: ElementId }> =
  new Map([
    ['ID_PHB_INTERNAL_ITEM_PROXY_ASI_INTELLIGENCE', { kind: 'choice', ruleKey: 'build/ability-adjustments', id: 'ID_INTERNAL_ITEM_ASI_INTELLIGENCE_INCREASE_1' }],
    ['ID_PHB_INTERNAL_ITEM_LANGUAGE_PROXY_LANGUAGE_GNOMISH', { kind: 'addition', id: 'ID_LANGUAGE_GNOMISH' }],
    ['ID_PHB_INTERNAL_ITEM_LANGUAGE_PROXY_LANGUAGE_ORC', { kind: 'addition', id: 'ID_LANGUAGE_ORC' }],
  ]);
