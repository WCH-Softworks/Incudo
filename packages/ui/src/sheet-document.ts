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
import type { SheetDescriptions } from './sheet-descriptions.ts';
import type { SheetAttack, SheetBagEntry, SheetListedElement, SheetRow, SheetSectionView, SheetView } from './sheet.ts';
import { purseLine, type PurseRow } from './money.ts';

/** What is written beside an element the user added whose prerequisites are unmet (ADR 0064). */
export const PREREQUISITES_UNMET = 'prerequisites not met';

/**
 * What a listed element is called on a sheet: the shorter name content gives it there (ADR 0076), else its name, with
 * the count of the track it roots when its section writes one, "Paladin 3" (ADR 0079). The pane and every export name
 * an element this way.
 */
export function listedName(element: Pick<SheetListedElement, 'name' | 'sheetName' | 'progress' | 'answers' | 'answering'>): string {
  const own = element.sheetName ?? element.name;
  // Written with what chose it or what it chose (ADR 0126): "Fighting Style: Defense", "Favored Enemy: Undead".
  const name = element.answering ? `${element.answering.name}: ${own}` : own;
  const counted = element.progress !== undefined ? `${name} ${element.progress}` : name;
  return element.answers?.length ? `${counted}: ${element.answers.map((answer) => answer.name).join(', ')}` : counted;
}

/**
 * Whether a listed element is written on its section's "Also" line rather than as an entry of its own (ADR 0126): its
 * section says so (`also`), and the element has nothing but its name to show, no sheet line, usage, action, answer, mark
 * or note. Every renderer asks this, so the pane, the export and the print agree.
 */
export function listedIsNameOnly(section: Pick<SheetSectionView, 'also'>, element: SheetListedElement): boolean {
  return (
    section.also === true &&
    element.text === undefined &&
    element.usage === undefined &&
    element.action === undefined &&
    !element.answers?.length &&
    element.answering === undefined &&
    element.note === undefined &&
    element.prerequisitesUnmet === undefined &&
    listedAside(element) === undefined
  );
}

/** A section's listed elements split into those written as entries and those named on its "Also" line (ADR 0126). */
export function listedParts(section: Pick<SheetSectionView, 'also' | 'elements'>): { entries: SheetListedElement[]; also: SheetListedElement[] } {
  const entries: SheetListedElement[] = [];
  const also: SheetListedElement[] = [];
  for (const element of section.elements) (listedIsNameOnly(section, element) ? also : entries).push(element);
  return { entries, also };
}

/** What a section's "Also" line is headed with. */
export const ALSO_LABEL = 'Also';

/** The "Also" line's names, "Researcher, Military Rank", or nothing. */
export function alsoText(also: readonly SheetListedElement[]): string | undefined {
  return also.length ? also.map((element) => listedName(element)).join(', ') : undefined;
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
export function listedAside(
  element: Pick<SheetListedElement, 'dice' | 'group' | 'prepared' | 'cast' | 'facts'>,
  withFacts = true,
): string | undefined {
  const parts = [listedDice(element), element.group?.label, element.prepared?.label, element.cast].filter((part): part is string => part !== undefined && part !== '');
  // A section's facts follow, each its own part, since a fact may hold a comma ("V, S, M") (ADR 0126).
  const facts = withFacts ? listedFacts(element) : undefined;
  const head = parts.length ? parts.join(', ') : undefined;
  return head !== undefined && facts !== undefined ? `${head}; ${facts}` : (head ?? facts);
}

/** A listed element's facts as a sheet writes them on paper (ADR 0126): "1 action; 120 feet; Instantaneous; V, S". */
export function listedFacts(element: Pick<SheetListedElement, 'facts'>): string | undefined {
  return element.facts?.length ? element.facts.map((fact) => fact.text).join('; ') : undefined;
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
 * What a row still lacks, each a sentence saying where it is set: "Damage not set: choose its dice on Build, under
 * Spells". A renderer shows them as warnings apart from the aside; the text export writes them after it.
 */
export function attackWarnings(attack: Pick<SheetAttack, 'notes'>): readonly string[] {
  return attack.notes ?? [];
}

/** A bag entry's name with how many, "Arrows ×20" (ADR 0098): the pane, the phone, the export and the form write it so. */
export function bagEntryName(entry: Pick<SheetBagEntry, 'name' | 'quantity'>): string {
  return entry.quantity > 1 ? `${entry.name} ×${entry.quantity}` : entry.name;
}

/** What follows a bag entry's name in parentheses: "equipped", "equipped, attuned", "attuned", or nothing (carried). */
export function bagEntryAside(entry: Pick<SheetBagEntry, 'equipped' | 'attuned'>): string | undefined {
  const parts = [...(entry.equipped ? ['equipped'] : []), ...(entry.attuned ? ['attuned'] : [])];
  return parts.length ? parts.join(', ') : undefined;
}

/** A bag entry in one line, "Chain Mail (equipped)". */
export function bagEntryHead(entry: SheetBagEntry): string {
  const aside = bagEntryAside(entry);
  return `${bagEntryName(entry)}${aside !== undefined ? ` (${aside})` : ''}`;
}

/** What the purse line is called on a sheet. */
export const MONEY_LABEL = 'Money';

/** The coins a sheet lists, "15 gp, 3 sp". */
export function purseText(purse: readonly PurseRow[]): string {
  return purseLine(purse);
}

/**
 * An attack as one line: its name, its bonus and damage, and what follows them in parentheses, "Longsword: +6, 1d8+3
 * slashing (two-handed 1d10+3 slashing; Versatile)". The pane, the phone and every export word an attack this way; the
 * Markdown escapes each part and bolds the name it is given.
 */
export function attackHead(attack: SheetAttack, name: string = attack.name, escape: (text: string) => string = (text) => text): string {
  const aside = attackAside(attack);
  const warnings = attackWarnings(attack);
  return (
    `${name}: ${escape(`${attack.bonus}, ${attack.damage}`)}${aside !== undefined ? ` (${escape(aside)})` : ''}` +
    (warnings.length ? `. ${escape(warnings.join('. '))}.` : '')
  );
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
  /**
   * How the sheet is laid out (ADR 0126), and its main column's tabs: what a renderer draws areas and tabs from. Absent,
   * one column. `sections` are in the layout's order either way.
   */
  layout?: SheetView['layout'];
  tabs?: SheetView['tabs'];
  /** The character's own sections, empty ones left out. */
  sections: SheetSectionView[];
  /** Its held creatures, when the kind declares them and it holds any. */
  companions?: { label: string; description?: string; creatures: SheetDocumentCreature[] };
  /**
   * What the user wrote about it, the fields with text in the kind's order, when anything is written — ADR 0092. After
   * the held creatures and before what it keeps, on every sheet.
   */
  freeform?: SheetFreeform;
  /**
   * The whole descriptions of what the describing sections list (ADR 0114), after what the user wrote and before what it
   * keeps, when any section describes an element with a description.
   */
  descriptions?: SheetDescriptions;
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
  /** The whole descriptions (ADR 0114); required for the same reason, undefined when there are none. */
  descriptions: SheetDescriptions | undefined;
}

export function sheetDocument(state: SheetDocumentSource): SheetDocument {
  const { sheet, companions, references } = state;
  const freeform = sheetFreeform(state.freeform);
  return {
    name: state.character.name,
    title: state.character.name.trim() || UNNAMED_CHARACTER,
    kindName: sheet.kindName,
    ...(sheet.layout ? { layout: sheet.layout, tabs: sheet.tabs ?? [] } : {}),
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
    ...(state.descriptions ? { descriptions: state.descriptions } : {}),
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
