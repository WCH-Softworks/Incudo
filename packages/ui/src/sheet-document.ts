/**
 * The sheet as one document, which the Sheet pane and every export read — ADR 0075.
 *
 * ADR 0074 made a kind's sheet a view-model; the Sheet pane also drew a character's held creatures (ADR 0073) and what
 * it keeps for reference (ADR 0068), and composed three sentences of its own on the way. This gathers all of it, in the
 * pane's order, with those sentences written here: the pane renders it and composes nothing, and the Markdown export
 * (`sheet-markdown.ts`) renders the same value, as a print layout or a PDF would. What a sheet shows is decided once.
 *
 * A pure function of the builder's state: it looks nothing up, which is why it is the same with no source (ADR 0012).
 * A kept element's text stays HTML as `expandDescription` made it, not yet safe to render; each renderer turns it into
 * what it draws. Kind-agnostic: every label, stat and type comes from the system.
 */

import type { Character, ElementId } from '@incudo/core';

import { sheetFreeform, type FreeformState, type SheetFreeform } from './freeform.ts';
import type { ReferenceRow, ReferencesState } from './references.ts';
import type { CompanionsView } from './companions.ts';
import type { SheetAttack, SheetListedElement, SheetRow, SheetSectionView, SheetView } from './sheet.ts';

/** What is written beside an element the user added whose prerequisites are unmet (ADR 0064). */
export const PREREQUISITES_UNMET = 'prerequisites not met';

/**
 * What a listed element is called on a sheet: the shorter name content gives it there (ADR 0076), else its name, with
 * the count of the track it roots when its section writes one, "Paladin 3" (ADR 0079). The pane and every export name
 * an element this way.
 */
export function listedName(element: Pick<SheetListedElement, 'name' | 'sheetName' | 'progress'>): string {
  const name = element.sheetName ?? element.name;
  return element.progress !== undefined ? `${name} ${element.progress}` : name;
}

/** A listed element's dice as a sheet writes them (ADR 0079), "3d10", or nothing. */
export function listedDice(element: Pick<SheetListedElement, 'dice'>): string | undefined {
  return element.dice ? `${element.dice.count}d${element.dice.sides}` : undefined;
}

/**
 * What a sheet writes in parentheses after a listed element's name: its track's dice, its group and its prepared mark
 * (ADR 0079), and what an added element is cast through (ADR 0097): "3d10", "Level 1, prepared", "Cantrip", "Level 1,
 * always prepared, cast as Wizard", any alone, or nothing. The pane and every export word a listed
 * element this way.
 */
export function listedAside(element: Pick<SheetListedElement, 'dice' | 'group' | 'prepared' | 'cast'>): string | undefined {
  const parts = [listedDice(element), element.group?.label, element.prepared?.label, element.cast].filter((part): part is string => part !== undefined && part !== '');
  return parts.length ? parts.join(', ') : undefined;
}

/**
 * What using a listed element takes and how often, as a sheet writes it beside the name: "Bonus Action; 3/Long Rest",
 * either alone, or nothing when content says neither (ADR 0076).
 */
export function listedUsage(element: Pick<SheetListedElement, 'action' | 'usage'>): string | undefined {
  const parts = [element.action, element.usage].filter((part): part is string => part !== undefined && part !== '');
  return parts.length ? parts.join('; ') : undefined;
}

/**
 * A listed element's head as one line: its name, then what follows it (`listedAside`), the unmet prerequisites, and what
 * using it takes (`listedUsage`), each in parentheses: "Rage (Bonus Action; 3/Long Rest)", "Paladin 3 (3d10)". The
 * Markdown export writes it so (escaping each part and bolding the name it is given) and a form filler writes it plain.
 */
export function listedHead(
  element: SheetListedElement,
  name: string = listedName(element),
  escape: (text: string) => string = (text) => text,
): string {
  const aside = listedAside(element);
  const usage = listedUsage(element);
  return `${name}${aside !== undefined ? ` (${escape(aside)})` : ''}${element.prerequisitesUnmet ? ` (${PREREQUISITES_UNMET})` : ''}${usage !== undefined ? ` (${escape(usage)})` : ''}`;
}

/**
 * What a sheet writes in parentheses after a row's value: what the section shows beside it and the row's mark (ADR
 * 0079), then what moved it that the sheet lists nowhere (ADR 0095): "18 (+4)", "+7 (expertise)", "45 (including
 * Tough)", "+2 (including Jack of All Trades)", or nothing. The pane and every export word a row this way.
 */
export function rowAside(row: Pick<SheetRow, 'beside' | 'mark' | 'including'>): string | undefined {
  const parts = [row.beside, row.mark?.label].filter((part): part is string => part !== undefined && part !== '');
  const shown = parts.length ? parts.join(', ') : undefined;
  if (!row.including?.length) return shown;
  const including = `including ${joinNames(row.including)}`;
  return shown === undefined ? including : `${shown}; ${including}`;
}

/** "A", "A and B", "A, B and C". */
function joinNames(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What a sheet writes after an attack's damage (ADR 0093): each other die it may be rolled with, its range and its
 * properties, "two-handed 1d10+3 slashing; Versatile", "range 150/600; Ammunition, Heavy, Two-Handed", or nothing.
 */
export function attackAside(attack: Pick<SheetAttack, 'alternatives' | 'range' | 'properties'>): string | undefined {
  const parts = [
    ...attack.alternatives.map((alternative) => `${alternative.label} ${alternative.damage}`),
    ...(attack.range !== undefined ? [`range ${attack.range}`] : []),
    ...(attack.properties.length ? [attack.properties.join(', ')] : []),
  ];
  return parts.length ? parts.join('; ') : undefined;
}

/**
 * An attack as one line: its name, its bonus and damage, and what follows them in parentheses, "Longsword: +6, 1d8+3
 * slashing (two-handed 1d10+3 slashing; Versatile)". The pane, the phone and every export word an attack this way; the
 * Markdown escapes each part and bolds the name it is given.
 */
export function attackHead(attack: SheetAttack, name: string = attack.name, escape: (text: string) => string = (text) => text): string {
  const aside = attackAside(attack);
  return `${name}: ${escape(`${attack.bonus}, ${attack.damage}`)}${aside !== undefined ? ` (${escape(aside)})` : ''}`;
}

/** The title of a character whose name is blank. */
export const UNNAMED_CHARACTER = 'Unnamed character';

/** What a kept element with no text says in its place. */
export const NO_KEPT_TEXT = 'It has no text to show.';

/** One creature the character holds, as its own stat block. */
export interface SheetDocumentCreature {
  elementId: ElementId;
  name: string;
  source?: string;
  /** "From Find Familiar": what the character holds that gave it, when anything named it. */
  from?: string;
  /** What its stat block could not show, in plain words. */
  notes: string[];
  sections: SheetSectionView[];
}

/** One element the character keeps beside it: its text, or a sentence saying why there is none. */
export interface SheetDocumentReference {
  elementId: ElementId;
  name: string;
  source?: string;
  /** Its text, with what it embeds in place (ADR 0069). HTML, not yet safe to render. */
  html?: string;
  /** Said instead of the text, when there is none to show. */
  note?: string;
}

export interface SheetDocument {
  /** The character's name as the user wrote it. */
  name: string;
  /**
   * What a sheet is headed with: the name trimmed, or `UNNAMED_CHARACTER` when it is blank. The Markdown's first heading,
   * a printed page's heading and, while it prints, the page's own title (ADR 0077): said once, here.
   */
  title: string;
  kindName: string;
  /** How many elements the derivation holds, internal ones included: the pane's lede shows it, an export does not. */
  elementCount: number;
  /** The character's own sections, empty ones left out. */
  sections: SheetSectionView[];
  /** Its held creatures, when the kind declares them and it holds any. */
  companions?: { label: string; description?: string; creatures: SheetDocumentCreature[] };
  /**
   * What the user wrote about it, the fields with text in the kind's order, when anything is written — ADR 0092. After
   * the held creatures and before what it keeps, on every sheet.
   */
  freeform?: SheetFreeform;
  /** What it keeps beside it, when it keeps anything. */
  references?: { label: string; entries: SheetDocumentReference[] };
}

/** What the document is read from: the builder's state, or the parts of it a sheet shows. */
export interface SheetDocumentSource {
  character: Pick<Character, 'name'>;
  sheet: SheetView;
  companions?: CompanionsView;
  references: Pick<ReferencesState, 'label' | 'rows'>;
  /** Required, so a caller picking parts cannot leave it out (the phone's sheet did, until it was run). */
  freeform: FreeformState;
}

export function sheetDocument(state: SheetDocumentSource): SheetDocument {
  const { sheet, companions, references } = state;
  const freeform = sheetFreeform(state.freeform);
  return {
    name: state.character.name,
    title: state.character.name.trim() || UNNAMED_CHARACTER,
    kindName: sheet.kindName,
    elementCount: sheet.elementCount,
    sections: sheet.sections,
    ...(companions
      ? {
          companions: {
            label: companions.label,
            ...(companions.description !== undefined ? { description: companions.description } : {}),
            creatures: companions.creatures.map(
              (creature): SheetDocumentCreature => ({
                elementId: creature.elementId,
                name: creature.name,
                ...(creature.source ? { source: creature.source } : {}),
                ...(creature.heldBy.length ? { from: `From ${creature.heldBy.join(', ')}` } : {}),
                notes: creature.notes,
                sections: creature.sections,
              }),
            ),
          },
        }
      : {}),
    ...(freeform ? { freeform } : {}),
    ...(references.rows.length ? { references: { label: references.label, entries: references.rows.map(referenceEntry) } } : {}),
  };
}

/**
 * A kept element as a sheet shows it: its text when it is shown and has any, else the row's own sentence, or
 * `NO_KEPT_TEXT`. The Build pane's list of kept elements shows the same.
 */
export function referenceEntry(row: ReferenceRow): SheetDocumentReference {
  const base = { elementId: row.elementId, name: row.name, ...(row.source ? { source: row.source } : {}) };
  if (!row.shown) return { ...base, note: row.note ?? NO_KEPT_TEXT };
  const html = row.description ?? '';
  return hasText(html) ? { ...base, html } : { ...base, note: NO_KEPT_TEXT };
}

/** Whether markup holds any text once its tags are gone. */
function hasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() !== '';
}
