/**
 * Which of the Build pane's tabs a piece of the build belongs on, and what the middle column edits — ADR 0124.
 *
 * Two things the pane used to decide by where it rendered them. **Spells get a tab of their own**, as Aurora's builder
 * has one: a decision or a settled choice of the type the kind prepares (5e: Spell), the prepared lists, the spell
 * attack settings and the spells added by hand. The tab is offered only when the character has any of those, so a
 * Fighter's pane is what it was. **A settled choice or a set of values is changed in the middle column**, where open
 * decisions are, instead of inside the column beside them: the pane holds which one (`SettledEdit`), and
 * `settledEditView` says what that is now, or nothing once it is gone. Nothing here is stored in a character.
 */

import type { ElementId, ResolvedCharacterKind } from '@incudo/core';

import type { AdditionsState } from './additions.ts';
import { BUILD_TABS, type BuildTab } from './build-preferences.ts';
import { decisionGroups, slotOptions } from './build-view.ts';
import type { BuilderState, OpenDecision, SettledPick } from './use-character-builder.ts';

/** The element type a kind's spells are: the type its preparation prepares. Undefined for a kind that prepares none. */
export function spellType(kind: ResolvedCharacterKind): string | undefined {
  return kind.preparation?.elementType;
}

/** The element type a decision or settled choice offers: its pool's, or its build step's when it has one type. */
function choiceType(state: BuilderState, ruleKey: string, stepId: string): string | undefined {
  const pool =
    state.derived.pendingChoices.find((choice) => choice.ruleKey === ruleKey) ??
    state.derived.answeredChoices.find((choice) => choice.ruleKey === ruleKey);
  if (pool) return pool.type;
  const types = state.kind.buildSteps.find((step) => step.id === stepId)?.types ?? [];
  return types.length === 1 ? types[0] : undefined;
}

/** Whether a decision belongs on the Spells tab: an element choice of the kind's spell type. */
export function isSpellDecision(state: BuilderState, decision: OpenDecision): boolean {
  const type = spellType(state.kind);
  if (!type || (decision.kind !== 'select' && decision.kind !== 'pick')) return false;
  return choiceType(state, decision.id, decision.stepId) === type;
}

/** Whether a settled choice belongs on the Spells tab. */
export function isSpellPick(state: BuilderState, pick: SettledPick): boolean {
  const type = spellType(state.kind);
  return type !== undefined && choiceType(state, pick.ruleKey, pick.stepId) === type;
}

/** What the character has added by hand, of the spell type or of every other: each tab lists its own. */
export function additionsOnTab(additions: AdditionsState, kind: ResolvedCharacterKind, tab: 'build' | 'spells'): AdditionsState {
  const type = spellType(kind);
  const keep = (t: string): boolean => (tab === 'spells' ? t === type : t !== type);
  return { ...additions, types: additions.types.filter((t) => keep(t.type)), rows: additions.rows.filter((row) => keep(row.type)) };
}

/** What one tab of the Build pane lists. */
export interface BuildTabContent {
  decisions: OpenDecision[];
  picks: SettledPick[];
}

/** The Build tab's and the Spells tab's decisions and settled choices, each in the builder's order. */
export function buildTabContent(state: BuilderState): { build: BuildTabContent; spells: BuildTabContent } {
  const spellDecisions = new Set(state.decisions.filter((d) => isSpellDecision(state, d)));
  const spellPicks = new Set(state.picks.filter((p) => isSpellPick(state, p)));
  return {
    build: {
      decisions: state.decisions.filter((d) => !spellDecisions.has(d)),
      picks: state.picks.filter((p) => !spellPicks.has(p)),
    },
    spells: {
      decisions: state.decisions.filter((d) => spellDecisions.has(d)),
      picks: state.picks.filter((p) => spellPicks.has(p)),
    },
  };
}

/** One tab as the pane shows it: its label, and how many required decisions wait on it. */
export interface BuildTabView {
  id: BuildTab;
  label: string;
  /** Required decisions still open on this tab; absent on a tab that holds no decisions. */
  required?: number;
}

/** Whether the character has anything for the Spells tab to show. */
export function hasSpellWork(state: BuilderState): boolean {
  if (!spellType(state.kind)) return false;
  const { spells } = buildTabContent(state);
  return (
    spells.decisions.length > 0 ||
    spells.picks.length > 0 ||
    state.preparation.length > 0 ||
    state.spellAttacks.rows.length > 0 ||
    additionsOnTab(state.additions, state.kind, 'spells').rows.length > 0
  );
}

/** The pane's tabs for this character, in order: Build, Spells when there is spell work, Equipment & notes. */
export function buildTabs(state: BuilderState): BuildTabView[] {
  const content = buildTabContent(state);
  const label = (id: BuildTab): string => BUILD_TABS.find((tab) => tab.id === id)!.label;
  const tabs: BuildTabView[] = [{ id: 'build', label: label('build'), required: decisionGroups(content.build.decisions).required.length }];
  if (hasSpellWork(state)) {
    tabs.push({ id: 'spells', label: label('spells'), required: decisionGroups(content.spells.decisions).required.length });
  }
  tabs.push({ id: 'details', label: label('details') });
  return tabs;
}

/** The tab after the one shown, wrapping: what Switch Build tab moves to. */
export function nextBuildTab(current: BuildTab, tabs: readonly BuildTabView[]): BuildTab {
  const at = tabs.findIndex((tab) => tab.id === current);
  return tabs[(at + 1) % tabs.length]?.id ?? 'build';
}

/** The tab to show: the one the user chose while this character has it, else Build. */
export function shownTab(preferred: BuildTab, tabs: readonly BuildTabView[]): BuildTab {
  return tabs.some((tab) => tab.id === preferred) ? preferred : 'build';
}

/** Under the Build tab's open decisions, where spell choices are left waiting on the other tab. */
export function spellsWaitingNote(required: number): string | undefined {
  if (required <= 0) return undefined;
  return required === 1
    ? 'One spell choice is waiting on the Spells tab.'
    : `${required} spell choices are waiting on the Spells tab.`;
}

// --- editing a settled answer in the middle column ------------------------------------

/** What the middle column is editing, if anything: one slot of a settled choice, or one step's values. */
export type SettledEdit = { kind: 'pick'; ruleKey: string; slot: number } | { kind: 'values'; stepId: string };

/** What the middle column shows for an edit, read from the state as it is now. */
export type SettledEditView =
  | {
      kind: 'pick';
      title: string;
      pick: SettledPick;
      slot: number;
      /** The slot's answer now, marked in the list and listed first while nothing is typed (`searchCandidates`). */
      current: ElementId;
      /** What the slot could hold, its current answer among them. */
      options: ElementId[];
    }
  | { kind: 'values'; title: string; stepId: string };

/**
 * The edit as it stands, or undefined once there is nothing left to edit: the choice was removed, the slot is gone, or
 * the step no longer has values. The pane then goes back to the open decisions.
 */
export function settledEditView(state: BuilderState, edit: SettledEdit | undefined): SettledEditView | undefined {
  if (!edit) return undefined;
  if (edit.kind === 'pick') {
    const pick = state.picks.find((p) => p.ruleKey === edit.ruleKey);
    const current = pick?.chosen[edit.slot];
    if (!pick || current === undefined) return undefined;
    return {
      kind: 'pick',
      title: `Change ${pick.label}`,
      pick,
      slot: edit.slot,
      current,
      options: slotOptions(pick, edit.slot),
    };
  }
  const step = state.steps.find((s) => s.id === edit.stepId);
  if (!step || (!step.budget && !step.hitPoints)) return undefined;
  return { kind: 'values', title: `Edit ${step.label}`, stepId: step.id };
}

/** The way back from an edit, and what is said beside it. */
export const SETTLED_EDIT_BACK = 'Back to open decisions';
export const SETTLED_EDIT_HINT = 'Pick another to change it, or go back to keep it. Escape also goes back.';
/** The words beside the answer a slot holds now, in its list. */
export const CURRENT_CHOICE = 'current choice';
/** Beside a set of values being edited: they apply as they change, so there is nothing to confirm. */
export const SETTLED_VALUES_HINT = 'Changes apply as you make them. Done or Escape goes back.';

/** The Spells tab's two headings: what is still to choose, and what is chosen. */
export const SPELL_DECISIONS_HEADING = 'Spell choices';
export const SPELLS_CHOSEN_HEADING = 'Spells chosen';
