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
  deriveCharacter,
  setChoice,
  type Character,
  type DerivedCharacter,
  type ElementId,
  type ElementIndex,
  type GameSystem,
} from '@heroforge/core';

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
  steps: BuilderStep[];
  currentStepId: string;
}

export class CharacterBuilder {
  private character: Character;
  private readonly system: GameSystem;
  private readonly elements: ElementIndex;
  private currentStepId: string;
  private readonly listeners = new Set<() => void>();
  private cached: BuilderState | undefined;

  constructor(character: Character, system: GameSystem, elements: ElementIndex) {
    this.character = character;
    this.system = system;
    this.elements = elements;
    this.currentStepId = system.buildSteps[0]?.id ?? '';
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

  setLevel = (level: number): void => {
    const clamped = Math.min(
      Math.max(level, this.system.levelRange.min),
      this.system.levelRange.max,
    );
    this.character = { ...this.character, level: clamped };
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
    const derived = deriveCharacter(this.character, this.system, this.elements);

    const steps: BuilderStep[] = this.system.buildSteps.map((step) => {
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

    return { character: this.character, derived, steps, currentStepId: this.currentStepId };
  }
}
