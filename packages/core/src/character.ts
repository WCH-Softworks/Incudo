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

/**
 * One point of progression, and what it was spent on — ADR 0015.
 *
 * A 5e character's levels: `{ at: 1, elementId: "…CLASS_PALADIN" }`, `{ at: 3, elementId:
 * "…CLASS_WARLOCK" }`. Core never says "class"; it says the element that owns that point.
 */
export interface AdvancementEntry {
  /** A progression number, meaning whatever the kind's `progression` says it means. */
  at: number;
  /** The element that point of progression went to. */
  elementId: ElementId;
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
  /**
   * Starting values for stats nothing computes: ability scores the user rolled, bought or
   * typed in. They replace the kind's declared `default` and everything else adds on top,
   * so a racial +2 still lands (ADR 0014).
   *
   * The same category as `rolls` — an input with no formula — and emphatically *not*
   * `overrides`, which wins over every contribution and would silently discard that +2.
   */
  baseStats?: Record<StatKey, number>;
  /**
   * Which element each point of progression was spent on, in order (ADR 0015). A 5e
   * character's twenty levels; a Rogue 5 / Wizard 3 has five entries naming the rogue and
   * three naming the wizard.
   *
   * An input in the same sense as `rolls` and `baseStats`: nothing derives which class you
   * took at level 7. Optional, and a character without it behaves as one with a single
   * track — which is why every single-classed save stayed correct before this existed.
   */
  advancement?: AdvancementEntry[];
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
 * The distinct elements the character has spent progression on — ADR 0015.
 *
 * These are seeds in the same way choices are: a second class is not chosen by any select,
 * it is what levels 3 onwards went to. `collectCharacterContent` needs them for the same
 * reason the engine does, or a multiclass save embeds only half of itself and ADR 0012
 * quietly breaks.
 */
export function advancementElementIds(character: Character): ElementId[] {
  const ids: ElementId[] = [];
  for (const entry of character.advancement ?? []) {
    if (!ids.includes(entry.elementId)) ids.push(entry.elementId);
  }
  return ids;
}

/**
 * How many points of progression each track holds: the 5e class levels.
 *
 * Entries past the character's own `progress` are ignored, so a character levelled back down
 * does not keep the levels it no longer has — the same reason `rolls` keeps entries it is not
 * using but the engine does not read them.
 */
export function advancementCounts(character: Character): Map<ElementId, number> {
  const counts = new Map<ElementId, number>();
  const seen = new Set<number>();
  for (const entry of character.advancement ?? []) {
    if (entry.at > character.progress) continue;
    // One element per point. A duplicated `at` is a broken save, and counting it twice
    // would inflate a class level; the first entry for a point wins.
    if (seen.has(entry.at)) continue;
    seen.add(entry.at);
    counts.set(entry.elementId, (counts.get(entry.elementId) ?? 0) + 1);
  }
  return counts;
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
