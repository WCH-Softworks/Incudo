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
 * All of that is reported as `ℹ` lines (ADR 0042). The first run, on the commit before ADR 0075, asserted nothing.
 *
 * What is asserted since ADR 0075 holds against any corpus. For every sample, every creature as an NPC and as a
 * legendary creature, an NPC and a player character keeping every element their kind may keep, and a Cairn character:
 * the Markdown (`sheetMarkdown(sheetDocument(state))`) is **the same packed and reopened with no source**; it heads
 * every section and lists every row, element and printed line the document holds; it writes no HTML (no `<` it did not
 * escape), no empty heading, and no table whose rows differ in width; and a sample's holds no asset path, none of the
 * importer's freeform prose under a key its kind declares no field for and, since ADR 0092, all of what is under one. And every kept text, read into Markdown, says the same words in the same order as
 * its HTML with the tags taken away, and every table in it has the same columns, a spanning cell counted as the
 * columns it spans: nothing lost, nothing added, no header over the wrong column.
 *
 * Perturbations, each run and failing here: a spanning cell not followed by empty ones (the grid tables' headers
 * shift a column; a count of pipes did not see it, since every row is padded to the table's width); an empty heading
 * written; bold text dropped by the reader (the words differ); printed lines left out of a section's list; the
 * collector not seeding kept references (every kept text reopens as "not in the loaded content").
 *
 * Not caught here, and caught by `packages/ui`'s `html-markdown.test.ts` and `sheet-document.test.ts`: `escapeMarkdown`
 * made the identity, and a title left unescaped. The corpus gives them almost nothing to do (its only such characters
 * are square brackets no link follows and one ampersand that spells no entity), which is what the measurement says.
 * The lede's element count written is caught there too. The collector not following embeds is caught by neither: no
 * text a kind may keep embeds another element (every `h5` in them is content's own caption), so no kept text depends on
 * it today; core's `embeds.test.ts` holds the collector to it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BundleElementIndex,
  readCharacterContainer,
  resolveCharacterKind,
  sheetDescriptions,
  type Character,
  type Element,
  type ElementIndex,
  type GameSystem,
} from '@incudo/core';
import {
  CharacterBuilder,
  escapeMarkdown,
  expandDescription,
  htmlToMarkdown,
  htmlToRuns,
  listedName,
  newCharacterOfKind,
  openSelfClosingTags,
  packCharacter,
  runsText,
  sheetDocument,
  sheetMarkdown,
  type BuilderState,
  type SheetDocument,
  type SheetSectionView,
} from '@incudo/ui';

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

/** The text export of a builder's state. */
const exported = (state: BuilderState): string => sheetMarkdown(sheetDocument(state));

/**
 * What is wrong with a Markdown export of `document`: a `<` it did not escape, an empty heading, a table whose rows
 * differ in width, or a section, row, listed element or printed line it does not write.
 */
function markdownProblems(document: SheetDocument, markdown: string): string[] {
  const problems: string[] = [];
  if (/(^|[^\\])</m.test(markdown)) problems.push(`HTML: ${/.{0,30}(?:^|[^\\])<.{0,30}/m.exec(markdown)?.[0]}`);
  if (/^#+\s*$/m.test(markdown)) problems.push('an empty heading');
  const pipes = (line: string): number => (line.replace(/\\\\/g, '').match(/(?<!\\)\|/g) ?? []).length;
  let table: number | undefined;
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) table = undefined;
    else if (table === undefined) table = pipes(line);
    else if (pipes(line) !== table) problems.push(`a table row of ${pipes(line)} pipes under a header of ${table}: ${line.slice(0, 60)}`);
  }
  const lines = new Set(markdown.split('\n'));
  const e = escapeMarkdown;
  const section = (s: SheetSectionView, level: number): void => {
    if (!lines.has(`${'#'.repeat(level)} ${e(s.label)}`)) problems.push(`no heading for ${s.label}`);
    for (const row of s.rows) if (![...lines].some((l) => l.startsWith(`- ${e(row.label)}: ${e(row.value)}`))) problems.push(`no row ${row.label}`);
    // A listed element is written by the name a sheet gives it, in bold when content writes it a sheet line (ADR 0076).
    for (const el of s.elements) {
      const name = e(listedName(el));
      if (![...lines].some((l) => l.startsWith(`- ${name}`) || l.startsWith(`- **${name}**`))) problems.push(`no element ${el.name}`);
    }
    for (const p of s.printed) if (!lines.has(`- ${e(p.label)}: ${e(p.text)}`)) problems.push(`no printed ${p.label}`);
  };
  for (const s of document.sections) section(s, 2);
  for (const creature of document.companions?.creatures ?? []) for (const s of creature.sections) section(s, 4);
  for (const entry of document.references?.entries ?? []) if (![...lines].some((l) => l.startsWith(`### ${e(entry.name)}`))) problems.push(`no reference ${entry.name}`);
  return problems;
}

/** The words of a text, in order: what a reader of it reads, whatever it is marked up with. */
const words = (text: string): string[] => text.match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Each table's rows as the columns a reader sees them in, one string of words per column: from the HTML, a cell
 * spanning columns followed by empty ones; from the Markdown, its cells between unescaped pipes, the delimiter row
 * left out. A header over the wrong column is a difference, which a count of pipes cannot see.
 */
function htmlTableColumns(html: string): string[][][] {
  return (openSelfClosingTags(html).match(/<table[\s\S]*?<\/table>/g) ?? []).map((table) =>
    (table.match(/<tr[\s\S]*?<\/tr>/g) ?? []).map((row) =>
      [...row.matchAll(/<t[dh](\s[^>]*)?>([\s\S]*?)<\/t[dh]>/g)].flatMap((cell) => [
        words(cell[2]!.replace(/<[^>]*>/g, ' ')).join(' '),
        ...Array.from({ length: Number(/colspan="(\d+)"/.exec(cell[1] ?? '')?.[1] ?? 1) - 1 }, () => ''),
      ]),
    ),
  );
}
function markdownTableColumns(markdown: string): string[][][] {
  const tables: string[][][] = [];
  let current: string[][] | undefined;
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) {
      current = undefined;
      continue;
    }
    if (!current) tables.push((current = []));
    if (/^\|( --- \|)+$/.test(line)) continue;
    current.push(line.slice(1, -1).split(/(?<!\\)\|/).map((cell) => words(cell).join(' ')));
  }
  return tables;
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
  const problems: string[] = [];
  const offlineExports: string[] = [];
  const leaked: string[] = [];
  const missingWritten: string[] = [];
  let written = 0;
  const declared = new Set((kind.freeform?.fields ?? []).map((field) => field.key));

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
    // Aurora copies a background feature's text into the save whether or not its user changed it; a value that is text a
    // held element writes itself (its description or its sheet text, ADR 0076) is content's words, not the user's.
    const words = (text: string): string => text.replace(/\s+/g, ' ').trim();
    // A description in plain words too: the sheet's Descriptions part (ADR 0114) writes it as text, and Aurora's copy is text.
    const contentTexts = state.derived.elements
      .flatMap((element) => [element.description ?? '', runsText(htmlToRuns(element.description ?? '')), ...sheetDescriptions(element.sheet).map((d) => d.text)])
      .map(words);
    // Twenty characters or more, so a number or a word is not taken for a quotation.
    const contents = (value: string): boolean => words(value).length >= 20 && contentTexts.some((text) => text.includes(words(value)));
    for (const [key, value] of Object.entries(character.freeform)) {
      tally(freeformKeys, key.replace(/^list\..*/, 'list.*').replace(/^appearance\..*/, 'appearance.*'));
      if (contents(value)) {
        tally(freeformKeys, "of them, content's own text");
        continue;
      }
      if (value.trim().length >= 4 && shown.includes(JSON.stringify(value).slice(1, -1))) personal.push(`${sample.id} ${key}`);
    }
    for (const path of Object.values(character.assets ?? {})) if (shown.includes(path)) personal.push(`${sample.id} asset ${path}`);

    const offline = reopened(state, run.system, run.elements, run.imported.extraIds);
    const d = firstDifference(view, drawn(offline));
    if (d) differ.push(`${sample.id} ${d}`);

    // The export: what the document holds, written right, the same with no source, and none of the prose it leaves out.
    const markdown = exported(state);
    problems.push(...markdownProblems(sheetDocument(state), markdown).map((p) => `${sample.id} ${p}`));
    if (exported(offline) !== markdown) offlineExports.push(sample.id);
    // What the user wrote under a field the kind declares is on the sheet word for word (ADR 0092); what an import put
    // under any other key, prose that is not content's own words, is not.
    const unescaped = markdown.replace(/\\/g, '');
    for (const [key, value] of Object.entries(character.freeform)) {
      const opening = value.trim().split('\n')[0]!.trim().slice(0, 40);
      if (declared.has(key)) {
        if (unescaped.includes(opening)) written++;
        else missingWritten.push(`${sample.id} ${key}`);
        continue;
      }
      // Aurora writes a weapon's properties under its attack row; the sheet's attack names the same properties itself, from
      // content and the system (ADR 0093), so the same words there are not the import's.
      const sheetProperties = sheetDocument(state).sections.flatMap((section) => (section.attacks ?? []).map((a) => a.properties.join(', ')));
      const ownWords = /^attacks\./.test(key) && sheetProperties.includes(value.trim());
      const prose = /^(backstory|background-|background\.|attacks\.)/.test(key) && value.trim().length >= 4 && !contents(value) && !ownWords;
      if (prose && markdown.includes(opening)) leaked.push(`${sample.id} ${key}`);
    }
    for (const path of Object.values(character.assets ?? {})) if (markdown.includes(path)) leaked.push(`${sample.id} ${path}`);
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
  // Fails if the export leaves out what a section shows, writes HTML, an empty heading or an uneven table.
  assert.deepEqual(problems, []);
  // Fails if the export reads anything the save does not carry.
  assert.deepEqual(offlineExports, []);
  t.diagnostic(`freeform values under a declared field written in the export: ${written}`);
  // Fails if the export writes the importer's prose under a key no field declares, or a portrait path.
  assert.deepEqual(leaked, []);
  // Fails if what is written under a declared field is left off the export (ADR 0092).
  assert.deepEqual(missingWritten, []);
});

test('every creature as an NPC and as a legendary creature: what its sheet holds, the same with no source', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const problems: string[] = [];
  const offlineExports: string[] = [];
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
      const offline = reopened(state, system, elements);
      const d = firstDifference(drawn(state), drawn(offline));
      if (d) differ.push(`${creature.name} ${d}`);
      const markdown = exported(state);
      problems.push(...markdownProblems(sheetDocument(state), markdown).map((p) => `${kind.name} ${creature.name}: ${p}`));
      if (exported(offline) !== markdown) offlineExports.push(`${kind.name} ${creature.name}`);
    }
    t.diagnostic(`${kind.name}: ${creatures.length} creatures, ${rows} rows and ${printed} printed lines in all`);
    reportStrings(t, kind.name, c);
    t.diagnostic(`${kind.name}: views that differ reopened with no source: ${differ.length}${differ.length ? `: ${differ.slice(0, 5).join(' | ')}` : ''}`);
  }
  // Fails if an NPC's export leaves out what its sheet shows, or writes it wrong.
  assert.deepEqual(problems, []);
  // Fails if it reads anything the save does not carry.
  assert.deepEqual(offlineExports, []);
});

test('a character keeping every element its kind may keep: every text written, word for word, the same with no source', { skip: corpusSkip }, async (t) => {
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  const problems: string[] = [];
  let entries = 0;
  let tables = 0;
  for (const kindId of ['npc', 'pc']) {
    const kind = resolveCharacterKind(system, kindId);
    const all = (kind.references?.types ?? []).flatMap((type) => elements.byType(type));
    const builder = new CharacterBuilder(newCharacterOfKind(system, kindId), system, elements);
    for (const element of all) assert.equal(builder.addReference(element.id), true, `${kind.name} keeps ${element.name}`);
    const state = builder.getState();
    const document = sheetDocument(state);
    const markdown = exported(state);
    problems.push(...markdownProblems(document, markdown).map((p) => `${kind.name}: ${p}`));
    // Fails if the collector does not follow embeds: the reopened texts lose what they print.
    if (exported(reopened(state, system, elements)) !== markdown) problems.push(`${kind.name}: the export differs with no source`);
    for (const entry of document.references?.entries ?? []) {
      entries++;
      // What a reader of the HTML reads, tags gone and entities decoded, against what a reader of the Markdown reads.
      const html = openSelfClosingTags(entry.html ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&');
      const said = words(entry.html ? html : entry.note ?? '');
      const written = words(htmlToMarkdown(entry.html ?? '') || (entry.note ?? ''));
      if (said.join(' ') !== written.join(' ')) {
        const at = said.findIndex((w, i) => w !== written[i]);
        problems.push(`${kind.name} ${entry.name}: the words differ from "${said.slice(at, at + 6).join(' ')}" / "${written.slice(at, at + 6).join(' ')}"`);
      }
      tables += htmlTableColumns(entry.html ?? '').length;
      const columns = JSON.stringify(markdownTableColumns(htmlToMarkdown(entry.html ?? '')));
      if (columns !== JSON.stringify(htmlTableColumns(entry.html ?? ''))) problems.push(`${kind.name} ${entry.name}: a table's columns differ`);
    }
  }
  t.diagnostic(`kept texts written: ${entries}; tables in them, column for column: ${tables}`);
  assert.ok(entries > 0);
  // Fails if the reader drops or adds a word (bold text dropped, a cell lost), or the export differs with no source.
  assert.deepEqual(problems, []);
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
  const offline = reopened(state, system, new BundleElementIndex([]));
  const d = firstDifference(drawn(state), drawn(offline));
  t.diagnostic(`the same with no source: ${d ?? 'yes'}`);
  // Fails if the export writes a Cairn sheet wrong, or reads anything but the character.
  assert.deepEqual(markdownProblems(sheetDocument(state), exported(state)), []);
  assert.equal(exported(offline), exported(state));
  assert.match(exported(state), /^# New Character\n\n/);
});
