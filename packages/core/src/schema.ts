/**
 * Validating the formats Incudo owns.
 *
 * The schemas under `schemas/` are the contract; this file is the one implementation that
 * checks against them (ADR 0011). `core` has no filesystem and no bundler, so the schema
 * documents are handed in: the CLI reads them off disk, an app imports them. What must not
 * happen is a second validator anywhere — a system that passes `incudo system validate` and
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
  progressionStat,
  resolveCharacterKind,
  type GameSystem,
} from './system.ts';
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
export function validateGameSystem(
  value: unknown,
  schemas: SchemaBundle,
): ValidationResult<GameSystem> {
  const errors = validateJson(value, schemas.system);
  if (errors.length === 0) errors.push(...checkSystemReferences(value as GameSystem));
  return result(value as GameSystem, errors);
}

export function validateCharacter(
  value: unknown,
  schemas: SchemaBundle,
): ValidationResult<Character> {
  const errors = validateJson(value, schemas.character);
  if (errors.length === 0) errors.push(...checkCharacterReferences(value as Character));
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

function result<T>(value: T, errors: SchemaError[]): ValidationResult<T> {
  return { valid: errors.length === 0, value: errors.length === 0 ? value : undefined, errors };
}

/**
 * The one thing about a character the schema cannot say: `instanceId` is unique.
 *
 * It matters because it is an address. `setInventoryEntry` replaces by it and a UI keys rows
 * by it, so two entries sharing one is a file where editing an item changes a different item
 * (ADR 0024). Everything else about a character is either structural — which the schema
 * checks — or a reference into content, which the save deliberately does not have loaded.
 */
function checkCharacterReferences(character: Character): SchemaError[] {
  const errors: SchemaError[] = [];
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

  const defaults = kinds.filter((k) => k.default);
  if (defaults.length > 1) {
    errors.push({
      path: 'characterKinds',
      message: `marks ${defaults.length} kinds as default (${defaults
        .map((k) => k.id)
        .join(', ')}); only one may be`,
    });
  }

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
      for (const type of step.types) {
        if (!typeNames.has(type)) {
          errors.push({
            path: `${where}.buildSteps`,
            message: `step "${step.id}" picks "${type}", which the system's elementTypes does not declare`,
          });
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

    // A `perBlock` section names stats no system definition can declare — the key comes
    // from content, so `bard:spellcasting:dc` is unknowable here (ADR 0020). What *is*
    // checkable, and worth checking, is that its patterns are ones this kind publishes:
    // a section showing "{name}:spellcasting:dc" with no matching blockStats entry renders
    // a row of blanks, and that is the mistake an author actually makes.
    const blockStatPatterns = new Set(resolved.blockStats.map((b) => b.stat.toLowerCase()));

    for (const section of resolved.sheet.sections) {
      for (const stat of section.stats ?? []) {
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
export function formatSchemaErrors(errors: SchemaError[], limit = 25): string[] {
  const lines = errors.slice(0, limit).map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));
  if (errors.length > limit) lines.push(`… and ${errors.length - limit} more`);
  return lines;
}

/** A thrown Error starts with a capital; inside "characterKinds[2].extends: …" it should not. */
function lowerFirst(message: string): string {
  return message.charAt(0).toLowerCase() + message.slice(1);
}

