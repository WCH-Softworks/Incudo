/**
 * A character made into another of its system's kinds, and every record that does not survive it, worded — ADR 0134.
 *
 * Many characters imported from Aurora as player characters are really creatures a DM built with a player character's
 * tools. Rebuilding each by hand is not reasonable, and changing `kind` alone is not honest: a record the new kind does
 * not read would sit in the file doing nothing, or worse, keep seeding the derivation (a recorded choice outside every
 * pool always counts, ADR 0096). So the conversion keeps exactly the inputs the target kind can read and names the rest.
 *
 * Nothing here names a kind or a game. What survives is decided by comparing each record with what the target kind
 * declares: its element types and build steps (choices), its progression (progress, advancement), its level rolls and
 * budgets (rolls, typed values, methods), its inventory and starting equipment (bag, purse, packages), its preparation,
 * attacks, freeform fields, written features, additions, references, play trackers and stats. A choice whose pool only
 * something now gone opened is found the way the engine finds it, by deriving the result as the new kind
 * (`DerivedCharacter.uncounted`), so the rule is the engine's and not a second copy of it.
 *
 * The one thing a conversion may write that was not an input before is a typed value (ADR 0006's `baseStats`): a number
 * the old kind worked out and the new kind lets the user type, copied so the new sheet reads what the old one showed.
 * Each is offered (`copies`), chosen by the caller, and worded as a copy. Nothing records that the character was
 * converted: a converted character is an ordinary character of its new kind, and no format number moves for it beyond
 * what its records already need (ADR 0130).
 *
 * It reads only the character, the system and an element index: with no source loaded, what the save embeds names
 * everything the conversion drops (ADR 0012).
 */

import {
  advancementCounts,
  clampProgress,
  customFeatureStats,
  customFeatureType,
  customFeatureTypes,
  deriveCharacter,
  initialProgress,
  progressCanBePrinted,
  progressionStat,
  raiseFormatVersion,
  resolveCharacterKind,
  type Character,
  type CustomStatLine,
  type DerivedCharacter,
  type ElementId,
  type ElementIndex,
  type GameSystem,
  type Progression,
  type ResolvedCharacterKind,
  type StatKey,
} from '@incudo/core';

import { budgetRollKey } from './budget.ts';
import { formatProgress, progressLabel } from './character-kinds.ts';
import { loadedName } from './build-view.ts';
import { hitPointRollKey } from './hitpoints.ts';
import { formatCoins } from './money.ts';

/** One heading of what a conversion drops or changes, and its lines, as the confirmation lists them. */
export interface ConversionGroup {
  heading: string;
  lines: string[];
}

/** A number the old kind worked out that the new kind lets the user type, offered to be copied as that typed value. */
export interface ConversionCopy {
  stat: StatKey;
  /** The stat as the new kind labels it: "Armor Class". */
  label: string;
  /** What the old sheet showed. */
  value: number;
  /** What the new kind gives it without the copy. */
  without: number;
  /** The step of the new kind it is typed in: "Armor Class, Hit Points and Speed". */
  step: string;
  /** Whether this conversion copied it. */
  copied: boolean;
}

export interface KindConversion {
  /** The converted character, of the target kind. An unsaved edit until the shell saves it. */
  character: Character;
  /** The two kinds' names. */
  from: string;
  to: string;
  /** What is not kept, by heading, in the order the character records them. Empty when nothing is lost. */
  lost: ConversionGroup[];
  /** What is kept but changed: a feature held as another type, a number copied as a typed value. */
  changed: string[];
  /** Every number that could be copied, whether this conversion copied it or not. */
  copies: ConversionCopy[];
  /** Every dropped pick the new kind can be given, whether this conversion added it or not. */
  additions: ConversionAddition[];
}

/** A pick whose pool the new kind does not have, of a type the new kind can be given (ADR 0064), offered as an addition. */
export interface ConversionAddition {
  elementId: ElementId;
  name: string;
  /** What it was chosen under: "Cantrips (Wizard)". */
  from: string;
  /** Whether this conversion added it. */
  added: boolean;
}

export interface KindConversionOptions {
  /** The copies to make, by stat. Absent: every one offered. */
  copy?: readonly StatKey[];
  /** The dropped picks to keep as additions, by id. Absent: every one offered. */
  add?: readonly ElementId[];
}

/** The kinds a character of `kindId` can be made into: every other kind the system declares, by id and name. */
export function kindConversionTargets(system: GameSystem, kindId: string): Array<{ id: string; name: string }> {
  return system.characterKinds
    .filter((def) => def.id !== kindId)
    .map((def) => ({ id: def.id, name: resolveCharacterKind(system, def.id).name }));
}

/** The confirmation's title and lead: what is about to happen, in words. */
export function conversionPrompt(conversion: KindConversion, name: string): { title: string; lead: string; confirm: string } {
  const who = name.trim() ? `“${name.trim()}”` : 'This character';
  const lead = conversion.lost.length
    ? `${who} will be changed to ${conversion.to}. What ${conversion.to} does not record is not kept:`
    : `${who} will be changed to ${conversion.to}. Everything it records is kept.`;
  return { title: `Change to ${conversion.to}?`, lead, confirm: `Change to ${conversion.to}` };
}

/** What follows the lists: that nothing is written until Save. */
export const CONVERSION_UNSAVED_NOTE =
  'The file in the library does not change until you save. Until then the change is an unsaved edit, and you can still discard it.';

/** The line a copy is listed by in the confirmation, whether it is ticked or not. */
export function copyLine(copy: ConversionCopy): string {
  return `${copy.label}: type ${formatNumber(copy.value)}, as the old sheet showed (it would read ${formatNumber(copy.without)})`;
}

/**
 * `character` made into a `toKindId`, with what is lost and changed worded. Pure: nothing is written, and calling it
 * again with other `copy` choices gives the conversion with those.
 *
 * Throws on a kind the system does not declare, or on the kind the character already is.
 */
export function convertCharacterKind(
  character: Character,
  system: GameSystem,
  toKindId: string,
  elements: ElementIndex,
  options: KindConversionOptions = {},
): KindConversion {
  if (character.kind === toKindId) throw new Error(`The character is already a ${toKindId}.`);
  const from = resolveCharacterKind(system, character.kind);
  const to = resolveCharacterKind(system, toKindId);
  const before = deriveCharacter(character, system, elements);
  const name = (id: ElementId): string => loadedName(elements, id);
  const lost = new Lost();
  const changed: string[] = [];

  let out: Character = structuredClone(character);
  out.kind = to.id;

  convertProgress(out, before, from, to, lost);
  if (out.progress === undefined && character.progress !== undefined) out = raiseFormatVersion(out, 3);
  const picks: DroppedPick[] = [];
  convertChoices(out, from, to, elements, picks);
  convertRolls(out, from, to, lost);
  convertTypedValues(out, system, from, to, lost);
  convertCarried(out, system, to, name, lost);
  convertPreparation(out, to, picks);
  convertAttacks(out, to, name, lost);
  convertFreeform(out, from, to, lost);
  out = convertWrittenFeatures(out, from, to, lost, changed);
  convertAdditions(out, to, elements, name, lost);
  convertReferences(out, to, elements, name, lost);
  convertPlay(out, to, lost);
  convertRemovals(out, to, name, lost);

  // What only something now gone opened: found by deriving the result as the new kind, the engine's own rule.
  dropClosedPicks(out, system, before, elements, picks);
  const additions = keepAsAdditions(out, to, elements, picks, options.add, lost, changed);
  if (additions.some((a) => a.added)) out = raiseFormatVersion(out, 5);
  dropMissingBlocks(out, system, elements, name, changed);

  const copies = offerCopies(out, system, before, to, elements);
  const wanted = options.copy === undefined ? undefined : new Set(options.copy.map((s) => s.toLowerCase()));
  for (const copy of copies) copy.copied = wanted === undefined || wanted.has(copy.stat.toLowerCase());
  applyCopies(out, system, elements, copies.filter((c) => c.copied), changed);

  return { character: out, from: from.name, to: to.name, lost: lost.groups(), changed, copies, additions };
}

/**
 * The conversion a confirmation shows: to `to`, every copy and addition it offers ticked but those the user unticked.
 * Offered ones are read from a conversion that makes every one, so unticking one never hides it.
 */
export function convertUnticking(
  character: Character,
  system: GameSystem,
  to: string,
  elements: ElementIndex,
  unticked: { copies?: readonly StatKey[]; additions?: readonly ElementId[] } = {},
): KindConversion {
  const offered = convertCharacterKind(character, system, to, elements);
  const skipCopies = new Set((unticked.copies ?? []).map((s) => s.toLowerCase()));
  const skipAdditions = new Set(unticked.additions ?? []);
  if (!offered.copies.some((c) => skipCopies.has(c.stat.toLowerCase())) && !offered.additions.some((a) => skipAdditions.has(a.elementId))) {
    return offered;
  }
  return convertCharacterKind(character, system, to, elements, {
    copy: offered.copies.filter((c) => !skipCopies.has(c.stat.toLowerCase())).map((c) => c.stat),
    add: offered.additions.filter((a) => !skipAdditions.has(a.elementId)).map((a) => a.elementId),
  });
}

/** The headings of the confirmation's two lists of boxes. */
export const CONVERSION_COPIES_HEADING = 'Numbers to type, so the new sheet reads what the old one showed';
export const CONVERSION_ADDITIONS_HEADING = 'Picks to keep as added elements, since nothing it still has chooses them';

/** Headings in the order they are first written, each with its lines. */
class Lost {
  private readonly map = new Map<string, string[]>();
  add(heading: string, line: string): void {
    const lines = this.map.get(heading) ?? [];
    lines.push(line);
    this.map.set(heading, lines);
  }
  groups(): ConversionGroup[] {
    return [...this.map].map(([heading, lines]) => ({ heading, lines }));
  }
}

const formatNumber = (value: number): string => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));

function statLabel(kind: ResolvedCharacterKind, stat: StatKey): string {
  const def = kind.stats.find((s) => s.name.toLowerCase() === stat.toLowerCase());
  return def?.label ?? stat;
}

function sameProgression(a: Progression, b: Progression): boolean {
  if (a.kind !== b.kind) return false;
  return (progressionStat(a) ?? '').toLowerCase() === (progressionStat(b) ?? '').toLowerCase();
}

function convertProgress(out: Character, before: DerivedCharacter, from: ResolvedCharacterKind, to: ResolvedCharacterKind, lost: Lost): void {
  const fromLabel = progressLabel(from);
  const toLabel = progressLabel(to);
  if (sameProgression(from.progression, to.progression)) {
    if (out.progress !== undefined) out.progress = clampProgress(to.progression, out.progress);
  } else {
    if (fromLabel !== undefined && before.progress !== undefined) {
      const start = formatProgress(initialProgress(to.progression));
      const where =
        toLabel === undefined
          ? `${to.name} records none`
          : progressCanBePrinted(to)
            ? `${toLabel} starts where what it is built on prints one, or at ${start}`
            : `${toLabel} starts at ${start}`;
      lost.add('Progression', `${fromLabel} ${formatProgress(before.progress.value)}: ${where}`);
    }
    if (to.progression.kind === 'none' || progressCanBePrinted(to)) delete out.progress;
    else out.progress = clampProgress(to.progression, initialProgress(to.progression));
  }

  const keepsTracks =
    to.progression.kind === 'level' &&
    from.progression.kind === 'level' &&
    (to.progression.trackType ?? '') === (from.progression.trackType ?? '') &&
    sameProgression(from.progression, to.progression);
  if (out.advancement?.length && !keepsTracks) {
    const counts = [...advancementCounts(out)].map(([id, n]) => `${loadedNameOf(before, id)} ${n}`);
    lost.add('Progression', `How its ${(fromLabel ?? 'progression').toLowerCase()} was spent: ${counts.join(', ')}`);
    delete out.advancement;
  }
}

/** A held element's name as the old derivation knew it, for an advancement entry. */
function loadedNameOf(before: DerivedCharacter, id: ElementId): string {
  return before.elements.find((e) => e.id === id)?.name ?? id;
}

/** "Fighting Style" from `ID_X/select:Fighting Style`, the build step's label from `build/<step>`. */
function choiceLabel(ruleKey: string, kind: ResolvedCharacterKind): string {
  if (ruleKey.startsWith('build/')) {
    const step = kind.buildSteps.find((s) => s.id === ruleKey.slice('build/'.length));
    if (step) return step.label;
  }
  const at = ruleKey.indexOf('/select:');
  return at >= 0 ? ruleKey.slice(at + '/select:'.length) : ruleKey;
}

function convertChoices(
  out: Character,
  from: ResolvedCharacterKind,
  to: ResolvedCharacterKind,
  elements: ElementIndex,
  picks: DroppedPick[],
): void {
  const types = new Set(to.elementTypes);
  const fits = (id: ElementId, allowed: ReadonlySet<string>): boolean => {
    const element = elements.get(id);
    return element === undefined || allowed.has(element.type);
  };
  out.choices = out.choices.filter((choice) => {
    let allowed: ReadonlySet<string> = types;
    let keep = true;
    if (choice.ruleKey.startsWith('build/')) {
      const step = to.buildSteps.find((s) => s.id === choice.ruleKey.slice('build/'.length));
      if (!step) keep = false;
      else if (step.types.length) allowed = new Set(step.types.filter((t) => types.has(t)));
    }
    if (keep) keep = choice.elementIds.every((id) => fits(id, allowed));
    if (!keep && choice.elementIds.length) {
      picks.push({ label: choiceLabel(choice.ruleKey, from), ids: [...choice.elementIds] });
    }
    return keep;
  });
}

/** Drop the picks the new kind's derivation no longer counts because their pool closed, and that counted before. */
function dropClosedPicks(
  out: Character,
  system: GameSystem,
  before: DerivedCharacter,
  elements: ElementIndex,
  picks: DroppedPick[],
): void {
  const already = new Set(before.uncounted.map((u) => `${u.ruleKey}\u0000${u.elementId}`));
  const kind = before.kind;
  for (let pass = 0; pass < 8; pass += 1) {
    const derived = deriveCharacter(out, system, elements);
    const closed = derived.uncounted.filter((u) => u.reason === 'closed' && !already.has(`${u.ruleKey}\u0000${u.elementId}`));
    if (!closed.length) return;
    const byKey = new Map<string, number[]>();
    for (const u of closed) byKey.set(u.ruleKey, [...(byKey.get(u.ruleKey) ?? []), u.position]);
    out.choices = out.choices.flatMap((choice) => {
      const positions = byKey.get(choice.ruleKey);
      if (!positions) return [choice];
      const gone = choice.elementIds.filter((_, i) => positions.includes(i));
      picks.push({ label: choiceLabel(choice.ruleKey, kind), ids: gone });
      const kept = choice.elementIds.filter((_, i) => !positions.includes(i));
      return kept.length ? [{ ...choice, elementIds: kept }] : [];
    });
  }
}

/** Picks a conversion takes out of `choices`, by what they were chosen under. */
interface DroppedPick {
  /** The heading it is lost under when it is not kept: "Choices", "Prepared". */
  heading?: string;
  label: string;
  ids: ElementId[];
}

/**
 * Offer every dropped pick the new kind can be given as an addition, add the ones asked for, and word the rest as lost.
 * Not one already held some other way, nor one the character already has added, nor an element a pick repeats.
 */
function keepAsAdditions(
  out: Character,
  to: ResolvedCharacterKind,
  elements: ElementIndex,
  picks: readonly DroppedPick[],
  wanted: readonly ElementId[] | undefined,
  lost: Lost,
  changed: string[],
): ConversionAddition[] {
  const types = new Set(to.additions?.types ?? []);
  const kept = new Set([...out.choices.flatMap((c) => c.elementIds), ...(out.additions ?? [])]);
  const offered: ConversionAddition[] = [];
  const seen = new Set<ElementId>();
  for (const pick of picks) {
    for (const id of pick.ids) {
      const element = elements.get(id);
      if (!element || !types.has(element.type) || kept.has(id) || seen.has(id)) continue;
      seen.add(id);
      offered.push({ elementId: id, name: element.name, from: pick.label, added: wanted === undefined || wanted.includes(id) });
    }
  }
  const added = offered.filter((a) => a.added);
  if (added.length) {
    out.additions = [...(out.additions ?? []), ...added.map((a) => a.elementId)];
    changed.push(`Kept as added elements, since nothing it still has chooses them: ${added.map((a) => a.name).join(', ')}`);
  }
  const addedIds = new Set(added.map((a) => a.elementId));
  for (const pick of picks) {
    const gone = pick.ids.filter((id) => !addedIds.has(id));
    if (gone.length) lost.add(pick.heading ?? 'Choices', `${pick.label}: ${gone.map((id) => loadedName(elements, id)).join(', ')}`);
  }
  return offered;
}

function convertRolls(out: Character, from: ResolvedCharacterKind, to: ResolvedCharacterKind, lost: Lost): void {
  const keeps = (key: string): boolean =>
    to.buildSteps.some((step) => {
      if (step.levelRoll && to.progression.kind === 'level') {
        const pattern = new RegExp(`^${step.levelRoll.pattern.split('{n}').map(escapeRegExp).join('\\d+')}$`);
        if (pattern.test(key)) return true;
      }
      return step.budget !== undefined && key.startsWith(budgetRollKey(step.id, 0).replace(/0$/, ''));
    }) ||
    (to.startingEquipment !== undefined && key.startsWith('build/equipment/') && key.endsWith('/wealth'));
  const dropped = new Map<string, number>();
  for (const key of Object.keys(out.rolls)) {
    if (keeps(key)) continue;
    const label = rollLabel(key, from);
    dropped.set(label, (dropped.get(label) ?? 0) + 1);
    delete out.rolls[key];
  }
  for (const [label, count] of dropped) lost.add('Rolls', `${label}: ${count === 1 ? 'one recorded roll' : `${count} recorded rolls`}`);
}

function rollLabel(key: string, kind: ResolvedCharacterKind): string {
  for (const step of kind.buildSteps) {
    if (step.levelRoll) {
      const pattern = new RegExp(`^${step.levelRoll.pattern.split('{n}').map(escapeRegExp).join('\\d+')}$`);
      if (pattern.test(key)) return step.label;
    }
    if (step.budget && key.startsWith(budgetRollKey(step.id, 0).replace(/0$/, ''))) return step.label;
  }
  if (key.startsWith('build/equipment/')) return 'Starting wealth';
  return 'Other';
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The new kind's budget targets, by lowercased stat, with the step each is typed in. */
function budgetTargets(kind: ResolvedCharacterKind): Map<string, { step: ResolvedCharacterKind['buildSteps'][number] }> {
  const out = new Map<string, { step: ResolvedCharacterKind['buildSteps'][number] }>();
  for (const step of kind.buildSteps) for (const target of step.budget?.targets ?? []) out.set(target.toLowerCase(), { step });
  return out;
}

function convertTypedValues(out: Character, system: GameSystem, from: ResolvedCharacterKind, to: ResolvedCharacterKind, lost: Lost): void {
  const targets = budgetTargets(to);
  if (out.baseStats) {
    for (const [stat, value] of Object.entries(out.baseStats)) {
      if (targets.has(stat.toLowerCase())) continue;
      lost.add('Typed values', `${statLabel(from, stat)} ${formatNumber(value)}`);
      delete out.baseStats[stat];
    }
    if (!Object.keys(out.baseStats).length) delete out.baseStats;
  }
  if (out.generation) {
    for (const [stepId, method] of Object.entries(out.generation)) {
      const step = to.buildSteps.find((s) => s.id === stepId && s.budget);
      const offered = step?.budget?.methods ?? system.generationMethods?.map((m) => m.id) ?? [];
      if (step && offered.includes(method)) continue;
      const label = system.generationMethods?.find((m) => m.id === method)?.label ?? method;
      const fromStep = from.buildSteps.find((s) => s.id === stepId)?.label ?? stepId;
      lost.add('Typed values', `${fromStep}: that they were made by ${label}`);
      delete out.generation[stepId];
    }
    if (!Object.keys(out.generation).length) delete out.generation;
  }
  if (out.overrides) {
    const declared = new Set(to.stats.map((s) => s.name.toLowerCase()));
    for (const [stat, value] of Object.entries(out.overrides)) {
      if (declared.has(stat.toLowerCase())) continue;
      lost.add('Typed values', `${statLabel(from, stat)} fixed at ${value}`);
      delete out.overrides[stat];
    }
    if (!Object.keys(out.overrides).length) delete out.overrides;
  }
}

function convertCarried(out: Character, system: GameSystem, to: ResolvedCharacterKind, name: (id: ElementId) => string, lost: Lost): void {
  if (!to.inventory) {
    for (const entry of out.inventory ?? []) {
      const adorned = (entry.adorners ?? []).map((a) => name(a.elementId));
      const label = entry.name?.trim() || name(entry.elementId);
      const quantity = (entry.quantity ?? 1) > 1 ? ` ×${entry.quantity}` : '';
      lost.add('Carried', `${label}${adorned.length ? ` (${adorned.join(', ')})` : ''}${quantity}`);
    }
    delete out.inventory;
    const coins = formatCoins(out.money, system);
    if (coins) lost.add('Carried', `Money: ${coins}`);
    delete out.money;
  }
  if (!to.startingEquipment && out.startingEquipment?.length) {
    lost.add('Carried', `Which starting equipment was taken, for ${out.startingEquipment.map((t) => name(t.for)).join(', ')}`);
    delete out.startingEquipment;
  }
}

/** A prepared list the new kind has no preparation for: its spells are offered as additions, like a dropped pick. */
function convertPreparation(out: Character, to: ResolvedCharacterKind, picks: DroppedPick[]): void {
  if (to.preparation || !out.prepared) return;
  for (const [block, ids] of Object.entries(out.prepared)) {
    if (ids.length) picks.push({ heading: 'Prepared', label: titleWords(block), ids: [...ids] });
  }
  delete out.prepared;
}

function convertAttacks(out: Character, to: ResolvedCharacterKind, name: (id: ElementId) => string, lost: Lost): void {
  if (to.attacks?.spells || !out.spellAttacks) return;
  const ids = Object.keys(out.spellAttacks);
  if (ids.length) lost.add('Attack settings', ids.map(name).join(', '));
  delete out.spellAttacks;
}

const titleWords = (text: string): string => text.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());

function convertFreeform(out: Character, from: ResolvedCharacterKind, to: ResolvedCharacterKind, lost: Lost): void {
  const kept = new Set((to.freeform?.fields ?? []).map((f) => f.key));
  const fromFields = new Map((from.freeform?.fields ?? []).map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(out.freeform)) {
    if (kept.has(key)) continue;
    const field = fromFields.get(key);
    // A key neither kind declares was never shown and stays as it was: keeping it loses nothing.
    if (!field) continue;
    if (value.trim()) lost.add('Text', field.label);
    delete out.freeform[key];
  }
}

function lineWords(line: CustomStatLine, label: string): string {
  if (line.mode === 'set') return `sets ${label} to ${formatNumber(line.value)}`;
  if (line.mode === 'mark') return `marks ${label}`;
  return `${line.value < 0 ? 'takes' : 'adds'} ${formatNumber(Math.abs(line.value))} ${line.value < 0 ? 'from' : 'to'} ${label}`;
}

function convertWrittenFeatures(
  out: Character,
  from: ResolvedCharacterKind,
  to: ResolvedCharacterKind,
  lost: Lost,
  changed: string[],
): Character {
  if (!out.customFeatures?.length) return out;
  if (!to.customFeatures) {
    for (const feature of out.customFeatures) lost.add('Written features', feature.name);
    delete out.customFeatures;
    return out;
  }
  const types = customFeatureTypes(to);
  const stats = new Map(customFeatureStats(to).map((s) => [s.stat.toLowerCase(), s]));
  let typed = false;
  out.customFeatures = out.customFeatures.map((feature) => {
    const was = customFeatureType(feature, from) ?? feature.type ?? from.customFeatures?.type;
    const next = { ...feature, stats: [...feature.stats] };
    if (was !== undefined && types.includes(was)) {
      if (was === to.customFeatures!.type) delete next.type;
      else {
        next.type = was;
        typed = true;
      }
    } else {
      delete next.type;
      changed.push(`${feature.name} is held as a ${to.customFeatures!.type}${was ? `, not a ${was}` : ''}`);
    }
    next.stats = feature.stats.filter((line) => {
      const def = stats.get(line.stat.toLowerCase());
      const ok = def !== undefined && (line.mode === 'add' || (line.mode === 'set' && def.settable) || (line.mode === 'mark' && def.mark !== undefined));
      if (!ok) lost.add('Written features', `${feature.name}: the line that ${lineWords(line, statLabel(from, line.stat))}`);
      return ok;
    });
    return next;
  });
  return typed ? raiseFormatVersion(out, 6) : out;
}

function convertAdditions(out: Character, to: ResolvedCharacterKind, elements: ElementIndex, name: (id: ElementId) => string, lost: Lost): void {
  if (!out.additions?.length) return;
  const types = new Set(to.additions?.types ?? []);
  const castTypes = new Set(to.additions?.blocks?.types ?? []);
  out.additions = out.additions.filter((id) => {
    const element = elements.get(id);
    const keep = to.additions !== undefined && (element === undefined || types.has(element.type));
    if (!keep) lost.add('Added', name(id));
    return keep;
  });
  if (out.additionBlocks) {
    for (const [id, block] of Object.entries(out.additionBlocks)) {
      const element = elements.get(id);
      if (out.additions.includes(id) && (element === undefined || castTypes.has(element.type))) continue;
      if (out.additions.includes(id)) lost.add('Added', `${name(id)}: that it is cast as ${titleWords(block)}`);
      delete out.additionBlocks[id];
    }
    if (!Object.keys(out.additionBlocks).length) delete out.additionBlocks;
  }
  if (!out.additions.length) delete out.additions;
}

function dropMissingBlocks(out: Character, system: GameSystem, elements: ElementIndex, name: (id: ElementId) => string, changed: string[]): void {
  if (!out.additionBlocks) return;
  const derived = deriveCharacter(out, system, elements);
  for (const problem of derived.problems) {
    if (problem.code !== 'addition-block-missing' || problem.elementId === undefined) continue;
    const block = out.additionBlocks[problem.elementId];
    if (block === undefined) continue;
    changed.push(`${name(problem.elementId)} is cast through no class it has, not as ${titleWords(block)}`);
    delete out.additionBlocks[problem.elementId];
  }
  if (!Object.keys(out.additionBlocks).length) delete out.additionBlocks;
}

function convertReferences(out: Character, to: ResolvedCharacterKind, elements: ElementIndex, name: (id: ElementId) => string, lost: Lost): void {
  if (!out.references?.length) return;
  const types = new Set(to.references?.types ?? []);
  out.references = out.references.filter((id) => {
    const element = elements.get(id);
    const keep = to.references !== undefined && (element === undefined || types.has(element.type));
    if (!keep) lost.add('For reference', name(id));
    return keep;
  });
  if (!out.references.length) delete out.references;
}

function convertPlay(out: Character, to: ResolvedCharacterKind, lost: Lost): void {
  const play = out.play;
  if (!play) return;
  const trackers = new Set((to.play?.trackers ?? []).map((t) => t.id));
  const conditions = new Set(to.play?.conditions?.names ?? []);
  const tracked = (key: string): boolean => trackers.has(key.split('/')[0]!);
  for (const field of ['spent', 'temporary'] as const) {
    const record = play[field];
    if (!record) continue;
    for (const key of Object.keys(record)) {
      if (tracked(key)) continue;
      lost.add('Play', `What is spent of ${key.split('/')[0]}`);
      delete record[key];
    }
    if (!Object.keys(record).length) delete play[field];
  }
  if (play.conditions) {
    for (const condition of play.conditions.filter((c) => !conditions.has(c))) lost.add('Play', condition);
    play.conditions = play.conditions.filter((c) => conditions.has(c));
    if (!play.conditions.length) delete play.conditions;
  }
  if (!Object.keys(play).length) delete out.play;
}

function convertRemovals(out: Character, to: ResolvedCharacterKind, name: (id: ElementId) => string, lost: Lost): void {
  if (!out.removedGrants?.length || to.setterGrants.length) return;
  for (const id of out.removedGrants) lost.add('Taken away', `${name(id)}, which would be given back if what gave it is held again`);
  delete out.removedGrants;
}

/** Every budget target of the new kind whose number the old kind worked out and the new one would read differently. */
function offerCopies(out: Character, system: GameSystem, before: DerivedCharacter, to: ResolvedCharacterKind, elements: ElementIndex): ConversionCopy[] {
  const after = deriveCharacter(out, system, elements);
  const copies: ConversionCopy[] = [];
  for (const [stat, { step }] of budgetTargets(to)) {
    const old = before.stats.get(stat);
    const now = after.stats.get(stat);
    if (!old || old.text !== undefined || !Number.isFinite(old.value)) continue;
    const without = now?.value ?? 0;
    if (old.value === without) continue;
    const methods = (step.budget?.methods ?? []).map((id) => system.generationMethods?.find((m) => m.id === id)).filter((m) => m !== undefined);
    if (methods.length && methods.every((m) => (m.min !== undefined && old.value < m.min) || (m.max !== undefined && old.value > m.max))) continue;
    const declared = to.stats.find((s) => s.name.toLowerCase() === stat);
    copies.push({ stat: declared?.name ?? stat, label: declared?.label ?? stat, value: old.value, without, step: step.label, copied: false });
  }
  return copies;
}

/**
 * Type each copy so the new sheet reads what the old one showed: what content adds to a typed value is taken off it,
 * found by deriving and correcting, since a typed value is where a stat starts and contributions add to it.
 */
function applyCopies(out: Character, system: GameSystem, elements: ElementIndex, copies: readonly ConversionCopy[], changed: string[]): void {
  if (!copies.length) return;
  out.baseStats = { ...(out.baseStats ?? {}) };
  for (const copy of copies) out.baseStats[copy.stat] = copy.value;
  for (let pass = 0; pass < 4; pass += 1) {
    const derived = deriveCharacter(out, system, elements);
    let moved = false;
    for (const copy of copies) {
      const got = derived.stats.get(copy.stat.toLowerCase())?.value ?? 0;
      if (got === copy.value) continue;
      out.baseStats[copy.stat] = out.baseStats[copy.stat]! + (copy.value - got);
      moved = true;
    }
    if (!moved) break;
  }
  for (const copy of copies) {
    const typed = out.baseStats[copy.stat]!;
    changed.push(
      typed === copy.value
        ? `${copy.label} is typed as ${formatNumber(copy.value)}, copied from the old sheet, not worked out`
        : `${copy.label} is typed as ${formatNumber(typed)}, so that with what is added it reads ${formatNumber(copy.value)}, as the old sheet showed`,
    );
  }
}
