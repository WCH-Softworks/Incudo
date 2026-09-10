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

import type { ElementId, ElementType, StatKey } from './model.ts';
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
  /**
   * Bounds, applied to every stat — contributed, derived or both — after the contributions
   * and derivations have settled and before `overrides`, which still win over everything
   * (ADR 0016). A bound may be a plain number or an expression, because the interesting ones
   * are not constants: 5e's ability score maximum is `20 + strength:max`, where the 20 is the
   * system's and the delta is content's.
   *
   * Expressions here read the *unclamped* values of other stats, in one pass. A bound that
   * depends on a bounded stat therefore sees the number before its cap — stated rather than
   * fixed, because the alternative is a second fixed point in the resolver.
   */
  min?: number | StatExpr;
  max?: number | StatExpr;
}

/**
 * The reserved stat reference that reads the progression of the track being evaluated.
 *
 * Only meaningful inside a {@link TrackStatDef}'s `value`; anywhere else it is an ordinary
 * stat name nothing declares, and so reads 0.
 */
export const TRACK_PROGRESS_STAT = 'track:progress';

/** The placeholder `trackStatPattern` and {@link TrackStatDef.stat} substitute. */
const TRACK_NAME_PLACEHOLDER = '{name}';

/**
 * A stat contributed once per track — ADR 0018.
 *
 * ADR 0015 gave every track a published count, which content reads by name (`level:warlock`).
 * What it could not do is *iterate*: "for each track, add half its count". A system definition
 * cannot enumerate the tracks, because content ships its own and there are 25 spellcasting
 * classes in the Aurora corpus alone.
 *
 * So: for every track the character has, if `when`'s element is in that track, evaluate
 * `value` — with {@link TRACK_PROGRESS_STAT} reading that track's own count — and contribute
 * it to `stat`. Nothing here is a class or a spell; it is "a track may contribute a number".
 */
export interface TrackStatDef {
  /**
   * The stat contributed to. `{name}` is replaced with the track element's lowercased name,
   * which turns an aggregate into a per-track stat: `"{name}:spellcasting:solo"` publishes
   * `warlock:spellcasting:solo`. Without it, every track's contribution sums into one stat.
   */
  stat: StatKey;
  /**
   * Only contribute for tracks containing this element. Omit to contribute for every track.
   *
   * This is the hook content already provides: a 5e casting class grants a marker saying which
   * weighting it uses, and the marker lands in that class's track.
   */
  when?: ElementId;
  /** Evaluated per track. Reads {@link TRACK_PROGRESS_STAT} for that track's own count. */
  value: StatExpr;
}

/** `"{name}:spellcasting:solo"` on a track rooted at Warlock -> `warlock:spellcasting:solo`. */
export function trackStatName(def: TrackStatDef, elementName: string): StatKey {
  return def.stat.replace(TRACK_NAME_PLACEHOLDER, elementName.trim().toLowerCase());
}

/**
 * A pool of points a build step distributes — ADR 0017.
 *
 * The mechanism behind "a class gave you one more attribute point, and you should not have
 * to walk back to an earlier screen to spend it". `stat` is an ordinary stat, so **content
 * adds to it with the `stat` rule that already exists** — a feat, a race variant, an
 * improvement at level 4. No new rule kind, and the sum is always current because the engine
 * recomputes it like any other stat.
 *
 * Nothing here is an ability score. It is "this step distributes points across these stats,
 * by one of these methods".
 */
export interface BudgetDef {
  /** The stat holding points granted beyond whatever the method itself supplies. */
  stat: StatKey;
  /** The stats the points are spent on. */
  targets: StatKey[];
  /** Ids of the system's `generationMethods` this step offers. */
  methods?: string[];
}

/**
 * How a budget's starting values are produced — ADR 0017.
 *
 * Data, not code, and for a stated reason: docs/CODE-REUSE-POLICY.md rule 1 says a rule
 * about the game may not live in a component, and a point-buy cost table is exactly that.
 * A shell that hardcoded 27 points would be a bug in the same category as one that computed
 * armour class.
 *
 * Three shapes, distinguished by which fields are present:
 *
 *  - **points** — `pool` plus `costs`: values are bought out of a pool.
 *  - **assignment** — `values`, or `dice` and `count`: a fixed set is handed out and
 *    assigned to targets. Not a points budget, and reporting one would be a fiction.
 *  - **free** — neither: the user types numbers.
 */
export interface GenerationMethodDef {
  id: string;
  label?: string;
  /** Points available before anything content grants. Makes this a points method. */
  pool?: number;
  /** Cost of each attainable value, keyed by the value. Makes this a points method. */
  costs?: Record<string, number>;
  /** Lowest value this method may produce. */
  min?: number;
  /** Highest value this method may produce. */
  max?: number;
  /** A fixed set of values to assign, e.g. the standard array. */
  values?: number[];
  /** Dice notation the shell rolls, e.g. "4d6dl1". Core never rolls anything. */
  dice?: string;
  /** How many times to roll. */
  count?: number;
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
  /**
   * Ids of steps that must be usable before this one is — ADR 0017.
   *
   * A genuine dependency and nothing else: you cannot pick spells before something makes
   * you a spellcaster. The suggested order is a topological sort of these, with the declared
   * array order breaking ties. That is what makes abilities-first fall out of the data
   * rather than out of a rule in the app — the abilities step requires nothing, so it sorts
   * first — and, more importantly, it is what lets a step become available *later*.
   */
  requires?: string[];
  /** Points this step distributes, when it is about numbers rather than elements. */
  budget?: BudgetDef;
}

/**
 * The suggested order for a kind's build steps: a topological sort of `requires`, with the
 * declared array order breaking ties — ADR 0017.
 *
 * A step in a dependency cycle is emitted last rather than dropped. Validation reports
 * cycles (ADR 0011's stance: report, do not repair), and a builder that silently lost a
 * screen would be a worse failure than one that shows it in an odd place.
 */
export function orderBuildSteps(steps: BuildStepDef[]): BuildStepDef[] {
  const known = new Set(steps.map((s) => s.id));
  const placed = new Set<string>();
  const ordered: BuildStepDef[] = [];
  let remaining = [...steps];

  while (remaining.length) {
    // One at a time, taking the earliest *declared* step whose dependencies are met. Placing
    // a whole wave at once would also be a valid topological order and a worse one: it drags
    // every dependent step to the end, so "levels" would follow "details" purely for having
    // named a prerequisite. This puts each step as early as its dependencies allow.
    const at = remaining.findIndex((step) =>
      (step.requires ?? []).every((id) => !known.has(id) || placed.has(id)),
    );
    if (at < 0) {
      // Everything left is in a cycle, or depends on one. Keep declared order.
      ordered.push(...remaining);
      break;
    }
    const [step] = remaining.splice(at, 1);
    ordered.push(step!);
    placed.add(step!.id);
  }
  return ordered;
}

/** Step ids that sit in, or behind, a `requires` cycle. Empty for a well-formed system. */
export function buildStepCycles(steps: BuildStepDef[]): string[] {
  const known = new Set(steps.map((s) => s.id));
  const placed = new Set<string>();
  let remaining = [...steps];
  for (;;) {
    const ready = remaining.filter((step) =>
      (step.requires ?? []).every((id) => !known.has(id) || placed.has(id)),
    );
    if (!ready.length) return remaining.map((step) => step.id);
    for (const step of ready) placed.add(step.id);
    remaining = remaining.filter((step) => !placed.has(step.id));
  }
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
  | {
      kind: 'level';
      min: number;
      max: number;
      stat?: StatKey;
      elementIdPattern?: string;
      trackStatPattern?: string;
    }
  | {
      kind: 'rating';
      stat: StatKey;
      min?: number;
      max?: number;
      elementIdPattern?: string;
      trackStatPattern?: string;
    }
  | {
      kind: 'xp';
      stat: StatKey;
      min?: number;
      max?: number;
      elementIdPattern?: string;
      trackStatPattern?: string;
    }
  | { kind: 'none' };

/**
 * The stat a track publishes its own count as — ADR 0015.
 *
 * `"level:{name}"` with a track rooted on the Warlock element gives `level:warlock`, which is
 * what 150-odd content references in the Aurora corpus read and what nothing in it writes.
 * `{name}` is the element's name, lowercased; that is Aurora's own convention, and the corpus
 * depends on it.
 */
export function trackStatKey(progression: Progression, elementName: string): string | undefined {
  if (progression.kind === 'none' || !progression.trackStatPattern) return undefined;
  return progression.trackStatPattern.replace(TRACK_NAME_PLACEHOLDER, elementName.trim().toLowerCase());
}

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
  /**
   * Elements every character of this kind has, without choosing them.
   *
   * The system-definition answer to a question Aurora answers in application code: a 5e
   * character has a base armour class, adds its Dexterity modifier to it, and adds its
   * Constitution modifier to hit points, and no content file says so. Aurora's saves record
   * those as elements in every derivation; without a place to declare them, a character
   * built in Incudo can never match one built in Aurora.
   *
   * They are not choices and are not stored on the character — the kind declares them, so
   * they follow the system when it is updated. Replaced rather than merged along an
   * `extends` chain, like `buildSteps`.
   */
  grants?: ElementId[];
  /**
   * Stats contributed once per track — ADR 0018. Replaced rather than merged along an
   * `extends` chain, like `buildSteps` and `grants`.
   */
  trackStats?: TrackStatDef[];
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
  /** Elements every character of this kind has without choosing them. */
  grants: ElementId[];
  /** Stats each of the character's tracks contributes — ADR 0018. */
  trackStats: TrackStatDef[];
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
  /**
   * How a build step's budget can produce its starting values — ADR 0017. Declared once for
   * the system and referenced by id, because a PC and an NPC generate ability scores the
   * same way and the cost table should not be written twice.
   */
  generationMethods?: GenerationMethodDef[];
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
  let grants: ElementId[] = [];
  let trackStats: TrackStatDef[] = [];
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
    if (layer.grants !== undefined) grants = layer.grants;
    if (layer.trackStats !== undefined) trackStats = layer.trackStats;
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
    grants,
    trackStats,
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

/**
 * Elements a character of this kind has purely by existing: the kind's `grants`, plus one
 * per step of progression when the progression declares an `elementIdPattern`.
 *
 * The pattern's `{n}` is the step number, so `"ID_LEVEL_{n}"` at progress 8 yields
 * `ID_LEVEL_1` … `ID_LEVEL_8`. Aurora writes exactly those into every save, and content
 * genuinely references them (`requirements="!ID_LEVEL_1"`). Steps are whole numbers from
 * the progression's minimum, so a fractional challenge rating produces none — there is no
 * `ID_CR_0.25` to grant and no system asks for one.
 *
 * Not stored on the character: these follow the system definition, so fixing the 5e
 * baseline fixes every 5e character rather than only the ones saved afterwards (ADR 0006).
 */
export function baselineElementIds(kind: ResolvedCharacterKind, progress: number): ElementId[] {
  const ids = [...kind.grants];
  const progression = kind.progression;
  if (progression.kind === 'none' || !progression.elementIdPattern) return ids;

  const from = progression.min ?? 0;
  if (!Number.isInteger(from) || !Number.isInteger(progress)) return ids;
  // The cap is the progression's own maximum where it has one, so a corrupt `progress` of
  // 10^9 cannot make this allocate for a very long time.
  const to = Math.min(progress, progression.max ?? progress);
  for (let step = from; step <= to; step++) {
    ids.push(progression.elementIdPattern.replace('{n}', String(step)));
  }
  return ids;
}

export function clampProgress(progression: Progression, value: number): number {
  if (progression.kind === 'none') return 0;
  let result = value;
  if (progression.min !== undefined) result = Math.max(result, progression.min);
  if (progression.max !== undefined) result = Math.min(result, progression.max);
  return result;
}
