/**
 * The homebrew element editor — ADR 0108.
 *
 * A user writes elements into a homebrew source of their own (`packages/content/src/homebrew-source.ts`). What the
 * editor offers and writes is all here, and the panes compute nothing: the types a kind lets a user add, a name, a
 * description, setters, support tags, and lines that add a whole number to a stat or give another loaded element. An
 * element with anything else (a hand edit) is listed and not opened for editing.
 *
 * Nothing here names a game. The types are the kinds' `additions.types`, the stats are what a written feature's lines
 * may name (`customFeatureStats`, ADR 0063 and 0106), and the setter names and tags offered are read off loaded content.
 */

import {
  customFeatureStats,
  resolveCharacterKind,
  type CustomFeatureStat,
  type Element,
  type ElementIndex,
  type GameSystem,
  type Rule,
} from '@incudo/core';
import type { HomebrewBundle, HomebrewElement } from '@incudo/content';
import { contentCatalog } from './content-browser.ts';

export interface HomebrewType {
  type: string;
  /** The type's plural label, for a heading. */
  plural: string;
}

/**
 * The types a homebrew element may be (ADR 0108 decision 3): every type any of the system's kinds lists in
 * `additions.types`, in the order the system declares types. An element of one reaches any character through
 * Additions, whatever it holds.
 */
export function homebrewTypes(system: GameSystem): HomebrewType[] {
  const addable = new Set<string>();
  for (const def of system.characterKinds) {
    for (const type of resolveCharacterKind(system, def.id).additions?.types ?? []) addable.add(type);
  }
  return system.elementTypes
    .filter((t) => addable.has(t.name))
    .map((t) => ({ type: t.name, plural: t.plural ?? t.name }));
}

/**
 * The stats a line may add to: what a written feature's lines may name on any of the system's kinds, once each by name,
 * the first kind's label and group kept. An add line is the one kind of feature line that is an element rule (ADR 0106).
 */
export function homebrewStats(system: GameSystem): CustomFeatureStat[] {
  const out: CustomFeatureStat[] = [];
  const seen = new Set<string>();
  for (const def of system.characterKinds) {
    for (const stat of customFeatureStats(resolveCharacterKind(system, def.id))) {
      const key = stat.stat.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(stat);
    }
  }
  return out;
}

export type HomebrewLine = { kind: 'add'; stat: string; value: number } | { kind: 'grant'; id: string };

export interface HomebrewSetter {
  name: string;
  value: string;
}

/** An element as the editor holds it while it is written. `id` is absent until it is first saved. */
export interface HomebrewDraft {
  id?: string;
  type: string;
  name: string;
  /** Plain text: a blank line starts a paragraph. */
  description: string;
  setters: HomebrewSetter[];
  tags: string[];
  lines: HomebrewLine[];
}

export function newHomebrewDraft(type: string): HomebrewDraft {
  return { type, name: '', description: '', setters: [], tags: [], lines: [] };
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain text as the HTML an element's description is: a paragraph per blank-line block, a line break within one. */
export function homebrewDescriptionHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.split('\n').map((line) => escapeHtml(line.trim())).join('<br />')}</p>`)
    .join('\n');
}

/** The plain text {@link homebrewDescriptionHtml} wrote, or undefined for HTML it did not write. */
export function homebrewDescriptionText(html: string): string | undefined {
  const paragraphs = html.trim() ? html.trim().split(/\n/) : [];
  const out: string[] = [];
  for (const p of paragraphs) {
    const m = /^<p>(.*)<\/p>$/.exec(p);
    if (!m || /<(?!br \/>)/.test(m[1]!)) return undefined;
    out.push(m[1]!.split('<br />').map((line) => line.replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]!)).join('\n'));
  }
  return out.join('\n\n');
}

/**
 * An element as a draft, or the reason it cannot be opened: anything the editor does not write (ADR 0108 decision 4)
 * would be lost on save, so such an element is listed and left alone.
 */
export function homebrewDraftOf(element: HomebrewElement): { draft: HomebrewDraft } | { reason: string } {
  const unsupported = 'It says more than this editor writes, so it is left as it is.';
  if (element.requirements || element.sheet || element.multiclass || element.spellcasting?.length || element.contents?.length) {
    return { reason: unsupported };
  }
  const description = homebrewDescriptionText(element.description ?? '');
  if (description === undefined) return { reason: unsupported };
  const lines: HomebrewLine[] = [];
  for (const rule of element.rules) {
    if (rule.requirements || rule.level !== undefined) return { reason: unsupported };
    if (rule.kind === 'stat' && rule.value.kind === 'number' && Number.isInteger(rule.value.value) && isPlainStat(rule)) {
      lines.push({ kind: 'add', stat: rule.name, value: rule.value.value });
    } else if (rule.kind === 'grant' && !rule.spellcasting && !rule.prepared && !rule.name && !rule.allowReplace && !rule.equipped) {
      lines.push({ kind: 'grant', id: rule.id });
    } else {
      return { reason: unsupported };
    }
  }
  const setters: HomebrewSetter[] = [];
  for (const [name, setter] of Object.entries(element.setters)) {
    if (setter.attrs && Object.keys(setter.attrs).length) return { reason: unsupported };
    setters.push({ name, value: setter.value });
  }
  return {
    draft: { id: element.id, type: element.type, name: element.name, description, setters, tags: [...element.supports], lines },
  };
}

function isPlainStat(rule: Extract<Rule, { kind: 'stat' }>): boolean {
  return rule.bonus === undefined && rule.max === undefined && rule.alt === undefined && !rule.inline && !rule.equipped;
}

/**
 * A new element's id (ADR 0108 decision 5): `ID_HOMEBREW_<TYPE>_<NAME>`, letters and digits, with `_2`, `_3`… when
 * `taken` says it is used, ignoring case. Minted once; a rename keeps it.
 */
export function mintHomebrewId(type: string, name: string, taken: (id: string) => boolean): string {
  const part = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const base = ['ID_HOMEBREW', part(type), part(name) || 'ELEMENT'].filter(Boolean).join('_');
  let id = base;
  for (let n = 2; taken(id); n++) id = `${base}_${n}`;
  return id;
}

export interface HomebrewContext {
  system: GameSystem;
  /** Everything loaded, which a grant names and a new id must not collide with. */
  index: ElementIndex;
}

/** The sentences that stop a draft being saved, none when it can be. */
export function homebrewDraftProblems(draft: HomebrewDraft, context: HomebrewContext): string[] {
  const problems: string[] = [];
  if (!draft.name.trim()) problems.push('Give it a name.');
  if (!homebrewTypes(context.system).some((t) => t.type === draft.type)) problems.push(`${draft.type} is not a type you can write here.`);
  const names = new Set<string>();
  for (const setter of draft.setters) {
    const name = setter.name.trim();
    if (!name) {
      problems.push('A setter has no name.');
      continue;
    }
    if (names.has(name.toLowerCase())) problems.push(`The setter ${name} is written twice.`);
    names.add(name.toLowerCase());
  }
  const stats = new Map(homebrewStats(context.system).map((s) => [s.stat.toLowerCase(), s]));
  for (const line of draft.lines) {
    if (line.kind === 'add') {
      const stat = stats.get(line.stat.toLowerCase());
      if (!stat) problems.push(line.stat ? `${line.stat} is not a number a line can add to.` : 'A line adds to no number.');
      else if (!Number.isInteger(line.value)) problems.push(`${stat.fullLabel} takes a whole number.`);
    } else if (!context.index.get(line.id)) {
      problems.push(line.id ? `What a line gives is not in any loaded source.` : 'A line gives nothing.');
    } else if (line.id === draft.id) {
      problems.push('An entry cannot give itself.');
    }
  }
  return problems;
}

/**
 * The element a draft writes: an id minted when it has none, the source's name as its book (which names no
 * publication, so it is always offered, ADR 0049), and its rules in the order the lines are written.
 */
export function homebrewElementOf(
  draft: HomebrewDraft,
  context: HomebrewContext & { sourceName: string; bundle: HomebrewBundle },
): HomebrewElement {
  const own = new Set(context.bundle.elements.map((e) => e.id.toLowerCase()));
  const id =
    draft.id ??
    mintHomebrewId(draft.type, draft.name, (candidate) => own.has(candidate.toLowerCase()) || takenInIndex(context.index, candidate));
  const stats = new Map(homebrewStats(context.system).map((s) => [s.stat.toLowerCase(), s]));
  const rules: Rule[] = draft.lines.map((line, at) => {
    if (line.kind === 'add') {
      const stat = stats.get(line.stat.toLowerCase())?.stat ?? line.stat;
      return { kind: 'stat', key: `line-${at}`, name: stat, value: { kind: 'number', value: line.value } };
    }
    const target = context.index.get(line.id);
    return { kind: 'grant', key: `line-${at}`, type: target?.type ?? '', id: line.id };
  });
  const setters: HomebrewElement['setters'] = {};
  for (const setter of draft.setters) setters[setter.name.trim()] = { value: setter.value.trim() };
  const tags = [...new Set(draft.tags.map((t) => t.trim()).filter(Boolean))];
  const description = homebrewDescriptionHtml(draft.description);
  return {
    id,
    type: draft.type,
    name: draft.name.trim(),
    source: context.sourceName,
    setters,
    rules,
    supports: tags,
    ...(description ? { description } : {}),
  };
}

/** Whether an id is taken in loaded content, ignoring case, which an id from a draft must not reuse. */
function takenInIndex(index: ElementIndex, id: string): boolean {
  if (index.get(id)) return true;
  const lower = id.toLowerCase();
  for (const element of index.all()) if (element.id.toLowerCase() === lower) return true;
  return false;
}

/** The body with a draft saved into it: replacing the element of its id, or appended. Refused with its problems. */
export function saveHomebrewDraft(
  bundle: HomebrewBundle,
  draft: HomebrewDraft,
  context: HomebrewContext & { sourceName: string },
): { bundle: HomebrewBundle; element: HomebrewElement } | { problems: string[] } {
  const problems = homebrewDraftProblems(draft, context);
  if (problems.length) return { problems };
  const element = homebrewElementOf(draft, { ...context, bundle });
  const at = bundle.elements.findIndex((e) => e.id === element.id);
  const elements = at < 0 ? [...bundle.elements, element] : bundle.elements.map((e, i) => (i === at ? element : e));
  return { bundle: { ...bundle, elements }, element };
}

export function removeHomebrewElement(bundle: HomebrewBundle, id: string): HomebrewBundle {
  return { ...bundle, elements: bundle.elements.filter((e) => e.id !== id) };
}

export interface HomebrewRow {
  id: string;
  name: string;
  type: string;
  /** What its lines do, in words: "Adds 10 to Speed; gives Darkvision". Empty when it has none. */
  summary: string;
  /** Why it cannot be opened for editing, when it cannot. */
  locked?: string;
}

/** A line in words, its stat and element named as the user sees them. */
export function homebrewLineText(line: HomebrewLine, context: HomebrewContext): string {
  if (line.kind === 'add') {
    const stat = homebrewStats(context.system).find((s) => s.stat.toLowerCase() === line.stat.toLowerCase());
    const label = stat?.fullLabel ?? line.stat;
    return line.value < 0 ? `Takes ${-line.value} from ${label}` : `Adds ${line.value} to ${label}`;
  }
  const target = context.index.get(line.id);
  return target ? `Gives ${target.name} (${target.type})` : 'Gives something not in any loaded source';
}

/** The editor's list: every element of the body, by name, each with what its lines do. */
export function homebrewRows(bundle: HomebrewBundle, context: HomebrewContext): HomebrewRow[] {
  return [...bundle.elements]
    .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type))
    .map((element) => {
      const opened = homebrewDraftOf(element);
      const summary = 'draft' in opened ? opened.draft.lines.map((line) => homebrewLineText(line, context)).join('; ') : '';
      return {
        id: element.id,
        name: element.name,
        type: element.type,
        summary,
        ...('reason' in opened ? { locked: opened.reason } : {}),
      };
    });
}

/** Names that loaded elements of a type use, most used first: what a setter or a tag is usually called there. */
function mostUsed(elements: readonly Element[], names: (element: Element) => Iterable<string>, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const element of elements) for (const name of names(element)) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([name]) => name);
}

/** The setter names loaded elements of the type carry, most used first (a spell's level and school). */
export function homebrewSetterSuggestions(index: ElementIndex, type: string, limit = 12): string[] {
  return mostUsed(index.byType(type), (e) => Object.keys(e.setters), limit);
}

/** The support tags loaded elements of the type carry, most used first (a spell's class lists). */
export function homebrewTagSuggestions(index: ElementIndex, type: string, limit = 40): string[] {
  return mostUsed(index.byType(type), (e) => e.supports, limit);
}

export interface HomebrewGrantOption {
  id: string;
  name: string;
  type: string;
}

/** What a line may give, for what the user typed: loaded elements by name, ranked as Browse ranks them. */
export function homebrewGrantOptions(context: HomebrewContext, text: string, limit = 20): HomebrewGrantOption[] {
  if (!text.trim()) return [];
  return contentCatalog(context.index, context.system)
    .search({ text, descriptions: false, limit })
    .rows.map((row) => ({ id: row.id, name: row.name, type: row.type }));
}

/** Tags as one line of text, as the editor shows them. */
export function homebrewTagsText(tags: readonly string[]): string {
  return tags.join(', ');
}

/** Tags read from that line: split on commas, as content's tags are, trimmed, blanks and repeats dropped. */
export function homebrewTagsFromText(text: string): string[] {
  return [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))];
}

/** Said under the editor, worded from what it writes. */
export const HOMEBREW_HINT =
  'What you write here is offered to every character of this game: on Build, through "Add from your content", and in any ' +
  'choice that takes its type and tags. A character keeps a copy of what it holds, so it still opens if this source is removed.';
