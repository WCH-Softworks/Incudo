/**
 * Filling a published PDF form from the sheet document — ADR 0079 decisions 3 and 5.
 *
 * A form is somebody else's fixed boxes: field names a publisher chose, one box per value. Which box takes what is a
 * fact about one game's form, so it is data shipped with that game's system (a form map, `schemas/form-map.schema.json`),
 * and this file turns a sheet document and a map into field values knowing nothing of any game: a rule names a section
 * of the document by its id, a row by its stat, a kind of listed element by its type, and a group of listed elements by
 * its value. It reads **only the document** (ADR 0075 decision 1): what the form shows, the Sheet shows.
 *
 * What does not fit is never squeezed or dropped silently (decision 5): a list longer than its box continues into the
 * next box the map names and stops there, a level with more spells than lines stops at the last line, a section with a
 * second casting block fills the first, and each is a note naming what was left off, which the shell prints beside the
 * result. A character the form's font cannot write is written as "?" and named the same way.
 *
 * The PDF itself (reading the user's copy, writing the values and their appearances) is the shell's, through a library
 * this package may not import (CODE-REUSE-POLICY): it hands over the copy's fields to be recognised and takes back
 * values to write.
 */

import { validateJson, type JsonSchema, type SchemaError } from '@incudo/core';

import { bagEntryHead, listedHead, listedName, type SheetDocument } from './sheet-document.ts';
import type { SheetListedElement, SheetSectionView } from './sheet.ts';
import { htmlToRuns, runsText } from './html-blocks.ts';

/** What kind of box a field is. A button is a box the form has and no rule fills (a portrait). */
export type FormFieldType = 'text' | 'check' | 'button';

/** A section of the document by the sheet section it came from: its first block, for a section rendered per block. */
interface SectionRef {
  section: string;
}

/** A row of a section, by its stat; `{block}` in the stat is the block's name, matched ignoring case. */
interface RowRef extends SectionRef {
  stat: string;
}

/** The listed elements of a section, all of them or those of some types, in the order the document lists them. */
interface ListRef extends SectionRef {
  types?: string[];
}

export type FormRule =
  /** The character's name. */
  | { field: string; value: 'name' }
  /**
   * What the user wrote under a `Character.freeform` key, as the document holds it (ADR 0092). With a capacity it is
   * written at that size, and text longer than the box is written whole and named as running past it, never cut.
   */
  | { field: string; freeform: string; capacity?: { lines: number; perLine: number; fontSize: number } }
  /** A row's value, or what is beside it. A value in `skip` fills nothing ("none" in an empty hand). */
  | { field: string; row: RowRef; part?: 'value' | 'beside'; skip?: string[] }
  /** A check box, ticked when the row carries a mark. */
  | { field: string; mark: RowRef }
  /** The name of the first block a per-block section is rendered for. */
  | { field: string; block: SectionRef }
  /** How many coins of one unit the section's purse holds (ADR 0098); nothing when it holds none. */
  | { field: string; money: SectionRef & { unit: string } }
  /** Listed elements' names, joined, on one line: "Paladin 3 / Sorcerer 3". */
  | { field: string; list: ListRef & { join: string } }
  /** Listed elements' dice, added die by die, largest die first: "3d10 + 3d6". */
  | { field: string; dice: ListRef }
  /** Rows' values into a run of fields, one each, skipping values in `skip` and repeats. */
  | { fields: string[]; rows: RowRef[]; skip?: string[] }
  /**
   * Listed elements' heads (name, what follows it, what using it takes), then the section's bag entries' (ADR 0098),
   * joined, flowing through a run of multi-line
   * fields, each holding about `lines` lines of `perLine` characters at `fontSize` points, which it is written at (a
   * form's automatic size would write a short list huge and shrink a long one past reading); what is past the last is
   * left off.
   */
  | { flow: { fields: string[]; capacity: Array<{ lines: number; perLine: number; fontSize: number }> }; list: ListRef & { join: string; describe?: boolean } }
  /** Rows matched by `{n}`, one field per n: the first source that has any; any other source with rows is left off. */
  | { table: { sources: RowRef[]; fields: Record<string, string> } }
  /** A section's attacks, one row of boxes each, in order: name, bonus, damage (ADR 0093). What is past the last row is left off. */
  | { attacks: { section: string; rows: Array<{ name: string; bonus: string; damage: string }> } }
  /** Listed elements by their group's value, one line each, and a box per line ticked when the element is prepared. */
  | { groups: { section: string; levels: Record<string, { lines: string[]; prepared?: string[] }> } };

export interface FormMap {
  formatVersion: 1;
  id: string;
  /** What the form is called, for the user: "the 2014 fillable character sheet". */
  name: string;
  publisher: string;
  /** A page the user downloads the form from, in their own browser. Incudo never fetches it (decision 3). */
  download: string;
  system: string;
  kinds: string[];
  /** The characters the form's font can write. */
  encoding: 'WinAnsi';
  /** Every field the form has, by name and type: what a copy is recognised by. */
  fields: Record<string, FormFieldType>;
  fill: FormRule[];
}

/**
 * What to write: text by field, the size to write a field at when the map fixes one (a flow's boxes; every other field
 * keeps the form's own), the check boxes to tick, and what was left off, as sentences.
 */
export interface FormValues {
  text: Record<string, string>;
  fontSizes: Record<string, number>;
  checked: string[];
  leftOff: string[];
}

// --- the map ---------------------------------------------------------------------------------------

/** The fields a rule writes, with the type each must be. */
function ruleFields(rule: FormRule): Array<[string, FormFieldType]> {
  if ('mark' in rule) return [[rule.field, 'check']];
  if ('field' in rule) return [[rule.field, 'text']];
  if ('flow' in rule) return rule.flow.fields.map((f) => [f, 'text']);
  if ('fields' in rule) return rule.fields.map((f) => [f, 'text']);
  if ('table' in rule) return Object.values(rule.table.fields).map((f) => [f, 'text']);
  if ('attacks' in rule) return rule.attacks.rows.flatMap((row) => [row.name, row.bonus, row.damage].map((f): [string, FormFieldType] => [f, 'text']));
  return Object.values(rule.groups.levels).flatMap((level) => [
    ...level.lines.map((f): [string, FormFieldType] => [f, 'text']),
    ...(level.prepared ?? []).map((f): [string, FormFieldType] => [f, 'check']),
  ]);
}

/**
 * A form map, checked: against its schema, then what a schema cannot say. Every field a rule writes is one the form has,
 * of the type the rule writes; no field is written by two rules; a flow has a capacity per field; a level's prepared
 * boxes are one per line. Errors name where, for whoever has the JSON open.
 */
export function checkFormMap(raw: unknown, schema: JsonSchema): { value?: FormMap; errors: SchemaError[] } {
  const errors = validateJson(raw, schema);
  if (errors.length) return { errors };
  const map = raw as FormMap;
  const written = new Map<string, number>();
  map.fill.forEach((rule, index) => {
    for (const [field, type] of ruleFields(rule)) {
      const declared = map.fields[field];
      if (declared === undefined) errors.push({ path: `fill[${index}]`, message: `writes "${field}", which the form does not have` });
      else if (declared !== type) errors.push({ path: `fill[${index}]`, message: `writes "${field}" as ${type}, and the form's is ${declared}` });
      if (written.has(field)) errors.push({ path: `fill[${index}]`, message: `writes "${field}", which fill[${written.get(field)}] writes too` });
      else written.set(field, index);
    }
    if ('flow' in rule && rule.flow.capacity.length !== rule.flow.fields.length) {
      errors.push({ path: `fill[${index}].flow`, message: 'needs one capacity per field' });
    }
    if ('groups' in rule) {
      for (const [value, level] of Object.entries(rule.groups.levels)) {
        if (level.prepared && level.prepared.length !== level.lines.length) {
          errors.push({ path: `fill[${index}].groups.levels.${value}`, message: 'needs one prepared box per line' });
        }
      }
    }
  });
  return errors.length ? { errors } : { value: map, errors };
}

/** What a PDF's fields are, as the shell read them. */
export interface FormField {
  name: string;
  type: FormFieldType | 'other';
}

/**
 * Whether a PDF is the form a map describes: exactly its fields, by name (spaces included) and type. Its bytes may differ
 * (a reader re-saving it rewrites them); its fields are what filling depends on (decision 3). The reason is a sentence for
 * the user when it is not.
 */
export function recogniseForm(fields: readonly FormField[], map: FormMap): { ok: true } | { ok: false; reason: string } {
  const expected = Object.entries(map.fields);
  const found = new Map(fields.map((f) => [f.name, f.type]));
  const matching = expected.filter(([name, type]) => found.get(name) === type).length;
  if (matching === expected.length && fields.length === expected.length) return { ok: true };
  if (fields.length === 0) return { ok: false, reason: `This PDF has no form fields, so it is not ${map.name}.` };
  return {
    ok: false,
    reason: `This PDF is not ${map.name}: it has ${fields.length} form fields, ${matching} of them the ${expected.length} that sheet has.`,
  };
}

// --- the values ------------------------------------------------------------------------------------

/** The views of a section: one, or one per block for a section rendered per block, in the document's order. */
function views(document: SheetDocument, section: string): SheetSectionView[] {
  return document.sections.filter((s) => (s.section ?? s.id) === section);
}

function rowOf(view: SheetSectionView | undefined, stat: string): SheetSectionView['rows'][number] | undefined {
  if (!view) return undefined;
  const wanted = stat.replaceAll('{block}', view.block ?? '').toLowerCase();
  return view.rows.find((r) => r.stat.toLowerCase() === wanted);
}

function listed(document: SheetDocument, ref: ListRef): SheetListedElement[] {
  return views(document, ref.section)
    .slice(0, 1)
    .flatMap((v) => v.elements)
    .filter((e) => !ref.types || (e.type !== undefined && ref.types.includes(e.type)));
}

/** A section's label as a note names it: its own, with its block when the label leaves it out. */
function named(view: SheetSectionView): string {
  return view.block && !view.label.includes(view.block) ? `${view.label} (${view.block})` : view.label;
}

/** How many lines text takes at `perLine` characters a line, wrapping at spaces. */
/** A listed element's head, then its whole description in plain words when the document's Descriptions part has one. */
function describedItem(document: SheetDocument, element: SheetListedElement): string {
  const html = document.descriptions?.groups.flatMap((g) => g.entries).find((entry) => entry.elementId === element.elementId)?.html;
  const text = html ? runsText(htmlToRuns(html)).trim() : '';
  return text ? `${listedHead(element)}: ${text}` : listedHead(element);
}

/** Whether every item fits a flow's boxes, packed as the fill packs them: whole items, box by box, in order. */
function flowFits(items: readonly string[], capacity: ReadonlyArray<{ lines: number; perLine: number }>, join: string): boolean {
  let next = 0;
  for (const { lines, perLine } of capacity) {
    const taken: string[] = [];
    while (next < items.length && wrappedLines([...taken, items[next]!].join(join), perLine) <= lines) taken.push(items[next++]!);
  }
  return next === items.length;
}

export function wrappedLines(text: string, perLine: number): number {
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    let used = 0;
    let count = 1;
    for (const word of paragraph.split(' ')) {
      const length = [...word].length;
      if (used === 0) used = length;
      else if (used + 1 + length <= perLine) used += 1 + length;
      else {
        count++;
        used = length;
      }
      while (used > perLine) {
        count++;
        used -= perLine;
      }
    }
    lines += count;
  }
  return lines;
}

/** Dice added die by die, largest die first: "3d10 + 3d6", "6d10". */
export function diceTotal(dice: ReadonlyArray<{ count: number; sides: number }>): string {
  const by = new Map<number, number>();
  for (const d of dice) by.set(d.sides, (by.get(d.sides) ?? 0) + d.count);
  return [...by]
    .sort((a, b) => b[0] - a[0])
    .map(([sides, count]) => `${count}d${sides}`)
    .join(' + ');
}

/** The values a document gives a map's fields, and what it leaves off. */
export function formValues(document: SheetDocument, map: FormMap): FormValues {
  const text: Record<string, string> = {};
  const fontSizes: Record<string, number> = {};
  const checked: string[] = [];
  const leftOff: string[] = [];
  const extraBlocks = new Set<SheetSectionView>();
  const put = (field: string, value: string | undefined): void => {
    if (value !== undefined && value !== '') text[field] = value;
  };

  for (const rule of map.fill) {
    if ('value' in rule) put(rule.field, document.name.trim() || undefined);
    else if ('freeform' in rule) {
      const entry = document.freeform?.groups.flatMap((g) => g.entries).find((e) => e.key === rule.freeform);
      if (!entry) continue;
      const value = rule.capacity ? entry.text : entry.text.replace(/\s*\n\s*/g, ' ');
      put(rule.field, value);
      if (rule.capacity) {
        fontSizes[rule.field] = rule.capacity.fontSize;
        if (wrappedLines(value, rule.capacity.perLine) > rule.capacity.lines) leftOff.push(`${entry.label} runs past the form's box`);
      }
    }
    else if ('row' in rule) {
      const sectionViews = views(document, rule.row.section);
      for (const extra of sectionViews.slice(1)) extraBlocks.add(extra);
      const row = rowOf(sectionViews[0], rule.row.stat);
      const value = rule.part === 'beside' ? row?.beside : row?.value;
      if (value !== undefined && !rule.skip?.includes(value)) put(rule.field, value);
    } else if ('mark' in rule) {
      if (rowOf(views(document, rule.mark.section)[0], rule.mark.stat)?.mark) checked.push(rule.field);
    } else if ('block' in rule) {
      const sectionViews = views(document, rule.block.section);
      for (const extra of sectionViews.slice(1)) extraBlocks.add(extra);
      put(rule.field, sectionViews[0]?.block);
    } else if ('money' in rule) {
      const count = views(document, rule.money.section)[0]?.purse?.find((row) => row.unit === rule.money.unit)?.count;
      if (count) put(rule.field, String(count));
    } else if ('list' in rule && 'field' in rule) {
      put(rule.field, listed(document, rule.list).map((e) => listedName(e)).join(rule.list.join));
    } else if ('dice' in rule) {
      const elements = listed(document, rule.dice).filter((e) => e.dice);
      if (elements.length) put(rule.field, diceTotal(elements.map((e) => e.dice!)));
    } else if ('rows' in rule) {
      const values: string[] = [];
      for (const ref of rule.rows) {
        const value = rowOf(views(document, ref.section)[0], ref.stat)?.value;
        if (value !== undefined && !rule.skip?.includes(value) && !values.includes(value)) values.push(value);
      }
      values.slice(0, rule.fields.length).forEach((value, i) => put(rule.fields[i]!, value));
      const section = views(document, rule.rows[0]?.section ?? '')[0]?.label ?? 'values';
      if (values.length > rule.fields.length) leftOff.push(`${values.length - rule.fields.length} of ${values.length} ${section} past the form's ${rule.fields.length} lines`);
    } else if ('flow' in rule) {
      const bag = (views(document, rule.list.section)[0]?.bag ?? []).map(bagEntryHead);
      const heads = [...listed(document, rule.list).map((e) => listedHead(e)), ...bag];
      // Whole texts where they fit (ADR 0114): every listed element's head and its description in plain words, used only
      // when all of them fit the flow's boxes; otherwise the heads, as before.
      const whole = rule.list.describe ? [...listed(document, rule.list).map((e) => describedItem(document, e)), ...bag] : undefined;
      const items = whole && flowFits(whole, rule.flow.capacity, rule.list.join) ? whole : heads;
      let next = 0;
      rule.flow.fields.forEach((field, i) => {
        const { lines, perLine, fontSize } = rule.flow.capacity[i]!;
        fontSizes[field] = fontSize;
        const taken: string[] = [];
        while (next < items.length && wrappedLines([...taken, items[next]!].join(rule.list.join), perLine) <= lines) taken.push(items[next++]!);
        put(field, taken.join(rule.list.join));
      });
      if (next < items.length) {
        const label = views(document, rule.list.section)[0]?.label ?? rule.list.section;
        leftOff.push(`${items.length - next} of ${items.length} ${label} past the form's ${rule.flow.fields.length === 1 ? 'box' : 'boxes'}`);
      }
    } else if ('table' in rule) {
      const sources = rule.table.sources.flatMap((ref) => views(document, ref.section).map((view) => ({ ref, view })));
      const has = ({ ref, view }: { ref: RowRef; view: SheetSectionView }): boolean =>
        Object.keys(rule.table.fields).some((n) => rowOf(view, ref.stat.replaceAll('{n}', n)) !== undefined);
      const used = sources.filter(has);
      const first = used[0];
      if (first) {
        for (const [n, field] of Object.entries(rule.table.fields)) put(field, rowOf(first.view, first.ref.stat.replaceAll('{n}', n))?.value);
      }
      for (const other of used.slice(1)) leftOff.push(named(other.view));
    } else if ('attacks' in rule) {
      const view = views(document, rule.attacks.section)[0];
      const attacks = view?.attacks ?? [];
      attacks.slice(0, rule.attacks.rows.length).forEach((attack, i) => {
        const row = rule.attacks.rows[i]!;
        put(row.name, attack.name);
        put(row.bonus, attack.bonus);
        put(row.damage, attack.damage);
      });
      if (attacks.length > rule.attacks.rows.length) {
        const past = attacks.slice(rule.attacks.rows.length).map((a) => a.name).join(', ');
        leftOff.push(`${attacks.length - rule.attacks.rows.length} of ${attacks.length} ${view!.label} past the form's ${rule.attacks.rows.length} lines: ${past}`);
      }
    } else {
      const byValue = new Map<string, SheetListedElement[]>();
      const sectionViews = views(document, rule.groups.section);
      for (const element of sectionViews.flatMap((v) => v.elements)) {
        const value = element.group?.value ?? '';
        byValue.set(value, [...(byValue.get(value) ?? []), element]);
      }
      for (const [value, elements] of byValue) {
        const level = rule.groups.levels[value];
        const label = elements[0]!.group?.label ?? 'no group';
        const fit = level ? Math.min(elements.length, level.lines.length) : 0;
        elements.slice(0, fit).forEach((element, i) => {
          put(level!.lines[i]!, listedName(element));
          if (element.prepared && level!.prepared) checked.push(level!.prepared[i]!);
        });
        const section = sectionViews[0]?.label ?? rule.groups.section;
        if (elements.length > fit) leftOff.push(`${elements.length - fit} of ${elements.length} ${section} (${label}) past the form's lines`);
      }
    }
  }
  for (const extra of extraBlocks) leftOff.push(named(extra));

  // What the form's font cannot write is written "?" and named, never dropped silently.
  const unwritable = new Set<string>();
  for (const [field, value] of Object.entries(text)) {
    const written = [...value].map((ch) => (encodable(ch, map.encoding) ? ch : (unwritable.add(ch), '?'))).join('');
    text[field] = written;
  }
  if (unwritable.size) leftOff.push(`characters the form's font cannot write, shown as "?": ${[...unwritable].join(' ')}`);
  return { text, fontSizes, checked, leftOff };
}

/** The 32 characters Windows-1252 puts in 0x80 to 0x9F; with printable ASCII and Latin-1, what WinAnsi can write. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

function encodable(ch: string, encoding: FormMap['encoding']): boolean {
  if (encoding !== 'WinAnsi') return false;
  if (ch === '\n') return true;
  const code = ch.codePointAt(0)!;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch);
}
