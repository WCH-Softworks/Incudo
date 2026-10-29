/**
 * Validating the formats Incudo owns.
 *
 * The schemas under `schemas/` are the contract; this file is the one implementation that
 * checks against them (ADR 0011). `core` has no filesystem and no bundler, so the schema
 * documents are handed in: a test reads them off disk, an app imports them. What must not
 * happen is a second validator anywhere — a system that passes one validator and
 * then fails to load is the exact failure ADR 0011 exists to prevent.
 *
 * Structural validation is the schema's job. This file adds the **referential** checks a
 * JSON Schema cannot express and the app would otherwise discover by throwing: does every
 * `extends` name a kind that exists, is the chain acyclic, is each kind actually buildable.
 * Those are still not judgments about the game — a system can pass all of this and be a
 * terrible model of its rules, which is the author's business (ADR 0011).
 */

import { validateJson, type JsonSchema, type SchemaError } from './json-schema.ts';
import {
  buildStepCycles,
  currencyProblems,
  progressionStat,
  resolveCharacterKind,
  type GameSystem,
  type PlayDef,
  type SheetLayoutDef,
  type SheetSectionDef,
} from './system.ts';
import { parseRequirements } from './requirements.ts';
import { applySystemOverlay, duplicateIdentities, type OverlayChange } from './system-overlay.ts';
import { systemWarnings } from './system-warnings.ts';
import { FORMAT_VERSIONS, isNewerFormat, newerFormatNote } from './format-versions.ts';
import { parseSupports, supportsInterpolations } from './supports.ts';
import type { Character } from './character.ts';
import type { ContainerManifest } from './container.ts';

/** The three schema documents, however the caller got hold of them. */
export interface SchemaBundle {
  system: JsonSchema;
  character: JsonSchema;
  manifest: JsonSchema;
}

export interface ValidationResult<T> {
  valid: boolean;
  /** The input, typed, when and only when it validated. */
  value: T | undefined;
  errors: SchemaError[];
}

/**
 * Validate a system definition.
 *
 * A system that fails is refused, never partially loaded (ADR 0011): a half-read system
 * builds a character that is quietly wrong, which is worse than an error message.
 */
export interface ValidateSystemOptions {
  /**
   * The systems an overlay may name in `extends` (ADR 0102): complete ones, shipped or the user's. Without it an overlay
   * is refused, since there is nothing to apply it to.
   */
  parent?: (id: string) => GameSystem | undefined;
}

/** A validated system, and for an overlay, what it was applied to and what it changed (ADR 0102). */
export interface SystemValidationResult extends ValidationResult<GameSystem> {
  /**
   * For an overlay that was applied: its parent, what it changed, and the system it made, which is what `errors` are about
   * when there are any (ADR 0103 follows them back to the overlay's text). Absent when the overlay's own shell failed.
   */
  overlay?: { parent: GameSystem; changes: OverlayChange[]; applied: GameSystem };
  /**
   * What a system that validated may still have wrong (ADR 0105): a stat name one slip from a declared one. Never a
   * refusal, and empty when the system did not validate.
   */
  warnings: SchemaError[];
}

/**
 * Validate a system definition, structurally and then every reference in it.
 *
 * A definition with a root `extends` is an overlay (ADR 0102): its shell is checked against `$defs/overlay`, it is applied
 * to its parent, and the system that makes is checked exactly as a complete one is. What comes back is a complete system;
 * nothing past this function sees a patch.
 */
export function validateGameSystem(
  value: unknown,
  schemas: SchemaBundle,
  options: ValidateSystemOptions = {},
): SystemValidationResult {
  // A definition for a newer Incudo is refused with the one sentence that says so (ADR 0130), not a schema error.
  const found = (value as { formatVersion?: unknown } | null)?.formatVersion;
  if (isNewerFormat(found, FORMAT_VERSIONS.system)) {
    return { ...result(value as GameSystem, [{ path: 'formatVersion', message: newerFormatNote('system definition', found, FORMAT_VERSIONS.system) }]), warnings: [] };
  }
  if (isOverlay(value)) return validateOverlay(value, schemas, options);
  const errors = validateJson(value, schemas.system);
  if (errors.length === 0) errors.push(...checkSystemReferences(value as GameSystem));
  return withWarnings(result(value as GameSystem, errors));
}

function withWarnings(validated: ValidationResult<GameSystem> & { overlay?: SystemValidationResult['overlay'] }): SystemValidationResult {
  return { ...validated, warnings: validated.value ? systemWarnings(validated.value) : [] };
}

function isOverlay(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'extends' in value;
}

function validateOverlay(
  value: Record<string, unknown>,
  schemas: SchemaBundle,
  options: ValidateSystemOptions,
): SystemValidationResult {
  const shell = validateJson(value, { $ref: '#/$defs/overlay' }, { root: schemas.system });
  if (shell.length) return withWarnings(result(value as unknown as GameSystem, shell));
  const parentId = value['extends'] as string;
  const parent = options.parent?.(parentId);
  if (!parent) {
    return withWarnings(result(value as unknown as GameSystem, [
      { path: 'extends', message: `names "${parentId}", which is not a system Incudo has` },
    ]));
  }
  if (parent.extends !== undefined) {
    return withWarnings(result(value as unknown as GameSystem, [
      { path: 'extends', message: `names "${parentId}", which changes another system itself; an overlay must build on a complete system` },
    ]));
  }
  if (parent.id === value['id']) {
    return withWarnings(result(value as unknown as GameSystem, [
      { path: 'id', message: `is the id of the system it changes; an overlay needs an id of its own` },
    ]));
  }
  const applied = applySystemOverlay(parent, value);
  const errors = validateJson(applied.system, schemas.system);
  if (errors.length === 0) errors.push(...checkSystemReferences(applied.system));
  return withWarnings({ ...result(applied.system, errors), overlay: { parent, changes: applied.changes, applied: applied.system } });
}

export function validateCharacter(
  value: unknown,
  schemas: SchemaBundle,
  /** When given, what the character records is held to what the system declares: money in its units (ADR 0087). */
  system?: GameSystem,
): ValidationResult<Character> {
  const errors = validateJson(value, schemas.character);
  if (errors.length === 0) errors.push(...checkCharacterReferences(value as Character, system));
  return result(value as Character, errors);
}

export function validateManifest(
  value: unknown,
  schemas: SchemaBundle,
): ValidationResult<ContainerManifest> {
  const errors = validateJson(value, schemas.manifest);
  const manifest = value as ContainerManifest;
  if (errors.length === 0 && manifest.kind === 'character' && !manifest.systemId) {
    errors.push({ path: 'systemId', message: 'is required for a character container' });
  }
  return result(manifest, errors);
}

/** The referential checks of a kind's `play` (ADR 0084): every name it uses is declared, and each tracker says one thing. */
function checkPlay(play: PlayDef | undefined, sections: readonly SheetSectionDef[], where: string): SchemaError[] {
  const errors: SchemaError[] = [];
  if (!play) return errors;
  const rests = new Set<string>();
  for (const rest of play.rests ?? []) {
    if (rests.has(rest.id)) errors.push({ path: `${where}.play.rests`, message: `declares the rest "${rest.id}" twice` });
    rests.add(rest.id);
  }
  for (const rest of play.rests ?? []) {
    for (const id of rest.includes ?? []) {
      if (!rests.has(id)) errors.push({ path: `${where}.play.rests`, message: `"${rest.id}" includes "${id}", which is not a declared rest` });
    }
  }
  const byId = new Map(sections.map((section) => [section.id, section]));
  const ids = new Set<string>();
  for (const tracker of play.trackers ?? []) {
    const at = `${where}.play.trackers`;
    if (ids.has(tracker.id)) errors.push({ path: at, message: `declares the tracker "${tracker.id}" twice` });
    ids.add(tracker.id);
    const sources = [tracker.stat, tracker.rows, tracker.dice, tracker.uses, tracker.max].filter((source) => source !== undefined);
    if (sources.length !== 1) {
      errors.push({ path: at, message: `"${tracker.id}" names ${sources.length} of stat, rows, dice, uses and max, and must name one` });
    }
    for (const section of [tracker.rows, tracker.dice, ...(tracker.uses ?? [])]) {
      if (section !== undefined && !byId.has(section)) {
        errors.push({ path: at, message: `"${tracker.id}" reads the sheet section "${section}", which the kind does not declare` });
      }
    }
    if (tracker.dice !== undefined && byId.get(tracker.dice) && byId.get(tracker.dice)!.trackDie === undefined) {
      errors.push({ path: at, message: `"${tracker.id}" reads dice from "${tracker.dice}", which writes none (trackDie)` });
    }
    if (tracker.restoresWhen && !(tracker.rows !== undefined && byId.get(tracker.rows)?.perBlock)) {
      errors.push({ path: at, message: `"${tracker.id}" has restoresWhen, which only a rows tracker over a perBlock section reads` });
    }
    if (tracker.uses && tracker.restores) {
      errors.push({ path: at, message: `"${tracker.id}" reads uses, which the rest their usage names gives back; it takes no restores` });
    }
    for (const restore of [...(tracker.restores ?? []), ...(tracker.restoresWhen?.restores ?? [])]) {
      if (!rests.has(restore.rest)) errors.push({ path: at, message: `"${tracker.id}" is given back by "${restore.rest}", which is not a declared rest` });
      if (restore.amount !== undefined && restore.fraction !== undefined) {
        errors.push({ path: at, message: `"${tracker.id}" gives back both an amount and a fraction on "${restore.rest}"` });
      }
    }
  }
  return errors;
}

function result<T>(value: T, errors: SchemaError[]): ValidationResult<T> {
  return { valid: errors.length === 0, value: errors.length === 0 ? value : undefined, errors };
}

/**
 * What the schema cannot say about a character: `instanceId` is unique, only format 3 omits `progress` or records
 * `removedGrants`, and the fields later formats added are recorded only from them.
 *
 * It matters because it is an address. `setInventoryEntry` replaces by it and a UI keys rows
 * by it, so two entries sharing one is a file where editing an item changes a different item
 * (ADR 0024). Everything else about a character is either structural — which the schema
 * checks — or a reference into content, which the save deliberately does not have loaded.
 */
function checkCharacterReferences(character: Character, system?: GameSystem): SchemaError[] {
  const errors: SchemaError[] = [];
  // What only format 3 may do (ADR 0060, ADR 0061). A file that does it and claims 2 is one a reader of 2 would
  // open and get wrong without a word, which is the one thing the number exists to prevent.
  if (character.formatVersion < 3 && character.progress === undefined) {
    errors.push({ path: 'progress', message: 'is required below format 3' });
  }
  if (character.formatVersion < 3 && character.removedGrants !== undefined) {
    errors.push({ path: 'removedGrants', message: 'is recorded only from format 3' });
  }
  // A custom feature is dropped by a reader of 3 (ADR 0063), and two with one id are one address for two features.
  if (character.formatVersion < 4 && character.customFeatures !== undefined) {
    errors.push({ path: 'customFeatures', message: 'is recorded only from format 4' });
  }
  // An addition is dropped by a reader of 4 (ADR 0064).
  if (character.formatVersion < 5 && character.additions !== undefined) {
    errors.push({ path: 'additions', message: 'is recorded only from format 5' });
  }
  // A block an addition is cast through is dropped by a reader of 9 (ADR 0097), and names an addition or nothing.
  if (character.formatVersion < 10 && character.additionBlocks !== undefined) {
    errors.push({ path: 'additionBlocks', message: 'is recorded only from format 10' });
  }
  for (const id of Object.keys(character.additionBlocks ?? {})) {
    if (!(character.additions ?? []).includes(id)) {
      errors.push({ path: `additionBlocks.${id}`, message: `"${id}" is not an element added to this character` });
    }
  }
  // A cantrip's attack choices are dropped by a reader of 12 (ADR 0111), and a die has at least two sides.
  if (character.formatVersion < 13 && character.spellAttacks !== undefined) {
    errors.push({ path: 'spellAttacks', message: 'is recorded only from format 13' });
  }
  // A reference is dropped by a reader of 6 (ADR 0068).
  if (character.formatVersion < 7 && character.references !== undefined) {
    errors.push({ path: 'references', message: 'is recorded only from format 7' });
  }
  // Play state is dropped by a reader of 7 (ADR 0084).
  if (character.formatVersion < 8 && character.play !== undefined) {
    errors.push({ path: 'play', message: 'is recorded only from format 8' });
  }
  // Money and what a starting package wrote are dropped by a reader of 10 (ADR 0087).
  if (character.formatVersion < 11 && character.money !== undefined) {
    errors.push({ path: 'money', message: 'is recorded only from format 11' });
  }
  if (character.formatVersion < 11 && character.startingEquipment !== undefined) {
    errors.push({ path: 'startingEquipment', message: 'is recorded only from format 11' });
  }
  if (character.formatVersion < 14 && character.startingEquipment?.some((record) => record.pending !== undefined)) {
    errors.push({ path: 'startingEquipment', message: 'records pending items only from format 14' });
  }
  if (system?.currency) {
    for (const unit of Object.keys(character.money ?? {})) {
      if (!(unit in system.currency)) errors.push({ path: `money.${unit}`, message: `"${unit}" is not a unit of money this system declares` });
    }
  }
  const takenFor = new Set<string>();
  for (const [i, record] of (character.startingEquipment ?? []).entries()) {
    if (takenFor.has(record.for)) errors.push({ path: `startingEquipment[${i}].for`, message: `"${record.for}" has a package recorded twice` });
    takenFor.add(record.for);
  }
  const featureIds = new Set<string>();
  for (const [i, feature] of (character.customFeatures ?? []).entries()) {
    // A reader of 5 would hold it as the kind's default type, and list a legendary action as a trait (ADR 0065).
    if (character.formatVersion < 6 && feature.type !== undefined) {
      errors.push({ path: `customFeatures[${i}].type`, message: 'is recorded only from format 6' });
    }
    // A reader of 11 refuses the field outright (ADR 0106), so the number says why.
    if (character.formatVersion < 12 && feature.library !== undefined) {
      errors.push({ path: `customFeatures[${i}].library`, message: 'is recorded only from format 12' });
    }
    // A reader of 8 refuses the mode outright (ADR 0094), so the number says why.
    for (const [at, line] of feature.stats.entries()) {
      if (character.formatVersion < 9 && line.mode === 'mark') {
        errors.push({ path: `customFeatures[${i}].stats[${at}].mode`, message: '"mark" is recorded only from format 9' });
      }
    }
    if (featureIds.has(feature.id)) {
      errors.push({ path: `customFeatures[${i}].id`, message: `"${feature.id}" is already used by another feature` });
    }
    featureIds.add(feature.id);
  }
  const seen = new Set<string>();
  const inventory = character.inventory ?? [];
  for (let i = 0; i < inventory.length; i++) {
    const id = inventory[i]!.instanceId;
    if (seen.has(id)) {
      errors.push({
        path: `inventory[${i}].instanceId`,
        message: `"${id}" is already used by another item — instance ids must be unique`,
      });
    }
    seen.add(id);
  }
  return errors;
}

/**
 * The checks that make "if it parses, the app can build in it" true rather than nearly true.
 *
 * Everything here is a reference that has to resolve. Run only once the schema has passed,
 * so this can assume the shape is right and worry only about what it points at.
 */
/** Identified arrays whose duplicates a check below already refuses, in its own words. */
/**
 * What a sheet's layout names that it does not declare (ADR 0126): a part in two tabs, a section's tab that is not
 * one of the sheet's, a tab on a section that is not in the main column, and a section drawn under one the sheet does
 * not have, or under itself.
 */
function sheetLayoutErrors(sheet: SheetLayoutDef, where: string): SchemaError[] {
  const errors: SchemaError[] = [];
  const tabs = new Set<string>();
  const parts = new Set<string>();
  for (const tab of sheet.tabs ?? []) {
    // A tab id twice is refused with every identified array's (duplicateIdentities, ADR 0103).
    tabs.add(tab.id);
    for (const part of tab.parts ?? []) {
      if (parts.has(part)) errors.push({ path: `${where}.tabs`, message: `puts "${part}" in more than one tab, or twice in one` });
      parts.add(part);
    }
  }
  const ids = new Set(sheet.sections.map((section) => section.id));
  for (const section of sheet.sections) {
    if (section.tab !== undefined) {
      if (!tabs.has(section.tab)) errors.push({ path: `${where}.sections`, message: `section "${section.id}" goes in the tab "${section.tab}", which the sheet does not declare` });
      if (section.place !== undefined && section.place !== 'main') {
        errors.push({ path: `${where}.sections`, message: `section "${section.id}" names a tab and goes in the ${section.place === 'head' ? 'head band' : 'side column'}` });
      }
    }
    if (section.coveredByPrint !== undefined && !sheet.sections.some((s) => (s.printed ?? []).some((line) => line.stat?.toLowerCase() === section.coveredByPrint!.toLowerCase()))) {
      errors.push({ path: `${where}.sections`, message: `section "${section.id}" is left out when the print of "${section.coveredByPrint}" is shown, and no printed line of this sheet prints it` });
    }
    if (section.under !== undefined && (section.under === section.id || !ids.has(section.under))) {
      errors.push({ path: `${where}.sections`, message: `section "${section.id}" is drawn under "${section.under}", which is not another section of this sheet` });
    }
  }
  // A stat block names the sections it draws its ability scores from, and the one whose elements name their book.
  const block = sheet.statBlock;
  for (const id of block ? [block.abilities, block.saves, block.wide?.section] : []) {
    if (id !== undefined && !ids.has(id)) errors.push({ path: `${where}.statBlock`, message: `names the section "${id}", which this sheet does not have` });
  }
  return errors;
}

/** The sheet section fields that are about the elements a section lists (ADR 0126). */
const LISTING_FIELDS = ["fold", "omitMarked", "answers", "facts"] as const;

const CHECKED_ELSEWHERE: ReadonlySet<string> = new Set([
  'characterKinds',
  'characterKinds[].buildSteps',
  'characterKinds[].play.rests',
  'characterKinds[].play.trackers',
  'characterKinds[].inventory.slots',
  'characterKinds[].blockFilters',
  'characterKinds[].freeform.fields',
  'characterKinds[].companions.sheet',
]);

function checkSystemReferences(system: GameSystem): SchemaError[] {
  const errors: SchemaError[] = [];
  const kinds = system.characterKinds ?? [];

  const seenIds = new Set<string>();
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i]!;
    if (seenIds.has(kind.id)) {
      errors.push({
        path: `characterKinds[${i}].id`,
        message: `is already used by another kind ("${kind.id}" must be unique within a system)`,
      });
    }
    seenIds.add(kind.id);
  }

  // One identity twice in an array an overlay merges by it (ADR 0103). The arrays skipped have a check of their own below.
  for (const duplicate of duplicateIdentities(system, CHECKED_ELSEWHERE)) {
    errors.push({
      path: duplicate.path,
      message: `"${duplicate.identity}" is already used in this ${duplicate.field} list; each entry needs its own, or remove one`,
    });
  }
  (system.generationMethods ?? []).forEach((method, i) => {
    if (method.min !== undefined && method.max !== undefined && method.min > method.max) {
      errors.push({ path: `generationMethods[${i}].min`, message: `is ${method.min}, above the max of ${method.max}, so no value could be chosen` });
    }
  });

  const defaults = kinds.filter((k) => k.default);
  if (defaults.length > 1) {
    errors.push({
      path: 'characterKinds',
      message: `marks ${defaults.length} kinds as default (${defaults
        .map((k) => k.id)
        .join(', ')}); only one may be`,
    });
  }

  // A coinage whose rates disagree would price one thing two ways (ADR 0087): refused with both routes named.
  for (const message of currencyProblems(system.currency)) errors.push({ path: 'currency', message });

  const typeNames = new Set((system.elementTypes ?? []).map((t) => t.name));
  const methodIds = new Set((system.generationMethods ?? []).map((m) => m.id));

  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i]!;
    const where = `characterKinds[${i}]`;

    let resolved;
    try {
      resolved = resolveCharacterKind(system, kind.id);
    } catch (error) {
      // Unknown or cyclic `extends`. resolveCharacterKind is the same code the app runs,
      // so its message is the right one to show.
      errors.push({ path: `${where}.extends`, message: lowerFirst((error as Error).message) });
      continue;
    }

    if (kind.extends === undefined) {
      for (const field of ['progression', 'elementTypes', 'buildSteps', 'sheet'] as const) {
        if (kind[field] === undefined) {
          errors.push({
            path: `${where}.${field}`,
            message: 'is required on a kind that does not extend another',
          });
        }
      }
    }

    for (const type of resolved.elementTypes) {
      const name = type.replace(/^[+-]/, '');
      if (!typeNames.has(name)) {
        errors.push({
          path: `${where}.elementTypes`,
          message: `names "${name}", which the system's elementTypes does not declare`,
        });
      }
    }

    const stepIds = new Set<string>();
    for (const step of resolved.buildSteps) {
      if (stepIds.has(step.id)) {
        errors.push({
          path: `${where}.buildSteps`,
          message: `has two steps with the id "${step.id}"`,
        });
      }
      stepIds.add(step.id);
      // "You must choose at least one of the optional rules your table uses" is not a sentence
      // (ADR 0032). Refused rather than read one way or the other.
      if (step.required && step.multiple) {
        errors.push({
          path: `${where}.buildSteps`,
          message: `step "${step.id}" is both required and multiple; a set that may be empty cannot be required`,
        });
      }
      // What a new character starts with is an answer to a set (ADR 0080): refused on any other step, twice, or blank.
      if (step.initial !== undefined) {
        if (!step.multiple) {
          errors.push({ path: `${where}.buildSteps`, message: `step "${step.id}" names what a new character starts with, and is not a set (multiple)` });
        }
        const seen = new Set<string>();
        for (const id of step.initial) {
          if (id.trim() === '') errors.push({ path: `${where}.buildSteps`, message: `step "${step.id}" starts a new character with a blank id` });
          else if (seen.has(id)) errors.push({ path: `${where}.buildSteps`, message: `step "${step.id}" starts a new character with "${id}" twice` });
          seen.add(id);
        }
      }
      // The option that allows another class gates a class control, and only a per-level step with a roll has one (ADR 0088).
      if (step.multiclassWhen !== undefined && (!step.perLevel || !step.levelRoll)) {
        errors.push({
          path: `${where}.buildSteps`,
          message: `step "${step.id}" names what allows another class, and is not a per-level step with a levelRoll`,
        });
      }
      // An advanced step is left out of what is offered until a user asks for advanced options (ADR 0115), so only a step
      // nothing owes an answer to may be one: a set or a pick that is not required.
      if (step.advanced && !(step.multiple || (step.pick && !step.required))) {
        errors.push({
          path: `${where}.buildSteps`,
          message: `step "${step.id}" is advanced and is not a set or a pick that is not required; only a step a character may leave unanswered can be left out of what is offered`,
        });
      }
      // A step a campaign option switches on (ADR 0123) opens nothing without it, so only a step nothing owes an answer to.
      if (step.offeredWhen !== undefined && !(step.multiple || (step.pick && !step.required))) {
        errors.push({
          path: `${where}.buildSteps`,
          message: `step "${step.id}" is offered only when an element is held and is not a set or a pick that is not required; only a step a character may leave unanswered can be switched off`,
        });
      }
      // Listed with what must be answered (ADR 0127), so only a step nothing owes an answer to: one that is owed already is.
      if (step.listedWithRequired && !(step.multiple || (step.pick && !step.required))) {
        errors.push({
          path: `${where}.buildSteps`,
          message: `step "${step.id}" is listed with the required decisions and is not a set or a pick that is not required; only a step a character may leave unanswered needs listing there`,
        });
      }
      // What is asked when a character is started is a set of options (ADR 0123): a pick or a budget is Build's to ask.
      if (step.askedAtStart && !step.multiple) {
        errors.push({
          path: `${where}.buildSteps`,
          message: `step "${step.id}" is asked when a character is started and is not a set (multiple); only a set can be`,
        });
      }
      // A pick is of one and a set of any number (ADR 0068): the same refusal, for the same reason.
      if (step.pick && step.multiple) {
        errors.push({
          path: `${where}.buildSteps`,
          message: `step "${step.id}" is both a pick and multiple; a pick is of one, a set of any number`,
        });
      }
      // Offering only what concerns the character (ADR 0081, ADR 0129) narrows what a set offers; a pick or a budget has no such offer.
      if (step.gatedOnHeld && !step.multiple) {
        errors.push({
          path: `${where}.buildSteps`,
          message: `step "${step.id}" offers only what concerns the character and is not a set (multiple); only a set can be narrowed that way`,
        });
      }
      for (const type of step.types) {
        if (!typeNames.has(type)) {
          errors.push({
            path: `${where}.buildSteps`,
            message: `step "${step.id}" picks "${type}", which the system's elementTypes does not declare`,
          });
        }
      }
    }

    // Where the kind offers content's starting packages, and which picks they come from (ADR 0119).
    const starting = resolved.startingEquipment;
    if (starting) {
      if (!stepIds.has(starting.step)) {
        errors.push({ path: `${where}.startingEquipment.step`, message: `"${starting.step}" is not a build step of this kind` });
      }
      for (const [i, id] of starting.from.entries()) {
        if (!resolved.buildSteps.some((s) => s.id === id && s.types.length > 0)) {
          errors.push({ path: `${where}.startingEquipment.from[${i}]`, message: `"${id}" is not a build step of this kind that chooses an element` });
        }
      }
      for (const [i, type] of (starting.equip ?? []).entries()) {
        if (!typeNames.has(type)) {
          errors.push({ path: `${where}.startingEquipment.equip[${i}]`, message: `names "${type}", which the system's elementTypes does not declare` });
        }
      }
    }

    // `requires` and `budget` — ADR 0017. Reported, never repaired: a builder that quietly
    // dropped a step from a cycle would hide a screen the author meant to have.
    const selfRequiring = new Set<string>();
    for (const step of resolved.buildSteps) {
      for (const id of step.requires ?? []) {
        if (id === step.id) {
          selfRequiring.add(step.id);
          errors.push({
            path: `${where}.buildSteps`,
            message: `step "${step.id}" requires itself`,
          });
        } else if (!stepIds.has(id)) {
          errors.push({
            path: `${where}.buildSteps`,
            message: `step "${step.id}" requires "${id}", which this kind has no step for`,
          });
        }
      }
      for (const method of step.budget?.methods ?? []) {
        if (!methodIds.has(method)) {
          errors.push({
            path: `${where}.buildSteps`,
            message: `step "${step.id}" offers the generation method "${method}", which the system's generationMethods does not declare`,
          });
        }
      }
    }

    // A step that requires itself is a cycle too, and "requires itself" is the more useful
    // of the two sentences. Report the general cycle only for the steps that need it.
    const cycle = buildStepCycles(resolved.buildSteps).filter((id) => !selfRequiring.has(id));
    if (cycle.length) {
      errors.push({
        path: `${where}.buildSteps`,
        message: `has a "requires" cycle: ${cycle.join(', ')} can never become available`,
      });
    }

    // The progression stat is declared by declaring the progression: the engine publishes
    // it whether or not a StatDef spells it out, so a sheet may show it either way.
    const statNames = new Set(resolved.stats.map((s) => s.name.toLowerCase()));
    const progress = progressionStat(resolved.progression);
    if (progress) statNames.add(progress.toLowerCase());

    // A contribution's `requirements` is content's language inside JSON, so the schema can only
    // check that it is a string (ADR 0022). The parse happens here, and a system carrying one
    // that will not parse is refused rather than loaded with a condition that silently never
    // fires — ADR 0011's standing rule.
    for (const contribution of resolved.contributions) {
      try {
        parseRequirements(contribution.requirements);
      } catch (error) {
        errors.push({
          path: `${where}.contributions`,
          message: `contributes "${contribution.stat}" with a requirements expression that does not parse: ${(error as Error).message}`,
        });
      }
    }

    // A slot publishes into a stat, and a stat nothing declares is a stat no sheet can show
    // and no author meant to write (ADR 0025). Duplicate slot ids are the other mistake that
    // reads as working: the second declaration would be unreachable, because a slot is found
    // by matching content's string exactly once.
    const slotIds = new Set<string>();
    for (const slot of resolved.inventory?.slots ?? []) {
      if (slotIds.has(slot.id)) {
        errors.push({
          path: `${where}.inventory`,
          message: `declares the slot "${slot.id}" twice; only the first would ever be reached`,
        });
      }
      slotIds.add(slot.id);
      for (const stat of slot.stats ?? []) {
        if (!statNames.has(stat.toLowerCase())) {
          errors.push({
            path: `${where}.inventory`,
            message: `slot "${slot.id}" publishes into "${stat}", which is not declared by the system or by this kind`,
          });
        }
      }
    }

    // The stat that publishes held types (ADR 0071) is asked by membership, as a slot is, so the two cannot share a
    // name: whichever answered, the other's tags would never be read.
    const heldTypes = resolved.heldTypesStat?.trim().toLowerCase();
    if (heldTypes !== undefined) {
      if (heldTypes === '') {
        errors.push({ path: `${where}.heldTypesStat`, message: 'names no stat' });
      }
      for (const slot of resolved.inventory?.slots ?? []) {
        if ((slot.stats ?? []).some((stat) => stat.toLowerCase() === heldTypes)) {
          errors.push({
            path: `${where}.heldTypesStat`,
            message: `publishes held types into "${resolved.heldTypesStat}", which the slot "${slot.id}" publishes into too; only one of them would ever be read`,
          });
        }
      }
    }

    // A `blockFilters` entry that resolves nothing is invisible at runtime: the select it
    // was meant to fill just goes on offering an empty list, which is exactly the sentence
    // ADR 0030's `unresolvedSupports` exists to keep separate from "you have no content".
    // Two mistakes an author actually makes, and both are checkable here.
    const filterKeys = new Set<string>();
    for (const filter of resolved.blockFilters) {
      const key = filter.key.trim().toLowerCase();
      if (filterKeys.has(key)) {
        errors.push({
          path: `${where}.blockFilters`,
          message: `expands "${filter.key}" twice; only the first would ever be reached`,
        });
      }
      filterKeys.add(key);
      if ((filter.tags?.length ?? 0) === 0 && (filter.tagsFromStats?.length ?? 0) === 0) {
        errors.push({
          path: `${where}.blockFilters`,
          message: `expands "${filter.key}" into nothing: give it tags or tagsFromStats`,
        });
      }
      for (const pattern of filter.tagsFromStats ?? []) {
        const stars = pattern.split('*').length - 1;
        if (stars !== 1) {
          errors.push({
            path: `${where}.blockFilters`,
            message: `the "${filter.key}" pattern "${pattern}" needs exactly one *, and has ${stars}`,
          });
        }
      }
    }

    // A `setterTags` entry that names nothing, or names a setter twice, is a filter that offers an empty list
    // with no sentence to say why (ADR 0047).
    const tagSetters = new Set<string>();
    for (const entry of resolved.setterTags) {
      const setter = entry.setter.trim().toLowerCase();
      if (setter === '' || entry.tag.trim() === '') {
        errors.push({ path: `${where}.setterTags`, message: 'names a setter and a tag, and both must be non-empty' });
      }
      if (tagSetters.has(setter)) {
        errors.push({
          path: `${where}.setterTags`,
          message: `tags the setter "${entry.setter}" twice; only the first would ever be reached`,
        });
      }
      tagSetters.add(setter);
    }

    // A `setterStats` entry that names nothing starts nothing, and a second entry starting the same stat
    // from the same type is never reached: the first element's value is used (ADR 0057).
    const startedFrom = new Set<string>();
    for (const entry of resolved.setterStats) {
      if (entry.setter.trim() === '' || entry.stat.trim() === '' || entry.types.length === 0) {
        errors.push({ path: `${where}.setterStats`, message: 'names types, a setter and a stat, and none may be empty' });
      }
      for (const type of entry.types) {
        const key = `${type}\u0000${entry.stat.trim().toLowerCase()}`;
        if (startedFrom.has(key)) {
          errors.push({
            path: `${where}.setterStats`,
            message: `starts "${entry.stat}" from a "${type}" twice; only the first would ever be reached`,
          });
        }
        startedFrom.add(key);
      }
    }

    // A `setterGrants` entry that names nothing grants nothing, and one naming a type's setter twice
    // is read twice for no reason: both are a typo nobody would see at runtime (ADR 0058).
    const grantedFrom = new Set<string>();
    for (const entry of resolved.setterGrants) {
      if (entry.setter.trim() === '' || entry.types.length === 0) {
        errors.push({ path: `${where}.setterGrants`, message: 'names types and a setter, and neither may be empty' });
      }
      for (const type of entry.types) {
        const key = `${type} ${entry.setter.trim().toLowerCase()}`;
        if (grantedFrom.has(key)) {
          errors.push({
            path: `${where}.setterGrants`,
            message: `reads the setter "${entry.setter}" on a "${type}" twice`,
          });
        }
        grantedFrom.add(key);
      }
    }

    // A type nothing declares would offer nothing, and nothing would say why (ADR 0064, ADR 0068).
    for (const type of resolved.additions?.types ?? []) {
      if (!typeNames.has(type)) {
        errors.push({ path: `${where}.additions.types`, message: `names "${type}", which the system's elementTypes does not declare` });
      }
    }
    // A type cast through a block that cannot be added would offer a choice nothing ever shows (ADR 0097).
    for (const type of resolved.additions?.blocks?.types ?? []) {
      if (!resolved.additions!.types.includes(type)) {
        errors.push({ path: `${where}.additions.blocks.types`, message: `names "${type}", which is not among the kind's additions types` });
      }
    }
    for (const type of resolved.references?.types ?? []) {
      if (!typeNames.has(type)) {
        errors.push({ path: `${where}.references.types`, message: `names "${type}", which the system's elementTypes does not declare` });
      }
    }
    // A type nothing declares would mark nothing, and nothing would say why.
    for (const type of resolved.candidateOverlaps?.types ?? []) {
      if (!typeNames.has(type)) {
        errors.push({ path: `${where}.candidateOverlaps.types`, message: `names "${type}", which the system's elementTypes does not declare` });
      }
    }
    for (const type of resolved.softRequirements?.types ?? []) {
      if (!typeNames.has(type)) {
        errors.push({ path: `${where}.softRequirements.types`, message: `names "${type}", which the system's elementTypes does not declare` });
      }
    }

    // An attack of a type nothing declares is never one, a condition that will not parse never holds, and a section
    // listing the attacks of a kind with none lists nothing: each a typo nobody would see at runtime (ADR 0093).
    const attacks = resolved.attacks;
    if (attacks) {
      if (!attacks.types.length) errors.push({ path: `${where}.attacks.types`, message: 'names no element type' });
      for (const type of attacks.types) {
        if (!typeNames.has(type)) {
          errors.push({ path: `${where}.attacks.types`, message: `names "${type}", which the system's elementTypes does not declare` });
        }
      }
      // Every condition an attack reads (ADR 0093, 0110). A placeholder is filled from the attack's element; any one id
      // stands for it here.
      const conditions: Array<[string, string | undefined]> = [
        ...attacks.stats.map((s, at): [string, string | undefined] => [`stats[${at}]`, s.requirements]),
        ...(attacks.variants ?? []).map((v, at): [string, string | undefined] => [`variants[${at}]`, v.requirements]),
        ...(attacks.reach ?? []).map((r, at): [string, string | undefined] => [`reach[${at}]`, r.requirements]),
        ...(attacks.innate ?? []).flatMap((innate, i) =>
          innate.stats.map((s, at): [string, string | undefined] => [`innate[${i}].stats[${at}]`, s.requirements]),
        ),
      ];
      // A spell row of a type nothing declares is never one (ADR 0111).
      for (const type of attacks.spells?.types ?? []) {
        if (!typeNames.has(type)) {
          errors.push({ path: `${where}.attacks.spells.types`, message: `names "${type}", which the system's elementTypes does not declare` });
        }
      }
      for (const [at, requirements] of conditions) {
        if (requirements === undefined) continue;
        try {
          parseRequirements(requirements.replace(/\{[^{}]*\}/g, 'X'));
        } catch (err) {
          errors.push({ path: `${where}.attacks.${at}.requirements`, message: (err as Error).message });
        }
      }
    }
    errors.push(...sheetLayoutErrors(resolved.sheet, `${where}.sheet`));
    for (const section of resolved.sheet.sections) {
      if (section.attacks && !attacks) {
        errors.push({ path: `${where}.sheet.sections`, message: `"${section.id}" lists attacks, and the kind declares none` });
      }
      // A bag listed on a kind with nothing to carry lists nothing, and nothing would say why (ADR 0098).
      if (section.bag && !resolved.inventory) {
        errors.push({ path: `${where}.sheet.sections`, message: `"${section.id}" lists the bag, and the kind declares no inventory` });
      }
    }
    // The types an inventory editor offers are element types like any other list's (ADR 0098).
    for (const type of resolved.inventory?.types ?? []) {
      if (!typeNames.has(type)) {
        errors.push({ path: `${where}.inventory.types`, message: `names "${type}", which the system's elementTypes does not declare` });
      }
    }

    // What play keeps track of names rests and sheet sections; one naming nothing would track or give back nothing,
    // and nothing would say why (ADR 0084).
    errors.push(...checkPlay(resolved.play, resolved.sheet.sections, where));

    // Two fields on one key would write each other's text (ADR 0092).
    const freeformKeys = new Set<string>();
    for (const field of resolved.freeform?.fields ?? []) {
      if (freeformKeys.has(field.key)) {
        errors.push({ path: `${where}.freeform.fields`, message: `names the key "${field.key}" twice` });
      }
      freeformKeys.add(field.key);
    }

    // A creature type nothing declares is never held, and a scope setter on a type that is not a creature reads an
    // element the scope does not show: both are a typo nobody would see at runtime (ADR 0073).
    const companions = resolved.companions;
    if (companions) {
      for (const type of companions.types) {
        if (!typeNames.has(type)) {
          errors.push({ path: `${where}.companions.types`, message: `names "${type}", which the system's elementTypes does not declare` });
        }
      }
      const creatureTypes = new Set(companions.types);
      for (const [field, entries] of [
        ['setterStats', companions.setterStats ?? []],
        ['setterGrants', companions.setterGrants ?? []],
      ] as const) {
        for (const entry of entries) {
          for (const type of entry.types) {
            if (!creatureTypes.has(type)) {
              errors.push({ path: `${where}.companions.${field}`, message: `reads a "${type}", which is not one of the companion types` });
            }
          }
        }
      }
      const ids = new Set<string>();
      for (const section of companions.sheet ?? []) {
        if (ids.has(section.id)) errors.push({ path: `${where}.companions.sheet`, message: `declares the section "${section.id}" twice` });
        ids.add(section.id);
        if (section.perBlock) {
          errors.push({ path: `${where}.companions.sheet`, message: `the section "${section.id}" is perBlock, which a creature's stat block does not read` });
        }
        if (section.omitHidden && !section.types?.length) {
          errors.push({ path: `${where}.companions.sheet`, message: `the section "${section.id}" leaves out hidden elements and lists none` });
        }
        // Folding, leaving out what a mark says and writing answers are about listed elements (ADR 0126).
        for (const field of LISTING_FIELDS) {
          if (section[field] && !section.types?.length) {
            errors.push({ path: `${where}.companions.sheet`, message: `the section "${section.id}" declares ${field} and lists no elements` });
          }
        }
        // A creature's scope has no tracks of its own to count (ADR 0079).
        if (section.trackProgress) {
          errors.push({ path: `${where}.companions.sheet`, message: `the section "${section.id}" writes a track's count, which a creature's stat block has none of` });
        }
        if (section.trackDie !== undefined) {
          errors.push({ path: `${where}.companions.sheet`, message: `the section "${section.id}" writes a track's dice, which a creature's stat block has no tracks for` });
        }
        // Nor prepared lists of its own (ADR 0079): its scope publishes none.
        if (section.preparedMark) {
          errors.push({ path: `${where}.companions.sheet`, message: `the section "${section.id}" marks prepared elements, which a creature's stat block has none of` });
        }
        if (section.group && !section.types?.length) {
          errors.push({ path: `${where}.companions.sheet`, message: `the section "${section.id}" groups listed elements and lists none` });
        }
        // What a row shows beside it is a stat the scope has, or the row reads a blank (ADR 0074).
        const scopeStats = new Set([...statNames, ...(companions.stats ?? []).map((s) => s.name.toLowerCase())]);
        errors.push(...markErrors(section, scopeStats, `${where}.companions.sheet`));
        for (const stat of section.stats ?? []) {
          const beside = section.beside?.split('{stat}').join(stat).toLowerCase();
          if (beside !== undefined && !scopeStats.has(beside)) {
            errors.push({ path: `${where}.companions.sheet`, message: `section "${section.id}" shows "${beside}" beside "${stat}", which is not declared` });
          }
        }
      }
    }

    // A custom feature held as a type nothing declares is listed nowhere, and one whose default the list leaves out
    // would be held as a type no picker offers (ADR 0065).
    const customFeatures = resolved.customFeatures;
    if (customFeatures) {
      for (const type of new Set([customFeatures.type, ...(customFeatures.types ?? [])])) {
        if (!typeNames.has(type)) {
          errors.push({ path: `${where}.customFeatures`, message: `names "${type}", which the system's elementTypes does not declare` });
        }
      }
      if (customFeatures.types && !customFeatures.types.includes(customFeatures.type)) {
        errors.push({ path: `${where}.customFeatures.types`, message: `leaves out "${customFeatures.type}", the type a feature is held as by default` });
      }
    }

    // A custom feature section that names no section of the kind's sheet offers nothing from it, and nothing would
    // say why a stat the author meant to allow is missing from the picker (ADR 0063).
    for (const id of resolved.customFeatures?.sections ?? []) {
      if (!resolved.sheet.sections.some((section) => section.id === id)) {
        errors.push({ path: `${where}.customFeatures.sections`, message: `names "${id}", which is not a section of this kind's sheet` });
      }
    }

    // A preparation declaration whose filters will not parse, or which name an interpolation the kind never
    // expands, is invisible at runtime: nothing could be prepared and nothing would say why (ADR 0046).
    const preparation = resolved.preparation;
    if (preparation) {
      if (!preparation.limit.includes('{name}')) {
        errors.push({
          path: `${where}.preparation`,
          message: `the limit "${preparation.limit}" names no {name}, so every block would share one number`,
        });
      }
      for (const field of ['listFilter', 'heldFilter'] as const) {
        const expr = parseSupports(preparation[field]);
        if (expr === undefined) {
          errors.push({
            path: `${where}.preparation`,
            message: `${field} "${preparation[field]}" is not a supports expression`,
          });
          continue;
        }
        for (const key of supportsInterpolations(expr)) {
          if (!filterKeys.has(key.trim().toLowerCase())) {
            errors.push({
              path: `${where}.preparation`,
              message: `${field} uses $(${key}), which this kind's blockFilters never expand`,
            });
          }
        }
      }
    }

    // A `perBlock` section names stats no system definition can declare — the key comes
    // from content, so `bard:spellcasting:dc` is unknowable here (ADR 0020). What *is*
    // checkable, and worth checking, is that its patterns are ones this kind publishes:
    // a section showing "{name}:spellcasting:dc" with no matching blockStats entry renders
    // a row of blanks, and that is the mistake an author actually makes.
    const blockStatPatterns = new Set(resolved.blockStats.map((b) => b.stat.toLowerCase()));

    for (const section of resolved.sheet.sections) {
      // Leaving hidden elements out of a section that lists none says nothing (ADR 0076).
      if (section.omitHidden && !section.types?.length) {
        errors.push({ path: `${where}.sheet`, message: `section "${section.id}" leaves out hidden elements and lists none` });
      }
      // Folding, leaving out what a mark says and writing answers are about listed elements (ADR 0126).
      for (const field of LISTING_FIELDS) {
        if (section[field] && !section.types?.length) {
          errors.push({ path: `${where}.sheet`, message: `section "${section.id}" declares ${field} and lists no elements` });
        }
      }
      // A track's count is read where the progression publishes it (ADR 0079): beside listed elements, and only on a kind
      // whose progression names the stat.
      if (section.trackProgress) {
        if (!section.types?.length) {
          errors.push({ path: `${where}.sheet`, message: `section "${section.id}" writes a track's count beside listed elements and lists none` });
        }
        if (resolved.progression.kind === 'none' || !resolved.progression.trackStatPattern) {
          errors.push({ path: `${where}.sheet`, message: `section "${section.id}" writes a track's count, and this kind's progression publishes none (no trackStatPattern)` });
        }
      }
      // A track's dice are its count of a die (ADR 0079), so a section writing them writes the count.
      if (section.trackDie !== undefined && !section.trackProgress) {
        errors.push({ path: `${where}.sheet`, message: `section "${section.id}" writes a track's dice and not its count (no trackProgress)` });
      }
      // A group and a prepared mark are written beside listed elements (ADR 0079), and a prepared mark only of what the
      // kind's prepared lists hold: a section of other types, or a kind that prepares nothing, would never show one.
      if (section.group && !section.types?.length) {
        errors.push({ path: `${where}.sheet`, message: `section "${section.id}" groups listed elements and lists none` });
      }
      if (section.preparedMark) {
        if (!resolved.preparation) {
          errors.push({ path: `${where}.sheet`, message: `section "${section.id}" marks prepared elements, and this kind prepares nothing (no preparation)` });
        } else if (!section.types?.includes(resolved.preparation.elementType)) {
          errors.push({ path: `${where}.sheet`, message: `section "${section.id}" marks prepared elements and does not list "${resolved.preparation.elementType}", what this kind prepares` });
        }
      }
      errors.push(...markErrors(section, statNames, `${where}.sheet`));
      for (const stat of section.stats ?? []) {
        // What a row shows beside it (ADR 0074) must be published as the row must be, or it reads a blank.
        const beside = section.beside?.split('{stat}').join(stat).toLowerCase();
        if (beside !== undefined && !(section.perBlock ? blockStatPatterns : statNames).has(beside)) {
          errors.push({
            path: `${where}.sheet`,
            message: `section "${section.id}" shows "${beside}" beside "${stat}", which is not declared by the system or by this kind`,
          });
        }
        if (section.perBlock) {
          if (!blockStatPatterns.has(stat.toLowerCase())) {
            errors.push({
              path: `${where}.sheet`,
              message: `section "${section.id}" is perBlock and shows "${stat}", which no blockStats entry of this kind publishes`,
            });
          }
          continue;
        }
        if (!statNames.has(stat.toLowerCase())) {
          errors.push({
            path: `${where}.sheet`,
            message: `section "${section.id}" shows the stat "${stat}", which is not declared by the system or by this kind`,
          });
        }
      }
      for (const type of section.types ?? []) {
        if (!typeNames.has(type)) {
          errors.push({
            path: `${where}.sheet`,
            message: `section "${section.id}" lists "${type}", which the system's elementTypes does not declare`,
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Render errors for a terminal or an error panel. One line each, path first, because the
 * person reading this is looking at the JSON file and needs to know where to click.
 */
/**
 * A section's `mark` (ADR 0079): it counts multiples of a stat the kind declares, has something to call one, and reads a
 * stat per row. The row's own stat is not required to be declared: content supplies it (5e's `<skill>:proficiency` is
 * contributed and never declared for a player character), as it does for `showWhen`.
 */
function markErrors(section: SheetSectionDef, statNames: ReadonlySet<string>, path: string): SchemaError[] {
  const mark = section.mark;
  if (!mark) return [];
  const errors: SchemaError[] = [];
  if (!statNames.has(mark.per.toLowerCase())) {
    errors.push({ path, message: `section "${section.id}" counts its marks in "${mark.per}", which is not declared by the system or by this kind` });
  }
  if (!mark.stat.includes('{stat}')) {
    errors.push({ path, message: `section "${section.id}" reads every row's mark from "${mark.stat}", which names no {stat}` });
  }
  if (!mark.labels.length) errors.push({ path, message: `section "${section.id}" has a mark with nothing to call it` });
  if (!section.stats?.length) errors.push({ path, message: `section "${section.id}" marks rows and shows none` });
  return errors;
}

export function formatSchemaErrors(errors: SchemaError[], limit = 25): string[] {
  const lines = errors.slice(0, limit).map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
  if (errors.length > limit) lines.push(`… and ${errors.length - limit} more`);
  return lines;
}

/** A thrown Error starts with a capital; inside "characterKinds[2].extends: …" it should not. */
function lowerFirst(message: string): string {
  return message.charAt(0).toLowerCase() + message.slice(1);
}

