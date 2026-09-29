/**
 * What a text export of a character's sheet must hold, measured before deciding what it is.
 *
 * The roadmap's Phase 5 item is one line, "Plain-text / Markdown export". An export of a character is a rendering of its
 * sheet (ADR 0074), so this reads what the Sheet pane draws, `BuilderState.sheet`, `companions` and `references`, and
 * asks, over the thirty samples (as 5e player characters), every creature as an NPC and as a legendary creature, and a
 * Cairn character:
 *
 * - **Is the view enough?** How many sections, rows, listed elements, printed lines, held creatures and kept references
 *   a sheet has, and whether a save packed and reopened against nothing but what it embeds shows the same view (ADR
 *   0012): an export that differed with no source would be one the user cannot trust offline.
 * - **What in it is HTML.** Which of its strings carry markup or an entity, and, for the one part that is HTML by design
 *   (a kept reference's text, `expandDescription`), every element a kind may keep, expanded as the pane expands it:
 *   which tags, which the shell's sanitizer keeps and which it unwraps (read from `apps/desktop/src/sanitize-html.ts`'s
 *   own allowlist), how many empty non-void elements `openSelfClosingTags` has to open, which entities, and what its
 *   tables look like (a header row, spanning cells, anything but text inside a cell).
 * - **What a Markdown writer would have to escape**: strings with a character Markdown reads as markup.
 * - **What the sheet leaves out that could be personal**: the keys the importer puts in `freeform`, whether any of their
 *   values or an asset path reaches the view.
 * - **Names or descriptions?** The sheet lists held elements by name. How much text their descriptions would add.
 *
 * All of it is reported as `ℹ` lines and nothing is asserted (ADR 0042). The first run was on the commit before ADR 0075.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BundleElementIndex,
  readCharacterContainer,
  resolveCharacterKind,
  type Character,
  type Element,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import { CharacterBuilder, expandDescription, newCharacterOfKind, openSelfClosingTags, packCharacter, type BuilderState } from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { readManifest, samplePath } from './sample-saves.ts';

const tally = (into: Map<string, number>, key: string, by = 1): void => void into.set(key, (into.get(key) ?? 0) + by);
const show = (m: Map<string, number>, limit = 60): string =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

/** What the Sheet pane draws, as one value to compare and to read strings from. */
function drawn(state: BuilderState): unknown {
  return {
    name: state.character.name,
    sheet: state.sheet,
    companions: state.companions ?? null,
    references: { label: state.references.label, rows: state.references.rows },
  };
}

/** Every string the view holds, with where it sits (its key). */
function strings(value: unknown, key = '', out: [string, string][] = []): [string, string][] {
  if (typeof value === 'string') out.push([key, value]);
  else if (Array.isArray(value)) for (const item of value) strings(item, key, out);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, k, out);
  return out;
}

/** The keys of a view whose strings are shown as text (not ids, not a reference's HTML). */
const SHOWN_KEYS = new Set(['name', 'kindName', 'label', 'description', 'value', 'beside', 'text', 'source', 'heldBy', 'notes', 'note']);

interface StringCensus {
  total: number;
  markup: Map<string, number>;
  markdown: Map<string, number>;
  examples: Map<string, string>;
}
const census = (): StringCensus => ({ total: 0, markup: new Map(), markdown: new Map(), examples: new Map() });

/** Tallies strings shown as text that carry markup, an entity, or a character Markdown reads. */
function readStrings(view: unknown, into: StringCensus, skipReferenceText = true): void {
  for (const [key, text] of strings(view)) {
    if (!SHOWN_KEYS.has(key)) continue;
    if (skipReferenceText && key === 'description' && text.length > 400) continue;
    into.total++;
    const note = (bucket: Map<string, number>, what: string): void => {
      tally(bucket, what);
      if (!into.examples.has(what)) into.examples.set(what, `${key}: ${text.slice(0, 60)}`);
    };
    if (/<[a-zA-Z/]/.test(text)) note(into.markup, 'a tag');
    if (/&[a-zA-Z#]/.test(text)) note(into.markup, 'an entity');
    if (/[*_`]/.test(text)) note(into.markdown, '* _ `');
    if (/[[\]]/.test(text)) note(into.markdown, '[ ]');
    if (/[<>]/.test(text)) note(into.markdown, '< >');
    if (/\|/.test(text)) note(into.markdown, '|');
    if (/\\/.test(text)) note(into.markdown, 'backslash');
    if (/^\s*(#|[-+] |\d+[.)] )/.test(text)) note(into.markdown, 'a line start (# - + 1.)');
    if (/\n/.test(text)) note(into.markdown, 'a line break');
  }
}

function reportStrings(t: { diagnostic: (s: string) => void }, what: string, c: StringCensus): void {
  t.diagnostic(`${what}: ${c.total} strings shown as text; with markup: ${show(c.markup)}; with a Markdown character: ${show(c.markdown)}`);
  if (c.examples.size) t.diagnostic(`${what}, one of each: ${[...c.examples].map(([k, v]) => `${k} = "${v}"`).join('; ')}`);
}

/** The view packed with the character and reopened against nothing but what it embeds. */
function reopened(state: BuilderState, system: GameSystem, elements: ElementIndex, extraIds?: string[]): BuilderState {
  const packed = packCharacter(state.character, system, elements, { generator: 'test', ...(extraIds ? { extraIds } : {}) });
  const { container } = readCharacterContainer(packed.files);
  return new CharacterBuilder(container!.character, system, new BundleElementIndex(container!.content.elements)).getState();
}

/** The first difference between two values, as a path, or undefined when they are equal. */
function firstDifference(a: unknown, b: unknown, path = ''): string | undefined {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const found = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
      if (found) return found;
    }
  }
  return `${path}: ${JSON.stringify(a)?.slice(0, 80)} / ${JSON.stringify(b)?.slice(0, 80)}`;
}

const plain = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();

test('the samples\' sheets: what they hold, what is markup, what is personal, the same with no source', { skip: corpusSkip || savesSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const kind = resolveCharacterKind(system, 'pc');
  const elements = await realElements();
  const c = census();
  const differ: string[] = [];
  const freeformKeys = new Map<string, number>();
  const personal: string[] = [];
  const sizes: { sections: number; rows: number; listed: number; printed: number; creatures: number }[] = [];
  const descriptionChars: number[] = [];
  let withDescription = 0;
  let listedTotal = 0;
  let samples = 0;

  for (const sample of readManifest().samples) {
    samples++;
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const builder = new CharacterBuilder(run.imported.character, run.system, run.elements);
    const state = builder.getState();
    const view = drawn(state);
    readStrings(view, c);
    const rows = state.sheet.sections.reduce((n, s) => n + s.rows.length, 0);
    const listed = state.sheet.sections.flatMap((s) => s.elements);
    sizes.push({
      sections: state.sheet.sections.length,
      rows,
      listed: listed.length,
      printed: state.sheet.sections.reduce((n, s) => n + s.printed.length, 0),
      creatures: state.companions?.creatures.length ?? 0,
    });

    // Names or descriptions: what the listed elements' own descriptions would add, as plain text.
    let chars = 0;
    for (const e of listed) {
      listedTotal++;
      const element = run.elements.get(e.elementId);
      if (element?.description?.trim()) {
        withDescription++;
        chars += plain(expandDescription(element, run.elements)).length;
      }
    }
    descriptionChars.push(chars);

    // What could be personal: the importer's freeform text and the portrait's path, anywhere in the view.
    const character: Character = state.character;
    const shown = JSON.stringify(view);
    for (const [key, value] of Object.entries(character.freeform)) {
      tally(freeformKeys, key.replace(/^list\..*/, 'list.*').replace(/^appearance\..*/, 'appearance.*'));
      if (value.trim().length >= 4 && shown.includes(JSON.stringify(value).slice(1, -1))) personal.push(`${sample.id} ${key}`);
    }
    for (const path of Object.values(character.assets ?? {})) if (shown.includes(path)) personal.push(`${sample.id} asset ${path}`);

    const offline = reopened(state, run.system, run.elements, run.imported.extraIds);
    const d = firstDifference(view, drawn(offline));
    if (d) differ.push(`${sample.id} ${d}`);
  }

  const range = (pick: (s: (typeof sizes)[number]) => number): string => {
    const values = sizes.map(pick).sort((a, b) => a - b);
    return `${values[0]} to ${values[values.length - 1]} (median ${values[Math.floor(values.length / 2)]})`;
  };
  t.diagnostic(`samples: ${samples}; sections ${range((s) => s.sections)}, rows ${range((s) => s.rows)}, listed elements ${range((s) => s.listed)}, printed lines ${range((s) => s.printed)}, held creatures ${range((s) => s.creatures)}`);
  reportStrings(t, 'samples', c);
  const chars = [...descriptionChars].sort((a, b) => a - b);
  t.diagnostic(
    `listed elements: ${listedTotal}, ${withDescription} with a description; their descriptions as plain text per sample: ` +
      `${chars[0]} to ${chars[chars.length - 1]} characters (median ${chars[Math.floor(chars.length / 2)]})`,
  );
  t.diagnostic(`freeform keys the importer wrote, by samples carrying one: ${show(freeformKeys)}`);
  t.diagnostic(`freeform values or asset paths that reach the view: ${personal.join(', ') || 'none'}`);
  t.diagnostic(`samples whose view differs reopened with no source: ${differ.length}${differ.length ? `: ${differ.slice(0, 5).join(' | ')}` : ''}`);
  assert.ok(samples > 0);
});

test('every creature as an NPC and as a legendary creature: what its sheet holds, the same with no source', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  for (const kindId of ['npc', 'legendary']) {
    const kind = resolveCharacterKind(system, kindId);
    const step = kind.buildSteps.find((s) => (s.required || s.pick) && s.types.length > 0 && !s.budget && !s.multiple)!;
    const creatures = step.types.flatMap((type) => elements.byType(type));
    const c = census();
    const differ: string[] = [];
    let rows = 0;
    let printed = 0;
    for (const creature of creatures) {
      const builder = new CharacterBuilder(newCharacterOfKind(system, kindId), system, elements);
      builder.choose(`build/${step.id}`, [creature.id]);
      const state = builder.getState();
      readStrings(drawn(state), c);
      rows += state.sheet.sections.reduce((n, s) => n + s.rows.length, 0);
      printed += state.sheet.sections.reduce((n, s) => n + s.printed.length, 0);
      const d = firstDifference(drawn(state), drawn(reopened(state, system, elements)));
      if (d) differ.push(`${creature.name} ${d}`);
    }
    t.diagnostic(`${kind.name}: ${creatures.length} creatures, ${rows} rows and ${printed} printed lines in all`);
    reportStrings(t, kind.name, c);
    t.diagnostic(`${kind.name}: views that differ reopened with no source: ${differ.length}${differ.length ? `: ${differ.slice(0, 5).join(' | ')}` : ''}`);
  }
});

/** The shell sanitizer's own lists, read from its source so this report cannot drift from it. */
function sanitizerLists(): { allowed: Set<string>; dropped: Set<string> } {
  const source = readFileSync(join(import.meta.dirname, '..', '..', '..', 'apps', 'desktop', 'src', 'sanitize-html.ts'), 'utf8');
  const list = (name: string): Set<string> => {
    const body = new RegExp(`${name} = new Set\\(\\[([^\\]]*)\\]`).exec(source)?.[1] ?? '';
    return new Set([...body.matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]!));
  };
  return { allowed: list('ALLOWED_TAGS'), dropped: list('DROP_ENTIRELY') };
}

test('a kept reference\'s text: which markup, what the sanitizer does with it, and its tables', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const { allowed, dropped } = sanitizerLists();
  assert.ok(allowed.size > 10, 'the sanitizer\'s allowlist was read');
  const types = new Set(system.characterKinds.flatMap((k) => resolveCharacterKind(system, k.id).references?.types ?? []));
  const kept: Element[] = [...types].flatMap((type) => elements.byType(type));

  const tags = new Map<string, number>();
  const attributes = new Map<string, number>();
  const entities = new Map<string, number>();
  const selfClosing = new Map<string, number>();
  const table = new Map<string, number>();
  const inCell = new Map<string, number>();
  const nesting = new Map<string, number>();
  const textMarks = new Map<string, number>();
  const headings = new Map<string, number>();
  const lengths: number[] = [];
  const VOID = new Set(['br', 'hr', 'img', 'col', 'wbr', 'area', 'base', 'embed', 'input', 'link', 'meta', 'source', 'track']);

  for (const element of kept) {
    const html = expandDescription(element, elements);
    lengths.push(plain(html).length);
    for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)([^<>]*?)(\/?)>/g)) {
      const tag = m[1]!.toLowerCase();
      tally(tags, `${tag}${allowed.has(tag) ? '' : dropped.has(tag) ? ' (removed)' : ' (unwrapped)'}`);
      for (const a of m[2]!.matchAll(/([a-zA-Z-]+)\s*=/g)) tally(attributes, `${tag} ${a[1]!.toLowerCase()}`);
      if (m[3] === '/' && !VOID.has(tag)) tally(selfClosing, tag);
    }
    for (const m of html.matchAll(/&([a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g)) tally(entities, m[1]!);
    // What the text itself says that Markdown would read as markup, once the tags are gone.
    for (const text of html.split(/<[^>]*>/).map((x) => x.replace(/&amp;/g, '&'))) {
      if (/[*_`]/.test(text)) tally(textMarks, '* _ `');
      if (/[[\]]/.test(text)) tally(textMarks, '[ ]');
      if (/[<>]/.test(text)) tally(textMarks, '< >');
      if (/\|/.test(text)) tally(textMarks, '|');
      if (/\\/.test(text)) tally(textMarks, 'backslash');
      if (/&/.test(text)) tally(textMarks, '&');
      if (/^\s*(#|[-+] |\d+[.)] )/.test(text)) tally(textMarks, 'a text starting # - + 1.');
    }
    const opened = openSelfClosingTags(html);
    for (const m of opened.matchAll(/<(h[1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/g)) {
      tally(headings, `${m[1]}${m[2]!.replace(/<[^>]*>/g, '').trim() ? '' : ' empty'}`);
    }
    for (const li of opened.match(/<li[\s>][\s\S]*?<\/li>/g) ?? []) if (/<(ul|ol|p|table|div)[\s>]/.test(li.slice(3))) tally(nesting, 'a block inside a list item');
    for (const tableHtml of opened.match(/<table[\s\S]*?<\/table>/g) ?? []) {
      tally(table, 'tables');
      const rowsHtml = tableHtml.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
      // A row's width counts a spanning cell as the columns it spans.
      const cells = (row: string): number =>
        [...row.matchAll(/<t[dh](\s[^>]*)?>/g)].reduce((n, m) => n + Number(/colspan="(\d+)"/.exec(m[1] ?? '')?.[1] ?? 1), 0);
      if (/<th[\s>]/.test(rowsHtml[0] ?? '')) tally(table, 'first row of th');
      else if (/<thead/.test(tableHtml)) tally(table, 'a thead');
      else tally(table, 'no header row');
      if (/colspan/.test(tableHtml)) tally(table, 'a cell spanning columns');
      if (/rowspan/.test(tableHtml)) tally(table, 'a cell spanning rows');
      if (new Set(rowsHtml.map(cells)).size > 1) tally(table, 'rows of different widths, spans counted');
      if (/<table[\s\S]*<table/.test(tableHtml)) tally(table, 'a table inside');
      for (const cell of tableHtml.match(/<t[dh](\s[^>]*)?>[\s\S]*?<\/t[dh]>/g) ?? []) {
        for (const m of cell.slice(3).matchAll(/<([a-zA-Z][a-zA-Z0-9]*)/g)) tally(inCell, m[1]!.toLowerCase());
      }
    }
  }
  lengths.sort((a, b) => a - b);
  t.diagnostic(`elements a kind may keep: ${kept.length}, of ${[...types].join(', ')}; plain text ${lengths[0]} to ${lengths[lengths.length - 1]} characters (median ${lengths[Math.floor(lengths.length / 2)]})`);
  t.diagnostic(`tags, marked where the sanitizer does not keep them: ${show(tags)}`);
  t.diagnostic(`attributes: ${show(attributes)}`);
  t.diagnostic(`empty non-void elements written self-closing: ${show(selfClosing)}`);
  t.diagnostic(`entities: ${show(entities)}`);
  t.diagnostic(`tables: ${show(table)}; tags inside a cell: ${show(inCell)}`);
  t.diagnostic(`headings, once empty ones are opened: ${show(headings)}; blocks inside blocks: ${show(nesting)}`);
  t.diagnostic(`text a Markdown reader would read as markup: ${show(textMarks)}`);
});

test('a Cairn character\'s sheet', async (t) => {
  const system = await loadShippedSystem('cairn');
  const kind = resolveCharacterKind(system, system.characterKinds[0]!.id);
  const builder = new CharacterBuilder(newCharacterOfKind(system, kind.id), system, new BundleElementIndex([]));
  for (const step of builder.getState().steps) {
    for (const [at, stat] of (step.budget?.targets ?? []).entries()) builder.setBudgetStat(step.id, stat, 4 + at);
  }
  const state = builder.getState();
  const c = census();
  readStrings(drawn(state), c);
  t.diagnostic(`cairn/${kind.id}: ${state.sheet.sections.map((s) => `${s.label} (${s.rows.length} rows, ${s.elements.length} listed)`).join(', ')}; companions ${state.companions ? 'yes' : 'none'}; references available: ${state.references.available}`);
  reportStrings(t, 'Cairn', c);
  const d = firstDifference(drawn(state), drawn(reopened(state, system, new BundleElementIndex([]))));
  t.diagnostic(`the same with no source: ${d ?? 'yes'}`);
});
