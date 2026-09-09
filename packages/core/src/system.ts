/**
 * A game system definition.
 *
 * This is *data* (`systems/<id>/system.json`), never code. Everything Aurora hardcodes
 * about D&D — the element type vocabulary, the stat list, the build flow, the sheet —
 * lives here instead. That is the whole trick behind the system-agnostic claim.
 * See docs/adr/0003.
 */

import type { ElementType, StatKey } from './model.ts';
import type { StatExpr } from './expression.ts';

export interface ElementTypeDef {
  /** The type name as it appears on elements, e.g. "Class Feature". */
  name: ElementType;
  /** Plural label for UI. */
  plural?: string;
  /** Types that may be nested under this one (a Class has Archetypes). */
  children?: ElementType[];
  /** Shown in the content browser as a browsable category. */
  browsable?: boolean;
  /** The user picks this directly during the build, rather than receiving it via a grant. */
  selectable?: boolean;
}

export type StatValueKind = 'number' | 'string';

export interface StatDef {
  name: StatKey;
  label?: string;
  kind?: StatValueKind;
  default?: number | string;
  /**
   * A derived stat. Evaluated after contributed stats are summed.
   * Systems declare arithmetic here rather than shipping JavaScript.
   */
  derive?: StatExpr;
  /** Clamp after derivation. */
  min?: number;
  max?: number;
}

export interface BuildStepDef {
  id: string;
  label: string;
  /** Element types the user picks at this step. */
  types: ElementType[];
  required?: boolean;
  /** Repeats per level (e.g. a level-up step). */
  perLevel?: boolean;
  description?: string;
}

export interface SheetSectionDef {
  id: string;
  label: string;
  /** Stats rendered in this section, in order. */
  stats?: StatKey[];
  /** Element types listed in this section. */
  types?: ElementType[];
}

export interface SheetLayoutDef {
  sections: SheetSectionDef[];
}

export interface GameSystem {
  id: string;
  name: string;
  /** Free text: edition, publisher, licence note. */
  description?: string;
  version: string;
  levelRange: { min: number; max: number };
  elementTypes: ElementTypeDef[];
  stats: StatDef[];
  buildSteps: BuildStepDef[];
  sheet: SheetLayoutDef;
  /**
   * Aurora element types that map onto this system's types. Only needed for systems that
   * want to consume Aurora content; a native HeroForge system omits it.
   */
  auroraTypeMap?: Record<string, ElementType>;
}

export function findStatDef(system: GameSystem, name: StatKey): StatDef | undefined {
  const lower = name.toLowerCase();
  return system.stats.find((s) => s.name.toLowerCase() === lower);
}

export function isKnownElementType(system: GameSystem, type: ElementType): boolean {
  return system.elementTypes.some((t) => t.name === type);
}
