/**
 * The character model.
 *
 * A character stores the *choices* that produce it and nothing that can be computed
 * from them. No AC, no HP total, no spell slots. See docs/adr/0006 — including the
 * costs, which are real.
 *
 * The exceptions are all one principled thing: **an input with no formula is stored**.
 * A die roll would be silently rerolled if it were derived (`rolls`, ADR 0007); so would an
 * ability score the user bought (`baseStats`, ADR 0014), the class each level went to
 * (`advancement`, ADR 0015), the method a build step used (`generation`, ADR 0017), and what
 * the character is carrying (`inventory`, ADR 0024). None of them is a *number the rules
 * produce*, which is what ADR 0006 is actually about.
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

/**
 * A magic item attached to another item: a Frost Brand on a greatsword — ADR 0024.
 *
 * It nests rather than being a flat entry with a parent reference, because that is what the
 * saves are: 15 adornments across nine characters, at most one per host, never nested, and
 * never carried on their own. Nesting makes an orphan unrepresentable instead of merely
 * invalid, and an adornment follows its host without a second bookkeeping step.
 *
 * It has no `instanceId` of its own. Aurora gives adorners no identity, so minting one would
 * mean the importer inventing ids — and inventing them makes an import non-deterministic. An
 * adornment is addressed by its host and its element.
 */
export interface Adornment {
  elementId: ElementId;
}

/**
 * One thing in the bag — an **instance**, not a reference to an element (ADR 0024).
 *
 * That distinction is measured, not assumed: one of a set of real saves carries two
 * greatswords with different enchantments, so anything keyed by element id loses a real
 * character's real items.
 */
export interface InventoryEntry {
  /** Unique within this character. Aurora's `identifier` GUID, when the entry came from one. */
  instanceId: string;
  elementId: ElementId;
  /**
   * How many identical copies this row stands for. Omitted means 1, and the derivation reads
   * the entry once however large it is — ten arrows are not ten contributions.
   */
  quantity?: number;
  /** Worn or wielded. Omitted means carried, which is a different thing entirely. */
  equipped?: boolean;
  /**
   * Where it went, **only when that is not what the element itself says**.
   *
   * Content declares a slot on 1,070 elements, and across all 26 equipped items in the nine
   * saves the recorded location agrees with it every time. So this is an override — a shield
   * in the off hand, a versatile weapon in both — and is normally absent.
   */
  slot?: string;
  /**
   * Attuned, covering this entry and its adornment together. Aurora has no per-adorner flag
   * and neither does this: 5 of the adorners that require attunement are recorded by a flag
   * on their host, which is also what the rulebook means (ADR 0023).
   */
  attuned?: boolean;
  adorners?: Adornment[];
  /** The user's own name for this one, not a copy of the element's. */
  name?: string;
  notes?: string;
}

export interface Character {
  /**
   * 1 before an inventory existed, 2 since (ADR 0024), 3 for a character that records no `progress` or
   * records `removedGrants` (ADR 0060, ADR 0061), 4 for one that records `customFeatures` (ADR 0063), 5 for one that
   * records `additions` (ADR 0064). Readers accept all five. A new character is written at 2, and only a write that needs more raises it
   * (`raiseFormatVersion`): an older reader would silently get those characters wrong, and gets every other one
   * right.
   */
  formatVersion: CharacterFormatVersion;
  id: string;
  systemId: string;
  /** Which of the system's character kinds this is: "pc", "npc", … — ADR 0009. */
  kind: string;
  name: string;
  /**
   * The single progression number. Its meaning comes from the kind's `progression`:
   * a level, a challenge rating, an xp total, or nothing at all.
   *
   * **Absent means "where the kind says it starts"** (ADR 0060): where an element the character chose
   * prints it, as the kind's `setterStats` says — a creature's challenge rating — or else where the
   * progression starts. A value the user set replaces the print, as `baseStats` replaces a printed score.
   * Only format 3 may omit it. Read it through `characterProgress`, never directly, where it may be absent.
   */
  progress?: number;
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
  /**
   * Which generation method each budgeted build step used, keyed by step id:
   * `{ abilities: "point-buy" }` — ADR 0017.
   *
   * An input like the four above, and the one whose only purpose is to make a *later* edit
   * behave sensibly. Without it, reopening the abilities decision at level 4 cannot tell a
   * rolled 15 from a bought one and would have to offer both readings.
   */
  generation?: Record<string, string>;
  /**
   * What the character is carrying and wearing — ADR 0024.
   *
   * The seventh input, and an input in exactly the sense ADR 0006 means: the user put it
   * there and no formula produces it. Every entry's element is embedded in the save, carried
   * ones included, or the bag cannot be read without sources and ADR 0012 quietly breaks.
   */
  inventory?: InventoryEntry[];
  /** Free text the rules never touch: notes, appearance, backstory. */
  freeform: Record<string, string>;
  /**
   * Relative paths into the save's `assets/` folder: `{ portrait: "assets/portrait.png" }`.
   * Never base64 — the bytes live beside the JSON in the container (ADR 0007, ADR 0012).
   */
  assets?: Record<string, string>;
  /**
   * Manual escape hatch for wrong or missing content. Present because the alternative is
   * a user being stuck; the UI should present it as a repair tool, clearly marked.
   */
  overrides?: Record<StatKey, number | string>;
  /**
   * Non-blocking decisions the user has explicitly said to skip, by `OpenDecision.id`
   * (ADR 0033). An input in the same family as `rolls` and `baseStats` — the decision to
   * decline something is itself a fact nothing derives — and deliberately not a sentinel
   * inside `choices`: an empty `elementIds` there already means "remove this record", so
   * reusing that shape for "skipped, don't ask again" would be indistinguishable from
   * "never answered" and the engine would recompute it as pending on the very next read.
   */
  declinedDecisions?: string[];
  /**
   * What the player put on each casting block's prepared list, keyed by the lowercased block name and
   * holding element ids in the order they were added — ADR 0046.
   *
   * An input in ADR 0006's sense: nothing produces which spells a character prepared. Everything else about
   * preparation derives (how many may be, which are always prepared, what is over), so an id that content
   * also makes always prepared may sit here and counts for nothing. Absent when empty, like `advancement`.
   * Additive and optional, so `formatVersion` did not move; a reader that does not know it loses the list
   * and nothing else derives differently. The elements are embedded in the save (ADR 0012) and are **not**
   * derivation seeds: Aurora's own `<sum>` does not hold them either.
   */
  prepared?: Record<string, ElementId[]>;
  /**
   * The publications this character is offered, by name, in the order chosen — ADR 0049. **Absent means every
   * publication**, which is what a new character starts with and what every save written before this has.
   *
   * It narrows what the builder offers and nothing else: an element the character already holds from a
   * publication outside the list stays and derives exactly as before. An allowlist rather than a blocklist, so a
   * book published after the table chose is not offered until someone adds it. Which element type is a
   * publication is the system's to say (`ElementTypeDef.publication`); a name no loaded publication has is kept.
   */
  publications?: string[];
  /**
   * Elements a held element's declared setter names, which the user took away — ADR 0061. A DM's Triceratops
   * without Stomp. An input like `declinedDecisions`: nothing derives that a trait was removed.
   *
   * It cancels only what the holder gives: the setter that names the id and that same holder's own `<grant>` of
   * it. The same element chosen, or granted by anything else, is still held. Absent when empty; only format 3
   * records it, because a reader of 2 would give the trait back without a word.
   */
  removedGrants?: ElementId[];
  /**
   * Features the user wrote for this character, each adding to or setting stats — ADR 0063. A DM's "Godspeed:
   * Speed 60" on an NPC. An input like `baseStats`: nothing derives that the DM wrote it. Held as an element of the
   * type the kind's `customFeatures` names; a kind that names none carries none. Absent when empty; only format 4
   * records it, because a reader of 3 would drop it without a word.
   */
  customFeatures?: CustomFeature[];
  /**
   * Elements from loaded content the user put on this character, in the order added — ADR 0064. A DM's NPC
   * resistant to fire, or a feat given whatever its prerequisites. An input like `inventory`: nothing derives that the DM added
   * it. Not a choice, so nothing that finds a record in `choices` by what it holds can claim it. Which types may be
   * added is the kind's `additions`. Absent when empty; only format 5 records it, because a reader of 4 would drop
   * it without a word.
   */
  additions?: ElementId[];
  createdAt?: string;
  updatedAt?: string;
}

export type CharacterFormatVersion = 1 | 2 | 3 | 4 | 5;

/** A feature the user wrote for one character — ADR 0063. */
export interface CustomFeature {
  /** Unique within the character. The feature is held as the element `custom:<id>`. */
  id: string;
  name: string;
  description?: string;
  /** What it does to the character's stats, in order. May be empty: a feature can be only a name. */
  stats: CustomStatLine[];
}

/**
 * One stat a custom feature changes — ADR 0063. `add` contributes like any content's rule; `set` is where the stat
 * starts, replacing a default, another stat's start and a creature's print, and replaced by a value the user types.
 */
export interface CustomStatLine {
  stat: StatKey;
  mode: 'add' | 'set';
  value: number;
}

/**
 * What a writer writes. 1 is still read, and is a character from before inventories
 * existed — see ADR 0024 for why this moved when three additive fields before it did not.
 */
export const CHARACTER_FORMAT_VERSION = 2;

/**
 * The newest version a reader accepts — ADR 0060, ADR 0063, ADR 0064. A character with no `progress` or with
 * `removedGrants` is at least 3, one with `customFeatures` at least 4, one with `additions` 5, and nothing else is
 * raised.
 */
export const LATEST_CHARACTER_FORMAT_VERSION = 5;

/** Raise a character to a format version a write needs. Nothing downgrades one. */
export function raiseFormatVersion(character: Character, version: CharacterFormatVersion): Character {
  return character.formatVersion >= version ? character : { ...character, formatVersion: version };
}

/**
 * Set where a character is on its progression, or forget it — ADR 0060.
 *
 * `undefined` removes the recorded value, which means "where the kind says it starts": a creature's printed
 * challenge rating. Removing one raises the character to format 3, because a reader of 2 requires it.
 */
export function setProgress(character: Character, progress: number | undefined): Character {
  if (progress !== undefined) return { ...character, progress, updatedAt: new Date().toISOString() };
  const { progress: _removed, ...rest } = character;
  return { ...raiseFormatVersion(rest, 3), updatedAt: new Date().toISOString() };
}

export interface CreateCharacterOptions {
  name?: string;
  kind?: string;
  /** Where the character starts. `null` records none, for a kind whose progression starts where content prints it. */
  progress?: number | null;
}

export function createCharacter(
  systemId: string,
  kind: string,
  options: CreateCharacterOptions = {},
): Character {
  const character: Character = {
    formatVersion: CHARACTER_FORMAT_VERSION,
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
  return options.progress === null ? setProgress(character, undefined) : character;
}

export function getChoice(character: Character, ruleKey: string): Choice | undefined {
  return character.choices.find((c) => c.ruleKey === ruleKey);
}

/** Rename a character. An input like any other — nothing derives what a player calls them. */
export function setName(character: Character, name: string): Character {
  return { ...character, name, updatedAt: new Date().toISOString() };
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
/**
 * Set a starting value the user chose — an ability score, most often (ADR 0014).
 *
 * A *base*, not an override: contributions still land on top, so a racial +2 is not
 * discarded. Passing `undefined` removes it, which is what "clear this and let the kind's
 * default stand" means.
 */
export function setBaseStat(
  character: Character,
  stat: StatKey,
  value: number | undefined,
): Character {
  const baseStats = { ...character.baseStats };
  if (value === undefined) delete baseStats[stat];
  else baseStats[stat] = value;
  const empty = Object.keys(baseStats).length === 0;
  return {
    ...character,
    baseStats: empty ? undefined : baseStats,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Replace which element each point of progression was spent on — ADR 0015.
 *
 * `undefined` or an empty list removes the field, which is what "this character has one track"
 * means: a character without `advancement` behaves as a single-tracked one, and an empty array
 * would say the same thing in a way every reader has to know about.
 */
export function setAdvancement(
  character: Character,
  advancement: AdvancementEntry[] | undefined,
): Character {
  return {
    ...character,
    advancement: advancement?.length ? advancement : undefined,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Take away an element a held element's setter names, or give it back — ADR 0061.
 *
 * Recording a removal raises the character to format 3. Giving the last one back leaves the field absent and the
 * version where it is: nothing downgrades one.
 */
export function setGrantRemoved(character: Character, elementId: ElementId, removed: boolean): Character {
  const current = character.removedGrants ?? [];
  const next = removed
    ? current.includes(elementId)
      ? current
      : [...current, elementId]
    : current.filter((id) => id !== elementId);
  const { removedGrants: _previous, ...rest } = character;
  const written: Character = next.length ? { ...raiseFormatVersion(rest, 3), removedGrants: next } : rest;
  return { ...written, updatedAt: new Date().toISOString() };
}

/**
 * Add a custom feature, or replace the one with its id — ADR 0063. Recording one raises the character to format 4.
 * The feature's position is kept when it is replaced, because the first of two that set one stat is the one used.
 */
export function setCustomFeature(character: Character, feature: CustomFeature): Character {
  const current = character.customFeatures ?? [];
  const at = current.findIndex((f) => f.id === feature.id);
  const next = at < 0 ? [...current, feature] : current.map((f, i) => (i === at ? feature : f));
  return { ...raiseFormatVersion(character, 4), customFeatures: next, updatedAt: new Date().toISOString() };
}

/**
 * Remove a custom feature — ADR 0063. Removing the last leaves the field absent and the version where it is:
 * nothing downgrades one.
 */
export function removeCustomFeature(character: Character, featureId: string): Character {
  const next = (character.customFeatures ?? []).filter((f) => f.id !== featureId);
  const { customFeatures: _previous, ...rest } = character;
  return { ...rest, ...(next.length ? { customFeatures: next } : {}), updatedAt: new Date().toISOString() };
}

/**
 * Put an element on the character, or take it off — ADR 0064. Adding one already added changes nothing; recording one
 * raises the character to format 5, and taking the last off leaves the field absent and the version where it is.
 */
export function setAdded(character: Character, elementId: ElementId, added: boolean): Character {
  const current = character.additions ?? [];
  if (added === current.includes(elementId)) return character;
  const next = added ? [...current, elementId] : current.filter((id) => id !== elementId);
  const { additions: _previous, ...rest } = character;
  const written: Character = next.length ? { ...raiseFormatVersion(rest, 5), additions: next } : rest;
  return { ...written, updatedAt: new Date().toISOString() };
}

/** What the user added to the character, in the order added — ADR 0064. */
export function addedElementIds(character: Character): ElementId[] {
  return [...new Set(character.additions ?? [])];
}

/** A new custom feature's id: unique within the character, and never reused while it has any. */
export function newCustomFeatureId(character: Character): string {
  const taken = new Set((character.customFeatures ?? []).map((f) => f.id));
  let id = cryptoRandomId();
  while (taken.has(id)) id = cryptoRandomId();
  return id;
}

/** Whether the user has explicitly said to skip this decision — ADR 0033. */
export function isDeclined(character: Character, decisionId: string): boolean {
  return character.declinedDecisions?.includes(decisionId) ?? false;
}

/**
 * Skip a non-blocking decision, or bring a skipped one back.
 *
 * Deliberately not a write to `choices`: `setChoice(character, id, [])` already means
 * "forget this answer", which is indistinguishable from "never answered" and would leave
 * the decision recomputed as pending the moment anything re-derives. Declining has to
 * survive a re-derive without looking like an answer, so it is its own list.
 */
export function setDeclined(
  character: Character,
  decisionId: string,
  declined: boolean,
): Character {
  const current = character.declinedDecisions ?? [];
  const next = declined
    ? current.includes(decisionId)
      ? current
      : [...current, decisionId]
    : current.filter((id) => id !== decisionId);
  return {
    ...character,
    declinedDecisions: next.length ? next : undefined,
    updatedAt: new Date().toISOString(),
  };
}

/** The recorded prepared list of one block, by its lowercased name — ADR 0046. Empty when there is none. */
export function getPrepared(character: Character, blockKey: string): ElementId[] {
  return character.prepared?.[blockKey.trim().toLowerCase()] ?? [];
}

/**
 * Replace one block's recorded prepared list — ADR 0046.
 *
 * Duplicates are dropped, keeping the first, and an empty list removes the block's entry (and the field
 * when nothing is left), so a character that never prepared anything is byte-identical to one that
 * prepared something and put it back. Writes only what it is given: whether an element may be prepared is
 * the builder's question (it needs content) and how many is the derivation's (it needs a limit).
 */
export function setPrepared(
  character: Character,
  blockKey: string,
  elementIds: ElementId[],
): Character {
  const key = blockKey.trim().toLowerCase();
  const prepared = { ...character.prepared };
  const unique = [...new Set(elementIds)];
  if (unique.length) prepared[key] = unique;
  else delete prepared[key];
  return {
    ...character,
    prepared: Object.keys(prepared).length ? prepared : undefined,
    updatedAt: new Date().toISOString(),
  };
}

/** Every element id on any recorded prepared list, once. The container embeds these (ADR 0012). */
export function preparedElementIds(character: Character): ElementId[] {
  const ids: ElementId[] = [];
  for (const list of Object.values(character.prepared ?? {})) {
    for (const id of list) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Record which generation method a budgeted build step used — ADR 0017. */
export function setGenerationMethod(
  character: Character,
  stepId: string,
  methodId: string | undefined,
): Character {
  const generation = { ...character.generation };
  if (methodId === undefined) delete generation[stepId];
  else generation[stepId] = methodId;
  const empty = Object.keys(generation).length === 0;
  return {
    ...character,
    generation: empty ? undefined : generation,
    updatedAt: new Date().toISOString(),
  };
}

/** Mint an id for a new bag entry. The importer uses Aurora's `identifier` instead. */
export function newInstanceId(): string {
  return cryptoRandomId();
}

export function getInventoryEntry(
  character: Character,
  instanceId: string,
): InventoryEntry | undefined {
  return character.inventory?.find((entry) => entry.instanceId === instanceId);
}

/**
 * Add an entry, or replace the one with the same `instanceId` **in place** — a re-equipped
 * item should not jump to the bottom of the bag.
 *
 * This is the one mutator that moves `formatVersion`, because it is the one that makes the
 * file need a reader that understands inventories (ADR 0024). Nothing downgrades it.
 */
export function setInventoryEntry(character: Character, entry: InventoryEntry): Character {
  const existing = character.inventory ?? [];
  const at = existing.findIndex((e) => e.instanceId === entry.instanceId);
  const inventory =
    at === -1 ? [...existing, entry] : existing.map((e, i) => (i === at ? entry : e));
  return {
    ...character,
    formatVersion: CHARACTER_FORMAT_VERSION,
    inventory,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Drop an entry and its adornments with it. An empty bag becomes absent rather than `[]`, so
 * a character that never had one is byte-identical to one that had an item and lost it.
 */
export function removeInventoryEntry(character: Character, instanceId: string): Character {
  const inventory = (character.inventory ?? []).filter((e) => e.instanceId !== instanceId);
  return {
    ...character,
    inventory: inventory.length ? inventory : undefined,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Every element the bag names — entries and their adornments, **equipped or not**.
 *
 * The seed `collectCharacterContent` needs, and the reason it is not filtered to what is
 * equipped: a save whose carried Frost Brand cannot be read is a broken save under ADR 0012.
 * Only the derivation cares which items are in play; the container cares about all of them.
 */
export function inventoryElementIds(character: Character): ElementId[] {
  const ids: ElementId[] = [];
  for (const entry of character.inventory ?? []) {
    if (!ids.includes(entry.elementId)) ids.push(entry.elementId);
    for (const adornment of entry.adorners ?? []) {
      if (!ids.includes(adornment.elementId)) ids.push(adornment.elementId);
    }
  }
  return ids;
}

/**
 * Every element the **equipped** entries name — those entries and their adornments.
 *
 * The derivation's half of the asymmetry `inventoryElementIds` documents: the container
 * embeds the whole bag, and only what is worn or wielded joins the derivation. That is
 * measured, not assumed — all 26 equipped items across a set of real saves are in Aurora's
 * own `<sum>` and 18 of 19 carried ones are not, the apparent exception being a second
 * instance of an element id that is equipped elsewhere.
 *
 * An adornment follows its host in both directions: a Frost Brand on a *carried* greatsword
 * contributes nothing, which is also what Aurora says — the 2 adorners outside its `<sum>`
 * both hang off carried items.
 *
 * `quantity` is not read. Ten arrows are one seed, as ADR 0024 decision 2 settled in advance.
 */
export function equippedElementIds(character: Character): ElementId[] {
  const ids: ElementId[] = [];
  for (const entry of character.inventory ?? []) {
    if (!entry.equipped) continue;
    if (!ids.includes(entry.elementId)) ids.push(entry.elementId);
    for (const adornment of entry.adorners ?? []) {
      if (!ids.includes(adornment.elementId)) ids.push(adornment.elementId);
    }
  }
  return ids;
}

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
    if (character.progress !== undefined && entry.at > character.progress) continue;
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
