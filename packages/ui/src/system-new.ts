/**
 * "New system…": the file a new system starts as (ADR 0104).
 *
 * ADR 0011 promises that nobody faces an empty file. There are three starts: Incudo's own small starter system, changes
 * to a shipped system (an overlay, ADR 0102, which keeps receiving its fixes), and a copy of one (the whole definition,
 * recording what it was copied from so it keeps that system's content). This module only writes text. The shell saves it
 * where the user chooses and adds those bytes through `UserSystemStore.add`, so a new system is validated exactly as an
 * added file is, and the user has the file to edit.
 *
 * Nothing here knows a game. The starter's nouns are data the author is expected to replace.
 */

import type { GameSystem } from '@incudo/core';

/** Where a new system starts. */
export type NewSystemStart =
  | { kind: 'starter' }
  /** An overlay of a shipped system, changing nothing yet. */
  | { kind: 'changes'; of: GameSystem }
  /** The whole of a shipped system under a new id. */
  | { kind: 'copy'; of: GameSystem };

/** One start, worded for the dialog. */
export interface NewSystemChoice {
  key: string;
  label: string;
  /** One sentence on what this start gives, shown under the choice. */
  note: string;
  start: NewSystemStart;
}

/** The starts offered: the starter, then for each shipped system its changes and then a copy of it. */
export function newSystemChoices(shipped: readonly GameSystem[]): NewSystemChoice[] {
  const choices: NewSystemChoice[] = [
    {
      key: 'starter',
      label: 'A small starter system',
      note: 'Three scores, a level, traits and items. It builds a character with no content; change it to fit your game.',
      start: { kind: 'starter' },
    },
  ];
  for (const system of shipped) {
    choices.push({
      key: `changes:${system.id}`,
      label: `Changes to ${system.name}`,
      note: 'Starts with nothing changed: write only what your table does differently. Fixes to the original keep reaching it.',
      start: { kind: 'changes', of: system },
    });
    choices.push({
      key: `copy:${system.id}`,
      label: `A copy of ${system.name}`,
      note: 'The whole definition, to change as you like. It uses the same content; later fixes to the original do not reach it.',
      start: { kind: 'copy', of: system },
    });
  }
  return choices;
}

/** The schema's id pattern and length. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ID_MAX = 64;

/**
 * The id a system of this name gets: lowercased, accents dropped, every run of anything else a hyphen, at most 64
 * characters. When it is taken (ignoring case), `-2`, `-3`… is added, since `UserSystemStore.add` replaces a system of the
 * same id and a new system must never replace one. Undefined when the name has no letter or digit to make one from.
 */
export function systemIdFor(name: string, taken: Iterable<string>): string | undefined {
  const base = trimHyphens(
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-'),
  ).slice(0, ID_MAX);
  const root = trimHyphens(base);
  if (!root || !ID_PATTERN.test(root)) return undefined;
  const used = new Set([...taken].map((id) => id.toLowerCase()));
  if (!used.has(root)) return root;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${trimHyphens(root.slice(0, ID_MAX - suffix.length))}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

function trimHyphens(text: string): string {
  return text.replace(/^-+|-+$/g, '');
}

export type NewSystemFile =
  | { ok: true; id: string; name: string; fileName: string; text: string }
  | { ok: false; message: string };

/** The version every new system starts at: it is the user's own from now on. */
export const NEW_SYSTEM_VERSION = '0.1.0';

/**
 * The text of a new system's file, or why there is none. `taken` is every id in use: the shipped systems, the user's, and
 * any definition that failed to load (its stored copy would be replaced too).
 */
export function newSystemFile(start: NewSystemStart, name: string, taken: Iterable<string>): NewSystemFile {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: 'Give the system a name.' };
  const id = systemIdFor(trimmed, taken);
  if (!id) return { ok: false, message: 'The name needs at least one letter or digit: the system\'s id is made from it.' };
  const definition =
    start.kind === 'starter'
      ? starterSystem(id, trimmed)
      : start.kind === 'changes'
        ? changesTo(start.of, id, trimmed)
        : copyOf(start.of, id, trimmed);
  return { ok: true, id, name: trimmed, fileName: `${id}.json`, text: `${JSON.stringify(definition, null, 2)}\n` };
}

/** An overlay that changes nothing yet. `version` is required in an overlay's shell, so it is written. */
function changesTo(parent: GameSystem, id: string, name: string): Record<string, unknown> {
  return {
    formatVersion: 1,
    id,
    name,
    description: `Changes to ${parent.name}.`,
    version: NEW_SYSTEM_VERSION,
    extends: parent.id,
  };
}

/**
 * The whole parent under a new id, name, description and version, recording what it was copied from. The parent as
 * validated is its file (ADR 0104 measured both shipped systems), so this is the file's JSON with those fields changed.
 */
function copyOf(parent: GameSystem, id: string, name: string): Record<string, unknown> {
  const own = new Set(['formatVersion', 'id', 'name', 'description', 'version', 'extends', 'copiedFrom']);
  const rest = Object.fromEntries(Object.entries(parent).filter(([key]) => !own.has(key)));
  return {
    formatVersion: parent.formatVersion,
    id,
    name,
    description: `A copy of ${parent.name}.`,
    version: NEW_SYSTEM_VERSION,
    // The parent's own origin when it has one, so a copy of a copy still reaches the content (a shipped system has none).
    copiedFrom: parent.copiedFrom ?? parent.id,
    ...rest,
  };
}

const ref = (stat: string): Record<string, unknown> => ({ kind: 'ref', stat });

/**
 * Incudo's starter system (ADR 0104 decision 3): two element types, three scores entered by hand, a level, a stat derived
 * from a score and the level, one kind with a required scores step, two optional element steps, text about the character
 * and a sheet. It builds a character with no content loaded. Every name in it is a placeholder for the author's own.
 */
export function starterSystem(id: string, name: string): Record<string, unknown> {
  return {
    formatVersion: 1,
    id,
    name,
    description: 'Describe your game here. This system started as Incudo\'s starter: three scores, a level, traits and items.',
    version: NEW_SYSTEM_VERSION,
    elementTypes: [
      { name: 'Trait', plural: 'Traits', selectable: true, browsable: true },
      { name: 'Item', plural: 'Items', selectable: true, browsable: true },
    ],
    stats: [
      { name: 'might', label: 'Might', default: 10 },
      { name: 'agility', label: 'Agility', default: 10 },
      { name: 'wits', label: 'Wits', default: 10 },
    ],
    generationMethods: [{ id: 'entered', label: 'Enter manually', min: 1, max: 20 }],
    characterKinds: [
      {
        id: 'character',
        name: 'Character',
        description: 'The one kind of character this system has so far.',
        default: true,
        progression: { kind: 'level', min: 1, max: 10, stat: 'level' },
        stats: [
          { name: 'level', label: 'Level', default: 1 },
          {
            name: 'health',
            label: 'Health',
            default: 0,
            derive: {
              kind: 'binary',
              op: '+',
              left: ref('might'),
              right: { kind: 'binary', op: '*', left: ref('level'), right: { kind: 'number', value: 2 } },
            },
          },
        ],
        elementTypes: ['Trait', 'Item'],
        buildSteps: [
          {
            id: 'scores',
            label: 'Scores',
            types: [],
            required: true,
            description: 'Enter each score, from 1 to 20.',
            budget: { stat: 'score points', targets: ['might', 'agility', 'wits'], methods: ['entered'] },
          },
          { id: 'traits', label: 'Traits', types: ['Trait'] },
          { id: 'gear', label: 'Gear', types: ['Item'] },
        ],
        freeform: {
          label: 'About the character',
          description: 'Text no rule reads. Whatever is written here is shown on the sheet.',
          fields: [
            { key: 'appearance', label: 'Appearance', multiline: true },
            { key: 'notes', label: 'Notes', multiline: true },
          ],
        },
        sheet: {
          sections: [
            { id: 'scores', label: 'Scores', stats: ['might', 'agility', 'wits'] },
            { id: 'condition', label: 'Condition', stats: ['level', 'health'] },
            { id: 'traits', label: 'Traits', types: ['Trait'] },
            { id: 'gear', label: 'Gear', types: ['Item'] },
          ],
        },
      },
    ],
  };
}

/** After a new system is saved and added: where it is, and how to change it. */
export function newSystemSavedNote(name: string, savedAs: string): string {
  return `Saved ${name} as ${savedAs} and added it. To change it, edit that file and add it again with Add a system…`;
}

/**
 * A copy's line on its launcher card (ADR 0104 decision 4), or nothing for a system that is not one. `nameOf` gives a
 * loaded system's name; a copy of one that is not loaded is named by the id its file writes, the only name there is.
 */
export function copiedFromNote(system: Pick<GameSystem, 'copiedFrom'>, nameOf: (id: string) => string | undefined): string | undefined {
  if (system.copiedFrom === undefined) return undefined;
  const origin = nameOf(system.copiedFrom);
  return origin
    ? `Uses the content of ${origin}, which it was copied from. Later fixes to ${origin} do not reach it.`
    : `A copy of "${system.copiedFrom}", which Incudo does not have.`;
}
