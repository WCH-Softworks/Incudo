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
  evaluateExpr,
  halfReference,
  renderSheetSection,
  sheetDescriptionAt,
  sheetListedElements,
  sheetPlaceholders,
  type BlockStatDef,
  type DerivedCharacter,
  type Element,
  type ElementId,
  type PrintedSheetLine,
  type ResolvedCharacterKind,
  type ResolvedStat,
  type SheetReader,
  type SheetSectionDef,
  type StatDef,
} from '@incudo/core';

/** One row: a stat, what it is called, its value as written, and what is shown beside it when the section says. */
export interface SheetRow {
  stat: string;
  label: string;
  value: string;
  beside?: string;
}

/**
 * One held element a section lists, marked when the user added it with its prerequisites unmet (ADR 0064), with what
 * content writes for it on a sheet (ADR 0076), each field only when content wrote one.
 */
export interface SheetListedElement {
  elementId: ElementId;
  name: string;
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
}

/** One section with nothing left to decide. */
export interface SheetSectionView {
  id: string;
  label: string;
  description?: string;
  rows: SheetRow[];
  printed: PrintedSheetLine[];
  elements: SheetListedElement[];
}

/** The character's own sheet: its kind, how many elements it holds, and its sections, empty ones left out. */
export interface SheetView {
  kindName: string;
  elementCount: number;
  sections: SheetSectionView[];
  /** How many placeholders its listed elements' sheet text names that nothing publishes (ADR 0076): 0 when all fill. */
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
}

/**
 * How rows are called and written: the stats a sheet may show, and the block stats a per-block row comes from. A row
 * is called by its stat's label, a per-block row by its block stat's; one nothing labels is called by its key, which
 * no shipped system leaves (a user's may).
 */
export interface SheetVocabulary {
  stats: readonly StatDef[];
  blockStats: readonly BlockStatDef[];
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
  for (const section of sections) {
    for (const rendering of renderSheetSection(section, blocks, reader)) {
      const rows = rendering.stats.map((stat, at): SheetRow => {
        // A per-block row is keyed by content (`wizard:spellcasting:dc`); what it is lives on the pattern it came from.
        const def = rendering.blockName !== undefined ? blockStats.get(rendering.entries[at]!.toLowerCase()) : stats.get(stat.toLowerCase());
        const besideKey = rendering.beside?.[at];
        return {
          stat,
          label: def?.label ?? stat,
          value: formatStatValue(resolved(stat), def?.signed === true),
          ...(besideKey ? { beside: formatStatValue(resolved(besideKey), stats.get(besideKey.toLowerCase())?.signed === true) } : {}),
        };
      });
      // In the order the section names its types, as a printed sheet's header reads race, class, background; within a
      // type, in the order the character holds them.
      // A section that says so leaves out what content hides from a sheet's lists (ADR 0076); one naming what the
      // character is (race, class) does not, since content hides those too.
      const elements = listed
        .filter((e) => rendering.types.includes(e.type) && !(section.omitHidden && e.sheet?.display === false))
        .sort((a, b) => rendering.types.indexOf(a.type) - rendering.types.indexOf(b.type))
        .map((e): SheetListedElement => ({
          elementId: e.id,
          name: e.name,
          ...(unmet.has(e.id) ? { prerequisitesUnmet: true } : {}),
          ...sheetHintsOf(e, source),
        }));
      if (!rows.length && !rendering.printed.length && !elements.length) continue;
      views.push({
        id: rendering.id,
        label: rendering.label,
        ...(rendering.description !== undefined ? { description: rendering.description } : {}),
        rows,
        printed: rendering.printed,
        elements,
      });
    }
  }
  return views;
}

/**
 * The character's own sheet: its kind's sections against its derivation, listing every held element but what its kind
 * keeps off the sheet (ADR 0072), and marking what the user added with its prerequisites unmet (ADR 0064).
 */
export function sheetView(derived: DerivedCharacter, kind: ResolvedCharacterKind, unmet: ReadonlySet<ElementId> = new Set()): SheetView {
  const sections = sheetSections(
    kind.sheet.sections,
    derived,
    { stats: kind.stats, blockStats: kind.blockStats },
    sheetListedElements(derived.elements, kind),
    unmet,
  );
  return {
    kindName: kind.name,
    elementCount: derived.elements.length,
    sections,
    unfilled: sections.reduce((sum, section) => sum + section.elements.reduce((n, e) => n + (e.unfilled?.length ?? 0), 0), 0),
  };
}
