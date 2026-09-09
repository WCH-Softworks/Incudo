/**
 * The character model.
 *
 * A character stores the *choices* that produce it and nothing that can be computed
 * from them. No AC, no HP total, no spell slots. See docs/adr/0006 — including the
 * costs, which are real.
 *
 * One exception, and it is a principled one: **recorded random results are inputs**
 * (ADR 0007). A die roll has no formula, so re-deriving it would silently reroll it.
 * Those live in `rolls`.
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
  /** Which of the system's character kinds this is: "pc", "npc", … — ADR 0009. */
  kind: string;
  name: string;
  /**
   * The single progression number. Its meaning comes from the kind's `progression`:
   * a level, a challenge rating, an xp total, or nothing at all.
   */
  progress: number;
  /**
   * The sources this character was built from — an **allowlist**, with versions.
   * Since ADR 0012 these are provenance and an update path, not a load-time dependency:
   * a `.incu` embeds the content it needs and opens with no sources configured at all.
   */
  sources: SourceRef[];
  /** Everything the user picked, in build order. */
  choices: Choice[];
  /**
   * Recorded random results, keyed by what was rolled for: `"hp:level:2": 7`.
   * Inputs, not derivations — see the file header and ADR 0007.
   */
  rolls: Record<string, number>;
  /** Free text the rules never touch: notes, appearance, backstory. */
  freeform: Record<string, string>;
  /**
   * Relative paths into the save's `assets/` folder: `{ portrait: "assets/vigaro.png" }`.
   * Never base64 — the bytes live beside the JSON in the container (ADR 0007, ADR 0012).
   */
  assets?: Record<string, string>;
  /**
   * Manual escape hatch for wrong or missing content. Present because the alternative is
   * a user being stuck; the UI should present it as a repair tool, clearly marked.
   */
  overrides?: Record<StatKey, number | string>;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateCharacterOptions {
  name?: string;
  kind?: string;
  progress?: number;
}

export function createCharacter(
  systemId: string,
  kind: string,
  options: CreateCharacterOptions = {},
): Character {
  return {
    formatVersion: 1,
    id: cryptoRandomId(),
    systemId,
    kind,
    name: options.name ?? 'New Character',
    progress: options.progress ?? 0,
    sources: [],
    choices: [],
    rolls: {},
    freeform: {},
    createdAt: new Date().toISOString(),
  };
}

export function getChoice(character: Character, ruleKey: string): Choice | undefined {
  return character.choices.find((c) => c.ruleKey === ruleKey);
}

export function setChoice(
  character: Character,
  ruleKey: string,
  elementIds: ElementId[],
): Character {
  const rest = character.choices.filter((c) => c.ruleKey !== ruleKey);
  const choices = elementIds.length ? [...rest, { ruleKey, elementIds }] : rest;
  return { ...character, choices, updatedAt: new Date().toISOString() };
}

export function getRoll(character: Character, key: string): number | undefined {
  return character.rolls[key];
}

/**
 * Record a die result. Passing `undefined` forgets it, which is the only way a roll
 * should ever disappear — nothing re-rolls silently.
 */
export function setRoll(character: Character, key: string, value: number | undefined): Character {
  const rolls = { ...character.rolls };
  if (value === undefined) delete rolls[key];
  else rolls[key] = value;
  return { ...character, rolls, updatedAt: new Date().toISOString() };
}

/** Every element id the character explicitly chose, in build order. */
export function chosenElementIds(character: Character): ElementId[] {
  const ids: ElementId[] = [];
  for (const choice of character.choices) {
    for (const id of choice.elementIds) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
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
