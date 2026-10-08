/**
 * The starting equipment step — ADR 0087.
 *
 * What a character may start with is a file beside the system (`systems/<id>/starting-equipment.json`), written by a
 * person from the books: per class and background, a list of options of which the character takes one, a package of
 * item lines, fixed coins, or a wealth roll. Content states starting equipment only as prose, and prose is never parsed
 * (ADR 0005).
 *
 * Everything is worked out here, under `node --test`: the file's checker, what the step offers for the character's
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
  currencyWorths,
  matchesSupports,
  newInstanceId,
  parseSupports,
  removeInventoryEntry,
  resolveEquipment,
  setInventoryEntry,
  setMoney,
  setRoll,
  setStartingEquipmentTaken,
  validateJson,
  type BuildStepDef,
  type Character,
  type Element,
  type ElementId,
  type ElementIndex,
  type GameSystem,
  type InventoryEntry,
  type JsonSchema,
  type ResolvedCharacterKind,
  type SchemaError,
  type StartingEquipmentTaken,
} from '@incudo/core';

import { parseDice, rollDice } from './dice.ts';
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
}

export interface StartingPackage {
  /** The class or background id. */
  for: ElementId;
  options: StartingOption[];
}

export interface StartingOption {
  id: string;
  label: string;
  lines?: StartingLine[];
  coins?: Record<string, number>;
  wealth?: { dice: string; multiplier?: number; unit: string };
  /** What the book lists that no element is: shown, written nowhere. */
  unlisted?: string[];
}

export type StartingLine = StartingBundle | { choose: StartingBundle[] };

export interface StartingBundle {
  items?: Array<{ id: ElementId; quantity?: number }>;
  picks?: StartingPick[];
}

export interface StartingPick {
  /** The book's words: "a martial weapon". */
  label: string;
  count?: number;
  from?: ElementId[];
  types?: string[];
  supports?: string;
  publications?: string[];
}

/**
 * A starting equipment file, checked: against its schema, then what a schema cannot say. One entry per element, option
 * ids unique within it, an option that gives something (lines or coins, or a wealth roll alone), a pick that names its
 * candidates one way, a filter that parses, dice that read. With the system: the file is its, the kind and steps exist,
 * and every unit is one its `currency` declares. Errors name where, for whoever has the JSON open.
 */
export function checkStartingEquipment(
  raw: unknown,
  schema: JsonSchema,
  system?: GameSystem,
): { value?: StartingEquipmentFile; errors: SchemaError[] } {
  const errors = validateJson(raw, schema);
  if (errors.length) return { errors };
  const file = raw as StartingEquipmentFile;
  const units = system?.currency;
  const checkUnit = (path: string, unit: string): void => {
    if (units && !(unit in units)) errors.push({ path, message: `"${unit}" is not a unit of money the system declares` });
  };
  if (system) {
    if (file.system !== system.id) errors.push({ path: 'system', message: `is "${file.system}", and this system is "${system.id}"` });
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
  }
  const seen = new Map<string, number>();
  file.packages.forEach((entry, p) => {
    const where = `packages[${p}]`;
    if (seen.has(entry.for)) errors.push({ path: `${where}.for`, message: `"${entry.for}" has an entry already, packages[${seen.get(entry.for)}]` });
    else seen.set(entry.for, p);
    const ids = new Set<string>();
    entry.options.forEach((option, o) => {
      const at = `${where}.options[${o}]`;
      if (ids.has(option.id)) errors.push({ path: `${at}.id`, message: `"${option.id}" is used by another option of this entry` });
      ids.add(option.id);
      const gives = Boolean(option.lines?.length) || Boolean(option.coins && Object.keys(option.coins).length);
      if (option.wealth && gives) errors.push({ path: at, message: 'a wealth roll is an option of its own, with no lines or coins' });
      if (!option.wealth && !gives) errors.push({ path: at, message: 'gives nothing: it needs lines, coins or a wealth roll' });
      if (option.wealth) {
        const dice = parseDice(option.wealth.dice);
        if (!dice.ok) errors.push({ path: `${at}.wealth.dice`, message: dice.reason });
        checkUnit(`${at}.wealth.unit`, option.wealth.unit);
      }
      for (const unit of Object.keys(option.coins ?? {})) checkUnit(`${at}.coins.${unit}`, unit);
      (option.lines ?? []).forEach((line, l) => {
        const bundles = 'choose' in line ? line.choose : [line];
        bundles.forEach((bundle, a) => {
          const bat = 'choose' in line ? `${at}.lines[${l}].choose[${a}]` : `${at}.lines[${l}]`;
          if (!bundle.items?.length && !bundle.picks?.length) errors.push({ path: bat, message: 'names no item and no pick' });
          (bundle.picks ?? []).forEach((pick, k) => {
            const pat = `${bat}.picks[${k}]`;
            if (pick.from && (pick.types || pick.supports || pick.publications)) {
              errors.push({ path: pat, message: 'names its candidates by a list, so it takes no types, filter or books' });
            }
            if (!pick.from && !pick.types) errors.push({ path: pat, message: 'needs a list of candidates or the types to choose from' });
            if (pick.supports !== undefined && !parseSupports(pick.supports)) {
              errors.push({ path: `${pat}.supports`, message: `"${pick.supports}" is not a filter content's language reads` });
            }
          });
        });
      });
    });
  });
  return errors.length ? { errors } : { value: file, errors };
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

export interface PurseRow {
  unit: string;
  label: string;
  count: number;
}

export interface StartingEquipmentState {
  stepId: string;
  sources: StartingSource[];
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

/** The decision's id for one source: what `decline` records. */
export function startingKey(forId: ElementId): string {
  return `build/equipment/${forId}`;
}

/** Where a wealth roll for one class or background is recorded in `rolls`. */
export function wealthRollKey(forId: ElementId): string {
  return `build/equipment/${forId}/wealth`;
}

/** The units in the order a book lists coins: most worth first, as the system's rates make them. */
function unitsByWorth(system: GameSystem): string[] {
  const worths = currencyWorths(system.currency);
  const units = Object.keys(system.currency ?? {});
  return worths ? units.sort((a, b) => (worths.get(b) ?? 0) - (worths.get(a) ?? 0)) : units;
}

/** "15 gp, 3 sp": coins most worth first, by the unit ids content prices items in. */
export function formatCoins(coins: Record<string, number> | undefined, system: GameSystem): string | undefined {
  if (!coins) return undefined;
  const order = unitsByWorth(system);
  const units = Object.keys(coins).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const parts = units.filter((unit) => (coins[unit] ?? 0) > 0).map((unit) => `${coins[unit]} ${unit}`);
  return parts.length ? parts.join(', ') : undefined;
}

/** The purse: every declared unit, most worth first, with the count held. */
export function purseRows(character: Character, system: GameSystem): PurseRow[] {
  return unitsByWorth(system).map((unit) => ({ unit, label: system.currency![unit]!.label, count: character.money?.[unit] ?? 0 }));
}

function nameOf(elements: ElementIndex, id: ElementId): string {
  return elements.get(id)?.name ?? id;
}

function itemText(elements: ElementIndex, id: ElementId, quantity: number | undefined): string {
  const name = nameOf(elements, id);
  return quantity && quantity > 1 ? `${name} ×${quantity}` : name;
}

function bundleText(elements: ElementIndex, bundle: StartingBundle): string {
  return [
    ...(bundle.items ?? []).map((item) => itemText(elements, item.id, item.quantity)),
    ...(bundle.picks ?? []).map((pick) => pick.label),
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
        alternatives: line.choose.map((b, index) => ({ index, text: bundleText(elements, b) })),
        ...(bundle ? { chosen } : {}),
        picks: (bundle?.picks ?? []).map((pick, k) => pickView(pick, `${l}.${chosen}/${k}`, answers, elements)),
      };
    }
    return {
      key: String(l),
      kind: 'items',
      text: (line.items ?? []).map((item) => itemText(elements, item.id, item.quantity)).join(', '),
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
  for (const added of record.entries ?? []) {
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
  return { stepId: file.step, sources, purse: purseRows(character, context.system) };
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
  for (const added of record.entries ?? []) next = removeInventoryEntry(next, added.instanceId);
  if (record.coins) {
    const money: Record<string, number> = { ...(next.money ?? {}) };
    for (const [unit, count] of Object.entries(record.coins)) money[unit] = (money[unit] ?? 0) - count;
    next = setMoney(next, money);
  }
  return setStartingEquipmentTaken(next, forId, undefined);
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
  for (const { bundle, pickKey } of resolveOption(option, answers).bundles) {
    for (const item of bundle.items ?? []) give(item.id, item.quantity ?? 1);
    (bundle.picks ?? []).forEach((pick, k) => {
      for (const id of (answers?.picks[pickKey(k)] ?? []).slice(0, pick.count ?? 1)) if (id) give(id, 1);
    });
  }

  let coins: Record<string, number> | undefined = option.coins ? { ...option.coins } : undefined;
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
  };
  return { character: setStartingEquipmentTaken(next, forId, record) };
}
