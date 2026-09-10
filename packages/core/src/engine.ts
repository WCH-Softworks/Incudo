/**
 * The rules engine.
 *
 *   Character.choices
 *        -> resolve elements
 *        -> collect rules (respecting level gates and requirements)
 *        -> apply stat rules (bonus buckets, caps)
 *        -> evaluate system-declared derived stats
 *        -> report pending selects and problems
 *
 * The derivation is a fixed point: granting an element can satisfy a requirement that
 * unlocks another grant, so the collection pass repeats until nothing new appears.
 * The iteration cap exists because content from the internet can be cyclic.
 */

import type { Element, ElementId, ElementIndex, Rule, StatKey, SelectRule, StatRule } from './model.ts';
import type { Character } from './character.ts';
import { advancementCounts, advancementElementIds } from './character.ts';
import type { GameSystem, ResolvedCharacterKind, StatDef } from './system.ts';
import { baselineElementIds, progressionStat, resolveCharacterKind, trackStatKey } from './system.ts';
import { evaluateRequirements, referencedIds, type RequirementContext } from './requirements.ts';
import {
  evaluateExpr,
  evaluateExprAsString,
  type ExpressionContext,
  type StatExpr,
} from './expression.ts';
import { matchesSupports, type SupportsContext } from './supports.ts';

const MAX_PASSES = 24;

export interface StatContribution {
  value: number;
  bonus?: string;
  from: ElementId;
}

export interface ResolvedStat {
  name: StatKey;
  value: number;
  text?: string;
  contributions: StatContribution[];
}

export interface PendingChoice {
  ruleKey: string;
  label: string;
  type: string;
  /** How many still need choosing. */
  remaining: number;
  number: number;
  optional: boolean;
  candidates: ElementId[];
  from: ElementId;
}

export type ProblemLevel = 'error' | 'warning';

export interface Problem {
  level: ProblemLevel;
  code:
    | 'unresolved-element'
    | 'unknown-type'
    | 'requirement-unmet'
    | 'over-selected'
    | 'cycle-limit'
    | 'ambiguous-track'
    | 'unresolved-interpolation';
  message: string;
  elementId?: ElementId;
  ruleKey?: string;
}

export interface DerivedCharacter {
  character: Character;
  system: GameSystem;
  /** The character's kind with its `extends` chain applied — ADR 0009. */
  kind: ResolvedCharacterKind;
  /** Every element the character has, granted or chosen. */
  elements: Element[];
  elementIds: ReadonlySet<ElementId>;
  stats: Map<StatKey, ResolvedStat>;
  pendingChoices: PendingChoice[];
  problems: Problem[];
}

export interface DeriveOptions {
  /** Cap on fixed-point passes. Exposed for tests and for diagnosing cyclic content. */
  maxPasses?: number;
  /**
   * A kind the caller already resolved. Resolving walks the `extends` chain, so a UI that
   * derives on every keystroke passes it in rather than redoing that work.
   */
  kind?: ResolvedCharacterKind;
}

export function deriveCharacter(
  character: Character,
  system: GameSystem,
  index: ElementIndex,
  options: DeriveOptions = {},
): DerivedCharacter {
  const maxPasses = options.maxPasses ?? MAX_PASSES;
  const problems: Problem[] = [];
  const kind = options.kind ?? resolveCharacterKind(system, character.kind);

  // What the character picked, plus what its kind gives everyone of that kind — the base
  // armour class a 5e character has before any content says so, and one element per level.
  // Both are seeds; the fixed point below does not care where a seed came from.
  //
  // The two are kept apart for one reason: how loudly to complain when a seed does not
  // resolve. A choice that has vanished is the user's build broken, and an error. A kind's
  // baseline missing means the system definition expects content this profile has not
  // loaded — the system's problem, not the character's, and a warning.
  const baselineIds = new Set<ElementId>(baselineElementIds(kind, character.progress));
  const chosenIds = new Set<ElementId>(baselineIds);
  for (const choice of character.choices) for (const id of choice.elementIds) chosenIds.add(id);
  // A second class is chosen by no select — it is what levels 3 onwards went to (ADR 0015),
  // so an advancement entry seeds the derivation exactly as a choice does.
  const trackLevels = advancementCounts(character);
  for (const id of advancementElementIds(character)) chosenIds.add(id);

  let active = new Map<ElementId, Element>();
  let stats = new Map<StatKey, ResolvedStat>();
  // Element -> the track root it belongs to. Rebuilt each pass alongside `active`, and kept
  // afterwards because the pending-choice walk needs the same gates the expansion used.
  let tracks = new Map<ElementId, ElementId>();
  let passes = 0;
  let changed = true;

  while (changed && passes < maxPasses) {
    passes++;
    const next = new Map<ElementId, Element>();
    const nextTracks = new Map<ElementId, ElementId>();
    const levelFor = trackLevelReader(nextTracks, trackLevels, character.progress);
    const ctx = makeContext(active, stats, character, kind);

    // Seed: everything the user explicitly chose, and the kind's own baseline.
    for (const id of chosenIds) {
      addElement(next, index, id, problems, undefined, baselineIds.has(id));
    }
    // Each element progression was spent on roots its own track. Done before the expansion
    // so a grant made by a track root inherits it on the first step.
    for (const id of trackLevels.keys()) if (next.has(id)) nextTracks.set(id, id);

    // Fixed-point expansion of grants.
    let frontier = [...next.values()];
    const seen = new Set(next.keys());
    while (frontier.length) {
      const nextFrontier: Element[] = [];
      for (const element of frontier) {
        for (const rule of activeRules(element, character, kind, ctx, levelFor)) {
          if (rule.kind !== 'grant') continue;
          inheritTrack(nextTracks, element.id, rule.id, index.get(rule.id), problems);
          if (seen.has(rule.id)) continue;
          const granted = addElement(next, index, rule.id, problems, element.id);
          seen.add(rule.id);
          if (granted) nextFrontier.push(granted);
        }
      }
      frontier = nextFrontier;
    }

    const nextStats = computeStats(
      next,
      character,
      kind,
      makeContext(next, stats, character, kind),
      levelFor,
      trackLevels,
    );

    changed = !sameKeys(active, next) || !sameStats(stats, nextStats);
    active = next;
    stats = nextStats;
    tracks = nextTracks;
  }

  if (passes >= maxPasses) {
    problems.push({
      level: 'warning',
      code: 'cycle-limit',
      message: `Derivation did not settle after ${maxPasses} passes. The content may contain a requirement cycle.`,
    });
  }

  const ctx = makeContext(active, stats, character, kind);
  const pendingChoices = collectPendingChoices(
    active,
    character,
    kind,
    index,
    ctx,
    problems,
    trackLevelReader(tracks, trackLevels, character.progress),
  );

  return {
    character,
    system,
    kind,
    elements: [...active.values()],
    elementIds: new Set(active.keys()),
    stats,
    pendingChoices,
    // The derivation is a fixed point, so an unresolvable grant is discovered again on
    // every pass. The user has one broken reference, not four, and should be told once.
    problems: dedupeProblems(problems),
  };
}

// ---------------------------------------------------------------------------

interface EngineContext extends RequirementContext, ExpressionContext {}

function makeContext(
  active: Map<ElementId, Element>,
  stats: Map<StatKey, ResolvedStat>,
  character: Character,
  kind: ResolvedCharacterKind,
): EngineContext {
  // The kind names the stat its progress number is published as: "level" for a 5e PC,
  // "challenge" for a monster, nothing at all for Cairn. Core never spells it — ADR 0009.
  const progressKey = progressionStat(kind.progression)?.toLowerCase();
  return {
    hasElement: (id) => active.has(id),
    statNumber: (stat) => {
      const key = stat.toLowerCase();
      const override = character.overrides?.[key];
      if (typeof override === 'number') return override;
      if (progressKey !== undefined && key === progressKey) return character.progress;
      return stats.get(key)?.value ?? 0;
    },
    statString: (stat) => {
      const key = stat.toLowerCase();
      const override = character.overrides?.[key];
      if (typeof override === 'string') return override;
      return stats.get(key)?.text;
    },
    hasFlag: (name) => stats.has(name.toLowerCase()),
  };
}

function addElement(
  into: Map<ElementId, Element>,
  index: ElementIndex,
  id: ElementId,
  problems: Problem[],
  grantedBy?: ElementId,
  fromKindBaseline = false,
): Element | undefined {
  if (into.has(id)) return into.get(id);
  const element = index.get(id);
  if (!element) {
    problems.push({
      level: fromKindBaseline ? 'warning' : 'error',
      code: 'unresolved-element',
      message: fromKindBaseline
        ? `The "${id}" element this character kind expects is not in any loaded source. The character is fine; the system definition is describing content this profile does not have.`
        : grantedBy
          ? `"${grantedBy}" grants "${id}", which is not in any loaded source.`
          : `"${id}" is not in any loaded source.`,
      elementId: id,
    });
    return undefined;
  }
  into.set(id, element);
  return element;
}

/** How many points of progression apply to an element's rules — its track's, or the total. */
type TrackLevelReader = (elementId: ElementId) => number;

/**
 * An element in no track gates on the character's whole progression, which is what a race's
 * `level="5"` grant means and what every single-track character has always done.
 */
function trackLevelReader(
  tracks: Map<ElementId, ElementId>,
  levels: Map<ElementId, number>,
  progress: number,
): TrackLevelReader {
  if (!levels.size) return () => progress;
  return (elementId) => {
    const root = tracks.get(elementId);
    return root === undefined ? progress : (levels.get(root) ?? 0);
  };
}

/**
 * Grants inherit their granter's track — ADR 0015. That is what makes a rogue's level 6
 * feature gate on rogue levels without core knowing what a rogue is.
 *
 * An element reached from two tracks keeps the first one. Silently picking would make a level
 * gate depend on grant-visit order, which is the sort of thing discovered years later by
 * someone whose character is two features short — so it is reported.
 *
 * But only when it can change an answer. A track exists to give `rule.level` a number to
 * compare against, so an element with no level-gated rule reads identically from either
 * track. Every multiclassed character shares proficiencies between its classes — light
 * armour, simple weapons, a saving throw — and warning about each of those would bury the
 * one case that matters under four that never could.
 */
function inheritTrack(
  tracks: Map<ElementId, ElementId>,
  from: ElementId,
  to: ElementId,
  granted: Element | undefined,
  problems: Problem[],
): void {
  const track = tracks.get(from);
  if (track === undefined || to === track) return;
  const existing = tracks.get(to);
  if (existing === undefined) {
    tracks.set(to, track);
    return;
  }
  if (existing === track) return;
  if (!granted?.rules.some((rule) => rule.level !== undefined)) return;
  problems.push({
    level: 'warning',
    code: 'ambiguous-track',
    message: `"${to}" is granted by both "${existing}" and "${track}", and has rules gated by level. They follow "${existing}"; content that means the other should say so.`,
    elementId: to,
  });
}

/**
 * Rules of an element that currently apply: progression gate met, requirements satisfied.
 *
 * `rule.level` is Aurora's `level="N"` attribute and keeps that name because that is what
 * the content says. It gates on the progression number *of this element's track* — a 5e
 * class's own level — falling back to the character's total where an element is in no track
 * (ADR 0015). Before tracks existed this was always the total, which is right for a race and
 * wrong for the second half of a multiclassed character.
 *
 * A kind with `progression.kind: "none"` has nothing to compare against, so gates are
 * ignored rather than read as unmet: a level-less system cannot express "at level N", and
 * dropping every gated rule would be the wrong reading of content imported from one that can.
 */
function activeRules(
  element: Element,
  character: Character,
  kind: ResolvedCharacterKind,
  ctx: EngineContext,
  levelFor: TrackLevelReader,
): Rule[] {
  const gated = kind.progression.kind !== 'none';
  const level = gated ? levelFor(element.id) : 0;
  return element.rules.filter((rule) => {
    if (gated && rule.level !== undefined && level < rule.level) return false;
    return evaluateRequirements(rule.requirements, ctx);
  });
}

function computeStats(
  active: Map<ElementId, Element>,
  character: Character,
  kind: ResolvedCharacterKind,
  ctx: EngineContext,
  levelFor: TrackLevelReader,
  trackLevels: Map<ElementId, number>,
): Map<StatKey, ResolvedStat> {
  const buckets = new Map<StatKey, StatRule[]>();
  const owners = new Map<StatRule, ElementId>();

  for (const element of active.values()) {
    for (const rule of activeRules(element, character, kind, ctx, levelFor)) {
      if (rule.kind !== 'stat') continue;
      const key = rule.name.toLowerCase();
      const list = buckets.get(key);
      if (list) list.push(rule);
      else buckets.set(key, [rule]);
      owners.set(rule, element.id);
    }
  }

  const result = new Map<StatKey, ResolvedStat>();

  // Declared defaults first, so a stat exists even with no contributions. A kind's stat
  // list already carries the system's — see resolveCharacterKind.
  for (const def of kind.stats) {
    if (def.default === undefined) continue;
    const key = def.name.toLowerCase();
    result.set(key, {
      name: def.name,
      value: typeof def.default === 'number' ? def.default : 0,
      text: typeof def.default === 'string' ? def.default : undefined,
      contributions: [],
    });
  }

  // Then the character's own starting values, which replace those defaults (ADR 0014). This
  // is a *base*, not an override: it lands before the contribution loop below, so a race's
  // +2 adds to the score the user bought instead of being discarded by it.
  for (const [key, value] of Object.entries(character.baseStats ?? {})) {
    const lower = key.toLowerCase();
    result.set(lower, {
      name: result.get(lower)?.name ?? key,
      value,
      text: result.get(lower)?.text,
      contributions: [{ value, from: 'base' }],
    });
  }

  for (const [key, rules] of buckets) {
    // Bonuses sharing a named bucket do not stack: the largest wins.
    const named = new Map<string, StatContribution>();
    const unnamed: StatContribution[] = [];
    let text: string | undefined;

    for (const rule of rules) {
      const from = owners.get(rule) ?? 'unknown';
      if (rule.value.kind === 'literal') {
        text = evaluateExprAsString(rule.value, ctx);
      }
      const value = evaluateExpr(rule.value, ctx);
      const contribution: StatContribution = { value, bonus: rule.bonus, from };
      if (rule.bonus) {
        const existing = named.get(rule.bonus);
        if (!existing || existing.value < value) named.set(rule.bonus, contribution);
      } else {
        unnamed.push(contribution);
      }
    }

    const contributions = [...unnamed, ...named.values()];
    const base = result.get(key)?.value ?? 0;
    let total = contributions.reduce((sum, c) => sum + c.value, base);

    const caps = rules.map((r) => r.max).filter((m): m is number => m !== undefined);
    if (caps.length) total = Math.min(total, Math.min(...caps));

    result.set(key, {
      name: rules[0]!.name,
      value: total,
      text: text ?? result.get(key)?.text,
      contributions: [...(result.get(key)?.contributions ?? []), ...contributions],
    });
  }

  // Derived stats last — they read the contributed values above.
  for (const def of kind.stats) {
    if (!def.derive) continue;
    const key = def.name.toLowerCase();
    const derivedCtx: ExpressionContext = {
      statNumber: (s) => (s.toLowerCase() === key ? 0 : ctx.statNumber(s)),
      statString: ctx.statString,
    };
    const value = evaluateExpr(def.derive, derivedCtx) + (result.get(key)?.value ?? 0);
    result.set(key, {
      name: def.name,
      value,
      text: result.get(key)?.text,
      contributions: result.get(key)?.contributions ?? [],
    });
  }

  // The progression number is a stat too, so a sheet can show it without knowing whether
  // it is a level or a challenge rating. Published last because it is an input: nothing
  // contributes to it and nothing derives it. `statNumber` already reads it directly, so
  // this is what puts it on the sheet rather than what makes the maths work.
  const progressKey = progressionStat(kind.progression);
  if (progressKey !== undefined) {
    result.set(progressKey.toLowerCase(), {
      name: progressKey,
      value: character.progress,
      contributions: [{ value: character.progress, from: 'progress' }],
    });
  }

  // Each track publishes its own count, so `level:rogue` exists (ADR 0015). Like the
  // progression stat above this is an input rather than a derivation — it is published here
  // because that is what puts it in front of content, not because anything computes it.
  for (const [rootId, count] of trackLevels) {
    const root = active.get(rootId);
    if (!root) continue;
    const key = trackStatKey(kind.progression, root.name);
    if (key === undefined) continue;
    const lower = key.toLowerCase();
    result.set(lower, {
      name: key,
      value: count,
      contributions: [{ value: count, from: rootId }],
    });
  }

  // Bounds, over every declared stat rather than only the derived ones (ADR 0016). This used
  // to live inside the loop above, which meant a `max` on a contributed stat — an ability
  // score, say — was accepted by the schema and silently did nothing.
  //
  // Bounds read the values computed above, before any of them are clamped: one pass, no fixed
  // point. Reading `result` first and falling back to `ctx` is what makes them this pass's
  // numbers rather than the previous pass's.
  const boundsCtx: ExpressionContext = {
    statNumber: (s) => result.get(s.toLowerCase())?.value ?? ctx.statNumber(s),
    statString: ctx.statString,
  };
  for (const def of kind.stats) {
    if (def.min === undefined && def.max === undefined) continue;
    const key = def.name.toLowerCase();
    const current = result.get(key);
    if (!current) continue;
    const value = clamp(current.value, def, boundsCtx);
    if (value !== current.value) result.set(key, { ...current, value });
  }

  // Manual overrides win over everything, bounds included. An override is a repair tool
  // (ADR 0006), and a repair the engine then clamps is not a repair.
  for (const [key, value] of Object.entries(character.overrides ?? {})) {
    const lower = key.toLowerCase();
    result.set(lower, {
      name: key,
      value: typeof value === 'number' ? value : 0,
      text: typeof value === 'string' ? value : undefined,
      contributions: [{ value: typeof value === 'number' ? value : 0, from: 'override' }],
    });
  }

  return result;
}

function clamp(value: number, def: StatDef, ctx: ExpressionContext): number {
  let v = value;
  const min = boundValue(def.min, ctx);
  const max = boundValue(def.max, ctx);
  if (min !== undefined) v = Math.max(v, min);
  if (max !== undefined) v = Math.min(v, max);
  return v;
}

/** A bound is a number or an expression over stats — ADR 0016. */
function boundValue(
  bound: number | StatExpr | undefined,
  ctx: ExpressionContext,
): number | undefined {
  if (bound === undefined) return undefined;
  return typeof bound === 'number' ? bound : evaluateExpr(bound, ctx);
}

function collectPendingChoices(
  active: Map<ElementId, Element>,
  character: Character,
  kind: ResolvedCharacterKind,
  index: ElementIndex,
  ctx: EngineContext,
  problems: Problem[],
  levelFor: TrackLevelReader,
): PendingChoice[] {
  const pending: PendingChoice[] = [];

  for (const element of active.values()) {
    for (const rule of activeRules(element, character, kind, ctx, levelFor)) {
      if (rule.kind !== 'select') continue;
      const ruleKey = `${element.id}/${rule.key}`;
      const chosen = character.choices.find((c) => c.ruleKey === ruleKey)?.elementIds ?? [];

      if (chosen.length > rule.number) {
        problems.push({
          level: 'error',
          code: 'over-selected',
          message: `"${rule.name}" allows ${rule.number} choice(s) but ${chosen.length} are recorded.`,
          elementId: element.id,
          ruleKey,
        });
      }

      const remaining = rule.number - chosen.length;
      if (remaining <= 0) continue;

      pending.push({
        ruleKey,
        label: rule.name,
        type: rule.type,
        remaining,
        number: rule.number,
        optional: rule.optional ?? false,
        candidates: candidatesFor(rule, index, chosen, ctx).map((e) => e.id),
        from: element.id,
      });
    }
  }

  return pending;
}

/**
 * Elements a select rule would accept, excluding ones already chosen for it.
 *
 * `context` is optional and only affects elements carrying their own `requirements` — the
 * Human Variant, which exists only in a campaign using feats. Without a context those
 * elements stay in the list: a candidate list built with no knowledge of the character is
 * better over-inclusive than silently short.
 */
export function candidatesFor(
  rule: SelectRule,
  index: ElementIndex,
  exclude: ElementId[] = [],
  context?: RequirementContext,
): Element[] {
  const excluded = new Set(exclude);
  const pool = index.byType(rule.type);
  return pool.filter((candidate) => {
    if (excluded.has(candidate.id)) return false;
    if (context && !evaluateRequirements(candidate.requirements, context)) return false;
    const ctx: SupportsContext = {
      tags: new Set(candidate.supports.map((s) => s.toLowerCase())),
      id: candidate.id,
      // Resolving `$(...)` needs build context the caller supplies in the UI layer;
      // here an unresolved interpolation simply matches nothing rather than everything.
      resolve: () => undefined,
    };
    return matchesSupports(rule.supports, ctx);
  });
}

export interface ReferenceOptions {
  /**
   * Include ids named only by a requirement expression.
   *
   * On by default, because the save container wants them: embedding the target of
   * `requirements="ID_X"` keeps a `.incu` self-describing rather than full of ids that mean
   * nothing without a corpus.
   *
   * A validator wants them *off*. A grant to an id nothing declares is broken content — the
   * character silently loses something. A requirement naming an id nothing declares is not:
   * it is a membership test that evaluates to false, and `!ID_X` against an id that will
   * never exist is a perfectly ordinary way to write "unless the 2024 replacement is in
   * play". Counting the two together buries eight real breakages under eighteen deliberate
   * ones.
   */
  requirements?: boolean;
}

/** Every element id the content references. Used by the CLI to validate a source. */
export function referencedElementIds(
  elements: Iterable<Element>,
  options: ReferenceOptions = {},
): Set<string> {
  const withRequirements = options.requirements ?? true;
  const ids = new Set<string>();
  const maybe = (expr: Element['requirements']): void => {
    if (withRequirements) referencedIds(expr, ids);
  };

  for (const element of elements) {
    maybe(element.requirements);
    for (const rule of element.rules) {
      if (rule.kind === 'grant') ids.add(rule.id);
      if (rule.kind === 'select' && rule.default) ids.add(rule.default);
      maybe(rule.requirements);
    }
    maybe(element.multiclass?.requirements);
    for (const rule of element.multiclass?.rules ?? []) {
      if (rule.kind === 'grant') ids.add(rule.id);
      maybe(rule.requirements);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------

function dedupeProblems(problems: Problem[]): Problem[] {
  const seen = new Set<string>();
  return problems.filter((problem) => {
    const key = `${problem.code} ${problem.elementId ?? ''} ${problem.ruleKey ?? ''} ${problem.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameKeys(a: Map<ElementId, unknown>, b: Map<ElementId, unknown>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a.keys()) if (!b.has(key)) return false;
  return true;
}

function sameStats(a: Map<StatKey, ResolvedStat>, b: Map<StatKey, ResolvedStat>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (!other || other.value !== value.value || other.text !== value.text) return false;
  }
  return true;
}
