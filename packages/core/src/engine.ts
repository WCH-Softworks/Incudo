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
import type { GameSystem, ResolvedCharacterKind, StatDef } from './system.ts';
import { progressionStat, resolveCharacterKind } from './system.ts';
import { evaluateRequirements, referencedIds, type RequirementContext } from './requirements.ts';
import { evaluateExpr, evaluateExprAsString, type ExpressionContext } from './expression.ts';
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

  const chosenIds = new Set<ElementId>();
  for (const choice of character.choices) for (const id of choice.elementIds) chosenIds.add(id);

  let active = new Map<ElementId, Element>();
  let stats = new Map<StatKey, ResolvedStat>();
  let passes = 0;
  let changed = true;

  while (changed && passes < maxPasses) {
    passes++;
    const next = new Map<ElementId, Element>();
    const ctx = makeContext(active, stats, character, kind);

    // Seed: everything the user explicitly chose.
    for (const id of chosenIds) addElement(next, index, id, problems);

    // Fixed-point expansion of grants.
    let frontier = [...next.values()];
    const seen = new Set(next.keys());
    while (frontier.length) {
      const nextFrontier: Element[] = [];
      for (const element of frontier) {
        for (const rule of activeRules(element, character, kind, ctx)) {
          if (rule.kind !== 'grant') continue;
          if (seen.has(rule.id)) continue;
          const granted = addElement(next, index, rule.id, problems, element.id);
          seen.add(rule.id);
          if (granted) nextFrontier.push(granted);
        }
      }
      frontier = nextFrontier;
    }

    const nextStats = computeStats(next, character, kind, makeContext(next, stats, character, kind));

    changed = !sameKeys(active, next) || !sameStats(stats, nextStats);
    active = next;
    stats = nextStats;
  }

  if (passes >= maxPasses) {
    problems.push({
      level: 'warning',
      code: 'cycle-limit',
      message: `Derivation did not settle after ${maxPasses} passes. The content may contain a requirement cycle.`,
    });
  }

  const ctx = makeContext(active, stats, character, kind);
  const pendingChoices = collectPendingChoices(active, character, kind, index, ctx, problems);

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
): Element | undefined {
  if (into.has(id)) return into.get(id);
  const element = index.get(id);
  if (!element) {
    problems.push({
      level: 'error',
      code: 'unresolved-element',
      message: grantedBy
        ? `"${grantedBy}" grants "${id}", which is not in any loaded source.`
        : `"${id}" is not in any loaded source.`,
      elementId: id,
    });
    return undefined;
  }
  into.set(id, element);
  return element;
}

/**
 * Rules of an element that currently apply: progression gate met, requirements satisfied.
 *
 * `rule.level` is Aurora's `level="N"` attribute and keeps that name because that is what
 * the content says. It gates on the kind's progression number, whatever that number counts.
 * A kind with `progression.kind: "none"` has nothing to compare against, so gates are
 * ignored rather than read as unmet: a level-less system cannot express "at level N", and
 * dropping every gated rule would be the wrong reading of content imported from one that can.
 */
function activeRules(
  element: Element,
  character: Character,
  kind: ResolvedCharacterKind,
  ctx: EngineContext,
): Rule[] {
  const gated = kind.progression.kind !== 'none';
  return element.rules.filter((rule) => {
    if (gated && rule.level !== undefined && character.progress < rule.level) return false;
    return evaluateRequirements(rule.requirements, ctx);
  });
}

function computeStats(
  active: Map<ElementId, Element>,
  character: Character,
  kind: ResolvedCharacterKind,
  ctx: EngineContext,
): Map<StatKey, ResolvedStat> {
  const buckets = new Map<StatKey, StatRule[]>();
  const owners = new Map<StatRule, ElementId>();

  for (const element of active.values()) {
    for (const rule of activeRules(element, character, kind, ctx)) {
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
    let value = evaluateExpr(def.derive, derivedCtx) + (result.get(key)?.value ?? 0);
    value = clamp(value, def);
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

  // Manual overrides win over everything. See docs/adr/0006.
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

function clamp(value: number, def: StatDef): number {
  let v = value;
  if (def.min !== undefined) v = Math.max(v, def.min);
  if (def.max !== undefined) v = Math.min(v, def.max);
  return v;
}

function collectPendingChoices(
  active: Map<ElementId, Element>,
  character: Character,
  kind: ResolvedCharacterKind,
  index: ElementIndex,
  ctx: EngineContext,
  problems: Problem[],
): PendingChoice[] {
  const pending: PendingChoice[] = [];

  for (const element of active.values()) {
    for (const rule of activeRules(element, character, kind, ctx)) {
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
        candidates: candidatesFor(rule, index, chosen).map((e) => e.id),
        from: element.id,
      });
    }
  }

  return pending;
}

/** Elements a select rule would accept, excluding ones already chosen for it. */
export function candidatesFor(rule: SelectRule, index: ElementIndex, exclude: ElementId[] = []): Element[] {
  const excluded = new Set(exclude);
  const pool = index.byType(rule.type);
  return pool.filter((candidate) => {
    if (excluded.has(candidate.id)) return false;
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

/** Every element id the content references. Used by the CLI to validate a source. */
export function referencedElementIds(elements: Iterable<Element>): Set<string> {
  const ids = new Set<string>();
  for (const element of elements) {
    for (const rule of element.rules) {
      if (rule.kind === 'grant') ids.add(rule.id);
      if (rule.kind === 'select' && rule.default) ids.add(rule.default);
      referencedIds(rule.requirements, ids);
    }
    referencedIds(element.multiclass?.requirements, ids);
    for (const rule of element.multiclass?.rules ?? []) {
      if (rule.kind === 'grant') ids.add(rule.id);
      referencedIds(rule.requirements, ids);
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
