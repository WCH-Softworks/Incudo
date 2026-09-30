/**
 * What a print options step would choose between, measured before deciding what it offers.
 *
 * ADR 0077 prints the Sheet pane as it is: the character's sections, its held creatures and what it keeps, all of them,
 * through the platform's print dialog. Printed on paper, the maintainer asked for a step of the app's own before that
 * dialog, choosing which parts go on the page and whether the sheet numbers its own pages and names the character on
 * later ones (ROADMAP Phase 5). This reads the sheet document (`sheetDocument`) over the thirty samples (found with
 * `samplesWhere`), the same samples keeping every text their own elements print (ADR 0070's suggestions, which is what
 * a player would keep), every creature as an NPC and as a legendary creature, and a Cairn character, and asks:
 *
 * - **Which parts a kind can ever have**, from what it declares (`companions`, `references`), per shipped system: the
 *   most an options step could offer for it.
 * - **Which parts a sheet has**, and how many sheets have each: whether offering a part the sheet does not have would be
 *   a choice that changes nothing.
 * - **What each part costs**: characters and lines before wrapping, per part, so the page counts the drives print can be
 *   read against them.
 * - **How long a running name would be**: the titles a later page would carry.
 *
 * Report-only (ADR 0042) on the commit before ADR 0078: `ℹ` lines, nothing asserted. Pages are not measured here: a page
 * is where the browser breaks the flow, which only a print shows. ADR 0078's drive printed the same characters with each
 * part left out.
 *
 * Asserted since ADR 0078, against any corpus: for every sheet read here, the step (`printOptionsView`) offers exactly
 * the parts the document has, read here from the document itself, and none when it has only its own sections. Perturbed:
 * a part offered that the document lacks fails it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveCharacterKind, BundleElementIndex, type ElementIndex, type GameSystem } from '@incudo/core';
import {
  CharacterBuilder,
  DEFAULT_PRINT_OPTIONS,
  listedName,
  listedUsage,
  newCharacterOfKind,
  openSelfClosingTags,
  printOptionsView,
  sheetDocument,
  type SheetDocument,
  type SheetSectionView,
} from '@incudo/ui';

import { runOracle } from './aurora-oracle.ts';
import { loadShippedSystem } from './node-system.ts';
import { corpusProvenance, corpusSkip, realElements, savesSkip } from './real-data.ts';
import { samplePath, samplesWhere } from './sample-saves.ts';

type Diagnostic = { diagnostic: (s: string) => void };

const tally = (into: Map<string, number>, key: string, by = 1): void => void into.set(key, (into.get(key) ?? 0) + by);
const show = (m: Map<string, number>): string =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
const range = (values: number[]): string => {
  if (!values.length) return '—';
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[0]!;
  const hi = sorted[sorted.length - 1]!;
  return lo === hi ? String(lo) : `${lo} to ${hi} (median ${sorted[Math.floor(sorted.length / 2)]})`;
};

const plain = (html: string): string =>
  openSelfClosingTags(html).replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, '·').replace(/\s+/g, ' ').trim();

/** Characters and lines before wrapping, counted as `print-layout.test.ts` counts them. */
function sectionCost(section: SheetSectionView): { chars: number; lines: number } {
  let chars = section.label.length + (section.description?.length ?? 0);
  for (const row of section.rows) chars += row.label.length + row.value.length + (row.beside?.length ?? 0);
  for (const e of section.elements) chars += listedName(e).length + (listedUsage(e)?.length ?? 0) + (e.text ? plain(e.text).length : 0);
  for (const p of section.printed) chars += p.label.length + p.text.length;
  const lines = 1 + section.rows.length + section.printed.length + section.elements.reduce((n, e) => n + 1 + (e.text ? e.text.split('\n').length - 1 : 0), 0);
  return { chars, lines };
}

/** A kept text's lines: one per block a reader sees (a paragraph, a heading, a list item, a table row). */
const keptLines = (html: string): number =>
  Math.max(1, (openSelfClosingTags(html).match(/<(p|h[1-6]|li|tr|div)\b/g) ?? []).length);

/**
 * Whether the step offers this sheet exactly the parts its document has, with the document's own labels: `undefined` when
 * it does, else what is wrong. Remembering every part left out must not change what is offered.
 */
function offerProblem(document: SheetDocument): string | undefined {
  const has: string[] = ['sections'];
  const labels: string[] = [];
  if ((document.companions?.creatures.length ?? 0) > 0) {
    has.push('companions');
    labels.push(document.companions!.label);
  }
  if ((document.references?.entries.length ?? 0) > 0) {
    has.push('references');
    labels.push(document.references!.label);
  }
  for (const omit of [[], ['sections', 'companions', 'references']] as const) {
    const view = printOptionsView(document, { ...DEFAULT_PRINT_OPTIONS, omit: [...omit] });
    const offered = view.parts?.choices.map((c) => c.part) ?? ['sections'];
    if (has.length === 1 && view.parts) return `${document.title}: offered parts on a sheet of one part`;
    if (offered.join() !== has.join()) return `${document.title}: offered ${offered.join(', ')}, has ${has.join(', ')}`;
    const offeredLabels = view.parts?.choices.slice(1).map((c) => c.label) ?? [];
    if (offeredLabels.join() !== labels.join()) return `${document.title}: labelled ${offeredLabels.join(', ')}`;
    if (view.parts && !view.parts.choices.some((c) => c.chosen)) return `${document.title}: no part chosen`;
  }
  return undefined;
}

interface PartCost {
  chars: number;
  lines: number;
}

interface SheetParts {
  own: PartCost;
  creatures?: PartCost & { count: number };
  kept?: PartCost & { count: number };
  title: string;
}

function partsOf(document: SheetDocument): SheetParts {
  const sum = (costs: PartCost[], start: PartCost): PartCost =>
    costs.reduce((a, b) => ({ chars: a.chars + b.chars, lines: a.lines + b.lines }), start);
  const creatures = document.companions?.creatures ?? [];
  const entries = document.references?.entries ?? [];
  const parts: SheetParts = { own: sum(document.sections.map(sectionCost), { chars: 0, lines: 0 }), title: document.title };
  if (creatures.length) {
    const each = creatures.map((c) => sum(c.sections.map(sectionCost), { chars: c.name.length, lines: 1 }));
    parts.creatures = { ...sum(each, { chars: 0, lines: 1 }), count: creatures.length };
  }
  if (entries.length) {
    const each = entries.map((e) => ({ chars: e.name.length + plain(e.html ?? e.note ?? '').length, lines: 1 + keptLines(e.html ?? e.note ?? '') }));
    parts.kept = { ...sum(each, { chars: 0, lines: 1 }), count: entries.length };
  }
  return parts;
}

function report(t: Diagnostic, what: string, sheets: SheetParts[]): void {
  const has = new Map<string, number>();
  for (const s of sheets) tally(has, ['the character', s.creatures && 'held creatures', s.kept && 'kept texts'].filter(Boolean).join(' + '));
  t.diagnostic(`${what}: ${sheets.length} sheets; the parts each has: ${show(has)}`);
  t.diagnostic(`${what}: the character's own sections, characters ${range(sheets.map((s) => s.own.chars))}, lines ${range(sheets.map((s) => s.own.lines))}`);
  const withCreatures = sheets.filter((s) => s.creatures);
  if (withCreatures.length) {
    t.diagnostic(
      `${what}: held creatures on ${withCreatures.length} sheets, ${range(withCreatures.map((s) => s.creatures!.count))} each; ` +
        `characters ${range(withCreatures.map((s) => s.creatures!.chars))}, lines ${range(withCreatures.map((s) => s.creatures!.lines))}; ` +
        `as a share of the sheet's lines ${range(withCreatures.map((s) => Math.round((100 * s.creatures!.lines) / (s.own.lines + s.creatures!.lines))))} %`,
    );
  }
  const withKept = sheets.filter((s) => s.kept);
  if (withKept.length) {
    t.diagnostic(
      `${what}: kept texts on ${withKept.length} sheets, ${range(withKept.map((s) => s.kept!.count))} each; ` +
        `characters ${range(withKept.map((s) => s.kept!.chars))}, blocks ${range(withKept.map((s) => s.kept!.lines))}; ` +
        `against the character's own characters ${range(withKept.map((s) => Math.round((100 * s.kept!.chars) / s.own.chars)))} %`,
    );
  }
  t.diagnostic(`${what}: title lengths ${range(sheets.map((s) => s.title.length))}; longest "${[...sheets].sort((a, b) => b.title.length - a.title.length)[0]?.title ?? ''}"`);
}

test('what each shipped kind can ever put on a page: the parts an options step could offer', async (t) => {
  for (const id of ['dnd5e', 'cairn']) {
    const system: GameSystem = await loadShippedSystem(id);
    for (const def of system.characterKinds) {
      const kind = resolveCharacterKind(system, def.id);
      const parts = ['the character', kind.companions && `held creatures ("${kind.companions.label}")`, kind.references && `kept texts ("${kind.references.label ?? 'For reference'}")`].filter(Boolean);
      t.diagnostic(`${system.name} · ${kind.name}: ${parts.join(', ')}`);
    }
  }
});

test('the samples: the parts of each sheet and what each costs', { skip: corpusSkip || savesSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const elements = await realElements();
  const asSaved: SheetParts[] = [];
  const keeping: SheetParts[] = [];
  const suggested: number[] = [];
  const problems: (string | undefined)[] = [];
  for (const sample of samplesWhere(() => true)) {
    const run = await runOracle(samplePath(sample), elements, 'sample');
    const builder = new CharacterBuilder(run.imported.character, run.system, run.elements);
    const saved = sheetDocument(builder.getState());
    asSaved.push(partsOf(saved));
    problems.push(offerProblem(saved));
    // What a player would keep: every text the character's own elements print (ADR 0070), the pane's suggestions.
    const suggestions = builder.getState().references.suggestions;
    suggested.push(suggestions.length);
    for (const s of suggestions) builder.addReference(s.elementId);
    const kept = sheetDocument(builder.getState());
    keeping.push(partsOf(kept));
    problems.push(offerProblem(kept));
  }
  report(t, 'samples as saved', asSaved);
  t.diagnostic(`samples: texts their own elements print, offered to keep, per sheet ${range(suggested)}; sheets with any ${suggested.filter((n) => n > 0).length}`);
  report(t, 'samples keeping every text offered', keeping);
  assert.deepEqual(problems.filter(Boolean), [], 'the step offers exactly the parts each sheet has');
});

test('every creature as an NPC and as a legendary creature: the parts of each sheet', { skip: corpusSkip }, async (t) => {
  t.diagnostic(corpusProvenance());
  const system = await loadShippedSystem('dnd5e');
  const elements = await realElements();
  for (const kindId of ['npc', 'legendary']) {
    const kind = resolveCharacterKind(system, kindId);
    const step = kind.buildSteps.find((s) => (s.required || s.pick) && s.types.length > 0 && !s.budget && !s.multiple)!;
    const sheets: SheetParts[] = [];
    const problems: (string | undefined)[] = [];
    for (const creature of step.types.flatMap((type) => elements.byType(type))) {
      const builder = new CharacterBuilder(newCharacterOfKind(system, kindId), system, elements);
      builder.choose(`build/${step.id}`, [creature.id]);
      builder.setName(creature.name);
      const document = sheetDocument(builder.getState());
      sheets.push(partsOf(document));
      problems.push(offerProblem(document));
    }
    report(t, kind.name, sheets);
    assert.deepEqual(problems.filter(Boolean), [], `${kind.name}: the step offers exactly the parts each sheet has`);
  }
});

test('a Cairn character: the parts of its sheet', async (t) => {
  const system = await loadShippedSystem('cairn');
  const kind = resolveCharacterKind(system, system.characterKinds[0]!.id);
  const index: ElementIndex = new BundleElementIndex([]);
  const builder = new CharacterBuilder(newCharacterOfKind(system, kind.id), system, index);
  const document = sheetDocument(builder.getState());
  report(t, `Cairn ${kind.name}`, [partsOf(document)]);
  assert.equal(offerProblem(document), undefined);
});
