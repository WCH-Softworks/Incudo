/**
 * A sheet, as it is drawn — ADR 0074.
 *
 * A kind declares its sheet as sections (ADR 0009); core's `renderSheetSection` decides which rows, printed lines and
 * types each shows (ADRs 0020, 0062). This is the rest: what each row is called, how its value is written, what is
 * shown beside it, which held elements are listed, and which sections have nothing to draw. The character's own Sheet
 * and each held creature's stat block (ADR 0073) are built by the same function, so the Sheet pane draws rows and
 * computes nothing, and an export (Phase 5) can start from rows rather than from a component. Kind-agnostic: every
 * label, stat and type comes from the system.
 *
 * A listed element carries what content writes for the sheet (ADR 0076): a shorter name, the description for the
 * level it gates at with its `{{stat}}` placeholders filled from the derivation, and its usage and action. Core reads
 * the hints (`sheetDescriptionAt`, `sheetPlaceholders`, `halfReference`); this writes the numbers as the sheet
 * writes them.
 */

import {
  collectDeclaredBlocks,
  compareSheetGroups,
  evaluateExpr,
  halfReference,
  preparedListIds,
  preparedState,
  renderSheetSection,
  sheetDescriptionAt,
  sheetGroup,
  sheetListedElements,
  sheetPlaceholders,
  statReferences,
  trackDie,
  trackProgress,
  type BlockStatDef,
  type DerivedAttack,
  type DerivedCharacter,
  type Element,
  type ElementId,
  type PreparedBlock,
  type PrintedSheetLine,
  type Progression,
  type ResolvedCharacterKind,
  type ResolvedStat,
  type SheetGroup,
  type SheetReader,
  type SheetSectionDef,
  type StatDef,
} from '@incudo/core';

import { entryName, entryNeedsAttunement, takenOnBuild } from './inventory.ts';
import { purseRows, type PurseRow } from './money.ts';

/** One row: a stat, what it is called, its value as written, and what is shown beside it when the section says. */
export interface SheetRow {
  stat: string;
  label: string;
  value: string;
  beside?: string;
  /**
   * What the row is marked, when the section declares a mark and the row has one (ADR 0079): "proficient", "expertise".
   * `count` is how many times the mark's stat holds its `per`, at least 1.
   */
  mark?: { label: string; count: number };
  /**
   * What moved the row's number that the sheet lists nowhere (ADR 0095): each element a section declaring `omitHidden`
   * leaves out, by its sheet name, when it contributes to the row's stat or to a stat the kind works the row out from.
   * Not what the row's mark already says. "Hit Points: 45 (including Tough)".
   */
  including?: string[];
}

/**
 * A row's mark (ADR 0079): how many whole times `value` holds `per`, called by the label for that many, the last label
 * standing for any more. None when it holds none or `per` is not a positive number.
 */
export function rowMark(value: number | undefined, per: number | undefined, labels: readonly string[]): SheetRow['mark'] {
  if (value === undefined || per === undefined || !(per > 0) || !labels.length) return undefined;
  // A ratio of whole numbers written as a float (14 / 7) is read whole; measured, every row reads 0, 1 or 2.
  const count = Math.floor(value / per + 1e-9);
  if (count < 1) return undefined;
  return { label: labels[Math.min(count, labels.length) - 1]!, count };
}

/**
 * One held element a section lists, marked when the user added it with its prerequisites unmet (ADR 0064), with what
 * content writes for it on a sheet (ADR 0076), each field only when content wrote one.
 */
export interface SheetListedElement {
  elementId: ElementId;
  name: string;
  /**
   * Its element type, as content names it: what a reader of the document tells a section's kinds of element apart by (a
   * form filler putting a race in one box and a class in another, ADR 0079). Always set by `sheetSections`.
   */
  type?: string;
  prerequisitesUnmet?: true;
  /** The shorter name content gives it on a sheet ("Turn Undead"), when that differs from its name. */
  sheetName?: string;
  /**
   * Its sheet text at the level it gates at, placeholders filled, one line per line content wrote (`\n` between, none
   * blank, none indented). Each line is inline HTML as content wrote it (an entity, an `<i>`), not yet safe to render:
   * each renderer sanitizes or converts it, and keeps the line breaks.
   */
  text?: string;
  /** How often it may be used ("3/Long Rest", "Channel Divinity"), filled. Plain text. */
  usage?: string;
  /** What using it takes ("Bonus Action"). Plain text. */
  action?: string;
  /** The stats its text, usage or action names and nothing publishes, each written as "—" in their place. */
  unfilled?: string[];
  /** The section's own line under it (ADR 0112), filled: what a held creature's holder adds to its action. */
  note?: string;
  /**
   * The count of the track it roots, when its section writes one (`trackProgress`, ADR 0079): a class's level, 3 in
   * "Paladin 3". What the derivation published, never recomputed.
   */
  progress?: number;
  /**
   * The track's dice, when its section writes them (`trackDie`, ADR 0079): its count of the die the element's setter
   * names, 3 and 10 in "Paladin 3 (3d10)". Only beside `progress`, and only when the count is positive and the setter a die.
   */
  dice?: { count: number; sides: number };
  /**
   * The group it is listed in, when its section groups (`group`, ADR 0079): a spell's level, `{ value: "0", label:
   * "Cantrip" }`. The section lists its elements in group order.
   */
  group?: SheetGroup;
  /**
   * Whether the character's prepared lists hold it, when its section marks them (`preparedMark`, ADR 0079): `always`
   * when content keeps it on a list, else the player's choice; `label` is what the system calls that.
   */
  prepared?: { label: string; always: boolean };
  /**
   * Which block an element the user added is cast through, in the kind's words ("cast as Wizard", "cast through no
   * class"), for an addition of a type the kind casts through one (ADR 0097). Absent for anything else.
   */
  cast?: string;
}

/**
 * One attack, as a sheet writes it (ADR 0093): its bonus signed, its damage as the die content writes with the modifier
 * after it and the type, "1d8+3 slashing", and the same for each other die it may be rolled with.
 */
export interface SheetAttack {
  /** The bag entry; absent for a row the kind always has (ADR 0110). */
  instanceId?: string;
  elementId?: ElementId;
  /** A row the kind always has, no item giving it: an unarmed strike (ADR 0110). */
  innate?: true;
  name: string;
  /** Whether it is worn or wielded rather than carried. Both are listed. */
  equipped: boolean;
  /** "+6". */
  bonus: string;
  /** "1d8+3 slashing", or "—" when content writes no die. */
  damage: string;
  /** "two-handed" and "1d10+3 slashing". */
  alternatives: Array<{ label: string; damage: string }>;
  /** As content writes it: "150/600". */
  range?: string;
  /** "Ammunition", "Heavy": by name, in order of name. */
  properties: string[];
  /** What a spell's row still lacks, in plain words (ADR 0111): its damage, or the class it is cast as. */
  notes?: string[];
}

/** A spell row with no class to read its numbers from (ADR 0111). */
export const SPELL_NO_CLASS = 'choose the class it is cast as on Build, under Spells';
/** A spell row whose damage nothing states and the user has not chosen (ADR 0111). */
export const SPELL_NO_DAMAGE = 'its damage is chosen on Build, under Spells';
/** A spell row the user said rolls nothing (ADR 0111). */
export const SPELL_ROLLS_NOTHING = 'no damage';

/** One section with nothing left to decide. */
/** One bag entry as a sheet lists it (ADR 0098): its name as the inventory shows it, how many, and how it is carried. */
export interface SheetBagEntry {
  instanceId: string;
  elementId: ElementId;
  name: string;
  quantity: number;
  equipped: boolean;
  /** Attuned, and only when the item or its adornment requires it. */
  attuned: boolean;
}

export interface SheetSectionView {
  id: string;
  label: string;
  /**
   * The id of the sheet section this came from, and the casting block it is for when that section is `perBlock` (whose
   * `id` then names the block too): what a reader of the document finds a section and a block by (ADR 0079).
   */
  section?: string;
  block?: string;
  description?: string;
  /** The section's elements' whole descriptions go in the Descriptions part (ADR 0114). */
  describe?: true;
  rows: SheetRow[];
  printed: PrintedSheetLine[];
  elements: SheetListedElement[];
  /** The character's attacks, when the section lists them (ADR 0093). */
  attacks?: SheetAttack[];
  /** The character's bag, entry by entry, when the section lists it (ADR 0098). */
  bag?: SheetBagEntry[];
  /** The coins held, most worth first, when the section lists the bag and the purse holds any. */
  purse?: PurseRow[];
}

/** The character's own sheet: its kind and its sections, empty ones left out. */
export interface SheetView {
  kindName: string;
  sections: SheetSectionView[];
  /**
   * How many placeholders its own sections' listed elements name that nothing publishes (ADR 0076): 0 when all fill. A
   * held creature's are counted on its own view (`CompanionView.unfilled`).
   */
  unfilled: number;
}

/** What a sheet reads: the stats and the held elements of one derivation, the character's or a creature's scope. */
export interface SheetSource {
  stats: ReadonlyMap<string, ResolvedStat>;
  elements: readonly Element[];
  /**
   * The level each held element's own rules read (`DerivedCharacter.gateLevels`), which chooses its sheet text. An
   * element it does not name reads its ungated text.
   */
  gateLevels?: ReadonlyMap<ElementId, number>;
  /**
   * What the character's prepared lists hold (`DerivedCharacter.preparation`, ADR 0046), for a section that marks them
   * (ADR 0079). A creature's scope has none.
   */
  preparation?: readonly PreparedBlock[];
  /**
   * An element by id, for what a prepared list holds and the derivation does not (a list preparer's spells): the
   * builder's index, which puts a save's embedded content first. Without it such an element is not listed.
   */
  lookup?: (id: ElementId) => Element | undefined;
  /** The character's attacks (`DerivedCharacter.attacks`, ADR 0093), for a section that lists them. A creature's scope has none. */
  attacks?: readonly DerivedAttack[];
  /** What each added element of a cast type is cast through, worded (`additionCasting`, ADR 0097). A creature's scope has none. */
  cast?: ReadonlyMap<ElementId, string>;
  /** The character's bag, for a section that lists it (ADR 0098). A creature's scope has none. */
  bag?: readonly SheetBagEntry[];
  /** Every unit the system declares with what the character holds, for a section that lists the bag. */
  purse?: readonly PurseRow[];
  /** Every element the bag's entries and their adornments name: what a section listing the bag does not list again. */
  bagIds?: readonly ElementId[];
}

/**
 * How rows are called and written: the stats a sheet may show, and the block stats a per-block row comes from. A row
 * is called by its stat's label, a per-block row by its block stat's; one nothing labels is called by its key, which
 * no shipped system leaves (a user's may).
 */
export interface SheetVocabulary {
  stats: readonly StatDef[];
  blockStats: readonly BlockStatDef[];
  /** Where a track's count is published, for a section that writes one (ADR 0079). A creature's scope has none. */
  progression?: Progression;
}

/**
 * A stat's value as a sheet writes it: its text when it is text (an empty one is "—"), a bonus with its sign, a number
 * as it is, and "—" for a stat nothing published.
 */
export function formatStatValue(stat: ResolvedStat | undefined, signed: boolean): string {
  if (!stat) return '—';
  if (stat.text !== undefined) return stat.text.trim() === '' ? '—' : stat.text;
  if (signed && stat.value >= 0) return `+${stat.value}`;
  return String(stat.value);
}

/**
 * What the kind's sheet shows beside a stat, wherever else the stat is shown: the first section that lists it and
 * declares `beside` (ADR 0074), its `{stat}` filled with the stat and the value written as the sheet writes it — a
 * score's modifier, "+3". Undefined when no section shows anything beside it. The build's score editor reads it, so
 * the number beside a score there is the derivation's own and the same as the sheet's.
 */
export function statBeside(kind: ResolvedCharacterKind, stats: ReadonlyMap<string, ResolvedStat>, stat: string): string | undefined {
  const key = stat.toLowerCase();
  const section = kind.sheet.sections.find(
    (s) => !s.perBlock && s.beside !== undefined && (s.stats ?? []).some((listed) => listed.toLowerCase() === key),
  );
  if (!section) return undefined;
  const besideKey = section.beside!.replaceAll('{stat}', stat).toLowerCase();
  const resolved = stats.get(besideKey);
  if (!resolved) return undefined;
  const def = kind.stats.find((s) => s.name.toLowerCase() === besideKey);
  return formatStatValue(resolved, def?.signed === true);
}

/**
 * An attack's damage as a sheet writes it (ADR 0093): the die as content writes it, the modifier after it with its sign
 * (none when 0), and the type, "1d8+3 slashing". No die is "—", or the modifier alone when there is one.
 */
export function attackDamage(dice: string | undefined, modifier: number, type: string | undefined): string {
  const sign = modifier > 0 ? `+${modifier}` : modifier < 0 ? String(modifier) : '';
  const amount = dice !== undefined ? `${dice}${sign}` : sign;
  if (amount === '') return '—';
  return type ? `${amount} ${type}` : amount;
}

/**
 * A spell's row as a sheet writes it (ADR 0111): an attack's bonus or a saving throw's "DC 13 Dexterity", "—" with no
 * class; its dice, "1d8 or 1d12 necrotic" when there are two, "no damage" when it rolls nothing; and what it still lacks.
 */
function sheetSpellAttack(attack: DerivedAttack, spell: NonNullable<DerivedAttack['spell']>): SheetAttack {
  const notes: string[] = [];
  let bonus: string;
  if (spell.block === undefined) {
    bonus = '—';
    notes.push(SPELL_NO_CLASS);
  } else if (spell.kind === 'attack') {
    bonus = attack.bonus >= 0 ? `+${attack.bonus}` : String(attack.bonus);
  } else {
    bonus = [`DC ${spell.dc ?? 0}`, ...(spell.ability ? [spell.ability] : [])].join(' ');
  }
  let damage: string;
  if (attack.dice !== undefined) {
    const dice = [attack.dice, ...(spell.orDice ?? [])].join(' or ');
    damage = attack.damageType ? `${dice} ${attack.damageType}` : dice;
  } else if (spell.dice === 'chosen') {
    damage = SPELL_ROLLS_NOTHING;
  } else {
    damage = '—';
    notes.push(SPELL_NO_DAMAGE);
  }
  return {
    ...(attack.elementId !== undefined ? { elementId: attack.elementId } : {}),
    name: attack.name,
    equipped: attack.equipped,
    bonus,
    damage,
    alternatives: [],
    ...(attack.range !== undefined ? { range: attack.range } : {}),
    properties: [],
    ...(notes.length ? { notes } : {}),
  };
}

/** An attack as a sheet writes it. */
export function sheetAttack(attack: DerivedAttack): SheetAttack {
  if (attack.spell) return sheetSpellAttack(attack, attack.spell);
  return {
    ...(attack.instanceId !== undefined ? { instanceId: attack.instanceId } : {}),
    ...(attack.elementId !== undefined ? { elementId: attack.elementId } : {}),
    ...(attack.innate ? { innate: true as const } : {}),
    name: attack.name,
    equipped: attack.equipped,
    bonus: attack.bonus >= 0 ? `+${attack.bonus}` : String(attack.bonus),
    damage: attackDamage(attack.dice, attack.damageBonus, attack.damageType),
    alternatives: attack.alternatives.map((alternative) => ({
      label: alternative.label,
      // A variant (an off-hand row, ADR 0110) adds its own; another die adds the attack's.
      damage: attackDamage(alternative.dice, alternative.damageBonus ?? attack.damageBonus, attack.damageType),
    })),
    ...(attack.range !== undefined ? { range: attack.range } : {}),
    properties: attack.properties,
  };
}

/** What `fillPlaceholders` wrote, and the stats it could not. */
export interface FilledText {
  text: string;
  unfilled: string[];
}

/**
 * A sheet text with each `{{stat}}` replaced by the stat's value as the sheet writes it, unsigned ("3/Long Rest"): its
 * text when it is text, else its number, a `:half` or `:half:up` suffix read by the expression code that reads it in
 * a rule (ADR 0046). A stat nothing publishes is written "—" and named in `unfilled`, never guessed (ADR 0005).
 * `html` escapes what is written in, for a text that is HTML.
 */
export function fillPlaceholders(text: string, stats: ReadonlyMap<string, ResolvedStat>, html = false): FilledText {
  const found = sheetPlaceholders(text);
  if (!found.length) return { text, unfilled: [] };
  const ctx = {
    statNumber: (key: string): number => stats.get(key.toLowerCase())?.value ?? 0,
    statString: (key: string): string | undefined => stats.get(key.toLowerCase())?.text,
  };
  const unfilled: string[] = [];
  let out = '';
  let at = 0;
  for (const placeholder of found) {
    const direct = stats.get(placeholder.stat.toLowerCase());
    const half = direct ? undefined : halfReference(placeholder.stat);
    let value: string;
    if (direct) value = formatStatValue(direct, false);
    else if (half && stats.has(half.base)) value = String(evaluateExpr({ kind: 'ref', stat: placeholder.stat }, ctx));
    else {
      value = '—';
      unfilled.push(placeholder.stat);
    }
    out += text.slice(at, placeholder.start) + (html ? escapeHtml(value) : value);
    at = placeholder.end;
  }
  return { text: out + text.slice(at), unfilled };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * What content writes for an element on a sheet (ADR 0076): its shorter name, and its description at the level it
 * gates at, with that description's own usage and action over the sheet's, each filled. Nothing when it writes nothing.
 */
function sheetHintsOf(element: Element, source: SheetSource): Omit<SheetListedElement, 'elementId' | 'name' | 'prerequisitesUnmet'> {
  const hints = element.sheet;
  if (!hints) return {};
  const out: Omit<SheetListedElement, 'elementId' | 'name' | 'prerequisitesUnmet'> = {};
  const other = hints.alt || hints.name;
  if (other && other !== element.name) out.sheetName = other;
  // A hidden element's line is written for a feature list content keeps it out of. Where a section lists it anyway (a
  // header naming the class), it is named and nothing more: "Paladin", not "Paladin: A holy warrior bound to …".
  if (hints.display === false) return out;
  const description = sheetDescriptionAt(hints, source.gateLevels?.get(element.id) ?? 0);
  const unfilled: string[] = [];
  const fill = (text: string | undefined, html: boolean): string | undefined => {
    if (text === undefined || text.trim() === '') return undefined;
    const filled = fillPlaceholders(text, source.stats, html);
    unfilled.push(...filled.unfilled);
    return filled.text;
  };
  // Content writes one line of sheet text per line of the file, indented as the XML is: a line break is a break
  // ("• Bite: …", "• Claw: …"), which HTML would run together, and the indentation is the file's, not the text's.
  const lines = description?.text.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
  const text = fill(lines, true);
  const usage = fill(description?.usage ?? hints.usage, false);
  const action = fill(description?.action ?? hints.action, false);
  if (text !== undefined) out.text = text;
  if (usage !== undefined) out.usage = usage;
  if (action !== undefined) out.action = action;
  if (unfilled.length) out.unfilled = unfilled;
  return out;
}

/** The sections of a sheet drawn against one derivation. `listed` is what they may list, `unmet` what to mark. */
export function sheetSections(
  sections: readonly SheetSectionDef[],
  source: SheetSource,
  vocabulary: SheetVocabulary,
  listed: readonly Element[] = source.elements,
  unmet: ReadonlySet<ElementId> = new Set(),
): SheetSectionView[] {
  const stats = new Map<string, StatDef>();
  for (const def of vocabulary.stats) stats.set(def.name.toLowerCase(), def);
  const blockStats = new Map<string, BlockStatDef>();
  for (const def of vocabulary.blockStats) blockStats.set(def.stat.toLowerCase(), def);
  const resolved = (key: string): ResolvedStat | undefined => source.stats.get(key.toLowerCase());
  const reader: SheetReader = { statValue: (key) => resolved(key)?.value, elements: source.elements };
  const blocks = collectDeclaredBlocks(source.elements);

  const views: SheetSectionView[] = [];
  // Each row and the stat its mark reads when one is shown, for what moved it (below, once every section is drawn).
  const marked = new Map<SheetRow, string | undefined>();
  for (const section of sections) {
    for (const rendering of renderSheetSection(section, blocks, reader)) {
      const rows = rendering.stats.map((stat, at): SheetRow => {
        // A per-block row is keyed by content (`wizard:spellcasting:dc`); what it is lives on the pattern it came from.
        const def = rendering.blockName !== undefined ? blockStats.get(rendering.entries[at]!.toLowerCase()) : stats.get(stat.toLowerCase());
        const besideKey = rendering.beside?.[at];
        const markKey = rendering.mark?.[at];
        const mark = markKey && section.mark ? rowMark(resolved(markKey)?.value, resolved(section.mark.per)?.value, section.mark.labels) : undefined;
        const row: SheetRow = {
          stat,
          label: def?.label ?? stat,
          value: formatStatValue(resolved(stat), def?.signed === true),
          ...(besideKey ? { beside: formatStatValue(resolved(besideKey), stats.get(besideKey.toLowerCase())?.signed === true) } : {}),
          ...(mark ? { mark } : {}),
        };
        marked.set(row, mark ? markKey : undefined);
        return row;
      });
      // In the order the section names its types, as a printed sheet's header reads race, class, background; within a
      // type, in the order the character holds them.
      // A section that says so leaves out what content hides from a sheet's lists (ADR 0076); one naming what the
      // character is (race, class) does not, since content hides those too.
      // A section marking prepared elements also lists what a prepared list holds and the character does not (ADR
      // 0079): a list preparer prepares from every spell it could hold, and the derivation seeds none of them (ADR 0046).
      const preparation = section.preparedMark ? (source.preparation ?? []) : [];
      const listedIds = new Set(listed.map((e) => e.id));
      const unheld = preparedListIds(preparation)
        .filter((id) => !listedIds.has(id))
        .flatMap((id) => source.lookup?.(id) ?? []);
      // A section listing the bag lists its entries itself, and its types only what no entry names (ADR 0098).
      const bag = section.bag ? [...(source.bag ?? [])] : [];
      const purse = section.bag ? (source.purse ?? []).filter((row) => row.count > 0) : [];
      const inBag = new Set(section.bag ? (source.bagIds ?? []) : []);
      const shown = [...listed, ...unheld]
        .filter((e) => rendering.types.includes(e.type) && !(section.omitHidden && e.sheet?.display === false) && !inBag.has(e.id))
        .map((e) => ({ element: e, group: section.group ? sheetGroup(e, section.group) : undefined }))
        .sort((a, b) => rendering.types.indexOf(a.element.type) - rendering.types.indexOf(b.element.type));
      // A grouping section lists by group, then by name, and what is in no group after, in the order held (ADR 0079).
      if (section.group) {
        shown.sort((a, b) => compareSheetGroups(a.group, b.group) || (a.group && b.group ? a.element.name.localeCompare(b.element.name) : 0));
      }
      // The section's own line under each element (ADR 0112), the same for all of them.
      const note = section.elementNote && (section.elementNote.showWhen === undefined || (resolved(section.elementNote.showWhen)?.value ?? 0) !== 0)
        ? fillPlaceholders(section.elementNote.text, source.stats, false).text
        : undefined;
      const elements = shown.map(({ element: e, group }): SheetListedElement => {
        const progress = section.trackProgress && vocabulary.progression ? trackProgress(vocabulary.progression, e, source.stats) : undefined;
        const sides = section.trackDie !== undefined && progress !== undefined && progress > 0 ? trackDie(e, section.trackDie) : undefined;
        const prepared = section.preparedMark ? preparedState(preparation, e.id) : undefined;
        const cast = source.cast?.get(e.id);
        return {
          elementId: e.id,
          name: e.name,
          type: e.type,
          ...(unmet.has(e.id) ? { prerequisitesUnmet: true } : {}),
          ...sheetHintsOf(e, source),
          ...(progress !== undefined ? { progress } : {}),
          ...(sides !== undefined ? { dice: { count: progress!, sides } } : {}),
          ...(group ? { group } : {}),
          ...(prepared ? { prepared: { label: section.preparedMark![prepared], always: prepared === 'always' } } : {}),
          ...(cast !== undefined ? { cast } : {}),
          ...(note !== undefined ? { note } : {}),
        };
      });
      const attacks = section.attacks ? (source.attacks ?? []).map(sheetAttack) : [];
      if (!rows.length && !rendering.printed.length && !elements.length && !attacks.length && !bag.length && !purse.length) continue;
      views.push({
        id: rendering.id,
        label: rendering.label,
        section: section.id,
        ...(rendering.blockName !== undefined ? { block: rendering.blockName } : {}),
        ...(rendering.description !== undefined ? { description: rendering.description } : {}),
        ...(section.describe ? { describe: true as const } : {}),
        rows,
        printed: rendering.printed,
        elements,
        ...(attacks.length ? { attacks } : {}),
        ...(bag.length ? { bag } : {}),
        ...(purse.length ? { purse } : {}),
      });
    }
  }
  nameWhatMovedRows(views, marked, sections, source, stats);
  return views;
}

/**
 * Write beside each row what moved it that the sheet lists nowhere (ADR 0095). Left out is what a section declaring
 * `omitHidden` would list and content hides (`display="false"`), and that no section of this sheet lists anyway. Read
 * from the derivation: a contribution to the row's stat names its element (`from`), and a stat the kind derives is
 * followed into the stats its formula reads, by name only, never evaluated. A contribution of 0 moved nothing. The
 * stat a shown mark reads is not followed: "expertise" already says it.
 */
function nameWhatMovedRows(
  views: readonly SheetSectionView[],
  marked: ReadonlyMap<SheetRow, string | undefined>,
  sections: readonly SheetSectionDef[],
  source: SheetSource,
  stats: ReadonlyMap<string, StatDef>,
): void {
  const hiddenTypes = new Set(sections.filter((section) => section.omitHidden).flatMap((section) => section.types ?? []));
  if (!hiddenTypes.size) return;
  const listedAnywhere = new Set(views.flatMap((view) => view.elements.map((e) => e.elementId)));
  const omitted = new Map<ElementId, Element>();
  for (const e of source.elements) {
    if (hiddenTypes.has(e.type) && e.sheet?.display === false && !listedAnywhere.has(e.id)) omitted.set(e.id, e);
  }
  if (!omitted.size) return;
  const movedBy = (stat: string, skip: string | undefined, seen: Set<string>, into: ElementId[]): void => {
    const key = stat.toLowerCase();
    if (seen.has(key) || key === skip) return;
    seen.add(key);
    for (const c of source.stats.get(key)?.contributions ?? []) {
      if (c.value !== 0 && omitted.has(c.from) && !into.includes(c.from)) into.push(c.from);
    }
    for (const ref of statReferences(stats.get(key)?.derive)) movedBy(ref, skip, seen, into);
  };
  for (const [row, markKey] of marked) {
    const ids: ElementId[] = [];
    movedBy(row.stat, markKey?.toLowerCase(), new Set(), ids);
    if (!ids.length) continue;
    row.including = ids.map((id) => {
      const e = omitted.get(id)!;
      return e.sheet?.alt || e.sheet?.name || e.name;
    });
  }
}

/**
 * The character's own sheet: its kind's sections against its derivation, listing every held element but what its kind
 * keeps off the sheet (ADR 0072), and marking what the user added with its prerequisites unmet (ADR 0064).
 */
export function sheetView(
  derived: DerivedCharacter,
  kind: ResolvedCharacterKind,
  unmet: ReadonlySet<ElementId> = new Set(),
  lookup?: (id: ElementId) => Element | undefined,
): SheetView {
  const cast = additionCasting(derived, kind);
  const bag = kind.sheet.sections.some((s) => s.bag) ? sheetBag(derived, kind, lookup) : undefined;
  const sections = sheetSections(
    kind.sheet.sections,
    { ...derived, ...(lookup ? { lookup } : {}), ...(cast.size ? { cast } : {}), ...(bag ?? {}) },
    { stats: kind.stats, blockStats: kind.blockStats, progression: kind.progression },
    sheetListedElements(derived.elements, kind),
    unmet,
  );
  return {
    kindName: kind.name,
    sections,
    unfilled: unfilledIn(sections),
  };
}

/**
 * The bag and the purse as a sheet lists them (ADR 0098): every entry in bag order, named as the inventory names it, but
 * what an equip step took (a feature enabled by an item, ADR 0072, which content keeps off a sheet's lists), and every
 * element an entry names, so a section listing the bag does not list them twice.
 */
function sheetBag(
  derived: DerivedCharacter,
  kind: ResolvedCharacterKind,
  lookup: ((id: ElementId) => Element | undefined) | undefined,
): Pick<SheetSource, 'bag' | 'purse' | 'bagIds'> {
  const held = new Map(derived.elements.map((e) => [e.id, e]));
  const elements = { get: (id: ElementId) => lookup?.(id) ?? held.get(id) };
  const entries = derived.character.inventory ?? [];
  return {
    bag: entries.filter((entry) => !takenOnBuild(elements.get(entry.elementId), kind.buildSteps)).map((entry) => ({
      instanceId: entry.instanceId,
      elementId: entry.elementId,
      name: entryName(entry, elements, kind),
      quantity: entry.quantity ?? 1,
      equipped: entry.equipped === true,
      attuned: entry.attuned === true && entryNeedsAttunement(entry, elements, kind),
    })),
    purse: derived.system.currency ? purseRows(derived.character, derived.system) : [],
    bagIds: entries.flatMap((entry) => [entry.elementId, ...(entry.adorners ?? []).map((a) => a.elementId)]),
  };
}

/**
 * What each held addition of a type the kind casts through a block is cast through, in the kind's words — ADR 0097:
 * "cast as Wizard" for one the derivation published a block for, "cast through no class" for the rest. Empty for a kind
 * that casts nothing it adds through a block.
 */
export function additionCasting(
  derived: Pick<DerivedCharacter, 'character' | 'elements' | 'additionBlocks'>,
  kind: Pick<ResolvedCharacterKind, 'additions'>,
): Map<ElementId, string> {
  const out = new Map<ElementId, string>();
  const def = kind.additions?.blocks;
  if (!def) return out;
  const added = new Set(derived.character.additions ?? []);
  const through = new Map(derived.additionBlocks.map((b) => [b.elementId, b.block]));
  for (const element of derived.elements) {
    if (!added.has(element.id) || !def.types.includes(element.type)) continue;
    const block = through.get(element.id);
    out.set(element.id, block === undefined ? def.none : def.with.replace('{name}', block));
  }
  return out;
}

/** How many placeholders the listed elements of these sections name that nothing publishes (ADR 0076). */
export function unfilledIn(sections: readonly SheetSectionView[]): number {
  return sections.reduce((sum, section) => sum + section.elements.reduce((n, e) => n + (e.unfilled?.length ?? 0), 0), 0);
}
