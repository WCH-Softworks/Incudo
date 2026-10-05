/**
 * What a printed page of a character has to hold, measured before deciding what the print layout is.
 *
 * The roadmap's Phase 5 item is two words, "Print layout". ADRs 0075 and 0076 say a print layout is a renderer of the one
 * sheet document (`sheetDocument`, `packages/ui/src/sheet-document.ts`), never of `BuilderState` directly, and ADR 0075
 * says the Sheet pane is already most of a print layout. This reads that document, over the thirty samples (as 5e player
 * characters, found with `samplesWhere`), every creature as an NPC and as a legendary creature, a character keeping
 * every text its kind may keep, and a Cairn character, and asks:
 *
 * - **How much is on the page.** Per kind and per section: how many rows, listed elements, printed lines and sheet lines
 *   (a listed element with content's sheet text, ADR 0076), and how many characters, and per sheet the same for the
 *   character, its held creatures and what it keeps. The longest sheet texts, kept texts and tables.
 * - **What could sit side by side.** Which sections are only short figures (rows, no listed element, no printed line,
 *   every value short), whether that shape is the same for a section on every sheet, and the order the shapes come in:
 *   whether a renderer can put the scores, saves and skills beside each other from what the document says, without
 *   knowing their names.
 * - **What the document has for a stat block.** Whether a creature's traits, actions and reactions carry their text or
 *   only their names, and which listed elements a section names without the sheet line content wrote for them (ADR
 *   0076 decision 6: a hidden element a section lists anyway), by section, which is the "Primal Bond" cost.
 * - **What the shell does that a printed page would have to undo or repeat.** Read from the stylesheet and the three
 *   components that draw the Sheet: whether anything is styled for print, what bounds the page to the window, what the
 *   dark scheme does to the text colour, what scrolls instead of growing, whether anything calls the platform's print,
 *   and which components sanitize content's HTML (the only sanitizer is the shell's, over a DOM).
 *
 * All of it is reported as `ℹ` lines (ADR 0042). The first run, on the commit before ADR 0077, asserted nothing: it is
 * the measurement the ADR was written from.
 *
 * What is asserted since ADR 0077 holds against any corpus, and against the shell as source:
 *
 * - For every sheet read here, the document's `title` is the Markdown export's first heading, so a printed page and the
 *   text export are headed the same.
 * - The stylesheet's `@media print` block undoes what binds the pane to the window (`.app`, `.pane`), hides the app's
 *   chrome, the name field and the element count, prints the title, sets light colour tokens, flows `.sheet-flow` in two
 *   columns, keeps what fits whole (a grid of rows, a listed element, a creature's section, a section that lists no
 *   elements) and **not a whole section**, starts kept texts on a page and lets their tables show, and leaves
 *   `.sheet-text`'s line breaks alone; outside print, the title is hidden. The Sheet pane draws the title, the count and
 *   the flow those rules name.
 *
 * What it cannot show is that a page prints right: the rules are held to being written, and ADR 0077's drives printed
 * the thirty samples, the creature characters and a Cairn character to PDF in the Windows window and compared their
 * words with the Markdown export. Perturbations, each run and failing here: every rule above removed, one at a time; a
 * whole section kept unbroken again (what the first printed sample showed, a page half empty before every long list).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BundleElementIndex,
  resolveCharacterKind,
  sheetDescriptions,
  type Element,
  type ElementIndex,
  type ResolvedCharacterKind,
  type SheetSectionDef,
} from '@incudo/core';
import {
  CharacterBuilder,
  cssString,
  DEFAULT_PRINT_OPTIONS,
  escapeMarkdown,
  expandDescription,
  listedName,
  listedUsage,
  newCharacterOfKind,
  openSelfClosingTags,
  PRINT_PARTS,
  printRendering,
  sheetDocument,
  sheetMarkdown,
  type BuilderState,
  type SheetDocument,
  type SheetSectionView,
} from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

type Diagnostic = { diagnostic: (s: string) => void };

const tally = (into: Map<string, number>, key: string, by = 1): void => void into.set(key, (into.get(key) ?? 0) + by);
const show = (m: Map<string, number>, limit = 40): string =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
const range = (values: number[]): string => {
  if (!values.length) return '—';
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[0]!;
  const hi = sorted[sorted.length - 1]!;
  return lo === hi ? String(lo) : `${lo} to ${hi} (median ${sorted[Math.floor(sorted.length / 2)]})`;
};

/** A text as a reader of the page reads it: tags gone, entities one character, runs of space one space. */
const plain = (html: string): string =>
  openSelfClosingTags(html).replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, '·').replace(/\s+/g, ' ').trim();

/** How many characters a section puts on the page: its heading, its rows, its listed elements with their lines, its printed lines. */
function sectionChars(section: SheetSectionView): number {
  let n = section.label.length + (section.description?.length ?? 0);
  for (const row of section.rows) n += row.label.length + row.value.length + (row.beside?.length ?? 0);
  for (const e of section.elements) n += listedName(e).length + (listedUsage(e)?.length ?? 0) + (e.text ? plain(e.text).length : 0);
  for (const p of section.printed) n += p.label.length + p.text.length;
  return n;
}

/** How many lines a section takes before any wrapping: one per row, per listed element, per line of its text, per printed line. */
function sectionLines(section: SheetSectionView): number {
  return (
    section.rows.length +
    section.printed.length +
    section.elements.reduce((n, e) => n + 1 + (e.text ? e.text.split('\n').length - 1 : 0), 0)
  );
}

/** The longest value a row shows, with what is beside it. */
const widestValue = (section: SheetSectionView): number =>
  section.rows.reduce((n, r) => Math.max(n, r.value.length + (r.beside !== undefined ? r.beside.length + 3 : 0)), 0);

/**
 * The candidate rule for "short figures", a section a paper sheet could set in boxes beside others: rows only, and every
 * value, with what is beside it, eight characters or fewer ("18 (+4)", "+11", "1/4"). Named by shape, never by id.
 */
const FIGURE_WIDTH = 8;
function shapeOf(section: SheetSectionView): string {
  const rows = section.rows.length > 0;
  const listed = section.elements.length > 0;
  const printed = section.printed.length > 0;
  const lines = section.elements.some((e) => e.text !== undefined);
  if (rows && !listed && !printed) return widestValue(section) <= FIGURE_WIDTH ? 'figures' : 'rows';
  if (!rows && listed && !printed) return lines ? 'prose' : 'names';
  if (!rows && !listed && printed) return 'printed';
  return `mixed(${[rows && 'rows', listed && (lines ? 'prose' : 'names'), printed && 'printed'].filter(Boolean).join('+')})`;
}

interface SectionTally {
  sheets: number;
  rows: number[];
  elements: number[];
  printed: number[];
  sheetLines: number[];
  chars: number[];
  lines: number[];
  widest: number;
  beside: boolean;
  shapes: Map<string, number>;
}

/** One sheet's size: characters of its own sections, its held creatures and what it keeps, and its lines. */
interface SheetTotal {
  own: number;
  creatures: number;
  references: number;
  lines: number;
  parts: string;
}

class Census {
  readonly sections = new Map<string, SectionTally>();
  readonly sequences = new Map<string, number>();
  readonly totals: SheetTotal[] = [];
  readonly texts: { chars: number; lines: number; where: string }[] = [];
  readonly hiddenNamed = new Map<string, number>();
  readonly hiddenLost = new Map<string, number>();
  readonly statBlock = new Map<string, number>();
  /** Sheets whose Markdown is not headed by the document's title (ADR 0077): what fails. */
  readonly titles: string[] = [];

  /** One sheet document: `where` names the kind, `lookup` finds a listed element's own hints. */
  read(document: SheetDocument, kind: ResolvedCharacterKind, lookup: (id: string) => Element | undefined, where: string): void {
    if (!document.title.trim() || !sheetMarkdown(document).startsWith(`# ${escapeMarkdown(document.title)}\n`)) {
      this.titles.push(`${where} "${document.name}"`);
    }
    const own = document.sections.reduce((n, s) => n + sectionChars(s), 0);
    const creatures = (document.companions?.creatures ?? []).reduce((n, c) => n + c.name.length + c.sections.reduce((m, s) => m + sectionChars(s), 0), 0);
    const references = (document.references?.entries ?? []).reduce((n, e) => n + e.name.length + plain(e.html ?? e.note ?? '').length, 0);
    const lines =
      document.sections.reduce((n, s) => n + 1 + sectionLines(s), 0) +
      (document.companions?.creatures ?? []).reduce((n, c) => n + 1 + c.sections.reduce((m, s) => m + 1 + sectionLines(s), 0), 0);
    const parts = ['sections', document.companions && 'creatures', document.references && 'references'].filter(Boolean).join(' + ');
    this.totals.push({ own, creatures, references, lines, parts });
    tally(this.sequences, document.sections.map(shapeOf).join(' › '));

    const defs = new Map<string, SheetSectionDef>();
    for (const def of kind.sheet.sections) defs.set(def.id, def);
    for (const section of document.sections) this.section(`${where} · ${section.label}`, section, defs.get(section.id), lookup, where);
    const creatureDefs = new Map<string, SheetSectionDef>();
    for (const def of kind.companions?.sheet ?? []) creatureDefs.set(def.id, def);
    for (const creature of document.companions?.creatures ?? []) {
      for (const section of creature.sections) this.section(`${where}'s creature · ${section.label}`, section, creatureDefs.get(section.id), lookup, `${where}'s creature`);
    }
  }

  private section(key: string, section: SheetSectionView, def: SheetSectionDef | undefined, lookup: (id: string) => Element | undefined, where: string): void {
    let t = this.sections.get(key);
    if (!t) this.sections.set(key, (t = { sheets: 0, rows: [], elements: [], printed: [], sheetLines: [], chars: [], lines: [], widest: 0, beside: false, shapes: new Map() }));
    t.sheets++;
    t.rows.push(section.rows.length);
    t.elements.push(section.elements.length);
    t.printed.push(section.printed.length);
    t.sheetLines.push(section.elements.filter((e) => e.text !== undefined).length);
    t.chars.push(sectionChars(section));
    t.lines.push(sectionLines(section));
    t.widest = Math.max(t.widest, widestValue(section));
    t.beside ||= section.rows.some((r) => r.beside !== undefined);
    tally(t.shapes, shapeOf(section));

    for (const e of section.elements) {
      if (e.text) this.texts.push({ chars: plain(e.text).length, lines: e.text.split('\n').length, where: `${where} · ${section.label} · ${listedName(e)}` });
      const element = lookup(e.elementId);
      const hidden = element?.sheet?.display === false;
      const written = sheetDescriptions(element?.sheet).some((d) => d.text.trim() !== '');
      // A hidden element a section lists anyway is named and given no line (ADR 0076 decision 6).
      if (hidden && !def?.omitHidden) {
        tally(this.hiddenNamed, `${where} · ${section.label}`);
        if (written) tally(this.hiddenLost, `${where} · ${section.label} · ${element!.name}`);
      }
    }
    // A stat block's features: with their text on the page, or named only.
    const types = def?.types ?? [];
    if (types.some((type) => /^Companion (Trait|Action|Reaction)$/.test(type))) {
      for (const e of section.elements) {
        const element = lookup(e.elementId);
        const description = (element?.description ?? '').trim() !== '';
        tally(this.statBlock, `${where} · ${section.label} · ${e.text !== undefined ? 'with its sheet line' : description ? 'named only, its description not on the sheet' : 'named only, no text anywhere'}`);
      }
    }
  }

  report(t: Diagnostic, what: string): void {
    for (const [key, s] of this.sections) {
      t.diagnostic(
        `${key}: on ${s.sheets} sheets; rows ${range(s.rows)}, listed ${range(s.elements)}, with a sheet line ${range(s.sheetLines)}, ` +
          `printed ${range(s.printed)}; lines ${range(s.lines)}, characters ${range(s.chars)}; widest value ${s.widest}${s.beside ? ' (with what is beside it)' : ''}; shape ${show(s.shapes)}`,
      );
    }
    t.diagnostic(`${what}: the sections' shapes in order, by sheets: ${show(this.sequences, 4)}`);
    const pick = (f: (x: SheetTotal) => number): string => range(this.totals.map(f));
    t.diagnostic(
      `${what}: per sheet, characters of its own sections ${pick((x) => x.own)}, of its held creatures ${pick((x) => x.creatures)}, ` +
        `of what it keeps ${pick((x) => x.references)}; lines before wrapping ${pick((x) => x.lines)}`,
    );
    const parts = new Map<string, number>();
    for (const x of this.totals) tally(parts, x.parts);
    t.diagnostic(`${what}: the document's parts, by sheets: ${show(parts)}`);
    const longest = [...this.texts].sort((a, b) => b.chars - a.chars).slice(0, 5);
    const texts = this.texts.map((x) => x.chars);
    t.diagnostic(
      `${what}: sheet lines ${this.texts.length}, ${range(texts)} characters, ${range(this.texts.map((x) => x.lines))} lines each; ` +
        `longest: ${longest.map((x) => `${x.where} (${x.chars} characters, ${x.lines} lines)`).join('; ') || 'none'}`,
    );
    t.diagnostic(`${what}: hidden elements a section lists anyway, named without a line, by section: ${show(this.hiddenNamed)}`);
    t.diagnostic(`${what}: of them, ones content writes a sheet line for, which the page loses: ${show(this.hiddenLost)}`);
    if (this.statBlock.size) t.diagnostic(`${what}: a stat block's traits, actions and reactions: ${show(this.statBlock)}`);
  }
}

test('the samples: what a printed page of each holds', { skip: corpusSkip || savesSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const census = new Census();
  let sheets = 0;
  for (const sample of samplesWhere(() => true)) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const state = new CharacterBuilder(run.imported.character, run.system, run.elements).getState();
    const kind = resolveCharacterKind(run.system, state.character.kind);
    census.read(sheetDocument(state), kind, (id) => run.elements.get(id), kind.name);
    sheets++;
  }
  t.diagnostic(`samples read: ${sheets}`);
  census.report(t, 'samples');
  assert.ok(sheets > 0);
  // Fails if a printed page and the text export could be headed differently.
  assert.deepEqual(census.titles, []);
});

test('every creature as an NPC and as a legendary creature: what a printed stat block holds', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  for (const kindId of ['npc', 'legendary']) {
    const kind = resolveCharacterKind(system, kindId);
    const step = kind.buildSteps.find((s) => (s.required || s.pick) && s.types.length > 0 && !s.budget && !s.multiple)!;
    const creatures = step.types.flatMap((type) => elements.byType(type));
    const census = new Census();
    for (const creature of creatures) {
      const builder = new CharacterBuilder(newCharacterOfKind(system, kindId), system, elements);
      builder.choose(`build/${step.id}`, [creature.id]);
      census.read(sheetDocument(builder.getState()), kind, (id) => elements.get(id), kind.name);
    }
    t.diagnostic(`${kind.name}: ${creatures.length} creatures read`);
    census.report(t, kind.name);
    assert.deepEqual(census.titles, [], kind.name);
  }
});

/** A table's shape: how many columns (a spanning cell counted as the columns it spans), how many rows. */
function tableShapes(html: string): { columns: number; rows: number }[] {
  return (openSelfClosingTags(html).match(/<table[\s\S]*?<\/table>/g) ?? []).map((table) => {
    const rows = table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    const width = (row: string): number =>
      [...row.matchAll(/<t[dh](\s[^>]*)?>/g)].reduce((n, m) => n + Number(/colspan="(\d+)"/.exec(m[1] ?? '')?.[1] ?? 1), 0);
    return { columns: Math.max(0, ...rows.map(width)), rows: rows.length };
  });
}

test('a character keeping every text its kind may keep: how long a kept text and its tables run on paper', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  for (const kindId of ['pc', 'npc']) {
    const kind = resolveCharacterKind(system, kindId);
    const kept = (kind.references?.types ?? []).flatMap((type) => elements.byType(type));
    const builder = new CharacterBuilder(newCharacterOfKind(system, kindId), system, elements);
    for (const element of kept) builder.addReference(element.id);
    const document = sheetDocument(builder.getState());
    const entries = document.references?.entries ?? [];
    const lengths = entries.map((e) => ({ name: e.name, chars: plain(e.html ?? e.note ?? '').length, tables: tableShapes(e.html ?? '') }));
    const tables = lengths.flatMap((e) => e.tables.map((shape) => ({ ...shape, name: e.name })));
    const columns = new Map<string, number>();
    for (const table of tables) tally(columns, `${table.columns} columns`);
    const longest = [...lengths].sort((a, b) => b.chars - a.chars).slice(0, 3);
    const tallest = [...tables].sort((a, b) => b.rows - a.rows).slice(0, 3);
    t.diagnostic(
      `${kind.name} keeping ${entries.length}: ${range(lengths.map((e) => e.chars))} characters each; ` +
        `longest ${longest.map((e) => `${e.name} (${e.chars})`).join(', ')}; ` +
        `with a table ${lengths.filter((e) => e.tables.length).length}, tables ${tables.length}: ${show(columns)}; ` +
        `rows ${range(tables.map((x) => x.rows))}, most ${tallest.map((x) => `${x.name} (${x.rows} rows, ${x.columns} columns)`).join(', ')}`,
    );
    // The kept texts, with the expansion the pane shows (ADR 0069), against what the element writes itself.
    const expanded = kept.map((e) => plain(expandDescription(e, elements)).length - plain(e.description ?? '').length).filter((n) => n > 0);
    t.diagnostic(`${kind.name}: kept texts longer for what they embed: ${expanded.length}`);
  }
});

test('a Cairn character: what a printed page of it holds', async (t) => {
  const system = await loadShippedSystem('cairn');
  const kind = resolveCharacterKind(system, system.characterKinds[0]!.id);
  const index: ElementIndex = new BundleElementIndex([]);
  const builder = new CharacterBuilder(newCharacterOfKind(system, kind.id), system, index);
  for (const step of builder.getState().steps) {
    for (const [at, stat] of (step.budget?.targets ?? []).entries()) builder.setBudgetStat(step.id, stat, 4 + at);
  }
  const state: BuilderState = builder.getState();
  const census = new Census();
  census.read(sheetDocument(state), kind, (id) => index.get(id), `Cairn ${kind.name}`);
  census.report(t, `Cairn ${kind.name}`);
  assert.deepEqual(census.titles, []);
  // A new character's blank name is still a heading.
  const unnamed = new CharacterBuilder({ ...state.character, name: '' }, system, index).getState();
  census.read(sheetDocument(unnamed), kind, (id) => index.get(id), 'unnamed');
  assert.deepEqual(census.titles, []);
});

/** The shell's stylesheet and the components that draw the Sheet, read as source, so this report cannot drift from them. */
test('the shell: what a printed page would have to undo or repeat', (t) => {
  const src = join(import.meta.dirname, '..', '..', '..', 'apps', 'desktop', 'src');
  const css = readFileSync(join(src, 'styles.css'), 'utf8');
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
      .map((m) => m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim())
      .join(' | ') || 'no rule';
  };
  t.diagnostic(`@media print rules: ${(css.match(/@media[^{]*\bprint\b/g) ?? []).length}; @page rules: ${(css.match(/@page\b/g) ?? []).length}; break-/page-break- properties: ${(css.match(/\b(page-)?break-(before|after|inside)\s*:/g) ?? []).length}`);
  for (const selector of ['.app', '.pane', 'header', '.pane-bar', '.sheet-name', '.sheet-section', 'dl', '.sheet-text', '.reference-text', '.picker-description']) {
    t.diagnostic(`${selector}: ${rule(selector)}`);
  }
  const dark = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const token = (name: string, block: string): string => new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim() ?? 'unset';
  t.diagnostic(`colours: light --fg ${token('fg', css)}, --fg-muted ${token('fg-muted', css)}; dark --fg ${token('fg', dark)}, --fg-muted ${token('fg-muted', dark)}, --bg ${token('bg', dark)}`);

  const files = (readdirSync(src, { recursive: true }) as string[]).filter((f) => /\.(ts|tsx)$/.test(f));
  const calls = new Map<string, number>();
  for (const file of files) {
    const text = readFileSync(join(src, file), 'utf8');
    for (const word of ['window.print', 'beforeprint', 'afterprint', "matchMedia('print')", 'print(']) {
      const n = text.split(word).length - 1;
      if (n) tally(calls, `${word} in ${file.replace(/\\/g, '/')}`, n);
    }
  }
  t.diagnostic(`calls into the platform's print in the shell's source: ${show(calls)}`);
  for (const file of ['panes/SheetPane.tsx', 'panes/Companions.tsx', 'panes/References.tsx']) {
    const text = readFileSync(join(src, file), 'utf8');
    const fromUi = [...text.matchAll(/import\s*\{([^}]*)\}\s*from '@incudo\/ui'/g)].flatMap((m) => m[1]!.split(',').map((x) => x.trim()).filter((x) => x && !x.startsWith('type ')));
    t.diagnostic(
      `${file}: from @incudo/ui ${fromUi.join(', ') || 'nothing but types'}; sanitizes content's HTML: ${/sanitizeDescriptionHtml\(/.test(text) ? 'yes' : 'no'}; ` +
        `an <input>: ${/<input\b/.test(text) ? 'yes' : 'no'}; class names ${[...new Set([...text.matchAll(/className="([^"]+)"/g)].map((m) => m[1]!))].join(', ')}`,
    );
  }
  const app = readFileSync(join(src, 'App.tsx'), 'utf8');
  const sheetBlock = /\{pane === 'sheet' && \([\s\S]*?<\/>\s*\)\}/.exec(app)?.[0] ?? '';
  t.diagnostic(`what App.tsx draws around the Sheet: ${[...sheetBlock.matchAll(/<([A-Za-z]+)[\s>]/g)].map((m) => m[1]).join(' ')}; always above it: header, nav`);
});

/** A selector list split at its top-level commas: `:not(.a, .b)` is one selector. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * The rules of a stylesheet, as selector → property → value, the last declaration winning: those inside `@media print`
 * blocks, or those outside every `@media` block. Comments are dropped. Enough for the shell's own stylesheet, which
 * nests nothing deeper than one `@media`.
 */
function cssRules(css: string, which: 'print' | 'screen'): Map<string, Map<string, string>> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = new Map<string, Map<string, string>>();
  const add = (selectors: string, body: string): void => {
    for (const selector of splitSelectors(selectors)) {
      const declarations = rules.get(selector) ?? new Map<string, string>();
      for (const declaration of body.split(';')) {
        const at = declaration.indexOf(':');
        if (at > 0) declarations.set(declaration.slice(0, at).trim(), declaration.slice(at + 1).trim());
      }
      rules.set(selector, declarations);
    }
  };
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    if (head.startsWith('@media')) {
      // The block's own rules, up to its matching brace.
      let depth = 1;
      let j = open + 1;
      while (depth > 0 && j < text.length) {
        if (text[j] === '{') depth++;
        if (text[j] === '}') depth--;
        j++;
      }
      const inner = withoutPageRules(text.slice(open + 1, j - 1));
      if (which === 'print' && /\bprint\b/.test(head)) {
        for (const m of inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)) add(m[1]!, m[2]!);
      }
      i = j;
    } else {
      const close = text.indexOf('}', open);
      if (which === 'screen') add(head, text.slice(open + 1, close));
      i = close + 1;
    }
  }
  return rules;
}

/** A block's body from just after its opening brace, braces matched: a page rule nests its margin boxes. */
function blockEnd(css: string, from: number): number {
  let depth = 1;
  let j = from;
  while (depth > 0 && j < css.length) {
    if (css[j] === '{') depth++;
    if (css[j] === '}') depth--;
    j++;
  }
  return j;
}

/** The `@page` rules of some CSS, with where each starts and ends. */
function pageBlocks(css: string): { selector: string; body: string; start: number; end: number }[] {
  return [...css.matchAll(/@page\b([^{]*)\{/g)].map((m) => {
    const from = m.index! + m[0].length;
    const end = blockEnd(css, from);
    return { selector: m[1]!.trim(), body: css.slice(from, end - 1), start: m.index!, end };
  });
}

function withoutPageRules(css: string): string {
  let out = css;
  for (const block of pageBlocks(css).reverse()) out = out.slice(0, block.start) + out.slice(block.end);
  return out;
}

/** What is inside every `@media print` block, comments dropped. */
function printBlocks(css: string): string {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/@media[^{]*\bprint\b[^{]*\{/g)]
    .map((m) => {
      const from = m.index! + m[0].length;
      return text.slice(from, blockEnd(text, from) - 1);
    })
    .join('\n');
}

interface PageRule {
  /** Where the rule is in the document: the stylesheet's rules, then the one the Sheet renders. */
  order: number;
  declarations: Map<string, string>;
  boxes: Map<string, Map<string, string>>;
}

/** Declarations split at semicolons outside strings: a name may hold one. */
function declarationsOf(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const declaration of body.match(/(?:"(?:[^"\\]|\\.)*"|[^;"])+/g) ?? []) {
    const at = declaration.indexOf(':');
    if (at > 0) map.set(declaration.slice(0, at).trim(), declaration.slice(at + 1).trim());
  }
  return map;
}

const MARGIN_BOX = /@([a-z-]+)\s*\{((?:"(?:[^"\\]|\\.)*"|[^}"])*)\}/g;

/** Page selector (`''` for every page, `name`, `name:first`, `:first`) → its rules in source order. */
function pageRules(css: string): Map<string, PageRule[]> {
  const rules = new Map<string, PageRule[]>();
  let order = 0;
  for (const block of pageBlocks(css)) {
    const boxes = new Map<string, Map<string, string>>();
    for (const m of block.body.matchAll(MARGIN_BOX)) boxes.set(m[1]!, declarationsOf(m[2]!));
    const list = rules.get(block.selector) ?? [];
    list.push({ order: order++, declarations: declarationsOf(block.body.replace(MARGIN_BOX, '')), boxes });
    rules.set(block.selector, list);
  }
  return rules;
}

type Edge = 'top' | 'right' | 'bottom' | 'left';
const EDGES: Edge[] = ['top', 'right', 'bottom', 'left'];

/**
 * A printed page as the rules that apply to it make it. **In document order, whatever the page selectors**, with
 * `!important` above that: measured in Chromium 154 (ADR 0078), an `@page name` rule later in the document gave page 1 a
 * margin box an earlier `@page name:first` set to `none`, and only `!important` held it. The spec ranks `:first` above a
 * bare name; resolving by the spec here would pass the rules that printed the name on page 1.
 */
function resolvePage(applying: PageRule[]): { margins: Record<Edge, string>; padding: string | undefined; boxes: Map<string, Map<string, string>> } {
  const margins: Record<Edge, string> = { top: 'unset', right: 'unset', bottom: 'unset', left: 'unset' };
  let padding: string | undefined;
  const boxes = new Map<string, Map<string, string>>();
  const important = new Set<string>();
  const rules = [...applying].sort((a, b) => a.order - b.order);
  for (const rule of rules) {
    for (const [property, value] of rule.declarations) {
      if (property === 'margin') {
        const [top, right = top, bottom = top, left = right] = value.split(/\s+/) as [string, string?, string?, string?];
        Object.assign(margins, { top, right, bottom, left });
      } else if (/^margin-(top|right|bottom|left)$/.test(property)) margins[property.slice(7) as Edge] = value;
      else if (property === 'padding') padding = value;
    }
    for (const [name, declarations] of rule.boxes) {
      const merged = boxes.get(name) ?? new Map<string, string>();
      for (const [property, value] of declarations) {
        const key = `${name} ${property}`;
        const isImportant = /!important$/.test(value);
        if (important.has(key) && !isImportant) continue;
        if (isImportant) important.add(key);
        merged.set(property, value.replace(/\s*!important$/, ''));
      }
      boxes.set(name, merged);
    }
  }
  return { margins, padding, boxes };
}

const isZero = (length: string): boolean => /^0([a-z]+)?$/.test(length);
/** A box that draws something: content set, and not `none`, `normal` or an empty string. */
const drawn = (box: Map<string, string> | undefined): boolean => {
  const content = box?.get('content');
  return content !== undefined && !/^(none|normal|""|'')$/.test(content);
};

test('the print rules: no edge of a page left to the dialog, and the parts the step can leave out hidden (ADR 0078)', (t) => {
  const src = join(import.meta.dirname, '..', '..', '..', 'apps', 'desktop', 'src');
  const css = readFileSync(join(src, 'styles.css'), 'utf8');
  const printCss = printBlocks(css);
  const print = cssRules(css, 'print');
  const problems: string[] = [];

  // By default, no margin, and the space the dialog's margin kept is padding inside the page.
  const every = resolvePage(pageRules(printCss).get('') ?? []);
  for (const edge of EDGES) if (!isZero(every.margins[edge])) problems.push(`@page: the ${edge} margin is ${every.margins[edge]}, where the dialog prints its own`);
  if (every.padding === undefined || isZero(every.padding)) problems.push("@page: no padding, so the sheet runs to the paper's edge");

  // A name that would break an unescaped rule.
  const title = 'A "B" \\ C; } @page {';
  const document: SheetDocument = { name: title, title, kindName: 'Kind', elementCount: 0, sections: [] };
  for (const pageNumbers of [false, true]) {
    for (const runningName of [false, true]) {
      const combination = `${pageNumbers ? 'numbers' : 'no numbers'}, ${runningName ? 'name' : 'no name'}`;
      const rendering = printRendering({ ...DEFAULT_PRINT_OPTIONS, pageNumbers, runningName }, document);
      const classes = new Set(rendering.classes);
      // The named page: the print rule on `.sheet` whose classes are all present, the one naming most of them.
      let page: string | undefined;
      let named = -1;
      for (const [selector, declarations] of print) {
        const m = /^\.sheet((?:\.print-[a-z-]+)+)$/.exec(selector);
        if (!m || !declarations.has('page')) continue;
        const needs = m[1]!.split('.').filter(Boolean);
        if (needs.every((c) => classes.has(c)) && needs.length > named) {
          page = declarations.get('page');
          named = needs.length;
        }
      }
      const rules = pageRules(printCss + '\n' + (rendering.pageRule ?? ''));
      for (const which of ['first', 'later'] as const) {
        const resolved = resolvePage([
          ...(rules.get('') ?? []),
          ...(which === 'first' ? (rules.get(':first') ?? []) : []),
          ...(page ? (rules.get(page) ?? []) : []),
          ...(page && which === 'first' ? (rules.get(`${page}:first`) ?? []) : []),
        ]);
        const where = `${combination}, the ${which} page`;
        for (const edge of EDGES) {
          const onEdge = [...resolved.boxes].filter(([name, box]) => name.startsWith(edge) && drawn(box));
          if (!isZero(resolved.margins[edge]) && onEdge.length === 0) problems.push(`${where}: the ${edge} edge has a margin and no box drawing in it, so the dialog prints there`);
          if (isZero(resolved.margins[edge]) && onEdge.length > 0) problems.push(`${where}: a box on the ${edge} edge with no margin prints at the paper's edge`);
        }
        const numbered = [...resolved.boxes].some(([name, box]) => name.startsWith('bottom') && drawn(box) && /counter\(page\)/.test(box.get('content')!));
        if (numbered !== pageNumbers) problems.push(`${where}: page numbers ${numbered ? 'printed' : 'missing'}`);
        const nameShown = [...resolved.boxes].some(([, box]) => drawn(box) && box.get('content') === cssString(title));
        if (nameShown !== (runningName && which === 'later')) problems.push(`${where}: the name ${nameShown ? 'printed' : 'missing'}`);
        for (const [name, box] of resolved.boxes) {
          if (drawn(box) && !box.has('font')) problems.push(`${where}: @${name} prints in the platform's serif`);
        }
      }
    }
  }

  // Each part the step can leave out is hidden by its class.
  for (const part of PRINT_PARTS) {
    const hidden = [...print].some(([selector, declarations]) => selector.includes(`.print-omit-${part}`) && declarations.get('display') === 'none');
    if (!hidden) problems.push(`.print-omit-${part}: no rule hides the part`);
  }

  // The Sheet takes the classes and the name's rule, and the step's Print is the only way to the platform's dialog.
  const pane = readFileSync(join(src, 'panes', 'SheetPane.tsx'), 'utf8');
  if (!/className=\{\['pane', 'sheet', \.\.\.print\.classes\]/.test(pane)) problems.push('SheetPane: the print classes are not on the root');
  if (!/<style>\{print\.pageRule\}<\/style>/.test(pane)) problems.push("SheetPane: the name's rule is not rendered");
  const app = readFileSync(join(src, 'App.tsx'), 'utf8');
  // Calls, not mentions: a comment may name it.
  const prints = [...app.matchAll(/^\s*window\.print\(\);/gm)].length;
  if (prints !== 1) problems.push(`App: window.print() called ${prints} times; only after the step's Print`);
  // "Print sheet…" and "Export sheet as PDF…" (ADR 0079) both open the step, through one opener that prints nothing.
  const handler = /const openPrintStep = useCallback\(([\s\S]*?)\n  \}, \[/.exec(app)?.[1] ?? '';
  if (!handler || /window\.print/.test(handler)) problems.push("App: \"Print sheet…\" opens the platform's dialog without the step");
  if (!/const printSheet = useCallback\(\(\): void => openPrintStep\('print'\)/.test(app)) problems.push('App: "Print sheet…" does not open the step');
  if (!/const exportPdfStep = useCallback\(\(\): void => openPrintStep\('pdf'\)/.test(app)) problems.push('App: "Export sheet as PDF…" does not open the step');
  if (!/if \(!printRequested\) return;[\s\S]{0,80}window\.print\(\)/.test(app)) problems.push("App: the platform's dialog does not wait for the step's Print");
  if (!/printDraft !== null \|\|/.test(app)) problems.push('App: the step is not modal');

  t.diagnostic(`@page rules read: ${[...pageRules(printCss)].map(([k, v]) => `${k || '(every page)'} ×${v.length}`).join(', ')}`);
  assert.deepEqual(problems, []);
});

test('the print rules: the Sheet pane on paper, laid out by what it holds (ADR 0077)', (t) => {
  const src = join(import.meta.dirname, '..', '..', '..', 'apps', 'desktop', 'src');
  const css = readFileSync(join(src, 'styles.css'), 'utf8');
  const print = cssRules(css, 'print');
  const screen = cssRules(css, 'screen');
  const problems: string[] = [];
  const expect = (rules: Map<string, Map<string, string>>, selector: string, property: string, value: RegExp, why: string): void => {
    const found = rules.get(selector)?.get(property);
    if (found === undefined || !value.test(found)) problems.push(`${selector} { ${property}: ${found ?? 'unset'} }: ${why}`);
  };

  // The window's bound undone: printed one window tall, everything below the fold is lost.
  expect(print, '.app', 'height', /^auto$/, 'the app is one window tall');
  expect(print, '.app', 'overflow', /^visible$/, 'the app hides what overflows');
  expect(print, '.pane', 'overflow', /^visible$/, 'the pane scrolls instead of growing');
  // Not the sheet.
  for (const selector of ['header', '.pane-bar', '.sheet-name', '.sheet-element-count']) expect(print, selector, 'display', /^none$/, 'printed, and not the sheet');
  // The title is printed as text, and only printed.
  expect(print, '.sheet-print-title', 'display', /^block$/, 'the name is not printed');
  expect(screen, '.sheet-print-title', 'display', /^none$/, 'the name is shown twice on screen');
  // Light colours whatever the screen uses.
  expect(print, ':root', '--fg', /^#0{3}(0{3})?$/, 'text follows the screen\'s scheme onto paper');
  expect(print, ':root', 'color-scheme', /^light$/, 'the page keeps the dark scheme');
  // Two columns, and what fits is not split.
  expect(print, '.sheet-flow', 'columns', /^2$/, 'the sections are not in columns');
  for (const selector of ['dl', '.sheet-elements > li', '.sheet-companion-section', '.sheet-section:not(.sheet-companions, .sheet-references, .sheet-freeform, :has(.sheet-elements))']) {
    expect(print, selector, 'break-inside', /^avoid$/, 'what fits can split across a column');
  }
  // Not a whole section: kept whole, a long list jumped to the next page and left this one half empty.
  const section = print.get('.sheet-section')?.get('break-inside');
  if (section === 'avoid') problems.push('.sheet-section { break-inside: avoid }: a long section leaves a page half empty');
  expect(print, 'h3', 'break-after', /^avoid$/, 'a heading can end a column');
  // What the character keeps: a page of its own, its tables shown whole.
  expect(print, '.sheet-references', 'break-before', /^page$/, 'kept texts share a page with the sheet');
  expect(print, '.reference-text', 'overflow', /^visible$/, 'a twelve-column table is cut at the edge');
  // Content's lines survive print.
  expect(screen, '.sheet-text', 'white-space', /^pre-line$/, 'content\'s lines run together');
  if (print.get('.sheet-text')?.has('white-space')) problems.push('.sheet-text: print changes its white-space');

  // The Sheet pane draws what those rules name.
  const pane = readFileSync(join(src, 'panes', 'SheetPane.tsx'), 'utf8');
  if (!/<h1 className="sheet-print-title">\{document\.title\}<\/h1>/.test(pane)) problems.push('SheetPane: no printed title from the document');
  if (!/className="sheet-element-count"/.test(pane)) problems.push('SheetPane: the element count cannot be hidden in print');
  const flow = /<div className="sheet-flow">([\s\S]*?)<\/div>/.exec(pane)?.[1] ?? '';
  if (!/document\.sections\.map/.test(flow) || !/<Companions /.test(flow)) problems.push('SheetPane: the sections and creatures are not in the flow');
  if (/document\.references/.test(flow)) problems.push('SheetPane: the kept texts are in the two-column flow');

  t.diagnostic(`print rules read: ${print.size} selectors`);
  assert.deepEqual(problems, []);
});
