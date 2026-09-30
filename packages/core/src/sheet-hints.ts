/**
 * What content writes for a character sheet — ADR 0076.
 *
 * An element's `sheet` hints (Aurora's `<sheet>`) carry a short text for the sheet, often several, each from a level on,
 * and name stats in it as `{{stat}}`. This is the one reader of both: which descriptions an element has (reading a
 * save written before they were all kept), which one applies at a level, and where the placeholders are. Nothing here
 * fills a placeholder or decides how a number is written: that is `packages/ui`'s, which knows how a sheet writes one.
 *
 * Read where a sheet is drawn, never when content is parsed: a `.incu` embeds parsed elements, and a field filled at
 * parse time would be empty on every save written before it (the lesson of ADRs 0046, 0048 and 0069).
 */

import type { SheetDescription, SheetHints } from './model.ts';

/**
 * Every description the hints carry, in the order written. Hints parsed before every description was kept have only
 * `description`, the first one's text: it is then the one description, applying at every level.
 */
export function sheetDescriptions(hints: SheetHints | undefined): readonly SheetDescription[] {
  if (!hints) return [];
  if (hints.descriptions) return hints.descriptions;
  return hints.description !== undefined ? [{ text: hints.description }] : [];
}

/**
 * The description that applies at `level`: the one with the highest `level` at or below it, one with no level counting
 * as applying from the start, and of two at the same level the one written later. `undefined` when every description
 * starts above `level`.
 */
export function sheetDescriptionAt(hints: SheetHints | undefined, level: number): SheetDescription | undefined {
  let best: SheetDescription | undefined;
  let bestLevel = -Infinity;
  for (const description of sheetDescriptions(hints)) {
    const from = description.level ?? 0;
    if (from <= level && from >= bestLevel) {
      best = description;
      bestLevel = from;
    }
  }
  return best;
}

/** One `{{stat}}` in a sheet text. */
export interface SheetPlaceholder {
  /** The stat it names, as written but for the spaces around it (`proficiency`, `level:wizard:half:up`). */
  stat: string;
  /** Where `{{` starts and where `}}` ends (exclusive), in the text. */
  start: number;
  end: number;
}

/** Two braces, a name with no brace in it, two braces. The corpus writes no other shape (`sheet-hints.test.ts`). */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Every placeholder in a sheet text, in the order written. An empty pair of braces names nothing and is not one. */
export function sheetPlaceholders(text: string | undefined): SheetPlaceholder[] {
  if (!text) return [];
  const out: SheetPlaceholder[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    const stat = match[1]!;
    if (stat === '') continue;
    out.push({ stat, start: match.index, end: match.index + match[0].length });
  }
  return out;
}
