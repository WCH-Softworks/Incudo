/**
 * What an element asks the character to choose, written after its description wherever a description is shown on its
 * own (Browse, the picker and its preview).
 *
 * Found on the 2014 Battle Master's Combat Superiority, which says its maneuvers are "detailed under “Maneuvers”
 * below": in the book they follow the subclass, and in Aurora's content they are the options of the feature's own
 * `select`, which Aurora's app showed only as the choice. `tools/verify/src/description-pointers.test.ts` counts the
 * descriptions like it. The prose is never read: every element with a select gets the block, whatever its text says.
 *
 * The options are what the select's filter matches among everything loaded, read with no character: an element's own
 * requirements are not asked (a character may be offered fewer), and a filter naming something only a character
 * publishes (`$(…)`) is said to depend on the character rather than offering nothing. Names no game.
 */

import {
  matchesSupports,
  supportsInterpolations,
  type Element,
  type ElementId,
  type ElementIndex,
  type SelectRule,
} from '@incudo/core';

export interface ElementChoiceOption {
  id: ElementId;
  /** The name, with its book after it when another option shares the name. */
  label: string;
}

export interface ElementChoice {
  /** The select's name, or what selects offering the same options share once a trailing "(…)" is set aside. */
  label: string;
  /** How many, and from which level when content gates it, in content's order. */
  picks: { number: number; level?: number }[];
  /** Sorted by name. Empty when the options depend on the character. */
  options: ElementChoiceOption[];
  dependsOnCharacter: boolean;
}

/** Every choice the element's own rules open, selects offering the same options as one. */
export function elementChoices(element: Element, elements: ElementIndex): ElementChoice[] {
  const groups: { rules: SelectRule[]; options: ElementChoiceOption[]; dependsOnCharacter: boolean; key: string }[] = [];
  for (const rule of element.rules) {
    if (rule.kind !== 'select') continue;
    const dependsOnCharacter = supportsInterpolations(rule.supports).size > 0;
    const options = dependsOnCharacter ? [] : optionsOf(rule, elements);
    const key = `${rule.type}\n${dependsOnCharacter ? `?${rule.name}` : options.map((o) => o.id).join('\n')}`;
    const group = groups.find((g) => g.key === key);
    if (group) group.rules.push(rule);
    else groups.push({ rules: [rule], options, dependsOnCharacter, key });
  }
  return groups.map((group) => ({
    label: sharedLabel(group.rules.map((rule) => rule.name)),
    picks: group.rules.map((rule) => (rule.level === undefined ? { number: rule.number } : { number: rule.number, level: rule.level })),
    options: group.options,
    dependsOnCharacter: group.dependsOnCharacter,
  }));
}

/** "Choose 3, then 2 more at level 7 and 2 more at level 15, from 23 options:" */
export function elementChoiceLine(choice: ElementChoice): string {
  const picks = choice.picks.map(
    (pick, at) => `${pick.number}${at > 0 ? ' more' : ''}${pick.level === undefined ? '' : ` at level ${pick.level}`}`,
  );
  const rest = picks.slice(1);
  const how = rest.length
    ? `${picks[0]}, then ${rest.length > 1 ? `${rest.slice(0, -1).join(', ')} and ${rest[rest.length - 1]}` : rest[0]}`
    : picks[0]!;
  if (choice.dependsOnCharacter) return `Choose ${how}. The options depend on the character.`;
  if (!choice.options.length) return `Choose ${how}. Nothing loaded matches this choice.`;
  const of = choice.options.length === 1 ? '1 option' : `${choice.options.length} options`;
  return choice.picks.length > 1 || choice.picks[0]!.level !== undefined ? `Choose ${how}, from ${of}:` : `Choose ${how} of ${of}:`;
}

export const ELEMENT_CHOICES_LABEL = 'Choices';

function optionsOf(rule: SelectRule, elements: ElementIndex): ElementChoiceOption[] {
  const found = elements.byType(rule.type).filter(
    (candidate) =>
      !rule.supports ||
      matchesSupports(rule.supports, {
        tags: new Set(candidate.supports.map((tag) => tag.toLowerCase())),
        setterValues: new Set(Object.values(candidate.setters).map((s) => s.value.trim().toLowerCase())),
        id: candidate.id,
        resolve: () => undefined,
      }),
  );
  const unique = [...new Map(found.map((e) => [e.id, e])).values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id),
  );
  const named = new Map<string, number>();
  for (const e of unique) named.set(e.name, (named.get(e.name) ?? 0) + 1);
  return unique.map((e) => ({ id: e.id, label: (named.get(e.name) ?? 0) > 1 && e.source ? `${e.name} (${e.source})` : e.name }));
}

/** One name kept; several that differ only in a trailing "(…)" are written without it. */
function sharedLabel(names: string[]): string {
  const distinct = [...new Set(names)];
  if (distinct.length === 1) return distinct[0]!;
  const stems = new Set(distinct.map((name) => name.replace(/\s*\([^()]*\)\s*$/, '').trim()));
  return stems.size === 1 ? [...stems][0]! : distinct.join(', ');
}
