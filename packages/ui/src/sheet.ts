/**
 * A sheet, as it is drawn — ADR 0074.
 *
 * A kind declares its sheet as sections (ADR 0009); core's `renderSheetSection` decides which rows, printed lines and
 * types each shows (ADRs 0020, 0062). This is the rest: what each row is called, how its value is written, what is
 * shown beside it, which held elements are listed, and which sections have nothing to draw. The character's own Sheet
 * and each held creature's stat block (ADR 0073) are built by the same function, so the Sheet pane draws rows and
 * computes nothing, and an export (Phase 5) can start from rows rather than from a component. Kind-agnostic: every
 * label, stat and type comes from the system.
 */

import {
  collectDeclaredBlocks,
  renderSheetSection,
  sheetListedElements,
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

/** One held element a section lists, marked when the user added it with its prerequisites unmet (ADR 0064). */
export interface SheetListedElement {
  elementId: ElementId;
  name: string;
  prerequisitesUnmet?: true;
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
}

/** What a sheet reads: the stats and the held elements of one derivation, the character's or a creature's scope. */
export interface SheetSource {
  stats: ReadonlyMap<string, ResolvedStat>;
  elements: readonly Element[];
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
      const elements = listed
        .filter((e) => rendering.types.includes(e.type))
        .sort((a, b) => rendering.types.indexOf(a.type) - rendering.types.indexOf(b.type))
        .map((e): SheetListedElement => ({ elementId: e.id, name: e.name, ...(unmet.has(e.id) ? { prerequisitesUnmet: true } : {}) }));
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
  return {
    kindName: kind.name,
    elementCount: derived.elements.length,
    sections: sheetSections(
      kind.sheet.sections,
      derived,
      { stats: kind.stats, blockStats: kind.blockStats },
      sheetListedElements(derived.elements, kind),
      unmet,
    ),
  };
}
