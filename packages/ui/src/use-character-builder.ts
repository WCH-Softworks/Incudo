/**
 * The character builder as a state machine.
 *
 * Desktop renders this as a three-pane layout with everything visible at once; mobile
 * renders it as a step-by-step wizard. Neither shell contains a rule about the game.
 *
 * Deliberately framework-light: plain functions plus a tiny store, so this is testable
 * in Node and usable from any React renderer. The React binding is a five-line
 * `useSyncExternalStore` in each shell.
 */

import {
  clampProgress,
  deriveCharacter,
  resolveCharacterKind,
  setChoice,
  setRoll,
  type Character,
  type DerivedCharacter,
  type ElementId,
  type ElementIndex,
  type GameSystem,
  type ResolvedCharacterKind,
} from '@incudo/core';

export interface BuilderStep {
  id: string;
  label: string;
  required: boolean;
  /** Choices belonging to this step that still need answering. */
  pendingCount: number;
  complete: boolean;
}

export interface BuilderState {
  character: Character;
  derived: DerivedCharacter;
  /** The kind being built. Its `buildSteps` are what the screens below are made of. */
  kind: ResolvedCharacterKind;
  steps: BuilderStep[];
  currentStepId: string;
}

export class CharacterBuilder {
  private character: Character;
  private readonly system: GameSystem;
  private readonly kind: ResolvedCharacterKind;
  private readonly elements: ElementIndex;
  private currentStepId: string;
  private readonly listeners = new Set<() => void>();
  private cached: BuilderState | undefined;

  constructor(character: Character, system: GameSystem, elements: ElementIndex) {
    this.character = character;
    this.system = system;
    // The build flow comes from the kind, not the system: a monster stat block and a PC
    // sheet share nothing but the stats underneath (ADR 0009).
    this.kind = resolveCharacterKind(system, character.kind);
    this.elements = elements;
    this.currentStepId = this.kind.buildSteps[0]?.id ?? '';
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

  goToStep = (stepId: string): void => {
    this.currentStepId = stepId;
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

    const steps: BuilderStep[] = this.kind.buildSteps.map((step) => {
      const pending = derived.pendingChoices.filter((choice) =>
        step.types.includes(choice.type),
      );
      const blocking = pending.filter((p) => !p.optional);
      return {
        id: step.id,
        label: step.label,
        required: step.required ?? false,
        pendingCount: pending.length,
        complete: blocking.length === 0,
      };
    });

    return {
      character: this.character,
      derived,
      kind: this.kind,
      steps,
      currentStepId: this.currentStepId,
    };
  }
}
