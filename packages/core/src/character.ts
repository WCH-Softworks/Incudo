/**
 * The character model.
 *
 * A character stores the *choices* that produce it and nothing that can be computed
 * from them. No AC, no HP total, no spell slots. See docs/adr/0006 — including the
 * costs, which are real.
 */

import type { ElementId, StatKey } from './model.ts';

export interface SourceRef {
  /** Stable id for the content source, usually its index URL. */
  id: string;
  name?: string;
  /** The version recorded in the index when this character was last edited. */
  version?: string;
  /** Whether the user streams this source or keeps it downloaded. */
  mode?: 'stream' | 'download';
}

export interface Choice {
  /**
   * Identifies which `select` rule this answers, stable across rebuilds:
   * `<granting element id>/<rule key>`.
   */
  ruleKey: string;
  elementIds: ElementId[];
}

export interface Character {
  formatVersion: 1;
  id: string;
  systemId: string;
  name: string;
  level: number;
  sources: SourceRef[];
  /** Everything the user picked, in build order. */
  choices: Choice[];
  /** Free text the rules never touch: notes, appearance, portrait reference. */
  freeform: Record<string, string>;
  /**
   * Manual escape hatch for wrong or missing content. Present because the alternative is
   * a user being stuck; the UI should present it as a repair tool, clearly marked.
   */
  overrides?: Record<StatKey, number | string>;
  createdAt?: string;
  updatedAt?: string;
}

export function createCharacter(systemId: string, name = 'New Character'): Character {
  return {
    formatVersion: 1,
    id: cryptoRandomId(),
    systemId,
    name,
    level: 1,
    sources: [],
    choices: [],
    freeform: {},
    createdAt: new Date().toISOString(),
  };
}

export function getChoice(character: Character, ruleKey: string): Choice | undefined {
  return character.choices.find((c) => c.ruleKey === ruleKey);
}

export function setChoice(character: Character, ruleKey: string, elementIds: ElementId[]): Character {
  const rest = character.choices.filter((c) => c.ruleKey !== ruleKey);
  const choices = elementIds.length ? [...rest, { ruleKey, elementIds }] : rest;
  return { ...character, choices, updatedAt: new Date().toISOString() };
}

/**
 * Id generation without depending on a platform crypto API — core stays portable.
 * Not security-sensitive: these only need to be unique within a user's library.
 */
function cryptoRandomId(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${time}-${rand}`;
}
