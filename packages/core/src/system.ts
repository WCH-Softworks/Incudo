/**
 * A game system definition.
 *
 * This is *data* (`systems/<id>/system.json`), never code. Everything Aurora hardcodes
 * about D&D — the element type vocabulary, the stat list, the build flow, the sheet —
 * lives here instead. That is the whole trick behind the system-agnostic claim.
 * See docs/adr/0003.
 *
 * A system declares one or more **character kinds** (ADR 0009). The kind owns everything
 * that differs per kind: how it progresses, which element types it may use, how it is
 * built, and how it is displayed. A PC has levels and a two-page sheet; a monster has a
 * challenge rating and a stat block; they share only the stats underneath.
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
  /** Repeats per point of progression (e.g. a level-up step). */
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

/**
 * How a kind of character advances.
 *
 * Generalized deliberately: "level" was the last big PC assumption sitting in the
 * engine's face (ADR 0009). A character records a single number, `progress`, whose
 * meaning comes from here.
 *
 * `stat` names the stat that number is published as, so content can reference it —
 * requirements like `level:rogue`, derivations like `2 + floor((level - 1) / 4)`. It is
 * a system-declared string; core never spells it.
 */
export type Progression =
  | { kind: 'level'; min: number; max: number; stat?: StatKey }
  | { kind: 'rating'; stat: StatKey; min?: number; max?: number }
  | { kind: 'xp'; stat: StatKey; min?: number; max?: number }
  | { kind: 'none' };

/** ADR 0010 — official systems record the licence of the material they describe. */
export interface LicenceRef {
  id: string;
  name?: string;
  source?: string;
  attribution?: string;
  permitsCommercialUse?: boolean;
  /** ISO date the licence text was last read. Makes a licence change detectable. */
  verified?: string;
  url?: string;
}

/**
 * One kind of character a system can build.
 *
 * Every field except `id` is optional because a kind may `extends` another and state only
 * its differences — "legendary" is a delta on "npc", not a copy of it. Use
 * {@link resolveCharacterKind} to get the merged, complete form.
 */
export interface CharacterKindDef {
  id: string;
  name?: string;
  description?: string;
  /** The kind offered when a character does not name one. The first kind wins if none is marked. */
  default?: boolean;
  /** Id of another kind in this system to inherit from. ADR 0009. */
  extends?: string;
  progression?: Progression;
  /**
   * Element types this kind may use. When `extends` is set the list may be written as a
   * delta — `"+Lair Action"` adds, `"-Spell"` removes — in which case the parent's list is
   * inherited and patched. A list with no prefixed entry replaces the parent's outright.
   */
  elementTypes?: ElementType[];
  /** Stats this kind adds to the system's. Kinds inherit the system's stats (ADR 0009). */
  stats?: StatDef[];
  buildSteps?: BuildStepDef[];
  sheet?: SheetLayoutDef;
}

/** A {@link CharacterKindDef} with its `extends` chain applied and defaults filled in. */
export interface ResolvedCharacterKind {
  id: string;
  name: string;
  description?: string;
  default: boolean;
  progression: Progression;
  elementTypes: ElementType[];
  /** The system's stats, then this kind's. */
  stats: StatDef[];
  buildSteps: BuildStepDef[];
  sheet: SheetLayoutDef;
}

export interface GameSystem {
  /** Bumped only by a breaking change to the system format itself. ADR 0011. */
  formatVersion: 1;
  id: string;
  name: string;
  /** Free text: edition, publisher, licence note. */
  description?: string;
  version: string;
  licence?: LicenceRef;
  /** A user overlay names the official system it patches. ADR 0011. */
  extends?: string;
  elementTypes: ElementTypeDef[];
  /** Stats shared by every kind. A kind may add its own. */
  stats: StatDef[];
  characterKinds: CharacterKindDef[];
  /**
   * Aurora element types that map onto this system's types. Only needed for systems that
   * want to consume Aurora content; a native Incudo system omits it.
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

// --- character kinds -------------------------------------------------------

/** Depth cap on `extends`, so a cyclic or hostile system definition cannot hang the app. */
const MAX_KIND_DEPTH = 8;

export function findCharacterKind(
  system: GameSystem,
  kindId: string | undefined,
): CharacterKindDef | undefined {
  if (kindId === undefined) return defaultCharacterKindDef(system);
  return system.characterKinds.find((k) => k.id === kindId);
}

function defaultCharacterKindDef(system: GameSystem): CharacterKindDef | undefined {
  return system.characterKinds.find((k) => k.default) ?? system.characterKinds[0];
}

/** The kind a new character gets when the user does not pick one. */
export function defaultCharacterKindId(system: GameSystem): string | undefined {
  return defaultCharacterKindDef(system)?.id;
}

/**
 * Merge a kind with everything it extends.
 *
 * Throws on an unknown or cyclic `extends`: a half-resolved kind would produce a character
 * the user cannot trust. Callers loading user-authored systems validate first (see
 * `schema.ts`), so this should only ever fire on a genuine bug.
 */
export function resolveCharacterKind(
  system: GameSystem,
  kindId: string | undefined,
): ResolvedCharacterKind {
  const def = findCharacterKind(system, kindId);
  if (!def) {
    throw new Error(
      kindId === undefined
        ? `System "${system.id}" declares no character kinds.`
        : `System "${system.id}" has no character kind "${kindId}".`,
    );
  }

  // Root of the chain first, so each descendant patches what it inherited.
  const chain: CharacterKindDef[] = [];
  const seen = new Set<string>();
  let current: CharacterKindDef | undefined = def;
  while (current) {
    if (seen.has(current.id)) {
      throw new Error(`Character kind "${current.id}" extends itself, directly or indirectly.`);
    }
    seen.add(current.id);
    chain.unshift(current);
    if (chain.length > MAX_KIND_DEPTH) {
      throw new Error(
        `Character kind "${def.id}" extends more than ${MAX_KIND_DEPTH} levels deep.`,
      );
    }
    const parentId: string | undefined = current.extends;
    if (parentId === undefined) break;
    const parent: CharacterKindDef | undefined = system.characterKinds.find(
      (k) => k.id === parentId,
    );
    if (!parent) {
      throw new Error(
        `Character kind "${current.id}" extends "${parentId}", which this system does not declare.`,
      );
    }
    current = parent;
  }

  let name = def.id;
  let description: string | undefined;
  let progression: Progression = { kind: 'none' };
  let elementTypes: ElementType[] = [];
  // Keyed by name so a kind can *replace* an inherited stat, not just add to it: a
  // monster's proficiency bonus comes from its challenge rating, not from a level it
  // does not have. Insertion order is preserved, so declaration order still reads.
  const stats = new Map<string, StatDef>();
  for (const stat of system.stats) stats.set(stat.name.toLowerCase(), stat);
  let buildSteps: BuildStepDef[] = [];
  let sheet: SheetLayoutDef = { sections: [] };

  for (const layer of chain) {
    if (layer.name !== undefined) name = layer.name;
    if (layer.description !== undefined) description = layer.description;
    if (layer.progression !== undefined) progression = layer.progression;
    if (layer.elementTypes !== undefined) {
      elementTypes = applyElementTypeDelta(elementTypes, layer.elementTypes);
    }
    for (const stat of layer.stats ?? []) stats.set(stat.name.toLowerCase(), stat);
    if (layer.buildSteps !== undefined) buildSteps = layer.buildSteps;
    if (layer.sheet !== undefined) sheet = layer.sheet;
  }

  return {
    id: def.id,
    name,
    description,
    default: def.default ?? false,
    progression,
    elementTypes,
    stats: [...stats.values()],
    buildSteps,
    sheet,
  };
}

/**
 * `["+Lair Action", "-Spell"]` patches the inherited list; `["Race", "Class"]` replaces it.
 *
 * The whole array is one or the other: a single prefixed entry makes it a patch, and an
 * unprefixed entry inside a patch reads as an addition. What would be surprising is a list
 * that half-replaces, so that case does not exist.
 */
function applyElementTypeDelta(inherited: ElementType[], next: ElementType[]): ElementType[] {
  const isPatch = next.some((t) => t.startsWith('+') || t.startsWith('-'));
  if (!isPatch) return [...next];

  const result = [...inherited];
  for (const entry of next) {
    if (entry.startsWith('-')) {
      const at = result.indexOf(entry.slice(1));
      if (at >= 0) result.splice(at, 1);
      continue;
    }
    const added = entry.startsWith('+') ? entry.slice(1) : entry;
    if (!result.includes(added)) result.push(added);
  }
  return result;
}

// --- progression -----------------------------------------------------------

/**
 * The stat a kind's `progress` number is published as, or undefined when it has none.
 *
 * `level` defaults the stat name to "level" because that is what content written for
 * levelled systems references. It is still overridable, and still just a string here.
 */
export function progressionStat(progression: Progression): StatKey | undefined {
  switch (progression.kind) {
    case 'level':
      return progression.stat ?? 'level';
    case 'rating':
    case 'xp':
      return progression.stat;
    case 'none':
      return undefined;
  }
}

/** Where a freshly created character of this kind starts. */
export function initialProgress(progression: Progression): number {
  switch (progression.kind) {
    case 'level':
      return progression.min;
    case 'rating':
    case 'xp':
      return progression.min ?? 0;
    case 'none':
      return 0;
  }
}

export function clampProgress(progression: Progression, value: number): number {
  if (progression.kind === 'none') return 0;
  let result = value;
  if (progression.min !== undefined) result = Math.max(result, progression.min);
  if (progression.max !== undefined) result = Math.min(result, progression.max);
  return result;
}
