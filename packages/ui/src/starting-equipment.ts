/**
 * The starting equipment step — ADR 0087, and since ADR 0119 read from content.
 *
 * What a character may start with is written on its class and background (`Element.startingEquipment`): a list of
 * options of which the character takes one, a package of item lines, fixed coins, or a wealth roll. Aurora's content
 * states it only as prose, and its converter reads that prose into these (ADR 0119 decision 9); a line it matched to no
 * item is pending, recorded when the package is taken and resolved by the user, with an item or a name of their own.
 * The kind says which step offers the packages and which picks they come from (`kind.startingEquipment`).
 *
 * Everything is worked out here, under `node --test`: what the step offers for the character's
 * first class and its background, the answers a package still owes, and the two writes. Taking an option writes once
 * into the bag and the purse, which are inputs the player owns from then on, and records what it wrote; taking it back
 * removes exactly that, and only while the bag still holds every entry it added and the purse still covers its coins.
 * Once the player has used part of it the step says so and leaves the bag alone: which purchase replaced which starting
 * item is a guess.
 *
 * Nothing here names a game: the steps, the item types that are equipped, the units and the packages are the file's
 * and the system's. The panes render the state and compute nothing.
 */

import {
  matchesSupports,
  newInstanceId,
  parseSupports,
  removeInventoryEntry,
  resolveEquipment,
  setInventoryEntry,
  setMoney,
  setRoll,
  setStartingEquipmentTaken,
  systemLineage,
  type BuildStepDef,
  type Character,
  type Element,
  type ElementId,
  type ElementIndex,
  type GameSystem,
  type InventoryEntry,
  type ResolvedCharacterKind,
  type SchemaError,
  type StartingBundle,
  type StartingEquipmentTaken,
  type StartingOption,
  type StartingPick,
} from '@incudo/core';

export type { StartingBundle, StartingLine, StartingOption, StartingPick } from '@incudo/core';

import { parseDice, rollDice } from './dice.ts';
import { formatCoins, purseRows, type PurseRow } from './money.ts';
import { pickAnswerOf } from './top-level-pick.ts';

// --- the file --------------------------------------------------------------------------------------------------------

export interface StartingEquipmentFile {
  formatVersion: 1;
  /** The system this file belongs to, by id. */
  system: string;
  /** The character kind whose build offers the packages. */
  kind: string;
  /** The kind's build step the packages are offered in. */
  step: string;
  /** The kind's pick steps whose answer gives a package, in the order offered. */
  from: string[];
  /** Element types an item of which is equipped when taken, if a slot it fits is free. */
  equip?: string[];
  packages: StartingPackage[];
  /** The item a pending line the user names is entered as. */
  ownItem?: ElementId;
}

export interface StartingPackage {
  /** The class or background id. */
  for: ElementId;
  options: StartingOption[];
}

/**
 * What a checked file needs of the system it is used for: that system is the file's or descends from it (its lineage,
 * ADR 0104), the kind and the steps it names exist there, and every unit is one that system's `currency` declares. Asked
 * of the shipped system a file names when it is read, and again of every user's system its lineage hands it to (ADR
 * 0107): an overlay or a copy may change any of these, and a file used unchecked wrote money in a unit nothing declared.
 */
export function startingEquipmentFits(file: StartingEquipmentFile, system: GameSystem): SchemaError[] {
  const errors: SchemaError[] = [];
  if (!systemLineage(system).includes(file.system)) {
    errors.push({ path: 'system', message: `is "${file.system}", and this system is "${system.id}"` });
  }
  const kind = system.characterKinds.find((k) => k.id === file.kind);
  if (!kind) errors.push({ path: 'kind', message: `"${file.kind}" is not a kind this system declares` });
  else {
    // A kind may inherit its steps; the ones named must be the resolved kind's, which only a resolved read can say.
    const stepIds = new Set((kind.buildSteps ?? []).map((s) => s.id));
    if (kind.buildSteps && !stepIds.has(file.step)) errors.push({ path: 'step', message: `"${file.step}" is not a build step of "${file.kind}"` });
    for (const [i, id] of file.from.entries()) {
      const step = kind.buildSteps?.find((s) => s.id === id);
      if (kind.buildSteps && (!step || !step.types.length)) {
        errors.push({ path: `from[${i}]`, message: `"${id}" is not a build step of "${file.kind}" that chooses an element` });
      }
    }
  }
  const units = system.currency;
  if (units) {
    file.packages.forEach((entry, p) => {
      entry.options.forEach((option, o) => {
        const at = `packages[${p}].options[${o}]`;
        if (option.wealth && !(option.wealth.unit in units)) {
          errors.push({ path: `${at}.wealth.unit`, message: `"${option.wealth.unit}" is not a unit of money the system declares` });
        }
        for (const unit of Object.keys(option.coins ?? {})) {
          if (!(unit in units)) errors.push({ path: `${at}.coins.${unit}`, message: `"${unit}" is not a unit of money the system declares` });
        }
        // Coins inside a bundle (the converter writes "15 gp" in a package's line as these).
        (option.lines ?? []).forEach((line, l) => {
          const bundles = 'choose' in line ? line.choose.map((b, i) => [`.choose[${i}]`, b] as const) : [['', line] as const];
          for (const [path, bundle] of bundles) {
            for (const unit of Object.keys(bundle.coins ?? {})) {
              if (!(unit in units)) {
                errors.push({ path: `${at}.lines[${l}]${path}.coins.${unit}`, message: `"${unit}" is not a unit of money the system declares` });
              }
            }
          }
        });
      });
    });
  }
  return errors;
}

/**
 * The starting equipment a kind is offered, assembled from content (ADR 0119): where the kind takes it
 * (`kind.startingEquipment`), and every element of the types its `from` steps choose that carries packages. Nothing when
 * the kind declares none, or when what content writes does not fit the system (a coin it does not declare): the
 * builder then offers no package.
 */
export function startingEquipmentFor(
  system: GameSystem,
  kind: ResolvedCharacterKind,
  steps: readonly BuildStepDef[],
  elements: ElementIndex,
): StartingEquipmentFile | undefined {
  const declared = kind.startingEquipment;
  if (!declared || !steps.some((step) => step.id === declared.step)) return undefined;
  const types = new Set(steps.filter((step) => declared.from.includes(step.id)).flatMap((step) => step.types));
  const packages: StartingPackage[] = [];
  for (const type of types) {
    for (const element of elements.byType(type)) {
      if (element.startingEquipment?.length) packages.push({ for: element.id, options: element.startingEquipment });
    }
  }
  const file: StartingEquipmentFile = {
    formatVersion: 1,
    system: system.id,
    kind: kind.id,
    step: declared.step,
    from: declared.from,
    ...(declared.equip ? { equip: declared.equip } : {}),
    packages,
    ...(declared.ownItem ? { ownItem: declared.ownItem } : {}),
  };
  return startingEquipmentFits(file, system).length ? undefined : file;
}

// --- what the step offers ---------------------------------------------------------------------------------------------

/** Answers given so far to one option, before it is taken: which bundle of each choice, which items of each pick. */
export interface StartingAnswers {
  /** A choice line's key → the bundle chosen. */
  choices: Record<string, number>;
  /** A pick's key → what is chosen, one per slot (`undefined` where nothing is yet). */
  picks: Record<string, Array<ElementId | undefined>>;
}

/** Every option's answers so far, by the element the package is for and the option. Held by the builder, never saved. */
export type StartingDraft = Record<ElementId, Record<string, StartingAnswers>>;

export interface StartingPickView {
  /** Pass to `pickStartingItem`. */
  key: string;
  label: string;
  count: number;
  /** One per slot, `undefined` where nothing is chosen yet. */
  chosen: Array<ElementId | undefined>;
  /** What a slot may hold, by name; the same item may fill more than one slot ("two martial weapons"). */
  candidates: ElementId[];
}

export type StartingLineView =
  | { key: string; kind: 'items'; text: string; picks: StartingPickView[] }
  | {
      key: string;
      kind: 'choose';
      alternatives: Array<{ index: number; text: string }>;
      chosen?: number;
      /** The chosen bundle's picks. Empty until one is chosen. */
      picks: StartingPickView[];
    };

export interface StartingOptionView {
  id: string;
  label: string;
  lines: StartingLineView[];
  /** "15 gp", what the option adds to the purse. */
  coins?: string;
  /** A wealth roll: "5d4 × 10 gp", and what it came to when it has been rolled. */
  wealth?: { text: string; rolled?: number; amount?: string };
  unlisted: string[];
  /** Items the option names that nothing loaded declares, by id: it cannot be taken while any is missing. */
  missing: ElementId[];
  /** How many choices and pick slots are still unanswered. */
  owed: number;
  /** Whether Take would write it now. */
  ready: boolean;
}

export interface StartingTakenView {
  option: string;
  label: string;
  /** The bag entries it added, worded ("Arrow ×20"), as they are now; one the bag no longer holds says so. */
  entries: string[];
  coins?: string;
  /** The wealth roll it was taken with, when it was one. */
  rolled?: number;
  /** Whether Take back would undo it: the bag still holds every entry it added and the purse covers its coins. */
  canReturn: boolean;
}

export interface StartingSource {
  /** The decision's id, and what `decline` takes. */
  key: string;
  stepId: string;
  stepLabel: string;
  /** The class or background, when the step is answered or a package was taken for it. */
  forId?: ElementId;
  /** Whether `forId` is the step's answer now, rather than a package taken for an earlier answer. */
  current: boolean;
  status: 'unanswered' | 'none' | 'open' | 'taken' | 'used';
  /** A sentence for every status but `open`. */
  note?: string;
  /** The options, while `open`. */
  options: StartingOptionView[];
  taken?: StartingTakenView;
}

/** A line a taken package lists that content matched to no item (ADR 0119 decision 9), and how it was resolved. */
export interface StartingPendingView {
  /** The class or background whose package lists it, and its place in that package's record: what `resolve` takes. */
  forId: ElementId;
  index: number;
  /** The book's words, with how many: "a small knife", "sticks of incense ×5". */
  text: string;
  quantity: number;
  /** What it was resolved with, as the bag says it now; absent while it waits, or once that entry left the bag. */
  resolved?: string;
}

export interface StartingEquipmentState {
  stepId: string;
  sources: StartingSource[];
  /** Every pending line of every package taken, waiting or resolved, in the order the packages were taken. */
  pending: StartingPendingView[];
  /** Whether a pending line may be given a name of the user's own: the kind names an item to enter it as. */
  canName: boolean;
  /** Every unit the system declares, in its order, with what the character holds. Empty for a system with no money. */
  purse: PurseRow[];
}

/** What the step's state and writes read. */
export interface StartingContext {
  file: StartingEquipmentFile;
  system: GameSystem;
  kind: ResolvedCharacterKind;
  steps: readonly BuildStepDef[];
  character: Character;
  /** The offered view (ADR 0049), so a book switched off offers no pick from it. */
  elements: ElementIndex;
  /** The rule keys content `select` pools own, which a top-level pick's answer is never read from. */
  reserved: ReadonlySet<string>;
  draft: StartingDraft;
}

export const STARTING_EQUIPMENT_HEADING = 'Starting equipment';
/** What an option does, said once above the options. */
export const STARTING_EQUIPMENT_HINT =
  'Take one option. Its items go into the bag, worn or held where a free slot takes them, and its coins into the purse. ' +
  'It can be taken back until any of it is used.';
/** Above what a book lists that no loaded content has. */
export const STARTING_UNLISTED = 'Also listed, and not in any loaded content:';

/** Under the Pending items card: what a pending line is and what resolving it does. */
export const PENDING_ITEMS_HINT =
  'The book lists these, and no loaded item matched them. Choose an item for each, or give it a name of your own to carry it under that name.';

/** "2 choices left", under an option that cannot be taken yet. */
export function startingOwedNote(owed: number): string {
  return `${owed} choice${owed === 1 ? '' : 's'} left`;
}

/** Under an option naming an item nothing loaded declares. */
export function startingMissingNote(count: number): string {
  return `${count} item${count === 1 ? '' : 's'} in this option ${count === 1 ? 'is' : 'are'} not in any loaded content, so it cannot be taken.`;
}

/** The decision's id for one source: what `decline` records. */
export function startingKey(forId: ElementId): string {
  return `build/equipment/${forId}`;
}

/** Where a wealth roll for one class or background is recorded in `rolls`. */
export function wealthRollKey(forId: ElementId): string {
  return `build/equipment/${forId}/wealth`;
}

function nameOf(elements: ElementIndex, id: ElementId): string {
  return elements.get(id)?.name ?? id;
}

function itemText(elements: ElementIndex, id: ElementId, quantity: number | undefined): string {
  const name = nameOf(elements, id);
  return quantity && quantity > 1 ? `${name} ×${quantity}` : name;
}

function pendingText(pending: { text: string; quantity?: number }): string {
  return pending.quantity && pending.quantity > 1 ? `${pending.text} ×${pending.quantity}` : pending.text;
}

function bundleText(elements: ElementIndex, bundle: StartingBundle, system?: GameSystem): string {
  const coins = system ? formatCoins(bundle.coins, system) : undefined;
  return [
    ...(bundle.items ?? []).map((item) => itemText(elements, item.id, item.quantity)),
    ...(bundle.picks ?? []).map((pick) => pick.label),
    ...(bundle.pending ?? []).map(pendingText),
    ...(coins ? [coins] : []),
  ].join(', ');
}

/** What a pick may be answered with, through the offered view, by name. */
export function pickCandidates(pick: StartingPick, elements: ElementIndex): ElementId[] {
  let found: Element[];
  if (pick.from) {
    found = pick.from
      .map((id) => elements.get(id))
      .filter((e): e is Element => e !== undefined && elements.byType(e.type).some((offered) => offered.id === e.id));
  } else {
    const filter = parseSupports(pick.supports);
    const books = pick.publications?.map((b) => b.toLowerCase());
    found = (pick.types ?? [])
      .flatMap((type) => elements.byType(type))
      .filter((e) => !books || books.includes(e.source.toLowerCase()))
      .filter(
        (e) =>
          !filter ||
          matchesSupports(filter, {
            tags: new Set(e.supports.map((s) => s.toLowerCase())),
            setterValues: new Set(Object.values(e.setters).map((s) => s.value.trim().toLowerCase())),
            id: e.id,
            resolve: () => undefined,
          }),
      );
  }
  const unique = [...new Map(found.map((e) => [e.id, e])).values()];
  return unique.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map((e) => e.id);
}

/** The bundles an option gives with these answers, line by line, and how many answers it still owes. */
function resolveOption(option: StartingOption, answers: StartingAnswers | undefined) {
  const bundles: Array<{ bundle: StartingBundle; pickKey: (k: number) => string }> = [];
  let owed = 0;
  (option.lines ?? []).forEach((line, l) => {
    if ('choose' in line) {
      const chosen = answers?.choices[String(l)];
      const bundle = chosen === undefined ? undefined : line.choose[chosen];
      if (!bundle) owed += 1;
      else bundles.push({ bundle, pickKey: (k) => `${l}.${chosen}/${k}` });
    } else bundles.push({ bundle: line, pickKey: (k) => `${l}/${k}` });
  });
  return { bundles, owed };
}

function pickView(pick: StartingPick, key: string, answers: StartingAnswers | undefined, elements: ElementIndex): StartingPickView {
  const count = pick.count ?? 1;
  const recorded = answers?.picks[key] ?? [];
  return {
    key,
    label: pick.label,
    count,
    chosen: Array.from({ length: count }, (_, i) => recorded[i]),
    candidates: pickCandidates(pick, elements),
  };
}

function optionView(
  option: StartingOption,
  forId: ElementId,
  context: StartingContext,
): StartingOptionView {
  const { elements, system, character } = context;
  const answers = context.draft[forId]?.[option.id];
  const lines: StartingLineView[] = (option.lines ?? []).map((line, l) => {
    if ('choose' in line) {
      const chosen = answers?.choices[String(l)];
      const bundle = chosen === undefined ? undefined : line.choose[chosen];
      return {
        key: String(l),
        kind: 'choose',
        alternatives: line.choose.map((b, index) => ({ index, text: bundleText(elements, b, system) })),
        ...(bundle ? { chosen } : {}),
        picks: (bundle?.picks ?? []).map((pick, k) => pickView(pick, `${l}.${chosen}/${k}`, answers, elements)),
      };
    }
    return {
      key: String(l),
      kind: 'items',
      text: bundleText(elements, { ...line, picks: [] }, system),
      picks: (line.picks ?? []).map((pick, k) => pickView(pick, `${l}/${k}`, answers, elements)),
    };
  });
  const { bundles, owed: choicesOwed } = resolveOption(option, answers);
  let owed = choicesOwed;
  const missing: ElementId[] = [];
  for (const { bundle, pickKey } of bundles) {
    for (const item of bundle.items ?? []) if (!elements.get(item.id) && !missing.includes(item.id)) missing.push(item.id);
    (bundle.picks ?? []).forEach((pick, k) => {
      const offered = new Set(pickCandidates(pick, elements));
      const recorded = answers?.picks[pickKey(k)] ?? [];
      for (let slot = 0; slot < (pick.count ?? 1); slot += 1) {
        const id = recorded[slot];
        if (id === undefined || !offered.has(id)) owed += 1;
      }
    });
  }
  const rolled = character.rolls[wealthRollKey(forId)];
  const wealth = option.wealth
    ? {
        text: `${option.wealth.dice}${option.wealth.multiplier ? ` × ${option.wealth.multiplier}` : ''} ${option.wealth.unit}`,
        ...(rolled !== undefined
          ? { rolled, amount: formatCoins({ [option.wealth.unit]: rolled * (option.wealth.multiplier ?? 1) }, system) }
          : {}),
      }
    : undefined;
  const coins = formatCoins(option.coins, system);
  return {
    id: option.id,
    label: option.label,
    lines,
    ...(coins ? { coins } : {}),
    ...(wealth ? { wealth } : {}),
    unlisted: option.unlisted ?? [],
    missing,
    owed,
    ready: owed === 0 && missing.length === 0,
  };
}

/** Whether what a package wrote is still there to take back: every entry it added, as given, and its coins. */
export function packageUntouched(character: Character, record: StartingEquipmentTaken): boolean {
  const bag = character.inventory ?? [];
  for (const added of [...(record.entries ?? []), ...resolvedEntries(record)]) {
    const entry = bag.find((e) => e.instanceId === added.instanceId);
    if (!entry || (entry.quantity ?? 1) !== (added.quantity ?? 1) || entry.adorners?.length) return false;
  }
  for (const [unit, count] of Object.entries(record.coins ?? {})) {
    if ((character.money?.[unit] ?? 0) < count) return false;
  }
  return true;
}

function takenView(record: StartingEquipmentTaken, entry: StartingPackage | undefined, context: StartingContext): StartingTakenView {
  const { character, elements, system } = context;
  const option = entry?.options.find((o) => o.id === record.option);
  const bag = character.inventory ?? [];
  const rolled = option?.wealth ? character.rolls[wealthRollKey(record.for)] : undefined;
  const coins = formatCoins(record.coins, system);
  return {
    option: record.option,
    label: option?.label ?? record.option,
    entries: (record.entries ?? []).map((added) => {
      const now = bag.find((e) => e.instanceId === added.instanceId);
      return now ? itemText(elements, now.elementId, now.quantity) : 'an item no longer in the bag';
    }),
    ...(coins ? { coins } : {}),
    ...(rolled !== undefined ? { rolled } : {}),
    canReturn: packageUntouched(character, record),
  };
}

/** The step as Build shows it: one source per step the file names, then any package taken for an earlier answer. */
export function startingEquipmentState(context: StartingContext): StartingEquipmentState {
  const { file, character, elements, steps } = context;
  const records = character.startingEquipment ?? [];
  const sources: StartingSource[] = [];
  const shown = new Set<ElementId>();
  for (const stepId of file.from) {
    const step = steps.find((s) => s.id === stepId);
    if (!step) continue;
    const forId = pickAnswerOf(character, step, elements, context.reserved)?.elementIds[0];
    const base = { stepId, stepLabel: step.label, current: true, options: [] as StartingOptionView[] };
    if (forId === undefined) {
      sources.push({ ...base, key: startingKey(`step:${stepId}`), status: 'unanswered', note: `Choose a ${step.label.toLowerCase()} first.` });
      continue;
    }
    shown.add(forId);
    const name = nameOf(elements, forId);
    const entry = file.packages.find((p) => p.for === forId);
    const record = records.find((r) => r.for === forId);
    if (record) {
      const taken = takenView(record, entry, context);
      sources.push({
        ...base,
        key: startingKey(forId),
        forId,
        status: taken.canReturn ? 'taken' : 'used',
        note: taken.canReturn ? `Taken: ${taken.label}.` : `Taken: ${taken.label}. Part of it has been used, so it is kept as it is.`,
        taken,
      });
    } else if (!entry) {
      sources.push({ ...base, key: startingKey(forId), forId, status: 'none', note: `No starting equipment is written for ${name}.` });
    } else {
      sources.push({
        ...base,
        key: startingKey(forId),
        forId,
        status: 'open',
        options: entry.options.map((option) => optionView(option, forId, context)),
      });
    }
  }
  // A package taken for a class or background the character no longer has stays in the bag until it is taken back.
  for (const record of records) {
    if (shown.has(record.for)) continue;
    const taken = takenView(record, file.packages.find((p) => p.for === record.for), context);
    const step = steps.find((s) => file.from.includes(s.id) && s.types.includes(elements.get(record.for)?.type ?? ''));
    sources.push({
      key: startingKey(record.for),
      stepId: step?.id ?? '',
      stepLabel: step?.label ?? '',
      forId: record.for,
      current: false,
      status: taken.canReturn ? 'taken' : 'used',
      note: `Taken for ${nameOf(elements, record.for)}, which this character no longer has.`,
      options: [],
      taken,
    });
  }
  const bag = character.inventory ?? [];
  const pending: StartingPendingView[] = [];
  for (const record of records) {
    (record.pending ?? []).forEach((line, index) => {
      const entry = line.instanceId ? bag.find((e) => e.instanceId === line.instanceId) : undefined;
      pending.push({
        forId: record.for,
        index,
        text: line.text,
        quantity: line.quantity ?? 1,
        ...(entry ? { resolved: entry.name ?? itemText(elements, entry.elementId, entry.quantity) } : {}),
      });
    });
  }
  return {
    stepId: file.step,
    sources,
    purse: purseRows(character, context.system),
    pending,
    canName: !!(file.ownItem && elements.get(file.ownItem)),
  };
}

// --- the writes --------------------------------------------------------------------------------------------------------

/** Record one answer of an option in a draft, returning the new draft. */
export function setStartingChoice(draft: StartingDraft, forId: ElementId, optionId: string, lineKey: string, index: number): StartingDraft {
  const answers = draft[forId]?.[optionId] ?? { choices: {}, picks: {} };
  return { ...draft, [forId]: { ...draft[forId], [optionId]: { ...answers, choices: { ...answers.choices, [lineKey]: index } } } };
}

export function setStartingPick(
  draft: StartingDraft,
  forId: ElementId,
  optionId: string,
  pickKey: string,
  slot: number,
  elementId: ElementId | undefined,
): StartingDraft {
  const answers = draft[forId]?.[optionId] ?? { choices: {}, picks: {} };
  const slots = [...(answers.picks[pickKey] ?? [])];
  slots[slot] = elementId;
  return { ...draft, [forId]: { ...draft[forId], [optionId]: { ...answers, picks: { ...answers.picks, [pickKey]: slots } } } };
}

/** Take back a package: remove the entries it added and the coins, when untouched. `undefined` when there is none or it is used. */
export function planReturnStarting(character: Character, forId: ElementId): Character | undefined {
  const record = character.startingEquipment?.find((r) => r.for === forId);
  if (!record || !packageUntouched(character, record)) return undefined;
  let next = character;
  for (const added of [...(record.entries ?? []), ...resolvedEntries(record)]) next = removeInventoryEntry(next, added.instanceId);
  if (record.coins) {
    const money: Record<string, number> = { ...(next.money ?? {}) };
    for (const [unit, count] of Object.entries(record.coins)) money[unit] = (money[unit] ?? 0) - count;
    next = setMoney(next, money);
  }
  return setStartingEquipmentTaken(next, forId, undefined);
}

/** The bag entries resolving a package's pending lines added. */
function resolvedEntries(record: StartingEquipmentTaken): Array<{ instanceId: string; quantity?: number }> {
  return (record.pending ?? []).flatMap((line) => (line.instanceId ? [{ instanceId: line.instanceId, ...(line.quantity && line.quantity > 1 ? { quantity: line.quantity } : {}) }] : []));
}

/**
 * Resolve a pending line of a taken package (ADR 0119 decision 9): with an item, which enters the bag as many times as
 * the line says; or with a name of the user's own, entered as the kind's own item under that name ("fine clothes" may be
 * "tuxedo"). A line already resolved is resolved again, its earlier entry taken out of the bag first while it is as it
 * was given. Refused, with a sentence, when there is no such line, the item is not loaded, or no name may be given.
 */
export function planResolvePending(
  context: StartingContext,
  forId: ElementId,
  index: number,
  answer: { elementId: ElementId } | { name: string },
  options: { newId?: () => string } = {},
): { character: Character } | { refused: string } {
  const record = context.character.startingEquipment?.find((r) => r.for === forId);
  const line = record?.pending?.[index];
  if (!record || !line) return { refused: 'There is no such item to resolve.' };
  let elementId: ElementId;
  let name: string | undefined;
  if ('elementId' in answer) {
    if (!context.elements.get(answer.elementId)) return { refused: 'That item is not in any loaded content.' };
    elementId = answer.elementId;
  } else {
    name = answer.name.trim();
    if (!name) return { refused: 'Give the item a name.' };
    const own = context.file.ownItem;
    if (!own || !context.elements.get(own)) return { refused: 'An item of your own cannot be added with the content loaded.' };
    elementId = own;
  }
  let next = context.character;
  if (line.instanceId) {
    const earlier = (next.inventory ?? []).find((e) => e.instanceId === line.instanceId);
    if (earlier && (earlier.quantity ?? 1) === (line.quantity ?? 1) && !earlier.adorners?.length) next = removeInventoryEntry(next, line.instanceId);
  }
  const instanceId = (options.newId ?? newInstanceId)();
  const quantity = line.quantity ?? 1;
  next = setInventoryEntry(next, { instanceId, elementId, ...(quantity > 1 ? { quantity } : {}), ...(name ? { name } : {}) });
  const pending = record.pending!.map((l, i) => (i === index ? { ...l, instanceId } : l));
  return { character: setStartingEquipmentTaken(next, forId, { ...record, pending }) };
}

/**
 * Take one option for a class or background: its items into the bag, each equipped when its type is one the file
 * equips and a slot it fits is free, in the order the package lists them, the rest carried; its coins into the purse;
 * a wealth roll rolled once and recorded, and the same roll read if the option is taken again. A package already taken
 * for it is taken back first, and when that one has been used nothing is written. Refused, with a sentence, when the
 * option owes answers or names an item nothing loaded declares.
 */
export function planTakeStarting(
  context: StartingContext,
  forId: ElementId,
  optionId: string,
  options: { newId?: () => string; random?: () => number } = {},
): { character: Character } | { refused: string } {
  const entry = context.file.packages.find((p) => p.for === forId);
  const option = entry?.options.find((o) => o.id === optionId);
  if (!entry || !option) return { refused: 'There is no such starting equipment.' };
  const view = optionView(option, forId, context);
  if (view.missing.length) return { refused: `${view.label} names items no loaded content has.` };
  if (view.owed) return { refused: `${view.label} still has ${view.owed} choice${view.owed === 1 ? '' : 's'} to make.` };

  let next = context.character;
  if (next.startingEquipment?.some((r) => r.for === forId)) {
    const returned = planReturnStarting(next, forId);
    if (!returned) return { refused: 'The equipment already taken has been used, so it is kept as it is.' };
    next = returned;
  }

  const newId = options.newId ?? newInstanceId;
  const equipTypes = new Set(context.file.equip ?? []);
  const added: Array<{ instanceId: string; quantity?: number }> = [];
  const answers = context.draft[forId]?.[optionId];
  const give = (id: ElementId, quantity: number): void => {
    const instanceId = newId();
    const element = context.elements.get(id);
    const entry: InventoryEntry = { instanceId, elementId: id, ...(quantity > 1 ? { quantity } : {}) };
    next = setInventoryEntry(next, entry);
    if (element && equipTypes.has(element.type) && context.kind.inventory) {
      // Equipped only where the kind's slots take it: an item a full slot or no slot holds stays carried.
      const trial = setInventoryEntry(next, { ...entry, equipped: true });
      const slots = resolveEquipment(trial, context.elements, context.kind.inventory);
      if ([...slots.occupants.values()].some((o) => o.instanceId === instanceId)) next = trial;
    }
    added.push({ instanceId, ...(quantity > 1 ? { quantity } : {}) });
  };
  const pending: Array<{ text: string; quantity?: number }> = [];
  let bundleCoins: Record<string, number> | undefined;
  for (const { bundle, pickKey } of resolveOption(option, answers).bundles) {
    for (const item of bundle.items ?? []) give(item.id, item.quantity ?? 1);
    for (const line of bundle.pending ?? []) pending.push({ text: line.text, ...(line.quantity && line.quantity > 1 ? { quantity: line.quantity } : {}) });
    for (const [unit, count] of Object.entries(bundle.coins ?? {})) bundleCoins = { ...(bundleCoins ?? {}), [unit]: (bundleCoins?.[unit] ?? 0) + count };
    (bundle.picks ?? []).forEach((pick, k) => {
      for (const id of (answers?.picks[pickKey(k)] ?? []).slice(0, pick.count ?? 1)) if (id) give(id, 1);
    });
  }

  let coins: Record<string, number> | undefined = option.coins || bundleCoins ? { ...(option.coins ?? {}) } : undefined;
  for (const [unit, count] of Object.entries(bundleCoins ?? {})) coins![unit] = (coins![unit] ?? 0) + count;
  if (option.wealth) {
    const key = wealthRollKey(forId);
    let rolled = next.rolls[key];
    if (rolled === undefined) {
      const dice = parseDice(option.wealth.dice);
      if (!dice.ok) return { refused: `The wealth roll cannot be read: ${dice.reason}.` };
      rolled = rollDice(dice.spec, options.random).total;
      next = setRoll(next, key, rolled);
    }
    coins = { [option.wealth.unit]: rolled * (option.wealth.multiplier ?? 1) };
  }
  if (coins) {
    const money: Record<string, number> = { ...(next.money ?? {}) };
    for (const [unit, count] of Object.entries(coins)) money[unit] = (money[unit] ?? 0) + count;
    next = setMoney(next, money);
  }
  const record: StartingEquipmentTaken = {
    for: forId,
    option: optionId,
    ...(added.length ? { entries: added } : {}),
    ...(coins && Object.values(coins).some((c) => c > 0) ? { coins } : {}),
    ...(pending.length ? { pending } : {}),
  };
  return { character: setStartingEquipmentTaken(next, forId, record) };
}
