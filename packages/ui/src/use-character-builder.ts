/**
 * The character builder, as a set of open decisions.
 *
 * There is no current step and no Back button, and that is the whole design — see
 * ADR 0017. A wizard needs a Back button because character creation is full of later
 * choices that reopen earlier ones: a feat that grants ability points, a subclass that adds
 * a skill to pick, a level 4 improvement that is the same decision as step one arriving
 * twenty minutes later. The screen is the wrong unit, so this publishes one flat,
 * always-current list of what is outstanding and answering anything re-derives.
 *
 * A shell may still *focus* one decision — that is presentation, and the two shells will
 * differ (a dense desktop pane, a mobile card stack). What neither shell may do is own the
 * question of what is outstanding.
 *
 * Deliberately framework-light: plain functions plus a tiny store, so this is testable
 * in Node and usable from any React renderer. The React binding is a five-line
 * `useSyncExternalStore` in each shell.
 */

import {
  clampProgress,
  deriveCharacter,
  evaluateRequirements,
  orderBuildSteps,
  requirementContextFor,
  resolveCharacterKind,
  setBaseStat,
  setChoice,
  setGenerationMethod,
  setRoll,
  type BuildStepDef,
  type Character,
  type DerivedCharacter,
  type ElementId,
  type ElementIndex,
  type RequirementContext,
  type GameSystem,
  type ResolvedCharacterKind,
  type StatKey,
} from '@incudo/core';

import {
  budgetRollKey,
  canExpressValue,
  computeBudgetState,
  initialBudgetValues,
  planBudgetAdjust,
  planBudgetSet,
  rollBudgetValues,
  type BudgetState,
  type BudgetWrite,
} from './budget.ts';

/**
 * One thing the character still has to decide.
 *
 * `stepId` is for grouping in a view and nothing else — it does not gate answering. A level
 * 4 improvement appears here the moment the character reaches level 4, wherever the user
 * happens to be looking, and is answerable in place.
 */
export interface OpenDecision {
  /** Stable: the rule key for a select or a pick, the budget's stat for a budget. */
  id: string;
  /**
   * `select` is a `<select>` rule content opened. `budget` is a points pool. `pick` is a
   * **top-level choice no rule asks for** — a 5e character's race, class and background, which
   * nothing in 740 content files declares a select for because Aurora's app asks for them
   * directly.
   *
   * Without `pick` a required build step reported itself `complete` from the first render with
   * nothing chosen, and there was no way to choose a class at all — found by running the desktop
   * shell against the real corpus. The recording convention is not new: a top-level pick has
   * always been keyed `build/<stepId>` (`tools/incudo/fixtures/aelin` records `"build/kin"`, and
   * `aurora-import` says so above `OPTIONS_RULE_KEY`). This publishes what the rest of the
   * project was already writing by hand.
   */
  kind: 'select' | 'budget' | 'pick';
  label: string;
  /** Which grouping it belongs to, for presentation. */
  stepId: string;
  /** Required, versus a choice the character may decline. */
  blocking: boolean;
  /** What opened it — "Rogue 4: Ability Score Improvement". */
  from?: ElementId;
  /**
   * The progression point it became available, where that is known. A level in the granting
   * element's own track, not the character's total — "Rogue 4", not "character level 9".
   */
  openedAt?: number;
  /** A select's remaining picks, or a budget's unspent points. */
  remaining: number;
  /**
   * What may be chosen, for a `select` or a `pick`.
   *
   * Carried here so a shell never has to reach into `derived.pendingChoices` and re-implement
   * the filtering — that is the view-model's job, not the view's (CODE-REUSE-POLICY rule 2).
   * Empty for a `budget`, which assigns numbers rather than elements.
   */
  candidates: ElementId[];
  /**
   * Filter terms Incudo cannot evaluate yet, so `candidates` is short rather than complete.
   *
   * Empty in the normal case. A `<select supports="$(spellcasting:list)">` is the only source
   * today: an unresolved `$(…)` matches nothing, which produces an empty list that looks exactly
   * like "you have not loaded the right content". Naming the term is the difference between a
   * user adding a source that will not help and a user knowing to wait for the feature.
   */
  unresolved: string[];
}

/**
 * A build step, as something to group decisions under and possibly not reach yet.
 *
 * `available` is the part that matters: a step whose dependencies are unmet is *not yet
 * available* rather than skippable, and `blockedBy` says which step would open it.
 */
export interface BuilderStep {
  id: string;
  label: string;
  required: boolean;
  available: boolean;
  /** Ids of the steps holding this one shut. Empty when `available`. */
  blockedBy: string[];
  /** Decisions in this step that are still open. */
  openCount: number;
  /** No *blocking* decisions outstanding. An available step with optional picks is complete. */
  complete: boolean;
  budget?: BudgetState;
}

export interface BuilderState {
  character: Character;
  derived: DerivedCharacter;
  /** The kind being built. ADR 0009. */
  kind: ResolvedCharacterKind;
  /** Everything still outstanding, always current, in no particular order of obligation. */
  decisions: OpenDecision[];
  /** Steps in their suggested order — a topological sort of `requires`. */
  steps: BuilderStep[];
  /** What the shell has chosen to show. Presentation only; nothing depends on it. */
  focusedId: string | undefined;
}

/**
 * The rule key a top-level pick is recorded under.
 *
 * Not an `<element>/select:<name>` key, because no element declares a select for a 5e character's
 * race — Aurora's app asks for it directly. The convention predates this function: the committed
 * fixture save records `"ruleKey": "build/kin"`, and `aurora-import` documents the same shape
 * above `OPTIONS_RULE_KEY`.
 */
export function pickRuleKey(stepId: string): string {
  return `build/${stepId}`;
}

export class CharacterBuilder {
  private character: Character;
  private readonly system: GameSystem;
  private readonly kind: ResolvedCharacterKind;
  private readonly elements: ElementIndex;
  private readonly steps: BuildStepDef[];
  private focusedId: string | undefined;
  private readonly listeners = new Set<() => void>();
  private cached: BuilderState | undefined;
  private readonly random: () => number;

  constructor(
    character: Character,
    system: GameSystem,
    elements: ElementIndex,
    options: { random?: () => number } = {},
  ) {
    this.character = character;
    this.system = system;
    // Injected for the reason every other platform dependency is (CODE-REUSE-POLICY rule 1):
    // a test needs a sequence it chose. Nothing below cares where the numbers come from, and
    // only `rollBudget` ever asks for one.
    this.random = options.random ?? Math.random;
    // The build flow comes from the kind, not the system: a monster stat block and a PC
    // sheet share nothing but the stats underneath (ADR 0009).
    this.kind = resolveCharacterKind(system, character.kind);
    this.elements = elements;
    // Sorted once: `requires` is a property of the definition, not of the character.
    this.steps = orderBuildSteps(this.kind.buildSteps);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): BuilderState => {
    if (!this.cached) this.cached = this.compute();
    return this.cached;
  };

  choose = (ruleKey: string, elementIds: ElementId[]): void => {
    this.character = setChoice(this.character, ruleKey, elementIds);
    this.invalidate();
  };

  /**
   * Move the character along its progression — a level, a challenge rating, an xp total.
   * A kind with no progression pins this at 0, so the caller does not have to know which.
   *
   * Level-up is not a special screen: this changes a number, and whatever decisions it
   * opens arrive in the same list as every other, tagged with the level that raised them.
   */
  setProgress = (progress: number): void => {
    this.character = {
      ...this.character,
      progress: clampProgress(this.kind.progression, progress),
    };
    this.invalidate();
  };

  /** Record a die result. An input, never re-derived — see ADR 0007. */
  recordRoll = (key: string, value: number | undefined): void => {
    this.character = setRoll(this.character, key, value);
    this.invalidate();
  };

  /**
   * Set a starting value the user chose — the thing this view-model had no way to do at
   * all before ADR 0017, which is why the abilities step reported itself finished from the
   * first render.
   */
  setBaseStat = (stat: StatKey, value: number | undefined): void => {
    this.character = setBaseStat(this.character, stat, value);
    this.invalidate();
  };

  /**
   * Record how a budgeted step's values were produced, so a later edit reads them right.
   *
   * **The new method keeps only the values it can express**, which is the rule rather than
   * "changing method clears everything". The methods cannot describe each other's answers — a
   * rolled 18 is not a value point buy prices, a bought 15 is not one of the six numbers you
   * rolled — so carrying such a value across would leave the step holding a set its own method
   * could never have produced: legal-looking, unreachable, and unexplainable on screen.
   *
   * The case that forced the distinction is the common one. Every character imported from
   * Aurora arrives with six real scores and **no recorded method**, because Aurora does not
   * record one. Under a blanket clear, a user who opened such a character and touched
   * "Enter manually" — the method that can hold those numbers perfectly well — would lose all
   * six. Found by running the app on an imported character, which had no failing test.
   *
   * Recorded **rolls survive** either way, because ADR 0007 says a recorded random result is an
   * input and never silently disappears. Switching to point buy and back leaves the same six
   * numbers waiting to be assigned; it is only their placement that goes.
   */
  setGenerationMethod = (stepId: string, methodId: string | undefined): void => {
    const step = this.steps.find((s) => s.id === stepId);
    const previous = this.character.generation?.[stepId];
    let next = setGenerationMethod(this.character, stepId, methodId);

    if (step?.budget && previous !== methodId) {
      const method = (this.system.generationMethods ?? []).find((m) => m.id === methodId);
      const budget = this.budgetFor(stepId);
      for (const target of step.budget.targets) {
        const held = budget?.rows.find((row) => row.stat === target)?.base;
        if (!canExpressValue(method, held)) next = clearBase(next, target);
      }
      next = applyWrites(next, initialBudgetValues(step.budget.targets, method, next));
    }

    this.character = next;
    this.invalidate();
  };

  /**
   * Set one of a budgeted step's target stats — the single write path of an ability editor.
   *
   * Validated here and not in the shell: an unaffordable point buy, a value the cost table does
   * not price, a standard-array value that is not in the array, and an out-of-bounds manual
   * entry are all refused or clamped by `planBudgetSet`. A refused set writes nothing, which is
   * safe because the state it came from already said the control should be disabled.
   *
   * The interesting case is an assignment method: dropping a 15 on a target while another holds
   * the only 15 **swaps** them rather than duplicating the value. See `planBudgetSet`.
   */
  setBudgetStat = (stepId: string, stat: StatKey, value: number | undefined): void => {
    const budget = this.budgetFor(stepId);
    if (!budget) return;
    this.applyBudgetWrites(planBudgetSet(budget, stat, value));
  };

  /** Move one target a step up or down — the `+` and `−` of a point-buy row. */
  adjustBudgetStat = (stepId: string, stat: StatKey, delta: number): void => {
    const budget = this.budgetFor(stepId);
    if (!budget) return;
    this.applyBudgetWrites(planBudgetAdjust(budget, stat, delta));
  };

  /**
   * Roll the values a rolled method still owes, and record them.
   *
   * Only the unrolled ones, so this is idempotent in the way that matters: calling it again
   * does not change a number the user has already seen. **Re-rendering cannot reach it** — the
   * state a view reads comes from `computeBudgetState`, which writes nothing — so there is no
   * path from a repaint to a different character.
   */
  rollBudget = (stepId: string): void => {
    const budget = this.budgetFor(stepId);
    if (!budget) return;
    let next = this.character;
    for (const result of rollBudgetValues(stepId, budget, this.character, this.random)) {
      next = setRoll(next, result.key, result.roll.total);
    }
    if (next === this.character) return;
    this.character = next;
    this.invalidate();
  };

  /**
   * Discard a rolled set and the assignment made from it, so it can be rolled again.
   *
   * The explicit act `rollBudget` refuses to do implicitly. Both halves go together on purpose:
   * the assignment is only meaningful as a placement of these six values, so keeping it while
   * the pool disappears would leave scores nothing accounts for.
   */
  clearBudgetRolls = (stepId: string): void => {
    const budget = this.budgetFor(stepId);
    if (!budget?.dice) return;
    let next = this.character;
    for (let i = 0; i < budget.dice.count; i += 1) next = setRoll(next, budgetRollKey(stepId, i), undefined);
    for (const target of budget.targets) next = clearBase(next, target);
    this.character = next;
    this.invalidate();
  };

  /** The budget of one step, as the editor sees it, or undefined if that step has none. */
  budgetFor = (stepId: string): BudgetState | undefined => {
    return this.getState().steps.find((step) => step.id === stepId)?.budget;
  };

  private applyBudgetWrites(writes: BudgetWrite[]): void {
    if (!writes.length) return;
    this.character = applyWrites(this.character, writes);
    this.invalidate();
  }

  /**
   * Show a decision. Presentation only — nothing in the model depends on it, and there is
   * no "go back" because there is nowhere to go back from.
   */
  focus = (decisionId: string | undefined): void => {
    this.focusedId = decisionId;
    this.invalidate();
  };

  private invalidate(): void {
    this.cached = undefined;
    for (const listener of this.listeners) listener();
  }

  private compute(): BuilderState {
    const derived = deriveCharacter(this.character, this.system, this.elements, {
      kind: this.kind,
    });

    // A select belongs to the first step that lists its element type. That is a grouping
    // hint, not an assignment of responsibility: an ungrouped decision is still open, and
    // still answerable, which is what stops a level 4 improvement from being trapped in
    // whichever screen happens to name its type.
    const stepForType = new Map<string, string>();
    for (const step of this.steps) {
      for (const type of step.types) if (!stepForType.has(type)) stepForType.set(type, step.id);
    }

    // The engine's own view of what this character has and what its stats read. Built once per
    // computation and borrowed from core rather than reimplemented, so a candidate this offers
    // is one the derivation will accept.
    const requirementContext: RequirementContext = requirementContextFor(derived);

    const decisions: OpenDecision[] = derived.pendingChoices.map((choice) => ({
      id: choice.ruleKey,
      kind: 'select',
      label: choice.label,
      stepId: stepForType.get(choice.type) ?? '',
      blocking: !choice.optional,
      from: choice.from,
      openedAt: choice.level,
      remaining: choice.remaining,
      candidates: choice.candidates,
      unresolved: choice.unresolvedSupports,
    }));

    // Top-level picks — the race, class and background nothing declares a select for.
    //
    // Only `required` steps, and never a `perLevel` one: what a level was spent on is
    // `Character.advancement` and belongs to `setProgress` (ADR 0015), not to a choice. Steps
    // that are neither — equipment, spells, details — are left alone rather than given an
    // invented decision, because the bag (ADR 0024) and content's own selects already own them.
    for (const step of this.steps) {
      if (!step.required || step.perLevel || !step.types.length) continue;
      const ruleKey = pickRuleKey(step.id);
      if (this.character.choices.some((c) => c.ruleKey === ruleKey && c.elementIds.length)) continue;

      decisions.push({
        id: ruleKey,
        kind: 'pick',
        label: step.label,
        stepId: step.id,
        blocking: true,
        remaining: 1,
        // A top-level pick has no supports filter; the step names types and nothing else.
        unresolved: [],
        candidates: step.types.flatMap((type) =>
          this.elements
            .byType(type)
            // The element's own `requirements` — the Human Variant is only offered when the
            // campaign uses feats. Same filter `candidatesFor` applies to a select's pool.
            .filter((element) => evaluateRequirements(element.requirements, requirementContext))
            .map((element) => element.id),
        ),
      });
    }

    const budgets = new Map<string, BudgetState>();
    for (const step of this.steps) {
      if (!step.budget) continue;
      const state = this.budgetState(step, derived);
      budgets.set(step.id, state);
      // Open while there is anything left to do, and the two are not the same thing: a
      // point-buy character can spend the last of the pool with two scores still untouched,
      // and a rolled character has nothing to spend and six values to place.
      const open = state.unassigned.length > 0 || (state.pooled && state.remaining > 0);
      if (open) {
        decisions.push({
          id: state.stat,
          kind: 'budget',
          label: step.label,
          stepId: step.id,
          blocking: step.required ?? false,
          // Points where there are points to spend, otherwise scores left to assign.
          // Different units, deliberately: `BudgetState` on the step carries both, and a
          // shell that wants to phrase it precisely reads that instead.
          remaining:
            state.pooled && state.remaining > 0 ? state.remaining : state.unassigned.length,
          // A budget assigns numbers, not elements.
          candidates: [],
          unresolved: [],
        });
      }
    }

    const available = new Set<string>();
    const steps: BuilderStep[] = this.steps.map((step) => {
      const blockedBy = (step.requires ?? []).filter((id) => !available.has(id));
      const isAvailable = blockedBy.length === 0;
      if (isAvailable) available.add(step.id);
      const open = decisions.filter((decision) => decision.stepId === step.id);
      return {
        id: step.id,
        label: step.label,
        required: step.required ?? false,
        available: isAvailable,
        blockedBy,
        openCount: open.length,
        complete: !open.some((decision) => decision.blocking),
        budget: budgets.get(step.id),
      };
    });

    return {
      character: this.character,
      derived,
      kind: this.kind,
      decisions,
      steps,
      focusedId: this.focusedId,
    };
  }

  private budgetState(step: BuildStepDef, derived: DerivedCharacter): BudgetState {
    return computeBudgetState(step, this.character, derived, this.system, this.kind);
  }
}

/**
 * Clear a base stat under either spelling.
 *
 * `baseStats` keys are matched case-insensitively everywhere they are read (ADR 0014), and the
 * Aurora importer writes them lower-cased, so deleting only the spelling the budget declares
 * would leave the other one behind — a score that reappears the moment anything re-reads it.
 */
function clearBase(character: Character, stat: StatKey): Character {
  const cleared = setBaseStat(character, stat, undefined);
  return stat === stat.toLowerCase() ? cleared : setBaseStat(cleared, stat.toLowerCase(), undefined);
}

/** Apply a plan from `budget.ts`, one `setBaseStat` at a time, without re-deriving between. */
function applyWrites(character: Character, writes: BudgetWrite[]): Character {
  let next = character;
  for (const write of writes) {
    next = write.value === undefined ? clearBase(next, write.stat) : setBaseStat(next, write.stat, write.value);
  }
  return next;
}
