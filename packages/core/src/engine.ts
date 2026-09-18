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

import type {
  DeclaredBlock,
  Element,
  ElementId,
  ElementIndex,
  Rule,
  StatKey,
  SelectRule,
  StatRule,
} from './model.ts';
import { declaredBlockName } from './model.ts';
import type { Character } from './character.ts';
import { advancementCounts, advancementElementIds, equippedElementIds } from './character.ts';
import type {
  BlockFilterDef,
  GameSystem,
  ResolvedCharacterKind,
  StatDef,
} from './system.ts';
import {
  baselineElementIds,
  collectDeclaredBlocks,
  expandBlockFilter,
  progressionStat,
  resolveCharacterKind,
  substituteBlockPlaceholders,
  trackStatKey,
  trackStatName,
  contributionCondition,
  sumRecordedRolls,
  TRACK_PROGRESS_STAT,
} from './system.ts';
import { evaluateRequirements, referencedIds, type RequirementContext } from './requirements.ts';
import { EMPTY_EQUIPMENT, resolveEquipment, type EquipmentState } from './equipment.ts';
import {
  evaluateExpr,
  evaluateExprAsString,
  type ExpressionContext,
  type StatExpr,
} from './expression.ts';
import {
  matchesSupports,
  supportsInterpolations,
  type SupportsContext,
  type SupportsExpr,
} from './supports.ts';

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
  /**
   * Which of `candidates` and `chosen` may fill more than one slot of this pool — ADR 0035.
   * A +1 to Constitution is repeatable, so choosing it twice is a +2; a language is not. Always
   * a subset of the two lists it describes, and empty for a kind that names no
   * `repeatableSetter`.
   */
  repeatable: ElementId[];
  /**
   * `$(…)` terms in this pool's filter that nothing resolves, so `candidates` is short.
   *
   * An unresolved interpolation matches nothing rather than everything, which is the safe
   * reading — but it makes an unimplemented filter look exactly like missing content. Naming the
   * term is what lets a builder say which of the two it is. Empty in every other case.
   */
  unresolvedSupports: string[];
  from: ElementId;
  /**
   * The progression point this became available at — the `level` on the rule that opened
   * it, where it has one. What lets a builder say "Rogue 4: Ability Score Improvement"
   * instead of listing an unexplained choice (ADR 0017).
   *
   * Read it the way the gate reads it: this is a level in the granting element's *track*,
   * not the character's total (ADR 0015). On a Rogue 5 / Wizard 3 a wizard rule's `level: 3`
   * means wizard 3, which arrived at character level 8.
   */
  level?: number;
}

/**
 * A `select` pool with nothing left to choose — the settled counterpart of `PendingChoice`.
 *
 * `pendingChoices` only ever lists what is still outstanding, and that contract is not moving:
 * the CLI reports its length as "choices pending" and the self-containment test reads it as
 * "what is open". A pool that fills its last slot needs somewhere to keep being editable
 * rather than vanishing outright — a wizard's second cantrip should stay changeable exactly as
 * its first one was — and this is that somewhere.
 */
export interface AnsweredChoice {
  ruleKey: string;
  label: string;
  type: string;
  optional: boolean;
  /** Every slot's answer, in the order it was recorded. */
  chosen: ElementId[];
  /**
   * What a slot could hold instead of its own answer.
   *
   * The same computation `pendingChoices` makes while a pool is open — every rule's candidates,
   * minus everything `active` (which already covers every id in `chosen`, this pool's own
   * included). A view that wants to let one slot keep its current answer adds it back for that
   * slot alone; adding it to every slot would let two slots agree on one answer, which nothing
   * here or in `character.choices` forbids but a view should not offer.
   */
  candidates: ElementId[];
  /** As on `PendingChoice`: which of `candidates` and `chosen` may fill more than one slot. */
  repeatable: ElementId[];
  unresolvedSupports: string[];
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
    // Attuned to more items than the limit allows — ADR 0023 decision 3, ADR 0026. In
    // `over-selected`'s family: reported, and never a refusal to derive.
    | 'over-attuned'
    | 'cycle-limit'
    | 'ambiguous-track'
    | 'unresolved-interpolation'
    // The bag, read through the kind's inventory declaration — ADR 0025, ADR 0023.
    | 'slot-unknown'
    | 'slot-full'
    | 'unattuned';
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
  /** Every `select` pool with nothing left to choose — the counterpart `pendingChoices` never
   * lists once a pool is full, and where a slot stays editable after it is. */
  answeredChoices: AnsweredChoice[];
  problems: Problem[];
  /**
   * What the character's slots hold — ADR 0025. Carried on the result because it is computed
   * once, before the fixed point, and because a sheet and a candidate filter both want it
   * without resolving the bag a second time.
   */
  equipment: EquipmentState;
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
  // What the character is wearing and wielding, and whatever is attached to it — step 3 of
  // docs/INVENTORY-AND-AC-PLAN.md. An equipped item is a seed in exactly the sense a choice
  // is: the user put it there, no formula produced it, and its rules are the element's own.
  //
  // A *carried* entry seeds nothing, and that asymmetry against `collectCharacterContent`,
  // which embeds the whole bag, is deliberate (ADR 0024 decision 7). It is also the one
  // half of this Aurora can referee: 26 of 26 equipped items across the nine sample saves
  // are in its own `<sum>` and 18 of 19 carried ones are not.
  //
  // What each slot holds is resolved here, once, and not inside the loop below: occupancy is a
  // function of the bag and the index and never of the derivation, so there is nothing for a
  // fixed point to settle. `chosenIds` is passed as the exemption set *before* the bag is added
  // to it — an element the character has for another reason is never suppressed by an unattuned
  // instance of itself (ADR 0025 decision 7).
  const equipment = kind.inventory
    ? resolveEquipment(character, index, kind.inventory, { exempt: new Set(chosenIds) })
    : EMPTY_EQUIPMENT;
  for (const issue of equipment.issues) {
    problems.push({
      level: 'warning',
      code: issue.code,
      message: issue.message,
      elementId: issue.elementId,
    });
  }
  for (const id of equippedElementIds(character)) chosenIds.add(id);

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
    // Element -> *every* track root that reaches it. `nextTracks` answers "which level gates
    // this rule" and takes the first, which is ADR 0015's deliberate choice; this answers
    // "which tracks contain this", where taking the first is simply wrong (ADR 0018). A Bard 5
    // / Wizard 5 grants one shared marker element from two tracks, and counting it once halves
    // the character's caster level.
    const nextMembers = new Map<ElementId, Set<ElementId>>();
    const levelFor = trackLevelReader(nextTracks, trackLevels, character.progress);
    const ctx = makeContext(active, stats, character, kind, equipment);

    // Seed: everything the user explicitly chose, and the kind's own baseline.
    for (const id of chosenIds) {
      addElement(next, index, id, problems, undefined, baselineIds.has(id));
    }
    // Each element progression was spent on roots its own track. Done before the expansion
    // so a grant made by a track root inherits it on the first step.
    for (const id of trackLevels.keys()) {
      if (!next.has(id)) continue;
      nextTracks.set(id, id);
      nextMembers.set(id, new Set([id]));
    }

    // Fixed-point expansion of grants.
    let frontier = [...next.values()];
    const seen = new Set(next.keys());
    while (frontier.length) {
      const nextFrontier: Element[] = [];
      for (const element of frontier) {
        for (const rule of activeRules(element, character, kind, ctx, levelFor, equipment)) {
          if (rule.kind !== 'grant') continue;
          inheritTrack(nextTracks, nextMembers, element.id, rule.id, index.get(rule.id), problems);
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
      makeContext(next, stats, character, kind, equipment),
      levelFor,
      trackLevels,
      nextMembers,
      problems,
      equipment,
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

  // Attuned to more than the limit allows — ADR 0023 decision 3. Once, after the fixed point,
  // because the limit is a derived number: the kind contributes a base and content raises it,
  // and asking mid-loop would report a character over a limit that had not finished arriving.
  reportAttunementLimit(kind, stats, equipment, problems);

  const ctx = makeContext(active, stats, character, kind, equipment);
  const { pending: pendingChoices, answered: answeredChoices } = collectPendingChoices(
    active,
    character,
    kind,
    index,
    ctx,
    problems,
    trackLevelReader(tracks, trackLevels, character.progress),
    equipment,
    makeBlockFilterResolver(kind, active, stats),
  );

  return {
    character,
    system,
    kind,
    elements: [...active.values()],
    elementIds: new Set(active.keys()),
    stats,
    pendingChoices,
    answeredChoices,
    equipment,
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
  equipment: EquipmentState,
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
    // The one place `character.rolls` is read — ADR 0019. Until this existed the field was
    // written by the importer, round-tripped through the container, and consumed by nothing.
    rollSum: (pattern) =>
      sumRecordedRolls(character.rolls, kind.progression, character.progress, pattern),
    // What the character's slots hold — ADR 0025. `undefined` for every stat that is not a
    // slot, which is what leaves the corpus's eight `[type:spell]` checks comparing a string.
    statTags: (stat) => equipment.tags.get(stat.toLowerCase()),
    hasFlag: (name) => stats.has(name.toLowerCase()),
  };
}

/**
 * A requirement context over a **finished** derivation.
 *
 * `makeContext` above builds one per pass, out of the maps that pass is still filling. This one
 * is for callers outside the fixed point — a builder asking "which races may this character
 * take?" — and reads the settled result instead.
 *
 * Exported so the UI layer cannot grow a second, subtly different answer to the same four
 * questions. A candidate list filtered by a context that disagreed with the engine's would offer
 * the user an option the derivation then refuses, which is the worst kind of wrong.
 */
export function requirementContextFor(derived: DerivedCharacter): RequirementContext {
  const active = new Map(derived.elements.map((element) => [element.id, element]));
  return makeContext(active, derived.stats, derived.character, derived.kind, derived.equipment);
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

/**
 * Being attuned to more items than the rules allow — ADR 0023 decision 3.
 *
 * A problem in `over-selected`'s family and not a refusal, for the same reason: a system
 * definition is authored once and a character is edited constantly, so a character mid-edit is
 * routinely in a state the rules do not permit. The engine reports and keeps deriving.
 *
 * Both stats come from the kind's inventory declaration, because core cannot say "attunement".
 * A kind that names neither gets no check, which is what a system with no such concept wants.
 */
function reportAttunementLimit(
  kind: ResolvedCharacterKind,
  stats: Map<StatKey, ResolvedStat>,
  equipment: EquipmentState,
  problems: Problem[],
): void {
  const attunement = kind.inventory?.attunement;
  if (!equipment.declared || !attunement?.maxStat) return;
  const limit = stats.get(attunement.maxStat.toLowerCase())?.value ?? 0;
  if (equipment.attunedCount <= limit) return;
  problems.push({
    level: 'error',
    code: 'over-attuned',
    message: `Attuned to ${equipment.attunedCount} items, and "${attunement.maxStat}" allows ${limit}. Unattune from ${equipment.attunedCount - limit} of them, or expect a sheet the rules do not permit.`,
  });
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
  members: Map<ElementId, Set<ElementId>>,
  from: ElementId,
  to: ElementId,
  granted: Element | undefined,
  problems: Problem[],
): void {
  // Membership first, and unconditionally: every grant edge records every track behind it,
  // including edges to an element another track already reached. That is the case the
  // first-wins map below deliberately loses (ADR 0018).
  //
  // The one thing this does not chase is a *descendant* of an element whose second track
  // arrived after the descendant was expanded. Every use so far is a leaf marker, and
  // widening it would mean a second fixed point inside the expansion.
  const inherited = members.get(from);
  if (inherited?.size) {
    const existingMembers = members.get(to);
    if (existingMembers) for (const root of inherited) existingMembers.add(root);
    else members.set(to, new Set(inherited));
  }

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
 *
 * `rule.equipped` is read exactly the same way, and for the same reason (ADR 0025). A kind
 * that declares no inventory has no slot for `[armor:none]` to be about, and ADR 0021
 * measured what evaluating in that state does: it drops all 41 positive checks and keeps all
 * 38 negations, leaving a monk simultaneously not-unarmoured and not-in-heavy-armour. So a
 * kind without an inventory ignores the condition, exactly as it ignores a level gate it
 * cannot answer.
 *
 * An element the bag brought in that wants attunement it has not got contributes nothing at
 * all — ADR 0023, and the one place in the engine that is enforced.
 */
function activeRules(
  element: Element,
  character: Character,
  kind: ResolvedCharacterKind,
  ctx: EngineContext,
  levelFor: TrackLevelReader,
  equipment: EquipmentState,
): Rule[] {
  if (equipment.suppressed.has(element.id)) return [];
  const gated = kind.progression.kind !== 'none';
  const level = gated ? levelFor(element.id) : 0;
  return element.rules.filter((rule) => {
    if (gated && rule.level !== undefined && level < rule.level) return false;
    if (!evaluateRequirements(rule.requirements, ctx)) return false;
    if (!equipment.declared) return true;
    return evaluateRequirements('equipped' in rule ? rule.equipped : undefined, ctx);
  });
}

function computeStats(
  active: Map<ElementId, Element>,
  character: Character,
  kind: ResolvedCharacterKind,
  ctx: EngineContext,
  levelFor: TrackLevelReader,
  trackLevels: Map<ElementId, number>,
  trackMembers: Map<ElementId, Set<ElementId>>,
  problems: Problem[],
  equipment: EquipmentState,
): Map<StatKey, ResolvedStat> {
  const buckets = new Map<StatKey, StatRule[]>();
  const owners = new Map<StatRule, ElementId>();
  const contribute = (rule: StatRule, from: ElementId): void => {
    const key = rule.name.toLowerCase();
    const list = buckets.get(key);
    if (list) list.push(rule);
    else buckets.set(key, [rule]);
    owners.set(rule, from);
  };

  // An element the character chose several times applies its rules that many times — ADR 0035.
  // A +2 to one score is the same +1 element taken twice, and Aurora's own `<sum>` lists it
  // twice for exactly that reason.
  const repeats = repeatCounts(character, active, kind);
  for (const element of active.values()) {
    const times = repeats.get(element.id) ?? 1;
    for (const rule of activeRules(element, character, kind, ctx, levelFor, equipment)) {
      if (rule.kind !== 'stat') continue;
      contribute(rule, element.id);
      // A copy each time: `owners` is keyed on the rule object, and one object listed twice
      // would be one contribution wearing two names.
      for (let again = 1; again < times; again++) contribute({ ...rule }, element.id);
    }
  }

  // What the kind itself contributes — ADR 0022. These join content's rules *in the same
  // buckets* rather than landing after them, and that is the whole point of putting them here:
  // 5e contributes `ac:armored:dexterity:cap` 2 in the `base` bucket, and Medium Armor Master's
  // 3 has to beat it rather than stack with it. Summed afterwards, a character with that feat
  // in half plate would read a cap of 5.
  //
  // The condition is evaluated against this pass's context, exactly as a content rule's
  // `requirements` is — including `[armor:medium]`, which reads the equipment state settled
  // before the loop began.
  for (const def of kind.contributions) {
    if (!evaluateRequirements(contributionCondition(def), ctx)) continue;
    contribute(
      { kind: 'stat', key: `kind:${def.stat}`, name: def.stat, value: def.value, bonus: def.bonus },
      'kind',
    );
  }

  // How many items the character is attuned to — ADR 0023 decision 3. A contribution and not a
  // published input, because content writes this key too: 5e's Soul of Artifice contributes
  // `attunement:current` 0, and an input stat would have discarded it.
  const countStat = kind.inventory?.attunement?.countStat;
  if (equipment.declared && countStat) {
    contribute(
      {
        kind: 'stat',
        key: 'inventory:attuned',
        name: countStat,
        value: { kind: 'number', value: equipment.attunedCount },
      },
      'inventory',
    );
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

  // What each track contributes — ADR 0018. These are contributions like any other, so they
  // land here, after content's and before the derivations that read them. The kind cannot
  // name the tracks (content ships its own), so it says "for every track that contains this
  // element, add this much", and `track:progress` inside the expression is that track's count.
  for (const [rootId, count] of trackLevels) {
    const root = active.get(rootId);
    if (!root) continue;
    const trackCtx: ExpressionContext = {
      statNumber: (s) => (s.toLowerCase() === TRACK_PROGRESS_STAT ? count : ctx.statNumber(s)),
      statString: ctx.statString,
      rollSum: ctx.rollSum,
    };
    for (const def of kind.trackStats) {
      if (def.when !== undefined && !trackMembers.get(def.when)?.has(rootId)) continue;
      const key = trackStatName(def, root.name);
      const lower = key.toLowerCase();
      const value = evaluateExpr(def.value, trackCtx);
      const existing = result.get(lower);
      result.set(lower, {
        name: existing?.name ?? key,
        value: (existing?.value ?? 0) + value,
        text: existing?.text,
        contributions: [...(existing?.contributions ?? []), { value, from: rootId }],
      });
    }
  }

  // What each declared block contributes — ADR 0020. Alongside the track contributions
  // above, and for the same reason: the kind cannot name the blocks, so it says "for every
  // block, publish this", and `{name}` and `{ability}` are filled in from the block itself.
  //
  // Landing here rather than in the derivations is what lets content's own item bonuses —
  // a rod of the pact keeper's `warlock:spellcasting:dc` — sit in the same stat and sum.
  for (const block of collectDeclaredBlocks(active.values())) {
    for (const def of kind.blockStats) {
      const key = substituteBlockPlaceholders(def.stat, block);
      // A ref whose placeholder does not resolve would otherwise read a stat named
      // `{ability}:modifier`, which nothing declares, and quietly contribute a DC eight
      // points low. Better to publish nothing and say why (ADR 0005).
      let unresolved: string | undefined;
      const blockCtx: ExpressionContext = {
        statNumber: (s) => {
          const name = substituteBlockPlaceholders(s, block);
          if (name === undefined) unresolved ??= s;
          return name === undefined ? 0 : ctx.statNumber(name);
        },
        statString: (s) => {
          const name = substituteBlockPlaceholders(s, block);
          if (name === undefined) unresolved ??= s;
          return name === undefined ? undefined : ctx.statString(name);
        },
        rollSum: ctx.rollSum,
      };
      const value = evaluateExpr(def.value, blockCtx);
      if (key === undefined || unresolved !== undefined) {
        problems.push({
          level: 'warning',
          code: 'unresolved-interpolation',
          message: `The "${def.stat}" stat is published per block, and the "${block.name}" block declares nothing for "${key === undefined ? def.stat : unresolved}". Nothing is contributed for it.`,
        });
        continue;
      }
      const lower = key.toLowerCase();
      const existing = result.get(lower);
      result.set(lower, {
        name: existing?.name ?? key,
        value: (existing?.value ?? 0) + value,
        text: existing?.text,
        contributions: [...(existing?.contributions ?? []), { value, from: `block:${block.name}` }],
      });
    }
  }

  // Derived stats last — they read the contributed values above.
  for (const def of kind.stats) {
    if (!def.derive) continue;
    const key = def.name.toLowerCase();
    const derivedCtx: ExpressionContext = {
      statNumber: (s) => (s.toLowerCase() === key ? 0 : ctx.statNumber(s)),
      statString: ctx.statString,
      rollSum: ctx.rollSum,
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

  // Each slot publishes what is in it — ADR 0025. An input in the same sense as the two
  // blocks around it: nothing contributes to `armor` and nothing derives it, and this is what
  // puts it on the sheet rather than what makes the conditions work. The conditions read the
  // resolved equipment state, which was settled before the first pass.
  //
  // `text` is the occupant's name, or the empty tag for a slot with nothing in it, so a sheet
  // can say "Plate" and a reader can tell "unarmoured" from "unmodelled". Safe because the 740
  // corpus files write no `<stat name="armor">`, `"shield"`, `"primary"` or `"secondary"`.
  for (const [key, tags] of equipment.tags) {
    const occupant = equipment.occupants.get(key);
    result.set(key, {
      name: result.get(key)?.name ?? key,
      value: 0,
      text: occupant?.name ?? [...tags][0],
      contributions: occupant ? [{ value: 0, from: occupant.elementId }] : [],
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
    rollSum: ctx.rollSum,
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

/**
 * Whether an element may be taken more than once, by the setter the kind names — ADR 0035.
 *
 * Present and not `false`, which is how a flag setter reads everywhere else. A kind that names
 * no setter has no repeatable elements, so this is false for all of them and the engine behaves
 * exactly as it did before the field existed.
 */
function isRepeatable(element: Element | undefined, kind: ResolvedCharacterKind): boolean {
  const name = kind.repeatableSetter;
  if (!name || !element) return false;
  const setter = element.setters[name];
  if (!setter) return false;
  return setter.value.trim().toLowerCase() !== 'false';
}

/**
 * How many times the character chose each repeatable element, where that is more than once.
 *
 * Counted across every recorded choice rather than within one pool: a Constitution bump taken at
 * level 4 and again at level 8 is two picks in two pools and is +2 all the same. An element that
 * is not repeatable never appears here, so choosing Athletics twice is still one Athletics.
 */
function repeatCounts(
  character: Character,
  active: Map<ElementId, Element>,
  kind: ResolvedCharacterKind,
): Map<ElementId, number> {
  const counts = new Map<ElementId, number>();
  if (!kind.repeatableSetter) return counts;
  for (const choice of character.choices) {
    for (const id of choice.elementIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, times] of counts) {
    if (times < 2 || !isRepeatable(active.get(id), kind)) counts.delete(id);
  }
  return counts;
}

function collectPendingChoices(
  active: Map<ElementId, Element>,
  character: Character,
  kind: ResolvedCharacterKind,
  index: ElementIndex,
  ctx: EngineContext,
  problems: Problem[],
  levelFor: TrackLevelReader,
  equipment: EquipmentState,
  filters: BlockFilterResolver | undefined,
): { pending: PendingChoice[]; answered: AnsweredChoice[] } {
  const pending: PendingChoice[] = [];
  const answered: AnsweredChoice[] = [];

  // What a pool's own answers exclude from what it offers next: everything except an element
  // the kind lets be taken again (ADR 0035).
  const unrepeatable = (ids: ElementId[]): ElementId[] =>
    ids.filter((id) => !isRepeatable(index.get(id), kind));
  const repeatableAmong = (ids: ElementId[]): ElementId[] => [
    ...new Set(ids.filter((id) => isRepeatable(index.get(id), kind))),
  ];

  for (const element of active.values()) {
    for (const [ruleKey, rules] of selectPools(element, character, kind, ctx, levelFor, equipment)) {
      const chosen = character.choices.find((c) => c.ruleKey === ruleKey)?.elementIds ?? [];
      const allowed = rules.reduce((sum, rule) => sum + rule.number, 0);
      const label = rules[0]!.name;

      if (chosen.length > allowed) {
        problems.push({
          level: 'error',
          code: 'over-selected',
          message: `"${label}" allows ${allowed} choice(s) but ${chosen.length} are recorded.`,
          elementId: element.id,
          ruleKey,
        });
      }

      const remaining = allowed - chosen.length;
      if (remaining <= 0) {
        // Full, not gone: what a slot could hold instead is the same question `candidatesFor`
        // answers while a pool is open, asked of every rule rather than just the ones with
        // room — none do, so "every rule" and "the rules with room" are the same set anyway.
        const candidates = new Set<ElementId>();
        const unresolvedSupports = new Set<string>();
        for (const rule of rules) {
          for (const candidate of candidatesFor(rule, index, unrepeatable(chosen), ctx, filters)) {
            if (active.has(candidate.id) && !isRepeatable(candidate, kind)) continue;
            candidates.add(candidate.id);
          }
          for (const key of supportsInterpolations(rule.supports)) {
            if (filters?.expand(rule, key) === undefined) unresolvedSupports.add(key);
          }
        }
        answered.push({
          ruleKey,
          label,
          type: rules[0]!.type,
          optional: rules.every((rule) => rule.optional ?? false),
          chosen: [...chosen],
          candidates: [...candidates],
          repeatable: repeatableAmong([...candidates, ...chosen]),
          unresolvedSupports: [...unresolvedSupports],
          from: element.id,
        });
        continue;
      }

      // Which rules still have room. Picks fill the pool in level order — the order the
      // importer writes them in and the order a character is actually built in — so the
      // first rule whose capacity is not used up is where the next pick lands.
      let filled = chosen.length;
      let at = 0;
      while (at < rules.length && filled >= rules[at]!.number) {
        filled -= rules[at]!.number;
        at++;
      }
      const open = rules.slice(at);
      const next = open[0]!;

      // The union across the rules with room left, deduplicated. The rules of one pool can
      // genuinely differ — a wizard's first six spellbook entries are 1st level and the two
      // it adds every level afterwards go up to its highest slot — so no single rule's list
      // covers the remaining picks. Over-inclusive rather than short, which is the same call
      // `candidatesFor` already makes about an element's own requirements.
      const candidates = new Set<ElementId>();
      for (const rule of open) {
        for (const candidate of candidatesFor(rule, index, unrepeatable(chosen), ctx, filters)) {
          // Not something the character already has. An elf offered Elvish by a background's
          // "two languages of your choice" is being offered a pick that does nothing, and no
          // content file can say so: the select names a support tag and every language-granting
          // race writes a plain grant. Neither knows about the other, so the overlap exists
          // only once a character puts the two together — which is here and nowhere else.
          //
          // The same rule `candidatesFor` already applies to `chosen`, widened from "this pool
          // picked it" to "the character has it". It stays out of `candidatesFor`, which
          // answers what a *rule* accepts and has no character to ask.
          //
          // Safe against the case that looks like a counter-example: a rogue's Expertise
          // offers `ID_EXPERTISE_SKILL_ACROBATICS`, a Class Feature, while the proficiency it
          // requires is `ID_PROFICIENCY_SKILL_ACROBATICS`. Different elements, so wanting the
          // one you have is expressed by having the other.
          //
          // Except what the kind marks repeatable, which is offered again by design — ADR 0035.
          if (active.has(candidate.id) && !isRepeatable(candidate, kind)) continue;
          candidates.add(candidate.id);
        }
      }

      pending.push({
        ruleKey,
        label,
        // The type and the optionality of the rule the next pick lands in, except that a
        // pool is only optional when every rule in it is: one required entry makes the
        // whole pool something the character owes an answer to.
        type: next.type,
        remaining,
        number: allowed,
        optional: rules.every((rule) => rule.optional ?? false),
        candidates: [...candidates],
        repeatable: repeatableAmong([...candidates, ...chosen]),
        // Across the whole pool, not just the next rule: any rule with room left can be the
        // one whose filter cannot be evaluated. Only the terms that really did not resolve —
        // before ADR 0030 nothing resolved, so listing every interpolation was the same list.
        unresolvedSupports: [
          ...new Set(
            open.flatMap((rule) =>
              [...supportsInterpolations(rule.supports)].filter(
                (key) => filters?.expand(rule, key) === undefined,
              ),
            ),
          ),
        ],
        from: element.id,
        level: next.level,
      });
    }
  }

  return { pending, answered };
}

/**
 * An element's active `select` rules, grouped into the pools they actually form.
 *
 * Aurora writes a growing allowance as several `<select>` rules sharing one name, one per
 * level that widens it:
 *
 * ```xml
 * <select name="Cantrip (Warlock)" level="1" number="2" />
 * <select name="Cantrip (Warlock)" level="4" />
 * <select name="Cantrip (Warlock)" level="10" />
 * ```
 *
 * That is one pool of four cantrips, not three separate questions, and the save format says
 * so: a decision records the `name` it belongs to plus the `requiredLevel` and `number` of
 * the slot it fills. The importer reads it that way too — one `Choice` keyed
 * `<owner>/select:<name>`, which is the only key `setChoice` and a builder's `OpenDecision`
 * can address.
 *
 * The engine used to check each rule's own `number` against the whole recorded list, so a
 * warlock with the four cantrips it is owed reported two errors and a wizard with a full
 * spellbook reported two more. Grouping is what makes the engine agree with the format it
 * reads and with the file it wrote.
 *
 * Sorted by level, ties in declaration order — the importer sorts recorded picks the same
 * way, so slot *n* of the pool means the same thing on both sides.
 */
function selectPools(
  element: Element,
  character: Character,
  kind: ResolvedCharacterKind,
  ctx: EngineContext,
  levelFor: TrackLevelReader,
  equipment: EquipmentState,
): Map<string, SelectRule[]> {
  const pools = new Map<string, SelectRule[]>();
  for (const rule of activeRules(element, character, kind, ctx, levelFor, equipment)) {
    if (rule.kind !== 'select') continue;
    const ruleKey = `${element.id}/${rule.key}`;
    const pool = pools.get(ruleKey);
    if (pool) pool.push(rule);
    else pools.set(ruleKey, [rule]);
  }
  for (const pool of pools.values()) {
    pool.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
  }
  return pools;
}


/**
 * Expands the `$(key)` interpolations a select's filter carries — ADR 0030.
 *
 * Built once per derivation, after the fixed point, because both halves it needs are settled
 * by then: which blocks the character's elements declare, and what the derivation published
 * for each of them. The old comment here claimed the UI layer supplied this context. It never
 * did, no caller ever could have, and the sentence outlived two wrong diagnoses; it is gone
 * rather than corrected, because the context is a property of the character and the rule and
 * belongs nowhere near a screen.
 */
export interface BlockFilterResolver {
  expand(rule: SelectRule, key: string): SupportsExpr | undefined;
}

/**
 * The resolver for one derivation, or nothing when the kind declares no `blockFilters`.
 *
 * Memoised per (block, key): a candidate list runs the filter once per element in the pool,
 * which for a spell select is 1,079 elements, and re-scanning every stat for each of them
 * would make an expansion quadratic for no reason.
 */
function makeBlockFilterResolver(
  kind: ResolvedCharacterKind,
  active: Map<ElementId, Element>,
  stats: Map<StatKey, ResolvedStat>,
): BlockFilterResolver | undefined {
  if (kind.blockFilters.length === 0) return undefined;
  const blocks = new Map<string, DeclaredBlock>();
  for (const block of collectDeclaredBlocks(active.values())) {
    blocks.set(block.name.trim().toLowerCase(), block);
  }
  const defs = new Map<string, BlockFilterDef>();
  for (const def of kind.blockFilters) defs.set(def.key.trim().toLowerCase(), def);
  const statValues: (readonly [StatKey, number])[] = [...stats].map(
    ([name, stat]) => [name, stat.value] as const,
  );
  const cache = new Map<string, SupportsExpr | undefined>();

  return {
    expand(rule, key) {
      // Which block the rule is attached to is the rule's to say, and every one of the 323
      // interpolated selects in the corpus says it. A rule naming no block, or naming one
      // nothing declares, resolves nothing rather than guessing at the only block present.
      const blockName = declaredBlockName(rule);
      if (blockName === undefined) return undefined;
      const cacheKey = blockName + '\u0000' + key;
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      const block = blocks.get(blockName);
      const def = defs.get(key.trim().toLowerCase());
      const expanded =
        block === undefined || def === undefined
          ? undefined
          : expandBlockFilter(def, block, statValues);
      cache.set(cacheKey, expanded);
      return expanded;
    },
  };
}

/** A candidate's setter values, lowercased — the other half of what an operand may name. */
function setterValues(element: Element): ReadonlySet<string> {
  const values = new Set<string>();
  for (const setter of Object.values(element.setters)) {
    const value = setter.value?.trim().toLowerCase();
    if (value) values.add(value);
  }
  return values;
}

/**
 * Elements a select rule would accept, excluding ones already chosen for it.
 *
 * `context` is optional and only affects elements carrying their own `requirements` — the
 * Human Variant, which exists only in a campaign using feats. Without a context those
 * elements stay in the list: a candidate list built with no knowledge of the character is
 * better over-inclusive than silently short.
 *
 * `filters` is optional for the same reason and behaves the opposite way: without it a
 * `$(…)` term resolves to nothing and the filter matches nothing, which is deliberately
 * *short* rather than over-inclusive. A filter Incudo cannot evaluate that silently offered
 * the whole spell catalogue would look like a working feature (ADR 0030).
 */
export function candidatesFor(
  rule: SelectRule,
  index: ElementIndex,
  exclude: ElementId[] = [],
  context?: RequirementContext,
  filters?: BlockFilterResolver,
): Element[] {
  const excluded = new Set(exclude);
  const pool = index.byType(rule.type);
  return pool.filter((candidate) => {
    if (excluded.has(candidate.id)) return false;
    if (context && !evaluateRequirements(candidate.requirements, context)) return false;
    const ctx: SupportsContext = {
      tags: new Set(candidate.supports.map((s) => s.toLowerCase())),
      // A spell's level and school are setters and not tags — ADR 0030.
      setterValues: setterValues(candidate),
      id: candidate.id,
      resolve: (key) => filters?.expand(rule, key),
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
