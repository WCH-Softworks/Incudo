/**
 * What a build screen shows beside the builder's own state, worded once for every shell — ROADMAP Phase 6's build flow.
 *
 * The desktop's panes had kept a few of these to themselves: which options one slot of an answered select may change to,
 * which steps count as settled, how a decision's tags and a class option's reason read. The phone draws the same build,
 * so they moved here (CODE-REUSE-POLICY rule 2): two copies of a sentence drift, and one of these is a rule (two slots
 * never agreeing on one answer unless it repeats). Nothing here names a game.
 */

import type { ElementId, StatDef } from '@incudo/core';

import { formatProgress } from './character-kinds.ts';
import { scoreLabel, type ClassLevelState, type ClassOption, type ClassSegment, type ScoreShortfall } from './multiclass.ts';
import type { PreparedItem } from './preparation.ts';
import type { BuilderState, BuilderStep, HolderGrant, OpenDecision, ProgressState, SettledPick } from './use-character-builder.ts';

/**
 * What slot `index` of an answered decision may hold instead: its own answer, anything no other slot holds, and anything
 * that may be taken twice (ADR 0035: a +1 chosen in both slots is a +2). `pick.candidates` covers every slot; keeping two
 * slots from agreeing is this. Two slots never hold one thing from two books either (ADR 0125): a slot is offered the
 * other printing of its own answer, as a change of book, and not of another slot's.
 */
export function slotOptions(pick: SettledPick, index: number): ElementId[] {
  const own = pick.chosen[index];
  const others = pick.chosen.filter((_, at) => at !== index);
  const reprinted = (candidate: ElementId): boolean => {
    const printing = pick.printings?.[candidate];
    if (!printing) return false;
    return others.some((answer) => {
      const theirs = pick.printings?.[answer];
      return theirs !== undefined && theirs.thing === printing.thing && theirs.book !== printing.book;
    });
  };
  return pick.candidates.filter(
    (candidate) =>
      candidate === own ||
      pick.repeatable.includes(candidate) ||
      (!pick.chosen.includes(candidate) && !reprinted(candidate)),
  );
}

/** `choose`'s answer when slot `index` changes to `next`. */
export function withSlot(pick: SettledPick, index: number, next: ElementId): ElementId[] {
  const chosen = [...pick.chosen];
  chosen[index] = next;
  return chosen;
}

/** `choose`'s answer when slot `index` of a set is taken back. Only a set (`pick.multiple`) may be emptied. */
export function withoutSlot(pick: SettledPick, index: number): ElementId[] {
  return pick.chosen.filter((_, at) => at !== index);
}

/**
 * Steps whose values are set and still editable: a budget nothing is outstanding on, and a step's per-level hit points
 * once some level is not an open card of its own (each level still to record is one). A finished budget leaves
 * `decisions`, and would take its editor with it otherwise.
 */
export function settledSteps(state: Pick<BuilderState, 'steps' | 'decisions'>): BuilderStep[] {
  const open = (kind: OpenDecision['kind'], stepId: string): boolean =>
    state.decisions.some((decision) => decision.kind === kind && decision.stepId === stepId);
  return state.steps.filter(
    (step) =>
      (step.budget !== undefined && !open('budget', step.id)) ||
      (step.hitPoints !== undefined &&
        step.hitPoints.levels.length >
          state.decisions.filter((decision) => decision.kind === 'hitpoints' && decision.stepId === step.id).length),
  );
}

/**
 * The tags beside an open decision's label, in the order a screen shows them: "optional", "2 left" (never for a set,
 * which has no count to run down), "opened at 4" (in the granting element's own track, ADR 0015).
 */
export function decisionTags(decision: OpenDecision): string[] {
  const tags: string[] = [];
  if (!decision.blocking) tags.push('optional');
  // A starting package is taken whole, so it owes no count (ADR 0087); what an option still owes is on the option.
  if (!decision.multiple && decision.kind !== 'equipment') tags.push(decision.remaining > 0 ? `${decision.remaining} left` : 'all recorded');
  if (decision.openedAt !== undefined) tags.push(`opened at ${decision.openedAt}`);
  return tags;
}

/**
 * What a step's line says of it: what it waits for, "2 open" while it owes an answer, and otherwise what is true of it.
 * "complete" only once something is taken there: a step nothing obliges, with nothing taken, says "optional" while
 * something may still be taken, "skipped" when it was skipped, and "nothing to choose" when nothing is offered. It
 * used to say "complete" for all of them, so an alignment never chosen read as chosen.
 */
export function stepStatus(
  step: Pick<BuilderStep, 'available' | 'blockedBy' | 'complete' | 'openCount' | 'taken' | 'skipped'>,
  labelOf: (stepId: string) => string = (id) => id,
): string {
  if (!step.available) return `needs ${step.blockedBy.map(labelOf).join(', ')}`;
  if (!step.complete) return `${step.openCount} open`;
  if (step.taken) return 'complete';
  if (step.openCount > 0) return 'optional';
  if (step.skipped) return 'skipped';
  return 'nothing to choose';
}

/** How a step's status is drawn: done once complete, open while it owes an answer, blocked, quiet otherwise. */
export function stepTone(
  step: Pick<BuilderStep, 'available' | 'complete' | 'taken'>,
): 'done' | 'open' | 'blocked' | 'quiet' {
  if (!step.available) return 'blocked';
  if (!step.complete) return 'open';
  return step.taken ? 'done' : 'quiet';
}

/** The scores a class asks for and the character lacks: "Strength 13 (you have 10) or Dexterity 13 (you have 8)". */
export function shortfallText(flag: ScoreShortfall[][], stats: ReadonlyArray<StatDef>): string {
  return flag
    .map((terms) => terms.map((term) => `${scoreLabel(stats, term.stat)} ${term.needs} (you have ${term.has})`).join(' and '))
    .join(' or ');
}

/** Why a class may not be taken, or nothing when it may (ADR 0045: a score minimum alone does not stop it). */
export function unavailableReason(option: ClassOption, labelOf: (id: ElementId) => string): string | undefined {
  if (option.eligible) return undefined;
  if (option.unavailable === 'no-multiclass-rules') return 'cannot be taken as an additional class';
  if (option.unavailable === 'excluded' && option.excludedBy) return `cannot be combined with ${labelOf(option.excludedBy)}`;
  if (option.unavailable === 'multiclassing-off') return 'switched off for this character';
  return option.prerequisite ? `needs ${option.prerequisite}` : 'requirements not met';
}

/**
 * A class level's options as a screen groups them: the character's classes, those it may add, those it may not. A class
 * unavailable only because what allows another class is off (ADR 0088) is in none of them: `multiclassOffNote` says so
 * once, rather than every class in the game listed with the same reason.
 */
export function classOptionGroups(options: readonly ClassOption[]): {
  taken: ClassOption[];
  available: ClassOption[];
  unavailable: ClassOption[];
} {
  return {
    taken: options.filter((option) => option.taken),
    available: options.filter((option) => !option.taken && option.eligible),
    unavailable: options.filter((option) => !option.taken && !option.eligible && option.unavailable !== 'multiclassing-off'),
  };
}

/**
 * What a class control says while what allows another class is off (ADR 0088), in that option's own name, or nothing while
 * it is on. A character that holds more than one class anyway is told that nothing was removed and how to settle it.
 */
export function multiclassOffNote(
  state: Pick<ClassLevelState, 'allowedBy' | 'classes'>,
  labelOf: (id: ElementId) => string,
): string | undefined {
  if (state.allowedBy === undefined) return undefined;
  // An option no loaded source declares has no name to give, and its id is not one to show: a save opened with no source
  // does not carry an option its character does not hold. It is described instead.
  const label = labelOf(state.allowedBy);
  const named = label !== '' && label !== state.allowedBy;
  const option = named ? label : 'The option that allows another class';
  const it = named ? label : 'it';
  return state.classes.length > 1
    ? `${option} is switched off for this character, and it has levels in more than one class. Nothing has been removed: switch ${it} back on, or move its levels to one class.`
    : `${option} is switched off for this character, so new levels go to the class it has. Switch ${it} on to add another class.`;
}

/** A prepared list's line for one spell: "Shield (Level 1)". */
export function preparedItemText(item: PreparedItem): string {
  return item.note ? `${item.name} (${item.note})` : item.name;
}

/** One heading of what a held element gives: its rows that can be shown, and how many more nothing loaded declares. */
export interface HolderGrantGroup {
  /** The heading: `HolderGrant.group`, or "Other". */
  label: string;
  /** What can be shown and taken away or given back, in the builder's order. */
  rows: HolderGrant[];
  /**
   * How many removed ones nothing loaded declares. A removed element is not saved (ADR 0061), so a file opened with no
   * content has only its id, and giving it back needs the content it came from.
   */
  unseen: number;
}

/** What one held element gives, grouped under the headings the builder names. */
export interface HolderGrantSection {
  from: ElementId;
  groups: HolderGrantGroup[];
}

/**
 * What held elements give (ADRs 0061, 0067), as a screen lists it: by the element that gives it, in the order the
 * builder lists them, and within that by heading. `known` says whether loaded or embedded content declares an id.
 */
export function holderGrantSections(
  grants: readonly HolderGrant[],
  known: (id: ElementId) => boolean,
): HolderGrantSection[] {
  return [...new Set(grants.map((grant) => grant.from))].map((from) => {
    const own = grants.filter((grant) => grant.from === from);
    return {
      from,
      groups: [...new Set(own.map((grant) => grant.group))].map((group) => {
        const listed = own.filter((grant) => grant.group === group);
        return {
          label: group || 'Other',
          rows: listed.filter((grant) => known(grant.elementId)),
          unseen: listed.filter((grant) => !known(grant.elementId)).length,
        };
      }),
    };
  });
}

/** The heading of what `name` gives. */
export function holderGrantsHeading(name: string): string {
  return `From ${name}`;
}

/** What a section of what `name` gives says first. */
export function holderGrantsHint(name: string): string {
  return `These come with ${name}. Remove any this character does not have; a removed one can be given back here.`;
}

/** What a row says beside its name: nothing while it is given, else that it was removed and whether it is held anyway. */
export function holderGrantStatus(grant: Pick<HolderGrant, 'removed' | 'held'>): string | undefined {
  if (!grant.removed) return undefined;
  return grant.held ? 'removed, but also chosen or given by something else' : 'removed';
}

/** The line for removed ones nothing loaded declares, or nothing when there are none. */
export function holderGrantsUnseenNote(unseen: number): string | undefined {
  if (unseen <= 0) return undefined;
  return unseen === 1
    ? 'One more was removed. Load the content it came from to see it or give it back.'
    : `${unseen} more were removed. Load the content they came from to see them or give them back.`;
}

// --- the level control ----------------------------------------------------------------------------------------------

/**
 * A level-based character's level as a build screen shows it: the number, the classes it is made of, and the two moves a
 * player has, one level up and one level down. Buttons and not a typed number: a typed 1 on the way to 12 dropped every
 * level above it, and a level is gained or lost one at a time. A jump of many levels is the class split's.
 *
 * `up` is absent at the progression's top and `down` at its bottom. Which class the next level goes to is the screen's
 * choice among `ClassLevelState.options`, defaulting to `nextClass`; `down` names the class the level it removes was in.
 */
export interface LevelControlView {
  level: number;
  /** "Fighter 3 / Wizard 2", once a class is chosen. */
  summary?: string;
  up?: { level: number; label: string };
  down?: { level: number; label: string };
  /** The class a level up goes to unless another is chosen: the last level's, else the first class. */
  nextClass?: ElementId;
}

export function levelControlView(
  level: number,
  bounds: { min?: number; max?: number },
  state: ClassLevelState | undefined,
  nameOf: (id: ElementId) => string,
): LevelControlView {
  const min = bounds.min ?? 1;
  const last = state?.levels[state.levels.length - 1];
  const canUp = state ? state.canAddLevel : bounds.max === undefined || level < bounds.max;
  const nextClass = last?.classId ?? state?.firstClassId;
  const summary = state?.classes.length ? state.classes.map((held) => `${nameOf(held.id)} ${held.levels}`).join(' / ') : undefined;
  const removed = last?.classId !== undefined && state && state.classes.length > 0 ? ` (${nameOf(last.classId)} ${last.classLevel})` : '';
  return {
    level,
    ...(summary ? { summary } : {}),
    ...(canUp ? { up: { level: level + 1, label: `Level up to ${level + 1}` } } : {}),
    ...(level > min ? { down: { level: level - 1, label: `Remove level ${level}${removed}` } } : {}),
    ...(nextClass ? { nextClass } : {}),
  };
}

/** What the level control says under its buttons. */
export const LEVEL_HINT =
  'What a new level opens arrives in Open decisions, tagged with the level that raised it. Removing a level keeps what was chosen for it: those choices wait under Not counting and count again if the level comes back.';

/** What it says beside the class a level up goes to, when another class may be added. */
export const LEVEL_MULTICLASS_HINT = 'Choose another class here to take this level in it.';

/** A screen that offers the next class through a picker rather than beside the button: the button that opens it. */
export const LEVEL_UP_OTHER = 'Level up in another class…';

/**
 * What the two folded parts under the level buttons are called. A name that says what opening one lets you do: the split's
 * was "Set the split", which said nothing to someone who had not read about splits, and both open collapsed.
 */
export const SPLIT_LABEL = 'Set levels for each class at once';
export const LEVEL_ROWS_LABEL = "Change a past level's class";

// --- a class split (ADR 0045) ---------------------------------------------------------------------------------------

/** The split a character has now, one row per class in the order it was first taken: where an edit starts. */
export function currentSplit(state: Pick<ClassLevelState, 'classes'>): ClassSegment[] {
  return state.classes.map((held) => ({ classId: held.id, levels: held.levels }));
}

/** A split being edited, as a screen shows it beside its Apply. Whether the classes may be combined is `applySplit`'s. */
export interface SplitDraftView {
  rows: ClassSegment[];
  /** The character level the rows add up to; a count that is not a number counts nothing. */
  total: number;
  /** "Character level 17", with the most there may be when the rows go past it. */
  totalText: string;
  /** Whether Apply may be offered: some rows, each a whole number of at least one, adding up to no more than the most. */
  valid: boolean;
}

export function splitDraftView(state: Pick<ClassLevelState, 'maxLevel'>, rows: readonly ClassSegment[]): SplitDraftView {
  const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.levels) ? row.levels : 0), 0);
  const tooHigh = state.maxLevel !== undefined && total > state.maxLevel;
  return {
    rows: [...rows],
    total,
    totalText: `Character level ${total}${tooHigh ? ` — the most is ${state.maxLevel}` : ''}`,
    valid: rows.length > 0 && !tooHigh && rows.every((row) => Number.isInteger(row.levels) && row.levels >= 1),
  };
}

/** The rows with row `index` changed. */
export function withSplitRow(rows: readonly ClassSegment[], index: number, patch: Partial<ClassSegment>): ClassSegment[] {
  return rows.map((row, at) => (at === index ? { ...row, ...patch } : row));
}

/** The rows with row `index` moved `by` places (-1 up, 1 down); unchanged when that would leave the list. */
export function movedSplitRow(rows: readonly ClassSegment[], index: number, by: number): ClassSegment[] {
  const target = index + by;
  if (index < 0 || index >= rows.length || target < 0 || target >= rows.length) return [...rows];
  const next = [...rows];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** The rows without row `index`. The last row stays: a split of nothing is not one to apply. */
export function withoutSplitRow(rows: readonly ClassSegment[], index: number): ClassSegment[] {
  if (rows.length <= 1) return [...rows];
  return rows.filter((_, at) => at !== index);
}

/** The rows with one more, a level of the last row's class (else the first class), to be changed from there. */
export function withAddedSplitRow(rows: readonly ClassSegment[], state: Pick<ClassLevelState, 'firstClassId'>): ClassSegment[] {
  const classId = rows[rows.length - 1]?.classId ?? state.firstClassId;
  return classId === undefined ? [...rows] : [...rows, { classId, levels: 1 }];
}

/** What the split editor says first. */
export const SPLIT_HINT =
  'Say how many levels go to each class, in the order they were taken. The first row is the class the character started as, which decides its starting proficiencies and its highest hit die.';

/** What it says when `applySplit` refused the rows. */
export const SPLIT_REFUSED = 'These classes cannot be combined, so nothing was changed.';

/** What it says while the levels are not taken one class at a time (`ClassLevelState.interleaved`). */
export const SPLIT_INTERLEAVED =
  'The levels are not taken one class at a time right now. Applying replaces that order with the rows above.';

// --- progress that content prints (ADR 0060) ------------------------------------------------------------------------

/**
 * The link back to where content starts the progression, or nothing when there is none to go back to: only while a
 * typed value replaces a printed one that differs. "Use Wolf's (1/4)". `nameOf` names the element that prints it.
 */
export function progressResetLabel(
  progress: Pick<ProgressState, 'recorded' | 'printed' | 'printedBy' | 'value'>,
  nameOf: (id: ElementId) => string,
): string | undefined {
  if (!progress.recorded || progress.printed === undefined || progress.printed === progress.value) return undefined;
  const whose = progress.printedBy !== undefined ? `${nameOf(progress.printedBy)}'s` : 'the printed one';
  return `Use ${whose} (${formatProgress(progress.printed)})`;
}

/**
 * What is said under a progression content may print: a faded number is the printed one, and how to go back to it.
 * "A faded number is Wolf's own, …" once something prints one; nothing for a progression nothing can print.
 */
export function progressPrintedHint(
  progress: Pick<ProgressState, 'printable' | 'printedBy'>,
  nameOf: (id: ElementId) => string,
): string | undefined {
  if (!progress.printable) return undefined;
  const whose = progress.printedBy !== undefined ? `${nameOf(progress.printedBy)}'s own` : 'what the character holds prints';
  return `A faded number is ${whose}, and it is used until you type another. Clear what you typed to go back to it.`;
}

/**
 * Open decisions as a screen lists them (ADR 0123): what must be answered, then what may be, folded under a heading of
 * its own. The builder already sorts them that way; this only splits them, so the phone and the desktop split alike.
 */
export function decisionGroups(decisions: readonly OpenDecision[]): {
  required: OpenDecision[];
  optional: OpenDecision[];
  /** How many of `required` are owed: one listed there by its step (ADR 0127) is shown and not counted. */
  owed: number;
} {
  const first = (decision: OpenDecision): boolean => decision.blocking || decision.withRequired === true;
  return {
    required: decisions.filter(first),
    optional: decisions.filter((decision) => !first(decision)),
    owed: decisions.filter((decision) => decision.blocking).length,
  };
}

/** The heading the optional decisions fold under: "Optional (5)". */
export function optionalDecisionsLabel(count: number): string {
  return `Optional (${count})`;
}

/** What a screen says under that heading. */
export const OPTIONAL_DECISIONS_HINT = 'None of these has to be answered. Take what your table uses, or skip it.';

/** What Open decisions says when only optional ones are left. */
export const NOTHING_REQUIRED = 'Nothing more has to be decided.';

/** How a decision is told apart from the others on one screen, its card's key included. */
export function decisionKey(decision: Pick<OpenDecision, 'kind' | 'id'>): string {
  return `${decision.kind}:${decision.id}`;
}

/**
 * The decision that has just taken the top of the list, when it is not the one there before (ADR 0123): a pick that
 * closed the top card brings the next one into the same place, and a screen marks the new one so a quick second click is
 * not taken for the old card. Undefined when the top is the same, when nothing was on screen before, and when the list
 * is empty. `previous` is the key of the decision that was first.
 */
export function arrivedDecision(previous: string | undefined, decisions: readonly OpenDecision[]): string | undefined {
  const top = decisions[0];
  if (previous === undefined || top === undefined) return undefined;
  const key = decisionKey(top);
  return key === previous ? undefined : key;
}

/** How long a card that has just taken the top ignores the pointer, in milliseconds: about a quick double click. */
export const ARRIVAL_GUARD_MS = 400;

/** What a set asked when the character was started holds, by name: "Feats, Multiclassing", or "None". */
export function startOptionsSummary(chosen: readonly ElementId[], nameOf: (id: ElementId) => string): string {
  return chosen.length ? chosen.map(nameOf).join(', ') : 'None';
}

/** The dialog New character opens for them, and its line among the choices made. */
export const START_OPTIONS_HINT = 'These shape what the rest of the build offers. You can change them later on Build.';
export const START_OPTIONS_BEGIN = 'Start building';
export const START_OPTIONS_SAVE = 'Done';
export const START_OPTIONS_CHANGE = 'Change…';
/**
 * Said while the content a new character's options are read from is still loading. Before it loads the dialog could offer
 * only the defaults, named by their ids, so it waits for the load (the phone's does too).
 */
export const START_OPTIONS_WAITING = 'Loading content. The campaign options open when it is ready.';
/** Said in place of "No content loaded" while a load is still running. */
export const CONTENT_LOADING = 'Loading content…';
