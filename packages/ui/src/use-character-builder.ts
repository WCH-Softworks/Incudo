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
  type GenerationMethodDef,
  type ResolvedCharacterKind,
  type StatKey,
} from '@incudo/core';

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

/**
 * A points pool, as a view can render it — ADR 0017.
 *
 * `granted` is the budget stat, summed by the engine like any other, so whatever content
 * adds to it lands here without this file knowing what did. `spent` depends on the method,
 * because the methods are genuinely different questions: point buy spends from a pool,
 * a standard array assigns a fixed set, rolling assigns what you rolled, manual entry is
 * neither.
 */
export interface BudgetState {
  stat: StatKey;
  targets: StatKey[];
  /** The methods this step offers, resolved from the system. */
  methods: GenerationMethodDef[];
  /** The method the character used, if one has been recorded. */
  methodId?: string;
  /** Points available: the method's own pool plus whatever content granted. */
  available: number;
  spent: number;
  remaining: number;
  /** Targets with no value set yet. A budget is open while any of these remain. */
  unassigned: StatKey[];
  /** True when this method is a pool of points rather than a set of values to assign. */
  pooled: boolean;
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

  constructor(character: Character, system: GameSystem, elements: ElementIndex) {
    this.character = character;
    this.system = system;
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

  /** Record how a budgeted step's values were produced, so a later edit reads them right. */
  setGenerationMethod = (stepId: string, methodId: string | undefined): void => {
    this.character = setGenerationMethod(this.character, stepId, methodId);
    this.invalidate();
  };

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
    const budget = step.budget!;
    const methods = (budget.methods ?? [])
      .map((id) => (this.system.generationMethods ?? []).find((m) => m.id === id))
      .filter((m): m is GenerationMethodDef => m !== undefined);
    const methodId = this.character.generation?.[step.id];
    const method = methods.find((m) => m.id === methodId);

    const base = this.character.baseStats ?? {};
    const valueOf = (stat: StatKey): number | undefined =>
      base[stat] ?? base[stat.toLowerCase()];

    const granted = derived.stats.get(budget.stat.toLowerCase())?.value ?? 0;
    // A points method is one that says what a value costs. Reporting a pool for a rolled
    // set would be a fiction — you did not buy those numbers, you rolled them.
    const pooled = method?.costs !== undefined || method?.pool !== undefined;
    const available = (method?.pool ?? 0) + granted;

    let spent = 0;
    if (pooled && method?.costs) {
      for (const target of budget.targets) {
        const value = valueOf(target);
        if (value !== undefined) spent += method.costs[String(value)] ?? 0;
      }
    }

    return {
      stat: budget.stat,
      targets: budget.targets,
      methods,
      methodId,
      available,
      spent,
      remaining: available - spent,
      unassigned: budget.targets.filter((target) => valueOf(target) === undefined),
      pooled,
    };
  }
}
