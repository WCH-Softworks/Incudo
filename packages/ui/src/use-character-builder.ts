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
  getChoice,
  orderBuildSteps,
  requirementContextFor,
  resolveCharacterKind,
  setBaseStat,
  setChoice,
  setDeclined,
  setGenerationMethod,
  setName,
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

import {
  computeHitPointState,
  planHitPointChange,
  planHitPointRecord,
  type HitPointChange,
  type HitPointLevel,
  type HitPointMethod,
  type HitPointRecord,
  type HitPointState,
} from './hitpoints.ts';

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
   * directly. `hitpoints` is a `levelRoll` step's still-unrecorded levels (ADR 0019).
   *
   * Without `pick` a required build step reported itself `complete` from the first render with
   * nothing chosen, and there was no way to choose a class at all — found by running the desktop
   * shell against the real corpus. The recording convention is not new: a top-level pick has
   * always been keyed `build/<stepId>` (`tools/incudo/fixtures/aelin` records `"build/kin"`, and
   * `aurora-import` says so above `OPTIONS_RULE_KEY`). This publishes what the rest of the
   * project was already writing by hand.
   */
  kind: 'select' | 'budget' | 'pick' | 'hitpoints';
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
   * Empty for a `budget`, which assigns numbers rather than elements. Already excludes
   * `chosen`, so a `<select>` offering this list never lists an answer twice.
   */
  candidates: ElementId[];
  /**
   * What a `select` already holds, for the slots answered so far — ADR 0032. Always `[]` for a
   * one-slot select, because the moment its one answer is recorded it leaves this list
   * entirely; only visible while `remaining > 0` with something already chosen, which is
   * exactly a wizard's second and third cantrip.
   *
   * `choose` replaces the whole recorded list, which is right for a `pick` (one answer,
   * swapped for a different one) and for a caller that already assembled the complete set
   * itself. A `<select>` filling its slots one at a time needs to know what is already there
   * before it can send `choose` the union — a shell cannot compute that without being told.
   */
  chosen: ElementId[];
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
 * A non-blocking decision the user has said to skip — ADR 0033.
 *
 * Trimmed to what a "bring it back" control needs; a shell that wants to answer it again
 * calls `reconsider` first, which moves it back into `decisions` with its full candidate
 * list rather than trying to keep one stale here.
 */
export interface DeclinedDecision {
  id: string;
  kind: OpenDecision['kind'];
  label: string;
  stepId: string;
  from?: ElementId;
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
  /** This step's per-level rolls, when it declares a `levelRoll` — ADR 0019. */
  hitPoints?: HitPointState;
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
  /**
   * Answered decisions, and how to change them — the race you chose, and a wizard's second
   * Skill Proficiency once it too has an answer (ADR 0032).
   *
   * `decisions` is what is *outstanding*, so an answered one correctly leaves it. A top-level
   * pick used to leave with the only control that could change it, which made race, class and
   * background one-way doors: the Steps list said "complete" and never said complete *what*. A
   * settled budget already had this problem and already had this answer, in
   * `BuilderState.steps[].budget` — a full content `select` pool is the same shape again, one
   * level down from a build step.
   *
   * Candidates are computed exactly as they are for the open form, so changing an answer offers
   * the same list choosing it did — minus anything whose requirements the first choice has since
   * made false.
   */
  picks: SettledPick[];
  /**
   * Non-blocking decisions the user has said to skip (ADR 0033) — off `decisions` and off
   * a step's `openCount`/`complete`, same as an answered one, but reachable again through
   * `reconsider` rather than gone the way an answer's own record can be.
   */
  declined: DeclinedDecision[];
  /** What the shell has chosen to show. Presentation only; nothing depends on it. */
  focusedId: string | undefined;
}

/**
 * An answered decision, and the means to change it — a top-level pick (Race, Class,
 * Background) or a content `select` pool with every slot filled (ADR 0032).
 *
 * Deliberately not an `OpenDecision` with a flag: "outstanding" and "settled" are read by
 * different parts of a screen, and a shell that had to filter `decisions` to count what is
 * left would get that wrong eventually.
 *
 * `chosen` holds one element for a top-level pick and one *per slot* for a multi-answer
 * select — a wizard's two Skill Proficiencies are two entries, in the order they were
 * recorded. `candidates` is a single shared list covering every slot, always including
 * `chosen` itself so "what could this slot hold instead" and "what does it hold" are answered
 * from the same array; keeping one slot's answer from also appearing in another slot's list is
 * presentation, not a rule, and is `BuilderPane.tsx`'s job.
 */
export interface SettledPick {
  /** The key it is recorded under — pass it straight to `choose`. */
  ruleKey: string;
  stepId: string;
  label: string;
  /** What is chosen now — one entry for a pick, one per filled slot for a multi-answer select. */
  chosen: ElementId[];
  /** What could be chosen instead, including everything in `chosen`. */
  candidates: ElementId[];
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
  private readonly reviewingHitPoints = new Set<string>();
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
   * Stop a non-blocking decision from cluttering `decisions`, without answering it.
   *
   * Refuses a decision that is currently blocking — "you must choose at least one of the
   * optional rules your table uses" is not a sentence, the same reading ADR 0032 already
   * rejected for `required` and `multiple` together — so a shell that only ever shows a
   * Skip control next to `!decision.blocking` cannot reach this refusal in practice, but the
   * guard exists so the model does not depend on the view getting that right.
   */
  decline = (decisionId: string): void => {
    const decision = this.getState().decisions.find((d) => d.id === decisionId);
    if (!decision || decision.blocking) return;
    this.character = setDeclined(this.character, decisionId, true);
    this.invalidate();
  };

  /** Bring a skipped decision back into `decisions`, answerable exactly as before. */
  reconsider = (decisionId: string): void => {
    this.character = setDeclined(this.character, decisionId, false);
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

  /** Rename the character. An input like any other; nothing derives what a player calls them. */
  setName = (name: string): void => {
    this.character = setName(this.character, name);
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

  /**
   * Throw the set away and throw a new one, as one act.
   *
   * `clearBudgetRolls` is the discard *half* — its own doc says "so it can be rolled again",
   * and the shell's button borrowed that whole sentence while calling only the half. "Discard
   * and roll again" discarded, brought the Roll button back, and waited: the label named two
   * things and did one, and a user who read it had to work out that a second click was owed.
   *
   * It is one pass rather than `clearBudgetRolls` followed by `rollBudget`, so listeners see
   * one new set and never the empty state in between. The budget is read *before* the clear,
   * because it is where the dice notation and count live; the rolls are taken *after* it, so
   * `rollBudgetValues` finds six empty slots and fills all six.
   *
   * None of this weakens ADR 0019. What that rule forbids is a *derivation* reaching a die —
   * and the state a view reads is still `computeBudgetState`, which writes nothing. A click is
   * an explicit ask, and this method exists only at the end of one.
   */
  rerollBudget = (stepId: string): void => {
    const budget = this.budgetFor(stepId);
    if (!budget?.dice) return;

    let next = this.character;
    for (let i = 0; i < budget.dice.count; i += 1) {
      next = setRoll(next, budgetRollKey(stepId, i), undefined);
    }
    // The assignment goes with the pool it placed, for `clearBudgetRolls`'s reason: scores
    // left behind by values that no longer exist are scores nothing accounts for.
    for (const target of budget.targets) next = clearBase(next, target);
    for (const result of rollBudgetValues(stepId, budget, next, this.random)) {
      next = setRoll(next, result.key, result.roll.total);
    }

    this.character = next;
    this.invalidate();
  };

  /** The budget of one step, as the editor sees it, or undefined if that step has none. */
  budgetFor = (stepId: string): BudgetState | undefined => {
    return this.getState().steps.find((step) => step.id === stepId)?.budget;
  };

  /** The per-level rolls of one step, or undefined if it declares no `levelRoll`. */
  hitPointsFor = (stepId: string): HitPointState | undefined => {
    return this.getState().steps.find((step) => step.id === stepId)?.hitPoints;
  };

  /**
   * Record one level's roll — the maximum, the average, or an actual roll of the die content
   * names for whatever governs that level.
   *
   * `method` is ignored for a track's first level: `planHitPointRecord` always takes the
   * maximum there, because the rulebook does and a screen offering a choice would be lying
   * about there being one. Recording an already-recorded level is a no-op, the same
   * idempotency `rollBudget` holds — there is no path from a repaint to a new score.
   */
  recordHitPoints = (stepId: string, level: number, method: HitPointMethod): void => {
    const state = this.hitPointsFor(stepId);
    const entry = state?.levels.find((l) => l.level === level);
    if (!state || !entry) return;
    const plan = planHitPointRecord(state.pattern, entry, method, this.random);
    if (!plan) return;
    this.writeHitPoints(stepId, entry, plan);
  };

  /**
   * Overwrite one level's value — roll it again, take the average, or set a number the user
   * typed. Refused for a track's first level, which is always the maximum.
   *
   * `recordHitPoints` will not do this, on purpose: it leaves a recorded level alone so nothing
   * but a click can change one. This is the click. Returns what was written, which is not always
   * what was asked for — a typed 14 on a d10 is held to 10 — so an input can show the number the
   * character actually has; undefined when nothing was written.
   */
  changeHitPoints = (stepId: string, level: number, change: HitPointChange): number | undefined => {
    const state = this.hitPointsFor(stepId);
    const entry = state?.levels.find((l) => l.level === level);
    if (!state || !entry) return undefined;
    const plan = planHitPointChange(state.pattern, entry, change, this.random);
    if (!plan) return undefined;
    this.writeHitPoints(stepId, entry, plan);
    return plan.value;
  };

  /**
   * Say the recorded set is what the user wants, so the decision can close.
   *
   * Recording the last pending level does not close it on its own (see `HitPointState.reviewing`):
   * whoever just rolled has not necessarily accepted the roll.
   */
  confirmHitPoints = (stepId: string): void => {
    if (!this.reviewingHitPoints.delete(stepId)) return;
    this.invalidate();
  };

  private writeHitPoints(stepId: string, entry: HitPointLevel, plan: HitPointRecord): void {
    // Only a level's *first* value opens a review. Rolling one again from the settled card is
    // the user already being in the middle of editing it, and bouncing the card back into Open
    // decisions under their cursor would undo the point of having an Edit button. Level 1 never
    // does either: there is nothing about it to reconsider.
    if (entry.recorded === undefined && !entry.isFirst) this.reviewingHitPoints.add(stepId);
    this.character = setRoll(this.character, plan.key, plan.value);
    this.invalidate();
  }

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

    // Where each step falls for ranking "Open decisions" — a system's own declared
    // `priority`, or its position in `orderBuildSteps`'s topological sort when it declares
    // none, so a system that never sets it keeps exactly the order its array already implies.
    // This is a fixed ranking, not one that shifts with whatever the user happens to answer
    // next — it is what lets a select opened by an answered pick stay pinned near that pick
    // permanently, and lets an unanswered pick's own position be tuned the same way, rather
    // than the engine hardcoding one universal reading — see the note further down on why
    // recency, and then a single hardcoded "picks always first" rule, were each tried and
    // dropped.
    const stepOrderIndex = new Map(this.steps.map((step, i) => [step.id, step.priority ?? i]));

    // The engine's own view of what this character has and what its stats read. Built once per
    // computation and borrowed from core rather than reimplemented, so a candidate this offers
    // is one the derivation will accept.
    const requirementContext: RequirementContext = requirementContextFor(derived);

    // Answered slots settle immediately, even inside a pool that still owes more — a wizard's
    // first cantrip moves to "Choices already made" the moment it is picked, and only its
    // still-open second and third slots stay behind here. `picks` is declared before this loop
    // so both halves of one pool can land in the right place in the same pass.
    const picks: SettledPick[] = [];

    // What a select's own answer is worth for the ranking further down — every chosen
    // element inherits whatever rank its granting element carries, the same as a `<grant>`
    // target does. It has to be gathered separately from a grant edge: the engine seeds a
    // chosen element into `active` straight from `character.choices` (`chosenIds` in
    // `deriveCharacter`), never through a `<grant>` rule, so a picked subrace or a picked
    // class archetype has no grant edge leading to it at all — only this one, built from the
    // same `from`/`chosen` pairs the loops below already compute.
    const choiceEdges = new Map<ElementId, ElementId[]>();
    const addChoiceEdge = (from: ElementId, chosen: ElementId[]): void => {
      if (!chosen.length) return;
      const existing = choiceEdges.get(from);
      if (existing) existing.push(...chosen);
      else choiceEdges.set(from, [...chosen]);
    };

    // A select opened by something already chosen — a class's Skill Proficiency, say.
    const selectDecisions: OpenDecision[] = [];
    for (const choice of derived.pendingChoices) {
      // `getChoice` and not `choice`'s own shape: the engine tracks how many are left, not
      // which ids they were (ADR 0032).
      const chosen = getChoice(this.character, choice.ruleKey)?.elementIds ?? [];
      addChoiceEdge(choice.from, chosen);
      const stepId = stepForType.get(choice.type) ?? '';
      selectDecisions.push({
        id: choice.ruleKey,
        kind: 'select',
        label: choice.label,
        stepId,
        blocking: !choice.optional,
        from: choice.from,
        openedAt: choice.level,
        remaining: choice.remaining,
        candidates: choice.candidates,
        chosen,
        unresolved: choice.unresolvedSupports,
      });
      if (chosen.length > 0) {
        // Settled so far. `choice.candidates` already excludes it along with everything else
        // the character holds, so adding it back is what lets its own slot's dropdown keep
        // showing it — the same trick a fully answered pool uses below.
        picks.push({
          ruleKey: choice.ruleKey,
          stepId,
          label: choice.label,
          chosen,
          candidates: [...choice.candidates, ...chosen],
        });
      }
    }

    // Top-level picks — the race, class and background nothing declares a select for.
    //
    // Only `required` steps, and never a `perLevel` one: what a level was spent on is
    // `Character.advancement` and belongs to `setProgress` (ADR 0015), not to a choice. Steps
    // that are neither — equipment, spells, details — are left alone rather than given an
    // invented decision, because the bag (ADR 0024) and content's own selects already own them.
    const pickDecisions: OpenDecision[] = [];
    // What an answered pick's own elements are worth for the structural ordering further
    // down — its step's fixed position, never a timestamp. Filled as the loop below finds
    // each answered pick, same as `picks` and `pickDecisions` are.
    const pickElementRank = new Map<ElementId, number>();
    for (const step of this.steps) {
      if (!step.required || step.perLevel || !step.types.length) continue;
      const ruleKey = pickRuleKey(step.id);
      const candidates = step.types.flatMap((type) =>
        this.elements
          .byType(type)
          // The element's own `requirements` — the Human Variant is only offered when the
          // campaign uses feats. Same filter `candidatesFor` applies to a select's pool.
          .filter((element) => evaluateRequirements(element.requirements, requirementContext))
          .map((element) => element.id),
      );

      const answer = this.character.choices.find(
        (c) => c.ruleKey === ruleKey && c.elementIds.length,
      );
      if (answer) {
        // Settled, not gone. The candidate list is rebuilt here rather than remembered from
        // when the choice was made, so it reflects the character as it is now — which is the
        // only way a second choice can be as legal as the first was.
        picks.push({
          ruleKey,
          stepId: step.id,
          label: step.label,
          chosen: [...answer.elementIds],
          candidates,
        });
        const rank = stepOrderIndex.get(step.id) ?? Number.MAX_SAFE_INTEGER;
        for (const id of answer.elementIds) pickElementRank.set(id, rank);
        continue;
      }

      pickDecisions.push({
        id: ruleKey,
        kind: 'pick',
        label: step.label,
        stepId: step.id,
        blocking: true,
        remaining: 1,
        // A top-level pick has no supports filter; the step names types and nothing else.
        unresolved: [],
        candidates,
        // Unanswered by construction — the moment it has one it moves to `picks` below.
        chosen: [],
      });
    }

    // A content `select` pool with nothing left to choose stays visible and editable too,
    // exactly as a top-level pick does — a wizard's second cantrip should not vanish the
    // moment it is chosen, any more than Race should (this is `pendingChoices`' counterpart,
    // `answeredChoices`, which the engine only ever produces once a pool is full). Its
    // `candidates` already excludes everything the character holds, `chosen` included, so
    // adding `chosen` back here keeps this array's contract the same for every entry: what
    // could be chosen instead always includes what is chosen now. Keeping one slot's answer
    // out of another slot's list is the pane's job, not this file's — see `BuilderPane.tsx`.
    for (const answered of derived.answeredChoices) {
      picks.push({
        ruleKey: answered.ruleKey,
        stepId: stepForType.get(answered.type) ?? '',
        label: answered.label,
        chosen: answered.chosen,
        candidates: [...answered.candidates, ...answered.chosen],
      });
      addChoiceEdge(answered.from, answered.chosen);
    }

    // What an answered pick opened stays pinned near that pick's own step (ADR 0034),
    // generalised rather than hardcoded to any one content shape. Recency was tried first and
    // measured wrong against the real corpus: ranking by *when* a pick was last answered means
    // the moment a later pick is answered, its own openings outrank an earlier pick's — Elven
    // Subrace sinking below Skill Proficiency the moment Class is answered, then below
    // Background's own openings once that is answered too, however long Elven Subrace itself
    // has sat there unanswered. `stepOrderIndex` fixes that: it is the build's declared order
    // (or a system's own explicit `priority`), not a clock, so Race's openings rank ahead of
    // Class's and Background's permanently, whatever gets answered afterward.
    //
    // A select's `from` is rarely the element the character chose directly, either — Elf
    // grants "Elven Subrace", and that marker is what actually declares the Sub Race select;
    // Wizard grants "Spellcasting" the same way. So a pick's rank has to walk forward through
    // what it granted, transitively, and let a marker reachable from more than one path keep
    // whichever pick gives it the better (numerically lower) rank.
    //
    // Two kinds of edge carry a rank forward, and a chain switches between them freely: a
    // `<grant>` rule (Elf → "Elven Subrace"), and a select's own answer (the marker's Sub
    // Race select → whichever subrace the player picked — "High Elf", say). Only following
    // grants would strand everything past the first select: a subrace's own further traits,
    // or a cleric's chosen Divine Domain and everything *that* grants, would all read as
    // unranked, because nothing granted the chosen subrace or the chosen domain — the engine
    // seeds a select's answer into `active` straight from `character.choices`, never through
    // a `<grant>` rule (see `chosenIds` in `packages/core/src/engine.ts`). `choiceEdges`
    // supplies the edge the grant walk cannot see, and once High Elf or a domain is ranked
    // this way, its own grants are ordinary further hops in the same walk.
    const elementRank = new Map(pickElementRank);
    const byId = new Map(derived.elements.map((element) => [element.id, element]));
    let frontier = [...elementRank.keys()];
    while (frontier.length > 0) {
      const next: ElementId[] = [];
      for (const id of frontier) {
        const rank = elementRank.get(id)!;
        const targets: ElementId[] = [...(choiceEdges.get(id) ?? [])];
        for (const rule of byId.get(id)?.rules ?? []) {
          if (rule.kind === 'grant' && byId.has(rule.id)) targets.push(rule.id);
        }
        for (const target of targets) {
          if ((elementRank.get(target) ?? Number.MAX_SAFE_INTEGER) <= rank) continue;
          elementRank.set(target, rank);
          next.push(target);
        }
      }
      frontier = next;
    }
    // An unanswered pick ranks by its own step; a select ranks by whatever it was granted
    // through. One scale for both (ADR 0034), so Race's Sub Race and Skill Proficiency and an
    // unanswered Background all compare on the same terms.
    //
    // This used to be two rules instead of one: every unanswered pick sorted before every
    // select, full stop, specifically so an unanswered Background couldn't let a class's
    // Skill Proficiency get picked out from under it — a background often grants a skill
    // outright, and picking the same one from Class first is a wasted choice. That rule is
    // gone now, on purpose, and not by accident: it could not coexist with Sub Race staying
    // ahead of a still-open Background, because Sub Race (from Race) and Skill Proficiency
    // (from Class) are the same shape relative to an unanswered Background — both come from
    // an earlier step — so any rule that keeps Background ahead of one keeps it ahead of the
    // other too. Asked directly, the call was to let Sub Race win. The Skill Proficiency
    // case is not simply reopened: `BuildStepDef.priority` lets a system restate it as data
    // instead of the engine hardcoding it — `systems/dnd5e/system.json`'s `background: 1.5`
    // is exactly that, sitting between race's 1 and class's 2. `use-character-builder.test.ts`
    // documents both halves of the trade.
    // A select's *declared* category wins over how it happened to get unlocked. A cantrip
    // is a "Spells" decision — `decision.stepId` already says so, via `stepForType` reading
    // straight from `system.json`'s `types` — and it stays one whether a class or a racial
    // feature is what opened its pool, so it ranks with `spells`, not with whatever earlier
    // step granted the marker. `elementRank`'s grant/choice-chain walk only matters for a
    // type nothing claims (`stepId === ''`) — Sub Race is that case: no step lists it, so it
    // has no declared home and falls back to riding along with Race, exactly as intended.
    const rankOf = (decision: OpenDecision): number => {
      if (decision.kind === 'pick') return stepOrderIndex.get(decision.stepId) ?? Number.MAX_SAFE_INTEGER;
      const declared = decision.stepId !== '' ? stepOrderIndex.get(decision.stepId) : undefined;
      if (declared !== undefined) return declared;
      return (
        (decision.from !== undefined ? elementRank.get(decision.from) : undefined) ??
        Number.MAX_SAFE_INTEGER
      );
    };
    const decisions: OpenDecision[] = [...pickDecisions, ...selectDecisions];
    decisions.sort((a, b) => rankOf(a) - rankOf(b));

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
          chosen: [],
          unresolved: [],
        });
      }
    }

    const hitPoints = new Map<string, HitPointState>();
    for (const step of this.steps) {
      const state = computeHitPointState(
        step,
        this.character,
        derived,
        this.kind.progression,
        this.reviewingHitPoints.has(step.id),
      );
      if (!state) continue;
      hitPoints.set(step.id, state);
      if (state.pending.length > 0 || (state.reviewing && state.levels.length > 0)) {
        decisions.push({
          id: `hitpoints:${step.id}`,
          kind: 'hitpoints',
          label: 'Hit Points',
          stepId: step.id,
          blocking: true,
          remaining: state.pending.length,
          // A per-level roll assigns a number, not an element.
          candidates: [],
          chosen: [],
          unresolved: [],
        });
      }
    }

    // A non-blocking decision the user declined (ADR 0033) leaves `decisions` the same way an
    // answered one does, and for the same reason: a step whose only outstanding items are
    // declined ones should read complete, not stuck open forever on something nobody intends
    // to answer. `declinedDecisions` never touches `character.choices`, so nothing here is
    // gated — a `blocking` decision is never filtered out even if its id somehow ended up in
    // the list, which is the same refusal `decline()` itself makes.
    const declinedIds = new Set(this.character.declinedDecisions ?? []);
    const declined: DeclinedDecision[] = [];
    const openDecisions = decisions.filter((decision) => {
      if (decision.blocking || !declinedIds.has(decision.id)) return true;
      declined.push({
        id: decision.id,
        kind: decision.kind,
        label: decision.label,
        stepId: decision.stepId,
        from: decision.from,
      });
      return false;
    });

    const available = new Set<string>();
    const steps: BuilderStep[] = this.steps.map((step) => {
      const blockedBy = (step.requires ?? []).filter((id) => !available.has(id));
      const isAvailable = blockedBy.length === 0;
      if (isAvailable) available.add(step.id);
      const open = openDecisions.filter((decision) => decision.stepId === step.id);
      return {
        id: step.id,
        label: step.label,
        required: step.required ?? false,
        available: isAvailable,
        blockedBy,
        openCount: open.length,
        complete: !open.some((decision) => decision.blocking),
        budget: budgets.get(step.id),
        hitPoints: hitPoints.get(step.id),
      };
    });

    return {
      character: this.character,
      derived,
      kind: this.kind,
      decisions: openDecisions,
      steps,
      picks,
      declined,
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
