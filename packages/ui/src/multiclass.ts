/**
 * Which class each level was spent on — ADR 0036, on top of ADR 0015's `advancement`.
 *
 * A level is spent on a class by writing **two** records, and a builder that writes one builds a
 * wrong character with no error anywhere. `Character.advancement` says which class each point of
 * progression went to, which is what level gates and hit dice read. The class's own *multiclass
 * element* says the class was taken as a second one, which is what grants the reduced proficiency
 * set, switches the full one off, and carries `ID_INTERNAL_GRANT_MULTICLASS` — the marker every
 * multiclass slot-weighting grant is gated on. Measured on the oracle character: keep the first,
 * drop the second, and caster level goes 1 → 0, every slot with it, and an unearned "choose two
 * skills" opens.
 *
 * Everything here is a pure function of a character, its elements and the step's declaration, so
 * `BuilderStep.classLevels` and the two builder methods that write are tested under
 * `node --test` and `apps/desktop` computes nothing (CODE-REUSE-POLICY rule 2).
 *
 * No game noun in it. "Class" is `levelRoll.classType` — the type the system says governs a
 * level, which `LevelRollDef` has always documented as the thing `advancement` names — and a
 * multiclass element is whatever an element's own `multiclass` block declares the id of.
 */

import {
  evaluateRequirements,
  requirementContextFor,
  type RequirementContext,
  setAdvancement,
  setChoice,
  setRoll,
  type AdvancementEntry,
  type BuildStepDef,
  type Character,
  type Choice,
  type DerivedCharacter,
  type Element,
  type ElementId,
  type ElementIndex,
  type ElementType,
  type LevelRollDef,
  type Progression,
  type RequirementExpr,
} from '@incudo/core';

import { parseDice } from './dice.ts';
import { hitPointRollKey, progressionMin } from './hitpoints.ts';

/** What a step declares that a class levels view needs. Undefined for a step that has none. */
export interface MulticlassConfig {
  /** The element type a level is spent on — `levelRoll.classType`. */
  classType: ElementType;
  /** Where a level's hit die is read and its roll recorded; a change of die voids a roll. */
  levelRoll: LevelRollDef;
  /** `progression.elementIdPattern`, when the kind has one — what keys a multiclass record. */
  levelElementPattern?: string;
  min: number;
  max?: number;
}

/**
 * A step publishes class levels when it is per-level, names what governs a level, and the kind's
 * progression is a level count. A rating or an xp total has no "level 3 went to the wizard".
 */
export function multiclassConfig(
  step: BuildStepDef,
  progression: Progression,
): MulticlassConfig | undefined {
  if (!step.perLevel || !step.levelRoll || progression.kind !== 'level') return undefined;
  return {
    classType: step.levelRoll.classType,
    levelRoll: step.levelRoll,
    levelElementPattern: progression.elementIdPattern,
    min: progressionMin(progression),
    max: progression.max,
  };
}

/** One level of the character, and the class it was spent on. */
export interface ClassLevel {
  level: number;
  /** Undefined where nothing attributes this level — an import that could not resolve it. */
  classId?: ElementId;
  /** Which level *of that class* this is: Warlock 5, however many levels came first. */
  classLevel: number;
  /** The character's first level. It is the first class by definition and is not changeable here. */
  first: boolean;
}

/**
 * A class a level could be spent on, and whether it may be.
 *
 * `unavailable` is a reason as data, not a sentence: the wording is the shell's, and a system's
 * own prerequisite prose is `prerequisite`.
 */
export interface ClassOption {
  id: ElementId;
  /** The character already has a level in it — another one is not a multiclass and is never gated. */
  taken: boolean;
  /**
   * The class may be taken. Ability score minimums do not decide this — ADR 0045: a class whose
   * only unmet terms are scores is eligible and carries a `flag`. Every other unmet term still
   * makes it ineligible, with `unavailable` saying which kind.
   */
  eligible: boolean;
  /**
   * The ability score minimums the character does not meet, as data (ADR 0045). Alternatives,
   * because a block may say `[str:13]||[dex:13]`: each is the set of scores that would satisfy the
   * block by itself, and only the closest are kept. Absent when the scores are met. Derived on every
   * read and never stored, so it clears when a score rises.
   */
  flag?: ScoreShortfall[][];
  /**
   * `no-multiclass-rules`: the class declares no way to be taken second (one Unearthed Arcana
   * class in the corpus). `excluded`: something the character holds is one of the things the
   * requirement says must be absent — the other edition of a class it already has, across the
   * corpus's 2014/2024 pairs — and no score can change that. `prerequisite`: the class's own
   * `requirements` or its multiclass block's do not hold for this character as it stands.
   */
  unavailable?: 'no-multiclass-rules' | 'excluded' | 'prerequisite';
  /** For `excluded`: the element the character holds that rules this class out. */
  excludedBy?: ElementId;
  /** The block's own words for what it needs — "Strength 13 and Charisma 13" — when it has any. */
  prerequisite?: string;
}

/** One ability score short of a minimum: content's own stat name, what it asks and what the character has. */
export interface ScoreShortfall {
  stat: string;
  needs: number;
  has: number;
}

export interface ClassLevelState {
  classType: ElementType;
  /** One row per level, from the first to the character's progress. */
  levels: ClassLevel[];
  /** The class the character started as. Undefined until one is chosen, and then nothing else is. */
  firstClassId?: ElementId;
  /** Each class the character has, in order of first appearance, with how many levels it holds. */
  classes: Array<{ id: ElementId; levels: number }>;
  /** Levels no class is attributed to. Reported and never filled in for the user. */
  unassigned: number[];
  options: ClassOption[];
  /** Whether the progression has room for another level. */
  canAddLevel: boolean;
}

// --- reading the character -----------------------------------------------------------

/**
 * The class the character started as.
 *
 * Found from content and not from a key. An imported Aurora save records its class under
 * `ID_LEVEL_1/select:Class`, not `build/class`, so a lookup by pick key would find nothing on
 * exactly the characters this exists for. The level-1 `advancement` entry wins when there is one
 * — it is what level gates read — and otherwise it is the first chosen element of the class type.
 */
export function firstClassOf(
  character: Character,
  config: MulticlassConfig,
  elements: ElementIndex,
): ElementId | undefined {
  const advanced = character.advancement?.find((entry) => entry.at === config.min);
  if (advanced) return advanced.elementId;
  for (const choice of character.choices) {
    for (const id of choice.elementIds) {
      if (elements.get(id)?.type === config.classType) return id;
    }
  }
  return undefined;
}

/**
 * The class each level went to, `min` first. `undefined` marks a level nothing attributes.
 *
 * With no `advancement` every level is the first class — the single-track reading the engine has
 * always applied. With one, only what it names counts: a gap is a gap, because filling it would
 * change a character on an edit that had nothing to do with it.
 */
export function levelClasses(
  character: Character,
  config: MulticlassConfig,
  elements: ElementIndex,
): Array<ElementId | undefined> {
  const out: Array<ElementId | undefined> = [];
  const advancement = character.advancement;
  const fallback = advancement?.length ? undefined : firstClassOf(character, config, elements);
  for (let level = config.min; level <= character.progress; level += 1) {
    out.push(advancement?.length ? advancement.find((entry) => entry.at === level)?.elementId : fallback);
  }
  return out;
}

/** Every class's multiclass element id, and the class that declares it. */
function multiclassElements(
  config: MulticlassConfig,
  elements: ElementIndex,
): Map<ElementId, ElementId> {
  const owners = new Map<ElementId, ElementId>();
  for (const element of elements.byType(config.classType)) {
    const id = element.multiclass?.id;
    // Only when the element exists: recording an id nothing resolves would seed the derivation
    // with an unresolved reference, which is an error on a character that did nothing wrong.
    if (id && elements.get(id)) owners.set(id, element.id);
  }
  return owners;
}

/**
 * The key a class's multiclass element is recorded under: what an Aurora import writes for the
 * same character (`ID_LEVEL_3/select:Multiclass (Level 3)`), so an imported multiclass character
 * and one built here hold the same records — ADR 0036 decision 2. `level` is the first level the
 * class was taken at.
 */
export function multiclassRuleKey(config: MulticlassConfig, level: number): string {
  const owner = config.levelElementPattern
    ? config.levelElementPattern.replace('{n}', String(level))
    : `progress:${level}`;
  return `${owner}/select:Multiclass (Level ${level})`;
}

// --- writing the character -----------------------------------------------------------

/**
 * Turn "the class each level went to" back into the two records that mean it.
 *
 * - `advancement` is written only while the character has more than one class, or has a level
 *   nothing attributes. A single-class character carries none, as an imported one never did.
 * - Every class but the first gets its multiclass element recorded, keyed by the first level it
 *   was taken at; the first class never does, because its block would switch its own saving
 *   throw proficiencies off.
 *
 * Records are *found* by what they hold, not by their key, so a save that keyed the same fact
 * differently is repaired here rather than duplicated. A record that is already exactly right is
 * left where it is.
 */
function writeClassLevels(
  character: Character,
  config: MulticlassConfig,
  elements: ElementIndex,
  levels: Array<ElementId | undefined>,
  firstClassId: ElementId | undefined,
): Character {
  const entries: AdvancementEntry[] = [];
  const firstLevelOf = new Map<ElementId, number>();
  levels.forEach((classId, index) => {
    if (classId === undefined) return;
    const at = config.min + index;
    entries.push({ at, elementId: classId });
    if (!firstLevelOf.has(classId)) firstLevelOf.set(classId, at);
  });

  const gapped = entries.length < levels.length;
  const multiclassed = firstLevelOf.size > 1;
  let next = setAdvancement(character, multiclassed || gapped ? entries : undefined);

  const owners = multiclassElements(config, elements);
  const wanted = new Map<string, ElementId>();
  for (const [classId, level] of firstLevelOf) {
    if (classId === firstClassId) continue;
    const block = elements.get(classId)?.multiclass;
    if (block && owners.has(block.id)) wanted.set(multiclassRuleKey(config, level), block.id);
  }

  const isRecord = (choice: Choice): boolean =>
    choice.elementIds.length > 0 && choice.elementIds.every((id) => owners.has(id));
  const exact = (choice: Choice): boolean =>
    choice.elementIds.length === 1 && wanted.get(choice.ruleKey) === choice.elementIds[0];

  next = {
    ...next,
    choices: next.choices.filter((choice) => !isRecord(choice) || exact(choice)),
  };
  for (const [ruleKey, id] of wanted) {
    if (!next.choices.some((choice) => choice.ruleKey === ruleKey)) next = setChoice(next, ruleKey, [id]);
  }
  return next;
}

/**
 * Move the character along its progression and keep `advancement` in step — ADR 0036 decision 6.
 *
 * Raising it continues the class of the last level, which is what "one more level" means and can
 * be reassigned; lowering it drops the levels that are gone, and with them any class whose only
 * levels they were. A character with no `advancement` is single-class and only its number moves.
 *
 * `spendOn` names the class the *new* levels go to instead, in the same write. It exists so a
 * level-up in a chosen class is one change: growing into the previous class and then reassigning
 * would pass through a level that was never that class's, and a hit point roll already recorded
 * for it would be cleared for a die change that did not happen.
 */
export function planProgress(
  character: Character,
  progress: number,
  config: MulticlassConfig,
  elements: ElementIndex,
  spendOn?: ElementId,
): Character {
  const moved: Character = { ...character, progress };
  const first = firstClassOf(character, config, elements);
  const single = !character.advancement?.length;
  if (single && (spendOn === undefined || spendOn === first || first === undefined)) return moved;

  const before = levelClasses(character, config, elements);
  const last = spendOn ?? before[before.length - 1] ?? first;
  const levels: Array<ElementId | undefined> = [];
  for (let level = config.min; level <= progress; level += 1) {
    const index = level - config.min;
    levels.push(index < before.length ? before[index] : last);
  }
  return writeClassLevels(moved, config, elements, levels, first);
}

/**
 * Spend one level on a class. Returns the character as it should be, or undefined when the
 * request is not a level of this character's to change — the first level, one outside the
 * progression, or a class nothing can be built from.
 *
 * Eligibility is *not* checked here: it depends on the derivation, and a builder that already
 * holds `ClassLevelState.options` checks it there, the way a budget is checked against its
 * state. This is the write once that has said yes.
 *
 * A recorded hit point roll is a result of one die, so moving a level between classes with
 * different dice clears it, and the level's hit points reopen (ADR 0036 decision 5).
 */
export function planLevelClass(
  character: Character,
  level: number,
  classId: ElementId,
  config: MulticlassConfig,
  elements: ElementIndex,
): Character | undefined {
  if (!Number.isInteger(level) || level <= config.min || level > character.progress) return undefined;
  const element = elements.get(classId);
  if (!element || element.type !== config.classType) return undefined;
  const first = firstClassOf(character, config, elements);
  if (first === undefined) return undefined;

  const levels = levelClasses(character, config, elements);
  const index = level - config.min;
  const previous = levels[index];
  if (previous === classId) return character;
  levels[index] = classId;

  let next = writeClassLevels(character, config, elements, levels, first);

  const key = hitPointRollKey(config.levelRoll.pattern, level);
  const from = dieSides(elements.get(previous ?? ''), config.levelRoll.dieSetter);
  const to = dieSides(element, config.levelRoll.dieSetter);
  if (next.rolls[key] !== undefined && from !== undefined && to !== undefined && from !== to) {
    next = setRoll(next, key, undefined);
  }
  return next;
}

/** One run of a class split: this many levels, in this class, taken in the order the runs are listed. */
export interface ClassSegment {
  classId: ElementId;
  levels: number;
}

/**
 * Write a whole class split in one go — ADR 0045 decision 1. `[{ Fighter, 12 }, { Wizard, 5 }]` means
 * levels 1 to 12 went to the Fighter and 13 to 17 to the Wizard; the first segment is the first
 * class, and `progress` becomes the sum. The same records a level-by-level build writes, so the two
 * are the same character.
 *
 * A class may appear in more than one segment (Rogue 2, Wizard 2, Rogue 2), which is how an
 * interleaved build is one input too. Undefined when the request is not a split of this
 * character's to write: no segment, a count that is not a positive whole number, something that is
 * not a class, or a total past the progression. Whether each class may be taken is the builder's
 * check, against `ClassLevelState.options`, as for `planLevelClass`.
 *
 * Applying a split replaces every per-level assignment the character had. A hit point roll survives
 * unless its level now belongs to a class with a different die (ADR 0036 decision 5).
 */
export function planSplit(
  character: Character,
  segments: ClassSegment[],
  config: MulticlassConfig,
  elements: ElementIndex,
): Character | undefined {
  if (!segments.length) return undefined;
  const levels: ElementId[] = [];
  for (const segment of segments) {
    if (!Number.isInteger(segment.levels) || segment.levels < 1) return undefined;
    if (elements.get(segment.classId)?.type !== config.classType) return undefined;
    for (let n = 0; n < segment.levels; n += 1) levels.push(segment.classId);
  }
  const progress = config.min + levels.length - 1;
  if (config.max !== undefined && progress > config.max) return undefined;

  const before = levelClasses(character, config, elements);
  let next = writeClassLevels({ ...character, progress }, config, elements, levels, levels[0]);
  levels.forEach((classId, index) => {
    const level = config.min + index;
    const key = hitPointRollKey(config.levelRoll.pattern, level);
    const from = dieSides(elements.get(before[index] ?? ''), config.levelRoll.dieSetter);
    const to = dieSides(elements.get(classId), config.levelRoll.dieSetter);
    if (next.rolls[key] !== undefined && from !== undefined && to !== undefined && from !== to) {
      next = setRoll(next, key, undefined);
    }
  });
  return next;
}

/**
 * A different first class, after the pick has been written: every level the old one held goes to
 * the new one — ADR 0036 decision 6. Rehoming is what "change my class to Cleric" means on a
 * Paladin 2 / Warlock 18, and if the new first class was already the other class, the two
 * collapse into one and `advancement` goes away.
 */
export function planFirstClass(
  character: Character,
  previous: ElementId,
  next: ElementId,
  config: MulticlassConfig,
  elements: ElementIndex,
): Character {
  if (!character.advancement?.length || previous === next) return character;
  const levels = levelClasses(character, config, elements).map((id) => (id === previous ? next : id));
  return writeClassLevels(character, config, elements, levels, next);
}

/**
 * A held element that a requirement, which is known to be false, says must not be held.
 *
 * Content writes "not the other edition of this class" as `!(ID_…_CLASS_X||ID_…_MULTICLASS_X)`, and
 * a boolean cannot say which of a block's terms failed — so an ability minimum the character
 * meets read as the reason it was refused. Only called for an expression that is already false,
 * which is what makes a negated `has` of something held a term that *did* fail.
 */
function forbiddenBy(
  expr: RequirementExpr | undefined,
  held: ReadonlySet<ElementId>,
  negated = false,
): ElementId | undefined {
  if (!expr) return undefined;
  switch (expr.kind) {
    case 'has':
      return negated && held.has(expr.id) ? expr.id : undefined;
    case 'not':
      return forbiddenBy(expr.child, held, !negated);
    case 'and':
    case 'or':
      for (const child of expr.children) {
        const found = forbiddenBy(child, held, negated);
        if (found !== undefined) return found;
      }
      return undefined;
    default:
      return undefined;
  }
}

function dieSides(element: Element | undefined, dieSetter: string): number | undefined {
  const notation = element?.setters[dieSetter]?.value;
  if (notation === undefined) return undefined;
  const parsed = parseDice(notation);
  return parsed.ok ? parsed.spec.sides : undefined;
}

// --- ability score minimums are the one soft term — ADR 0045 --------------------------

/**
 * A requirement with every ability score minimum read as met. What is false after that is a held
 * or absent element, a tag or a flag: nothing a score can change, so it stays a gate.
 *
 * A minimum under a `not` is read for real, because "met" there would flip to a refusal that has
 * nothing to do with being short of a score.
 */
function evaluateSoft(
  expr: RequirementExpr | undefined,
  ctx: RequirementContext,
  negated = false,
): boolean {
  if (!expr) return true;
  switch (expr.kind) {
    case 'atLeast':
      return negated ? evaluateRequirements(expr, ctx) : true;
    case 'and':
      return expr.children.every((child) => evaluateSoft(child, ctx, negated));
    case 'or':
      return expr.children.some((child) => evaluateSoft(child, ctx, negated));
    case 'not':
      return !evaluateSoft(expr.child, ctx, !negated);
    default:
      return evaluateRequirements(expr, ctx);
  }
}

const shortBy = (terms: ScoreShortfall[]): number =>
  terms.reduce((sum, term) => sum + (term.needs - term.has), 0);

/**
 * The alternatives by which an expression's ability score minimums would be met, or undefined when
 * they already are. Only meaningful for an expression whose non-score terms hold (`evaluateSoft`).
 * An `or` keeps the alternatives that can still be satisfied and, of those, the smallest shortfall.
 */
function shortfalls(expr: RequirementExpr, ctx: RequirementContext): ScoreShortfall[][] | undefined {
  if (evaluateRequirements(expr, ctx)) return undefined;
  switch (expr.kind) {
    case 'atLeast':
      return [[{ stat: expr.stat, needs: expr.value, has: ctx.statNumber(expr.stat) }]];
    case 'and': {
      let alternatives: ScoreShortfall[][] = [[]];
      for (const child of expr.children) {
        const short = shortfalls(child, ctx);
        if (!short) continue;
        alternatives = alternatives.flatMap((have) => short.map((add) => [...have, ...add]));
      }
      return alternatives;
    }
    case 'or': {
      const alternatives = expr.children
        .filter((child) => evaluateSoft(child, ctx))
        .flatMap((child) => shortfalls(child, ctx) ?? []);
      return alternatives.length ? closest(alternatives) : undefined;
    }
    default:
      return undefined;
  }
}

function closest(alternatives: ScoreShortfall[][]): ScoreShortfall[][] {
  const least = Math.min(...alternatives.map(shortBy));
  return alternatives.filter((terms) => shortBy(terms) === least);
}

function scoreFlag(
  expr: RequirementExpr | undefined,
  ctx: RequirementContext,
): ScoreShortfall[][] | undefined {
  if (!expr || !evaluateSoft(expr, ctx)) return undefined;
  const short = shortfalls(expr, ctx);
  return short?.length ? short : undefined;
}

/** Two independent gates both short: every way of satisfying one together with one of the other. */
function mergeFlags(
  a: ScoreShortfall[][] | undefined,
  b: ScoreShortfall[][] | undefined,
): ScoreShortfall[][] | undefined {
  if (!a) return b;
  if (!b) return a;
  return closest(a.flatMap((left) => b.map((right) => [...left, ...right])));
}

// --- what a view reads ---------------------------------------------------------------

/**
 * Everything a class levels control needs — the rows, the classes, and which class each row may
 * be changed to and why not when it may not.
 */
export function computeClassLevelState(
  character: Character,
  derived: DerivedCharacter,
  config: MulticlassConfig,
  elements: ElementIndex,
): ClassLevelState {
  const firstClassId = firstClassOf(character, config, elements);
  const assigned = levelClasses(character, config, elements);

  const counts = new Map<ElementId, number>();
  const levels: ClassLevel[] = assigned.map((classId, index) => {
    const seen = classId === undefined ? 0 : (counts.get(classId) ?? 0) + 1;
    if (classId !== undefined) counts.set(classId, seen);
    return { level: config.min + index, classId, classLevel: seen, first: index === 0 };
  });

  const context = requirementContextFor(derived);
  const options: ClassOption[] = [];
  if (firstClassId !== undefined) {
    for (const element of elements.byType(config.classType)) {
      const taken = counts.has(element.id) || element.id === firstClassId;
      if (taken) {
        // The first class was never gated. A later one is still held to its block's scores, so the
        // flag shows for a class already taken — and only the block: the class's own requirements
        // read "not multiclass" and are false for exactly the character that took it second.
        const flag =
          element.id === firstClassId ? undefined : scoreFlag(element.multiclass?.requirements, context);
        options.push({ id: element.id, taken, eligible: true, ...(flag ? { flag } : {}) });
        continue;
      }
      const block = element.multiclass;
      if (!block || !elements.get(block.id)) {
        options.push({ id: element.id, taken, eligible: false, unavailable: 'no-multiclass-rules' });
        continue;
      }
      // Ability scores are the one soft term (ADR 0045): read them as met, and what is still false
      // is something no score can change.
      const met =
        evaluateSoft(element.requirements, context) && evaluateSoft(block.requirements, context);
      const flag = met
        ? mergeFlags(scoreFlag(element.requirements, context), scoreFlag(block.requirements, context))
        : undefined;
      const excludedBy = met
        ? undefined
        : (forbiddenBy(element.requirements, derived.elementIds) ??
          forbiddenBy(block.requirements, derived.elementIds));
      options.push({
        id: element.id,
        taken,
        eligible: met,
        ...(flag ? { flag } : {}),
        ...(met ? {} : { unavailable: excludedBy ? ('excluded' as const) : ('prerequisite' as const) }),
        ...(excludedBy ? { excludedBy } : {}),
        ...(block.prerequisite ? { prerequisite: block.prerequisite } : {}),
      });
    }
  }

  return {
    classType: config.classType,
    levels,
    firstClassId,
    classes: [...counts].map(([id, held]) => ({ id, levels: held })),
    unassigned: levels.filter((row) => row.classId === undefined).map((row) => row.level),
    options,
    canAddLevel: config.max === undefined || character.progress < config.max,
  };
}
